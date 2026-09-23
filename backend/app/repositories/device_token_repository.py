from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class DeviceTokenRepository(BaseRepository):
    """Device token repository."""

    def __init__(self):
        super().__init__("device_tokens")

    async def create_token(self, token_data: Dict[str, Any]) -> Optional[str]:
        token_data["createdAt"] = datetime.utcnow()
        token_data["updatedAt"] = datetime.utcnow()
        token_data["isActive"] = True
        return await self.create(token_data)

    async def get_by_user_id(self, user_id: str) -> List[Dict[str, Any]]:
        try:
            return await self.find_many({
                "userId": ObjectId(user_id),
                "isActive": True,
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting device tokens: {str(e)}")
            return []

    async def get_by_token(self, device_token: str) -> Optional[Dict[str, Any]]:
        return await self.find_one({
            "deviceToken": device_token,
            "isActive": True,
            "deletedAt": None
        })

    async def update_token(
        self,
        token_id: str,
        data: Dict[str, Any]
    ) -> bool:
        try:
            obj_id = ObjectId(token_id)
            data["updatedAt"] = datetime.utcnow()
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating device token: {str(e)}")
            return False

    async def deactivate_token(self, device_token: str) -> bool:
        try:
            return await self.update(
                {"deviceToken": device_token},
                {
                    "isActive": False,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error deactivating token: {str(e)}")
            return False

    async def get_tokens_for_platform(
        self,
        platform: str,
        limit: int = 1000
    ) -> List[Dict[str, Any]]:
        return await self.find_many({
            "platform": platform,
            "isActive": True,
            "deletedAt": None
        }, limit=limit)


device_token_repository = DeviceTokenRepository()
