from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class WithdrawalRepository(BaseRepository):
    """Withdrawal request repository."""

    def __init__(self):
        super().__init__("withdrawals")

    async def get_by_id(self, withdrawal_id: str) -> Optional[Dict[str, Any]]:
        """Get a withdrawal by ID."""
        try:
            return await self.find_one({"_id": ObjectId(withdrawal_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting withdrawal: {str(e)}")
            return None

    async def get_by_user_id(
        self,
        user_id: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get withdrawals by user ID."""
        try:
            return await self.find_many(
                {
                    "userId": ObjectId(user_id),
                    "deletedAt": None
                },
                skip=skip,
                limit=limit,
                sort=[("createdAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting withdrawals: {str(e)}")
            return []

    async def get_pending_total(self, user_id: str) -> float:
        """Sum of withdrawals that are not failed or cancelled."""
        try:
            pipeline = [
                {
                    "$match": {
                        "userId": ObjectId(user_id),
                        "deletedAt": None,
                        "status": {"$in": ["pending", "processing", "completed"]}
                    }
                },
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
            ]
            result = await self.aggregate(pipeline)
            return float(result[0]["total"]) if result else 0.0
        except Exception as e:
            logger.error(f"Error summing withdrawals: {str(e)}")
            return 0.0

    async def get_by_razorpay_payout_id(self, payout_id: str) -> Optional[Dict[str, Any]]:
        """Get a withdrawal by its Razorpay payout id."""
        try:
            return await self.find_one({
                "razorpayPayoutId": payout_id,
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting withdrawal by payout id: {str(e)}")
            return None

    async def update_status(
        self,
        withdrawal_id: str,
        status: str,
        extra: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update a withdrawal's status and optional extra fields."""
        try:
            obj_id = ObjectId(withdrawal_id)
            data: Dict[str, Any] = {"status": status}
            if extra:
                data.update(extra)
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating withdrawal status: {str(e)}")
            return False


withdrawal_repository = WithdrawalRepository()
