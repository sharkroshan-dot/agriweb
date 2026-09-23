from typing import Any, Dict, List, Optional
from app.repositories.community_delivery_repository import community_delivery_repository
from app.schemas.community_delivery import (
    CommunityDeliveryScheduleCreate,
    CommunityDeliveryScheduleUpdate,
    CommunityDeliveryStatus,
)


class CommunityDeliveryService:
    @staticmethod
    async def create_schedule(
        farmer_id: str,
        data: CommunityDeliveryScheduleCreate,
    ) -> Optional[Dict[str, Any]]:
        payload = data.dict()
        payload["farmerId"] = farmer_id
        payload["status"] = CommunityDeliveryStatus.ACTIVE.value

        created = await community_delivery_repository.create_schedule(payload)
        if isinstance(created, dict):
            return {
                **created,
                "id": str(created.get("id") or created.get("_id") or ""),
            }

        if not created:
            return None

        schedule = await community_delivery_repository.get_by_id(created)
        if schedule:
            schedule["id"] = str(schedule.get("_id"))
            return schedule

        return None

    @staticmethod
    async def list_schedules(farmer_id: str) -> List[Dict[str, Any]]:
        schedules = await community_delivery_repository.get_by_farmer_id(farmer_id)
        for schedule in schedules:
            schedule["id"] = str(schedule.get("_id"))
        return schedules

    @staticmethod
    async def update_schedule(
        schedule_id: str,
        data: CommunityDeliveryScheduleUpdate,
    ) -> Optional[Dict[str, Any]]:
        payload = data.dict(exclude_unset=True)
        if payload:
            await community_delivery_repository.update({"_id": community_delivery_repository.to_object_id(schedule_id)}, payload)
        return await community_delivery_repository.get_by_id(schedule_id)
