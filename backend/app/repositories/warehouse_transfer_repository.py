from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class WarehouseTransferRepository(BaseRepository):
    """Warehouse transfer repository."""

    def __init__(self):
        super().__init__("warehouse_transfers")

    async def create_transfer(self, transfer_data: Dict[str, Any]) -> Optional[str]:
        transfer_data["createdAt"] = datetime.utcnow()
        transfer_data["updatedAt"] = datetime.utcnow()
        transfer_data["status"] = "pending"
        return await self.create(transfer_data)

    async def get_by_id(self, transfer_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(transfer_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting transfer: {str(e)}")
            return None

    async def complete_transfer(self, transfer_id: str, received_by: str) -> bool:
        transfer = await self.get_by_id(transfer_id)
        if not transfer:
            return False

        return await self.update(
            {"_id": transfer["_id"]},
            {
                "status": "completed",
                "receivedBy": ObjectId(received_by),
                "completedAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow()
            }
        )

    async def get_by_warehouse_id(
        self,
        warehouse_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        filter = {
            "$or": [
                {"fromWarehouseId": ObjectId(warehouse_id)},
                {"toWarehouseId": ObjectId(warehouse_id)}
            ],
            "deletedAt": None
        }
        if status:
            filter["status"] = status

        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )


warehouse_transfer_repository = WarehouseTransferRepository()
