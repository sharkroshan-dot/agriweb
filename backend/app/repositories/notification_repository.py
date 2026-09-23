from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
from app.schemas.notification import NotificationStatus, NotificationType
import logging

logger = logging.getLogger(__name__)

class NotificationRepository(BaseRepository):
    """Notification repository."""

    def __init__(self):
        super().__init__("notifications")

    async def create_notification(self, notification_data: Dict[str, Any]) -> Optional[str]:
        notification_data["createdAt"] = datetime.utcnow()
        notification_data["updatedAt"] = datetime.utcnow()
        notification_data["isRead"] = False
        notification_data["status"] = NotificationStatus.PENDING.value
        return await self.create(notification_data)

    async def get_by_id(self, notification_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(notification_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting notification: {str(e)}")
            return None

    async def get_by_user_id(
        self,
        user_id: str,
        is_read: Optional[bool] = None,
        type: Optional[NotificationType] = None,
        skip: int = 0,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        filter = {"userId": ObjectId(user_id), "deletedAt": None}
        if is_read is not None:
            filter["isRead"] = is_read
        if type:
            filter["type"] = type.value
        return await self.find_many(filter, skip=skip, limit=limit, sort=[("createdAt", -1)])

    async def mark_as_read(self, notification_id: str) -> bool:
        try:
            obj_id = ObjectId(notification_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "isRead": True,
                    "readAt": datetime.utcnow(),
                    "status": NotificationStatus.READ.value,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error marking notification as read: {str(e)}")
            return False

    async def mark_all_as_read(self, user_id: str) -> bool:
        try:
            result = await self.collection.update_many(
                {
                    "userId": ObjectId(user_id),
                    "isRead": False,
                    "deletedAt": None
                },
                {
                    "$set": {
                        "isRead": True,
                        "readAt": datetime.utcnow(),
                        "status": NotificationStatus.READ.value,
                        "updatedAt": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error marking all notifications as read: {str(e)}")
            return False

    async def update_status(
        self,
        notification_id: str,
        status: NotificationStatus,
        data: Optional[Dict[str, Any]] = None
    ) -> bool:
        try:
            obj_id = ObjectId(notification_id)
            update_data = {
                "status": status.value,
                "updatedAt": datetime.utcnow()
            }
            if status == NotificationStatus.SENT:
                update_data["sentAt"] = datetime.utcnow()
            elif status == NotificationStatus.DELIVERED:
                update_data["deliveredAt"] = datetime.utcnow()
            if data:
                update_data.update(data)
            return await self.update({"_id": obj_id}, update_data)
        except Exception as e:
            logger.error(f"Error updating notification status: {str(e)}")
            return False

    async def get_unread_count(self, user_id: str) -> int:
        try:
            return await self.count({
                "userId": ObjectId(user_id),
                "isRead": False,
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting unread count: {str(e)}")
            return 0

    async def get_notification_stats(self, user_id: str) -> Dict[str, Any]:
        try:
            total = await self.count({"userId": ObjectId(user_id), "deletedAt": None})
            unread = await self.get_unread_count(user_id)
            types: Dict[str, int] = {}
            for type_enum in NotificationType:
                count = await self.count({
                    "userId": ObjectId(user_id),
                    "type": type_enum.value,
                    "deletedAt": None
                })
                if count > 0:
                    types[type_enum.value] = count
            return {
                "total": total,
                "unread": unread,
                "read": total - unread,
                "byType": types
            }
        except Exception as e:
            logger.error(f"Error getting notification stats: {str(e)}")
            return {"total": 0, "unread": 0, "read": 0, "byType": {}}

    async def delete_old_notifications(self, days: int = 30) -> int:
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            result = await self.collection.delete_many({
                "createdAt": {"$lt": cutoff_date},
                "isRead": True,
                "deletedAt": None
            })
            return result.deleted_count
        except Exception as e:
            logger.error(f"Error deleting old notifications: {str(e)}")
            return 0


notification_repository = NotificationRepository()
