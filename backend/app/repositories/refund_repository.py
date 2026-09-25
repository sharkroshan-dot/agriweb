from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
import random
import string
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class RefundRepository(BaseRepository):
    """Refund repository."""

    def __init__(self):
        super().__init__("refunds")

    def generate_refund_number(self) -> str:
        """Generate a human-readable refund id like RF123456."""
        suffix = ''.join(random.choices(string.digits, k=6))
        return f"RF{suffix}"

    async def create_refund(self, refund_data: Dict[str, Any]) -> Optional[str]:
        """Create a new refund request."""
        if not refund_data.get("refundId"):
            refund_data["refundId"] = self.generate_refund_number()
        refund_data["status"] = refund_data.get("status", "requested")
        refund_data["createdAt"] = datetime.utcnow()
        refund_data["updatedAt"] = datetime.utcnow()
        return await self.create(refund_data)

    async def get_by_id(self, refund_id: str) -> Optional[Dict[str, Any]]:
        """Get refund by ObjectId string."""
        try:
            obj_id = ObjectId(refund_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting refund: {str(e)}")
            return None

    async def get_by_refund_number(self, refund_id: str) -> Optional[Dict[str, Any]]:
        """Get refund by its RFxxxxxx identifier."""
        return await self.find_one({"refundId": refund_id, "deletedAt": None})

    async def get_by_order_id(self, order_id: str) -> List[Dict[str, Any]]:
        """Get all refunds for an order."""
        try:
            return await self.find_many(
                {"orderId": ObjectId(order_id), "deletedAt": None},
                sort=[("createdAt", -1)],
            )
        except Exception as e:
            logger.error(f"Error getting refunds for order: {str(e)}")
            return []

    async def get_by_customer(
        self,
        customer_id: str,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get refunds for a customer, newest first."""
        filter = {"customerId": ObjectId(customer_id), "deletedAt": None}
        if status:
            filter["status"] = status
        return await self.find_many(
            filter, skip=skip, limit=limit, sort=[("createdAt", -1)]
        )

    async def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None,
        customer_id: Optional[str] = None,
        order_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Admin listing with optional filters, newest first."""
        filter = {"deletedAt": None}
        if status:
            filter["status"] = status
        if customer_id:
            filter["customerId"] = ObjectId(customer_id)
        if order_id:
            filter["orderId"] = ObjectId(order_id)
        return await self.find_many(
            filter, skip=skip, limit=limit, sort=[("createdAt", -1)]
        )

    async def count_filtered(
        self,
        status: Optional[str] = None,
        customer_id: Optional[str] = None,
        order_id: Optional[str] = None,
    ) -> int:
        filter = {"deletedAt": None}
        if status:
            filter["status"] = status
        if customer_id:
            filter["customerId"] = ObjectId(customer_id)
        if order_id:
            filter["orderId"] = ObjectId(order_id)
        return await self.count(filter)

    async def claim_for_processing(
        self,
        refund_id: str,
        *,
        actor_id: Optional[str] = None,
        actor_role: Optional[str] = None,
    ) -> bool:
        """Atomically claim an approved refund for provider processing."""
        try:
            obj_id = ObjectId(refund_id)
            timeline_entry = {
                "status": "refund_processing",
                "timestamp": datetime.utcnow(),
            }
            if actor_id:
                timeline_entry["actorId"] = str(actor_id)
            if actor_role:
                timeline_entry["actorRole"] = actor_role
            result = await self.collection.update_one(
                {"_id": obj_id, "status": "approved", "deletedAt": None},
                {
                    "$set": {
                        "status": "refund_processing",
                        "updatedAt": datetime.utcnow(),
                    },
                    "$push": {"timeline": timeline_entry},
                },
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error claiming refund for processing: {str(e)}")
            return False

    async def update_status(
        self,
        refund_id: str,
        status: str,
        *,
        actor_id: Optional[str] = None,
        actor_role: Optional[str] = None,
        note: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Advance a refund to a new status and append a timeline entry."""
        try:
            obj_id = ObjectId(refund_id)
            timeline_entry = {
                "status": status,
                "timestamp": datetime.utcnow(),
            }
            if note:
                timeline_entry["note"] = note
            if actor_id:
                timeline_entry["actorId"] = str(actor_id)
            if actor_role:
                timeline_entry["actorRole"] = actor_role

            update_data = {
                "status": status,
                "updatedAt": datetime.utcnow(),
            }
            if extra:
                update_data.update(extra)

            result = await self.collection.update_one(
                {"_id": obj_id},
                {"$set": update_data, "$push": {"timeline": timeline_entry}},
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating refund status: {str(e)}")
            return False


# Singleton instance
refund_repository = RefundRepository()