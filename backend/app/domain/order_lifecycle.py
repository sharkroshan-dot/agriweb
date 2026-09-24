"""Canonical order lifecycle rules for service-level validation."""

from enum import Enum
from typing import Dict, FrozenSet


class OrderLifecycleError(ValueError):
    pass


class OrderStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PROCESSING = "processing"
    READY_FOR_DELIVERY = "ready_for_delivery"
    READY_FOR_PICKUP = "ready_for_pickup"
    DISPATCHED = "dispatched"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    PICKED_UP = "picked_up"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


ALLOWED_TRANSITIONS: Dict[str, FrozenSet[str]] = {
    "pending": frozenset({"confirmed", "cancelled"}),
    "confirmed": frozenset({"processing", "cancelled"}),
    "processing": frozenset({"ready_for_delivery", "ready_for_pickup", "cancelled"}),
    "ready_for_delivery": frozenset({"dispatched", "cancelled"}),
    "ready_for_pickup": frozenset({"picked_up", "cancelled"}),
    "dispatched": frozenset({"in_transit", "cancelled"}),
    "in_transit": frozenset({"delivered", "cancelled"}),
    "delivered": frozenset({"refunded"}),
    "picked_up": frozenset({"refunded"}),
    "cancelled": frozenset(),
    "refunded": frozenset(),
}


def can_transition(current: str, target: str) -> bool:
    current, target = str(current).lower(), str(target).lower()
    return current == target or target in ALLOWED_TRANSITIONS.get(current, frozenset())


def validate_transition(current: str, target: str) -> None:
    if not can_transition(current, target):
        raise OrderLifecycleError(f"Invalid order transition: {current} -> {target}")


def is_terminal(status: str) -> bool:
    return str(status).lower() in {"delivered", "picked_up", "cancelled", "refunded"}
