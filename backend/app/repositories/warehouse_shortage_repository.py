from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository


class WarehouseShortageRepository(BaseRepository):
    """Order/batch shortage cases that block packing until explicitly resolved."""

    def __init__(self):
        super().__init__("warehouse_shortage_cases")

    async def get_by_id(self, shortage_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(shortage_id), "deletedAt": None})
        except Exception:
            return None

    async def get_open_for_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({
                "orderId": ObjectId(order_id),
                "status": {"$nin": ["resolved", "cancelled"]},
                "deletedAt": None,
            })
        except Exception:
            return None

    async def get_by_warehouse(self, warehouse_id: str, status: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        query = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
        if status and status != "all":
            query["status"] = status
        return await self.find_many(query, skip=0, limit=limit, sort=[("createdAt", -1)])

    async def create_case(self, data: Dict[str, Any]) -> Optional[str]:
        now = datetime.utcnow()
        payload = dict(data)
        payload.setdefault("status", "open")
        payload.setdefault("resolutionType", None)
        payload.setdefault("createdAt", now)
        payload.setdefault("updatedAt", now)
        payload.setdefault("deletedAt", None)
        return await self.create(payload)

    async def update_case(self, shortage_id: str, data: Dict[str, Any]) -> bool:
        payload = dict(data)
        payload["updatedAt"] = datetime.utcnow()
        return await self.update({"_id": ObjectId(shortage_id)}, payload)


warehouse_shortage_repository = WarehouseShortageRepository()
