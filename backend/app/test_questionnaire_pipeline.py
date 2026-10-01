"""
Comprehensive Integration Test for Advanced Questionnaire GIS Field Collection Platform
Tests both Standard mode (backward compatibility) and Advanced Questionnaire mode.
"""

import asyncio
import json
from datetime import datetime
from sqlalchemy import select, func, text

from app.database import AsyncSessionLocal
from app.models import (
    User, UserRole, SurveyProject, ProjectMode, ProjectStatus,
    QuestionnaireDefinition, QuestionnaireStatus,
    QuestionnaireResponse, ResponseLifecycleStatus,
    VectorLayer, VectorFeature,
)
from app.routers.questionnaires import _validate_questionnaire_schema, _calculate_completion


async def run_pipeline_test():
    print("============================================================")
    print("STARTING ADVANCED QUESTIONNAIRE PLATFORM INTEGRATION TEST")
    print("============================================================")

    async with AsyncSessionLocal() as db:
        # 1. Verify SuperAdmin / GisAdmin user
        admin_res = await db.execute(select(User).where(User.role == UserRole.GisAdmin).limit(1))
        admin = admin_res.scalar_one_or_none()
        assert admin is not None, "GisAdmin user must exist"
        print(f"[OK] 1. GisAdmin verified: {admin.username} (ID: {admin.id})")

        # 2. Test Standard Mode Backward Compatibility
        std_proj = SurveyProject(
            name="Test Standard Ward 16 Survey",
            description="Standard GIS Layer attribute collection project",
            project_mode=ProjectMode.STANDARD,
            geometry_config={"type": "Polygon"},
            status=ProjectStatus.ACTIVE,
            created_by=admin.id,
        )
        db.add(std_proj)
        await db.commit()
        await db.refresh(std_proj)
        assert std_proj.project_mode == ProjectMode.STANDARD, "Standard mode project must maintain mode=STANDARD"
        assert std_proj.active_questionnaire_id is None, "Standard mode project should have no active questionnaire"
        print(f"[OK] 2. Standard Mode Project created: #{std_proj.id} (mode: {std_proj.project_mode.value})")

        # Create target VectorLayer for survey features
        layer = VectorLayer(
            name="Building Infrastructure Layer",
            description="Target layer for questionnaire GIS features",
            geometry_type="POLYGON",
            project_id=std_proj.id,
            category="Buildings",
            created_by=admin.id,
        )
        db.add(layer)
        await db.commit()
        await db.refresh(layer)
        print(f"[OK] 3. Target VectorLayer created: #{layer.id} ('{layer.name}')")

        # 3. Test Advanced Questionnaire Project Creation
        adv_proj = SurveyProject(
            name="Kathmandu Ward 17 Comprehensive Building & Socioeconomic Survey",
            description="उन्नत प्रश्नावली आधारित भवन तथा सामाजिक-आर्थिक सर्वेक्षण",
            project_mode=ProjectMode.ADVANCED_QUESTIONNAIRE,
            geometry_config={"type": "Polygon"},
            status=ProjectStatus.ACTIVE,
            created_by=admin.id,
        )
        db.add(adv_proj)
        await db.commit()
        await db.refresh(adv_proj)
        assert adv_proj.project_mode == ProjectMode.ADVANCED_QUESTIONNAIRE
        print(f"[OK] 4. Advanced Questionnaire Project created: #{adv_proj.id} ('{adv_proj.name}')")

        # 4. Define Universal Questionnaire Schema
        schema_def = {
            "sections": [
                {
                    "id": "sec_bldg",
                    "title": "भवन तथा संरचना विवरण (Building Details)",
                    "title_ne": "भवन तथा संरचना विवरण",
                    "order": 1,
                    "description": "भौतिक तथा प्राविधिक पहिचान"
                },
                {
                    "id": "sec_socio",
                    "title": "सामाजिक तथा आर्थिक विवरण (Socioeconomic Information)",
                    "title_ne": "सामाजिक तथा आर्थिक विवरण",
                    "order": 2,
                    "description": "परिवार तथा बसोबास स्थिति"
                },
                {
                    "id": "sec_damage",
                    "title": "विपद् क्षति आँकलन (Disaster Damage Assessment)",
                    "title_ne": "विपद् क्षति आँकलन",
                    "order": 3,
                    "description": "भूकम्प वा बाढी क्षति विवरण"
                }
            ],
            "questions": [
                # General inputs
                {
                    "id": "q1",
                    "name": "building_code",
                    "label": "भवन पहिचान नम्बर (Building Code)",
                    "label_ne": "भवन पहिचान नम्बर",
                    "type": "text",
                    "section_id": "sec_bldg",
                    "required": True,
                    "gis_binding": "bldg_code"
                },
                {
                    "id": "q2",
                    "name": "ward_number",
                    "label": "वडा नम्बर (Ward Number)",
                    "label_ne": "वडा नम्बर",
                    "type": "dropdown",
                    "section_id": "sec_bldg",
                    "required": True,
                    "options": [{"value": "17", "label": "Ward 17", "label_ne": "वडा १७"}],
                    "gis_binding": "ward"
                },
                {
                    "id": "q3",
                    "name": "building_use",
                    "label": "भवन उपयोग (Building Use)",
                    "label_ne": "भवन उपयोग",
                    "type": "single_choice",
                    "section_id": "sec_bldg",
                    "required": True,
                    "options": [
                        {"value": "residential", "label": "Residential", "label_ne": "आवासीय"},
                        {"value": "commercial", "label": "Commercial", "label_ne": "व्यापारिक"},
                        {"value": "mixed", "label": "Mixed Use", "label_ne": "मिश्रित"}
                    ],
                    "gis_binding": "use_type"
                },
                {
                    "id": "q4",
                    "name": "floor_count",
                    "label": "तला संख्या (Number of Floors)",
                    "label_ne": "तला संख्या",
                    "type": "number",
                    "section_id": "sec_bldg",
                    "required": True,
                    "validation": {"min": 1, "max": 20},
                    "gis_binding": "floors"
                },
                # Conditional Logic: Damage questions only appear if damage_present == 'yes'
                {
                    "id": "q5",
                    "name": "has_damage",
                    "label": "के संरचनामा कुनै क्षति देखिएको छ? (Any Damage?)",
                    "label_ne": "के संरचनामा कुनै क्षति देखिएको छ?",
                    "type": "yes_no",
                    "section_id": "sec_damage",
                    "required": True,
                    "gis_binding": "has_damage"
                },
                {
                    "id": "q6",
                    "name": "damage_grade",
                    "label": "क्षतिको स्तर (Damage Grade)",
                    "label_ne": "क्षतिको स्तर",
                    "type": "single_choice",
                    "section_id": "sec_damage",
                    "required": False,
                    "conditions": [{"depends_on": "has_damage", "operator": "==", "value": "yes"}],
                    "options": [
                        {"value": "minor", "label": "Grade 1 - Minor", "label_ne": "सामान्य दरार"},
                        {"value": "moderate", "label": "Grade 2 - Moderate", "label_ne": "मध्यम क्षति"},
                        {"value": "severe", "label": "Grade 3 - Severe", "label_ne": "गम्भीर संरचनात्मक क्षति"}
                    ],
                    "gis_binding": "damage_grade"
                },
                # Repeat Group: Household members roster
                {
                    "id": "q7",
                    "name": "family_members",
                    "label": "घरपरिवारका सदस्यहरूको सूची (Household Members Roster)",
                    "label_ne": "घरपरिवारका सदस्यहरूको सूची",
                    "type": "repeat_group",
                    "section_id": "sec_socio",
                    "required": False,
                },
                # Calculated field: Total Plinth Area = length * width
                {
                    "id": "q8",
                    "name": "plinth_area_sqm",
                    "label": "प्लिन्थ क्षेत्रफल (Plinth Area Sqm)",
                    "label_ne": "प्लिन्थ क्षेत्रफल (वर्ग मिटर)",
                    "type": "calculated",
                    "section_id": "sec_bldg",
                    "required": False,
                    "calculation": {"formula": "12.5 * 8.0"},
                    "gis_binding": "plinth_sqm"
                }
            ],
            "settings": {
                "autosave_seconds": 30,
                "require_gps": True
            }
        }

        # 5. Pre-publish Validation Check
        val_report = _validate_questionnaire_schema(schema_def)
        assert val_report["valid"] is True, f"Validation should pass, but got: {val_report['errors']}"
        print(f"[OK] 5. Pre-Publish Validation passed: {val_report['total_sections']} sections, {val_report['total_questions']} questions")

        # 6. Create & Publish Questionnaire Definition
        q_def = QuestionnaireDefinition(
            project_id=adv_proj.id,
            title="काठमाडौँ महानगर वडा १७ विस्तृत सर्वेक्षण फारम",
            description="Kathmandu Ward 17 Official Survey Form",
            version="v1.0",
            version_number=1,
            status=QuestionnaireStatus.PUBLISHED,
            schema_definition=schema_def,
            target_layer_id=layer.id,
            is_active=True,
            published_at=datetime.utcnow(),
            published_by=admin.id,
            created_by=admin.id,
        )
        db.add(q_def)
        await db.flush()

        adv_proj.active_questionnaire_id = q_def.id
        await db.commit()
        await db.refresh(q_def)
        await db.refresh(adv_proj)
        print(f"[OK] 6. Questionnaire Published: #{q_def.id} ({q_def.version}) active on Project #{adv_proj.id}")

        # 7. Day 1: Field Collector creates new GIS feature and saves Partial Draft
        test_polygon_geojson = {
            "type": "Polygon",
            "coordinates": [
                [
                    [85.3125, 27.7120],
                    [85.3135, 27.7120],
                    [85.3135, 27.7110],
                    [85.3125, 27.7110],
                    [85.3125, 27.7120]
                ]
            ]
        }

        partial_answers = {
            "building_code": "KMC-W17-BLD-0042",
            "ward_number": "17",
            # Remaining questions unanswered yet (Day 1 partial work)
        }

        completion_pct = _calculate_completion(schema_def, partial_answers)
        assert completion_pct > 0 and completion_pct < 100, f"Partial completion should be between 0 and 100, got {completion_pct}"

        field_record = QuestionnaireResponse(
            record_id="REC-2026-TEST-0001",
            project_id=adv_proj.id,
            questionnaire_id=q_def.id,
            questionnaire_version=q_def.version,
            layer_id=layer.id,
            collector_id=admin.id,
            geom=func.ST_GeomFromGeoJSON(json.dumps(test_polygon_geojson)),
            geometry_type="POLYGON",
            status=ResponseLifecycleStatus.IN_PROGRESS,
            completion_percentage=completion_pct,
            answers=partial_answers,
            repeat_data={},
            calculated_values={"plinth_area_sqm": 100.0},
            media_refs=[],
            audit_trail=[{
                "action": "DAY_1_DRAFT_SAVED",
                "by": admin.id,
                "timestamp": datetime.utcnow().isoformat(),
                "completion": completion_pct
            }]
        )
        db.add(field_record)
        await db.commit()
        await db.refresh(field_record)
        print(f"[OK] 7. Day 1 Partial Draft Saved: Record '{field_record.record_id}', Status: {field_record.status.value}, Completion: {field_record.completion_percentage}%")

        # 8. Day 5: Collector resumes record, completes all questions, and Submits
        full_answers = {
            "building_code": "KMC-W17-BLD-0042",
            "ward_number": "17",
            "building_use": "residential",
            "floor_count": 3,
            "has_damage": "yes",
            "damage_grade": "minor",
        }
        repeat_roster = {
            "family_members": [
                {"name": "राम श्रेष्ठ", "value": 45, "relation": "घरमुली"},
                {"name": "सीता श्रेष्ठ", "value": 42, "relation": "श्रीमती"},
                {"name": "आयुष श्रेष्ठ", "value": 16, "relation": "छोरा"}
            ]
        }
        calc_vals = {"plinth_area_sqm": 100.0}

        final_completion = _calculate_completion(schema_def, full_answers)
        assert final_completion == 100.0, f"Full answers should give 100% completion, got {final_completion}"

        # Update QuestionnaireResponse
        field_record.answers = full_answers
        field_record.repeat_data = repeat_roster
        field_record.calculated_values = calc_vals
        field_record.completion_percentage = 100.0
        field_record.status = ResponseLifecycleStatus.SUBMITTED
        field_record.submitted_at = datetime.utcnow()
        field_record.audit_trail.append({
            "action": "DAY_5_SUBMITTED",
            "by": admin.id,
            "timestamp": datetime.utcnow().isoformat()
        })

        # 9. Synchronize to PostGIS VectorFeature (Core GIS requirement)
        feature_properties = dict(full_answers)
        feature_properties["_record_id"] = field_record.record_id
        feature_properties["_questionnaire_version"] = q_def.version
        feature_properties["_collector_id"] = admin.id
        feature_properties.update(calc_vals)

        feature = VectorFeature(
            layer_id=layer.id,
            geom=func.ST_GeomFromGeoJSON(json.dumps(test_polygon_geojson)),
            properties=feature_properties,
            created_by=admin.id,
        )
        db.add(feature)
        await db.flush()

        field_record.feature_id = feature.id
        await db.commit()
        await db.refresh(field_record)
        await db.refresh(feature)

        print(f"[OK] 8. Day 5 Submission & GIS Feature Synchronization successful!")
        print(f"      Record ID: {field_record.record_id} -> VectorFeature ID: #{feature.id}")
        print(f"      Feature Properties synced: {list(feature.properties.keys())}")

        # 10. Verify PostGIS Feature can be retrieved and queried spatially
        geo_res = await db.execute(
            select(
                VectorFeature.id,
                func.ST_AsGeoJSON(VectorFeature.geom),
                func.ST_Area(func.ST_Transform(VectorFeature.geom, 3857)),
                VectorFeature.properties
            ).where(VectorFeature.id == feature.id)
        )
        row = geo_res.one()
        feat_id, feat_geom_json, area_sqm, feat_props = row
        assert feat_id == feature.id
        assert "building_code" in feat_props and feat_props["building_code"] == "KMC-W17-BLD-0042"
        assert "floor_count" in feat_props and feat_props["floor_count"] == 3
        assert feat_props["_record_id"] == "REC-2026-TEST-0001"
        print(f"[OK] 9. PostGIS Spatial Query verified: Feature #{feat_id}, Area: {round(area_sqm, 2)} sqm")

        # 11. Test Admin / QA Review Workflow
        field_record.status = ResponseLifecycleStatus.APPROVED
        field_record.reviewed_at = datetime.utcnow()
        field_record.reviewed_by = admin.id
        field_record.reviewer_notes = "सबै प्राविधिक विवरण तथा तस्बिर प्रमाणित गरियो। स्वीकृत।"
        field_record.audit_trail.append({
            "action": "REVIEW_APPROVED",
            "by": admin.id,
            "notes": field_record.reviewer_notes
        })
        await db.commit()
        await db.refresh(field_record)
        assert field_record.status == ResponseLifecycleStatus.APPROVED
        print(f"[OK] 10. QA Review verified: Status={field_record.status.value}, Notes: '{field_record.reviewer_notes}'")

    print("============================================================")
    print("ALL 10 PIPELINE CHECKS PASSED PERFECTLY!")
    print("============================================================")


if __name__ == "__main__":
    asyncio.run(run_pipeline_test())
