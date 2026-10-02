"""
KMC-GIS-SERVER — GeoPortal Management Router
Layer catalog with category groupings, role-based visibility, field-level security,
and administrative configuration for GeoPortal dashboards and presentation.
"""

import json
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, text

from app.database import get_db
from app.models import VectorLayer, VectorFeature, MBTilesPackage, User, UserRole
from app.schemas import (
    LayerGeoPortalConfigUpdate, MBTilesGeoPortalConfigUpdate, MessageResponse
)
from app.auth import get_current_user, get_optional_current_user, require_role
from app.helpers import log_audit
from app.routers.geo_access import require_geo_entry

router = APIRouter(prefix="/api/geoportal", tags=["GeoPortal"])


def is_layer_accessible(role_perms: Optional[Dict[str, Any]], user_role: str, is_admin: bool) -> bool:
    """
    Check if a vector or raster layer is accessible to the user_role.
    Supports:
      - access_level: 'public' (any viewer, no login needed)
      - access_level: 'validator' (only logged-in Validators & Admins)
      - access_level: 'admin_only' (only GIS Admins)
      - granular role_permissions[user_role]['can_view']
    """
    if is_admin:
        return True
    perms = role_perms or {}
    level = perms.get("access_level")
    if level == "admin_only":
        return False
    if level == "validator":
        return user_role in ("Validator", "MunicipalUser", "SuperAdmin", "GisAdmin")
    if level == "public":
        return True

    # Per-role explicit config
    role_cfg = perms.get(user_role, {})
    if isinstance(role_cfg, dict) and role_cfg.get("can_view") is False:
        return False
    return True


def filter_fields_for_role(fields_config: Optional[List[Dict[str, Any]]], field_permissions: Optional[Dict[str, Any]], role: str) -> List[Dict[str, Any]]:
    """Filter fields_config based on field-level security for the given role."""
    if not fields_config:
        return []
    if role in ("SuperAdmin", "GisAdmin"):
        return fields_config

    perms = field_permissions or {}
    allowed = []
    for f in fields_config:
        f_name = f.get("name")
        if not f_name or f_name.startswith("_"):
            continue
        if f_name in perms:
            allowed_roles = perms[f_name]
            if isinstance(allowed_roles, list) and role in allowed_roles:
                allowed.append(f)
        else:
            # If not explicitly restricted, field is public
            allowed.append(f)
    return allowed


@router.get("/catalog")
async def get_geoportal_catalog(
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
    _geo_entry: bool = Depends(require_geo_entry),
):
    """
    Get the GeoPortal Layer Catalog.
    Returns categorized vector layers and raster MBTiles packages
    filtered by the user's role permissions and field-level security.
    """
    user_role = user.role.value if user else "BasicViewer"
    is_admin = user_role in ("SuperAdmin", "GisAdmin")

    # 1. Fetch Vector Layers
    vl_query = select(VectorLayer).order_by(VectorLayer.category, VectorLayer.display_order, VectorLayer.name)
    if not is_admin:
        vl_query = vl_query.where(VectorLayer.published_in_geoportal == True)
    
    vl_res = await db.execute(vl_query)
    all_layers = vl_res.scalars().all()

    # Get feature counts efficiently
    counts_query = select(VectorFeature.layer_id, func.count(VectorFeature.id)).group_by(VectorFeature.layer_id)
    counts_res = await db.execute(counts_query)
    counts_map = dict(counts_res.all())

    # Get layer bounds efficiently
    bounds_query = select(
        VectorFeature.layer_id,
        func.ST_XMin(func.ST_Extent(VectorFeature.geom)),
        func.ST_YMin(func.ST_Extent(VectorFeature.geom)),
        func.ST_XMax(func.ST_Extent(VectorFeature.geom)),
        func.ST_YMax(func.ST_Extent(VectorFeature.geom)),
    ).group_by(VectorFeature.layer_id)
    bounds_res = await db.execute(bounds_query)
    bounds_map = {}
    for r in bounds_res.all():
        if r[1] is not None and r[2] is not None and r[3] is not None and r[4] is not None:
            bounds_map[r[0]] = [float(r[1]), float(r[2]), float(r[3]), float(r[4])]

    # 2. Fetch Raster MBTiles
    mbt_query = select(MBTilesPackage).where(MBTilesPackage.deleted_at.is_(None)).order_by(MBTilesPackage.category, MBTilesPackage.display_order, MBTilesPackage.name)
    if not is_admin:
        mbt_query = mbt_query.where(MBTilesPackage.published_in_geoportal == True)
    
    mbt_res = await db.execute(mbt_query)
    all_mbtiles = mbt_res.scalars().all()

    # 3. Filter vector layers by role permissions & access_level
    filtered_vectors = []
    for lyr in all_layers:
        role_perms = lyr.role_permissions or {}
        if not is_layer_accessible(role_perms, user_role, is_admin):
            continue

        clean_fields = filter_fields_for_role(lyr.fields_config, lyr.field_permissions, user_role)
        role_cfg = role_perms.get(user_role, {}) if isinstance(role_perms.get(user_role), dict) else {}

        filtered_vectors.append({
            "id": lyr.id,
            "type": "vector",
            "name": lyr.name,
            "description": lyr.description,
            "category": lyr.category or "General",
            "geometry_type": lyr.geometry_type.value if hasattr(lyr.geometry_type, "value") else str(lyr.geometry_type),
            "style": lyr.style,
            "opacity": lyr.opacity if lyr.opacity is not None else 1.0,
            "published": lyr.published_in_geoportal,
            "default_visible": lyr.default_visible_in_geoportal,
            "display_order": lyr.display_order,
            "feature_count": counts_map.get(lyr.id, 0),
            "bounds": bounds_map.get(lyr.id),
            "fields_config": clean_fields,
            "all_fields_config": lyr.fields_config if is_admin else None,
            "role_permissions": lyr.role_permissions if is_admin else None,
            "field_permissions": lyr.field_permissions if is_admin else None,
            "access_level": role_perms.get("access_level", "public"),
            "tile_url": f"/api/mvt/{lyr.id}/{{z}}/{{x}}/{{y}}.pbf",
            "tilejson_url": f"/api/mvt/{lyr.id}/tilejson.json",
            "metadata_info": lyr.metadata_info or {},
            "dashboard_config": lyr.dashboard_config or {},
            "can_download": role_cfg.get("can_download", True) if not is_admin else True,
            "can_stats": role_cfg.get("can_stats", True) if not is_admin else True,
        })

    # 4. Filter rasters by role permissions & access_level
    filtered_rasters = []
    for pkg in all_mbtiles:
        role_perms = pkg.role_permissions or {}
        if not is_layer_accessible(role_perms, user_role, is_admin):
            continue

        filtered_rasters.append({
            "id": pkg.id,
            "type": "raster",
            "name": pkg.name,
            "description": pkg.description,
            "category": pkg.category or "Base Maps",
            "bounds": pkg.bounds,
            "center": pkg.center,
            "min_zoom": pkg.min_zoom,
            "max_zoom": pkg.max_zoom,
            "published": pkg.published_in_geoportal,
            "default_visible": pkg.default_visible,
            "display_order": pkg.display_order,
            "role_permissions": pkg.role_permissions if is_admin else None,
            "access_level": role_perms.get("access_level", "public"),
            "tile_url": f"/api/tiles/{pkg.id}/{{z}}/{{x}}/{{y}}.png",
        })

    # 5. Group into organized categories
    categories_dict = {}
    
    # Pre-defined known categories order
    category_order = [
        "Boundaries & Administrative",
        "Roads & Transport",
        "Buildings & Infrastructure",
        "Utilities & Drainage",
        "Public Facilities & Schools",
        "Environment & Greenery",
        "Base Maps",
        "General",
    ]

    all_items = filtered_vectors + filtered_rasters
    for item in all_items:
        cat = item["category"]
        if cat not in categories_dict:
            categories_dict[cat] = {
                "name": cat,
                "vector_count": 0,
                "raster_count": 0,
                "layers": [],
            }
        if item["type"] == "vector":
            categories_dict[cat]["vector_count"] += 1
        else:
            categories_dict[cat]["raster_count"] += 1
        categories_dict[cat]["layers"].append(item)

    # Sort categories
    sorted_categories = []
    for cat_name in category_order:
        if cat_name in categories_dict:
            sorted_categories.append(categories_dict.pop(cat_name))
    for rem_cat in sorted(categories_dict.keys()):
        sorted_categories.append(categories_dict[rem_cat])

    return {
        "categories": sorted_categories,
        "total_vector_layers": len(filtered_vectors),
        "total_raster_packages": len(filtered_rasters),
        "user_role": user_role,
        "is_admin": is_admin,
    }


@router.get("/layers/{layer_id}/features/{feature_id}")
async def get_feature_detail(
    layer_id: int,
    feature_id: int,
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
    _geo_entry: bool = Depends(require_geo_entry),
):
    """
    Get full feature detail with field-level permissions strictly applied.
    """
    res_l = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id, VectorLayer.deleted_at.is_(None)))
    layer = res_l.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    res_f = await db.execute(
        select(VectorFeature, func.ST_AsGeoJSON(VectorFeature.geom)).where(
            and_(VectorFeature.layer_id == layer_id, VectorFeature.id == feature_id)
        )
    )
    row = res_f.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    feature, geom_json = row
    user_role = user.role.value if user else "BasicViewer"

    # Field-level filtering
    props = dict(feature.properties or {})
    if user_role not in ("SuperAdmin", "GisAdmin"):
        field_perms = layer.field_permissions or {}
        for f_name, allowed_roles in field_perms.items():
            if isinstance(allowed_roles, list) and user_role not in allowed_roles:
                props.pop(f_name, None)

    return {
        "id": feature.id,
        "layer_id": feature.layer_id,
        "geometry": json.loads(geom_json) if geom_json else None,
        "properties": props,
        "created_at": feature.created_at,
        "updated_at": feature.updated_at,
    }


@router.put("/layers/{layer_id}/config")
async def update_layer_geoportal_config(
    layer_id: int,
    body: LayerGeoPortalConfigUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin, UserRole.SuperAdmin)),
):
    """
    Configure layer presentation in GeoPortal (GisAdmin & SuperAdmin only).
    Configures category, publication, default visibility, styles,
    role-based layer permissions, and field-level permissions.
    """
    res = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id, VectorLayer.deleted_at.is_(None)))
    layer = res.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    if body.category is not None:
        layer.category = body.category
    if body.display_order is not None:
        layer.display_order = body.display_order
    if body.published_in_geoportal is not None:
        layer.published_in_geoportal = body.published_in_geoportal
    if body.default_visible_in_geoportal is not None:
        layer.default_visible_in_geoportal = body.default_visible_in_geoportal
    if body.opacity is not None:
        layer.opacity = body.opacity
    if body.style is not None:
        layer.style = body.style
    if body.role_permissions is not None:
        layer.role_permissions = body.role_permissions
    if body.field_permissions is not None:
        layer.field_permissions = body.field_permissions
    if body.dashboard_config is not None:
        layer.dashboard_config = body.dashboard_config
    if body.metadata_info is not None:
        layer.metadata_info = body.metadata_info

    await db.commit()
    await log_audit(db, admin.id, "UPDATE_GEOPORTAL_LAYER_CONFIG", "VectorLayer", layer.id, details=body.model_dump(exclude_none=True))

    return {
        "status": "success",
        "message": f"Layer '{layer.name}' GeoPortal configuration updated successfully",
        "layer_id": layer.id,
    }


@router.put("/mbtiles/{mbtiles_id}/config")
async def update_mbtiles_geoportal_config(
    mbtiles_id: int,
    body: MBTilesGeoPortalConfigUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin, UserRole.SuperAdmin)),
):
    """Configure raster package presentation in GeoPortal (GisAdmin & SuperAdmin only)."""
    res = await db.execute(select(MBTilesPackage).where(MBTilesPackage.id == mbtiles_id, MBTilesPackage.deleted_at.is_(None)))
    pkg = res.scalar_one_or_none()
    if not pkg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MBTiles package not found")

    if body.category is not None:
        pkg.category = body.category
    if body.display_order is not None:
        pkg.display_order = body.display_order
    if body.published_in_geoportal is not None:
        pkg.published_in_geoportal = body.published_in_geoportal
    if body.default_visible is not None:
        pkg.default_visible = body.default_visible
    if body.role_permissions is not None:
        pkg.role_permissions = body.role_permissions

    await db.commit()
    await log_audit(db, admin.id, "UPDATE_GEOPORTAL_MBTILES_CONFIG", "MBTilesPackage", pkg.id, details=body.model_dump(exclude_none=True))

    return {
        "status": "success",
        "message": f"MBTiles package '{pkg.name}' GeoPortal configuration updated",
        "mbtiles_id": pkg.id,
    }


@router.post("/export/{layer_id}")
async def export_geoportal_layer(
    layer_id: int,
    format: str = Query("geojson", pattern=r"^(geojson|csv)$"),
    bbox: Optional[str] = Query(None, description="west,south,east,north"),
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
    _geo_entry: bool = Depends(require_geo_entry),
):
    """Export layer features respecting role permissions and field-level security."""
    res_l = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id, VectorLayer.deleted_at.is_(None)))
    layer = res_l.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    user_role = user.role.value if user else "BasicViewer"
    role_perms = layer.role_permissions or {}
    role_cfg = role_perms.get(user_role, {})
    if user_role not in ("SuperAdmin", "GisAdmin") and role_cfg.get("can_download") is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Export not permitted for this role")

    query = select(VectorFeature.id, func.ST_AsGeoJSON(VectorFeature.geom), VectorFeature.properties).where(
        VectorFeature.layer_id == layer_id
    )

    if bbox:
        try:
            w, s, e, n = [float(x.strip()) for x in bbox.split(",")]
            bbox_geom = func.ST_MakeEnvelope(w, s, e, n, 4326)
            query = query.where(func.ST_Intersects(VectorFeature.geom, bbox_geom))
        except Exception:
            pass

    features_res = await db.execute(query)
    rows = features_res.all()

    # Apply field security
    field_perms = layer.field_permissions or {}
    forbidden = []
    if user_role not in ("SuperAdmin", "GisAdmin"):
        for f_name, allowed_roles in field_perms.items():
            if isinstance(allowed_roles, list) and user_role not in allowed_roles:
                forbidden.append(f_name)

    if format == "geojson":
        geojson_features = []
        for fid, geom_str, props in rows:
            clean_props = dict(props or {})
            for forb in forbidden:
                clean_props.pop(forb, None)
            geojson_features.append({
                "type": "Feature",
                "id": fid,
                "geometry": json.loads(geom_str) if geom_str else None,
                "properties": clean_props,
            })
        return {
            "type": "FeatureCollection",
            "name": layer.name,
            "features": geojson_features,
        }
    else:
        # CSV format
        import csv
        import io
        output = io.StringIO()
        if not rows:
            return Response(content="", media_type="text/csv")
        
        # Collect header
        headers = ["id"]
        sample_props = dict(rows[0][2] or {})
        for forb in forbidden:
            sample_props.pop(forb, None)
        headers.extend(sample_props.keys())

        writer = csv.DictWriter(output, fieldnames=headers)
        writer.writeheader()
        for fid, _, props in rows:
            row_dict = {"id": fid}
            cp = dict(props or {})
            for k in headers[1:]:
                row_dict[k] = cp.get(k, "")
            writer.writerow(row_dict)

        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={layer.name}.csv"}
        )


@router.get("/landing-stats")
async def get_landing_stats(db: AsyncSession = Depends(get_db)):
    """
    Public lightweight statistics for the GeoPortal landing page.
    Metadata of the entire database is loaded dynamically — cached 5 minutes.
    Deliberately public: the Geo World entry gate (not this endpoint) enforces
    the Nepal-only restriction.
    """
    from app.auth import get_redis

    cache_key = "geoportal:landing-stats"
    try:
        redis = await get_redis()
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    # Published vector layers (visible to anonymous viewers)
    vl_query = select(VectorLayer).where(VectorLayer.published_in_geoportal == True, VectorLayer.deleted_at.is_(None))
    vl_res = await db.execute(vl_query)
    pub_layers = vl_res.scalars().all()

    total_features = 0
    categories: Dict[str, int] = {}
    geometry_types: Dict[str, int] = {}
    if pub_layers:
        layer_ids = [l.id for l in pub_layers]
        cnt_res = await db.execute(
            select(VectorFeature.layer_id, func.count(VectorFeature.id))
            .where(VectorFeature.layer_id.in_(layer_ids))
            .group_by(VectorFeature.layer_id)
        )
        counts = dict(cnt_res.all())
        for lyr in pub_layers:
            total_features += counts.get(lyr.id, 0)
            cat = lyr.category or "Uncategorized"
            categories[cat] = categories.get(cat, 0) + 1
            gt = str(lyr.geometry_type.value if hasattr(lyr.geometry_type, "value") else lyr.geometry_type)
            geometry_types[gt] = geometry_types.get(gt, 0) + 1

    mb_res = await db.execute(
        select(func.count(MBTilesPackage.id)).where(MBTilesPackage.published_in_geoportal == True, MBTilesPackage.deleted_at.is_(None))
    )
    raster_packages = mb_res.scalar() or 0

    # Most recently updated published layer (for a "last updated" hint)
    latest = None
    if pub_layers:
        latest = max(
            (l.updated_at for l in pub_layers if getattr(l, "updated_at", None)),
            default=None,
        )

    payload = {
        "vector_layers": len(pub_layers),
        "total_features": total_features,
        "raster_packages": raster_packages,
        "categories": [
            {"name": name, "layers": count}
            for name, count in sorted(categories.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "geometry_types": geometry_types,
        "wards_covered": 32,
        "last_updated": latest.isoformat() if latest else None,
    }

    try:
        redis = await get_redis()
        await redis.setex(cache_key, 300, json.dumps(payload, default=str))
    except Exception:
        pass
    return payload
