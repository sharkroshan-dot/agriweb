from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class NotificationPreferencesRepository(BaseRepository):
    """Notification preferences repository."""

    def __init__(self):
        super().__init__("notification_preferences")

    async def create_preferences(self, preferences_data: Dict[str, Any]) -> Optional[str]:
        preferences_data["createdAt"] = datetime.utcnow()
        preferences_data["updatedAt"] = datetime.utcnow()
        return await self.create(preferences_data)

    async def get_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({
                "userId": ObjectId(user_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting preferences: {str(e)}")
            return None

    async def update_preferences(
        self,
        user_id: str,
        preferences: Dict[str, bool]
    ) -> bool:
        try:
            return await self.update(
                {"userId": ObjectId(user_id)},
                {
                    "preferences": preferences,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error updating preferences: {str(e)}")
            return False

    async def get_enabled_types(self, user_id: str) -> List[str]:
        preferences = await self.get_by_user_id(user_id)
        if not preferences:
            return [
                "order",
                "delivery",
                "payment",
                "promotion",
                "system",
                "chat",
                "warehouse",
                "farmer",
                "customer",
                "admin",
                "security"
            ]
        enabled = []
        for type_, enabled_flag in preferences.get("preferences", {}).items():
            if enabled_flag:
                enabled.append(type_)
        return enabled


notification_preferences_repository = NotificationPreferencesRepository()
