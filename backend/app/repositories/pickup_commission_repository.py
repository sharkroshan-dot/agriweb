from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

# Lifecycle of a farm-pickup Cash-on-Pickup commission:
#   outstanding -> the farmer collected cash at the farm and owes the platform
#                  its commission (PICKUP_COMMISSION_RATE).
#   settled     -> the commission was recovered by deducting it from a future
#                  online sale settlement (Option A settlement).
STATUSES = ("outstanding", "settled")


class PickupCommissionRepository(BaseRepository):
    """Outstanding farm-pickup Cash-on-Pickup commissions.

    A customer who pays cash at the farm hands the full order amount to the
    farmer directly. The farmer then owes the platform the commission share,
    which gets deducted automatically from the farmer's next online sale
    settlement instead of being collected separately.
    """

    def __init__(self):
        super().__init__("pickup_commissions")

    async def create(self, data: Dict[str, Any]) -> Optional[str]:
        data["createdAt"] = datetime.utcnow()
        data["updatedAt"] = datetime.utcnow()
        data.setdefault("status", "outstanding")
        return await super().create(data)

    async def get_by_order_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Look up a commission record for an order (idempotency guard)."""
        try:
            return await self.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting pickup commission by order: {str(e)}")
            return None

    async def get_outstanding_by_farmer(
        self,
        farmer_user_id: str,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        """List outstanding commission debts for a farmer (keyed by user id)."""
        try:
            values: List[Any] = [farmer_user_id]
            try:
                values.append(ObjectId(farmer_user_id))
            except Exception:
                pass
            return await self.find_many(
                {
                    "farmerId": {"$in": values},
                    "status": "outstanding",
                    "deletedAt": None,
                },
                limit=limit,
                sort=[("createdAt", 1)],
            )
        except Exception as e:
            logger.error(f"Error getting pickup commissions by farmer: {str(e)}")
            return []

    async def get_outstanding_total(self, farmer_user_id: str) -> float:
        """Total commission a farmer currently owes the platform for COD pickups."""
        try:
            values: List[Any] = [farmer_user_id]
            try:
                values.append(ObjectId(farmer_user_id))
            except Exception:
                pass
            pipeline = [
                {
                    "$match": {
                        "farmerId": {"$in": values},
                        "status": "outstanding",
                        "deletedAt": None,
                    }
                },
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
            ]
            result = await self.aggregate(pipeline)
            return round(float(result[0]["total"]) if result else 0.0, 2)
        except Exception as e:
            logger.error(f"Error summing pickup commission debt: {str(e)}")
            return 0.0

    async def mark_settled(
        self,
        commission_id: str,
        deducted_from_split_id: str,
        note: str = "",
    ) -> bool:
        """Mark a commission as recovered from a future sale settlement."""
        try:
            return await self.update(
                {"_id": ObjectId(commission_id)},
                {
                    "status": "settled",
                    "settledAt": datetime.utcnow(),
                    "deductedFromSplitId": deducted_from_split_id,
                    "settlementNote": note,
                    "updatedAt": datetime.utcnow(),
                },
            )
        except Exception as e:
            logger.error(f"Error settling pickup commission: {str(e)}")
            return False


pickup_commission_repository = PickupCommissionRepository()