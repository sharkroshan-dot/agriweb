from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class OutgoingStockRepository(BaseRepository):
    """Outgoing stock repository."""

    def __init__(self):
        super().__init__("outgoing_stock")

    async def create_outgoing(self, outgoing_data: Dict[str, Any]) -> Optional[str]:
        outgoing_data["createdAt"] = datetime.utcnow()
        outgoing_data["updatedAt"] = datetime.utcnow()
        outgoing_data["status"] = "pending"
        return await self.create(outgoing_data)

    async def get_by_id(self, outgoing_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(outgoing_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting outgoing stock: {str(e)}")
            return None

    async def get_by_warehouse_id(
        self,
        warehouse_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        filter = {"warehouseId": ObjectId(warehouse_id), "deletedAt": None}
        if status:
            filter["status"] = status

        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )

    async def update_status(
        self,
        outgoing_id: str,
        status: str,
        data: Optional[Dict[str, Any]] = None
    ) -> bool:
        outgoing = await self.get_by_id(outgoing_id)
        if not outgoing:
            return False

        update_data = {
            "status": status,
            "updatedAt": datetime.utcnow()
        }
        if data:
            update_data.update(data)

        return await self.update({"_id": outgoing["_id"]}, update_data)


outgoing_stock_repository = OutgoingStockRepository()
