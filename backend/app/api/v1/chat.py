import json
import logging
import os
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from app.repositories.chat_repository import chat_repository, chat_message_repository
from app.services.chat_ai_service import suggest_replies, translate_text, normalize_language
from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.schemas.notification import NotificationType, NotificationPriority
from app.services.notification_service import NotificationService

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


async def get_optional_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> Optional[dict]:
    """Resolve the authenticated user when a valid Bearer token is present.

    Returns ``None`` when there is no token so the seeded demo flows (which
    identify the sender explicitly) keep working. When a token *is* present it
    must be valid, otherwise the request is rejected.
    """
    if credentials is None:
        return None
    return await get_current_user(credentials.credentials)

router = APIRouter()

# Active websocket connections (runtime only — never persisted).
active_connections: dict[str, list[WebSocket]] = {}

_seeded = False

# Seed data used only on first run so a fresh database still has demo threads.
SAMPLE_CONVERSATIONS = {
    "conv-1": {
        "id": "conv-1",
        "conversation_type": "customer",
        "participants": [
            {"id": "user-1", "name": "You", "role": "customer"},
            {"id": "farmer-1", "name": "Rajesh Kumar", "role": "farmer"},
        ],
        "subject": "Fresh Tomatoes Order",
        "last_message": {"content": "Your tomatoes are ready for pickup!", "sender_name": "Rajesh Kumar", "created_at": "2025-07-10T10:30:00Z"},
        "unread_count": 2,
        "status": "active",
        "created_at": "2025-07-01T08:00:00Z",
        "updated_at": "2025-07-10T10:30:00Z",
    },
    "conv-2": {
        "id": "conv-2",
        "conversation_type": "customer",
        "participants": [
            {"id": "user-1", "name": "You", "role": "customer"},
            {"id": "farmer-2", "name": "Priya Devi", "role": "farmer"},
        ],
        "subject": "Organic Oranges Inquiry",
        "last_message": {"content": "Yes, we have fresh stock available.", "sender_name": "Priya Devi", "created_at": "2025-07-09T14:20:00Z"},
        "unread_count": 0,
        "status": "active",
        "created_at": "2025-07-01T09:00:00Z",
        "updated_at": "2025-07-09T14:20:00Z",
    },
    "conv-3": {
        "id": "conv-3",
        "conversation_type": "delivery",
        "participants": [
            {"id": "user-1", "name": "You", "role": "customer"},
            {"id": "delivery-1", "name": "Suresh Delivery", "role": "delivery"},
        ],
        "subject": "Delivery #DEL-045",
        "last_message": {"content": "I am 10 minutes away from your location.", "sender_name": "Suresh Delivery", "created_at": "2025-07-08T16:45:00Z"},
        "unread_count": 1,
        "status": "active",
        "created_at": "2025-07-05T10:00:00Z",
        "updated_at": "2025-07-08T16:45:00Z",
    },
}

SAMPLE_MESSAGES = {
    "conv-1": [
        {"id": "m1", "sender_id": "farmer-1", "sender_name": "Rajesh Kumar", "content": "Hi! Your order for fresh tomatoes has been confirmed.", "created_at": "2025-07-10T09:00:00Z"},
        {"id": "m2", "sender_id": "user-1", "sender_name": "You", "content": "Great, when will they be ready?", "created_at": "2025-07-10T09:05:00Z"},
        {"id": "m3", "sender_id": "farmer-1", "sender_name": "Rajesh Kumar", "content": "Your tomatoes are ready for pickup!", "created_at": "2025-07-10T10:30:00Z"},
    ],
    "conv-2": [
        {"id": "m1", "sender_id": "user-1", "sender_name": "You", "content": "Do you have organic oranges available this week?", "created_at": "2025-07-09T14:00:00Z"},
        {"id": "m2", "sender_id": "farmer-2", "sender_name": "Priya Devi", "content": "Yes, we have fresh stock available.", "created_at": "2025-07-09T14:20:00Z"},
    ],
    "conv-3": [
        {"id": "m1", "sender_id": "user-1", "sender_name": "You", "content": "Where is my delivery?", "created_at": "2025-07-08T16:30:00Z"},
        {"id": "m2", "sender_id": "delivery-1", "sender_name": "Suresh Delivery", "content": "I am 10 minutes away from your location.", "created_at": "2025-07-08T16:45:00Z"},
    ],
}

# Supported conversation types mirror the farmer dashboard categories.
CONVERSATION_TYPES = {"customer", "delivery", "b2b", "support"}

# Quick-action registry: these are structured messages (not free text), so the
# UI renders them as buttons and the backend validates the key.
QUICK_ACTIONS = {
    "delivery": [
        {"key": "arriving", "label": "I'm Arriving", "message": "I'm arriving at the location."},
        {"key": "pickup_completed", "label": "Pickup Completed", "message": "Pickup completed."},
        {"key": "running_late", "label": "Running Late", "message": "I'm running late by a few minutes."},
        {"key": "cant_deliver", "label": "Can't Deliver", "message": "I can't make this delivery."},
        {"key": "on_the_way", "label": "On The Way", "message": "I'm on the way."},
        {"key": "share_pickup_location", "label": "Share Farm Pickup", "message": "📍 Farm Pickup Location", "kind": "location", "share_kind": "pickup"},
        {"key": "share_delivery_location", "label": "Share Meeting Point", "message": "📍 Delivery Meeting Point", "kind": "location", "share_kind": "delivery"},
    ],
    "customer": [
        {"key": "ready_for_delivery", "label": "Order Ready", "message": "Your order is ready for delivery."},
        {"key": "on_the_way", "label": "On The Way", "message": "Your order is on the way."},
        {"key": "delivered", "label": "Delivered", "message": "Your order has been delivered."},
    ],
    "b2b": [
        {"key": "offer_submitted", "label": "Offer Submitted", "message": "My quote has been submitted. Please review it."},
        {"key": "confirm_quantity", "label": "Confirm Quantity", "message": "Could you confirm the required quantity?"},
        {"key": "request_advance", "label": "Request Advance", "message": "Could we confirm the advance/payment terms?"},
    ],
    "support": [
        {"key": "payment_issue", "label": "Payment Issue", "message": "I'm facing an issue with a payment/settlement."},
        {"key": "order_issue", "label": "Order Issue", "message": "I need help with an order."},
        {"key": "delivery_issue", "label": "Delivery Issue", "message": "I need help with a delivery."},
        {"key": "quality_dispute", "label": "Quality Dispute", "message": "I want to raise a quality dispute."},
        {"key": "technical_issue", "label": "Technical Issue", "message": "I'm facing a technical issue with the app."},
    ],
}


def _conv_type(conv_id: str) -> str:
    if conv_id.startswith("delivery-chat-"):
        return "delivery"
    if conv_id.startswith("rfq-chat-"):
        return "b2b"
    if conv_id.startswith("support-"):
        return "support"
    return "customer"


async def _ensure_seeded() -> None:
    """Seed demo conversations on a truly empty database (first boot only)."""
    global _seeded
    if _seeded:
        return
    try:
        count = await chat_repository.count({})
        if count == 0:
            for conv in SAMPLE_CONVERSATIONS.values():
                await chat_repository.upsert_conversation(conv)
            for conv_id, msgs in SAMPLE_MESSAGES.items():
                for m in msgs:
                    await chat_message_repository.add_message({**m, "conversation_id": conv_id})
    except Exception as e:
        logger.error(f"Chat seed failed: {e}")
    _seeded = True


class MessageSend(BaseModel):
    conversation_id: str
    content: str
    sender_id: str = "user-1"
    sender_name: str = "You"
    sender_role: str = "customer"
    message_type: str = "text"
    action: Optional[str] = None
    attachments: list[dict] = Field(default_factory=list)
    location: Optional[dict] = None


class LocationShare(BaseModel):
    conversation_id: str
    sender_id: str = "user-1"
    sender_name: str = "You"
    sender_role: str = "customer"
    latitude: float
    longitude: float
    label: str = "Shared Location"
    share_kind: str = "pickup"  # pickup | delivery | custom


class QuickActionSend(BaseModel):
    conversation_id: str
    action: str
    sender_id: str = "user-1"
    sender_name: str = "You"
    sender_role: str = "farmer"


class SupportThreadCreate(BaseModel):
    user_id: str = "user-1"
    user_name: str = "Farmer"
    user_role: str = "farmer"
    order_id: Optional[str] = None
    order_number: Optional[str] = None
    issue_type: Optional[str] = None
    subject: Optional[str] = None


class OrderThreadCreate(BaseModel):
    order_id: str
    order_number: Optional[str] = None
    customer_id: str
    customer_name: str
    farmer_id: str
    farmer_name: str
    delivery_partner_id: Optional[str] = None
    delivery_partner_name: Optional[str] = None
    product_summary: Optional[str] = None


class RfqThreadCreate(BaseModel):
    rfq_id: str
    rfq_number: Optional[str] = None
    business_user_id: str
    business_name: str
    farmer_id: str
    farmer_name: str
    product_name: Optional[str] = None


async def _delivery_chat_participant(conversation_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Resolve the friendly counterpart for a `delivery-chat-{orderId}` thread.

    Delivery threads are created implicitly when an order's live-chat opens, so
    their participants list only contains whoever opened them. Look up the
    order to show the real counterpart (customer <-> farmer).
    """
    if not conversation_id.startswith("delivery-chat-"):
        return None
    try:
        order_id = conversation_id[len("delivery-chat-"):]
        from app.repositories.order_repository import order_repository
        from app.repositories.user_repository import user_repository

        order = await order_repository.get_by_id(order_id)
        if not order:
            return None

        farmer_id = order.get("farmerId")
        customer_id = order.get("customerId")
        customer_name = order.get("customerName") or "Customer"
        farmer_name = order.get("farmerName")
        if not farmer_name and farmer_id:
            farmer_user = await user_repository.get_by_id(str(farmer_id))
            if farmer_user:
                farmer_name = f"{farmer_user.get('firstName', '')} {farmer_user.get('lastName', '')}".strip() or None

        delivery_partner_id = order.get("deliveryPartnerId")
        delivery_partner_name = order.get("deliveryPartnerName")

        if user_id and farmer_id and str(farmer_id) == str(user_id):
            # The farmer is talking to the delivery partner (or the customer if
            # no partner is assigned yet).
            if delivery_partner_name:
                return {"id": str(delivery_partner_id or ""), "name": delivery_partner_name, "role": "delivery"}
            return {"id": str(customer_id or ""), "name": customer_name, "role": "customer"}
        if user_id and customer_id and str(customer_id) == str(user_id):
            return {"id": str(farmer_id or ""), "name": farmer_name or "Farmer", "role": "farmer"}
        if user_id and delivery_partner_id and str(delivery_partner_id) == str(user_id):
            return {"id": str(farmer_id or ""), "name": farmer_name or "Farmer", "role": "farmer"}
        if delivery_partner_name:
            return {"id": str(delivery_partner_id or ""), "name": delivery_partner_name, "role": "delivery"}
        return {"id": str(farmer_id or ""), "name": farmer_name or "Farmer", "role": "farmer"}
    except Exception as e:
        logger.error(f"Delivery chat participant lookup failed: {e}")
        return None


async def _rfq_chat_participant(conversation_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    """Resolve the friendly counterpart for a `rfq-chat-{rfqId}` thread."""
    if not conversation_id.startswith("rfq-chat-"):
        return None
    try:
        rfq_id = conversation_id[len("rfq-chat-"):]
        from app.repositories.user_repository import user_repository
        from app.repositories.base_repository import BaseRepository

        rfq_repo = BaseRepository("b2b_rfqs")
        from bson import ObjectId
        try:
            rfq = await rfq_repo.find_one({"_id": ObjectId(rfq_id)})
        except Exception:
            rfq = await rfq_repo.find_one({"id": rfq_id})

        business_user_id = rfq.get("businessUserId") if rfq else None
        profile_id = rfq.get("businessProfileId") if rfq else None
        business_name = "Business Buyer"
        if rfq and profile_id:
            profile_repo = BaseRepository("business_profiles")
            try:
                profile = await profile_repo.find_one({"_id": ObjectId(profile_id)})
            except Exception:
                profile = None
            if profile and profile.get("businessName"):
                business_name = profile.get("businessName")

        if user_id and business_user_id and str(business_user_id) == str(user_id):
            return {"id": "", "name": business_name, "role": "business"}
        return {"id": str(business_user_id or ""), "name": business_name, "role": "business"}
    except Exception as e:
        logger.error(f"RFQ chat participant lookup failed: {e}")
        return None


async def _derive_participant(conv: dict, user_id: Optional[str] = None) -> dict:
    participants = conv.get("participants", [])
    conv_id = conv.get("id", "")
    if user_id:
        for p in participants:
            if str(p.get("id")) != str(user_id):
                return {"id": str(p.get("id", "")), "name": p.get("name", "Contact"), "role": p.get("role", "")}

    enriched = await _delivery_chat_participant(conv_id, user_id)
    if enriched:
        return enriched

    enriched = await _rfq_chat_participant(conv_id, user_id)
    if enriched:
        return enriched

    if participants:
        return {"id": str(participants[0].get("id", "")), "name": participants[0].get("name", "Contact"), "role": participants[0].get("role", "")}
    return {"id": "", "name": "Support", "role": "support"}


def _conversation_doc(conv_id: str, sender_id: str, sender_name: str, sender_role: str, now: datetime) -> dict:
    conv_type = _conv_type(conv_id)
    return {
        "id": conv_id,
        "conversation_type": conv_type,
        "participants": [{"id": sender_id, "name": sender_name, "role": sender_role}],
        "subject": "Delivery conversation" if conv_id.startswith("delivery-chat-") else "Chat",
        "quick_actions": QUICK_ACTIONS.get(conv_type, []),
        "last_message": None,
        "unread_count": 0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }


async def _ensure_participant(conv: dict, sender_id: str, sender_name: str, sender_role: str) -> None:
    participants = conv.get("participants", [])
    if not any(str(p.get("id")) == str(sender_id) for p in participants):
        conv.setdefault("participants", []).append(
            {"id": sender_id, "name": sender_name, "role": sender_role}
        )
        await chat_repository.upsert_conversation(conv)


def _display_name(user: dict) -> str:
    """Friendly name for an authenticated user document."""
    first = user.get("firstName") or user.get("first_name") or ""
    last = user.get("lastName") or user.get("last_name") or ""
    return f"{first} {last}".strip() or "User"


async def _allowed_user_ids(conversation_id: str) -> set:
    """The set of user ids that may read/write a conversation.

    Implements the order-centric access-control model: a thread is only
    accessible to the participants of its linked order/RFQ, plus platform
    support for ``support-*`` threads. This prevents strangers from joining or
    spying on a conversation.
    """
    allowed = set()

    if conversation_id.startswith("delivery-chat-") or conversation_id.startswith("order-chat-"):
        try:
            order_id = conversation_id.split("-", 2)[2]
            from app.repositories.order_repository import order_repository

            order = await order_repository.get_by_id(order_id)
            if order:
                for key in ("farmerId", "customerId", "deliveryPartnerId"):
                    val = order.get(key)
                    if val:
                        allowed.add(str(val))
        except Exception as e:
            logger.error(f"Order participant lookup failed for {conversation_id}: {e}")

    elif conversation_id.startswith("rfq-chat-"):
        try:
            from app.repositories.base_repository import BaseRepository
            from bson import ObjectId

            rfq_id = conversation_id[len("rfq-chat-"):]
            rfq_repo = BaseRepository("b2b_rfqs")
            offer_repo = BaseRepository("b2b_offers")
            try:
                rfq = await rfq_repo.find_one({"_id": ObjectId(rfq_id)})
            except Exception:
                rfq = None
            if rfq:
                bid = rfq.get("businessUserId")
                if bid:
                    allowed.add(str(bid))
            offers = await offer_repo.find_many({"rfqId": rfq_id, "deletedAt": None}, limit=500)
            for offer in offers or []:
                fid = offer.get("farmerId")
                if fid:
                    allowed.add(str(fid))
        except Exception as e:
            logger.error(f"RFQ participant lookup failed for {conversation_id}: {e}")

    elif conversation_id.startswith("support-"):
        owner = conversation_id[len("support-"):]
        if owner:
            allowed.add(owner)
        # Platform support agents may always access support threads.
        allowed.add("support")

    return allowed


async def _can_access_conversation(conversation_id: str, user_id: str) -> bool:
    """Whether ``user_id`` is allowed to access ``conversation_id``.

    A user may access a thread when they are a recorded participant, are part
    of the linked order/RFQ, or are the owner of a support thread. Unknown
    threads (never persisted) are treated as accessible so demo clients can
    still open them, but once the thread exists the rules are enforced.
    """
    conv = await chat_repository.get_conversation(conversation_id)
    if conv:
        participants = conv.get("participants", [])
        if any(str(p.get("id")) == str(user_id) for p in participants):
            return True
        allowed = await _allowed_user_ids(conversation_id)
        return user_id in allowed
    # Thread does not exist yet — first message / WS open. Only allow when the
    # user is genuinely linked to the underlying order/RFQ/support owner.
    allowed = await _allowed_user_ids(conversation_id)
    if not allowed:
        return True  # e.g. seed demo threads
    return user_id in allowed


async def _resolve_sender(
    current_user: Optional[dict],
    fallback_id: str = "user-1",
    fallback_name: str = "You",
    fallback_role: str = "customer",
) -> tuple:
    """Prefer the authenticated user identity over any client-supplied id.

    When a token is present the sender identity always comes from the token, so
    a caller can never impersonate another user. Without a token (seed demo),
    the explicit sender fields are used.
    """
    if current_user:
        return (
            str(current_user["_id"]),
            _display_name(current_user),
            current_user.get("role") or fallback_role,
        )
    return fallback_id, fallback_name, fallback_role


async def _notify_recipients(
    conversation_id: str,
    sender_id: str,
    sender_name: str,
    content: str,
    message_type: str = "text",
) -> None:
    """Send an in-app CHAT notification to everyone allowed in the thread
    except the sender (best-effort — never blocks message delivery)."""
    try:
        recipients = await _allowed_user_ids(conversation_id)
        recipients.add(str(sender_id))
        recipients.discard("support")
        recipients.discard("")
        for uid in recipients:
            if uid == sender_id:
                continue
            try:
                await NotificationService.create_in_app_notification(
                    uid,
                    NotificationType.CHAT,
                    f"New message from {sender_name}",
                    content,
                    data={
                        "conversationId": conversation_id,
                        "senderId": sender_id,
                        "messageType": message_type,
                    },
                    priority=NotificationPriority.MEDIUM,
                )
            except Exception as e:
                logger.warning(f"Chat notification skipped for {uid}: {e}")
    except Exception as e:
        logger.warning(f"Chat notification broadcast failed: {e}")


async def _broadcast(conv_id: str, payload: dict, exclude: Optional[WebSocket] = None) -> None:
    dead = []
    for ws in active_connections.get(conv_id, []):
        if ws == exclude:
            continue
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            dead.append(ws)
    for ws in dead:
        if conv_id in active_connections:
            active_connections[conv_id].remove(ws)


def _subject_for(conv: dict) -> str:
    return conv.get("subject") or "Conversation"


# REST endpoints
@router.get("/conversations")
async def get_conversations(
    user_id: str = Query(None),
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    await _ensure_seeded()
    # When authenticated, always list the authenticated user's threads.
    if current_user:
        user_id = str(current_user["_id"])
    convs = await chat_repository.get_conversations(user_id)
    for c in convs:
        c["participant"] = await _derive_participant(c, user_id)
        c.setdefault("conversation_type", _conv_type(c.get("id", "")))
    return {"status": "success", "data": convs}


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    await _ensure_seeded()
    conv = await chat_repository.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if current_user and not await _can_access_conversation(conversation_id, str(current_user["_id"])):
        raise HTTPException(status_code=403, detail="You don't have access to this conversation")
    conv["participant"] = await _derive_participant(conv, str(current_user["_id"]) if current_user else None)
    conv.setdefault("conversation_type", _conv_type(conv.get("id", "")))
    return {"status": "success", "data": conv}


@router.get("/conversations/{conversation_id}/messages")
async def get_messages(
    conversation_id: str,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    await _ensure_seeded()
    if current_user and not await _can_access_conversation(conversation_id, str(current_user["_id"])):
        raise HTTPException(status_code=403, detail="You don't have access to this conversation")
    msgs = await chat_message_repository.get_messages(conversation_id)
    return {"status": "success", "data": msgs}


@router.post("/messages")
async def send_message(
    body: MessageSend,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    await _ensure_seeded()
    now = datetime.utcnow()
    conv_id = body.conversation_id

    sender_id, sender_name, sender_role = await _resolve_sender(
        current_user,
        body.sender_id,
        body.sender_name,
        body.sender_role,
    )
    if not await _can_access_conversation(conv_id, sender_id):
        raise HTTPException(status_code=403, detail="You don't have access to this conversation")

    conv = await chat_repository.get_conversation(conv_id)
    if not conv:
        conv = _conversation_doc(conv_id, sender_id, sender_name, sender_role, now)
        await chat_repository.upsert_conversation(conv)
    else:
        await _ensure_participant(conv, sender_id, sender_name, sender_role)

    saved = await chat_message_repository.add_message({
        "conversation_id": conv_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "sender_role": sender_role,
        "content": body.content,
        "message_type": body.message_type,
        "action": body.action,
        "attachments": body.attachments,
        "location": body.location,
        "created_at": now,
    })
    if not saved:
        raise HTTPException(status_code=500, detail="Failed to save message")

    await chat_repository.update_last_message(conv_id, {
        "content": body.content,
        "sender_name": sender_name,
        "created_at": now,
    })

    await _notify_recipients(conv_id, sender_id, sender_name, body.content, body.message_type)
    await _broadcast(conv_id, {"type": "new_message", "data": saved, "conversation_id": conv_id})

    return {"status": "success", "data": saved}


@router.post("/messages/quick-action")
async def send_quick_action(
    body: QuickActionSend,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Send a validated quick-action message (structured, not free text)."""
    await _ensure_seeded()
    now = datetime.utcnow()
    conv_id = body.conversation_id

    sender_id, sender_name, sender_role = await _resolve_sender(
        current_user,
        body.sender_id,
        body.sender_name,
        body.sender_role,
    )
    if not await _can_access_conversation(conv_id, sender_id):
        raise HTTPException(status_code=403, detail="You don't have access to this conversation")

    conv = await chat_repository.get_conversation(conv_id)
    if not conv:
        conv = _conversation_doc(conv_id, sender_id, sender_name, sender_role, now)
        await chat_repository.upsert_conversation(conv)
    else:
        await _ensure_participant(conv, sender_id, sender_name, sender_role)

    conv_type = _conv_type(conv_id)
    registry = QUICK_ACTIONS.get(conv_type, [])
    action_def = next((a for a in registry if a["key"] == body.action), None)
    if action_def is None:
        # Fall back to a generic registry so older clients still work.
        action_def = next(
            (a for a in QUICK_ACTIONS.get("delivery", []) if a["key"] == body.action),
            None,
        )
    if action_def is None:
        raise HTTPException(status_code=400, detail=f"Unknown quick action: {body.action}")

    saved = await chat_message_repository.add_message({
        "conversation_id": conv_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "sender_role": sender_role,
        "content": action_def["message"],
        "message_type": "quick_action",
        "action": action_def["key"],
        "attachments": [],
        "location": None,
        "created_at": now,
    })
    if not saved:
        raise HTTPException(status_code=500, detail="Failed to save message")

    await chat_repository.update_last_message(conv_id, {
        "content": action_def["message"],
        "sender_name": sender_name,
        "created_at": now,
    })

    await _notify_recipients(conv_id, sender_id, sender_name, action_def["message"], "quick_action")
    await _broadcast(conv_id, {"type": "new_message", "data": saved, "conversation_id": conv_id})
    return {"status": "success", "data": saved}


@router.get("/quick-actions")
async def get_quick_actions(conversation_type: str = Query("delivery")):
    """List the quick actions available for a conversation type."""
    actions = QUICK_ACTIONS.get(conversation_type) or QUICK_ACTIONS.get("delivery", [])
    return {"status": "success", "data": actions}


@router.post("/conversations/{conversation_id}/read")
async def mark_conversation_read(
    conversation_id: str,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Mark a conversation as read for the current user."""
    await _ensure_seeded()
    conv = await chat_repository.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    user_id = str(current_user["_id"]) if current_user else None
    if user_id and not await _can_access_conversation(conversation_id, user_id):
        raise HTTPException(status_code=403, detail="You don't have access to this conversation")
    await chat_repository.mark_read(conversation_id, user_id or "user-1")
    return {"status": "success", "data": {"conversation_id": conversation_id, "unread_count": 0}}


@router.post("/messages/location")
async def share_location(
    body: LocationShare,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Share a controlled location (farm pickup / delivery meeting point).

    Only a point, never the farmer's permanent home address. Stored as a
    structured ``location`` message that the UI can render on a map.
    """
    await _ensure_seeded()
    now = datetime.utcnow()
    conv_id = body.conversation_id

    sender_id, sender_name, sender_role = await _resolve_sender(
        current_user,
        body.sender_id,
        body.sender_name,
        body.sender_role,
    )
    if not await _can_access_conversation(conv_id, sender_id):
        raise HTTPException(status_code=403, detail="You don't have access to this conversation")

    conv = await chat_repository.get_conversation(conv_id)
    if not conv:
        conv = _conversation_doc(conv_id, sender_id, sender_name, sender_role, now)
        await chat_repository.upsert_conversation(conv)
    else:
        await _ensure_participant(conv, sender_id, sender_name, sender_role)

    kind_label = {
        "pickup": "Farm Pickup Location",
        "delivery": "Delivery Meeting Point",
    }.get(body.share_kind, body.label or "Shared Location")
    content = f"📍 {kind_label}"
    location = {
        "kind": body.share_kind,
        "label": kind_label,
        "latitude": body.latitude,
        "longitude": body.longitude,
    }

    saved = await chat_message_repository.add_message({
        "conversation_id": conv_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "sender_role": sender_role,
        "content": content,
        "message_type": "location",
        "action": f"share_{body.share_kind}_location",
        "attachments": [],
        "location": location,
        "created_at": now,
    })
    if not saved:
        raise HTTPException(status_code=500, detail="Failed to save message")

    await chat_repository.update_last_message(conv_id, {
        "content": content,
        "sender_name": sender_name,
        "created_at": now,
    })

    await _notify_recipients(conv_id, sender_id, sender_name, content, "location")
    await _broadcast(conv_id, {"type": "new_message", "data": saved, "conversation_id": conv_id})
    return {"status": "success", "data": saved}


@router.post("/messages/attachment")
async def upload_and_send_attachment(
    conversation_id: str = Query(...),
    file: UploadFile = File(...),
    caption: str = Form(""),
    sender_id: str = Form("user-1"),
    sender_name: str = Form("You"),
    sender_role: str = Form("customer"),
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Upload an image/PDF and attach it to a conversation message.

    Files are validated by magic bytes and stored under the platform uploads
    directory; the URL is served from ``/uploads``. The attachment becomes part
    of the official chat record (and can later be promoted to order evidence).
    """
    from app.utils.file_security import validate_upload, UploadValidationError

    sender_id, sender_name, sender_role = await _resolve_sender(
        current_user,
        sender_id,
        sender_name,
        sender_role,
    )
    if not await _can_access_conversation(conversation_id, sender_id):
        raise HTTPException(status_code=403, detail="You don't have access to this conversation")

    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    content_bytes = await file.read()
    try:
        ext = validate_upload(
            file.filename or "file",
            content_bytes,
            content_type=file.content_type,
            max_bytes=settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    filename = f"chat-{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content_bytes)

    url = f"/uploads/{filename}"
    now = datetime.utcnow()
    conv = await chat_repository.get_conversation(conversation_id)
    if not conv:
        conv = _conversation_doc(conversation_id, sender_id, sender_name, sender_role, now)
        await chat_repository.upsert_conversation(conv)
    else:
        await _ensure_participant(conv, sender_id, sender_name, sender_role)

    attachment = {"type": "image" if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif") else "document", "url": url, "name": filename}
    saved = await chat_message_repository.add_message({
        "conversation_id": conversation_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "sender_role": sender_role,
        "content": caption or "📎 Attachment",
        "message_type": "attachment",
        "action": "attach_file",
        "attachments": [attachment],
        "location": None,
        "created_at": now,
    })
    if not saved:
        raise HTTPException(status_code=500, detail="Failed to save message")

    await chat_repository.update_last_message(conversation_id, {
        "content": caption or "📎 Attachment",
        "sender_name": sender_name,
        "created_at": now,
    })

    await _notify_recipients(conversation_id, sender_id, sender_name, caption or "Sent an attachment", "attachment")
    await _broadcast(conversation_id, {"type": "new_message", "data": saved, "conversation_id": conversation_id})
    return {"status": "success", "data": saved}


@router.post("/threads/order")
async def create_order_thread(
    body: OrderThreadCreate,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Create or open an order-linked conversation (customer <-> farmer)."""
    await _ensure_seeded()
    if current_user and str(current_user["_id"]) not in (body.customer_id, body.farmer_id):
        raise HTTPException(status_code=403, detail="You are not part of this order")
    now = datetime.utcnow()
    conv_id = f"order-chat-{body.order_id}"

    existing = await chat_repository.get_conversation(conv_id)
    if existing:
        existing.setdefault("conversation_type", "customer")
        existing.setdefault("order_id", body.order_id)
        existing.setdefault("order_number", body.order_number)
        existing.setdefault("subject", body.product_summary or f"Order {body.order_number or ''}".strip())
        await chat_repository.upsert_conversation(existing)
        existing["participant"] = await _derive_participant(existing, body.customer_id)
        return {"status": "success", "data": existing}

    participants = [
        {"id": body.customer_id, "name": body.customer_name, "role": "customer"},
        {"id": body.farmer_id, "name": body.farmer_name, "role": "farmer"},
    ]
    conv = {
        "id": conv_id,
        "conversation_type": "customer",
        "participants": participants,
        "subject": body.product_summary or f"Order {body.order_number or ''}".strip(),
        "order_id": body.order_id,
        "order_number": body.order_number,
        "last_message": None,
        "unread_count": 0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await chat_repository.upsert_conversation(conv)
    conv["participant"] = await _derive_participant(conv, body.customer_id)
    return {"status": "success", "data": conv}


@router.post("/threads/delivery")
async def create_delivery_thread(
    body: OrderThreadCreate,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Create or open a delivery-linked conversation (farmer <-> delivery partner)."""
    await _ensure_seeded()
    if current_user:
        mine = {body.farmer_id, body.customer_id, body.delivery_partner_id or ""}
        if str(current_user["_id"]) not in mine:
            raise HTTPException(status_code=403, detail="You are not part of this order")
    now = datetime.utcnow()
    conv_id = f"delivery-chat-{body.order_id}"

    existing = await chat_repository.get_conversation(conv_id)
    if existing:
        if body.delivery_partner_id and not any(
            str(p.get("id")) == str(body.delivery_partner_id) for p in existing.get("participants", [])
        ):
            existing.setdefault("participants", []).append(
                {"id": body.delivery_partner_id, "name": body.delivery_partner_name or "Delivery Partner", "role": "delivery"}
            )
        existing.setdefault("conversation_type", "delivery")
        existing.setdefault("order_id", body.order_id)
        existing.setdefault("order_number", body.order_number)
        existing.setdefault("subject", body.product_summary or f"Delivery #{body.order_number or ''}".strip())
        await chat_repository.upsert_conversation(existing)
        existing["participant"] = await _derive_participant(existing, body.farmer_id)
        return {"status": "success", "data": existing}

    participants = [
        {"id": body.farmer_id, "name": body.farmer_name, "role": "farmer"},
        {"id": body.delivery_partner_id or body.customer_id, "name": body.delivery_partner_name or body.customer_name, "role": "delivery" if body.delivery_partner_id else "customer"},
    ]
    conv = {
        "id": conv_id,
        "conversation_type": "delivery",
        "participants": participants,
        "subject": body.product_summary or f"Delivery #{body.order_number or ''}".strip(),
        "order_id": body.order_id,
        "order_number": body.order_number,
        "quick_actions": QUICK_ACTIONS["delivery"],
        "last_message": None,
        "unread_count": 0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await chat_repository.upsert_conversation(conv)
    conv["participant"] = await _derive_participant(conv, body.farmer_id)
    return {"status": "success", "data": conv}


@router.post("/threads/rfq")
async def create_rfq_thread(
    body: RfqThreadCreate,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Create or open an RFQ-linked conversation (farmer <-> business buyer)."""
    await _ensure_seeded()
    if current_user and str(current_user["_id"]) not in (body.farmer_id, body.business_user_id):
        raise HTTPException(status_code=403, detail="You are not part of this RFQ")
    now = datetime.utcnow()
    conv_id = f"rfq-chat-{body.rfq_id}"

    existing = await chat_repository.get_conversation(conv_id)
    if existing:
        existing.setdefault("conversation_type", "b2b")
        existing.setdefault("rfq_id", body.rfq_id)
        existing.setdefault("rfq_number", body.rfq_number)
        existing.setdefault("subject", f"{body.product_name or 'B2B'} Inquiry")
        await chat_repository.upsert_conversation(existing)
        existing["participant"] = await _derive_participant(existing, body.farmer_id)
        return {"status": "success", "data": existing}

    participants = [
        {"id": body.farmer_id, "name": body.farmer_name, "role": "farmer"},
        {"id": body.business_user_id, "name": body.business_name, "role": "business"},
    ]
    conv = {
        "id": conv_id,
        "conversation_type": "b2b",
        "participants": participants,
        "subject": f"{body.product_name or 'B2B'} Inquiry",
        "rfq_id": body.rfq_id,
        "rfq_number": body.rfq_number,
        "quick_actions": QUICK_ACTIONS["b2b"],
        "last_message": None,
        "unread_count": 0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await chat_repository.upsert_conversation(conv)
    conv["participant"] = await _derive_participant(conv, body.farmer_id)
    return {"status": "success", "data": conv}


@router.post("/threads/support")
async def create_support_thread(
    body: SupportThreadCreate,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Create or open a support conversation (farmer <-> AgriConnect support)."""
    await _ensure_seeded()
    if current_user and str(current_user["_id"]) != body.user_id:
        raise HTTPException(status_code=403, detail="Support threads are per-user")
    now = datetime.utcnow()
    conv_id = f"support-{body.user_id}"

    existing = await chat_repository.get_conversation(conv_id)
    if existing:
        existing.setdefault("conversation_type", "support")
        existing.setdefault("order_id", body.order_id)
        existing.setdefault("order_number", body.order_number)
        existing.setdefault("subject", "AgriConnect Support")
        existing["quick_actions"] = QUICK_ACTIONS["support"]
        await chat_repository.upsert_conversation(existing)
        existing["participant"] = {"id": "support", "name": "AgriConnect Support", "role": "support"}
        return {"status": "success", "data": existing}

    participants = [
        {"id": body.user_id, "name": body.user_name, "role": body.user_role},
        {"id": "support", "name": "AgriConnect Support", "role": "support"},
    ]
    conv = {
        "id": conv_id,
        "conversation_type": "support",
        "participants": participants,
        "subject": "AgriConnect Support",
        "order_id": body.order_id,
        "order_number": body.order_number,
        "issue_type": body.issue_type,
        "quick_actions": QUICK_ACTIONS["support"],
        "last_message": None,
        "unread_count": 0,
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await chat_repository.upsert_conversation(conv)
    conv["participant"] = {"id": "support", "name": "AgriConnect Support", "role": "support"}
    return {"status": "success", "data": conv}


class SuggestReplyRequest(BaseModel):
    conversation_id: str
    message: Optional[str] = None
    role: Optional[str] = None
    language: str = "english"
    price: Optional[float] = None


@router.post("/ai/suggest-reply")
async def ai_suggest_reply(body: SuggestReplyRequest):
    """Suggest editable replies for the farmer based on the incoming message."""
    await _ensure_seeded()
    lang = normalize_language(body.language)
    suggestions = suggest_replies(
        message=body.message,
        role=body.role,
        language=lang,
        price=body.price,
    )
    return {"status": "success", "data": {"suggestions": suggestions, "language": lang}}


class TranslateRequest(BaseModel):
    text: str
    source_language: str = "english"
    target_language: str = "tamil"


@router.post("/ai/translate")
async def ai_translate(body: TranslateRequest):
    """Translate a message to the farmer's target language."""
    result = translate_text(
        text=body.text,
        target_language=body.target_language,
        source_language=body.source_language,
    )
    return {"status": "success", "data": result}


@router.websocket("/ws/{conversation_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    conversation_id: str,
    user_id: str = Query("user-1"),
    user_name: str = Query("You"),
    user_role: str = Query("customer"),
    token: str = Query(None),
):
    await websocket.accept()
    logger.info(f"WebSocket connected: {conversation_id} for user {user_name}")
    await _ensure_seeded()

    now = datetime.utcnow()

    # Prefer the authenticated identity when a token is supplied, so the
    # sender can never be spoofed through query params.
    if token:
        try:
            from app.api.v1.auth import get_current_user as _resolve_ws_user

            user = await _resolve_ws_user(token)
            if user:
                user_id = str(user["_id"])
                user_name = _display_name(user)
                user_role = user.get("role") or user_role
        except HTTPException:
            await websocket.send_text(json.dumps({"type": "error", "data": "Invalid token"}))
            await websocket.close(code=1008)
            return

    if not await _can_access_conversation(conversation_id, user_id):
        await websocket.send_text(json.dumps({"type": "error", "data": "Access denied"}))
        await websocket.close(code=1008)
        return

    conv = await chat_repository.get_conversation(conversation_id)
    if not conv:
        conv = _conversation_doc(conversation_id, user_id, user_name, user_role, now)
        await chat_repository.upsert_conversation(conv)
    else:
        await _ensure_participant(conv, user_id, user_name, user_role)

    if conversation_id not in active_connections:
        active_connections[conversation_id] = []
    active_connections[conversation_id].append(websocket)

    await websocket.send_text(json.dumps({
        "type": "connected",
        "data": {"conversation_id": conversation_id, "user_id": user_id, "user_name": user_name},
    }))

    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                content = msg.get("content", "").strip()
                if not content:
                    continue

                saved = await chat_message_repository.add_message({
                    "conversation_id": conversation_id,
                    "sender_id": user_id,
                    "sender_name": user_name,
                    "sender_role": user_role,
                    "content": content,
                    "message_type": msg.get("message_type", "text"),
                    "action": msg.get("action"),
                    "attachments": msg.get("attachments") or [],
                    "location": msg.get("location"),
                    "created_at": datetime.utcnow(),
                })
                if not saved:
                    continue

                await chat_repository.update_last_message(conversation_id, {
                    "content": content,
                    "sender_name": user_name,
                    "created_at": saved.get("created_at"),
                })

                await _notify_recipients(conversation_id, user_id, user_name, content, msg.get("message_type", "text"))
                await _broadcast(conversation_id, {"type": "new_message", "data": saved, "conversation_id": conversation_id}, exclude=websocket)

                await websocket.send_text(json.dumps({
                    "type": "message_sent",
                    "data": saved,
                    "conversation_id": conversation_id,
                }))

            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "data": "Invalid JSON"}))

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {conversation_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if conversation_id in active_connections:
            active_connections[conversation_id] = [ws for ws in active_connections[conversation_id] if ws != websocket]
            if not active_connections[conversation_id]:
                del active_connections[conversation_id]
