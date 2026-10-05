from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository


class WarehousePickupRouteRepository(BaseRepository):
    def __init__(self):
        super().__init__("warehouse_pickup_routes")

    async def create_route(self, data: Dict[str, Any]) -> Optional[str]:
        now = datetime.utcnow()
        payload = dict(data)
        payload.update({"createdAt": now, "updatedAt": now, "deletedAt": None})
        return await self.create(payload)

    async def get_by_id(self, route_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(route_id), "deletedAt": None})
        except Exception:
            return None

    async def get_by_warehouse(self, warehouse_id: str, date_key: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
        if date_key:
            query["routeDate"] = date_key
        return await self.find_many(query, skip=0, limit=200, sort=[("createdAt", -1)])

    async def get_by_partner(self, partner_id: str, date_key: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"deliveryPartnerId": ObjectId(partner_id), "deletedAt": None}
        if date_key:
            query["routeDate"] = date_key
        return await self.find_many(query, skip=0, limit=50, sort=[("createdAt", -1)])

    async def update_route(self, route_id: str, data: Dict[str, Any]) -> bool:
        payload = dict(data)
        payload["updatedAt"] = datetime.utcnow()
        return await self.update({"_id": ObjectId(route_id)}, payload)


warehouse_pickup_route_repository = WarehousePickupRouteRepository()
