from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class SessionRepository(BaseRepository):
    """User authentication sessions (one row per access-token jti)."""

    def __init__(self):
        super().__init__("auth_sessions")

    async def create_session(self, data: Dict[str, Any]) -> Optional[str]:
        data.setdefault("createdAt", datetime.utcnow())
        data.setdefault("lastSeenAt", datetime.utcnow())
        data.setdefault("revoked", False)
        return await self.create(data)

    async def get_active_by_user(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        try:
            return await self.find_many(
                {"userId": ObjectId(user_id), "revoked": False, "deletedAt": None},
                sort=[("lastSeenAt", -1)],
                limit=limit,
            )
        except Exception as e:
            logger.error(f"Session lookup error: {e}")
            return []

    async def get_by_jti(self, jti: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"jti": jti, "deletedAt": None})
        except Exception as e:
            logger.error(f"Session by jti error: {e}")
            return None

    async def revoke_by_jti(self, jti: str, reason: str = "logout") -> bool:
        try:
            return await self.update(
                {"jti": jti},
                {"revoked": True, "revokedAt": datetime.utcnow(), "revokeReason": reason},
            )
        except Exception as e:
            logger.error(f"Session revoke error: {e}")
            return False

    async def revoke_all_for_user(self, user_id: str, except_jti: Optional[str] = None) -> int:
        """Revoke all active sessions for a user (optionally keeping one)."""
        try:
            query = {"userId": ObjectId(user_id), "revoked": False, "deletedAt": None}
            if except_jti:
                query["jti"] = {"$ne": except_jti}
            result = await self.collection.update_many(
                query,
                {"$set": {"revoked": True, "revokedAt": datetime.utcnow(), "revokeReason": "revoke_all"}},
            )
            return result.modified_count if result else 0
        except Exception as e:
            logger.error(f"Session revoke-all error: {e}")
            return 0

    async def count_active(self, user_id: str) -> int:
        try:
            return await self.count({"userId": ObjectId(user_id), "revoked": False, "deletedAt": None})
        except Exception as e:
            logger.error(f"Session count error: {e}")
            return 0

    async def touch_last_seen(self, jti: str) -> None:
        try:
            await self.collection.update_one(
                {"jti": jti, "revoked": False, "deletedAt": None},
                {"$set": {"lastSeenAt": datetime.utcnow()}},
            )
        except Exception:
            pass


session_repository = SessionRepository()