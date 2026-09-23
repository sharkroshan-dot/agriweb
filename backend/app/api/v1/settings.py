from fastapi import APIRouter, Depends, HTTPException, Body
from typing import Any, Dict
import json
from app.api.v1.auth import get_current_user
from app.repositories.settings_repository import (
    user_settings_repository,
    platform_settings_repository,
)
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

USER_SETTING_ROLES = {"customer", "farmer", "delivery", "warehouse"}
MAX_SETTINGS_BYTES = 250_000


def _role_of(current_user: dict) -> str:
    return (current_user.get("role") or "").lower()


@router.get("/mine")
async def get_my_settings(current_user: dict = Depends(get_current_user)):
    """Return the current user's role settings (defaults to empty object)."""
    role = _role_of(current_user)
    if role not in USER_SETTING_ROLES:
        return {"success": True, "role": role, "data": {}}
    user_id = str(current_user["_id"])
    doc = await user_settings_repository.get_by_user(user_id, role)
    return {"success": True, "role": role, "data": doc.get("data", {}) if doc else {}}


@router.put("/mine")
async def update_my_settings(
    payload: Dict[str, Any] = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Upsert the current user's role settings."""
    role = _role_of(current_user)
    if role not in USER_SETTING_ROLES:
        raise HTTPException(status_code=400, detail="Settings are not available for this role")

    try:
        size = len(json.dumps(payload, default=str).encode("utf-8"))
    except Exception:
        size = 0
    if size > MAX_SETTINGS_BYTES:
        raise HTTPException(status_code=413, detail="Settings payload too large")

    user_id = str(current_user["_id"])
    ok = await user_settings_repository.upsert(user_id, role, payload)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to save settings")

    return {"success": True, "message": "Settings saved", "data": payload}


@router.get("/platform")
async def get_platform_settings(current_user: dict = Depends(get_current_user)):
    """Admin: read platform-wide settings."""
    if _role_of(current_user) != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access platform settings")
    doc = await platform_settings_repository.get_single()
    return {"success": True, "data": doc.get("data", {}) if doc else {}}


@router.put("/platform")
async def update_platform_settings(
    payload: Dict[str, Any] = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Admin: update platform-wide settings."""
    if _role_of(current_user) != "admin":
        raise HTTPException(status_code=403, detail="Only admins can update platform settings")

    try:
        size = len(json.dumps(payload, default=str).encode("utf-8"))
    except Exception:
        size = 0
    if size > MAX_SETTINGS_BYTES:
        raise HTTPException(status_code=413, detail="Settings payload too large")

    ok = await platform_settings_repository.upsert(payload)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to save platform settings")

    return {"success": True, "message": "Platform settings saved", "data": payload}
