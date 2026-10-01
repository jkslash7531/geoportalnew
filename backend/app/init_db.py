"""
KMC-GIS-SERVER Database Initialization
Creates tables, extensions, and seeds the default superuser.
"""

import os
import json
import sqlite3
from pathlib import Path
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import engine, AsyncSessionLocal, Base, init_extensions
from app.models import User, UserRole, MBTilesPackage, PlatformModule
from app.auth import hash_password
from app.config import get_settings

settings = get_settings()


async def init_database():
    """
    Initialize the database safely across multiple uvicorn workers:
    1. Acquire Postgres advisory lock so only one worker initializes
    2. Create extensions
    3. Safely update enums
    4. Create all tables from ORM metadata
    5. Sync schema columns & indexes
    6. Seed default superuser and platform modules
    """
    # Step 1: Extensions & Pre-existing Enum Expansions (Outside transaction with AUTOCOMMIT)
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        
        # Extensions
        extensions = ["postgis", "postgis_topology", "pg_trgm", '"uuid-ossp"']
        for ext in extensions:
            try:
                await conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {ext};"))
            except Exception:
                pass

        # Check if userrole type exists on pre-existing database before ALTER TYPE
        try:
            type_check = await conn.execute(text("SELECT 1 FROM pg_type WHERE typname = 'userrole';"))
            if type_check.scalar_one_or_none():
                for role_val in ["SuperAdmin", "MunicipalUser", "BasicViewer"]:
                    try:
                        await conn.execute(text(f"ALTER TYPE userrole ADD VALUE IF NOT EXISTS '{role_val}';"))
                    except Exception:
                        pass
        except Exception:
            pass

        # Create or update projectmode, questionnairestatus, responselifecyclestatus enums
        new_enums = [
            ("projectmode", ["STANDARD", "ADVANCED_QUESTIONNAIRE"]),
            ("questionnairestatus", ["DRAFT", "PUBLISHED", "ARCHIVED"]),
            ("responselifecyclestatus", ["DRAFT", "IN_PROGRESS", "COMPLETED", "SUBMITTED", "UNDER_REVIEW", "RETURNED", "APPROVED"]),
        ]
        for enum_name, enum_vals in new_enums:
            try:
                tc = await conn.execute(text(f"SELECT 1 FROM pg_type WHERE typname = '{enum_name}';"))
                if not tc.scalar_one_or_none():
                    val_str = ", ".join(f"'{v}'" for v in enum_vals)
                    await conn.execute(text(f"CREATE TYPE {enum_name} AS ENUM ({val_str});"))
                else:
                    for v in enum_vals:
                        try:
                            await conn.execute(text(f"ALTER TYPE {enum_name} ADD VALUE IF NOT EXISTS '{v}';"))
                        except Exception:
                            pass
            except Exception:
                pass

    # Step 2: Create All Tables from ORM Metadata (with Advisory Lock)
    async with engine.begin() as conn:
        await conn.execute(text("SELECT pg_advisory_xact_lock(847291);"))
        await conn.run_sync(Base.metadata.create_all)

    # Step 3: Safe schema synchronization for existing databases (AUTOCOMMIT)
    async with engine.connect() as conn:
        conn = await conn.execution_options(isolation_level="AUTOCOMMIT")
        sync_sqls = [
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS allow_snapping BOOLEAN DEFAULT TRUE NOT NULL;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS fields_config JSONB DEFAULT '[]'::jsonb;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'General' NOT NULL;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0 NOT NULL;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS published_in_geoportal BOOLEAN DEFAULT TRUE NOT NULL;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS default_visible_in_geoportal BOOLEAN DEFAULT FALSE NOT NULL;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS opacity DOUBLE PRECISION DEFAULT 1.0 NOT NULL;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS role_permissions JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS field_permissions JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS dashboard_config JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE vector_layers ADD COLUMN IF NOT EXISTS metadata_info JSONB DEFAULT '{}'::jsonb;",
            "CREATE INDEX IF NOT EXISTS idx_vl_category ON vector_layers(category);",
            "CREATE INDEX IF NOT EXISTS idx_vl_published ON vector_layers(published_in_geoportal);",
            "ALTER TABLE mbtiles_packages ALTER COLUMN file_size TYPE BIGINT;",
            "ALTER TABLE mbtiles_packages ADD COLUMN IF NOT EXISTS center JSONB;",
            "ALTER TABLE mbtiles_packages ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'Base Maps' NOT NULL;",
            "ALTER TABLE mbtiles_packages ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0 NOT NULL;",
            "ALTER TABLE mbtiles_packages ADD COLUMN IF NOT EXISTS published_in_geoportal BOOLEAN DEFAULT TRUE NOT NULL;",
            "ALTER TABLE mbtiles_packages ADD COLUMN IF NOT EXISTS default_visible BOOLEAN DEFAULT FALSE NOT NULL;",
            "ALTER TABLE mbtiles_packages ADD COLUMN IF NOT EXISTS role_permissions JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE media_attachments ALTER COLUMN file_size TYPE BIGINT;",
            "ALTER TABLE survey_projects ALTER COLUMN boundary TYPE geometry(Geometry, 4326);",
            "ALTER TABLE task_grids ALTER COLUMN geom TYPE geometry(Geometry, 4326);",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS name VARCHAR(255);",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP;",
            "ALTER TABLE task_grids ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL;",
            "ALTER TABLE vector_features ALTER COLUMN properties TYPE JSONB USING properties::jsonb;",
            "ALTER TABLE task_grids ALTER COLUMN properties TYPE JSONB USING properties::jsonb;",
            "ALTER TABLE vector_layers ALTER COLUMN role_permissions TYPE JSONB USING role_permissions::jsonb;",
            "ALTER TABLE vector_layers ALTER COLUMN field_permissions TYPE JSONB USING field_permissions::jsonb;",
            "ALTER TABLE vector_layers ALTER COLUMN dashboard_config TYPE JSONB USING dashboard_config::jsonb;",
            "ALTER TABLE vector_layers ALTER COLUMN metadata_info TYPE JSONB USING metadata_info::jsonb;",
            "ALTER TABLE vector_layers ALTER COLUMN fields_config TYPE JSONB USING fields_config::jsonb;",
            "ALTER TABLE vector_layers ALTER COLUMN style TYPE JSONB USING style::jsonb;",
            "ALTER TABLE mbtiles_packages ALTER COLUMN role_permissions TYPE JSONB USING role_permissions::jsonb;",
            "ALTER TABLE mbtiles_packages ALTER COLUMN bounds TYPE JSONB USING bounds::jsonb;",
            "ALTER TABLE mbtiles_packages ALTER COLUMN center TYPE JSONB USING center::jsonb;",
            "ALTER TABLE survey_projects ALTER COLUMN form_schema TYPE JSONB USING form_schema::jsonb;",
            "ALTER TABLE house_numbers ALTER COLUMN properties TYPE JSONB USING properties::jsonb;",
            "ALTER TABLE audit_logs ALTER COLUMN details TYPE JSONB USING details::jsonb;",
            "CREATE INDEX IF NOT EXISTS idx_vf_properties ON vector_features USING gin(properties);",
            """
            CREATE TABLE IF NOT EXISTS project_collector_assignments (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES survey_projects(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                assigned_by INTEGER NOT NULL REFERENCES users(id),
                assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_project_collector UNIQUE (project_id, user_id)
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_pca_project ON project_collector_assignments(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_pca_user ON project_collector_assignments(user_id);",
            """
            CREATE TABLE IF NOT EXISTS collector_live_locations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom geometry(Point, 4326) NOT NULL,
                accuracy DOUBLE PRECISION,
                altitude DOUBLE PRECISION,
                heading DOUBLE PRECISION,
                speed DOUBLE PRECISION,
                battery_level DOUBLE PRECISION,
                is_online BOOLEAN NOT NULL DEFAULT TRUE,
                last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
                app_state VARCHAR(50) DEFAULT 'active',
                device_info JSONB
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_cll_user ON collector_live_locations(user_id);",
            "CREATE INDEX IF NOT EXISTS idx_cll_geom ON collector_live_locations USING gist(geom);",
            """
            CREATE TABLE IF NOT EXISTS collector_location_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                geom geometry(Point, 4326) NOT NULL,
                accuracy DOUBLE PRECISION,
                speed DOUBLE PRECISION,
                heading DOUBLE PRECISION,
                timestamp TIMESTAMP NOT NULL DEFAULT NOW()
            );
            """,
            "CREATE INDEX IF NOT EXISTS idx_cll_logs_user ON collector_location_logs(user_id);",
            "CREATE INDEX IF NOT EXISTS idx_cll_logs_time ON collector_location_logs(timestamp);",
            "CREATE INDEX IF NOT EXISTS idx_cll_logs_geom ON collector_location_logs USING gist(geom);",
            "ALTER TABLE survey_projects ADD COLUMN IF NOT EXISTS project_mode projectmode DEFAULT 'STANDARD' NOT NULL;",
            "ALTER TABLE survey_projects ADD COLUMN IF NOT EXISTS geometry_config JSONB DEFAULT '{}'::jsonb;",
            "ALTER TABLE survey_projects ADD COLUMN IF NOT EXISTS active_questionnaire_id INTEGER REFERENCES questionnaire_definitions(id) ON DELETE SET NULL;",
            "CREATE INDEX IF NOT EXISTS idx_sp_project_mode ON survey_projects(project_mode);",
            "CREATE INDEX IF NOT EXISTS idx_qd_project ON questionnaire_definitions(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_qd_status ON questionnaire_definitions(status);",
            "CREATE INDEX IF NOT EXISTS idx_qr_project ON questionnaire_responses(project_id);",
            "CREATE INDEX IF NOT EXISTS idx_qr_questionnaire ON questionnaire_responses(questionnaire_id);",
            "CREATE INDEX IF NOT EXISTS idx_qr_feature ON questionnaire_responses(feature_id);",
            "CREATE INDEX IF NOT EXISTS idx_qr_collector ON questionnaire_responses(collector_id);",
            "CREATE INDEX IF NOT EXISTS idx_qr_status ON questionnaire_responses(status);",
            "CREATE INDEX IF NOT EXISTS idx_qr_geom ON questionnaire_responses USING gist(geom);",
        ]
        for sql in sync_sqls:
            try:
                await conn.execute(text(sql))
            except Exception:
                pass

    # Seed superuser
    await seed_superuser()

    # Seed platform modules
    await seed_platform_modules()

    # Backfill MBTiles center metadata for existing packages
    await backfill_mbtiles_centers()

    # Auto-register any existing MBTiles packages sitting in storage
    await auto_register_existing_mbtiles()

    # Synchronize TileServer configuration with database MBTiles packages
    await sync_tileserver_config()


async def seed_platform_modules():
    """Seed the default platform modules if not present."""
    default_modules = [
        {
            "code": "field_data",
            "name": "Field Data Collection",
            "description": "क्षेत्रीय तथ्याङ्क संकलन, नक्साङ्कन तथा स्थलगत सर्वेक्षण",
            "icon": "ClipboardList",
            "route": "/dashboard",
            "is_enabled": True,
            "allowed_roles": ["SuperAdmin", "GisAdmin", "MunicipalUser", "DataCollector", "Validator"],
            "display_order": 1,
        },
        {
            "code": "geoportal",
            "name": "GeoPortal & Dashboard",
            "description": "एकीकृत भू-स्थानिक पोर्टल, डायनामिक तह सूची तथा विश्लेषणात्मक इन्फोग्राफिक्स",
            "icon": "Globe",
            "route": "/geoportal",
            "is_enabled": True,
            "allowed_roles": ["SuperAdmin", "GisAdmin", "MunicipalUser", "BasicViewer", "DataCollector", "Validator"],
            "display_order": 2,
        },
        {
            "code": "house_numbering",
            "name": "House Numbering System",
            "description": "सडक आधारित घर नम्बर, चेनिएज, बिजोर/जोर साइड प्रणाली तथा ठेगाना व्यवस्थापन",
            "icon": "Home",
            "route": "/dashboard?module=house_numbering",
            "is_enabled": True,
            "allowed_roles": ["SuperAdmin", "GisAdmin", "MunicipalUser"],
            "display_order": 3,
        },
    ]

    async with AsyncSessionLocal() as db:
        try:
            for mod in default_modules:
                res = await db.execute(select(PlatformModule).where(PlatformModule.code == mod["code"]))
                if not res.scalar_one_or_none():
                    db.add(PlatformModule(**mod))
            await db.commit()
            print("[INIT] Platform modules verified / seeded.")
        except Exception as e:
            await db.rollback()
            print(f"[INIT] Platform module seeding handled: {e}")


async def sync_tileserver_config():
    """Ensure TileServer config.json exists and matches packages registered in the database."""
    from app.tileserver import regenerate_tileserver_config
    try:
        async with AsyncSessionLocal() as db:
            await regenerate_tileserver_config(db)
    except Exception as e:
        print(f"[INIT] TileServer config sync handled: {e}")


async def seed_superuser():
    """
    Create or synchronize the default GisAdmin superuser from environment variables.
    Protected with advisory lock and error recovery to prevent multi-worker races.
    """
    async with AsyncSessionLocal() as db:
        try:
            # Transaction advisory lock (ID: 847292)
            await db.execute(text("SELECT pg_advisory_xact_lock(847292);"))
            result = await db.execute(
                select(User).where(User.username == settings.ADMIN_USERNAME)
            )
            existing = result.scalar_one_or_none()

            if existing is None:
                # Fallback check for user id=1 in case ADMIN_USERNAME was renamed in .env
                res_id1 = await db.execute(select(User).where(User.id == 1))
                existing = res_id1.scalar_one_or_none()

            if existing is None:
                admin_user = User(
                    username=settings.ADMIN_USERNAME,
                    email=settings.ADMIN_EMAIL,
                    hashed_password=hash_password(settings.ADMIN_PASSWORD),
                    full_name=settings.ADMIN_FULL_NAME,
                    role=UserRole.GisAdmin,
                    is_active=True,
                )
                db.add(admin_user)
                await db.commit()
                print(f"[INIT] Default superuser '{settings.ADMIN_USERNAME}' created successfully.")
            else:
                # Synchronize credentials from .env to the existing superuser
                existing.username = settings.ADMIN_USERNAME
                existing.email = settings.ADMIN_EMAIL
                existing.full_name = settings.ADMIN_FULL_NAME
                existing.hashed_password = hash_password(settings.ADMIN_PASSWORD)
                existing.is_active = True
                existing.role = UserRole.GisAdmin
                await db.commit()
                print(f"[INIT] Superuser '{settings.ADMIN_USERNAME}' credentials synchronized from .env.")
        except Exception as e:
            await db.rollback()
            # If another worker seeded simultaneously, that is expected
            print(f"[INIT] Superuser seed handled cleanly.")


async def backfill_mbtiles_centers():
    """
    One-time startup task: scan all MBTilesPackage records that have center=NULL,
    re-read center metadata from the .mbtiles SQLite file, and update the DB.
    """
    from app.tileserver import extract_mbtiles_metadata, TILESERVER_DATA_DIR

    async with AsyncSessionLocal() as db:
        try:
            await db.execute(text("SELECT pg_advisory_xact_lock(847293);"))
            result = await db.execute(
                select(MBTilesPackage).where(MBTilesPackage.center.is_(None))
            )
            packages = result.scalars().all()

            if not packages:
                return

            updated = 0
            for pkg in packages:
                try:
                    meta = extract_mbtiles_metadata(pkg.filename)
                    center = meta.get("center")
                    if center:
                        pkg.center = center
                        updated += 1
                except Exception:
                    pass

            if updated > 0:
                await db.commit()
                print(f"[INIT] Backfilled center metadata for {updated} MBTiles packages.")
        except Exception as e:
            await db.rollback()
            print(f"[INIT] MBTiles center backfill handled: {e}")


async def auto_register_existing_mbtiles():
    """
    Scan TILESERVER_DATA_DIR for any .mbtiles packages not yet registered in the DB
    (e.g., after docker compose down -v or initial setup) and auto-register them.
    """
    from app.tileserver import extract_mbtiles_metadata, get_file_size, regenerate_tileserver_config, TILESERVER_DATA_DIR
    if not os.path.exists(TILESERVER_DATA_DIR):
        return

    async with AsyncSessionLocal() as db:
        try:
            await db.execute(text("SELECT pg_advisory_xact_lock(847294);"))
            user_res = await db.execute(select(User).limit(1))
            user = user_res.scalar_one_or_none()
            user_id = user.id if user else 1

            new_count = 0
            for f in os.listdir(TILESERVER_DATA_DIR):
                if f.endswith('.mbtiles') and not f.startswith('.'):
                    existing = await db.execute(select(MBTilesPackage).where(MBTilesPackage.filename == f))
                    if not existing.scalar_one_or_none():
                        meta = extract_mbtiles_metadata(f)
                        size = get_file_size(f)
                        name = "Kmc_OrthoPhoto" if "kmc" in f.lower() else f.replace('.mbtiles', '').replace('_', ' ')
                        pkg = MBTilesPackage(
                            name=name,
                            filename=f,
                            description="Kathmandu Metropolitan City High-Resolution Aerial Orthophoto Imagery",
                            category="Base Maps",
                            bounds=meta.get("bounds"),
                            center=meta.get("center"),
                            min_zoom=meta.get("min_zoom", 0),
                            max_zoom=meta.get("max_zoom", 22),
                            file_size=size,
                            is_global=True,
                            published_in_geoportal=True,
                            default_visible=False,
                            role_permissions={"access_level": "public"},
                            uploaded_by=user_id,
                        )
                        db.add(pkg)
                        new_count += 1
            if new_count > 0:
                await db.commit()
                await regenerate_tileserver_config(db)
                print(f"[INIT] Auto-registered {new_count} MBTiles package(s) from storage.")
        except Exception as e:
            await db.rollback()
            print(f"[INIT] MBTiles auto-registration handled: {e}")


