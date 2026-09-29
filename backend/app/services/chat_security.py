"""Security controls for AgriConnect transactional chat.

Chat is intentionally not a general social network. This module stores blocks
and reports in MongoDB and provides lightweight abuse/rate-limit checks used by
the chat API. AI/keyword flags are advisory; they never make a permanent
moderation decision by themselves.
"""
from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Optional

from app.repositories.base_repository import BaseRepository

block_repository = BaseRepository("chat_blocks")
report_repository = BaseRepository("chat_reports")
moderation_repository = BaseRepository("chat_moderation_events")
restriction_repository = BaseRepository("chat_restrictions")

_RATE: dict[str, list[float]] = {}
WINDOW_SECONDS = 60
MAX_MESSAGES_PER_WINDOW = 30

# Conservative safety signals. They are used to flag content for review, not
# to automatically ban a user.
THREAT_PATTERNS = [
    r"\bkill you\b", r"\bkill yourself\b", r"\bi will hurt you\b",
    r"\bhurt you\b", r"\bcome to your house\b", r"\bfind you\b",
]
HARASSMENT_PATTERNS = [
    r"\bshut up\b", r"\bstupid\b", r"\bidiot\b", r"\bsexually\b",
    r"\bnude\b", r"\bsend (?:me )?(?:a )?photo\b",
]

def _pair_query(user_id: str, other_id: str) -> dict[str, Any]:
    return {
        "$or": [
            {"blocker_id": str(user_id), "blocked_id": str(other_id)},
            {"blocker_id": str(other_id), "blocked_id": str(user_id)},
        ]
    }

async def is_blocked(user_id: str, other_id: str) -> bool:
    if not user_id or not other_id or str(user_id) == str(other_id):
        return False
    return bool(await block_repository.find_one(_pair_query(str(user_id), str(other_id))))

async def block_user(user_id: str, other_id: str, reason: Optional[str] = None) -> None:
    if str(user_id) == str(other_id):
        return
    await block_repository.collection.update_one(
        {"blocker_id": str(user_id), "blocked_id": str(other_id)},
        {"$set": {
            "blocker_id": str(user_id),
            "blocked_id": str(other_id),
            "reason": reason or "user_requested",
            "created_at": datetime.utcnow(),
        }},
        upsert=True,
    )

async def unblock_user(user_id: str, other_id: str) -> None:
    await block_repository.collection.delete_one(
        {"blocker_id": str(user_id), "blocked_id": str(other_id)}
    )

async def create_report(
    reporter_id: str,
    reported_id: str,
    conversation_id: str,
    reason: str,
    message_id: Optional[str] = None,
    details: Optional[str] = None,
) -> dict[str, Any]:
    allowed = {
        "harassment", "threats", "sexual_harassment", "spam",
        "fraud_scam", "abusive_language", "inappropriate_image", "hate_abusive_content", "personal_information", "other",
    }
    normalized = reason if reason in allowed else "other"
    doc = {
        "reporter_id": str(reporter_id),
        "reported_id": str(reported_id),
        "conversation_id": conversation_id,
        "message_id": message_id,
        "reason": normalized,
        "details": (details or "")[:2000],
        "status": "pending",
        "created_at": datetime.utcnow(),
    }
    inserted = await report_repository.create(doc)
    return {**doc, "id": str(inserted) if inserted else None}

def moderate_content(content: str) -> dict[str, Any]:
    text = (content or "").strip().lower()
    if not text:
        return {"risk": "low", "flags": []}

    flags: list[str] = []
    if any(re.search(p, text) for p in THREAT_PATTERNS):

        flags.append("threat")
    if any(re.search(p, text) for p in HARASSMENT_PATTERNS):
        flags.append("harassment")
    if re.search(r"\b(?:phone|mobile|whatsapp|email|home address|bank account|otp|password)\b", text):
        flags.append("personal_information")

    risk = "low"
    if "threat" in flags:
        risk = "critical"
    elif "harassment" in flags:
        risk = "high"
    return {"risk": risk, "flags": flags}

def enforce_message_rate(user_id: str) -> None:
    now = time.monotonic()
    key = str(user_id)
    recent = [t for t in _RATE.get(key, []) if now - t < WINDOW_SECONDS]
    if len(recent) >= MAX_MESSAGES_PER_WINDOW:
        raise ValueError("Message rate limit reached. Please wait a moment before sending more messages.")
    recent.append(now)
    _RATE[key] = recent

async def record_moderation_event(
    conversation_id: str,
    sender_id: str,
    message_id: str,
    result: dict[str, Any],
) -> None:
    if not result.get("flags"):
        return
    await moderation_repository.create({
        "conversation_id": conversation_id,
        "sender_id": str(sender_id),
        "message_id": message_id,
        "risk": result.get("risk", "low"),
        "flags": result.get("flags", []),
        "action": "flag_for_review",
        "created_at": datetime.utcnow(),
    })


async def register_safety_restriction(user_id: str, reason: str, risk: str) -> None:
    """Create a temporary messaging restriction; never a permanent ban."""
    await restriction_repository.collection.update_one(
        {"user_id": str(user_id), "active": True},
        {"$set": {
            "user_id": str(user_id),
            "reason": reason,
            "risk": risk,
            "active": True,
            "created_at": datetime.utcnow(),
        }},
        upsert=True,
    )


async def is_restricted(user_id: str) -> bool:
    return bool(await restriction_repository.find_one({"user_id": str(user_id), "active": True}))
