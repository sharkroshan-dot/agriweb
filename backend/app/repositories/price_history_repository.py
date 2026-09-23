# backend/app/repositories/price_history_repository.py
from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class PriceHistoryRepository(BaseRepository):
    """Price history repository."""
    
    def __init__(self):
        super().__init__("price_history")
    
    async def create_price_history(self, data: Dict[str, Any]) -> Optional[str]:
        """Create a price history entry."""
        data["created_at"] = datetime.utcnow()
        return await self.create(data)
    
    async def get_by_product_id(
        self,
        product_id: str,
        days: int = 30
    ) -> List[Dict[str, Any]]:
        """Get price history by product ID."""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            return await self.find_many(
                {
                    "product_id": ObjectId(product_id),
                    "date": {"$gte": cutoff_date}
                },
                sort=[("date", 1)]
            )
        except Exception as e:
            logger.error(f"Error getting price history: {str(e)}")
            return []

# Singleton instance
price_history_repository = PriceHistoryRepository()