from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class UserSettingsRepository(BaseRepository):
    """Per-user role settings (customer, farmer, delivery, warehouse)."""

    def __init__(self):
        super().__init__("user_settings")

    async def get_by_user(self, user_id: str, role: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({
                "userId": ObjectId(user_id),
                "role": role,
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting user settings: {str(e)}")
            return None

    async def upsert(self, user_id: str, role: str, data: Dict[str, Any]) -> bool:
        try:
            result = await self.collection.update_one(
                {"userId": ObjectId(user_id), "role": role},
                {
                    "$set": {
                        "userId": ObjectId(user_id),
                        "role": role,
                        "data": data,
                        "updatedAt": datetime.utcnow()
                    },
                    "$setOnInsert": {"createdAt": datetime.utcnow()}
                },
                upsert=True
            )
            return result.acknowledged
        except Exception as e:
            logger.error(f"Error saving user settings: {str(e)}", exc_info=True)
            return False


class PlatformSettingsRepository(BaseRepository):
    """Single-document platform-wide settings for admins."""

    def __init__(self):
        super().__init__("platform_settings")

    async def get_single(self) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": "platform"})
        except Exception as e:
            logger.error(f"Error getting platform settings: {str(e)}")
            return None

    async def upsert(self, data: Dict[str, Any]) -> bool:
        try:
            result = await self.collection.update_one(
                {"_id": "platform"},
                {
                    "$set": {
                        "data": data,
                        "updatedAt": datetime.utcnow()
                    },
                    "$setOnInsert": {"createdAt": datetime.utcnow()}
                },
                upsert=True
            )
            return result.acknowledged
        except Exception as e:
            logger.error(f"Error saving platform settings: {str(e)}", exc_info=True)
            return False


user_settings_repository = UserSettingsRepository()
platform_settings_repository = PlatformSettingsRepository()
