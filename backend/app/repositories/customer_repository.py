from typing import Optional, Dict, Any
from bson import ObjectId
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class CustomerRepository(BaseRepository):
    def __init__(self):
        super().__init__("customer_profiles")

    async def get_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            result = await self.find_one({"userId": user_id, "deletedAt": None})
            if result:
                return result
            return await self.find_one({"userId": ObjectId(user_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting customer by user ID: {str(e)}")
            return None

    async def get_by_id(self, customer_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(customer_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting customer by ID: {str(e)}")
            return None

customer_repository = CustomerRepository()
