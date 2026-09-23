"""Chat message tests: order-scoped access control, quick actions, location
sharing, attachments, AI suggestions, and message notifications.

All tests monkeypatch repositories - no MongoDB / network required.
"""
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1 import chat as chat_mod
from app.repositories.chat_repository import chat_repository, chat_message_repository

OID = "507f1f77bcf86cd799439011"  # farmer
OID2 = "507f1f77bcf86cd799439012"  # customer
OID3 = "507f1f77bcf86cd799439013"  # delivery partner
ORDER_OID = "507f1f77bcf86cd799439020"
RFQ_OID = "507f1f77bcf86cd799439030"


def _farmer_user():
    return {"_id": OID, "role": "farmer", "firstName": "Kumar", "lastName": "Rao"}


def _customer_user():
    return {"_id": OID2, "role": "customer", "firstName": "Asha", "lastName": "Devi"}


def _delivery_user():
    return {"_id": OID3, "role": "delivery", "firstName": "Ravi", "lastName": "Das"}


def _order(order_id=ORDER_OID, delivery_partner_id=OID3):
    return {
        "_id": order_id,
        "farmerId": OID,
        "customerId": OID2,
        "deliveryPartnerId": delivery_partner_id,
    }


def _order_conversation(participants=None):
    return {
        "id": f"order-chat-{ORDER_OID}",
        "conversation_type": "customer",
        "participants": participants
        or [
            {"id": OID, "name": "Kumar Rao", "role": "farmer"},
            {"id": OID2, "name": "Asha Devi", "role": "customer"},
        ],
        "subject": "Order AG-100",
        "last_message": None,
        "unread_count": 0,
        "status": "active",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }


def _message(conversation_id="order-chat-507f1f77bcf86cd799439020", sender_id=OID2):
    return {
        "id": "msg-1",
        "conversation_id": conversation_id,
        "sender_id": sender_id,
        "sender_name": "Asha Devi",
        "sender_role": "customer",
        "content": "Can you deliver this tomorrow?",
        "message_type": "text",
        "attachments": [],
        "location": None,
        "created_at": datetime.utcnow(),
    }


# ============ Access control ============

@pytest.mark.asyncio
async def test_order_thread_rejects_stranger(monkeypatch):
    stranger = {"_id": "507f1f77bcf86cd799439099", "role": "customer", "firstName": "X", "lastName": "Y"}
    body = chat_mod.OrderThreadCreate(
        order_id=ORDER_OID,
        order_number="AG-100",
        customer_id=OID2,
        customer_name="Asha Devi",
        farmer_id=OID,
        farmer_name="Kumar Rao",
        delivery_partner_id=OID3,
        delivery_partner_name="Ravi Das",
    )
    with pytest.raises(Exception) as excinfo:
        await chat_mod.create_order_thread(body, stranger)
    assert "not part" in str(excinfo.value.detail)


@pytest.mark.asyncio
async def test_delivery_thread_rejects_stranger(monkeypatch):
    stranger = {"_id": "507f1f77bcf86cd799439099", "role": "customer", "firstName": "X", "lastName": "Y"}
    body = chat_mod.OrderThreadCreate(
        order_id=ORDER_OID,
        order_number="AG-100",
        customer_id=OID2,
        customer_name="Asha Devi",
        farmer_id=OID,
        farmer_name="Kumar Rao",
        delivery_partner_id=OID3,
        delivery_partner_name="Ravi Das",
    )
    with pytest.raises(Exception) as excinfo:
        await chat_mod.create_delivery_thread(body, stranger)
    assert "not part" in str(excinfo.value.detail)


@pytest.mark.asyncio
async def test_support_thread_is_per_user(monkeypatch):
    body = chat_mod.SupportThreadCreate(
        user_id=OID,
        user_name="Kumar Rao",
        user_role="farmer",
        subject="Settlement issue",
    )
    # A different user cannot create a thread as the farmer.
    with pytest.raises(Exception) as excinfo:
        await chat_mod.create_support_thread(body, _customer_user())
    assert "per-user" in str(excinfo.value.detail)


@pytest.mark.asyncio
async def test_access_check_uses_order_participants(monkeypatch):
    async def fake_get_conversation(cid):
        return _order_conversation()

    async def fake_allowed(cid):
        return {OID, OID2, OID3}

    monkeypatch.setattr(chat_repository, "get_conversation", fake_get_conversation)
    monkeypatch.setattr(chat_mod, "_allowed_user_ids", fake_allowed)

    assert await chat_mod._can_access_conversation(f"order-chat-{ORDER_OID}", OID) is True
    assert await chat_mod._can_access_conversation(f"order-chat-{ORDER_OID}", OID3) is True
    assert await chat_mod._can_access_conversation(f"order-chat-{ORDER_OID}", "unknown-user") is False


# ============ Sending messages + notifications ============

@pytest.mark.asyncio
async def test_send_message_notifies_recipients(monkeypatch):
    saved = _message()

    async def fake_add_message(data):
        saved.update(data)
        saved["id"] = "msg-1"
        return dict(saved)

    async def fake_get_conversation(cid):
        return _order_conversation()

    async def fake_update_last_message(*a, **k):
        return None

    async def fake_broadcast(*a, **k):
        return None

    created = {}

    async def fake_notify(*args, **kwargs):
        created["called"] = True
        created["recipients"] = args
        return None

    async def fake_mark_read(*a, **k):
        return None

    monkeypatch.setattr(chat_message_repository, "add_message", fake_add_message)
    monkeypatch.setattr(chat_repository, "get_conversation", fake_get_conversation)
    monkeypatch.setattr(chat_repository, "update_last_message", fake_update_last_message)
    monkeypatch.setattr(chat_repository, "mark_read", fake_mark_read)
    monkeypatch.setattr(chat_mod, "_broadcast", fake_broadcast)
    monkeypatch.setattr(chat_mod, "_notify_recipients", fake_notify)

    body = chat_mod.MessageSend(
        conversation_id=f"order-chat-{ORDER_OID}",
        content="Yes, delivery between 9-11 AM.",
        sender_id=OID,
        sender_name="Kumar Rao",
        sender_role="farmer",
    )
    result = await chat_mod.send_message(body, _farmer_user())
    assert result["status"] == "success"
    assert created["called"] is True


@pytest.mark.asyncio
async def test_sender_identity_comes_from_token(monkeypatch):
    """When authenticated, the token identity wins over client-supplied fields."""
    assert await chat_mod._resolve_sender(
        _farmer_user(), "attacker", "Attacker", "customer"
    ) == (OID, "Kumar Rao", "farmer")


# ============ Quick actions ============

@pytest.mark.asyncio
async def test_quick_action_validates_key(monkeypatch):
    async def fake_get_conversation(cid):
        return _order_conversation()

    monkeypatch.setattr(chat_repository, "get_conversation", fake_get_conversation)

    with pytest.raises(Exception) as excinfo:
        await chat_mod.send_quick_action(
            chat_mod.QuickActionSend(
                conversation_id=f"delivery-chat-{ORDER_OID}",
                action="bogus_action",
                sender_id=OID,
                sender_name="Kumar Rao",
                sender_role="farmer",
            ),
            _farmer_user(),
        )
    assert "Unknown quick action" in str(excinfo.value.detail)


@pytest.mark.asyncio
async def test_quick_actions_include_location(monkeypatch):
    actions = chat_mod.QUICK_ACTIONS["delivery"]
    keys = {a["key"] for a in actions}
    assert "share_pickup_location" in keys
    assert "share_delivery_location" in keys


# ============ Location sharing ============

@pytest.mark.asyncio
async def test_share_location_creates_location_message(monkeypatch):
    saved = {}

    async def fake_add_message(data):
        saved.update(data)
        saved["id"] = "msg-loc"
        return dict(saved)

    async def fake_get_conversation(cid):
        return _order_conversation()

    async def fake_update_last_message(*a, **k):
        return None

    async def fake_broadcast(*a, **k):
        return None

    async def fake_notify(*a, **k):
        return None

    monkeypatch.setattr(chat_message_repository, "add_message", fake_add_message)
    monkeypatch.setattr(chat_repository, "get_conversation", fake_get_conversation)
    monkeypatch.setattr(chat_repository, "update_last_message", fake_update_last_message)
    monkeypatch.setattr(chat_mod, "_broadcast", fake_broadcast)
    monkeypatch.setattr(chat_mod, "_notify_recipients", fake_notify)

    body = chat_mod.LocationShare(
        conversation_id=f"order-chat-{ORDER_OID}",
        latitude=11.0168,
        longitude=76.9558,
        share_kind="pickup",
        label="Farm Pickup Location",
        sender_id=OID,
        sender_name="Kumar Rao",
        sender_role="farmer",
    )
    result = await chat_mod.share_location(body, _farmer_user())
    assert result["status"] == "success"
    assert result["data"]["message_type"] == "location"
    assert result["data"]["location"]["kind"] == "pickup"
    assert result["data"]["location"]["latitude"] == 11.0168


# ============ Mark read ============

@pytest.mark.asyncio
async def test_mark_read_sets_unread_zero(monkeypatch):
    async def fake_get_conversation(cid):
        return _order_conversation()

    calls = {}

    async def fake_mark_read(cid, uid):
        calls["cid"] = cid
        calls["uid"] = uid

    monkeypatch.setattr(chat_repository, "get_conversation", fake_get_conversation)
    monkeypatch.setattr(chat_repository, "mark_read", fake_mark_read)

    result = await chat_mod.mark_conversation_read(f"order-chat-{ORDER_OID}", _farmer_user())
    assert result["status"] == "success"
    assert calls["cid"] == f"order-chat-{ORDER_OID}"


# ============ AI suggestions ============

def test_ai_suggestion_english_freshness():
    suggestions = chat_mod.suggest_replies("Is the tomato fresh?", role="farmer", language="english")
    assert suggestions
    assert suggestions[0]["intent"] == "fresh"


def test_ai_translate_tamil():
    result = chat_mod.translate_text("Can you deliver tomorrow?", target_language="tamil")
    assert result["target_language"] == "tamil"
    assert result["mode"] in ("dictionary", "passthrough")