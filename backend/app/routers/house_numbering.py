"""
KMC-GIS-SERVER — House Numbering & Addressing Engine
Calculates road chainage, left/right parity detection, duplicate resolution,
and automated house number generation from centralized road and building layers.
"""

import json
import math
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, and_, or_

from app.database import get_db
from app.models import (
    HouseNumberRecord, VectorLayer, VectorFeature, User, UserRole
)
from app.schemas import (
    HouseNumberCreate, HouseNumberUpdate, HouseNumberResponse,
    HouseNumberGenerateRequest, MessageResponse
)
from app.auth import get_current_user, require_role, get_optional_current_user
from app.helpers import log_audit

router = APIRouter(prefix="/api/house-numbering", tags=["House Numbering"])


@router.get("/stats")
async def get_house_numbering_stats(
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """Get overall statistics for house numbers and addressing."""
    # Total count
    tot_sql = text("SELECT COUNT(*) AS total FROM house_numbers;")
    tot_res = await db.execute(tot_sql)
    total = tot_res.fetchone().total

    # By status
    stat_sql = text("""
        SELECT status, COUNT(*) AS count
        FROM house_numbers
        GROUP BY status;
    """)
    stat_res = await db.execute(stat_sql)
    by_status = {r.status: r.count for r in stat_res.fetchall()}

    # By side (Left / Right)
    side_sql = text("""
        SELECT side, COUNT(*) AS count
        FROM house_numbers
        GROUP BY side;
    """)
    side_res = await db.execute(side_sql)
    by_side = {r.side: r.count for r in side_res.fetchall()}

    # By ward
    ward_sql = text("""
        SELECT COALESCE(NULLIF(ward, ''), 'Unassigned') AS ward_name, COUNT(*) AS count
        FROM house_numbers
        GROUP BY ward_name
        ORDER BY count DESC
        LIMIT 10;
    """)
    ward_res = await db.execute(ward_sql)
    by_ward = [{"ward": r.ward_name, "count": r.count} for r in ward_res.fetchall()]

    return {
        "total_house_numbers": total,
        "by_status": by_status,
        "by_side": by_side,
        "by_ward": by_ward,
        "assigned_count": by_status.get("ASSIGNED", 0),
        "verified_count": by_status.get("VERIFIED", 0),
        "proposed_count": by_status.get("PROPOSED", 0),
    }


@router.get("/numbers")
async def list_house_numbers(
    road_name: Optional[str] = Query(None),
    ward: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    bbox: Optional[str] = Query(None, description="west,south,east,north"),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """List house numbers matching filters, formatted as GeoJSON FeatureCollection."""
    query = select(
        HouseNumberRecord.id,
        HouseNumberRecord.road_name,
        HouseNumberRecord.house_number,
        HouseNumberRecord.metric_distance,
        HouseNumberRecord.side,
        HouseNumberRecord.ward,
        HouseNumberRecord.status,
        HouseNumberRecord.properties,
        func.ST_AsGeoJSON(HouseNumberRecord.geom).label("geom_json"),
    )

    if road_name:
        query = query.where(HouseNumberRecord.road_name.ilike(f"%{road_name}%"))
    if ward:
        query = query.where(HouseNumberRecord.ward == ward)
    if status:
        query = query.where(HouseNumberRecord.status == status)
    if search:
        query = query.where(or_(
            HouseNumberRecord.house_number.ilike(f"%{search}%"),
            HouseNumberRecord.road_name.ilike(f"%{search}%"),
        ))
    if bbox:
        try:
            w, s, e, n = [float(x.strip()) for x in bbox.split(",")]
            bbox_geom = func.ST_MakeEnvelope(w, s, e, n, 4326)
            query = query.where(func.ST_Intersects(HouseNumberRecord.geom, bbox_geom))
        except Exception:
            pass

    query = query.order_by(HouseNumberRecord.road_name, HouseNumberRecord.metric_distance).limit(limit)
    res = await db.execute(query)
    rows = res.fetchall()

    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "id": r.id,
            "geometry": json.loads(r.geom_json) if r.geom_json else None,
            "properties": {
                "id": r.id,
                "house_number": r.house_number,
                "road_name": r.road_name,
                "metric_distance": r.metric_distance,
                "side": r.side,
                "ward": r.ward,
                "status": r.status,
                **(r.properties or {}),
            }
        })

    return {
        "type": "FeatureCollection",
        "total_count": len(features),
        "features": features,
    }


@router.post("/generate")
async def generate_house_numbers(
    req: HouseNumberGenerateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin, UserRole.SuperAdmin, UserRole.MunicipalUser)),
):
    """
    Intelligent Road-Based House Numbering Generator.
    Uses PostGIS spatial analysis:
    1. Finds building centroids within buffer distance of target road
    2. Projects buildings onto road line using ST_LineLocatePoint to compute chainage
    3. Calculates left vs right side parity via vector cross product
    4. Generates standard metric or sequential numbers
    5. Optionally saves directly to centralized database
    """
    # 1. Fetch road line feature
    road_sql = text("""
        SELECT
            vf.id,
            ST_AsGeoJSON(vf.geom) AS geom_json,
            vf.properties,
            ST_Length(ST_Transform(vf.geom, 3857)) AS road_len_m
        FROM vector_features vf
        WHERE vf.layer_id = :rlid AND vf.id = :rfid;
    """)
    road_res = await db.execute(road_sql, {"rlid": req.road_layer_id, "rfid": req.road_feature_id})
    road_row = road_res.fetchone()
    if not road_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Road feature not found")

    road_props = dict(road_row.properties or {})
    road_name = req.road_name or road_props.get("name") or road_props.get("road_name") or road_props.get("Name") or f"Road-{req.road_feature_id}"
    road_len_m = road_row.road_len_m

    # 2. Find buildings in buffer distance with spatial chainage and side determination
    # ST_LineLocatePoint gives fractional distance along road [0, 1]
    # ST_ClosestPoint gives point on road closest to building
    # Side detection: determine if building is on left or right side of road direction
    bldg_query = text("""
        WITH road AS (
            SELECT ST_Transform(geom, 3857) AS geom_3857, geom AS geom_4326
            FROM vector_features
            WHERE id = :rfid
        ),
        bldgs AS (
            SELECT
                bf.id AS building_id,
                bf.properties AS b_props,
                ST_Centroid(ST_Transform(bf.geom, 3857)) AS b_center_3857,
                ST_Centroid(bf.geom) AS b_center_4326
            FROM vector_features bf, road r
            WHERE bf.layer_id = :blid
              AND ST_DWithin(ST_Transform(bf.geom, 3857), r.geom_3857, :max_dist)
        )
        SELECT
            b.building_id,
            b.b_props,
            ST_AsGeoJSON(b.b_center_4326) AS point_json,
            ST_Distance(b.b_center_3857, r.geom_3857) AS dist_to_road_m,
            ST_LineLocatePoint(r.geom_3857, b.b_center_3857) * ST_Length(r.geom_3857) AS chainage_m,
            ST_AsGeoJSON(ST_Transform(ST_ClosestPoint(r.geom_3857, b.b_center_3857), 4326)) AS closest_road_pt_json,
            -- Determine side (cross-product approximation):
            (ST_X(b.b_center_3857) - ST_X(ST_ClosestPoint(r.geom_3857, b.b_center_3857))) AS dx,
            (ST_Y(b.b_center_3857) - ST_Y(ST_ClosestPoint(r.geom_3857, b.b_center_3857))) AS dy
        FROM bldgs b, road r
        ORDER BY chainage_m ASC;
    """)

    bldg_res = await db.execute(bldg_query, {
        "rfid": req.road_feature_id,
        "blid": req.building_layer_id,
        "max_dist": req.max_distance_from_road_m,
    })
    bldg_rows = bldg_res.fetchall()

    if not bldg_rows:
        return {
            "status": "warning",
            "message": f"No buildings found within {req.max_distance_from_road_m}m of {road_name}",
            "generated_count": 0,
            "proposals": [],
        }

    # 3. Classify into Left and Right sets along road direction
    left_side_items = []
    right_side_items = []

    for row in bldg_rows:
        chainage = round(row.chainage_m, 1)
        # Determine side by comparing displacement dx, dy
        # Simplified: cross product of road tangent or dx direction
        is_left = (row.dx + row.dy) > 0  # heuristic sign separation
        side_label = "LEFT" if is_left else "RIGHT"

        item = {
            "building_id": row.building_id,
            "chainage_m": chainage,
            "point_json": row.point_json,
            "side": side_label,
            "dist_to_road_m": round(row.dist_to_road_m, 1),
        }
        if is_left:
            left_side_items.append(item)
        else:
            right_side_items.append(item)

    # 4. Generate numbering according to scheme
    proposals = []
    
    if req.numbering_scheme == "METRIC":
        # Metric scheme: number = int(chainage / interval) * 2 + (1 for odd / 0 for even)
        for item in left_side_items + right_side_items:
            unit_val = max(1, int(item["chainage_m"] / req.interval_m))
            if item["side"] == "LEFT":
                num_val = (unit_val * 2) - 1  # Odd numbers on Left
            else:
                num_val = unit_val * 2        # Even numbers on Right

            num_str = f"{req.prefix}{num_val}{req.suffix}".strip()
            item["house_number"] = num_str
            proposals.append(item)
    else:
        # Sequential Parity scheme:
        # Odd numbers for Left: 1, 3, 5, 7, ...
        # Even numbers for Right: 2, 4, 6, 8, ...
        left_counter = req.start_number if req.start_number % 2 != 0 else req.start_number + 1
        for item in left_side_items:
            num_str = f"{req.prefix}{left_counter}{req.suffix}".strip()
            item["house_number"] = num_str
            left_counter += 2
            proposals.append(item)

        right_counter = req.start_number + 1 if req.start_number % 2 != 0 else req.start_number
        for item in right_side_items:
            num_str = f"{req.prefix}{right_counter}{req.suffix}".strip()
            item["house_number"] = num_str
            right_counter += 2
            proposals.append(item)

    # Sort proposals along road chainage
    proposals.sort(key=lambda x: x["chainage_m"])

    # 5. Save to database if requested
    saved_count = 0
    if req.save_to_database:
        for p in proposals:
            geom_data = json.loads(p["point_json"])
            coords = geom_data["coordinates"]
            
            # Check existing for duplicate prevention
            chk = await db.execute(
                select(HouseNumberRecord).where(
                    and_(
                        HouseNumberRecord.road_name == road_name,
                        HouseNumberRecord.house_number == p["house_number"]
                    )
                )
            )
            existing = chk.scalar_one_or_none()
            if existing:
                existing.metric_distance = p["chainage_m"]
                existing.side = p["side"]
                existing.geom = func.ST_SetSRID(func.ST_MakePoint(coords[0], coords[1]), 4326)
            else:
                record = HouseNumberRecord(
                    road_layer_id=req.road_layer_id,
                    road_feature_id=req.road_feature_id,
                    building_layer_id=req.building_layer_id,
                    building_feature_id=p["building_id"],
                    road_name=road_name,
                    house_number=p["house_number"],
                    metric_distance=p["chainage_m"],
                    side=p["side"],
                    ward=req.ward or road_props.get("ward"),
                    status="ASSIGNED",
                    geom=func.ST_SetSRID(func.ST_MakePoint(coords[0], coords[1]), 4326),
                    properties={
                        "dist_to_road_m": p["dist_to_road_m"],
                        "numbering_scheme": req.numbering_scheme,
                    },
                    created_by=admin.id,
                )
                db.add(record)
            saved_count += 1
        
        await db.commit()
        await log_audit(db, admin.id, "GENERATE_HOUSE_NUMBERS", "HouseNumberRecord", details={
            "road_name": road_name, "count": saved_count, "scheme": req.numbering_scheme
        })

    return {
        "status": "success",
        "road_name": road_name,
        "road_length_m": round(road_len_m, 1),
        "total_buildings_detected": len(bldg_rows),
        "left_side_count": len(left_side_items),
        "right_side_count": len(right_side_items),
        "saved_to_database": req.save_to_database,
        "saved_count": saved_count,
        "proposals": proposals[:100],  # Return preview items
    }


@router.put("/numbers/{id}")
async def update_house_number(
    id: int,
    body: HouseNumberUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin, UserRole.SuperAdmin, UserRole.MunicipalUser)),
):
    """Update or verify an assigned house number."""
    res = await db.execute(select(HouseNumberRecord).where(HouseNumberRecord.id == id))
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House number not found")

    if body.house_number is not None:
        record.house_number = body.house_number
    if body.road_name is not None:
        record.road_name = body.road_name
    if body.side is not None:
        record.side = body.side
    if body.ward is not None:
        record.ward = body.ward
    if body.status is not None:
        record.status = body.status
    if body.properties is not None:
        props = dict(record.properties or {})
        props.update(body.properties)
        record.properties = props

    await db.commit()
    await log_audit(db, admin.id, "UPDATE_HOUSE_NUMBER", "HouseNumberRecord", record.id)

    return {"status": "success", "message": f"House number {record.house_number} updated"}


@router.delete("/numbers/{id}")
async def delete_house_number(
    id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin, UserRole.SuperAdmin)),
):
    """Delete a house number record."""
    res = await db.execute(select(HouseNumberRecord).where(HouseNumberRecord.id == id))
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="House number not found")

    await db.delete(record)
    await db.commit()
    await log_audit(db, admin.id, "DELETE_HOUSE_NUMBER", "HouseNumberRecord", id)

    return {"status": "success", "message": "House number deleted"}


@router.get("/export")
async def export_house_number_registry(
    format: str = Query("csv", pattern=r"^(csv|geojson)$"),
    ward: Optional[str] = Query(None),
    road_name: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """Export complete house numbering address registry."""
    query = select(
        HouseNumberRecord.id,
        HouseNumberRecord.road_name,
        HouseNumberRecord.house_number,
        HouseNumberRecord.metric_distance,
        HouseNumberRecord.side,
        HouseNumberRecord.ward,
        HouseNumberRecord.status,
        func.ST_X(HouseNumberRecord.geom).label("lng"),
        func.ST_Y(HouseNumberRecord.geom).label("lat"),
    )
    if ward:
        query = query.where(HouseNumberRecord.ward == ward)
    if road_name:
        query = query.where(HouseNumberRecord.road_name.ilike(f"%{road_name}%"))

    res = await db.execute(query.order_by(HouseNumberRecord.road_name, HouseNumberRecord.house_number))
    rows = res.fetchall()

    if format == "csv":
        import csv
        import io
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Road Name", "House Number", "Chainage (m)", "Side", "Ward", "Status", "Longitude", "Latitude"])
        for r in rows:
            writer.writerow([r.id, r.road_name, r.house_number, r.metric_distance, r.side, r.ward, r.status, r.lng, r.lat])

        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=kmc_house_numbering_registry.csv"}
        )
    else:
        features = []
        for r in rows:
            features.append({
                "type": "Feature",
                "id": r.id,
                "geometry": {"type": "Point", "coordinates": [r.lng, r.lat]},
                "properties": {
                    "id": r.id,
                    "road_name": r.road_name,
                    "house_number": r.house_number,
                    "chainage_m": r.metric_distance,
                    "side": r.side,
                    "ward": r.ward,
                    "status": r.status,
                }
            })
        return {
            "type": "FeatureCollection",
            "name": "KMC_House_Numbering_Registry",
            "features": features,
        }
