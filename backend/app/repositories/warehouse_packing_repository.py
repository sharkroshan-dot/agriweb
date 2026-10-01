from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository


class WarehousePackingRepository(BaseRepository):
    """Order-level warehouse packing tasks and package records."""

    def __init__(self):
        super().__init__("warehouse_packing_tasks")

    async def get_by_id(self, task_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(task_id), "deletedAt": None})
        except Exception:
            return None

    async def get_by_warehouse(self, warehouse_id: str, status: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        query = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
        if status and status != "all":
            query["status"] = status
        return await self.find_many(query, skip=0, limit=limit, sort=[("createdAt", 1)])

    async def get_by_order(self, order_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
        except Exception:
            return None

    async def get_by_order_all(self, order_id: str) -> List[Dict[str, Any]]:
        try:
            return await self.find_many({"orderId": ObjectId(order_id), "deletedAt": None}, skip=0, limit=1000)
        except Exception:
            return []

    async def create_task(self, data: Dict[str, Any]) -> Optional[str]:
        now = datetime.utcnow()
        data = dict(data)
        data.setdefault("status", "ready_for_packing")
        data.setdefault("packedQuantity", 0)
        data.setdefault("verified", False)
        data.setdefault("createdAt", now)
        data.setdefault("updatedAt", now)
        return await self.create(data)

    async def update_task(self, task_id: str, data: Dict[str, Any]) -> bool:
        data = dict(data)
        data["updatedAt"] = datetime.utcnow()
        return await self.update({"_id": ObjectId(task_id)}, data)


warehouse_packing_repository = WarehousePackingRepository()
