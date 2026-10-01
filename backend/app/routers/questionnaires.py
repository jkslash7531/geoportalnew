"""
KMC-GIS-SERVER — Advanced Questionnaire & Field Records Router
Metadata-driven field surveys tied directly to GIS features, PostGIS persistence,
multi-day draft save/resume, lifecycle transitions, and GIS attribute synchronization.
"""

import re
import json
import uuid
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete, and_, or_
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    User, UserRole, SurveyProject, ProjectMode,
    QuestionnaireDefinition, QuestionnaireStatus,
    QuestionnaireResponse, ResponseLifecycleStatus,
    VectorLayer, VectorFeature, TaskGrid,
)
from app.schemas import (
    QuestionnaireCreate, QuestionnaireUpdate, QuestionnairePublishRequest,
    QuestionnaireDefinitionResponse,
    FieldRecordSaveDraftRequest, FieldRecordSubmitRequest,
    FieldRecordReviewRequest, FieldRecordResponse,
    MessageResponse,
)
from app.auth import get_current_user, require_role
from app.helpers import log_audit, is_project_accessible_by_user
from app.cache import invalidate_layer_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Questionnaires & Field Records"])


# ============================================================
# Helpers: Schema & Pre-Publish Validation
# ============================================================

def _validate_questionnaire_schema(schema_def: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validates questionnaire definition before publishing:
    - Unique question keys
    - Valid key identifiers (alphanumeric + underscore)
    - Choice options for selection types
    - Skip-logic / condition references
    """
    errors = []
    warnings = []

    sections = schema_def.get("sections", [])
    questions = schema_def.get("questions", [])

    if not sections and not questions:
        errors.append("Questionnaire must contain at least one section or question.")
        return {"valid": False, "errors": errors, "warnings": warnings}

    seen_keys = set()
    all_keys = set()

    for q in questions:
        key = q.get("name") or q.get("key") or q.get("id")
        if not key:
            errors.append(f"Question '{q.get('label', 'Unnamed')}' is missing an internal key/name.")
            continue

        if not re.match(r"^[a-zA-Z0-9_]+$", str(key)):
            errors.append(f"Question key '{key}' must be alphanumeric with underscores only (no spaces or symbols).")

        if key in seen_keys:
            errors.append(f"Duplicate question key: '{key}'. Every question must have a unique internal identifier.")
        seen_keys.add(key)
        all_keys.add(key)

        q_type = q.get("type", "text")
        selection_types = ["single_choice", "multiple_choice", "dropdown", "radio", "checkbox", "ranking", "matrix"]
        if q_type in selection_types:
            choices = q.get("options") or q.get("choices") or []
            if not choices:
                warnings.append(f"Question '{key}' ({q_type}) has no choices/options defined.")

    # Validate conditional logic / skip patterns
    for q in questions:
        conditions = q.get("conditions") or q.get("logic") or []
        for cond in conditions:
            target = cond.get("depends_on") or cond.get("question_key")
            if target and target not in all_keys:
                warnings.append(f"Question '{q.get('name')}' has skip logic referencing non-existent question key '{target}'.")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "total_sections": len(sections),
        "total_questions": len(questions),
    }


def _calculate_completion(schema_def: Dict[str, Any], answers: Dict[str, Any]) -> float:
    """Calculate field record completion percentage."""
    questions = schema_def.get("questions", [])
    if not questions:
        return 100.0 if answers else 0.0

    required_qs = [q for q in questions if q.get("required")]
    if not required_qs:
        total_qs = len(questions)
        answered = sum(1 for q in questions if answers.get(q.get("name") or q.get("key") or q.get("id")) is not None)
        return round((answered / total_qs) * 100.0, 1)

    answered_req = sum(
        1 for q in required_qs
        if answers.get(q.get("name") or q.get("key") or q.get("id")) not in (None, "", [])
    )
    return round((answered_req / len(required_qs)) * 100.0, 1)


async def _record_to_response(db: AsyncSession, r: QuestionnaireResponse) -> FieldRecordResponse:
    """Format QuestionnaireResponse ORM to FieldRecordResponse."""
    geom_geojson = None
    if r.geom is not None:
        try:
            res = await db.execute(
                select(func.ST_AsGeoJSON(QuestionnaireResponse.geom)).where(QuestionnaireResponse.id == r.id)
            )
            raw = res.scalar()
            if raw:
                geom_geojson = json.loads(raw)
        except Exception:
            pass

    collector_name = None
    if r.collector_id:
        user_res = await db.execute(select(User.full_name).where(User.id == r.collector_id))
        collector_name = user_res.scalar()

    reviewer_name = None
    if r.reviewed_by:
        user_res = await db.execute(select(User.full_name).where(User.id == r.reviewed_by))
        reviewer_name = user_res.scalar()

    return FieldRecordResponse(
        id=r.id,
        record_id=r.record_id,
        project_id=r.project_id,
        questionnaire_id=r.questionnaire_id,
        questionnaire_version=r.questionnaire_version,
        layer_id=r.layer_id,
        feature_id=r.feature_id,
        task_id=r.task_id,
        collector_id=r.collector_id,
        collector_name=collector_name,
        geom_geojson=geom_geojson,
        geometry_type=r.geometry_type,
        status=r.status.value if hasattr(r.status, 'value') else str(r.status),
        completion_percentage=r.completion_percentage,
        answers=r.answers or {},
        repeat_data=r.repeat_data or {},
        calculated_values=r.calculated_values or {},
        media_refs=r.media_refs or [],
        audit_trail=r.audit_trail or [],
        started_at=r.started_at,
        last_saved_at=r.last_saved_at,
        submitted_at=r.submitted_at,
        reviewed_at=r.reviewed_at,
        reviewed_by=r.reviewed_by,
        reviewer_name=reviewer_name,
        reviewer_notes=r.reviewer_notes,
    )


# ============================================================
# QUESTIONNAIRE DEFINITION CRUD (ADMIN / GIS ADMIN)
# ============================================================

@router.get("/projects/{project_id}/questionnaires", response_model=List[QuestionnaireDefinitionResponse])
async def list_project_questionnaires(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all questionnaires (draft, published, archived) for a project."""
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this project")

    result = await db.execute(
        select(QuestionnaireDefinition)
        .where(QuestionnaireDefinition.project_id == project_id)
        .order_by(QuestionnaireDefinition.version_number.desc(), QuestionnaireDefinition.id.desc())
    )
    items = result.scalars().all()
    return items


@router.get("/projects/{project_id}/questionnaires/active", response_model=QuestionnaireDefinitionResponse)
async def get_active_questionnaire(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the currently active published questionnaire for field collection."""
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this project")

    # 1. Check project's active_questionnaire_id
    proj_res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = proj_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if project.active_questionnaire_id:
        q_res = await db.execute(
            select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == project.active_questionnaire_id)
        )
        active_q = q_res.scalar_one_or_none()
        if active_q:
            return active_q

    # 2. Fallback to latest published questionnaire
    fallback_res = await db.execute(
        select(QuestionnaireDefinition)
        .where(
            QuestionnaireDefinition.project_id == project_id,
            QuestionnaireDefinition.status == QuestionnaireStatus.PUBLISHED
        )
        .order_by(QuestionnaireDefinition.version_number.desc())
        .limit(1)
    )
    latest_published = fallback_res.scalar_one_or_none()
    if latest_published:
        return latest_published

    # 3. Fallback to latest draft if none published
    draft_res = await db.execute(
        select(QuestionnaireDefinition)
        .where(QuestionnaireDefinition.project_id == project_id)
        .order_by(QuestionnaireDefinition.id.desc())
        .limit(1)
    )
    draft_q = draft_res.scalar_one_or_none()
    if draft_q:
        return draft_q

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No questionnaire found for this project")


@router.get("/questionnaires/{questionnaire_id}", response_model=QuestionnaireDefinitionResponse)
async def get_questionnaire_by_id(
    questionnaire_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get questionnaire details by ID."""
    result = await db.execute(
        select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == questionnaire_id)
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire not found")
    return q


@router.post("/projects/{project_id}/questionnaires", response_model=QuestionnaireDefinitionResponse)
async def create_questionnaire_draft(
    project_id: int,
    body: QuestionnaireCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Create a new questionnaire draft for a project (GisAdmin only)."""
    proj_res = await db.execute(select(SurveyProject).where(SurveyProject.id == project_id))
    project = proj_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Determine version number
    count_res = await db.execute(
        select(func.count(QuestionnaireDefinition.id)).where(QuestionnaireDefinition.project_id == project_id)
    )
    count = count_res.scalar() or 0
    next_ver_num = count + 1
    version_str = f"v{next_ver_num}.0"

    q = QuestionnaireDefinition(
        project_id=project_id,
        title=body.title,
        description=body.description,
        version=version_str,
        version_number=next_ver_num,
        status=QuestionnaireStatus.DRAFT,
        schema_definition=body.schema_definition or {
            "sections": [
                {
                    "id": "sec_general",
                    "title": "सामान्य विवरण (General Information)",
                    "title_ne": "सामान्य विवरण",
                    "order": 1,
                    "description": "General identification and spatial context"
                }
            ],
            "questions": [],
            "settings": {"autosave_seconds": 30, "require_gps": True}
        },
        target_layer_id=body.target_layer_id,
        is_active=False,
        created_by=admin.id,
    )
    db.add(q)
    await db.commit()
    await db.refresh(q)

    await log_audit(db, admin.id, "CREATE_QUESTIONNAIRE", "QuestionnaireDefinition", q.id)
    return q


@router.put("/questionnaires/{questionnaire_id}", response_model=QuestionnaireDefinitionResponse)
async def update_questionnaire_draft(
    questionnaire_id: int,
    body: QuestionnaireUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Update a draft questionnaire definition (GisAdmin only)."""
    result = await db.execute(
        select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == questionnaire_id)
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire not found")

    if body.title is not None:
        q.title = body.title
    if body.description is not None:
        q.description = body.description
    if body.target_layer_id is not None:
        q.target_layer_id = body.target_layer_id
    if body.schema_definition is not None:
        q.schema_definition = body.schema_definition

    await db.commit()
    await db.refresh(q)
    await log_audit(db, admin.id, "UPDATE_QUESTIONNAIRE", "QuestionnaireDefinition", q.id)
    return q


@router.post("/questionnaires/{questionnaire_id}/validate")
async def validate_questionnaire(
    questionnaire_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Pre-publish validation for questionnaire structure, keys, choices, and logic."""
    result = await db.execute(
        select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == questionnaire_id)
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire not found")

    report = _validate_questionnaire_schema(q.schema_definition or {})
    return report


@router.post("/questionnaires/{questionnaire_id}/publish", response_model=QuestionnaireDefinitionResponse)
async def publish_questionnaire(
    questionnaire_id: int,
    body: QuestionnairePublishRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """
    Publish a questionnaire definition:
    - Runs schema validation
    - Sets status = PUBLISHED and is_active = True
    - Updates SurveyProject.active_questionnaire_id
    - Deactivates previous versions
    """
    result = await db.execute(
        select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == questionnaire_id)
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire not found")

    # Run structural validation
    val_report = _validate_questionnaire_schema(q.schema_definition or {})
    if not val_report["valid"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot publish questionnaire with structural errors: {'; '.join(val_report['errors'])}"
        )

    # Deactivate other questionnaires for this project
    await db.execute(
        update(QuestionnaireDefinition)
        .where(QuestionnaireDefinition.project_id == q.project_id)
        .values(is_active=False)
    )

    # Update active questionnaire
    q.status = QuestionnaireStatus.PUBLISHED
    q.is_active = True
    q.published_at = datetime.utcnow()
    q.published_by = admin.id
    if body.new_version:
        q.version = body.new_version

    # Set project's active questionnaire
    await db.execute(
        update(SurveyProject)
        .where(SurveyProject.id == q.project_id)
        .values(active_questionnaire_id=q.id)
    )

    await db.commit()
    await db.refresh(q)
    await log_audit(db, admin.id, "PUBLISH_QUESTIONNAIRE", "QuestionnaireDefinition", q.id)
    return q


@router.post("/questionnaires/{questionnaire_id}/duplicate", response_model=QuestionnaireDefinitionResponse)
async def duplicate_questionnaire(
    questionnaire_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin)),
):
    """Duplicate a questionnaire definition into a new draft version."""
    result = await db.execute(
        select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == questionnaire_id)
    )
    existing = result.scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire not found")

    count_res = await db.execute(
        select(func.count(QuestionnaireDefinition.id)).where(QuestionnaireDefinition.project_id == existing.project_id)
    )
    count = count_res.scalar() or 0
    next_ver_num = count + 1

    clone = QuestionnaireDefinition(
        project_id=existing.project_id,
        title=f"{existing.title} (v{next_ver_num}.0 Draft)",
        description=existing.description,
        version=f"v{next_ver_num}.0",
        version_number=next_ver_num,
        status=QuestionnaireStatus.DRAFT,
        schema_definition=dict(existing.schema_definition or {}),
        target_layer_id=existing.target_layer_id,
        is_active=False,
        created_by=admin.id,
    )
    db.add(clone)
    await db.commit()
    await db.refresh(clone)
    await log_audit(db, admin.id, "DUPLICATE_QUESTIONNAIRE", "QuestionnaireDefinition", clone.id)
    return clone


# ============================================================
# FIELD DATA COLLECTION & RECORD LIFECYCLE (COLLECTOR / GIS)
# ============================================================

@router.post("/projects/{project_id}/records/draft", response_model=FieldRecordResponse)
async def save_record_draft(
    project_id: int,
    body: FieldRecordSaveDraftRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Save or autosave partial questionnaire record (DRAFT / IN_PROGRESS).
    Supports multi-day collection, draft persistence, and resuming later.
    """
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this project")

    # Fetch questionnaire
    q_res = await db.execute(
        select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == body.questionnaire_id)
    )
    questionnaire = q_res.scalar_one_or_none()
    if not questionnaire:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire definition not found")

    # Calculate completion percentage
    completion = _calculate_completion(questionnaire.schema_definition or {}, body.answers or {})

    # Check if record already exists by record_id
    record = None
    if body.record_id:
        rec_res = await db.execute(
            select(QuestionnaireResponse).where(QuestionnaireResponse.record_id == body.record_id)
        )
        record = rec_res.scalar_one_or_none()

    now_iso = datetime.utcnow().isoformat()

    if record:
        # Verify ownership / permissions
        if record.collector_id != current_user.id and current_user.role not in (UserRole.GisAdmin, UserRole.SuperAdmin):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot edit another collector's draft")

        record.answers = body.answers
        record.repeat_data = body.repeat_data
        record.calculated_values = body.calculated_values
        record.media_refs = body.media_refs
        record.completion_percentage = completion
        record.status = ResponseLifecycleStatus.IN_PROGRESS if completion > 0 else ResponseLifecycleStatus.DRAFT
        record.last_saved_at = datetime.utcnow()

        if body.geom_geojson:
            record.geom = func.ST_GeomFromGeoJSON(json.dumps(body.geom_geojson))
            record.geometry_type = body.geometry_type or body.geom_geojson.get("type", "POINT").upper()

        if body.layer_id:
            record.layer_id = body.layer_id
        if body.task_id:
            record.task_id = body.task_id

        # Append audit entry
        audit_trail = list(record.audit_trail or [])
        audit_trail.append({
            "action": "DRAFT_SAVED",
            "user_id": current_user.id,
            "user_name": current_user.full_name,
            "timestamp": now_iso,
            "completion": completion,
        })
        record.audit_trail = audit_trail
    else:
        # Create new record
        new_record_id = body.record_id or f"REC-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
        geom_val = func.ST_GeomFromGeoJSON(json.dumps(body.geom_geojson)) if body.geom_geojson else None
        geom_type = body.geometry_type or (body.geom_geojson.get("type", "POINT").upper() if body.geom_geojson else None)

        record = QuestionnaireResponse(
            record_id=new_record_id,
            project_id=project_id,
            questionnaire_id=questionnaire.id,
            questionnaire_version=questionnaire.version,
            layer_id=body.layer_id or questionnaire.target_layer_id,
            task_id=body.task_id,
            collector_id=current_user.id,
            geom=geom_val,
            geometry_type=geom_type,
            status=ResponseLifecycleStatus.IN_PROGRESS if completion > 0 else ResponseLifecycleStatus.DRAFT,
            completion_percentage=completion,
            answers=body.answers,
            repeat_data=body.repeat_data,
            calculated_values=body.calculated_values,
            media_refs=body.media_refs,
            audit_trail=[{
                "action": "RECORD_CREATED",
                "user_id": current_user.id,
                "user_name": current_user.full_name,
                "timestamp": now_iso,
                "completion": completion,
            }],
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)
    return await _record_to_response(db, record)


@router.post("/projects/{project_id}/records/submit", response_model=FieldRecordResponse)
async def submit_field_record(
    project_id: int,
    body: FieldRecordSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Submit completed questionnaire record:
    - Validates required fields
    - Transitions status to SUBMITTED
    - Synchronizes questionnaire answers to a VectorFeature in PostGIS
    """
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this project")

    q_res = await db.execute(
        select(QuestionnaireDefinition).where(QuestionnaireDefinition.id == body.questionnaire_id)
    )
    questionnaire = q_res.scalar_one_or_none()
    if not questionnaire:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Questionnaire not found")

    schema_def = questionnaire.schema_definition or {}
    questions = schema_def.get("questions", [])

    # Validate required questions
    missing = []
    for q in questions:
        if q.get("required"):
            key = q.get("name") or q.get("key") or q.get("id")
            val = body.answers.get(key)
            if val in (None, "", []):
                label = q.get("label") or key
                missing.append(label)

    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Required questions must be completed: {', '.join(missing[:5])}" + (f" and {len(missing)-5} more" if len(missing) > 5 else "")
        )

    # Check if record exists or create new
    record = None
    if body.record_id:
        rec_res = await db.execute(
            select(QuestionnaireResponse).where(QuestionnaireResponse.record_id == body.record_id)
        )
        record = rec_res.scalar_one_or_none()

    now_dt = datetime.utcnow()
    now_iso = now_dt.isoformat()
    new_record_id = body.record_id or f"REC-{now_dt.strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"

    if not record:
        record = QuestionnaireResponse(
            record_id=new_record_id,
            project_id=project_id,
            questionnaire_id=questionnaire.id,
            questionnaire_version=questionnaire.version,
            collector_id=current_user.id,
            audit_trail=[],
        )
        db.add(record)

    record.answers = body.answers
    record.repeat_data = body.repeat_data
    record.calculated_values = body.calculated_values
    record.media_refs = body.media_refs
    record.completion_percentage = 100.0
    record.status = ResponseLifecycleStatus.SUBMITTED
    record.submitted_at = now_dt
    record.last_saved_at = now_dt

    if body.geom_geojson:
        record.geom = func.ST_GeomFromGeoJSON(json.dumps(body.geom_geojson))
        record.geometry_type = body.geometry_type or body.geom_geojson.get("type", "POINT").upper()

    audit_trail = list(record.audit_trail or [])
    audit_trail.append({
        "action": "SUBMITTED",
        "user_id": current_user.id,
        "user_name": current_user.full_name,
        "timestamp": now_iso,
    })
    record.audit_trail = audit_trail

    # ============================================================
    # GIS FEATURE SYNCHRONIZATION
    # Convert questionnaire responses into standard VectorFeature properties
    # ============================================================
    target_layer_id = body.layer_id or questionnaire.target_layer_id
    if not target_layer_id:
        # Fallback to project's first vector layer
        layer_res = await db.execute(
            select(VectorLayer.id).where(VectorLayer.project_id == project_id).limit(1)
        )
        target_layer_id = layer_res.scalar()

    if target_layer_id and body.geom_geojson:
        feature_props = dict(body.answers)
        # Add metadata & calculated values
        feature_props["_record_id"] = record.record_id
        feature_props["_questionnaire_version"] = questionnaire.version
        feature_props["_collector_name"] = current_user.full_name
        feature_props["_submitted_at"] = now_iso
        for k, v in body.calculated_values.items():
            feature_props[k] = v

        if record.feature_id:
            # Update existing VectorFeature
            feat_res = await db.execute(
                select(VectorFeature).where(VectorFeature.id == record.feature_id)
            )
            feature = feat_res.scalar_one_or_none()
            if feature:
                feature.properties = feature_props
                feature.geom = func.ST_GeomFromGeoJSON(json.dumps(body.geom_geojson))
                feature.updated_by = current_user.id
                feature.updated_at = now_dt
        else:
            # Create new VectorFeature
            new_feature = VectorFeature(
                layer_id=target_layer_id,
                geom=func.ST_GeomFromGeoJSON(json.dumps(body.geom_geojson)),
                properties=feature_props,
                created_by=current_user.id,
                task_id=body.task_id,
            )
            db.add(new_feature)
            await db.flush()
            record.feature_id = new_feature.id
            record.layer_id = target_layer_id

        # Invalidate layer cache so map updates instantly
        await invalidate_layer_cache(target_layer_id)

    await db.commit()
    await db.refresh(record)
    await log_audit(db, current_user.id, "SUBMIT_RECORD", "QuestionnaireResponse", record.id)
    return await _record_to_response(db, record)


@router.get("/projects/{project_id}/records/my", response_model=List[FieldRecordResponse])
async def list_my_records(
    project_id: int,
    status_filter: Optional[str] = Query(None, description="Filter by status, e.g. DRAFT, IN_PROGRESS, SUBMITTED"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get current collector's records for a project (My Records view).
    Essential for multi-day collection, resume drafts, and checking status.
    """
    query = (
        select(QuestionnaireResponse)
        .where(
            QuestionnaireResponse.project_id == project_id,
            QuestionnaireResponse.collector_id == current_user.id,
        )
        .order_by(QuestionnaireResponse.last_saved_at.desc())
    )
    if status_filter:
        query = query.where(QuestionnaireResponse.status == status_filter)

    result = await db.execute(query)
    records = result.scalars().all()

    items = []
    for r in records:
        items.append(await _record_to_response(db, r))
    return items


@router.get("/projects/{project_id}/records", response_model=List[FieldRecordResponse])
async def list_all_project_records(
    project_id: int,
    status_filter: Optional[str] = Query(None),
    collector_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all records for QA/Review (Admin/Validator/Supervisor)."""
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    query = (
        select(QuestionnaireResponse)
        .where(QuestionnaireResponse.project_id == project_id)
        .order_by(QuestionnaireResponse.last_saved_at.desc())
    )
    if status_filter:
        query = query.where(QuestionnaireResponse.status == status_filter)
    if collector_id:
        query = query.where(QuestionnaireResponse.collector_id == collector_id)

    result = await db.execute(query)
    records = result.scalars().all()

    items = []
    for r in records:
        items.append(await _record_to_response(db, r))
    return items


@router.get("/records/{record_id}", response_model=FieldRecordResponse)
async def get_field_record(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a field record by internal ID or record_id UUID."""
    if record_id.isdigit():
        res = await db.execute(
            select(QuestionnaireResponse).where(QuestionnaireResponse.id == int(record_id))
        )
    else:
        res = await db.execute(
            select(QuestionnaireResponse).where(QuestionnaireResponse.record_id == record_id)
        )
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field record not found")

    return await _record_to_response(db, record)


@router.put("/records/{record_id}/review", response_model=FieldRecordResponse)
async def review_field_record(
    record_id: str,
    body: FieldRecordReviewRequest,
    db: AsyncSession = Depends(get_db),
    reviewer: User = Depends(require_role([UserRole.GisAdmin, UserRole.Validator, UserRole.SuperAdmin])),
):
    """
    Review / QA a field record:
    - Set status: APPROVED, RETURNED, or UNDER_REVIEW
    - Provide reviewer notes
    - If RETURNED, collector can resume and correct the questionnaire
    """
    if record_id.isdigit():
        res = await db.execute(
            select(QuestionnaireResponse).where(QuestionnaireResponse.id == int(record_id))
        )
    else:
        res = await db.execute(
            select(QuestionnaireResponse).where(QuestionnaireResponse.record_id == record_id)
        )
    record = res.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field record not found")

    now_iso = datetime.utcnow().isoformat()
    record.status = ResponseLifecycleStatus(body.status)
    record.reviewed_at = datetime.utcnow()
    record.reviewed_by = reviewer.id
    record.reviewer_notes = body.reviewer_notes

    audit_trail = list(record.audit_trail or [])
    audit_trail.append({
        "action": f"REVIEW_{body.status}",
        "user_id": reviewer.id,
        "user_name": reviewer.full_name,
        "notes": body.reviewer_notes,
        "timestamp": now_iso,
    })
    record.audit_trail = audit_trail

    await db.commit()
    await db.refresh(record)
    await log_audit(db, reviewer.id, f"REVIEW_RECORD_{body.status}", "QuestionnaireResponse", record.id)
    return await _record_to_response(db, record)


@router.get("/projects/{project_id}/records/export")
async def export_records_geojson(
    project_id: int,
    status_filter: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export all field records as standard GeoJSON FeatureCollection."""
    if not await is_project_accessible_by_user(db, current_user, project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    query = select(QuestionnaireResponse).where(QuestionnaireResponse.project_id == project_id)
    if status_filter:
        query = query.where(QuestionnaireResponse.status == status_filter)

    result = await db.execute(query)
    records = result.scalars().all()

    features = []
    for r in records:
        geom_dict = None
        if r.geom is not None:
            g_res = await db.execute(
                select(func.ST_AsGeoJSON(QuestionnaireResponse.geom)).where(QuestionnaireResponse.id == r.id)
            )
            raw = g_res.scalar()
            if raw:
                geom_dict = json.loads(raw)

        props = dict(r.answers or {})
        props["_record_id"] = r.record_id
        props["_status"] = r.status.value if hasattr(r.status, 'value') else str(r.status)
        props["_completion"] = r.completion_percentage
        props["_version"] = r.questionnaire_version
        props["_collector_id"] = r.collector_id
        props["_last_saved"] = r.last_saved_at.isoformat() if r.last_saved_at else None
        props["_submitted_at"] = r.submitted_at.isoformat() if r.submitted_at else None
        if r.calculated_values:
            props["_calculated"] = r.calculated_values

        features.append({
            "type": "Feature",
            "id": r.id,
            "geometry": geom_dict,
            "properties": props
        })

    return {
        "type": "FeatureCollection",
        "project_id": project_id,
        "total_records": len(features),
        "features": features
    }
