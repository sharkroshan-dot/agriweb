"""Freshness, delivery-deadline and priority rules for perishable farmer orders.

The delivery window is capped at four days, but a batch can expire sooner. The
effective deadline is therefore the earlier of the batch freshness deadline and
the four-day business deadline.

Priority is calculated from the remaining time to that effective deadline:
  - urgent: <= 24 hours
  - high:   <= 48 hours
  - normal: > 48 hours

Batch data is authoritative when an order item carries batchId. Product-level
freshness fields are used as a legacy fallback.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from bson import ObjectId

from app.database.mongodb import MongoDB
from app.services.delivery_deadline_service import effective_delivery_deadline

MAX_DELIVERY_WINDOW_DAYS = 4
URGENT_HOURS = 24
HIGH_HOURS = 48


def _naive_utc(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _as_oid(value: Any) -> Optional[ObjectId]:
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def _priority(hours_remaining: float) -> tuple[int, str]:
    if hours_remaining <= URGENT_HOURS:
        return 3, "urgent"
    if hours_remaining <= HIGH_HOURS:
        return 2, "high"
    return 1, "normal"


async def _batch_for_item(item: dict) -> Optional[dict]:
    batches = MongoDB.get_collection("batches")
    batch_id = item.get("batchId") or item.get("batch_id")
    oid = _as_oid(batch_id)
    if oid:
        found = await batches.find_one({"_id": oid, "deletedAt": None})
        if found:
            return found
    product_id = _as_oid(item.get("productId"))
    if product_id:
        found = await batches.find_one(
            {"productId": product_id, "deletedAt": None, "status": {"$ne": "cancelled"}},
            sort=[("createdAt", -1)],
        )
        if found:
            return found
    return None


async def calculate_order_delivery_priority(
    order: dict,
    *,
    now: Optional[datetime] = None,
    persist: bool = True,
) -> Dict[str, Any]:
    """Calculate and optionally persist the freshness/deadline snapshot."""

    now = _naive_utc(now) or datetime.utcnow()
    created_at = _naive_utc(order.get("createdAt")) or now
    business_deadline = created_at + timedelta(days=MAX_DELIVERY_WINDOW_DAYS)

    batch_deadlines: list[datetime] = []
    batch_ids: list[str] = []
    harvest_dates: list[datetime] = []
    shelf_lives: list[float] = []

    for item in order.get("items") or []:
        batch = await _batch_for_item(item)
        if not batch:
            # Legacy product data may already carry these fields on the item.
            expires = _naive_utc(item.get("expiresAt") or item.get("expiryDate"))
            if expires:
                batch_deadlines.append(expires)
            harvested = _naive_utc(item.get("harvestedAt") or item.get("harvestDate"))
            shelf_hours = item.get("expectedShelfLifeHours")
            if harvested and shelf_hours:
                try:
                    batch_deadlines.append(
                        harvested + timedelta(hours=float(shelf_hours))
                    )
                except (TypeError, ValueError):
                    pass
            continue

        batch_id = str(batch.get("_id"))
        batch_ids.append(batch_id)
        harvest = _naive_utc(batch.get("harvestDate") or batch.get("harvestedAt"))
        expires = _naive_utc(batch.get("safeDeliveryDate") or batch.get("expiresAt"))
        shelf = batch.get("shelfLifeDays")

        if harvest:
            harvest_dates.append(harvest)
        if shelf is not None:
            try:
                shelf_lives.append(float(shelf))
            except (TypeError, ValueError):
                pass
        if expires:
            batch_deadlines.append(expires)
        elif harvest and shelf:
            batch_deadlines.append(harvest + timedelta(days=float(shelf)))

    freshness_deadline = min(batch_deadlines) if batch_deadlines else None
    effective_deadline = (
        min(business_deadline, freshness_deadline)
        if freshness_deadline
        else business_deadline
    )
    hours_remaining = max(
        0.0, (effective_deadline - now).total_seconds() / 3600
    )
    priority, priority_label = _priority(hours_remaining)

    freshness_source = "batch_safe_delivery" if freshness_deadline else "business_window"
    deadline_passed = effective_deadline <= now

    snapshot: Dict[str, Any] = {
        "deliveryDeadline": effective_deadline,
        "deliveryDeadlineSource": freshness_source,
        "businessDeliveryDeadline": business_deadline,
        "freshnessDeadline": freshness_deadline,
        "safeDeliveryDate": freshness_deadline,
        "customerRequestedDate": _naive_utc(order.get("customerRequestedDate") or order.get("requestedDeliveryDate")),
        "deliveryWindowDays": MAX_DELIVERY_WINDOW_DAYS,
        "deliveryHoursRemaining": round(hours_remaining, 1),
        "priority": priority,
        "priorityLabel": priority_label,
        "priorityReason": (
            "Delivery deadline has passed"
            if deadline_passed
            else f"{round(hours_remaining, 1)} hours remaining"
        ),
        "deadlinePassed": deadline_passed,
        "batchIds": sorted(set(batch_ids)),
        "harvestDate": min(harvest_dates) if harvest_dates else None,
        "shelfLifeDays": min(shelf_lives) if shelf_lives else None,
    }

    if persist and order.get("_id"):
        # Keep the calculated values on the order so downstream delivery
        # screens, partner workflows and route execution use one snapshot.
        await MongoDB.get_collection("orders").update_one(
            {"_id": order["_id"]},
            {"$set": {**snapshot, "updatedAt": datetime.utcnow()}},
        )
        order.update(snapshot)

    return snapshot


async def ensure_order_delivery_priority(order: dict) -> Dict[str, Any]:
    """Refresh an order's deadline/priority when it enters delivery workflow."""
    return await calculate_order_delivery_priority(order, persist=True)
