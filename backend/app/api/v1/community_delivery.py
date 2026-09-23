from fastapi import APIRouter, Depends, HTTPException, status
from app.api.v1.auth import get_current_user
from app.schemas.community_delivery import (
    CommunityDeliveryScheduleCreate,
    CommunityDeliveryScheduleResponse,
    CommunityDeliveryScheduleUpdate,
)
from app.services.community_delivery_service import CommunityDeliveryService

router = APIRouter()


@router.post("/schedules", response_model=CommunityDeliveryScheduleResponse)
async def create_schedule(
    data: CommunityDeliveryScheduleCreate,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only farmers can create delivery schedules")

    schedule = await CommunityDeliveryService.create_schedule(str(current_user.get("_id")), data)
    if not schedule:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not create schedule")

    if "id" not in schedule and "_id" in schedule:
        schedule["id"] = str(schedule["_id"])
    return schedule


@router.get("/schedules")
async def list_schedules(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only farmers can view delivery schedules")

    schedules = await CommunityDeliveryService.list_schedules(str(current_user.get("_id")))
    return {"success": True, "data": schedules}


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    data: CommunityDeliveryScheduleUpdate,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only farmers can update delivery schedules")

    updated = await CommunityDeliveryService.update_schedule(schedule_id, data)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    return {"success": True, "data": updated}
