from typing import Optional, Dict, Any, List
from bson import ObjectId
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class FarmerRepository(BaseRepository):
    def __init__(self):
        super().__init__("farmer_profiles")

    async def create_profile(self, profile_data: Dict[str, Any]) -> Optional[str]:
        return await self.create(profile_data)

    async def get_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            result = await self.find_one({"userId": user_id, "deletedAt": None})
            if result:
                return result
            return await self.find_one({"userId": ObjectId(user_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting farmer by user ID: {str(e)}")
            return None

    async def get_by_id(self, farmer_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(farmer_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting farmer by ID: {str(e)}")
            return None

farmer_repository = FarmerRepository()
