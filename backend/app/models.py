"""
KMC-GIS-SERVER ORM Models
All database models with GeoAlchemy2 spatial columns.
"""

import enum
from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Float, Boolean, DateTime,
    ForeignKey, Enum, Index, UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB as JSON
from sqlalchemy.orm import relationship
from geoalchemy2 import Geometry
from app.database import Base


# ============================================================
# Enums
# ============================================================

class UserRole(str, enum.Enum):
    SuperAdmin = "SuperAdmin"
    GisAdmin = "GisAdmin"
    MunicipalUser = "MunicipalUser"
    DataCollector = "DataCollector"
    Validator = "Validator"
    BasicViewer = "BasicViewer"


class TaskStatus(str, enum.Enum):
    READY = "READY"
    LOCKED_FOR_MAPPING = "LOCKED_FOR_MAPPING"
    MAPPED = "MAPPED"
    LOCKED_FOR_VALIDATION = "LOCKED_FOR_VALIDATION"
    VALIDATED = "VALIDATED"
    INVALIDATED = "INVALIDATED"
    SPLIT = "SPLIT"


class GridType(str, enum.Enum):
    SQUARE = "SQUARE"
    HEXAGON = "HEXAGON"
    TRIANGLE = "TRIANGLE"


class ProjectStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    ARCHIVED = "ARCHIVED"


class ProjectMode(str, enum.Enum):
    STANDARD = "STANDARD"
    ADVANCED_QUESTIONNAIRE = "ADVANCED_QUESTIONNAIRE"


class QuestionnaireStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class ResponseLifecycleStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    SUBMITTED = "SUBMITTED"
    UNDER_REVIEW = "UNDER_REVIEW"
    RETURNED = "RETURNED"
    APPROVED = "APPROVED"


class GeometryType(str, enum.Enum):
    POINT = "POINT"
    LINESTRING = "LINESTRING"
    POLYGON = "POLYGON"
    MULTIPOINT = "MULTIPOINT"
    MULTILINESTRING = "MULTILINESTRING"
    MULTIPOLYGON = "MULTIPOLYGON"
    GEOMETRY = "GEOMETRY"


# ============================================================
# User Model
# ============================================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.DataCollector)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    created_projects = relationship("SurveyProject", back_populates="creator", foreign_keys="SurveyProject.created_by")
    locked_tasks = relationship("TaskGrid", back_populates="locker", foreign_keys="TaskGrid.locked_by")
    validated_tasks = relationship("TaskGrid", back_populates="validator_user", foreign_keys="TaskGrid.validated_by")
    assigned_tasks = relationship("TaskGrid", back_populates="assigned_user", foreign_keys="TaskGrid.assigned_to")
    assigned_projects = relationship("ProjectCollectorAssignment", back_populates="user", foreign_keys="ProjectCollectorAssignment.user_id", cascade="all, delete-orphan")
    live_location = relationship("CollectorLiveLocation", back_populates="user", uselist=False, cascade="all, delete-orphan")


# ============================================================
# Survey Project Model
# ============================================================

class SurveyProject(Base):
    __tablename__ = "survey_projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    boundary = Column(Geometry(geometry_type="GEOMETRY", srid=4326), nullable=True)
    grid_type = Column(Enum(GridType), default=GridType.SQUARE)
    grid_size_m = Column(Float, default=100.0)
    form_schema = Column(JSON, nullable=True)
    status = Column(Enum(ProjectStatus), default=ProjectStatus.DRAFT, nullable=False)
    project_mode = Column(Enum(ProjectMode), default=ProjectMode.STANDARD, nullable=False)
    geometry_config = Column(JSON, default=dict, nullable=True)
    active_questionnaire_id = Column(Integer, ForeignKey("questionnaire_definitions.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    creator = relationship("User", back_populates="created_projects", foreign_keys=[created_by])
    task_grids = relationship("TaskGrid", back_populates="project", cascade="all, delete-orphan")
    collector_assignments = relationship("ProjectCollectorAssignment", back_populates="project", cascade="all, delete-orphan")
    layer_assignments = relationship("ProjectLayerAssignment", back_populates="project", cascade="all, delete-orphan")
    mbtiles_assignments = relationship("ProjectMBTilesAssignment", back_populates="project", cascade="all, delete-orphan")
    project_layers = relationship("VectorLayer", back_populates="project", foreign_keys="VectorLayer.project_id")
    project_mbtiles = relationship("MBTilesPackage", back_populates="project", foreign_keys="MBTilesPackage.project_id")
    questionnaires = relationship("QuestionnaireDefinition", back_populates="project", foreign_keys="QuestionnaireDefinition.project_id", cascade="all, delete-orphan")
    field_records = relationship("QuestionnaireResponse", back_populates="project", foreign_keys="QuestionnaireResponse.project_id", cascade="all, delete-orphan")
    active_questionnaire = relationship("QuestionnaireDefinition", foreign_keys=[active_questionnaire_id], post_update=True)

    __table_args__ = (
        Index("idx_project_boundary", "boundary", postgresql_using="gist"),
    )


# ============================================================
# Task Grid Model
# ============================================================

class TaskGrid(Base):
    __tablename__ = "task_grids"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    grid_index = Column(Integer, nullable=False)
    name = Column(String(255), nullable=True)
    geom = Column(Geometry(geometry_type="GEOMETRY", srid=4326), nullable=False)
    status = Column(Enum(TaskStatus), default=TaskStatus.READY, nullable=False, index=True)
    assigned_to = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_at = Column(DateTime, nullable=True)
    assigned_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    properties = Column(JSON, nullable=True)
    locked_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    locked_at = Column(DateTime, nullable=True)
    mapped_at = Column(DateTime, nullable=True)
    validated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    validated_at = Column(DateTime, nullable=True)

    # Relationships
    project = relationship("SurveyProject", back_populates="task_grids")
    assigned_user = relationship("User", back_populates="assigned_tasks", foreign_keys=[assigned_to])
    assigner_user = relationship("User", foreign_keys=[assigned_by])
    locker = relationship("User", back_populates="locked_tasks", foreign_keys=[locked_by])
    validator_user = relationship("User", back_populates="validated_tasks", foreign_keys=[validated_by])

    __table_args__ = (
        Index("idx_task_geom", "geom", postgresql_using="gist"),
        UniqueConstraint("project_id", "grid_index", name="uq_project_grid_index"),
    )


# ============================================================
# Vector Layer Model (Global or Project-Scoped)
# ============================================================

class VectorLayer(Base):
    __tablename__ = "vector_layers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    geometry_type = Column(Enum(GeometryType), default=GeometryType.GEOMETRY)
    style = Column(JSON, nullable=True)
    editable_by_collectors = Column(Boolean, default=True)
    allow_snapping = Column(Boolean, default=True, nullable=False)
    fields_config = Column(JSON, nullable=True, default=list)
    creation_geometry_types = Column(JSON, nullable=True, default=list)
    geometry_fields_config = Column(JSON, nullable=True, default=dict)
    is_global = Column(Boolean, default=False, nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=True, index=True)
    source_filename = Column(String(500), nullable=True)
    category = Column(String(100), default="General", nullable=False, index=True)
    display_order = Column(Integer, default=0, nullable=False)
    published_in_geoportal = Column(Boolean, default=True, nullable=False, index=True)
    default_visible_in_geoportal = Column(Boolean, default=False, nullable=False)
    opacity = Column(Float, default=1.0, nullable=False)
    role_permissions = Column(JSON, default=dict)
    field_permissions = Column(JSON, default=dict)
    dashboard_config = Column(JSON, default=dict)
    metadata_info = Column(JSON, default=dict)
    # Soft delete (recycle bin): set when GIS Admin deletes; NULL = active
    deleted_at = Column(DateTime, nullable=True, index=True)
    # Large-file import state (chunked uploads): complete | importing | failed
    import_status = Column(String(20), default="complete", nullable=False)
    import_error = Column(Text, nullable=True)
    import_total = Column(Integer, default=0, nullable=False)
    import_count = Column(Integer, default=0, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("SurveyProject", back_populates="project_layers", foreign_keys=[project_id])
    features = relationship("VectorFeature", back_populates="layer", cascade="all, delete-orphan")
    assignments = relationship("ProjectLayerAssignment", back_populates="layer", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])


# ============================================================
# Vector Feature Model
# ============================================================

class VectorFeature(Base):
    __tablename__ = "vector_features"

    id = Column(Integer, primary_key=True, autoincrement=True)
    layer_id = Column(Integer, ForeignKey("vector_layers.id", ondelete="CASCADE"), nullable=False, index=True)
    geom = Column(Geometry("GEOMETRY", srid=4326), nullable=False)
    properties = Column(JSON, default=dict)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    version = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    layer = relationship("VectorLayer", back_populates="features")
    media = relationship("MediaAttachment", back_populates="feature", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])
    updater = relationship("User", foreign_keys=[updated_by])

    __table_args__ = (
        Index("idx_feature_geom", "geom", postgresql_using="gist"),
    )


# ============================================================
# Media Attachment Model
# ============================================================

class MediaAttachment(Base):
    __tablename__ = "media_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feature_id = Column(Integer, ForeignKey("vector_features.id", ondelete="CASCADE"), nullable=False, index=True)
    file_path = Column(String(1000), nullable=False)
    file_name = Column(String(500), nullable=False)
    file_type = Column(String(100), nullable=False)
    file_size = Column(BigInteger, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    feature = relationship("VectorFeature", back_populates="media")
    uploader = relationship("User", foreign_keys=[uploaded_by])


# ============================================================
# MBTiles Package Model (Global or Project-Scoped)
# ============================================================

class MBTilesPackage(Base):
    __tablename__ = "mbtiles_packages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    filename = Column(String(500), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    bounds = Column(JSON, nullable=True)  # [west, south, east, north]
    min_zoom = Column(Integer, nullable=True)
    max_zoom = Column(Integer, nullable=True)
    center = Column(JSON, nullable=True)  # [lon, lat, zoom]
    file_size = Column(BigInteger, nullable=True)  # bytes
    category = Column(String(100), default="Base Maps", nullable=False, index=True)
    display_order = Column(Integer, default=0, nullable=False)
    published_in_geoportal = Column(Boolean, default=True, nullable=False, index=True)
    default_visible = Column(Boolean, default=False, nullable=False)
    role_permissions = Column(JSON, default=dict)
    is_global = Column(Boolean, default=False, nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=True, index=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Soft delete (recycle bin): set when GIS Admin deletes; NULL = active.
    # The .mbtiles file is kept on disk until permanent deletion.
    deleted_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    project = relationship("SurveyProject", back_populates="project_mbtiles", foreign_keys=[project_id])
    assignments = relationship("ProjectMBTilesAssignment", back_populates="mbtiles", cascade="all, delete-orphan")
    uploader = relationship("User", foreign_keys=[uploaded_by])


# ============================================================
# Project ↔ Layer Assignment (junction table for global layers)
# ============================================================

class ProjectLayerAssignment(Base):
    __tablename__ = "project_layer_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    layer_id = Column(Integer, ForeignKey("vector_layers.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    project = relationship("SurveyProject", back_populates="layer_assignments")
    layer = relationship("VectorLayer", back_populates="assignments")
    assigner = relationship("User", foreign_keys=[assigned_by])

    __table_args__ = (
        UniqueConstraint("project_id", "layer_id", name="uq_project_layer"),
    )


# ============================================================
# Project ↔ MBTiles Assignment (junction table for global mbtiles)
# ============================================================

class ProjectMBTilesAssignment(Base):
    __tablename__ = "project_mbtiles_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    mbtiles_id = Column(Integer, ForeignKey("mbtiles_packages.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    project = relationship("SurveyProject", back_populates="mbtiles_assignments")
    mbtiles = relationship("MBTilesPackage", back_populates="assignments")
    assigner = relationship("User", foreign_keys=[assigned_by])

    __table_args__ = (
        UniqueConstraint("project_id", "mbtiles_id", name="uq_project_mbtiles"),
    )


# ============================================================
# Project ↔ Data Collector Assignment (junction table)
# ============================================================

class ProjectCollectorAssignment(Base):
    __tablename__ = "project_collector_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_at = Column(DateTime, server_default=func.now(), nullable=False)

    # Relationships
    project = relationship("SurveyProject", back_populates="collector_assignments")
    user = relationship("User", back_populates="assigned_projects", foreign_keys=[user_id])
    assigner = relationship("User", foreign_keys=[assigned_by])

    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_collector"),
    )


# ============================================================
# Audit Log Model
# ============================================================

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False, index=True)
    entity_type = Column(String(100), nullable=False)
    entity_id = Column(Integer, nullable=True)
    details = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    timestamp = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    # Relationships
    user = relationship("User", foreign_keys=[user_id])


# ============================================================
# Collector Live Location Model (Latest real-time position)
# ============================================================

class CollectorLiveLocation(Base):
    __tablename__ = "collector_live_locations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    accuracy = Column(Float, nullable=True)  # in meters
    altitude = Column(Float, nullable=True)
    heading = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    battery_level = Column(Float, nullable=True)
    is_online = Column(Boolean, default=True, nullable=False)
    last_seen = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    app_state = Column(String(50), default="active", nullable=True)  # active, background
    device_info = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User", back_populates="live_location", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_cll_geom", "geom", postgresql_using="gist"),
    )


# ============================================================
# Collector Location History Log Model (Breadcrumbs)
# ============================================================

class CollectorLocationLog(Base):
    __tablename__ = "collector_location_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    geom = Column(Geometry(geometry_type="POINT", srid=4326), nullable=False)
    accuracy = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    heading = Column(Float, nullable=True)
    timestamp = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    # Relationships
    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("idx_cll_logs_geom", "geom", postgresql_using="gist"),
        Index("idx_cll_logs_user_time", "user_id", "timestamp"),
    )


# ============================================================
# House Number Record Model (Centralized Addressing System)
# ============================================================

class HouseNumberRecord(Base):
    __tablename__ = "house_numbers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    road_layer_id = Column(Integer, ForeignKey("vector_layers.id", ondelete="SET NULL"), nullable=True, index=True)
    road_feature_id = Column(Integer, ForeignKey("vector_features.id", ondelete="SET NULL"), nullable=True, index=True)
    building_layer_id = Column(Integer, ForeignKey("vector_layers.id", ondelete="SET NULL"), nullable=True, index=True)
    building_feature_id = Column(Integer, ForeignKey("vector_features.id", ondelete="SET NULL"), nullable=True, index=True)
    road_name = Column(String(255), nullable=True, index=True)
    house_number = Column(String(100), nullable=False, index=True)
    metric_distance = Column(Float, nullable=True)  # chainage meters along road
    side = Column(String(20), default="NEUTRAL")  # LEFT, RIGHT, NEUTRAL
    ward = Column(String(50), nullable=True, index=True)
    status = Column(String(50), default="ASSIGNED", nullable=False, index=True)  # PROPOSED, ASSIGNED, VERIFIED
    geom = Column(Geometry("POINT", srid=4326), nullable=False)
    properties = Column(JSON, default=dict)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    road_layer = relationship("VectorLayer", foreign_keys=[road_layer_id])
    building_layer = relationship("VectorLayer", foreign_keys=[building_layer_id])

    __table_args__ = (
        Index("idx_hn_geom", "geom", postgresql_using="gist"),
        Index("idx_hn_road_num", "road_name", "house_number"),
    )


# ============================================================
# Platform Module Registry Model (Dynamic Module Management)
# ============================================================

class PlatformModule(Base):
    __tablename__ = "platform_modules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(50), default="Layers")
    route = Column(String(100), nullable=False)
    is_enabled = Column(Boolean, default=True, nullable=False)
    allowed_roles = Column(JSON, default=list)
    display_order = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


# ============================================================
# Questionnaire Definition Model (Metadata-Driven Survey Schema)
# ============================================================

class QuestionnaireDefinition(Base):
    __tablename__ = "questionnaire_definitions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    version = Column(String(50), default="1.0", nullable=False)
    version_number = Column(Integer, default=1, nullable=False)
    status = Column(Enum(QuestionnaireStatus), default=QuestionnaireStatus.DRAFT, nullable=False, index=True)
    schema_definition = Column(JSON, default=dict, nullable=False)
    target_layer_id = Column(Integer, ForeignKey("vector_layers.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=False, nullable=False)
    published_at = Column(DateTime, nullable=True)
    published_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("SurveyProject", back_populates="questionnaires", foreign_keys=[project_id])
    target_layer = relationship("VectorLayer", foreign_keys=[target_layer_id])
    creator = relationship("User", foreign_keys=[created_by])
    publisher = relationship("User", foreign_keys=[published_by])
    responses = relationship("QuestionnaireResponse", back_populates="questionnaire", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_qd_proj_status", "project_id", "status"),
    )


# ============================================================
# Questionnaire Response Model (Field Record & Feature Binding)
# ============================================================

class QuestionnaireResponse(Base):
    __tablename__ = "questionnaire_responses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    record_id = Column(String(100), unique=True, nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("survey_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    questionnaire_id = Column(Integer, ForeignKey("questionnaire_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    questionnaire_version = Column(String(50), nullable=False)
    layer_id = Column(Integer, ForeignKey("vector_layers.id", ondelete="SET NULL"), nullable=True, index=True)
    feature_id = Column(Integer, ForeignKey("vector_features.id", ondelete="SET NULL"), nullable=True, index=True)
    task_id = Column(Integer, ForeignKey("task_grids.id", ondelete="SET NULL"), nullable=True, index=True)
    collector_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=False, index=True)
    geom = Column(Geometry(geometry_type="GEOMETRY", srid=4326), nullable=True)
    geometry_type = Column(String(50), nullable=True)
    status = Column(Enum(ResponseLifecycleStatus), default=ResponseLifecycleStatus.DRAFT, nullable=False, index=True)
    completion_percentage = Column(Float, default=0.0, nullable=False)
    answers = Column(JSON, default=dict, nullable=False)
    repeat_data = Column(JSON, default=dict, nullable=False)
    calculated_values = Column(JSON, default=dict, nullable=False)
    media_refs = Column(JSON, default=list, nullable=False)
    audit_trail = Column(JSON, default=list, nullable=False)
    started_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_saved_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    submitted_at = Column(DateTime, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewer_notes = Column(Text, nullable=True)

    # Relationships
    project = relationship("SurveyProject", back_populates="field_records", foreign_keys=[project_id])
    questionnaire = relationship("QuestionnaireDefinition", back_populates="responses", foreign_keys=[questionnaire_id])
    layer = relationship("VectorLayer", foreign_keys=[layer_id])
    feature = relationship("VectorFeature", foreign_keys=[feature_id])
    task = relationship("TaskGrid", foreign_keys=[task_id])
    collector = relationship("User", foreign_keys=[collector_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])

    __table_args__ = (
        Index("idx_qr_geom", "geom", postgresql_using="gist"),
        Index("idx_qr_proj_collector", "project_id", "collector_id"),
        Index("idx_qr_status", "status"),
    )


