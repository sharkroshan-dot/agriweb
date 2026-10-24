from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository


COLLECTION_READY = "ready_for_pickup"
COLLECTION_ASSIGNED = "team_assigned"
COLLECTION_EN_ROUTE = "en_route"
COLLECTION_ARRIVED = "arrived_at_farm"
COLLECTION_COLLECTED = "collected"
COLLECTION_DEPARTED = "departed_farm"
COLLECTION_ARRIVED_WAREHOUSE = "arrived_warehouse"


class WarehouseCollectionRepository(BaseRepository):
    """Farm-to-warehouse collection jobs for bulk and packed transfers."""

    def __init__(self):
        super().__init__("warehouse_collections")

    async def get_by_id(self, collection_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(collection_id), "deletedAt": None})
        except Exception:
            return None

    async def get_by_warehouse(self, warehouse_id: str, status: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
        query = {"warehouseId": {"$in": [ObjectId(warehouse_id), warehouse_id]}, "deletedAt": None}
        if status and status != "all":
            query["status"] = status
        return await self.find_many(query, skip=0, limit=limit, sort=[("createdAt", 1)])

    async def get_by_incoming(self, incoming_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"incomingStockId": {"$in": [ObjectId(incoming_id), incoming_id]}, "deletedAt": None})
        except Exception:
            return None

    async def get_by_order(self, order_id: str, collection_type: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"orderId": ObjectId(order_id), "deletedAt": None}
        if collection_type:
            query["collectionType"] = collection_type
        return await self.find_many(query, skip=0, limit=100, sort=[("createdAt", 1)])

    async def create_job(self, data: Dict[str, Any]) -> Optional[str]:
        now = datetime.utcnow()
        payload = dict(data)
        payload.setdefault("status", COLLECTION_READY)
        payload.setdefault("createdAt", now)
        payload.setdefault("updatedAt", now)
        payload.setdefault("deletedAt", None)
        return await self.create(payload)

    async def update_job(self, collection_id: str, data: Dict[str, Any]) -> bool:
        payload = dict(data)
        payload["updatedAt"] = datetime.utcnow()
        return await self.update({"_id": ObjectId(collection_id)}, payload)


warehouse_collection_repository = WarehouseCollectionRepository()
