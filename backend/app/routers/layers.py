"""
KMC-GIS-SERVER — Layers Router
Vector layer CRUD, file upload, and download (GeoJSON, Shapefile, KML, CSV).
"""

import re
import json
from typing import Optional, List, Any

from fastapi import APIRouter, Depends, HTTPException, status, Request, UploadFile, File, Form, Query, Body
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import aliased
import pyproj

from app.database import get_db
from app.models import (
    User, UserRole, SurveyProject, VectorLayer, VectorFeature,
    ProjectLayerAssignment, GeometryType,
)
from app.schemas import LayerCreate, LayerResponse, LayerUpdate, MessageResponse
from app.auth import get_current_user, require_role
from app.cache import invalidate_layer_cache
from app.helpers import (
    log_audit, get_user_accessible_project_ids, is_project_accessible_by_user,
    is_layer_accessible_by_user,
)
from app.geometry_utils import (
    detect_crs_from_geojson_or_coords,
    sanitize_and_reproject_geometry,
    _sanitize_and_transform_coords,
    _get_first_coordinate,
    WGS84_CRS,
    export_features_to_geojson,
    export_features_to_shapefile_zip,
    export_features_to_kml,
    export_features_to_csv,
)

router = APIRouter(prefix="/api", tags=["Layers"])


async def get_or_detect_layer_fields(db: AsyncSession, layer: VectorLayer) -> List[dict]:
    """Return configured fields or auto-infer them from existing vector features."""
    if layer.fields_config and isinstance(layer.fields_config, list) and len(layer.fields_config) > 0:
        return layer.fields_config

    feat_res = await db.execute(
        select(VectorFeature.properties)
        .where(VectorFeature.layer_id == layer.id)
        .limit(100)
    )
    rows = feat_res.all()
    fields_dict = {}
    for (props,) in rows:
        if isinstance(props, dict):
            for k, v in props.items():
                if str(k).startswith("_") or str(k).startswith("__"):
                    continue
                if k not in fields_dict:
                    ftype = "text"
                    if isinstance(v, bool):
                        ftype = "checkbox"
                    elif isinstance(v, (int, float)):
                        ftype = "number"
                    fields_dict[k] = {
                        "name": k,
                        "label": k.replace("_", " ").title(),
                        "type": ftype,
                        "required": False,
                    }
                elif fields_dict[k]["type"] == "text" and isinstance(v, (int, float)):
                    fields_dict[k]["type"] = "number"

    return list(fields_dict.values())


# ============================================================
# VECTOR LAYER CRUD
# ============================================================

@router.post("/layers", response_model=LayerResponse)
async def create_layer(
    body: LayerCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Create a new vector layer (global or project-specific). GisAdmin only."""
    layer = VectorLayer(
        name=body.name,
        description=body.description,
        geometry_type=GeometryType(body.geometry_type),
        style=body.style,
        editable_by_collectors=body.editable_by_collectors,
        allow_snapping=body.allow_snapping,
        fields_config=body.fields_config or [],
        creation_geometry_types=body.creation_geometry_types or [body.geometry_type],
        geometry_fields_config=body.geometry_fields_config or {},
        is_global=body.is_global,
        project_id=None,  # Global by default
        created_by=admin.id,
    )
    db.add(layer)
    await db.flush()

    return LayerResponse(
        id=layer.id, name=layer.name, description=layer.description,
        geometry_type=layer.geometry_type.value, style=layer.style,
        editable_by_collectors=layer.editable_by_collectors,
        allow_snapping=layer.allow_snapping,
        is_global=layer.is_global, project_id=layer.project_id,
        feature_count=0, fields_config=layer.fields_config or [],
        creation_geometry_types=layer.creation_geometry_types or [layer.geometry_type.value],
        geometry_fields_config=layer.geometry_fields_config or {},
        created_at=layer.created_at,
    )


@router.get("/layers", response_model=List[LayerResponse])
async def list_global_layers(
    all_layers: bool = Query(False, description="List all vector layers (global and project-scoped)"),
    project_id: Optional[int] = Query(None, description="Filter layers by project ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List vector layers (enforcing access control for DataCollectors)."""
    if current_user.role == UserRole.DataCollector:
        accessible_proj_ids = await get_user_accessible_project_ids(db, current_user)
        if not accessible_proj_ids:
            return []

        if project_id is not None:
            if project_id not in accessible_proj_ids:
                return []
            target_pids = [project_id]
        else:
            target_pids = accessible_proj_ids

        assigned_result = await db.execute(
            select(ProjectLayerAssignment.layer_id)
            .where(ProjectLayerAssignment.project_id.in_(target_pids))
        )
        assigned_ids = [row[0] for row in assigned_result.all()]

        query = select(VectorLayer).where(
            or_(
                VectorLayer.id.in_(assigned_ids) if assigned_ids else False,
                and_(VectorLayer.project_id.in_(target_pids), VectorLayer.is_global == False),
            )
        ).order_by(VectorLayer.created_at.desc())
    else:
        query = select(VectorLayer)
        if project_id is not None:
            assigned_result = await db.execute(
                select(ProjectLayerAssignment.layer_id)
                .where(ProjectLayerAssignment.project_id == project_id)
            )
            assigned_ids = [row[0] for row in assigned_result.all()]
            query = query.where(
                or_(
                    VectorLayer.id.in_(assigned_ids) if assigned_ids else False,
                    and_(VectorLayer.project_id == project_id, VectorLayer.is_global == False),
                )
            )
        elif not all_layers:
            query = query.where(VectorLayer.is_global == True)
        query = query.order_by(VectorLayer.created_at.desc())

    result = await db.execute(query)
    layers = result.scalars().all()

    # Pre-fetch project names for project_name mapping
    proj_res = await db.execute(select(SurveyProject.id, SurveyProject.name))
    proj_map = {pid: pname for pid, pname in proj_res.all()}

    responses = []
    for layer in layers:
        count_result = await db.execute(
            select(func.count(VectorFeature.id)).where(VectorFeature.layer_id == layer.id)
        )
        count = count_result.scalar() or 0
        fields = await get_or_detect_layer_fields(db, layer)
        responses.append(LayerResponse(
            id=layer.id, name=layer.name, description=layer.description,
            geometry_type=layer.geometry_type.value, style=layer.style,
            editable_by_collectors=layer.editable_by_collectors,
            allow_snapping=layer.allow_snapping,
            is_global=layer.is_global, project_id=layer.project_id,
            category=getattr(layer, 'category', 'General') or 'General',
            published_in_geoportal=getattr(layer, 'published_in_geoportal', True),
            default_visible_in_geoportal=getattr(layer, 'default_visible_in_geoportal', False),
            opacity=getattr(layer, 'opacity', 1.0) or 1.0,
            role_permissions=getattr(layer, 'role_permissions', None),
            field_permissions=getattr(layer, 'field_permissions', None),
            dashboard_config=getattr(layer, 'dashboard_config', None),
            metadata_info=getattr(layer, 'metadata_info', None),
            project_name=proj_map.get(layer.project_id) if layer.project_id else None,
            feature_count=count, fields_config=fields,
            creation_geometry_types=layer.creation_geometry_types if (layer.creation_geometry_types and len(layer.creation_geometry_types) > 0) else [layer.geometry_type.value],
            geometry_fields_config=layer.geometry_fields_config or {},
            created_at=layer.created_at,
        ))
    return responses


@router.get("/projects/{project_id}/layers", response_model=List[LayerResponse])
async def list_project_layers(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all layers available to a project:
    (global layers assigned to project) ∪ (project-specific layers)
    """
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You are not assigned to this project.",
        )

    # Get assigned global layer IDs
    assigned_result = await db.execute(
        select(ProjectLayerAssignment.layer_id)
        .where(ProjectLayerAssignment.project_id == project_id)
    )
    assigned_ids = [row[0] for row in assigned_result.all()]

    # Query: assigned globals + project-specific
    query = select(VectorLayer).where(
        or_(
            VectorLayer.id.in_(assigned_ids) if assigned_ids else False,
            and_(VectorLayer.project_id == project_id, VectorLayer.is_global == False),
        )
    ).order_by(VectorLayer.name)

    result = await db.execute(query)
    layers = result.scalars().all()

    # Pre-fetch project names for project_name mapping
    proj_res = await db.execute(select(SurveyProject.id, SurveyProject.name))
    proj_map = {pid: pname for pid, pname in proj_res.all()}

    responses = []
    for layer in layers:
        count_result = await db.execute(
            select(func.count(VectorFeature.id)).where(VectorFeature.layer_id == layer.id)
        )
        count = count_result.scalar() or 0
        fields = await get_or_detect_layer_fields(db, layer)
        responses.append(LayerResponse(
            id=layer.id, name=layer.name, description=layer.description,
            geometry_type=layer.geometry_type.value, style=layer.style,
            editable_by_collectors=layer.editable_by_collectors,
            allow_snapping=layer.allow_snapping,
            is_global=layer.is_global, project_id=layer.project_id,
            project_name=proj_map.get(layer.project_id) if layer.project_id else None,
            feature_count=count, fields_config=fields,
            creation_geometry_types=layer.creation_geometry_types if (layer.creation_geometry_types and len(layer.creation_geometry_types) > 0) else [layer.geometry_type.value],
            geometry_fields_config=layer.geometry_fields_config or {},
            created_at=layer.created_at,
        ))
    return responses


@router.post("/projects/{project_id}/layers", response_model=LayerResponse)
async def create_project_layer(
    project_id: int,
    body: LayerCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Create a project-specific vector layer (GisAdmin only)."""
    proj = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    if not proj.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    layer = VectorLayer(
        name=body.name,
        description=body.description,
        geometry_type=GeometryType(body.geometry_type),
        style=body.style,
        editable_by_collectors=body.editable_by_collectors,
        allow_snapping=body.allow_snapping,
        fields_config=body.fields_config or [],
        creation_geometry_types=body.creation_geometry_types or [body.geometry_type],
        geometry_fields_config=body.geometry_fields_config or {},
        is_global=False,
        project_id=project_id,
        created_by=admin.id,
    )
    db.add(layer)
    await db.flush()

    return LayerResponse(
        id=layer.id, name=layer.name, description=layer.description,
        geometry_type=layer.geometry_type.value, style=layer.style,
        editable_by_collectors=layer.editable_by_collectors,
        allow_snapping=layer.allow_snapping,
        is_global=False, project_id=project_id,
        feature_count=0, fields_config=layer.fields_config or [],
        creation_geometry_types=layer.creation_geometry_types or [layer.geometry_type.value],
        geometry_fields_config=layer.geometry_fields_config or {},
        created_at=layer.created_at,
    )


@router.put("/layers/{layer_id}", response_model=LayerResponse)
async def update_layer(
    layer_id: int,
    body: LayerUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Update a vector layer (GisAdmin only)."""
    result = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(layer, key, value)

    count_result = await db.execute(
        select(func.count(VectorFeature.id)).where(VectorFeature.layer_id == layer.id)
    )
    count = count_result.scalar() or 0
    fields = await get_or_detect_layer_fields(db, layer)

    return LayerResponse(
        id=layer.id, name=layer.name, description=layer.description,
        geometry_type=layer.geometry_type.value, style=layer.style,
        editable_by_collectors=layer.editable_by_collectors,
        allow_snapping=layer.allow_snapping,
        is_global=layer.is_global, project_id=layer.project_id,
        feature_count=count, fields_config=fields,
        creation_geometry_types=layer.creation_geometry_types if (layer.creation_geometry_types and len(layer.creation_geometry_types) > 0) else [layer.geometry_type.value],
        geometry_fields_config=layer.geometry_fields_config or {},
        created_at=layer.created_at,
    )


@router.delete("/layers/{layer_id}", response_model=MessageResponse)
async def delete_layer(
    layer_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Delete a vector layer and all its features (GisAdmin only)."""
    result = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    lid = layer.id
    name = layer.name
    await db.delete(layer)
    await invalidate_layer_cache(lid)
    return MessageResponse(message=f"Layer '{name}' deleted")


@router.get("/layers/{layer_id}/fields")
async def get_layer_fields(
    layer_id: int,
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get vector layer field schema, creation geometry types, and geometry-specific field configs."""
    result = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")
    fields = await get_or_detect_layer_fields(db, layer)
    return {
        "layer_id": layer.id,
        "fields": fields,
        "geometry_type": layer.geometry_type.value if layer.geometry_type else "GEOMETRY",
        "creation_geometry_types": layer.creation_geometry_types if (layer.creation_geometry_types and len(layer.creation_geometry_types) > 0) else [layer.geometry_type.value],
        "geometry_fields_config": layer.geometry_fields_config or {},
    }


@router.put("/layers/{layer_id}/fields")
async def update_layer_fields(
    layer_id: int,
    body: Any = Body(...),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Configure vector layer fields, unique identifiers, creation geometry types, and compulsory flags (GisAdmin only)."""
    result = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    creation_geom_types = None
    geom_fields_cfg = None

    if isinstance(body, list):
        fields = body
    elif isinstance(body, dict):
        fields = body.get("fields", [])
        creation_geom_types = body.get("creation_geometry_types")
        geom_fields_cfg = body.get("geometry_fields_config")
    else:
        fields = []

    layer.fields_config = fields
    if creation_geom_types is not None:
        layer.creation_geometry_types = creation_geom_types
    if geom_fields_cfg is not None:
        layer.geometry_fields_config = geom_fields_cfg

    client_ip = request.client.host if request and request.client else None
    await log_audit(
        db, admin.id, "UPDATE_LAYER_FIELDS", "VectorLayer", layer.id,
        details={
            "fields_count": len(fields),
            "creation_geometry_types": layer.creation_geometry_types,
            "has_geom_fields_config": bool(layer.geometry_fields_config),
        },
        ip=client_ip,
    )

    await db.commit()
    await db.refresh(layer)
    return {
        "layer_id": layer.id,
        "fields": layer.fields_config,
        "creation_geometry_types": layer.creation_geometry_types,
        "geometry_fields_config": layer.geometry_fields_config,
    }


@router.get("/layers/{layer_id}/next-id")
async def get_next_feature_id(
    layer_id: int,
    field_name: Optional[str] = Query(None, description="Specific field name configured for unique ID"),
    geom_type: Optional[str] = Query(None, description="Target geometry type being created"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate the next sequential unique identifier for a vector layer based on admin-defined sequence rule.
    """
    result = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    fields = None
    if geom_type and layer.geometry_fields_config and isinstance(layer.geometry_fields_config, dict):
        g_fields = layer.geometry_fields_config.get(geom_type.upper()) or layer.geometry_fields_config.get(geom_type)
        if isinstance(g_fields, list) and len(g_fields) > 0:
            fields = g_fields

    if not fields:
        fields = await get_or_detect_layer_fields(db, layer)

    target_field = None
    if field_name:
        target_field = next((f for f in fields if f.get("name") == field_name), None)
    else:
        target_field = next((f for f in fields if f.get("is_unique")), None)

    if not target_field:
        return {"field_name": None, "id_mode": "manual", "next_id": None}

    f_name = target_field.get("name")
    id_mode = target_field.get("id_mode", "manual")
    if id_mode != "auto":
        return {"field_name": f_name, "id_mode": "manual", "next_id": None}

    prefix = str(target_field.get("id_prefix") or "").strip()
    start_seq = target_field.get("id_sequence") or 1
    try:
        start_seq = int(start_seq)
    except (ValueError, TypeError):
        start_seq = 1

    # Query existing features to detect max sequence
    feat_rows = await db.execute(
        select(VectorFeature.properties)
        .where(VectorFeature.layer_id == layer_id)
    )
    max_num = start_seq - 1

    escaped_prefix = re.escape(prefix) if prefix else ""
    pattern = re.compile(rf"^{escaped_prefix}(\d+)$", re.IGNORECASE) if prefix else re.compile(r"(\d+)$")

    for (props,) in feat_rows.all():
        if isinstance(props, dict) and f_name in props:
            val = str(props[f_name]).strip()
            match = pattern.search(val)
            if match:
                try:
                    num = int(match.group(1))
                    if num > max_num:
                        max_num = num
                except ValueError:
                    pass

    next_seq = max(max_num + 1, start_seq)
    seq_str = f"{next_seq:03d}" if next_seq < 1000 else str(next_seq)
    next_id = f"{prefix}{seq_str}" if prefix else str(next_seq)

    return {
        "field_name": f_name,
        "id_mode": "auto",
        "prefix": prefix,
        "sequence": next_seq,
        "next_id": next_id,
    }


# ============================================================
# VECTOR LAYER DOWNLOAD
# ============================================================

@router.get("/layers/{layer_id}/download")
async def download_vector_layer(
    layer_id: int,
    format: str = Query("geojson", pattern=r"^(geojson|json|shapefile|shp|kml|csv)$"),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.Validator, UserRole.DataCollector)),
):
    """
    Download vector layer in GeoJSON, ESRI Shapefile (.zip), KML, or CSV format.
    Available to GisAdmin, Validator, and assigned DataCollectors.
    """
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. You do not have access to this layer.",
        )

    result = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id))
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    creator = aliased(User)
    updater = aliased(User)

    feat_res = await db.execute(
        select(
            VectorFeature.id,
            VectorFeature.properties,
            VectorFeature.created_by,
            VectorFeature.updated_by,
            VectorFeature.version,
            VectorFeature.created_at,
            VectorFeature.updated_at,
            creator.username.label("creator_username"),
            creator.full_name.label("creator_full_name"),
            updater.username.label("updater_username"),
            updater.full_name.label("updater_full_name"),
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).outerjoin(creator, VectorFeature.created_by == creator.id)
         .outerjoin(updater, VectorFeature.updated_by == updater.id)
         .where(VectorFeature.layer_id == layer_id)
    )
    rows = feat_res.all()

    features_list = []
    for r in rows:
        geom = None
        if r.geojson:
            try:
                geom = json.loads(r.geojson)
            except Exception:
                geom = None
        if geom is not None:
            clean_props = {}
            for k, v in (r.properties or {}).items():
                if str(k).startswith("__"):
                    continue
                # Normalize integer numeric values
                if v is not None and isinstance(v, (int, str)) and str(v).isdigit() and not (isinstance(v, str) and str(v).startswith("0") and len(str(v)) > 1):
                    try:
                        v = int(v)
                    except Exception:
                        pass
                clean_props[k] = v

            edit_type = "update" if (r.version and r.version > 1) or r.updated_by else "create"
            if "_id" not in clean_props:
                clean_props["_id"] = r.id
            clean_props["_version"] = r.version
            clean_props["_created_by"] = r.created_by
            clean_props["_created_by_username"] = r.creator_username
            clean_props["_created_by_name"] = r.creator_full_name
            clean_props["_updated_by"] = r.updated_by
            clean_props["_updated_by_username"] = r.updater_username
            clean_props["_updated_by_name"] = r.updater_full_name
            clean_props["_edit_type"] = edit_type
            if r.created_at:
                clean_props["_created_at"] = r.created_at.isoformat()
            if r.updated_at:
                clean_props["_updated_at"] = r.updated_at.isoformat()

            features_list.append({
                "type": "Feature",
                "id": r.id,
                "geometry": geom,
                "properties": clean_props,
            })

    safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', layer.name).strip('_') or f"layer_{layer.id}"
    fmt = format.lower()

    client_ip = request.client.host if request and request.client else None
    await log_audit(
        db, current_user.id, "DOWNLOAD_VECTOR_LAYER", "VectorLayer", layer_id,
        details={
            "layer_name": layer.name,
            "format": fmt,
            "feature_count": len(features_list),
        },
        ip=client_ip,
    )

    if fmt in ("shapefile", "shp"):
        zip_bytes = export_features_to_shapefile_zip(
            features_list,
            layer.name,
            layer.geometry_type.value if layer.geometry_type else "Geometry",
        )
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}_shapefile.zip"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    elif fmt == "kml":
        kml_bytes = export_features_to_kml(features_list, layer.name)
        return Response(
            content=kml_bytes,
            media_type="application/vnd.google-earth.kml+xml; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}.kml"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    elif fmt == "csv":
        csv_bytes = export_features_to_csv(features_list, layer.name)
        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}.csv"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    else:
        geojson_bytes = export_features_to_geojson(features_list, layer.name)
        return Response(
            content=geojson_bytes,
            media_type="application/geo+json; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_name}.geojson"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )


# ============================================================
# VECTOR LAYER UPLOAD (GeoJSON)
# ============================================================

@router.post("/layers/upload", response_model=LayerResponse)
async def upload_vector_layer(
    name: str = Form(...),
    is_global: bool = Form(True),
    project_id: Optional[int] = Form(None),
    editable_by_collectors: bool = Form(True),
    allow_snapping: bool = Form(True),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """
    Upload a GeoJSON file to create a vector layer with features.
    GisAdmin only. Supports .geojson files.
    """
    if not file.filename.lower().endswith(('.geojson', '.json')):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Only .geojson files are supported for direct upload")

    content = await file.read()
    try:
        geojson_data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON in uploaded file")

    if geojson_data.get("type") != "FeatureCollection":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="GeoJSON must be a FeatureCollection")

    features = geojson_data.get("features", [])
    if not features:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No features in the GeoJSON file")

    # Verify target project if project-scoped
    if not is_global and project_id:
        proj_res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
        if not proj_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target project not found")

    # 1. Detect Source CRS
    source_crs = detect_crs_from_geojson_or_coords(geojson_data)
    target_crs = pyproj.CRS.from_epsg(4326)

    # 2. Initial geometry type detection
    detected_geom_type = GeometryType.GEOMETRY
    for f in features:
        raw_g = f.get("geometry")
        if raw_g and raw_g.get("type"):
            try:
                detected_geom_type = GeometryType(raw_g.get("type").upper())
                break
            except ValueError:
                pass

    # Detect fields from uploaded GeoJSON features
    fields_dict = {}
    for feat in features:
        props = feat.get("properties") or {}
        if isinstance(props, dict):
            for k, v in props.items():
                if str(k).startswith("_") or str(k).startswith("__"):
                    continue
                if k not in fields_dict:
                    ftype = "text"
                    if isinstance(v, bool):
                        ftype = "checkbox"
                    elif isinstance(v, (int, float)):
                        ftype = "number"
                    fields_dict[k] = {
                        "name": k,
                        "label": k.replace("_", " ").title(),
                        "type": ftype,
                        "required": False,
                    }
                elif fields_dict[k]["type"] == "text" and isinstance(v, (int, float)):
                    fields_dict[k]["type"] = "number"

    # 3. Create Layer entry
    layer = VectorLayer(
        name=name.strip(),
        geometry_type=detected_geom_type,
        is_global=is_global,
        project_id=project_id if not is_global else None,
        editable_by_collectors=editable_by_collectors,
        allow_snapping=allow_snapping,
        fields_config=list(fields_dict.values()),
        source_filename=file.filename,
        created_by=admin.id,
    )
    db.add(layer)
    await db.flush()

    # 4. Sanitize, strip Z/M dimensions, reproject, and insert features in chunks
    valid_count = 0
    batch_features = []
    BATCH_SIZE = 500

    for feat in features:
        raw_geom = feat.get("geometry")
        if not raw_geom:
            continue

        clean_geom = sanitize_and_reproject_geometry(raw_geom, source_crs, target_crs)
        if not clean_geom:
            continue

        try:
            geom_json = json.dumps(clean_geom)
            props = feat.get("properties") or {}
            if not isinstance(props, dict):
                props = {"value": str(props)}

            vector_feature = VectorFeature(
                layer_id=layer.id,
                geom=func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(geom_json)), 4326),
                properties=props,
                created_by=admin.id,
            )
            batch_features.append(vector_feature)
            valid_count += 1

            if len(batch_features) >= BATCH_SIZE:
                db.add_all(batch_features)
                await db.flush()
                batch_features = []
        except Exception:
            continue

    if batch_features:
        db.add_all(batch_features)
        await db.flush()

    await db.commit()
    await invalidate_layer_cache(layer.id)

    return LayerResponse(
        id=layer.id, name=layer.name, description=layer.description,
        geometry_type=layer.geometry_type.value, style=layer.style,
        editable_by_collectors=layer.editable_by_collectors,
        allow_snapping=layer.allow_snapping,
        is_global=layer.is_global, project_id=layer.project_id,
        feature_count=valid_count, fields_config=layer.fields_config or [],
        created_at=layer.created_at,
    )
