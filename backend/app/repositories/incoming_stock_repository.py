from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class IncomingStockRepository(BaseRepository):
    """Incoming stock repository."""

    def __init__(self):
        super().__init__("incoming_stock")

    async def create_incoming(self, incoming_data: Dict[str, Any]) -> Optional[str]:
        incoming_data["createdAt"] = datetime.utcnow()
        incoming_data["updatedAt"] = datetime.utcnow()
        incoming_data["status"] = "scheduled"
        return await self.create(incoming_data)

    async def get_by_id(self, incoming_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(incoming_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting incoming stock: {str(e)}")
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
            sort=[("expectedDate", 1)]
        )

    async def receive_stock(
        self,
        incoming_id: str,
        quantity: int,
        quality_check: str,
        notes: Optional[str] = None
    ) -> bool:
        incoming = await self.get_by_id(incoming_id)
        if not incoming:
            return False

        expected_quantity = int(incoming.get("quantity", 0))
        previously_received = int(incoming.get("quantityReceived", 0))
        if quantity <= 0 or previously_received + quantity > expected_quantity:
            return False

        total_received = previously_received + quantity
        update_data = {
            "quantityReceived": total_received,
            "qualityCheck": quality_check,
            "updatedAt": datetime.utcnow()
        }
        if total_received >= expected_quantity:
            update_data["receivedAt"] = datetime.utcnow()
            update_data["status"] = "received" if quality_check == "passed" else "rejected"
        else:
            update_data["status"] = "in_transit" if quality_check == "passed" else "quality_check"
        if notes is not None:
            update_data["notes"] = notes

        return await self.update({"_id": incoming["_id"]}, update_data)


incoming_stock_repository = IncomingStockRepository()
