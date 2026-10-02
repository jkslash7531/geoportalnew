"""
KMC-GIS-SERVER — Dynamic Vector Tile (MVT) Router
High-performance PostGIS on-the-fly MVT generation (ST_AsMVT + ST_AsMVTGeom)
with Role-Based Access Control and Field-Level Security enforcement.
"""

import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.database import get_db
from app.models import VectorLayer, User, UserRole
from app.auth import get_optional_current_user, get_redis
from app.routers.geo_access import require_geo_entry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mvt", tags=["Dynamic Vector Tiles"])


def get_forbidden_fields_for_role(layer: VectorLayer, role: str) -> List[str]:
    """
    Inspect layer.field_permissions to see which property keys
    are restricted / forbidden for the user's role.
    Example field_permissions: {"tax_id": ["GisAdmin", "MunicipalUser"], "owner_phone": ["GisAdmin"]}
    If user role is BasicViewer, tax_id and owner_phone are forbidden.
    """
    if role in ("SuperAdmin", "GisAdmin"):
        return []

    field_perms = layer.field_permissions or {}
    forbidden = []
    for field_name, allowed_roles in field_perms.items():
        if isinstance(allowed_roles, list):
            if role not in allowed_roles:
                forbidden.append(field_name)
    return forbidden


def is_layer_viewable(layer: VectorLayer, user: Optional[User]) -> bool:
    """Check if the user's role can view this layer in GeoPortal/MVT."""
    user_role = user.role.value if user else "BasicViewer"
    if user_role in ("SuperAdmin", "GisAdmin"):
        return True

    # If layer is not published in GeoPortal, only admins can view via MVT
    if not layer.published_in_geoportal:
        return False

    role_perms = layer.role_permissions or {}
    level = role_perms.get("access_level")
    if level == "admin_only":
        return False
    if level == "validator":
        return user_role in ("Validator", "MunicipalUser", "SuperAdmin", "GisAdmin")
    if level == "public":
        return True

    role_cfg = role_perms.get(user_role, {})
    if isinstance(role_cfg, dict) and "can_view" in role_cfg:
        return bool(role_cfg["can_view"])

    # Default: published layers are viewable by all
    return True


@router.get("/{layer_id}/{z}/{x}/{y}.pbf")
async def get_vector_tile(
    layer_id: int,
    z: int,
    x: int,
    y: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
    _geo_entry: bool = Depends(require_geo_entry),
):
    """
    Serve dynamic Mapbox Vector Tile (.pbf) for any vector layer directly from PostGIS.
    Enforces field-level security by pruning forbidden properties in SQL before serialization.
    """
    user_role = user.role.value if user else "BasicViewer"
    cache_key = f"mvt_tile:{layer_id}:{z}:{x}:{y}:{user_role}"

    # 1. Fast Redis Cache Check (Sub-millisecond response)
    try:
        redis_client = await get_redis(decode_responses=False)
        cached = await redis_client.get(cache_key)
        if cached is not None:
            return Response(
                content=cached,
                media_type="application/vnd.mapbox-vector-tile",
                headers={
                    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
                    "Access-Control-Allow-Origin": "*",
                    "X-Tile-Cache": "HIT",
                }
            )
    except Exception:
        pass

    # 2. Fetch layer
    res = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id, VectorLayer.deleted_at.is_(None)))
    layer = res.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    if not is_layer_viewable(layer, user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied for this layer")

    forbidden_fields = get_forbidden_fields_for_role(layer, user_role)
    layer_name = f"layer_{layer.id}"

    # 3. Query PostGIS with GiST Spatial Index (ST_Intersects on 4326 directly)
    # If forbidden fields exist, strip them via properties - CAST(:forbidden_keys AS text[])
    try:
        if forbidden_fields:
            query = text("""
                WITH tile_bounds AS (
                    SELECT ST_TileEnvelope(:z, :x, :y) AS geom_3857,
                           ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326) AS geom_4326
                ),
                mvt_raw AS (
                    SELECT
                        vf.id,
                        ST_AsMVTGeom(
                            ST_Transform(vf.geom, 3857),
                            tb.geom_3857,
                            4096,
                            256,
                            true
                        ) AS geom,
                        (vf.properties - CAST(:forbidden_keys AS text[])) AS properties
                    FROM vector_features vf, tile_bounds tb
                    WHERE vf.layer_id = :layer_id
                      AND ST_Intersects(vf.geom, tb.geom_4326)
                ),
                mvt_features AS (
                    SELECT * FROM mvt_raw WHERE geom IS NOT NULL
                )
                SELECT ST_AsMVT(mvt_features.*, :layer_name, 4096, 'geom') AS tile
                FROM mvt_features;
            """)
            result = await db.execute(query, {
                "z": z, "x": x, "y": y,
                "layer_id": layer_id,
                "layer_name": layer_name,
                "forbidden_keys": forbidden_fields
            })
        else:
            query = text("""
                WITH tile_bounds AS (
                    SELECT ST_TileEnvelope(:z, :x, :y) AS geom_3857,
                           ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326) AS geom_4326
                ),
                mvt_raw AS (
                    SELECT
                        vf.id,
                        ST_AsMVTGeom(
                            ST_Transform(vf.geom, 3857),
                            tb.geom_3857,
                            4096,
                            256,
                            true
                        ) AS geom,
                        vf.properties
                    FROM vector_features vf, tile_bounds tb
                    WHERE vf.layer_id = :layer_id
                      AND ST_Intersects(vf.geom, tb.geom_4326)
                ),
                mvt_features AS (
                    SELECT * FROM mvt_raw WHERE geom IS NOT NULL
                )
                SELECT ST_AsMVT(mvt_features.*, :layer_name, 4096, 'geom') AS tile
                FROM mvt_features;
            """)
            result = await db.execute(query, {
                "z": z, "x": x, "y": y,
                "layer_id": layer_id,
                "layer_name": layer_name,
            })

        row = result.fetchone()
        tile_bytes = bytes(row[0]) if (row and row[0] is not None) else b""

        # Cache in Redis (1 hour TTL)
        try:
            redis_client = await get_redis(decode_responses=False)
            await redis_client.set(cache_key, tile_bytes, ex=3600)
        except Exception:
            pass

        return Response(
            content=tile_bytes,
            media_type="application/vnd.mapbox-vector-tile",
            headers={
                "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
                "Access-Control-Allow-Origin": "*",
                "X-Tile-Cache": "MISS",
            }
        )
    except Exception as e:
        logger.exception(f"MVT generation failed for layer {layer_id} at z={z}, x={x}, y={y}: {e}")
        # Fallback empty tile
        return Response(
            content=b"",
            media_type="application/vnd.mapbox-vector-tile",
            headers={"Cache-Control": "no-cache"}
        )


@router.get("/{layer_id}/tilejson.json")
async def get_tilejson(
    layer_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
    _geo_entry: bool = Depends(require_geo_entry),
):
    """Return TileJSON 2.2.0 metadata for vector tile client integration."""
    res = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id, VectorLayer.deleted_at.is_(None)))
    layer = res.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    base_url = str(request.base_url).rstrip("/")
    tile_url = f"{base_url}/api/mvt/{layer.id}/{{z}}/{{x}}/{{y}}.pbf"

    return {
        "tilejson": "2.2.0",
        "name": layer.name,
        "description": layer.description or "",
        "version": "1.0.0",
        "scheme": "xyz",
        "tiles": [tile_url],
        "minzoom": 0,
        "maxzoom": 22,
        "bounds": [-180, -85, 180, 85],
        "vector_layers": [
            {
                "id": f"layer_{layer.id}",
                "description": layer.description or "",
                "fields": {fc.get("name", "prop"): "String" for fc in (layer.fields_config or [])},
            }
        ]
    }
