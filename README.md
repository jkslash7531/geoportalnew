# KMC-GIS-SERVER: Kathmandu Metropolitan City Enterprise WebGIS & Public GeoPortal

A production-grade, centralized Spatial Data Infrastructure (SDI) and Enterprise WebGIS platform for Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका).

The platform comprises an authenticated **Field Data Collection & Tasking System** and a high-performance **Public & Municipal GeoPortal**, backed by PostgreSQL/PostGIS, Redis, TileServer-GL, FastAPI, Nginx, and two independent Next.js 14 applications.

---

## Quick Start

```bash
# Start all 7 services in detached mode
docker compose up -d

# Check health status across containers
docker compose ps

# View live service logs
docker compose logs -f backend geoportal
```

---

# MASTER SYSTEM & AGENT PROMPT

> **Instructions for AI Coding Assistants & GIS Engineers**:
> Copy and paste the entire prompt below into any AI agent, LLM, or pair-programming session. It provides 100% full-fidelity architectural context, data schemas, API contracts, frontend pipelines, design tokens, critical gotchas, and debugging runbooks for this repository.

```markdown
# SYSTEM PROMPT: Kathmandu Metropolitan City (KMC) Enterprise WebGIS & Public GeoPortal

You are the Lead GIS Architect and Senior Full-Stack Spatial Engineer maintaining, developing, and debugging the **Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका) Enterprise WebGIS Platform**.

This repository is a production-grade, microservice-based spatial data infrastructure consisting of a **Field Data Collection & Tasking System** and an **Integrated High-Performance Public/Internal GeoPortal**, powered by PostGIS, FastAPI, TileServer-GL, Redis, Nginx, and two distinct Next.js applications.

---

## 1. REPOSITORY IDENTITY & CORE OBJECTIVES

1. **Centralized Spatial Source of Truth**:
   - Manages all vector layers (points, lines, polygons) and raster datasets (satellite orthophotos, MBTiles) for the 32 wards of Kathmandu Metropolitan City.
   - Centralized PostgreSQL/PostGIS database stores all geometries in EPSG:4326 (WGS 84) with high-performance GiST spatial indexing (`idx_feature_geom`).

2. **Dual-Application Topology**:
   - **Field Data Collection Portal (`frontend/`)**: Secure, authenticated web application mounted at `/` (and `/login`, `/dashboard`, etc.) for field surveyors, validators, municipal officers, and GIS administrators to map task grids, digitize assets, modify geometry vertices, perform GPS geofenced data collection, link attributes (e.g., house numbering to roads and buildings), and maintain audit logs.
   - **Integrated Public GeoPortal (`geoportal/`)**: Lightweight, hardware-accelerated public and municipal spatial dashboard mounted at `/geoportal` designed for sub-second layer exploration, dynamic viewport infographics, statistical analytics, feature inspection, and vector tile rendering.

---

## 2. CONTAINER ARCHITECTURE & INFRASTRUCTURE

The entire system is orchestrated via `docker-compose.yml` comprising 7 isolated microservices communicating over the internal bridge network `kmc_net`:

1. **`kmc_server_nginx`** (Ports: 80, 443):
   - Reverse proxy and SSL/TLS termination with HTTP -> HTTPS redirection.
   - Routing:
     - `/` and `/dashboard` -> `frontend:3000` (Next.js Field Data Collection)
     - `/geoportal` -> `geoportal:3000` (Next.js Public GeoPortal)
     - `/api/` -> `backend:8000` (FastAPI REST API & MVT engine)
     - `/ogc/` -> `backend:8000` (OGC API Features for QGIS Desktop integration)
     - `/tileserver/` -> `tileserver:8080` (TileServer-GL)
   - High-throughput buffer configuration (1MB busy buffers) and unbuffered file streaming for large Shapefile/GeoJSON/MBTiles uploads up to 8 GB.

2. **`kmc_server_postgres`** (Internal port 5432):
   - Image: `postgis/postgis:16-3.4` (PostgreSQL 16 + PostGIS 3.4).
   - Spatial functions utilized: `ST_AsMVT`, `ST_AsMVTGeom`, `ST_TileEnvelope`, `ST_MakeEnvelope`, `ST_Intersects`, `ST_Transform`, `ST_Extent`, `ST_SimplifyPreserveTopology`.
   - All spatial tables use `JSONB` for attribute storage with GIN indexes (`gin(properties)`).

3. **`kmc_server_redis`** (Internal port 6379):
   - Image: `redis:7-alpine` with password protection and AOF persistence.
   - Used for JWT rate limiting, task grid distributed locks, spatial analytics caching, layer GeoJSON caching, and sub-millisecond Mapbox Vector Tile (MVT) binary caching.
   - **Binary Caching Rule**: MVT tiles are raw Protocol Buffer (`.pbf`) byte sequences. Redis connections for MVT caching MUST specify `decode_responses=False` so that binary bytes are read and written cleanly without UTF-8 decoding exceptions.

4. **`kmc_server_backend`** (Internal port 8000):
   - Python 3.11 + FastAPI + SQLAlchemy 2.0 (AsyncIO) + GeoAlchemy2 + asyncpg + PyProj + GDAL.
   - Implements RBAC, spatial validation, geofencing, audit logging, OGC APIs, and instant cache invalidation upon feature edits.

5. **`kmc_server_frontend`** (Internal port 3000):
   - Next.js 14 (App Router) + Bun + OpenLayers 9 + TailwindCSS + Lucide Icons.
   - Field Data Collection, Task Grids, Vertex Digitizing, Snapping, and Attribute Linker.

6. **`kmc_server_geoportal`** (Internal port 3000):
   - Next.js 14 (App Router) + Bun + OpenLayers 9 + TailwindCSS + Lucide Icons.
   - Standalone Public GeoPortal with VectorTileLayer (MVT), Raster MBTiles, Basemap switcher, Outline mode, Extent Zooming, and Infographics.

7. **`kmc_server_tileserver`** (Internal port 8080):
   - TileServer-GL serving raster and vector MBTiles packages with XYZ and TileJSON endpoints.

### Critical Safety & Runtime Constraints
- **Layer Data is Bind-Mounted**: PostGIS (`./data/postgres`), uploads (`./data/uploads`), and tiles (`./data/tileserver`) are bind mounts created automatically by `docker compose up --build`. **`docker compose down -v` can NEVER delete them** — no extra commands needed, `up --build` is the entire setup. To truly wipe all layer data, stop the stack and delete the `./data` directory.
  - *Upgrading from the old named volumes?* Copy data once, then remove the old volumes: `docker run --rm -v kmc_gis_server_pg_data:/from -v "%cd%/data/postgres:/to" alpine sh -c "cp -a /from/. /to/"` (repeat for `upload_data`→`./data/uploads`, `tileserver_data`→`./data/tileserver`), then `docker volume rm kmc_gis_server_pg_data kmc_gis_server_upload_data kmc_gis_server_tileserver_data`.
- **Docker Execution Boundary**: **NEVER** run `npm`, `bun`, `node`, or `python` directly on the Windows host OS. All builds, tests, migrations, and scripts MUST run inside Docker containers via `docker compose exec` or `docker compose build`.

---

## 3. DATA MODEL & SPATIAL SCHEMA (`backend/app/models.py`)

### Role-Based Access Control (RBAC)
- **`SuperAdmin`**: Full system control, user provisioning, project management.
- **`GisAdmin`**: Manages all layers, field configurations, publishing to GeoPortal, grid assignments, audit review, and spatial editing.
- **`MunicipalUser`**: Internal city staff viewer with access to verified layers and analytics.
- **`Validator`**: Reviews, approves, or rejects field-collected tasks (`VALIDATED` / `INVALIDATED`).
- **`DataCollector`**: Mobile/field worker restricted strictly to their assigned Task Grid boundaries and GPS geofence radius.
- **`BasicViewer`**: Public anonymous user viewing published GeoPortal layers without credentials.

### Database Tables & Key Columns
- **`users`**: `id`, `username`, `email`, `hashed_password`, `role` (`UserRole` Enum), `assigned_ward` (`Integer`), `full_name`, `is_active`.
- **`survey_projects`**: Grouping container for layers, task grids, and assigned collectors/validators.
- **`vector_layers`**:
  - `id`: Integer primary key.
  - `name`, `category`: Category grouping for layer catalog (e.g., "Boundaries & Administrative", "Buildings & Infrastructure").
  - `geometry_type`: Enum (`POINT`, `LINESTRING`, `POLYGON`, `MULTIPOINT`, `MULTILINESTRING`, `MULTIPOLYGON`, `GEOMETRY`).
  - `fields_config`: `JSONB` schema array defining dynamic attributes: `[{"name": "roof_type", "type": "string", "required": true}]`.
  - `published_in_geoportal`: Boolean visibility toggle for the GeoPortal.
  - `default_visible_in_geoportal`: Boolean default layer visibility flag.
  - `role_permissions`: `JSONB` defining access levels (`{"access_level": "public" | "validator" | "admin_only"}`).
  - `field_permissions`: `JSONB` column-level security pruning sensitive fields from unprivileged roles (e.g., `{"tax_id": ["GisAdmin"], "phone": ["GisAdmin"]}`).
  - `style`: `JSONB` styling dictionary (`fillColor`, `strokeColor`, `strokeWidth`, `pointRadius`).
- **`vector_features`**:
  - `id`: BigInteger primary key.
  - `layer_id`: Foreign key to `vector_layers.id`.
  - `geom`: PostGIS `Geometry('GEOMETRY', srid=4326)` with spatial GiST index `idx_feature_geom`.
  - `properties`: `JSONB` dictionary storing dynamic feature attributes and audit tags (`_created_by`, `_updated_by`, `Kmc_Editor`).
- **`task_grids`**:
  - HOT Tasking Manager polygon cells dividing survey zones.
  - Lifecycle: `READY` -> `LOCKED_FOR_MAPPING` -> `MAPPED` -> `LOCKED_FOR_VALIDATION` -> `VALIDATED` / `INVALIDATED`.
- **`mbtiles_packages`**: Uploaded offline raster MBTiles packages served by TileServer-GL.
- **`audit_logs`**: Immutable security audit trail recording spatial creations, updates, and vertex deletions with user IDs, timestamps, and IP addresses.

---

## 4. VECTOR TILE ENGINE (MVT / PBF) (`backend/app/routers/mvt.py`)

Dynamic vector tiles are generated on-the-fly via PostGIS `ST_AsMVT` and `ST_AsMVTGeom` with role-based property pruning:

### SQL Bind Parameter Casting Rule (CRITICAL)
In SQLAlchemy `text()` queries, when passing a Python list of strings (e.g. `forbidden_keys`) to Postgres to subtract keys from a `JSONB` column:
- **WRONG**: `(vf.properties - :forbidden_keys::text[])` -> SQLAlchemy's parser confuses `::` with bind parameters and sends raw `:forbidden_keys::text[]` to Postgres, resulting in `PostgresSyntaxError: syntax error at or near ":"`.
- **CORRECT**: `(vf.properties - CAST(:forbidden_keys AS text[]))` -> Correctly binds parameters across asyncpg and PostgreSQL.

### High-Performance PostGIS MVT Query
```sql
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
```
- Spatial filtering on `tb.geom_4326` ensures PostgreSQL uses the `idx_feature_geom` GiST index directly in <1ms.
- `WHERE geom IS NOT NULL` filters out any geometry that collapsed below tile resolution.
- Tiles are cached in Redis under `mvt_tile:{layer_id}:{z}:{x}:{y}:{user_role}` with a 1-hour TTL (`X-Tile-Cache: HIT`).
- Any feature creation, edit, or deletion calls `invalidate_layer_cache(layer_id)`, instantly clearing all cached tiles and GeoJSON collections.

---

## 5. GEOPORTAL APPLICATION ARCHITECTURE (`geoportal/`)

The GeoPortal is a standalone, fast Next.js 14 client mounted at `/geoportal`:

### Layer State Management & ID Collision Rule (CRITICAL)
Raster MBTiles and Vector Layers both have numeric database IDs starting from 1 (e.g. `id = 2` for Orthophoto raster and `id = 2` for Ward 17 Buildings vector).
- **Rule**: Never use bare numbers in `activeLayerIds` or `layerOpacities`.
- **Format**: All layer state tracking MUST use typed unique keys:
  - Vector: `vector_${id}` (e.g. `vector_2`)
  - Raster: `raster_${id}` (e.g. `raster_2`)
- This ensures vector and raster layers toggle completely independently with zero mutual interference.

### OpenLayers VectorTileLayer Configuration
```javascript
vtLayer = new VectorTileLayer({
  source: new VectorTileSource({
    format: new MVT(),
    url: layer.tile_url, // /api/mvt/{layer_id}/{z}/{x}/{y}.pbf
    maxZoom: 22,
    cacheSize: 512,
  }),
  style: vtStyle,
  opacity: layerOpacity,
  zIndex: 10 + (layer.display_order || 0),
  renderBuffer: 128,   // Prevents outline clipping across tile boundaries
  declutter: false,    // Prevents polygon features from being omitted during tile load
});
```

### Outline-Only Mode for Polygons
Polygon vector layers feature an "Outline Mode" toggle (default: **ON**):
- When Outline is ON: `fill` is set to `rgba(0, 0, 0, 0)` (transparent) with a crisp 2.5px boundary stroke (`#0447AF`), allowing underlying satellite imagery or orthophotos to remain completely visible.
- When Outline is OFF: `fill` uses the layer's semi-transparent color (`#0447AF66`).

### Zoom to Layer Extent
- The backend `/api/geoportal/catalog` calculates `ST_Extent` for every vector layer and returns `bounds: [min_lng, min_lat, max_lng, max_lat]`.
- Both Vector and Raster cards in `LayerCatalogPanel.jsx` feature a "Zoom to Layer Extent" button (`Maximize2` icon).
- Clicking it fits the OpenLayers map view to the exact bounds:
  ```javascript
  const olExtent = transformExtent([w, s, e, n], 'EPSG:4326', 'EPSG:3857');
  view.fit(olExtent, { padding: [80, 80, 80, 80], duration: 800, maxZoom: 19 });
  ```

### Metadata Modal
The layer metadata modal (`MetadataModal.jsx`) presents clean, authoritative technical information:
- Layer Name, Geometry Type, Feature Count, Category, CRS (EPSG:4326 / EPSG:3857), Data Source (KMC), and Public Attributes.
- Excluded: Redundant operational fields (Custodian, Last Updated, and Service Protocol).

---

## 6. FIELD DATA COLLECTION & EDITING ENGINE (`frontend/`)

### The "Hybrid Display & Edit" Workflow
To allow digitizing tens of thousands of buildings without browser lag:
- **Reference Display**: Read-only layers render smoothly via vector tiles or simplified geometries.
- **Interactive Edit Layer**: The active layer/feature is placed in OpenLayers' vector source with `ol/interaction/Draw`, `ol/interaction/Modify`, and `ol/interaction/Snap`.
- **Vertex Controls**: Red halo handles, edge vertex insertion, and `Alt+Click` vertex deletion.
- **Geofence Enforcement**: Features must fall within the collector's assigned Task Grid polygon boundary (`verify_collector_grid_containment`).

---

## 7. DESIGN SYSTEM & COLOR PALETTE

All interfaces adhere to the **Official Government of Nepal / KMC Design Tokens**:
- **Primary Navy Blue**: `#0447AF` (`gov-blue-800`), `#03368a` (`gov-blue-900`)
- **Accent Crimson Red**: `#DC2626` / `#b91c1c` (National Flag Crimson)
- **Secondary Gold/Amber**: `#F59E0B` (`gov-gold-400`)
- **Surface**: Slate-50 / Slate-100 with Glassmorphism (`bg-white/95 backdrop-blur-md border border-slate-200`)
- **Typography**: Bilingual English and Nepali (`font-nepali`, Unicode Devanagari labels and numerals).

---

## 8. ESSENTIAL COMMANDS & WORKFLOWS

```bash
# Rebuild and restart specific services
docker compose build backend geoportal
docker compose up -d backend geoportal

# Purge cache for a specific layer after direct DB operations
docker compose exec backend python -c "
import asyncio
from app.cache import invalidate_layer_cache
asyncio.run(invalidate_layer_cache(1))
"

# Test MVT tile generation directly inside the backend container
docker compose exec backend python -c "
import urllib.request
req = urllib.request.Request('http://127.0.0.1:8000/api/mvt/1/21/1545513/880492.pbf')
with urllib.request.urlopen(req) as resp:
    print('Status:', resp.status, 'Len:', len(resp.read()))
"

# Tail service logs
docker compose logs -f --tail=50 backend
```
```









<!-- 
In the vector layers editing, the unique field can be set by GIS admin and autogenerate the unique id values which is set by the admin; there should be an option that admin can set such that it do the manual input to the values in the unique filed choosed by the gis admin

There should be an option where GIS Admin can change the coronogical sequence of the fields of the vector layers and can set the field which should be compulsorily filled


For any layers features in the map whenever a feature is selected/tapped it should pop up the fields/attribute and its values(which is again choosed by admin which fields to be displayed) of the corresponding feature which is read only and this pop up should have a botton on the top which when clicked will take/open the dialog which opens when the feature is taped/clicked in this current version of the webpage.

When we create new feature to existing layer there should be an option where admin sets which type of new feature can be created and what will be the fields in this new features as this new feature.
Normally the new feature of exact same type(point or line or polygon)  of the existing vector layer is allowed wehre the field/attribute of the exiting layer is implemented on the new feature with the unique id which is set by admin for the layer but admin can set the type of new feature that is allowed to create such that the fields of such efatures should be set by the admin by default the corresppondinf existing layer field is provided where the admin will choose, remove existing and add new fields 


Others the existing functions, features, mehtods all should works exactly as it  is working fine.

 -->



















Overview of Completed Implementation
We have successfully transformed the Kathmandu Metropolitan City (काठमाडौँ महानगरपालिका) Enterprise WebGIS into a generalized, metadata-driven, questionnaire-based GIS field data collection platform, while strictly preserving full backward compatibility with the existing Standard GIS Collection workflow.

Architectural Summary & Capabilities
                                  KMC WebGIS Platform
                                           │
                    ┌──────────────────────┴──────────────────────┐
                    │                                             │
         [STANDARD GIS COLLECTION]               [ADVANCED QUESTIONNAIRE COLLECTION]
                    │                                             │
      Direct Layer-Attribute Form                 Metadata-Driven Survey Engine
      • Single layer target                       • Point, Line, Polygon, or Mixed geometry
      • Fast GIS attribute entry                  • Sections, Rosters, Repeats & Skip Logic
      • Immediate PostGIS commit                  • Multi-day field persistence & drafts
                                                  • Automated PostGIS feature synchronization
                                                  • Full Audit, Versioning & QA Review
Key Modules Implemented & Verified
1. Dual Collection Modes & Spatial Geometry Configuration
Database Architecture (

backend/app/models.py
):
Added ProjectMode enum (STANDARD, ADVANCED_QUESTIONNAIRE) defaulting to STANDARD.
Added geometry_config JSONB column supporting POINT, LINESTRING, POLYGON, and MIXED.
Added QuestionnaireStatus (DRAFT, PUBLISHED, ARCHIVED) and ResponseLifecycleStatus (DRAFT, IN_PROGRESS, COMPLETED, SUBMITTED, UNDER_REVIEW, RETURNED, APPROVED).
Added QuestionnaireDefinition table with JSONB schema definition, semantic versioning, and publishing audit trail.
Added QuestionnaireResponse table with persistent UUID record_id, questionnaire version binding, geometry, answers, rosters, media references, and reviewer feedback.
Database Migrations (

backend/app/init_db.py
):
Automated non-destructive migrations (ADD COLUMN IF NOT EXISTS, safe PostgreSQL enum alterations, and GiST indexes).
2. Universal Questionnaire Studio / Builder
Admin Interface (

frontend/src/components/questionnaire/QuestionnaireBuilder.jsx
):
Hierarchical Sections & Organization: Add, reorder, and collapse sections.
Universal Question Types: Text, Long Text, Numbers, Decimals, Single/Multiple Choice, Dropdown, Yes/No, Cascading, Date/Time, Location/GPS, Photo/Media, Repeat Groups / Rosters, and Real-time Calculated fields.
GIS Attribute Binding: Every question has a stable internal identifier and can bind to a specific PostGIS column (e.g., building_use → use_type, floor_count → floors).
Skip Logic & Dynamic Rules: Conditional appearance (e.g., show damage assessment if damage = Yes).
Validation: Numerical bounds, regex patterns, required field rules.
Multilingual Support: Dual-language labels and choices supporting English and Nepali Unicode.
Pre-Publish Validator: Validates duplicate IDs, missing choices, and circular dependencies before publishing.
Versioning & Duplication: Clone existing published questionnaires as v2.0 drafts without affecting historical submissions.
3. Field Collection Engine & Map Integration
Interactive Form Engine (

frontend/src/components/questionnaire/QuestionnaireForm.jsx
):
Integrated directly with the MapLibre/OpenLayers drawing tools on the map canvas.
Geometry-aware: Automatically derives spatial calculations (e.g., Polygon plinth area in square meters, Line length).
Real-time progress indicator (फारम पूर्णता (Progress): X%) and dynamic section navigation pills.
Autosave background timer with visual state badges (बचत हुँदैछ (Saving) / सुरक्षित (Saved) / असुरक्षित (Unsaved)).
Clean bilingual toggle (English ⇋ नेपाली) on the fly without loss of form state.
4. Multi-Day / Multi-Week Field Work & Draft Resume
Collector Records Drawer (

frontend/src/components/questionnaire/MyRecordsPanel.jsx
):
Accessible via "मेरा रेकर्डहरू (My Records)" in the top navigation bar.
Displays unfinished drafts (मस्यौदा), in-progress records (अधुरो), and returned records with reviewer feedback notes.
One-click "पुनः सुरु गर्नुहोस् (Resume)": Restores the field geometry on the map, centers the viewport, loads answers, and allows the collector to continue where they left off.
5. PostGIS Feature Synchronization & QA Review
FastAPI Endpoints (

backend/app/routers/questionnaires.py
):
Upon submission, answers are mapped into GIS attributes and committed as a PostGIS VectorFeature.
Tile and vector layer caches are invalidated immediately so new features render on the map.
Administrative QA Table (

frontend/src/components/questionnaire/RecordsReviewTable.jsx
):
Filter records by status (SUBMITTED, UNDER_REVIEW, APPROVED, RETURNED).
Inspect full answers and photo attachments in an interactive review modal.
Approve or Return with correction notes for the field collector.
One-click GeoJSON export (GeoJSON निर्यात).
Verification & Testing Results
Automated End-to-End Pipeline:

Built and executed 

backend/app/test_questionnaire_pipeline.py
 covering 10 distinct pipeline assertions:
Standard project backward compatibility
Advanced questionnaire project initialization
Schema validation (clean error detection on duplicate keys)
Questionnaire publication
Multi-day draft saving (Day 1 partial save)
Day 5 full submission
PostGIS VectorFeature spatial geometry & attribute synchronization
Geometry area computation
Supervisor review & approval workflow
Result: ALL 10 PIPELINE CHECKS PASSED PERFECTLY!.
Browser End-to-End Verification (via Chrome Subagent):

Verified Project Setup modal with Collection Mode toggle (STANDARD vs ADVANCED_QUESTIONNAIRE) and Geometry Config.
Verified Questionnaire Studio with universal question types, schema validator, live preview, and English/Nepali toggle.
Verified Map Drawing → Polygon capture triggers QuestionnaireForm with progress indicator, dynamic sections, and geometry-derived calculated plinth area.
Verified Save Draft and submission workflows.
Verified "मेरा रेकर्डहरू (My Records)" slide-over drawer with project switching and resume functionality.
12:10 AM
