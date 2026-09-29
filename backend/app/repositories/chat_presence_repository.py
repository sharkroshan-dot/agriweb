from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from app.repositories.base_repository import BaseRepository


class ChatPresenceRepository(BaseRepository):
    def __init__(self):
        super().__init__("chat_presence")

    async def heartbeat(self, user_id: str, name: str = "", role: str = "") -> Dict[str, Any]:
        now = datetime.utcnow()
        await self.collection.update_one(
            {"user_id": str(user_id)},
            {"$set": {
                "user_id": str(user_id),
                "name": name,
                "role": role,
                "last_seen": now,
                "updated_at": now,
            }},
            upsert=True,
        )
        return {
            "user_id": str(user_id),
            "name": name,
            "role": role,
            "last_seen": now,
            "online": True,
        }

    async def get(self, user_id: str) -> Optional[Dict[str, Any]]:
        return await self.find_one({"user_id": str(user_id)})

    async def get_status(self, user_id: str) -> Dict[str, Any]:
        doc = await self.get(user_id)
        if not doc or not doc.get("last_seen"):
            return {"user_id": str(user_id), "online": False, "last_seen": None}

        last_seen = doc["last_seen"]
        online = datetime.utcnow() - last_seen <= timedelta(seconds=60)
        return {
            "user_id": str(user_id),
            "name": doc.get("name", ""),
            "role": doc.get("role", ""),
            "online": online,
            "last_seen": last_seen,
        }


chat_presence_repository = ChatPresenceRepository()
