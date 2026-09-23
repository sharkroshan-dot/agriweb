from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class PaymentSplitRepository(BaseRepository):
    """Payment split repository."""
    
    def __init__(self):
        super().__init__("payment_splits")
    
    async def create(self, split_data: Dict[str, Any]) -> Optional[str]:
        """Create a payment split record."""
        split_data["createdAt"] = datetime.utcnow()
        split_data["updatedAt"] = datetime.utcnow()
        return await super().create(split_data)
    
    async def get_by_payment_id(self, payment_id: str) -> Optional[Dict[str, Any]]:
        """Get split by payment ID."""
        try:
            return await self.find_one({
                "paymentId": ObjectId(payment_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting payment split: {str(e)}")
            return None
    
    async def get_by_party_id(
        self,
        party_id: str,
        party_type: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get splits by party ID."""
        try:
            return await self.find_many(
                {
                    "splits.partyId": ObjectId(party_id),
                    "splits.party": party_type,
                    "deletedAt": None
                },
                skip=skip,
                limit=limit,
                sort=[("createdAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting splits by party: {str(e)}")
            return []
    
    async def get_farmer_pending(self, farmer_id: str) -> float:
        """Sum of unpaid farmer shares (farmer split status != paid)."""
        try:
            pipeline = [
                {
                    "$match": {
                        "deletedAt": None,
                        "splits": {
                            "$elemMatch": {
                                "party": "farmer",
                                "partyId": farmer_id,
                                "status": {"$ne": "paid"}
                            }
                        }
                    }
                },
                {"$unwind": "$splits"},
                {
                    "$match": {
                        "splits.party": "farmer",
                        "splits.partyId": farmer_id,
                        "splits.status": {"$ne": "paid"}
                    }
                },
                {"$group": {"_id": None, "total": {"$sum": "$splits.amount"}}}
            ]
            result = await self.aggregate(pipeline)
            return float(result[0]["total"]) if result else 0.0
        except Exception as e:
            logger.error(f"Error summing farmer pending earnings: {str(e)}")
            return 0.0

    async def update_split_status(
        self,
        split_id: str,
        party_type: str,
        status: str
    ) -> bool:
        """Update split status for a specific party."""
        try:
            obj_id = ObjectId(split_id)
            result = await self.collection.update_one(
                {"_id": obj_id, "splits.party": party_type},
                {
                    "$set": {
                        "splits.$.status": status,
                        "updatedAt": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating split status: {str(e)}")
            return False

# Singleton instance
payment_split_repository = PaymentSplitRepository()
