from typing import Optional, Dict, Any, List
from datetime import datetime
from bson import ObjectId
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)


class ChatRepository(BaseRepository):
    """Persistent chat conversations + messages in MongoDB.

    Conversation ids are natural strings (e.g. ``delivery-chat-{orderId}``), so
    they are stored as the ``_id`` and a mirror ``id`` field for convenience.
    Messages are separate documents keyed by ``conversation_id`` and sorted by
    ``created_at``.
    """

    def __init__(self):
        super().__init__("chat_conversations")

    async def upsert_conversation(self, conv: Dict[str, Any]) -> None:
        conv_id = conv.get("id")
        if not conv_id:
            return
        data = dict(conv)
        created = data.get("created_at") or datetime.utcnow()
        data["created_at"] = created
        data["updated_at"] = datetime.utcnow()
        set_data = {k: v for k, v in data.items() if k != "created_at"}
        try:
            await self.collection.update_one(
                {"_id": conv_id},
                {"$set": set_data, "$setOnInsert": {"created_at": created}},
                upsert=True,
            )
        except Exception as e:
            logger.error(f"Error upserting conversation {conv_id}: {e}")

    async def get_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        return await self.find_one({"id": conversation_id})

    async def _delivery_chat_ids_for_user(self, user_id: str) -> List[str]:
        """Conversation ids for `delivery-chat-{orderId}` threads the user may
        access: any order where they are the farmer or the customer."""
        try:
            from app.repositories.order_repository import order_repository

            ids = [user_id]
            try:
                ids.append(str(ObjectId(user_id)))
            except Exception:
                pass
            orders = await order_repository.find_many(
                {"$or": [{"farmerId": {"$in": ids}}, {"customerId": {"$in": ids}}]},
                limit=500,
            )
            return [f"delivery-chat-{str(o.get('_id'))}" for o in (orders or []) if o.get("_id")]
        except Exception as e:
            logger.error(f"Failed to resolve delivery chats for {user_id}: {e}")
            return []

    async def _order_chat_ids_for_user(self, user_id: str) -> List[str]:
        """Conversation ids for `order-chat-{orderId}` threads the user may
        access (customer <-> farmer threads)."""
        try:
            from app.repositories.order_repository import order_repository

            ids = [user_id]
            try:
                ids.append(str(ObjectId(user_id)))
            except Exception:
                pass
            orders = await order_repository.find_many(
                {"$or": [{"farmerId": {"$in": ids}}, {"customerId": {"$in": ids}}]},
                limit=500,
            )
            return [f"order-chat-{str(o.get('_id'))}" for o in (orders or []) if o.get("_id")]
        except Exception as e:
            logger.error(f"Failed to resolve order chats for {user_id}: {e}")
            return []

    async def _rfq_chat_ids_for_user(self, user_id: str) -> List[str]:
        """Conversation ids for `rfq-chat-{rfqId}` threads the user may access:
        RFQs where they are the business buyer or the farmer with an offer."""
        try:
            from app.repositories.base_repository import BaseRepository

            ids = [user_id]
            try:
                ids.append(str(ObjectId(user_id)))
            except Exception:
                pass
            rfq_repo = BaseRepository("b2b_rfqs")
            offer_repo = BaseRepository("b2b_offers")
            # As a business buyer: their own RFQs.
            business_rfqs = await rfq_repo.find_many(
                {"businessUserId": {"$in": ids}, "deletedAt": None},
                limit=500,
            )
            # As a farmer: RFQs they have made an offer on.
            offers = await offer_repo.find_many(
                {"farmerId": {"$in": ids}, "deletedAt": None},
                limit=500,
            )
            rfq_ids = {str(o.get("_id")) for o in (business_rfqs or []) if o.get("_id")}
            rfq_ids.update(str(o.get("rfqId")) for o in (offers or []) if o.get("rfqId"))
            return [f"rfq-chat-{rid}" for rid in rfq_ids if rid]
        except Exception as e:
            logger.error(f"Failed to resolve RFQ chats for {user_id}: {e}")
            return []

    async def get_conversations(
        self,
        user_id: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        if user_id:
            ids = [user_id]
            try:
                ids.append(str(ObjectId(user_id)))
            except Exception:
                pass
            # Threads may be created implicitly before the other party opens
            # them, so include the user's own order/RFQ threads even when they
            # are not yet a recorded participant — but never threads that don't
            # involve this user.
            delivery_ids = await self._delivery_chat_ids_for_user(user_id)
            order_ids = await self._order_chat_ids_for_user(user_id)
            rfq_ids = await self._rfq_chat_ids_for_user(user_id)
            support_ids = [f"support-{user_id}"]
            linked_ids = list(dict.fromkeys(delivery_ids + order_ids + rfq_ids + support_ids))
            pipeline = [
                {
                    "$match": {
                        "$or": [
                            {"participants.id": {"$in": ids}},
                            {"id": {"$in": linked_ids}},
                        ]
                    }
                },
                {"$sort": {"updated_at": -1}},
                {"$limit": limit},
            ]
            results = await self.aggregate(pipeline)
            return results or []
        return await self.find_many({}, limit=limit, sort=[("updated_at", -1)])

    async def update_last_message(
        self,
        conversation_id: str,
        last_message: Dict[str, Any],
    ) -> None:
        try:
            await self.collection.update_one(
                {"id": conversation_id},
                {
                    "$set": {
                        "last_message": last_message,
                        "updated_at": datetime.utcnow(),
                    }
                },
            )
        except Exception as e:
            logger.error(f"Error updating last message for {conversation_id}: {e}")

    async def mark_read(self, conversation_id: str, user_id: str) -> None:
        try:
            await self.collection.update_one(
                {"id": conversation_id},
                {"$set": {"unread_count": 0, "updated_at": datetime.utcnow()}},
            )
        except Exception as e:
            logger.error(f"Error marking conversation read: {e}")


class ChatMessageRepository(BaseRepository):
    def __init__(self):
        super().__init__("chat_messages")

    async def add_message(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        msg.setdefault("created_at", datetime.utcnow())
        inserted_id = await self.create(msg)
        if not inserted_id:
            return None
        # Mirror the Mongo _id into a stable string `id` field (same convention
        # as conversations) so clients can key and de-duplicate messages.
        try:
            await self.collection.update_one(
                {"_id": ObjectId(inserted_id)},
                {"$set": {"id": inserted_id}},
            )
        except Exception as e:
            logger.error(f"Error mirroring message id for {inserted_id}: {e}")
        return {**msg, "id": inserted_id}

    async def get_messages(
        self,
        conversation_id: str,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        messages = await self.find_many(
            {"conversation_id": conversation_id},
            limit=limit,
            sort=[("created_at", 1)],
        )
        # Legacy rows created before the `id` mirror exist may lack it; derive
        # it from `_id` so every payload exposes a stable string id.
        for m in messages or []:
            if not m.get("id"):
                m["id"] = str(m.get("_id", ""))
        return messages or []


chat_repository = ChatRepository()
chat_message_repository = ChatMessageRepository()