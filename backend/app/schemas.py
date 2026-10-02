"""
KMC-GIS-SERVER Pydantic v2 Schemas
Request/response validation and serialization.
"""

from pydantic import BaseModel, Field, EmailStr, ConfigDict, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


# ============================================================
# Auth Schemas
# ============================================================

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    username: str


class RefreshRequest(BaseModel):
    refresh_token: str


# ============================================================
# User Schemas
# ============================================================

class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=100, pattern=r"^[a-zA-Z0-9_]+$")
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=1, max_length=255)
    role: str = Field(default="DataCollector", pattern=r"^(SuperAdmin|GisAdmin|MunicipalUser|DataCollector|Validator|BasicViewer)$")


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(None, max_length=255)
    role: Optional[str] = Field(None, pattern=r"^(SuperAdmin|GisAdmin|MunicipalUser|DataCollector|Validator|BasicViewer)$")
    is_active: Optional[bool] = None


# ============================================================
# Project Schemas
# ============================================================

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    boundary_geojson: Optional[Dict[str, Any]] = None
    grid_type: Optional[str] = Field(default="SQUARE", pattern=r"^(SQUARE|HEXAGON|TRIANGLE)$")
    grid_size_m: Optional[float] = Field(default=100.0, ge=10.0, le=10000.0)
    form_schema: Optional[Dict[str, Any]] = None
    project_mode: Optional[str] = Field(default="STANDARD", pattern=r"^(STANDARD|ADVANCED_QUESTIONNAIRE)$")
    geometry_config: Optional[Dict[str, Any]] = None


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    boundary_geojson: Optional[Dict[str, Any]] = None
    grid_type: str
    grid_size_m: float
    form_schema: Optional[Dict[str, Any]]
    status: str
    project_mode: Optional[str] = "STANDARD"
    geometry_config: Optional[Dict[str, Any]] = None
    active_questionnaire_id: Optional[int] = None
    created_by: int
    created_at: datetime
    task_count: Optional[int] = 0
    progress: Optional[Dict[str, int]] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    boundary_geojson: Optional[Dict[str, Any]] = None
    grid_type: Optional[str] = Field(None, pattern=r"^(SQUARE|HEXAGON|TRIANGLE)$")
    grid_size_m: Optional[float] = Field(None, ge=10.0, le=10000.0)
    form_schema: Optional[Dict[str, Any]] = None
    status: Optional[str] = Field(None, pattern=r"^(DRAFT|ACTIVE|COMPLETED|ARCHIVED)$")
    project_mode: Optional[str] = Field(None, pattern=r"^(STANDARD|ADVANCED_QUESTIONNAIRE)$")
    geometry_config: Optional[Dict[str, Any]] = None
    active_questionnaire_id: Optional[int] = None


class GenerateGridRequest(BaseModel):
    boundary_geojson: Optional[Dict[str, Any]] = None
    grid_type: Optional[str] = Field(None, pattern=r"^(SQUARE|HEXAGON|TRIANGLE)$")
    grid_size_m: Optional[float] = Field(None, ge=10.0, le=10000.0)


# ============================================================
# Task Grid Schemas
# ============================================================

class TaskGridResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    grid_index: int
    name: Optional[str] = None
    geom_geojson: Optional[Dict[str, Any]] = None
    status: str
    assigned_to: Optional[int] = None
    assigned_to_name: Optional[str] = None
    assigned_at: Optional[datetime] = None
    assigned_by: Optional[int] = None
    properties: Optional[Dict[str, Any]] = None
    locked_by: Optional[int] = None
    locked_by_name: Optional[str] = None
    locked_at: Optional[datetime] = None
    mapped_at: Optional[datetime] = None
    validated_by: Optional[int] = None
    validated_by_name: Optional[str] = None
    validated_at: Optional[datetime] = None


class TaskAssignRequest(BaseModel):
    task_ids: List[int] = Field(..., min_length=1)
    user_id: Optional[int] = None  # None/null to unassign


class AutoDistributeRequest(BaseModel):
    user_ids: List[int] = Field(..., min_length=1)


class BoundaryUploadResponse(BaseModel):
    message: str
    polygon_count: int
    tasks_created: int
    is_multi: bool
    method: str


class TaskActionRequest(BaseModel):
    """For lock/unlock/submit/validate actions."""
    collector_lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    collector_lng: Optional[float] = Field(None, ge=-180.0, le=180.0)


# ============================================================
# Vector Layer Schemas
# ============================================================

class FieldConfigItem(BaseModel):
    name: str
    label: Optional[str] = None
    type: Optional[str] = "text"
    required: bool = False
    options: Optional[List[str]] = None
    placeholder: Optional[str] = None
    is_unique: Optional[bool] = False
    id_mode: Optional[str] = "manual"  # manual | auto
    id_prefix: Optional[str] = ""
    id_sequence: Optional[int] = 1
    visible_in_popup: Optional[bool] = True
    order: Optional[int] = 0


class LayerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    geometry_type: str = Field(default="GEOMETRY", pattern=r"^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRY)$")
    style: Optional[Dict[str, Any]] = None
    editable_by_collectors: bool = True
    allow_snapping: bool = True
    is_global: bool = False
    fields_config: Optional[List[Dict[str, Any]]] = None
    creation_geometry_types: Optional[List[str]] = None
    geometry_fields_config: Optional[Dict[str, Any]] = None


class LayerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    geometry_type: str
    style: Optional[Dict[str, Any]]
    editable_by_collectors: bool
    allow_snapping: bool = True
    is_global: bool
    category: Optional[str] = "General"
    display_order: Optional[int] = 0
    published_in_geoportal: Optional[bool] = True
    default_visible_in_geoportal: Optional[bool] = False
    opacity: Optional[float] = 1.0
    role_permissions: Optional[Dict[str, Any]] = None
    field_permissions: Optional[Dict[str, Any]] = None
    dashboard_config: Optional[Dict[str, Any]] = None
    metadata_info: Optional[Dict[str, Any]] = None
    project_id: Optional[int]
    project_name: Optional[str] = None
    feature_count: Optional[int] = 0
    fields_config: Optional[List[Dict[str, Any]]] = None
    creation_geometry_types: Optional[List[str]] = None
    geometry_fields_config: Optional[Dict[str, Any]] = None
    deleted_at: Optional[datetime] = None
    import_status: Optional[str] = "complete"
    import_error: Optional[str] = None
    import_total: Optional[int] = 0
    import_count: Optional[int] = 0
    import_phase: Optional[str] = None
    created_at: datetime


class LayerUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    style: Optional[Dict[str, Any]] = None
    editable_by_collectors: Optional[bool] = None
    allow_snapping: Optional[bool] = None
    fields_config: Optional[List[Dict[str, Any]]] = None
    creation_geometry_types: Optional[List[str]] = None
    geometry_fields_config: Optional[Dict[str, Any]] = None


# ============================================================
# Vector Feature Schemas
# ============================================================

class FeatureCreate(BaseModel):
    layer_id: int
    geom_geojson: Dict[str, Any]
    properties: Optional[Dict[str, Any]] = {}
    collector_lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    collector_lng: Optional[float] = Field(None, ge=-180.0, le=180.0)


class FeatureUpdate(BaseModel):
    geom_geojson: Optional[Dict[str, Any]] = None
    properties: Optional[Dict[str, Any]] = None
    collector_lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    collector_lng: Optional[float] = Field(None, ge=-180.0, le=180.0)


class FeatureSplitRequest(BaseModel):
    """QGIS-style split: cut a line/polygon feature with a blade LineString."""
    blade: Dict[str, Any]  # GeoJSON LineString geometry (WGS84)


class FeatureMergeRequest(BaseModel):
    """QGIS-style merge: union 2+ features of the same layer into the first one."""
    feature_ids: List[int] = Field(..., min_length=2)


class FeatureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    layer_id: int
    geom_geojson: Optional[Dict[str, Any]] = None
    properties: Dict[str, Any]
    created_by: int
    updated_by: Optional[int]
    version: int
    created_at: datetime
    updated_at: Optional[datetime]


class FeatureCollectionResponse(BaseModel):
    type: str = "FeatureCollection"
    features: List[Dict[str, Any]]
    total_count: int


# ============================================================
# Vector Layer & Feature Linking Schemas
# ============================================================

class LayerLinkRequest(BaseModel):
    target_layer_id: int = Field(..., description="ID of the target vector layer to link to")
    target_id_field: str = Field(default="_id", description="Field from target features to store (e.g. '_id', 'id', 'parcel_id', 'code')")
    link_method: str = Field(default="attribute", pattern=r"^(attribute|spatial|direct)$", description="Method: 'attribute' or 'spatial' or 'direct'")
    source_match_field: Optional[str] = Field(None, description="Attribute field from source layer to match (for attribute method)")
    target_match_field: Optional[str] = Field(None, description="Attribute field from target layer to match (for attribute method)")
    spatial_predicate: Optional[str] = Field(default="intersects", pattern=r"^(intersects|within|contains|nearest)$", description="Spatial predicate for spatial method")
    custom_field_name: Optional[str] = Field(None, description="Custom field name in source layer, defaults to <target_layer_name>_linked_id")
    overwrite_existing: bool = Field(default=True, description="Whether to overwrite existing link values")


class LayerLinkResponse(BaseModel):
    success: bool
    message: str
    source_layer_id: int
    source_layer_name: str
    target_layer_id: int
    target_layer_name: str
    linked_attribute_name: str
    linked_count: int
    total_source_features: int
    matched_percentage: float


class LayerRelationshipItem(BaseModel):
    target_layer_id: int
    target_layer_name: str
    attribute_name: str
    target_id_field: str
    linked_features_count: int
    total_features_count: int


class LayerRelationshipsResponse(BaseModel):
    layer_id: int
    layer_name: str
    relationships: List[LayerRelationshipItem]


class FeatureLinkRequest(BaseModel):
    target_layer_id: int
    target_feature_id: Any
    target_id_field: Optional[str] = "_id"
    custom_field_name: Optional[str] = None


class FeatureUnlinkRequest(BaseModel):
    target_layer_id: Optional[int] = None
    attribute_name: Optional[str] = None


class LinkedFeatureItem(BaseModel):
    layer_id: int
    layer_name: str
    feature_id: int
    target_id_field: str
    target_id_value: Any
    attribute_name: str
    properties: Dict[str, Any]
    geom_geojson: Optional[Dict[str, Any]] = None
    direction: str = "outbound"  # "outbound" or "inbound"


class FeatureRelationshipsResponse(BaseModel):
    feature_id: int
    layer_id: int
    layer_name: str
    linked_features: List[LinkedFeatureItem]



# ============================================================
# MBTiles Schemas
# ============================================================

class MBTilesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    filename: str
    description: Optional[str]
    bounds: Optional[List[float]]
    min_zoom: Optional[int]
    max_zoom: Optional[int]
    center: Optional[List[float]] = None
    file_size: Optional[int]
    is_global: bool
    project_id: Optional[int]
    project_name: Optional[str] = None
    deleted_at: Optional[datetime] = None
    created_at: datetime


# ============================================================
# Assignment Schemas
# ============================================================

class AssignLayerRequest(BaseModel):
    layer_id: int


class AssignMBTilesRequest(BaseModel):
    mbtiles_id: int


class AssignCollectorsRequest(BaseModel):
    user_ids: List[int] = Field(..., min_length=1)


class ProjectCollectorResponse(BaseModel):
    user_id: int
    username: str
    full_name: str
    email: str
    assigned_at: datetime
    assigned_tasks_count: Optional[int] = 0


class CollectorProjectResponse(BaseModel):
    project_id: int
    project_name: str
    status: str
    assigned_at: datetime
    assigned_tasks_count: Optional[int] = 0


# ============================================================
# Generic Response Schemas
# ============================================================

class MessageResponse(BaseModel):
    message: str
    detail: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    database: str
    redis: str


# ============================================================
# Live Location Tracking Schemas
# ============================================================

class LocationPingRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    accuracy: Optional[float] = Field(None, ge=0.0)
    altitude: Optional[float] = None
    heading: Optional[float] = None
    speed: Optional[float] = None
    battery_level: Optional[float] = Field(None, ge=0.0, le=100.0)
    app_state: Optional[str] = "active"
    device_info: Optional[Dict[str, Any]] = None


class CollectorStatusUpdateRequest(BaseModel):
    is_online: bool = True
    app_state: str = "active"  # active, inactive, background
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class CollectorLocationResponse(BaseModel):
    user_id: int
    username: str
    full_name: str
    email: str
    role: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    altitude: Optional[float] = None
    heading: Optional[float] = None
    speed: Optional[float] = None
    battery_level: Optional[float] = None
    is_online: bool
    app_state: Optional[str] = "active"
    last_seen: Optional[datetime] = None
    minutes_ago: Optional[int] = None
    assigned_projects: List[Dict[str, Any]] = []
    assigned_tasks_count: int = 0
    active_task: Optional[Dict[str, Any]] = None


class CollectorLocationHistoryItem(BaseModel):
    latitude: float
    longitude: float
    accuracy: Optional[float] = None
    speed: Optional[float] = None
    heading: Optional[float] = None
    timestamp: datetime


# ============================================================
# GeoPortal Configuration Schemas
# ============================================================

class LayerGeoPortalConfigUpdate(BaseModel):
    category: Optional[str] = None
    display_order: Optional[int] = None
    published_in_geoportal: Optional[bool] = None
    default_visible_in_geoportal: Optional[bool] = None
    opacity: Optional[float] = Field(None, ge=0.0, le=1.0)
    style: Optional[Dict[str, Any]] = None
    role_permissions: Optional[Dict[str, Any]] = None
    field_permissions: Optional[Dict[str, Any]] = None
    dashboard_config: Optional[Dict[str, Any]] = None
    metadata_info: Optional[Dict[str, Any]] = None


class MBTilesGeoPortalConfigUpdate(BaseModel):
    category: Optional[str] = None
    display_order: Optional[int] = None
    published_in_geoportal: Optional[bool] = None
    default_visible: Optional[bool] = None
    role_permissions: Optional[Dict[str, Any]] = None


# ============================================================
# House Numbering Schemas
# ============================================================

class HouseNumberCreate(BaseModel):
    road_layer_id: Optional[int] = None
    road_feature_id: Optional[int] = None
    building_layer_id: Optional[int] = None
    building_feature_id: Optional[int] = None
    road_name: Optional[str] = None
    house_number: str = Field(..., min_length=1, max_length=100)
    metric_distance: Optional[float] = None
    side: Optional[str] = "NEUTRAL"  # LEFT, RIGHT, NEUTRAL
    ward: Optional[str] = None
    status: Optional[str] = "ASSIGNED"
    geom_geojson: Dict[str, Any]
    properties: Optional[Dict[str, Any]] = {}


class HouseNumberUpdate(BaseModel):
    house_number: Optional[str] = None
    road_name: Optional[str] = None
    side: Optional[str] = None
    ward: Optional[str] = None
    status: Optional[str] = None
    properties: Optional[Dict[str, Any]] = None


class HouseNumberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    road_layer_id: Optional[int]
    road_feature_id: Optional[int]
    building_layer_id: Optional[int]
    building_feature_id: Optional[int]
    road_name: Optional[str]
    house_number: str
    metric_distance: Optional[float]
    side: str
    ward: Optional[str]
    status: str
    geom_geojson: Optional[Dict[str, Any]] = None
    properties: Dict[str, Any] = {}
    created_at: datetime
    updated_at: Optional[datetime]


class HouseNumberGenerateRequest(BaseModel):
    road_layer_id: int
    road_feature_id: int
    building_layer_id: int
    road_name: Optional[str] = None
    ward: Optional[str] = None
    numbering_scheme: str = "METRIC"  # METRIC or SEQUENTIAL
    interval_m: float = Field(5.0, ge=1.0, le=100.0)
    start_number: int = Field(1, ge=1)
    parity: str = "ODD_LEFT_EVEN_RIGHT"  # ODD_LEFT_EVEN_RIGHT, EVEN_LEFT_ODD_RIGHT, CONTINUOUS
    prefix: Optional[str] = ""
    suffix: Optional[str] = ""
    max_distance_from_road_m: float = Field(50.0, ge=5.0, le=500.0)
    save_to_database: bool = False


# ============================================================
# Platform Module Schemas
# ============================================================

class PlatformModuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    description: Optional[str]
    icon: str
    route: str
    is_enabled: bool
    allowed_roles: List[str]
    display_order: int


class PlatformModuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_enabled: Optional[bool] = None
    allowed_roles: Optional[List[str]] = None
    display_order: Optional[int] = None


# ============================================================
# Questionnaire & Field Record Schemas
# ============================================================

class QuestionnaireCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    target_layer_id: Optional[int] = None
    schema_definition: Dict[str, Any] = Field(default_factory=dict)


class QuestionnaireUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    target_layer_id: Optional[int] = None
    schema_definition: Optional[Dict[str, Any]] = None


class QuestionnairePublishRequest(BaseModel):
    increment_version: Optional[bool] = False
    new_version: Optional[str] = None


class QuestionnaireDefinitionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    title: str
    description: Optional[str] = None
    version: str
    version_number: int
    status: str
    schema_definition: Dict[str, Any]
    target_layer_id: Optional[int] = None
    is_active: bool
    published_at: Optional[datetime] = None
    published_by: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class FieldRecordSaveDraftRequest(BaseModel):
    record_id: Optional[str] = None
    questionnaire_id: int
    layer_id: Optional[int] = None
    task_id: Optional[int] = None
    geom_geojson: Optional[Dict[str, Any]] = None
    geometry_type: Optional[str] = None
    answers: Dict[str, Any] = Field(default_factory=dict)
    repeat_data: Dict[str, Any] = Field(default_factory=dict)
    calculated_values: Dict[str, Any] = Field(default_factory=dict)
    media_refs: List[Dict[str, Any]] = Field(default_factory=list)
    completion_percentage: Optional[float] = 0.0
    status: Optional[str] = "DRAFT"


class FieldRecordSubmitRequest(BaseModel):
    record_id: Optional[str] = None
    questionnaire_id: int
    layer_id: Optional[int] = None
    task_id: Optional[int] = None
    geom_geojson: Optional[Dict[str, Any]] = None
    geometry_type: Optional[str] = None
    answers: Dict[str, Any] = Field(default_factory=dict)
    repeat_data: Dict[str, Any] = Field(default_factory=dict)
    calculated_values: Dict[str, Any] = Field(default_factory=dict)
    media_refs: List[Dict[str, Any]] = Field(default_factory=list)
    completion_percentage: Optional[float] = 100.0


class FieldRecordReviewRequest(BaseModel):
    status: str = Field(..., pattern=r"^(APPROVED|RETURNED|UNDER_REVIEW)$")
    reviewer_notes: Optional[str] = None


class FieldRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    record_id: str
    project_id: int
    questionnaire_id: int
    questionnaire_version: str
    layer_id: Optional[int] = None
    feature_id: Optional[int] = None
    task_id: Optional[int] = None
    collector_id: int
    collector_name: Optional[str] = None
    geom_geojson: Optional[Dict[str, Any]] = None
    geometry_type: Optional[str] = None
    status: str
    completion_percentage: float
    answers: Dict[str, Any]
    repeat_data: Dict[str, Any]
    calculated_values: Dict[str, Any]
    media_refs: List[Dict[str, Any]]
    audit_trail: List[Dict[str, Any]]
    started_at: datetime
    last_saved_at: datetime
    submitted_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    reviewed_by: Optional[int] = None
    reviewer_name: Optional[str] = None
    reviewer_notes: Optional[str] = None


