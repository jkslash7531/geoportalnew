"""
Resumable chunked uploads for very large files (up to 100 GB).

Why this exists: a single giant multipart POST forces Starlette to spool the
entire file to a temp file before the endpoint runs. For multi-GB files that
temp write (on a bind-mounted volume) fails with Errno 5, needs 2x disk, and
offers no resume. Instead the client splits the file into 32 MB chunks and
POSTs them as raw bytes; the server appends each chunk at its offset, so a
dropped connection only re-sends one chunk.

Flow:
    POST /api/uploads/init                 -> {upload_id, chunk_size}
    POST /api/uploads/{id}/chunk?index=N   (repeat, raw bytes)
    GET  /api/uploads/{id}                 (status / resume offset)
    POST /api/uploads/{id}/complete        -> registers layer / tile package
    DELETE /api/uploads/{id}               (abort and clean up)

Vector files are imported with ogr2ogr (GDAL) in a background thread:
staging table -> single bulk INSERT ... SELECT into vector_features.
Millions of features import in minutes instead of hours.
"""

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.auth import require_role
from app.cache import invalidate_layer_cache
from app.config import get_settings
from app.database import get_db
from app.models import GeometryType, MBTilesPackage, SurveyProject, User, UserRole, VectorLayer
from app.schemas import MBTilesResponse
from app.tileserver import (
    TILESERVER_DATA_DIR,
    extract_mbtiles_metadata,
    get_file_size,
    regenerate_tileserver_config,
)

router = APIRouter(prefix="/api/uploads", tags=["Uploads"])

settings = get_settings()

# 32 MB chunks: small enough to stream with constant memory, large enough that
# a 100 GB file needs only ~3,200 requests.
CHUNK_SIZE = 32 * 1024 * 1024
# Abandoned upload sessions older than this are cleaned up opportunistically.
SESSION_TTL_SECONDS = 24 * 3600

VECTOR_EXTENSIONS = {".geojson", ".json", ".gpkg", ".kml"}
RASTER_EXTENSIONS = {".mbtiles"}


def _parts_dir(kind: str = "vector") -> Path:
    """
    Directory holding chunk parts and session sidecars.

    Raster uploads assemble DIRECTLY inside the tileserver data dir so the
    finalize step is an atomic same-directory rename. Assembling in
    /app/uploads and moving across bind mounts forces a full file copy
    through the file-sharing layer, which fails with EIO on multi-GB files.
    """
    base = TILESERVER_DATA_DIR if kind == "raster" else Path(settings.UPLOAD_DIR)
    d = base / ".parts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _session_path(upload_id: str, parts_dir: Optional[Path] = None) -> Path:
    if parts_dir is None:
        # Sessions are looked up across both parts dirs.
        for kind in ("vector", "raster"):
            p = _parts_dir(kind) / f"{upload_id}.json"
            if p.exists():
                return p
        return _parts_dir("vector") / f"{upload_id}.json"
    return parts_dir / f"{upload_id}.json"


def _part_path(upload_id: str, parts_dir: Path) -> Path:
    return parts_dir / f"{upload_id}.part"


def _load_session(upload_id: str) -> Dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{32}", upload_id or ""):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
    p = _session_path(upload_id)
    if not p.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")
    try:
        session = json.loads(p.read_text())
        session["_parts_dir"] = str(p.parent)
        return session
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found")


def _save_session(session: Dict[str, Any]) -> None:
    parts_dir = Path(session.get("_parts_dir") or _parts_dir(session.get("kind", "vector")))
    _session_path(session["upload_id"], parts_dir).write_text(
        json.dumps({k: v for k, v in session.items() if not k.startswith("_")})
    )


def _delete_session(upload_id: str) -> None:
    try:
        session = _load_session(upload_id)
        parts_dir = Path(session["_parts_dir"])
    except HTTPException:
        return
    for p in (_session_path(upload_id, parts_dir), _part_path(upload_id, parts_dir)):
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass


def _cleanup_stale_sessions() -> None:
    """Remove upload sessions (and their partial files) older than the TTL."""
    try:
        now = time.time()
        for kind in ("vector", "raster"):
            for p in _parts_dir(kind).glob("*.json"):
                try:
                    if now - p.stat().st_mtime > SESSION_TTL_SECONDS:
                        _delete_session(p.stem)
                except Exception:
                    continue
    except Exception:
        pass


def _sanitize_filename(filename: str, default_stem: str = "upload") -> str:
    base = os.path.basename(filename or "")
    stem = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", Path(base).stem).strip("_.") or default_stem
    ext = Path(base).suffix.lower()
    return f"{stem[:80]}{ext}"


def _expected_chunk_size(session: Dict[str, Any], index: int) -> int:
    total = session["total_size"]
    start = index * session["chunk_size"]
    return max(0, min(session["chunk_size"], total - start))


class InitUploadRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=500)
    total_size: int = Field(..., gt=0)
    kind: str = Field(..., pattern="^(vector|raster)$")
    # Registration metadata used at completion time
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    is_global: bool = True
    project_id: Optional[int] = None
    editable_by_collectors: bool = True
    allow_snapping: bool = True


@router.post("/init")
async def init_upload(
    payload: InitUploadRequest,
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Start a resumable upload session. Returns upload_id and chunk_size."""
    _cleanup_stale_sessions()

    ext = Path(payload.filename).suffix.lower()
    allowed = VECTOR_EXTENSIONS if payload.kind == "vector" else RASTER_EXTENSIONS
    if ext not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported extension '{ext}' for {payload.kind} upload. "
                   f"Allowed: {sorted(allowed)}",
        )

    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if payload.total_size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large ({payload.total_size / 1e9:.1f} GB). "
                   f"Limit is {settings.MAX_UPLOAD_SIZE_MB / 1024:.0f} GB.",
        )

    upload_id = uuid.uuid4().hex
    total_chunks = (payload.total_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    parts_dir = _parts_dir(payload.kind)
    session = {
        "upload_id": upload_id,
        "filename": _sanitize_filename(payload.filename),
        "kind": payload.kind,
        "total_size": payload.total_size,
        "chunk_size": CHUNK_SIZE,
        "total_chunks": total_chunks,
        "received": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": admin.id,
        "_parts_dir": str(parts_dir),
        "params": {
            "name": payload.name.strip(),
            "description": payload.description,
            "is_global": payload.is_global,
            "project_id": payload.project_id,
            "editable_by_collectors": payload.editable_by_collectors,
            "allow_snapping": payload.allow_snapping,
        },
    }
    _save_session(session)
    # Pre-create the (sparse) part file so chunk writes can seek.
    _part_path(upload_id, parts_dir).touch(exist_ok=True)
    return {"upload_id": upload_id, "chunk_size": CHUNK_SIZE, "total_chunks": total_chunks}


@router.post("/{upload_id}/chunk")
async def upload_chunk(
    upload_id: str,
    index: int = Query(..., ge=0),
    request: Request = None,
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """
    Upload one chunk as raw bytes (Content-Type: application/octet-stream).
    Chunks are written at index * chunk_size, so retries are idempotent and
    resume is trivial. Clients should send chunks sequentially.
    """
    session = _load_session(upload_id)
    if index >= session["total_chunks"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Chunk index out of range")

    expected = _expected_chunk_size(session, index)
    content_length = request.headers.get("content-length")
    if content_length is not None and int(content_length) != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Chunk {index} must be {expected} bytes, got {content_length}",
        )

    part = _part_path(upload_id, Path(session["_parts_dir"]))
    offset = index * session["chunk_size"]
    received = 0
    try:
        with open(part, "r+b") as f:
            f.seek(offset)
            async for piece in request.stream():
                f.write(piece)
                received += len(piece)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write chunk {index}: {e}",
        )
    if received != expected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Chunk {index} incomplete: expected {expected} bytes, got {received}",
        )

    if index not in session["received"]:
        session["received"].append(index)
        _save_session(session)
    return {
        "upload_id": upload_id,
        "index": index,
        "received_chunks": len(session["received"]),
        "total_chunks": session["total_chunks"],
    }


@router.get("/{upload_id}")
async def upload_status(
    upload_id: str,
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Poll an upload session (used to resume after a dropped connection)."""
    session = _load_session(upload_id)
    return {
        "upload_id": upload_id,
        "filename": session["filename"],
        "kind": session["kind"],
        "total_size": session["total_size"],
        "chunk_size": session["chunk_size"],
        "total_chunks": session["total_chunks"],
        "received_chunks": len(session["received"]),
        "next_index": min(set(range(session["total_chunks"])) - set(session["received"]), default=None),
        "complete": len(session["received"]) == session["total_chunks"],
    }


@router.delete("/{upload_id}")
async def abort_upload(
    upload_id: str,
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Abort an upload and delete its partial data."""
    _load_session(upload_id)  # 404 if unknown
    _delete_session(upload_id)
    return {"ok": True}


async def _validate_project(db, is_global: bool, project_id: Optional[int]) -> Optional[int]:
    if not is_global and project_id:
        res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
        if not res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target project not found")
        return project_id
    return None


@router.post("/{upload_id}/complete")
async def complete_upload(
    upload_id: str,
    background_tasks: BackgroundTasks,
    db=Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Assemble chunks and register the file as a tile package or vector layer."""
    session = _load_session(upload_id)
    part = _part_path(upload_id, Path(session["_parts_dir"]))
    if len(session["received"]) != session["total_chunks"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Upload incomplete: {len(session['received'])}/{session['total_chunks']} chunks received",
        )
    if not part.exists() or part.stat().st_size != session["total_size"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assembled file size mismatch")

    params = session["params"]
    target_project_id = await _validate_project(db, params["is_global"], params["project_id"])

    if session["kind"] == "raster":
        return await _complete_raster(session, part, params, target_project_id, db, admin)
    return await _complete_vector(session, part, params, target_project_id, db, admin, background_tasks)


def _robust_move(src: Path, dst: Path) -> None:
    """
    Move src -> dst, preferring an atomic rename.

    os.rename is atomic when source and destination live on the same mount
    (our raster parts assemble inside the tileserver data dir for exactly
    this reason). If rename ever fails (e.g. cross-mount), fall back to a
    streaming copy with retries instead of one giant shutil.move, then
    remove the source.
    """
    try:
        os.rename(src, dst)
        return
    except OSError:
        pass
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            with open(src, "rb") as fsrc, open(dst, "wb") as fdst:
                shutil.copyfileobj(fsrc, fdst, length=64 * 1024 * 1024)
                fdst.flush()
                os.fsync(fdst.fileno())
            os.remove(src)
            return
        except Exception as e:  # noqa: BLE001 - retry then report
            last_err = e
            try:
                if dst.exists():
                    dst.unlink()
            except Exception:
                pass
            time.sleep(2 * (attempt + 1))
    raise last_err if last_err else OSError("move failed")


async def _complete_raster(session, part: Path, params, target_project_id, db, admin):
    """Move the assembled .mbtiles into the tileserver data dir and register it."""
    TILESERVER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe_filename = session["filename"]
    dest = TILESERVER_DATA_DIR / safe_filename
    if dest.exists():
        safe_filename = f"{int(time.time())}_{safe_filename[:60]}"
        dest = TILESERVER_DATA_DIR / safe_filename
    try:
        # part lives in TILESERVER_DATA_DIR/.parts -> same-mount atomic rename
        _robust_move(part, dest)
        try:
            os.chmod(dest, 0o664)
        except Exception:
            pass
    except Exception as e:
        _delete_session(session["upload_id"])
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {e}",
        )

    file_size = get_file_size(safe_filename)
    meta = extract_mbtiles_metadata(safe_filename)
    try:
        package = MBTilesPackage(
            name=params["name"],
            filename=safe_filename,
            description=params.get("description"),
            bounds=meta.get("bounds"),
            center=meta.get("center"),
            min_zoom=meta.get("min_zoom"),
            max_zoom=meta.get("max_zoom"),
            file_size=file_size,
            is_global=params["is_global"],
            project_id=target_project_id,
            uploaded_by=admin.id,
        )
        db.add(package)
        await db.flush()
        await regenerate_tileserver_config(db)
        await db.commit()
    except Exception as e:
        await db.rollback()
        try:
            if dest.exists():
                dest.unlink()
        except Exception:
            pass
        _delete_session(session["upload_id"])
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register MBTiles package: {e}",
        )

    _delete_session(session["upload_id"])
    return MBTilesResponse(
        id=package.id, name=package.name, filename=package.filename,
        description=package.description, bounds=package.bounds,
        center=package.center, min_zoom=package.min_zoom, max_zoom=package.max_zoom,
        file_size=package.file_size, is_global=package.is_global,
        project_id=package.project_id, created_at=package.created_at,
    )


async def _complete_vector(session, part: Path, params, target_project_id, db, admin, background_tasks):
    """Create the layer row and import features in the background with ogr2ogr."""
    # Keep the assembled file: the background import reads it, then deletes it.
    final_name = f"{session['upload_id']}_{session['filename']}"
    final_path = Path(settings.UPLOAD_DIR) / final_name
    final_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        _robust_move(part, final_path)
    except Exception as e:
        _delete_session(session["upload_id"])
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {e}",
        )
    _delete_session(session["upload_id"])

    layer = VectorLayer(
        name=params["name"],
        geometry_type=GeometryType.GEOMETRY,  # refined after import
        is_global=params["is_global"],
        project_id=target_project_id,
        editable_by_collectors=params.get("editable_by_collectors", True),
        allow_snapping=params.get("allow_snapping", True),
        fields_config=[],
        source_filename=session["filename"],
        import_status="importing",
        created_by=admin.id,
    )
    db.add(layer)
    await db.flush()
    layer_id = layer.id
    await db.commit()

    staging = f"stg_{session['upload_id']}"
    background_tasks.add_task(
        _run_vector_import, layer_id, str(final_path), staging, admin.id
    )
    return {"id": layer_id, "name": layer.name, "import_status": "importing"}


# Map PostGIS ST_GeometryType() output to the app's GeometryType enum.
_GEOM_TYPE_MAP = {
    "ST_Point": GeometryType.POINT,
    "ST_LineString": GeometryType.LINESTRING,
    "ST_Polygon": GeometryType.POLYGON,
    "ST_MultiPoint": GeometryType.MULTIPOINT,
    "ST_MultiLineString": GeometryType.MULTILINESTRING,
    "ST_MultiPolygon": GeometryType.MULTIPOLYGON,
}

_PG_NUMERIC = {"integer", "bigint", "smallint", "double precision", "numeric", "real"}

# Rows per INSERT ... SELECT batch during bulk import. Each batch commits
# separately and reports progress; 500k is a good throughput/progress mix.
INSERT_BATCH_SIZE = 500_000

# Hard cap for the ogr2ogr staging phase.
OGR2OGR_TIMEOUT_SECONDS = 6 * 3600


def _geojson_already_4326(path: str) -> bool:
    """
    True when a .geojson/.json file has no top-level "crs" member.

    Per RFC 7946 the CRS of GeoJSON without a "crs" member is WGS 84, so the
    -t_srs EPSG:4326 reprojection would be a no-op — skipping it saves a
    per-vertex transform over millions of coordinates. The check reads only
    the first 64KB (a top-level "crs" always sits near the start of the file);
    any doubt -> False (keep the reprojection, just slower).
    """
    try:
        with open(path, "rb") as f:
            head = f.read(65536)
        if b'"crs"' in head:
            return False
        return head.lstrip().startswith(b"{")
    except Exception:
        return False


def _set_import_phase(engine, layer_id: int, phase: Optional[str]) -> None:
    """Best-effort progress note update (surfaces in the UI while importing)."""
    try:
        from sqlalchemy import text as sql_text

        with engine.begin() as conn:
            conn.execute(
                sql_text("UPDATE vector_layers SET import_phase=:p WHERE id=:lid"),
                {"p": phase, "lid": layer_id},
            )
    except Exception:
        pass


def _run_vector_import(layer_id: int, src_path: str, staging: str, created_by: int) -> None:
    """
    Bulk-import a vector file into vector_features (runs in a worker thread).

    ogr2ogr streams the file into a staging table (C speed, constant memory),
    then a single INSERT ... SELECT moves millions of rows with one statement.
    """
    import asyncio as _asyncio

    from sqlalchemy import create_engine, text as sql_text

    s = get_settings()
    log_prefix = f"[vector-import layer={layer_id}]"
    engine = create_engine(s.DATABASE_URL_SYNC, pool_pre_ping=True)

    def _fail(msg: str) -> None:
        print(f"{log_prefix} FAILED: {msg}")
        try:
            with engine.begin() as conn:
                conn.execute(
                    sql_text(
                        "UPDATE vector_layers SET import_status='failed', "
                        "import_error=:msg, import_phase=NULL WHERE id=:lid"
                    ),
                    {"msg": msg[:2000], "lid": layer_id},
                )
                conn.execute(sql_text(f'DROP TABLE IF EXISTS "{staging}"'))
                # The GIST index is dropped for bulk loads; make sure it
                # exists again even when the import dies halfway.
                conn.execute(
                    sql_text(
                        "CREATE INDEX IF NOT EXISTS idx_feature_geom "
                        "ON vector_features USING gist (geom)"
                    )
                )
        except Exception as e:
            print(f"{log_prefix} could not record failure: {e}")

    try:
        print(f"{log_prefix} starting ogr2ogr for {src_path}")
        env = os.environ.copy()
        env["PGPASSWORD"] = s.POSTGRES_PASSWORD  # keeps it out of the cmdline
        pg_conn = (
            f"PG:host={s.POSTGRES_HOST} port={s.POSTGRES_PORT} "
            f"dbname={s.POSTGRES_DB} user={s.POSTGRES_USER}"
        )
        ext = os.path.splitext(src_path)[1].lower()
        cmd = [
            "ogr2ogr", "-f", "PostgreSQL", pg_conn, src_path,
            "-nln", staging,
            # NOTE: no -t_srs when the GeoJSON is already WGS84 (checked
            # below) — a 4326->4326 "reprojection" still costs a per-vertex
            # transform over millions of coordinates.
            "-lco", "GEOMETRY_NAME=geom",
            "-lco", "FID=ogc_fid",
            # No spatial index on the staging table: ogr2ogr would otherwise
            # maintain a GIST index row-by-row during the COPY, and we drop
            # the staging table right after the import anyway.
            "-lco", "SPATIAL_INDEX=NONE",
            "--config", "PG_USE_COPY", "YES",  # COPY protocol, not row inserts
            "-progress",  # lets us report live % while the import runs
        ]
        if not (ext in (".geojson", ".json") and _geojson_already_4326(src_path)):
            cmd[7:7] = ["-t_srs", "EPSG:4326"]

        # Stream stderr to a file: keeps unbounded warning output out of RAM
        # and lets us parse the -progress percentages while it runs.
        parts_dir = Path(src_path).parent / ".parts"
        parts_dir.mkdir(parents=True, exist_ok=True)
        err_log = parts_dir / f"ogr2ogr-{layer_id}.log"
        _set_import_phase(engine, layer_id, "ogr2ogr सुरु हुँदैछ...")
        proc = subprocess.Popen(
            cmd, env=env, stdout=subprocess.DEVNULL,
            stderr=open(err_log, "w", errors="replace"),
        )
        deadline = time.time() + OGR2OGR_TIMEOUT_SECONDS
        last_reported = -1
        last_db_update = 0.0
        err_tail = ""
        while True:
            rc = proc.poll()
            try:
                with open(err_log, errors="replace") as ef:
                    ef.seek(max(0, os.path.getsize(err_log) - 4000))
                    tail = ef.read()
            except Exception:
                tail = ""
            nums = re.findall(r"(\d+)\.\.\.", tail)
            pct = int(nums[-1]) if nums else 0
            now_t = time.time()
            if pct != last_reported and now_t - last_db_update > 10:
                last_reported = pct
                last_db_update = now_t
                _set_import_phase(engine, layer_id, f"ogr2ogr {pct}%")
                print(f"{log_prefix} ogr2ogr {pct}%")
            if rc is not None:
                err_tail = tail[-1500:]
                break
            if now_t > deadline:
                proc.kill()
                _set_import_phase(engine, layer_id, None)
                _fail("ogr2ogr timed out after 6 hours")
                return
            time.sleep(5)
        try:
            if err_log.exists():
                err_log.unlink()
        except Exception:
            pass
        if proc.returncode != 0:
            _set_import_phase(engine, layer_id, None)
            _fail(f"ogr2ogr failed (exit {proc.returncode}): {err_tail}")
            return
        _set_import_phase(engine, layer_id, "डेटाबेसमा सारिँदैछ...")

        with engine.begin() as conn:
            # Dominant geometry type -> layer.geometry_type
            gtype_row = conn.execute(
                sql_text(
                    f'SELECT ST_GeometryType(geom) AS g, COUNT(*) AS c FROM "{staging}" '
                    "GROUP BY 1 ORDER BY 2 DESC LIMIT 1"
                )
            ).first()
            geom_type = _GEOM_TYPE_MAP.get(gtype_row[0] if gtype_row else None, GeometryType.GEOMETRY)

            # Field list from staging columns (skip internal cols)
            cols = conn.execute(
                sql_text(
                    "SELECT column_name, data_type FROM information_schema.columns "
                    "WHERE table_name=:t AND column_name NOT IN ('geom','ogc_fid') "
                    "ORDER BY ordinal_position"
                ),
                {"t": staging},
            ).all()
            fields_config: List[Dict[str, Any]] = []
            for col_name, data_type in cols:
                if col_name.startswith("_"):
                    continue
                ftype = "text"
                if data_type == "boolean":
                    ftype = "checkbox"
                elif data_type in _PG_NUMERIC:
                    ftype = "number"
                fields_config.append({
                    "name": col_name,
                    "label": col_name.replace("_", " ").title(),
                    "type": ftype,
                    "required": False,
                })

            # How many rows are we about to move? (drives progress reporting)
            total = conn.execute(
                sql_text(f'SELECT COUNT(*) FROM "{staging}"')
            ).scalar() or 0
            # Drop the GIST index for the bulk load: maintaining it row-by-row
            # for millions of rows is the slowest part of the import. It is
            # rebuilt in one bulk pass afterwards (IF NOT EXISTS: concurrent
            # imports of other layers share this state safely).
            conn.execute(sql_text("DROP INDEX IF EXISTS idx_feature_geom"))
            conn.execute(
                sql_text(
                    "UPDATE vector_layers SET import_total=:t, import_count=0 "
                    "WHERE id=:lid"
                ),
                {"t": total, "lid": layer_id},
            )

        # Batched bulk move: ST_Force2D strips Z/M, props -> JSONB.
        # Each batch commits separately (smaller WAL spikes) and reports
        # progress so the UI can show "1.2M / 3.4M features".
        max_fid = 0
        if total > 0:
            with engine.begin() as conn:
                max_fid = conn.execute(
                    sql_text(f'SELECT MAX(ogc_fid) FROM "{staging}"')
                ).scalar() or 0
        inserted = 0
        lo = 0
        _set_import_phase(engine, layer_id, None)  # batch loop reports via import_count
        while lo <= max_fid and total > 0:
            hi = lo + INSERT_BATCH_SIZE
            with engine.begin() as conn:
                result = conn.execute(
                    sql_text(
                        "INSERT INTO vector_features (layer_id, geom, properties, created_by) "
                        "SELECT :lid, ST_Force2D(ST_SetSRID(geom, 4326)), "
                        "to_jsonb(s) - 'geom' - 'ogc_fid', :uid "
                        f'FROM "{staging}" AS s '
                        "WHERE s.ogc_fid >= :lo AND s.ogc_fid < :hi"
                    ),
                    {"lid": layer_id, "uid": created_by, "lo": lo, "hi": hi},
                )
                inserted += result.rowcount or 0
                conn.execute(
                    sql_text(
                        "UPDATE vector_layers SET import_count=:n WHERE id=:lid"
                    ),
                    {"n": inserted, "lid": layer_id},
                )
            print(f"{log_prefix} {inserted}/{total} features")
            lo = hi
        feature_count = inserted

        # Bulk-build the spatial index in one pass (far faster than
        # incremental maintenance during the load).
        _set_import_phase(engine, layer_id, "स्पेसियल इन्डेक्स बनाइँदैछ...")
        with engine.begin() as conn:
            conn.execute(
                sql_text(
                    "CREATE INDEX IF NOT EXISTS idx_feature_geom "
                    "ON vector_features USING gist (geom)"
                )
            )

            # Merge feature_count into metadata_info
            meta_row = conn.execute(
                sql_text("SELECT metadata_info FROM vector_layers WHERE id=:lid"),
                {"lid": layer_id},
            ).first()
            metadata_info = dict(meta_row[0] or {}) if meta_row else {}
            metadata_info["feature_count"] = feature_count
            metadata_info["imported_at"] = datetime.now(timezone.utc).isoformat()

            conn.execute(
                sql_text(
                    "UPDATE vector_layers SET geometry_type=:gt, fields_config=:fc, "
                    "metadata_info=:mi, import_status='complete', import_error=NULL, "
                    "import_phase=NULL, import_count=:n WHERE id=:lid"
                ),
                {
                    "gt": geom_type.value,
                    "fc": json.dumps(fields_config),
                    "mi": json.dumps(metadata_info),
                    "n": feature_count,
                    "lid": layer_id,
                },
            )
            conn.execute(sql_text(f'DROP TABLE "{staging}"'))

        # Refresh planner stats after the massive insert (best effort;
        # VACUUM cannot run inside a transaction block).
        try:
            with engine.connect() as conn:
                conn = conn.execution_options(isolation_level="AUTOCOMMIT")
                conn.execute(sql_text("VACUUM ANALYZE vector_features"))
        except Exception as e:
            print(f"{log_prefix} VACUUM skipped: {e}")

        print(f"{log_prefix} imported {feature_count} features")
    except Exception as e:
        _fail(str(e))
        return
    finally:
        try:
            if os.path.exists(src_path):
                os.remove(src_path)  # source lives in PostGIS now; reclaim space
        except Exception:
            pass
        engine.dispose()

    # Fresh tiles for the new data (best effort)
    try:
        _asyncio.run(invalidate_layer_cache(layer_id))
    except Exception:
        pass
