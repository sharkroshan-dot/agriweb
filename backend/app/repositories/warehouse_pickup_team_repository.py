from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository


class WarehousePickupTeamRepository(BaseRepository):
    def __init__(self):
        super().__init__("warehouse_pickup_team")

    async def get_application(self, warehouse_id: str, partner_id: str) -> Optional[Dict[str, Any]]:
        return await self.find_one({
            "warehouseId": ObjectId(warehouse_id),
            "deliveryPartnerId": ObjectId(partner_id),
            "deletedAt": None,
        })

    async def create_application(self, data: Dict[str, Any]) -> Optional[str]:
        now = datetime.utcnow()
        payload = dict(data)
        payload.update({"status": "pending", "createdAt": now, "updatedAt": now, "deletedAt": None})
        return await self.create(payload)

    async def get_applications(self, warehouse_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
        if status and status != "all":
            query["status"] = status
        return await self.find_many(query, skip=0, limit=500, sort=[("createdAt", -1)])

    async def get_approved_members(self, warehouse_id: str) -> List[Dict[str, Any]]:
        return await self.find_many({
            "warehouseId": ObjectId(warehouse_id),
            "status": "approved",
            "deletedAt": None,
        }, skip=0, limit=500, sort=[("approvedAt", -1)])

    async def get_memberships_for_partner(self, partner_id: str) -> List[Dict[str, Any]]:
        return await self.find_many({
            "deliveryPartnerId": ObjectId(partner_id),
            "status": "approved",
            "deletedAt": None,
        }, skip=0, limit=100)

    async def get_membership(self, warehouse_id: str, partner_id: str) -> Optional[Dict[str, Any]]:
        return await self.find_one({
            "warehouseId": ObjectId(warehouse_id),
            "deliveryPartnerId": ObjectId(partner_id),
            "status": "approved",
            "deletedAt": None,
        })

    async def update_application(self, application_id: str, data: Dict[str, Any]) -> bool:
        payload = dict(data)
        payload["updatedAt"] = datetime.utcnow()
        return await self.update({"_id": ObjectId(application_id)}, payload)


warehouse_pickup_team_repository = WarehousePickupTeamRepository()
