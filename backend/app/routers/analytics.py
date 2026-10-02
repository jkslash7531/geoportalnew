"""
KMC-GIS-SERVER — Dynamic GIS Analytics & Infographics Engine
Auto-detects geometry type (Point, Line, Polygon, Mixed) and dynamic attribute schemas
to generate real-time KPI summaries, distributions, and charts with Redis caching.
"""

import json
import hashlib
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text, and_

from app.database import get_db
from app.models import VectorLayer, VectorFeature, User
from app.auth import get_optional_current_user, get_redis

router = APIRouter(prefix="/api/analytics", tags=["GIS Analytics"])


@router.get("/layer/{layer_id}")
async def get_layer_analytics(
    layer_id: int,
    bbox: Optional[str] = Query(None, description="Bounding box: west,south,east,north"),
    ward: Optional[str] = Query(None, description="Optional ward filter"),
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Generate dynamic spatial analytics and infographic data for a vector layer.
    Automatically adapts to Point, Line, Polygon, or Mixed geometry types,
    and analyzes dynamic attribute distributions. Uses Redis caching.
    """
    # 1. Fetch layer
    res = await db.execute(select(VectorLayer).where(VectorLayer.id == layer_id, VectorLayer.deleted_at.is_(None)))
    layer = res.scalar_one_or_none()
    if not layer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")

    user_role = user.role.value if user else "BasicViewer"

    # 2. Redis Cache check
    cache_params = f"{layer_id}:{user_role}:{bbox or 'all'}:{ward or 'all'}"
    cache_hash = hashlib.md5(cache_params.encode()).hexdigest()
    redis_key = f"gis_analytics:{cache_hash}"

    try:
        redis_client = await get_redis()
        cached = await redis_client.get(redis_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    # 3. Base SQL where clause & params
    where_clauses = ["vf.layer_id = :layer_id"]
    sql_params = {"layer_id": layer_id}

    if bbox:
        try:
            w, s, e, n = [float(x.strip()) for x in bbox.split(",")]
            where_clauses.append("ST_Intersects(vf.geom, ST_MakeEnvelope(:w, :s, :e, :n, 4326))")
            sql_params.update({"w": w, "s": s, "e": e, "n": n})
        except Exception:
            pass

    if ward:
        where_clauses.append("(vf.properties->>'ward' = :ward OR vf.properties->>'Ward' = :ward)")
        sql_params["ward"] = str(ward).strip()

    where_sql = " AND ".join(where_clauses)

    # 4. Geometry-specific analytics
    geom_type = layer.geometry_type.value if hasattr(layer.geometry_type, "value") else str(layer.geometry_type)
    geom_upper = geom_type.upper()

    kpi_cards = []
    geom_summary = {}

    # Basic Count & Validity
    count_sql = text(f"""
        SELECT
            COUNT(*) AS total_count,
            COUNT(CASE WHEN ST_IsValid(vf.geom) THEN 1 END) AS valid_count,
            COUNT(CASE WHEN vf.properties IS NOT NULL AND CAST(vf.properties AS text) != '{{}}' THEN 1 END) AS populated_props_count
        FROM vector_features vf
        WHERE {where_sql};
    """)
    count_res = await db.execute(count_sql, sql_params)
    count_row = count_res.fetchone()
    total_count = count_row.total_count if count_row else 0
    valid_count = count_row.valid_count if count_row else 0
    populated_count = count_row.populated_props_count if count_row else 0

    kpi_cards.append({
        "id": "feature_count",
        "title": "कुल विशेषताहरू (Total Features)",
        "value": total_count,
        "unit": "features",
        "icon": "Layers",
        "color": "blue",
    })

    # Line analytics: Length in meters and km
    if "LINE" in geom_upper:
        line_sql = text(f"""
            SELECT
                COALESCE(SUM(ST_Length(ST_Transform(vf.geom, 3857))), 0) AS total_len,
                COALESCE(AVG(ST_Length(ST_Transform(vf.geom, 3857))), 0) AS avg_len,
                COALESCE(MIN(ST_Length(ST_Transform(vf.geom, 3857))), 0) AS min_len,
                COALESCE(MAX(ST_Length(ST_Transform(vf.geom, 3857))), 0) AS max_len
            FROM vector_features vf
            WHERE {where_sql};
        """)
        line_res = await db.execute(line_sql, sql_params)
        l_row = line_res.fetchone()
        tot_km = round(l_row.total_len / 1000.0, 2) if l_row else 0
        avg_m = round(l_row.avg_len, 1) if l_row else 0

        kpi_cards.append({
            "id": "total_length",
            "title": "कुल लम्बाइ (Total Length)",
            "value": tot_km,
            "unit": "km",
            "icon": "Route",
            "color": "emerald",
        })
        kpi_cards.append({
            "id": "avg_length",
            "title": "औसत लम्बाइ (Avg Length)",
            "value": avg_m,
            "unit": "meters",
            "icon": "Ruler",
            "color": "amber",
        })
        geom_summary = {
            "type": "LineString",
            "total_length_km": tot_km,
            "avg_length_m": avg_m,
            "min_length_m": round(l_row.min_len, 1) if l_row else 0,
            "max_length_m": round(l_row.max_len, 1) if l_row else 0,
        }

    # Polygon analytics: Area in sq meters and sq km
    elif "POLYGON" in geom_upper:
        poly_sql = text(f"""
            SELECT
                COALESCE(SUM(ST_Area(ST_Transform(vf.geom, 3857))), 0) AS total_area,
                COALESCE(AVG(ST_Area(ST_Transform(vf.geom, 3857))), 0) AS avg_area,
                COALESCE(MIN(ST_Area(ST_Transform(vf.geom, 3857))), 0) AS min_area,
                COALESCE(MAX(ST_Area(ST_Transform(vf.geom, 3857))), 0) AS max_area
            FROM vector_features vf
            WHERE {where_sql};
        """)
        poly_res = await db.execute(poly_sql, sql_params)
        p_row = poly_res.fetchone()
        tot_sqkm = round(p_row.total_area / 1_000_000.0, 3) if p_row else 0
        tot_ha = round(p_row.total_area / 10_000.0, 2) if p_row else 0
        avg_sqm = round(p_row.avg_area, 1) if p_row else 0

        kpi_cards.append({
            "id": "total_area",
            "title": "कुल क्षेत्रफल (Total Area)",
            "value": tot_sqkm,
            "unit": "sq.km",
            "secondary": f"{tot_ha} hectares",
            "icon": "Maximize2",
            "color": "purple",
        })
        kpi_cards.append({
            "id": "avg_area",
            "title": "औसत क्षेत्रफल (Avg Area)",
            "value": avg_sqm,
            "unit": "sq.m",
            "icon": "Square",
            "color": "indigo",
        })
        geom_summary = {
            "type": "Polygon",
            "total_area_sqkm": tot_sqkm,
            "total_area_hectares": tot_ha,
            "avg_area_sqm": avg_sqm,
            "min_area_sqm": round(p_row.min_area, 1) if p_row else 0,
            "max_area_sqm": round(p_row.max_area, 1) if p_row else 0,
        }

    # Point or Mixed
    else:
        # Check geometry breakdown
        mix_sql = text(f"""
            SELECT ST_GeometryType(vf.geom) AS gtype, COUNT(*) AS cnt
            FROM vector_features vf
            WHERE {where_sql}
            GROUP BY ST_GeometryType(vf.geom);
        """)
        mix_res = await db.execute(mix_sql, sql_params)
        types_breakdown = {row.gtype.replace("ST_", ""): row.cnt for row in mix_res.fetchall()}
        geom_summary = {
            "type": "Mixed / Point",
            "breakdown": types_breakdown,
        }

    # Data Quality score
    completeness_pct = round((populated_count / total_count * 100), 1) if total_count > 0 else 100
    validity_pct = round((valid_count / total_count * 100), 1) if total_count > 0 else 100

    kpi_cards.append({
        "id": "data_quality",
        "title": "तथ्याङ्क पूर्णता (Completeness)",
        "value": f"{completeness_pct}%",
        "unit": "score",
        "icon": "CheckCircle2",
        "color": "teal",
    })

    # 5. Dynamic Attribute Analytics
    charts = {
        "categories": [],
        "numeric_summaries": [],
    }

    # Scan layer fields_config
    fields_config = layer.fields_config or []
    dash_cfg = layer.dashboard_config or {}
    chart_fields = dash_cfg.get("chart_fields")

    # If GIS Admin configured specific chart_fields for infographics, prioritize/filter them
    if chart_fields and isinstance(chart_fields, list) and len(chart_fields) > 0:
        fields_config = [f for f in fields_config if f.get("name") in chart_fields]

    analyzed_fields = 0

    for field in fields_config:
        if analyzed_fields >= 6:
            break
        f_name = field.get("name")
        f_type = field.get("type", "text").lower()
        f_label = field.get("label") or f_name

        if not f_name or f_name.startswith("_"):
            continue

        # Check field permission for user role
        perms = layer.field_permissions or {}
        if f_name in perms and user_role not in ("SuperAdmin", "GisAdmin"):
            if user_role not in perms[f_name]:
                continue

        # Categorical Breakdown
        if f_type in ("select", "radio", "text", "category"):
            cat_sql = text(f"""
                SELECT
                    COALESCE(NULLIF(TRIM(vf.properties->>:fname), ''), 'अवर्गीकृत (Unassigned)') AS cat_val,
                    COUNT(*) AS count
                FROM vector_features vf
                WHERE {where_sql}
                GROUP BY cat_val
                ORDER BY count DESC
                LIMIT 8;
            """)
            try:
                c_res = await db.execute(cat_sql, {**sql_params, "fname": f_name})
                cat_rows = c_res.fetchall()
                if cat_rows and len(cat_rows) > 1:
                    chart_data = [{"name": r.cat_val, "value": r.count} for r in cat_rows]
                    charts["categories"].append({
                        "field": f_name,
                        "title": f_label,
                        "type": "donut",
                        "data": chart_data,
                    })
                    analyzed_fields += 1
            except Exception:
                pass

        # Numeric Summary
        elif f_type in ("number", "integer", "float"):
            num_sql = text(f"""
                SELECT
                    COUNT(NULLIF(vf.properties->>:fname, '')::numeric) AS valid_num_count,
                    AVG(NULLIF(vf.properties->>:fname, '')::numeric) AS avg_val,
                    MIN(NULLIF(vf.properties->>:fname, '')::numeric) AS min_val,
                    MAX(NULLIF(vf.properties->>:fname, '')::numeric) AS max_val,
                    SUM(NULLIF(vf.properties->>:fname, '')::numeric) AS sum_val
                FROM vector_features vf
                WHERE {where_sql} AND vf.properties->>:fname ~ '^[0-9]+(\.[0-9]+)?$';
            """)
            try:
                n_res = await db.execute(num_sql, {**sql_params, "fname": f_name})
                n_row = n_res.fetchone()
                if n_row and n_row.valid_num_count > 0:
                    charts["numeric_summaries"].append({
                        "field": f_name,
                        "title": f_label,
                        "count": n_row.valid_num_count,
                        "avg": round(float(n_row.avg_val), 2) if n_row.avg_val else 0,
                        "min": round(float(n_row.min_val), 2) if n_row.min_val else 0,
                        "max": round(float(n_row.max_val), 2) if n_row.max_val else 0,
                        "sum": round(float(n_row.sum_val), 2) if n_row.sum_val else 0,
                    })
                    analyzed_fields += 1
            except Exception:
                pass

    # If no fields were configured, extract top property keys dynamically
    if not charts["categories"] and total_count > 0:
        dyn_cat_sql = text(f"""
            SELECT
                COALESCE(NULLIF(TRIM(vf.properties->>'status'), ''), NULLIF(TRIM(vf.properties->>'type'), ''), NULLIF(TRIM(vf.properties->>'category'), ''), 'General') AS cat_val,
                COUNT(*) AS count
            FROM vector_features vf
            WHERE {where_sql}
            GROUP BY cat_val
            ORDER BY count DESC
            LIMIT 6;
        """)
        try:
            d_res = await db.execute(dyn_cat_sql, sql_params)
            d_rows = d_res.fetchall()
            if d_rows:
                charts["categories"].append({
                    "field": "category",
                    "title": "तह विशेषता विभाजन (Category Distribution)",
                    "type": "donut",
                    "data": [{"name": r.cat_val, "value": r.count} for r in d_rows],
                })
        except Exception:
            pass

    response_data = {
        "layer_id": layer.id,
        "layer_name": layer.name,
        "geometry_type": geom_type,
        "kpi_cards": kpi_cards,
        "geometry_summary": geom_summary,
        "charts": charts,
        "data_quality": {
            "total_count": total_count,
            "valid_geometry_count": valid_count,
            "valid_geometry_pct": validity_pct,
            "populated_props_count": populated_count,
            "completeness_pct": completeness_pct,
        },
        "extent_filter_applied": bool(bbox),
        "ward_filter_applied": ward,
    }

    # Store in Redis for 30 seconds
    try:
        redis_client = await get_redis()
        await redis_client.set(redis_key, json.dumps(response_data), ex=30)
    except Exception:
        pass

    return response_data
