"""
KMC-GIS-SERVER — Features Router
Vector feature CRUD with geofence enforcement for DataCollectors.
"""

import re
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, and_, or_, Integer
from sqlalchemy.orm import aliased
from sqlalchemy.orm.attributes import flag_modified
import pyproj

from app.database import get_db
from app.models import (
    User, UserRole, VectorLayer, VectorFeature, AuditLog,
)
from app.schemas import FeatureCreate, FeatureUpdate, MessageResponse, FeatureSplitRequest, FeatureMergeRequest
from app.auth import get_current_user, require_role, get_redis
from app.cache import invalidate_layer_cache
from app.helpers import log_audit, is_layer_accessible_by_user
from app.geofence import (
    verify_feature_proximity, verify_new_feature_proximity,
    verify_collector_grid_containment,
)
from app.geometry_utils import (
    detect_crs_from_geojson_or_coords,
    _sanitize_and_transform_coords,
    _get_first_coordinate,
    WGS84_CRS,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Features"])


@router.get("/layers/{layer_id}/features")
async def list_features(
    layer_id: int,
    bbox: Optional[str] = Query(None, description="Bounding box: west,south,east,north"),
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List features for a layer as GeoJSON FeatureCollection. Supports bbox filter."""
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )

    # 1. Fast Redis Cache Check for unconstrained layer requests (Sub-millisecond response)
    if not bbox:
        try:
            redis_client = await get_redis()
            cached = await redis_client.get(f"layer_geojson:{layer_id}")
            if cached:
                return Response(
                    content=cached,
                    media_type="application/json",
                    headers={"X-Features-Cache": "HIT"}
                )
        except Exception:
            pass

    creator = aliased(User)
    updater = aliased(User)

    query = select(
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
    ).outerjoin(creator, VectorFeature.created_by == creator.id) \
     .outerjoin(updater, VectorFeature.updated_by == updater.id) \
     .where(VectorFeature.layer_id == layer_id)

    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) == 4:
                west, south, east, north = parts
                query = query.where(
                    func.ST_Intersects(
                        VectorFeature.geom,
                        func.ST_MakeEnvelope(west, south, east, north, 4326)
                    )
                )
        except (ValueError, IndexError):
            pass

    result = await db.execute(query)
    rows = result.all()

    features = []
    detected_crs = None
    transformer = None

    for row in rows:
        geom = None
        if row.geojson:
            try:
                parsed = json.loads(row.geojson)
                if isinstance(parsed, dict) and "type" in parsed and "coordinates" in parsed and parsed.get("coordinates") is not None:
                    # Check if coordinates are projected/UTM (>180 or >90) and need auto-healing to WGS84
                    if detected_crs is None:
                        sample = _get_first_coordinate(parsed.get("coordinates"))
                        if sample and (abs(sample[0]) > 180.0 or abs(sample[1]) > 90.0):
                            detected_crs = detect_crs_from_geojson_or_coords({"features": [{"geometry": parsed}]})
                            if detected_crs != WGS84_CRS:
                                try:
                                    transformer = pyproj.Transformer.from_crs(detected_crs, WGS84_CRS, always_xy=True)
                                except Exception:
                                    transformer = None
                        else:
                            detected_crs = WGS84_CRS

                    if transformer is not None:
                        clean_coords = _sanitize_and_transform_coords(parsed.get("coordinates"), transformer)
                        parsed["coordinates"] = clean_coords

                    geom = parsed
            except Exception:
                geom = None

        if geom is not None:
            clean_props = {
                k: v for k, v in (row.properties or {}).items()
                if k.lower() not in ("geometry", "the_geom", "geom") and not str(k).startswith("__")
            }
            edit_type = "update" if (row.version and row.version > 1) or row.updated_by else "create"
            clean_props.update({
                "_id": row.id,
                "_created_by": row.created_by,
                "_created_by_username": row.creator_username,
                "_created_by_name": row.creator_full_name,
                "_updated_by": row.updated_by,
                "_updated_by_username": row.updater_username,
                "_updated_by_name": row.updater_full_name,
                "_version": row.version,
                "_created_at": row.created_at.isoformat() if row.created_at else None,
                "_updated_at": row.updated_at.isoformat() if row.updated_at else None,
                "_edit_type": edit_type,
            })
            features.append({
                "type": "Feature",
                "id": row.id,
                "geometry": geom,
                "properties": clean_props,
            })

    payload = {
        "type": "FeatureCollection",
        "features": features,
        "total_count": len(features),
    }
    json_str = json.dumps(payload)

    # Store full layer GeoJSON in Redis (1 hour TTL)
    if not bbox:
        try:
            redis_client = await get_redis()
            await redis_client.set(f"layer_geojson:{layer_id}", json_str, ex=3600)
        except Exception:
            pass

    client_ip = request.client.host if request and request.client else None
    await log_audit(
        db, current_user.id, "LOAD_LAYER_FEATURES", "VectorLayer", layer_id,
        details={"feature_count": len(features), "bbox": bbox},
        ip=client_ip,
    )

    return Response(
        content=json_str,
        media_type="application/json",
        headers={"X-Features-Cache": "MISS"}
    )


@router.post("/features")
async def create_feature(
    body: FeatureCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """
    Create a new vector feature.
    DataCollector is strictly restricted to their assigned task grids (or assigned project boundary).
    GisAdmin bypasses all spatial restriction and proximity checks.
    """
    if not await is_layer_accessible_by_user(db, current_user, body.layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )

    # Verify layer exists and is editable
    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == body.layer_id, VectorLayer.deleted_at.is_(None)))
    layer = layer_result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    if current_user.role == UserRole.DataCollector and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This layer is not editable by DataCollectors")

    geom_json = json.dumps(body.geom_geojson)

    # Strict Grid Containment and Optional GPS Geofence for DataCollector
    if current_user.role == UserRole.DataCollector:
        await verify_collector_grid_containment(db, current_user, body.layer_id, body.geom_geojson)

        if body.collector_lat is not None and body.collector_lng is not None:
            # Convert GeoJSON to WKT for proximity check
            wkt_result = await db.execute(
                text("SELECT ST_AsText(ST_GeomFromGeoJSON(:geojson))"),
                {"geojson": geom_json},
            )
            geom_wkt = wkt_result.scalar()
            await verify_new_feature_proximity(
                db, current_user.role.value, body.collector_lat, body.collector_lng, geom_wkt
            )

    clean_props = {}
    target_feat_id = None
    target_link_val = None
    target_link_field = None

    for k, v in (body.properties or {}).items():
        if str(k).startswith("__"):
            continue
        if k == "_target_feature_id":
            try:
                target_feat_id = int(v)
            except Exception:
                pass
            continue
        if str(k).endswith("_linked_id") and v is not None and str(v).strip() != "":
            target_link_val = str(v).strip()
            target_link_field = k
        if k == "gid" and v is not None and str(v).isdigit():
            try:
                v = int(v)
            except Exception:
                pass
        clean_props[k] = v

    # Automatically record username in "Kmc_Editor" when created by a DataCollector
    if current_user.role == UserRole.DataCollector:
        clean_props["Kmc_Editor"] = current_user.username

    # Determine input geometry type for schema mapping
    input_geom_type = (body.geom_geojson.get("type") if isinstance(body.geom_geojson, dict) else "") or "GEOMETRY"
    input_geom_upper = input_geom_type.upper()

    layer_fields = None
    if layer.geometry_fields_config and isinstance(layer.geometry_fields_config, dict):
        g_fields = layer.geometry_fields_config.get(input_geom_upper) or layer.geometry_fields_config.get(input_geom_type)
        if isinstance(g_fields, list) and len(g_fields) > 0:
            layer_fields = g_fields

    if not layer_fields:
        layer_fields = layer.fields_config if isinstance(layer.fields_config, list) else []

    # 1. Unique Field & ID Generation
    for f in layer_fields:
        if f.get("is_unique"):
            f_name = f.get("name")
            id_mode = f.get("id_mode", "manual")
            prefix = str(f.get("id_prefix") or "").strip()
            start_seq = f.get("id_sequence") or 1
            try:
                start_seq = int(start_seq)
            except (ValueError, TypeError):
                start_seq = 1

            current_val = clean_props.get(f_name)
            if id_mode == "auto":
                feat_rows = await db.execute(
                    select(VectorFeature.properties).where(VectorFeature.layer_id == body.layer_id)
                )
                existing_vals = set()
                max_num = start_seq - 1
                escaped_prefix = re.escape(prefix) if prefix else ""
                pattern = re.compile(rf"^{escaped_prefix}(\d+)$", re.IGNORECASE) if prefix else re.compile(r"(\d+)$")
                for (props,) in feat_rows.all():
                    if isinstance(props, dict) and f_name in props:
                        val_str = str(props[f_name]).strip()
                        existing_vals.add(val_str.lower())
                        match = pattern.search(val_str)
                        if match:
                            try:
                                num = int(match.group(1))
                                if num > max_num:
                                    max_num = num
                            except ValueError:
                                pass

                # If current_val is empty, matches prefix, or is already taken (e.g. from linking), auto-generate next sequence
                is_colliding = current_val is not None and str(current_val).strip().lower() in existing_vals
                if current_val is None or str(current_val).strip() == "" or str(current_val).strip() == prefix or is_colliding:
                    next_seq = max(max_num + 1, start_seq)
                    seq_str = f"{next_seq:03d}" if next_seq < 1000 else str(next_seq)
                    clean_props[f_name] = f"{prefix}{seq_str}" if prefix else str(next_seq)
                    current_val = clean_props[f_name]
            else:
                # Manual ID mode: validate uniqueness
                if current_val is not None and str(current_val).strip() != "":
                    feat_rows = await db.execute(
                        select(VectorFeature.properties).where(VectorFeature.layer_id == body.layer_id)
                    )
                    for (props,) in feat_rows.all():
                        if isinstance(props, dict) and f_name in props:
                            if str(props[f_name]).strip().lower() == str(current_val).strip().lower():
                                field_label = f.get("label") or f_name
                                raise HTTPException(
                                    status_code=status.HTTP_400_BAD_REQUEST,
                                    detail=f"अद्वितीय फिल्ड त्रुटि: '{field_label}' को मान '{current_val}' यस तहमा पहिले नै अवस्थित छ। (Unique constraint violation: '{field_label}' with value '{current_val}' already exists)",
                                )

    # 2. Required Fields Validation
    for f in layer_fields:
        if f.get("required"):
            f_name = f.get("name")
            val = clean_props.get(f_name)
            is_empty = val is None or (isinstance(val, str) and val.strip() == "") or (isinstance(val, list) and len(val) == 0)
            if is_empty:
                field_label = f.get("label") or f_name
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"अनिवार्य फिल्ड त्रुटि: '{field_label}' अनिवार्य छ। (Compulsory field error: '{field_label}' is required)",
                )

    feature = VectorFeature(
        layer_id=body.layer_id,
        geom=func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(geom_json)), 4326),
        properties=clean_props,
        created_by=current_user.id,
        version=1,
    )
    db.add(feature)
    await db.flush()

    # Two-way linking: if this feature links to a target feature, update the target feature as well
    try:
        target_feature_to_update = None
        if target_feat_id:
            tf_q = await db.execute(select(VectorFeature).where(VectorFeature.id == target_feat_id))
            target_feature_to_update = tf_q.scalar_one_or_none()
        elif target_link_val and target_link_field:
            # Find target feature by matching ID or linking field
            prefix = target_link_field[:-10]
            clean_prefix = re.sub(r'[^a-zA-Z0-9_]', '_', prefix).strip('_').lower()
            all_l_q = await db.execute(select(VectorLayer))
            t_layer = next((l for l in all_l_q.scalars().all() if re.sub(r'[^a-zA-Z0-9_]', '_', l.name).strip('_').lower() == clean_prefix), layer)
            if t_layer:
                if target_link_val.isdigit():
                    tf_q = await db.execute(
                        select(VectorFeature).where(
                            and_(VectorFeature.layer_id == t_layer.id, VectorFeature.id == int(target_link_val))
                        )
                    )
                    target_feature_to_update = tf_q.scalar_one_or_none()
                if not target_feature_to_update:
                    # Search by properties (e.g. gid == target_link_val)
                    tf_cand_q = await db.execute(
                        select(VectorFeature).where(VectorFeature.layer_id == t_layer.id)
                    )
                    for cand in tf_cand_q.scalars().all():
                        c_props = cand.properties or {}
                        if str(c_props.get("gid", "")).strip() == target_link_val or str(c_props.get("id", "")).strip() == target_link_val:
                            target_feature_to_update = cand
                            break

        if target_feature_to_update and target_feature_to_update.id != feature.id:
            t_props = dict(target_feature_to_update.properties or {})
            curr_layer_clean = re.sub(r'[^a-zA-Z0-9_]', '_', layer.name).strip('_')
            point_link_val = feature.properties.get("gid") or feature.id
            t_props[f"{curr_layer_clean}_linked_id"] = str(point_link_val)
            t_props["linked_point_id"] = feature.id
            t_props["linked_point_gid"] = feature.properties.get("gid") or feature.id
            target_feature_to_update.properties = t_props
            flag_modified(target_feature_to_update, "properties")
            target_feature_to_update.updated_by = current_user.id
            target_feature_to_update.version += 1
            await db.flush()
    except Exception as link_err:
        logger.warning(f"Failed to auto-update target feature link: {link_err}")

    await log_audit(db, current_user.id, "CREATE_FEATURE", "VectorFeature", feature.id,
                    details={
                        "layer_id": feature.layer_id,
                        "feature_id": feature.id,
                        "geometry_type": input_geom_type,
                        "properties": clean_props,
                    },
                    ip=request.client.host if request.client else None)

    # Return the created feature
    feat_result = await db.execute(
        select(
            VectorFeature.id, VectorFeature.properties, VectorFeature.version,
            VectorFeature.created_by, VectorFeature.updated_by,
            VectorFeature.created_at, VectorFeature.updated_at,
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(VectorFeature.id == feature.id)
    )
    row = feat_result.one()

    # Invalidate cache for layer so GeoPortal and Field Data immediately see the new feature
    await invalidate_layer_cache(body.layer_id)

    return {
        "type": "Feature",
        "id": row.id,
        "geometry": json.loads(row.geojson) if row.geojson else None,
        "properties": {
            **(row.properties or {}),
            "_id": row.id,
            "_created_by": row.created_by,
            "_created_by_username": current_user.username,
            "_created_by_name": current_user.full_name,
            "_updated_by": row.updated_by,
            "_version": row.version,
            "_created_at": row.created_at.isoformat() if row.created_at else None,
            "_updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "_edit_type": "create",
        },
    }


@router.put("/features/{feature_id}")
async def update_feature(
    feature_id: int,
    body: FeatureUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """
    Update an existing vector feature.
    DataCollector can modify features only within their assigned task grids (or assigned project boundary).
    GisAdmin bypasses all spatial restrictions.
    """
    result = await db.execute(
        select(VectorFeature).where(VectorFeature.id == feature_id)
    )
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This feature belongs to a layer outside your assigned projects.",
        )

    # Check layer editability
    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == feature.layer_id, VectorLayer.deleted_at.is_(None)))
    layer = layer_result.scalar_one_or_none()
    if current_user.role == UserRole.DataCollector and layer and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Layer not editable by DataCollectors")

    # Strict Grid Containment for DataCollector
    if current_user.role == UserRole.DataCollector:
        target_geom = body.geom_geojson
        if target_geom is None:
            geojson_res = await db.execute(
                select(func.ST_AsGeoJSON(VectorFeature.geom)).where(VectorFeature.id == feature_id)
            )
            raw_geojson = geojson_res.scalar()
            if raw_geojson:
                target_geom = json.loads(raw_geojson)

        if target_geom:
            await verify_collector_grid_containment(db, current_user, feature.layer_id, target_geom, feature_id=feature_id)

        if body.collector_lat is not None and body.collector_lng is not None:
            await verify_feature_proximity(
                db, current_user.role.value, body.collector_lat, body.collector_lng, feature_id
            )

    # Apply updates
    if body.geom_geojson is not None:
        geom_json = json.dumps(body.geom_geojson)
        feature.geom = func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(geom_json)), 4326)

    # Merge properties (preserve existing, override with new)
    existing_props = dict(feature.properties or {})
    if body.properties is not None:
        existing_props.update(body.properties)

    # Automatically record username in "Kmc_Editor" when a DataCollector edits any feature
    if current_user.role == UserRole.DataCollector:
        existing_props["Kmc_Editor"] = current_user.username

    # Determine geometry type for schema matching
    raw_res = await db.execute(select(func.ST_AsGeoJSON(VectorFeature.geom)).where(VectorFeature.id == feature_id))
    raw_geo = raw_res.scalar()
    current_geom = body.geom_geojson or (json.loads(raw_geo) if raw_geo else {})
    input_geom_type = (current_geom.get("type") if isinstance(current_geom, dict) else "") or "GEOMETRY"
    input_geom_upper = input_geom_type.upper()

    layer_fields = None
    if layer and layer.geometry_fields_config and isinstance(layer.geometry_fields_config, dict):
        g_fields = layer.geometry_fields_config.get(input_geom_upper) or layer.geometry_fields_config.get(input_geom_type)
        if isinstance(g_fields, list) and len(g_fields) > 0:
            layer_fields = g_fields

    if not layer_fields and layer:
        layer_fields = layer.fields_config if isinstance(layer.fields_config, list) else []

    # Validate Unique Constraints
    for f in (layer_fields or []):
        if f.get("is_unique"):
            f_name = f.get("name")
            val = existing_props.get(f_name)
            if val is not None and str(val).strip() != "":
                other_rows = await db.execute(
                    select(VectorFeature.properties).where(
                        and_(
                            VectorFeature.layer_id == feature.layer_id,
                            VectorFeature.id != feature.id,
                        )
                    )
                )
                for (props,) in other_rows.all():
                    if isinstance(props, dict) and f_name in props:
                        if str(props[f_name]).strip().lower() == str(val).strip().lower():
                            field_label = f.get("label") or f_name
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"अद्वितीय फिल्ड त्रुटि: '{field_label}' को मान '{val}' यस तहमा अर्को फिचरमा पहिले नै अवस्थित छ। (Unique constraint violation: '{field_label}' with value '{val}' already exists on another feature)",
                            )

    # Validate Required Fields
    for f in (layer_fields or []):
        if f.get("required"):
            f_name = f.get("name")
            val = existing_props.get(f_name)
            is_empty = val is None or (isinstance(val, str) and val.strip() == "") or (isinstance(val, list) and len(val) == 0)
            if is_empty:
                field_label = f.get("label") or f_name
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"अनिवार्य फिल्ड त्रुटि: '{field_label}' अनिवार्य छ। (Compulsory field error: '{field_label}' is required)",
                )

    feature.properties = existing_props
    flag_modified(feature, "properties")

    feature.updated_by = current_user.id
    feature.version += 1

    await log_audit(db, current_user.id, "UPDATE_FEATURE", "VectorFeature", feature_id,
                    details={
                        "layer_id": feature.layer_id,
                        "feature_id": feature_id,
                        "version": feature.version,
                        "geometry_type": input_geom_type,
                        "properties": existing_props,
                    },
                    ip=request.client.host if request.client else None)

    await db.flush()

    # Return updated feature
    feat_result = await db.execute(
        select(
            VectorFeature.id, VectorFeature.properties, VectorFeature.version,
            VectorFeature.created_by, VectorFeature.updated_by,
            VectorFeature.created_at, VectorFeature.updated_at,
            func.ST_AsGeoJSON(VectorFeature.geom).label("geojson"),
        ).where(VectorFeature.id == feature_id)
    )
    row = feat_result.one()

    # Invalidate cache for layer so GeoPortal and Field Data immediately see updated feature
    await invalidate_layer_cache(feature.layer_id)

    return {
        "type": "Feature",
        "id": row.id,
        "geometry": json.loads(row.geojson) if row.geojson else None,
        "properties": {
            **(row.properties or {}),
            "_id": row.id,
            "_created_by": row.created_by,
            "_updated_by": row.updated_by,
            "_updated_by_username": current_user.username,
            "_updated_by_name": current_user.full_name,
            "_version": row.version,
            "_created_at": row.created_at.isoformat() if row.created_at else None,
            "_updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "_edit_type": "update",
        },
    }


@router.delete("/features/{feature_id}", response_model=MessageResponse)
async def delete_feature(
    feature_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """Delete a vector feature (GisAdmin or DataCollector within their assigned grids)."""
    result = await db.execute(select(VectorFeature).where(VectorFeature.id == feature_id))
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This feature belongs to a layer outside your assigned projects.",
        )

    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == feature.layer_id, VectorLayer.deleted_at.is_(None)))
    layer = layer_result.scalar_one_or_none()
    if current_user.role == UserRole.DataCollector and layer and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Layer not editable by DataCollectors")

    if current_user.role == UserRole.DataCollector:
        # Ownership check: A DataCollector can only delete features created and saved by themselves
        creator_id = feature.created_by
        props = feature.properties or {}
        editor_username = str(props.get("Kmc_Editor", "")).strip().lower()
        is_owner = (creator_id == current_user.id) or (
            editor_username and editor_username == current_user.username.lower()
        )

        if not is_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="पहुँच अस्वीकृत: तपाईंले आफूले सिर्जना गरेका फिचरहरू मात्र मेटाउन सक्नुहुन्छ। (Access denied: You can only delete features created and saved by you.)",
            )

        geojson_res = await db.execute(
            select(func.ST_AsGeoJSON(VectorFeature.geom)).where(VectorFeature.id == feature_id)
        )
        raw_geojson = geojson_res.scalar()
        if raw_geojson:
            await verify_collector_grid_containment(db, current_user, feature.layer_id, json.loads(raw_geojson), feature_id=feature_id)

    await log_audit(db, current_user.id, "DELETE_FEATURE", "VectorFeature", feature_id,
                    details={
                        "layer_id": feature.layer_id,
                        "feature_id": feature_id,
                        "properties": feature.properties or {},
                    },
                    ip=request.client.host if request.client else None)
    target_layer_id = feature.layer_id
    await db.delete(feature)

    # Invalidate cache for layer so GeoPortal and Field Data immediately reflect deletion
    await invalidate_layer_cache(target_layer_id)

    return MessageResponse(message="Feature deleted")


@router.get("/layers/{layer_id}/extent")
async def get_layer_extent(
    layer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fast bounding box [west, south, east, north] (WGS84) of a layer via PostGIS ST_Extent.

    Used by clients to zoom to very large layers without downloading every feature.
    """
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )
    res = await db.execute(
        select(
            func.ST_XMin(func.ST_Extent(VectorFeature.geom)),
            func.ST_YMin(func.ST_Extent(VectorFeature.geom)),
            func.ST_XMax(func.ST_Extent(VectorFeature.geom)),
            func.ST_YMax(func.ST_Extent(VectorFeature.geom)),
        ).where(VectorFeature.layer_id == layer_id)
    )
    row = res.one_or_none()
    if not row or any(v is None for v in row):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer has no features")
    west, south, east, north = (float(v) for v in row)
    return {"extent": [west, south, east, north]}


@router.post("/features/{feature_id}/split")
async def split_feature(
    feature_id: int,
    body: FeatureSplitRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """QGIS-style split: cut a line/polygon feature with a blade LineString.

    Uses PostGIS ST_Split. The original feature keeps the first part; new
    features (copying the original properties) are created for the rest.
    """
    result = await db.execute(select(VectorFeature).where(VectorFeature.id == feature_id))
    feature = result.scalar_one_or_none()
    if not feature:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")

    if not await is_layer_accessible_by_user(db, current_user, feature.layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This feature belongs to a layer outside your assigned projects.",
        )

    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == feature.layer_id, VectorLayer.deleted_at.is_(None)))
    layer = layer_result.scalar_one_or_none()
    if current_user.role == UserRole.DataCollector and layer and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Layer not editable by DataCollectors")

    blade = body.blade or {}
    if blade.get("type") != "LineString" or not blade.get("coordinates"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid GeoJSON LineString 'blade' geometry is required to split.",
        )

    blade_json = json.dumps(blade)
    split_res = await db.execute(
        text(
            "SELECT ST_AsGeoJSON((ST_Dump(ST_Split(geom, "
            "ST_SetSRID(ST_GeomFromGeoJSON(:blade), 4326)))).geom) AS part "
            "FROM vector_features WHERE id = :fid"
        ),
        {"blade": blade_json, "fid": feature_id},
    )
    parts = []
    for row in split_res.all():
        if row[0]:
            try:
                parts.append(json.loads(row[0]))
            except Exception:
                continue

    if len(parts) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The split line does not cut the feature. Draw a line that crosses the feature completely.",
        )

    if current_user.role == UserRole.DataCollector:
        for part in parts:
            await verify_collector_grid_containment(
                db, current_user, feature.layer_id, part, feature_id=feature_id
            )

    # Original feature keeps the first part
    feature.geom = func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(json.dumps(parts[0]))), 4326)
    feature.version = (feature.version or 1) + 1
    feature.updated_by = current_user.id

    new_ids = []
    for part in parts[1:]:
        new_feat = VectorFeature(
            layer_id=feature.layer_id,
            geom=func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(json.dumps(part))), 4326),
            properties=dict(feature.properties or {}),
            created_by=current_user.id,
            version=1,
        )
        db.add(new_feat)
        await db.flush()
        new_ids.append(new_feat.id)

    await log_audit(db, current_user.id, "SPLIT_FEATURE", "VectorFeature", feature_id,
                    details={
                        "layer_id": feature.layer_id,
                        "feature_id": feature_id,
                        "new_feature_ids": new_ids,
                        "part_count": len(parts),
                    },
                    ip=request.client.host if request.client else None)

    await invalidate_layer_cache(feature.layer_id)

    return {
        "feature_id": feature_id,
        "new_feature_ids": new_ids,
        "part_count": len(parts),
        "parts": parts,
    }


@router.post("/layers/{layer_id}/merge")
async def merge_features(
    layer_id: int,
    body: FeatureMergeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.GisAdmin, UserRole.DataCollector, UserRole.Validator)),
):
    """QGIS-style merge: union 2+ features of the same layer into the first one.

    The first feature keeps its properties and receives the unioned geometry;
    the remaining features are deleted.
    """
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )

    layer_result = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id, VectorLayer.deleted_at.is_(None)))
    layer = layer_result.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")
    if current_user.role == UserRole.DataCollector and not layer.editable_by_collectors:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Layer not editable by DataCollectors")

    unique_ids = list(dict.fromkeys(body.feature_ids or []))
    if len(unique_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least two features to merge.",
        )

    result = await db.execute(
        select(VectorFeature).where(
            VectorFeature.id.in_(unique_ids), VectorFeature.layer_id == layer_id
        )
    )
    features = result.scalars().all()
    if len(features) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not find at least two features of this layer to merge.",
        )

    union_res = await db.execute(
        text(
            "SELECT ST_AsGeoJSON(ST_Union(geom)) AS merged FROM vector_features "
            "WHERE id = ANY(:ids) AND layer_id = :lid"
        ),
        {"ids": unique_ids, "lid": layer_id},
    )
    merged_raw = union_res.scalar()
    if not merged_raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not merge the selected features.")
    merged_geom = json.loads(merged_raw)

    if current_user.role == UserRole.DataCollector:
        await verify_collector_grid_containment(db, current_user, layer_id, merged_geom)

    keep = next((f for f in features if f.id == unique_ids[0]), features[0])
    drop_ids = [f.id for f in features if f.id != keep.id]

    keep.geom = func.ST_SetSRID(func.ST_Force2D(func.ST_GeomFromGeoJSON(json.dumps(merged_geom))), 4326)
    keep.version = (keep.version or 1) + 1
    keep.updated_by = current_user.id

    for f in features:
        if f.id != keep.id:
            await db.delete(f)

    await log_audit(db, current_user.id, "MERGE_FEATURES", "VectorFeature", keep.id,
                    details={
                        "layer_id": layer_id,
                        "kept_feature_id": keep.id,
                        "merged_feature_ids": drop_ids,
                    },
                    ip=request.client.host if request.client else None)

    await invalidate_layer_cache(layer_id)

    return {
        "feature_id": keep.id,
        "merged_feature_ids": drop_ids,
        "geometry": merged_geom,
    }


@router.get("/layers/{layer_id}/audit-edits")
async def get_layer_audit_edits(
    layer_id: int,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List recent feature audit logs for a layer (Create, Update, Delete)."""
    if not await is_layer_accessible_by_user(db, current_user, layer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. This layer is not linked to any of your assigned projects.",
        )

    feature_ids_subq = select(VectorFeature.id).where(VectorFeature.layer_id == layer_id)

    q = (
        select(
            AuditLog.id,
            AuditLog.action,
            AuditLog.entity_id,
            AuditLog.user_id,
            AuditLog.details,
            AuditLog.timestamp,
            User.username,
            User.full_name,
        )
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(
            and_(
                AuditLog.entity_type == "VectorFeature",
                AuditLog.action.in_(["CREATE_FEATURE", "UPDATE_FEATURE", "DELETE_FEATURE"]),
                or_(
                    func.json_extract_path_text(AuditLog.details, "layer_id") == str(layer_id),
                    AuditLog.entity_id.in_(feature_ids_subq),
                ),
            )
        )
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
    )

    result = await db.execute(q)
    rows = result.all()

    audit_edits = []
    for r in rows:
        edit_action = "create"
        if r.action == "UPDATE_FEATURE":
            edit_action = "update"
        elif r.action == "DELETE_FEATURE":
            edit_action = "delete"

        audit_edits.append({
            "id": r.id,
            "feature_id": r.entity_id,
            "layer_id": layer_id,
            "user_id": r.user_id,
            "username": r.username,
            "full_name": r.full_name,
            "action": r.action,
            "edit_type": edit_action,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "details": r.details or {},
        })

    return {
        "layer_id": layer_id,
        "edits": audit_edits,
        "total_count": len(audit_edits),
    }
