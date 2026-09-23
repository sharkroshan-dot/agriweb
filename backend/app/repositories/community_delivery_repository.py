from typing import Any, Dict, List, Optional
from app.repositories.base_repository import BaseRepository


class CommunityDeliveryRepository(BaseRepository):
    def __init__(self):
        super().__init__("community_delivery_schedules")

    async def create_schedule(self, data: Dict[str, Any]) -> Optional[str]:
        return await self.create(data)

    async def get_by_farmer_id(self, farmer_id: str) -> List[Dict[str, Any]]:
        return await self.find_many({"farmerId": farmer_id}, sort=[("createdAt", -1)])

    async def get_by_id(self, schedule_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": self.to_object_id(schedule_id)})
        except Exception:
            return None


community_delivery_repository = CommunityDeliveryRepository()
