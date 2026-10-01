"""
KMC-GIS-SERVER — Platform Modules Router
Dynamic registration and role-based discovery of Municipal GIS modules:
Field Data Collection, GeoPortal, House Numbering, and future GIS modules.
"""

from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import PlatformModule, User, UserRole
from app.schemas import PlatformModuleResponse, PlatformModuleUpdate
from app.auth import get_optional_current_user, require_role
from app.helpers import log_audit

router = APIRouter(prefix="/api/modules", tags=["Platform Modules"])


@router.get("", response_model=List[PlatformModuleResponse])
async def list_available_modules(
    db: AsyncSession = Depends(get_db),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    List municipal GIS modules available for the current user's role.
    BasicViewer sees GeoPortal; DataCollector sees Field Data + GeoPortal;
    GisAdmin and SuperAdmin see all active modules.
    """
    user_role = user.role.value if user else "BasicViewer"
    is_admin = user_role in ("SuperAdmin", "GisAdmin")

    res = await db.execute(
        select(PlatformModule).where(PlatformModule.is_enabled == True).order_by(PlatformModule.display_order)
    )
    all_modules = res.scalars().all()

    accessible = []
    for mod in all_modules:
        allowed = mod.allowed_roles or []
        if is_admin or user_role in allowed or "SuperAdmin" in allowed:
            accessible.append(PlatformModuleResponse(
                id=mod.id,
                code=mod.code,
                name=mod.name,
                description=mod.description,
                icon=mod.icon,
                route=mod.route,
                is_enabled=mod.is_enabled,
                allowed_roles=mod.allowed_roles or [],
                display_order=mod.display_order,
            ))

    return accessible


@router.put("/{module_id}", response_model=PlatformModuleResponse)
async def update_module(
    module_id: int,
    body: PlatformModuleUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_role(UserRole.GisAdmin, UserRole.SuperAdmin)),
):
    """Configure module availability and role permissions (Admin only)."""
    res = await db.execute(select(PlatformModule).where(PlatformModule.id == module_id))
    mod = res.scalar_one_or_none()
    if not mod:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Module not found")

    if body.name is not None:
        mod.name = body.name
    if body.description is not None:
        mod.description = body.description
    if body.is_enabled is not None:
        mod.is_enabled = body.is_enabled
    if body.allowed_roles is not None:
        mod.allowed_roles = body.allowed_roles
    if body.display_order is not None:
        mod.display_order = body.display_order

    await db.commit()
    await log_audit(db, admin.id, "UPDATE_MODULE_CONFIG", "PlatformModule", mod.id)

    return PlatformModuleResponse(
        id=mod.id,
        code=mod.code,
        name=mod.name,
        description=mod.description,
        icon=mod.icon,
        route=mod.route,
        is_enabled=mod.is_enabled,
        allowed_roles=mod.allowed_roles or [],
        display_order=mod.display_order,
    )
