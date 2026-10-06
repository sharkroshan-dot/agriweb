from datetime import datetime, time, timedelta
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from app.repositories.delivery_repository import delivery_repository

DELIVERY_SERVICE_TZ = ZoneInfo("Asia/Kolkata")
DELIVERY_SERVICE_START = time(6, 0)
DELIVERY_SERVICE_END = time(21, 30)
FASTEST_DELIVERY_MINUTES = 30


def _next_service_start(now: datetime) -> datetime:
    local_now = now.astimezone(DELIVERY_SERVICE_TZ)
    start_today = local_now.replace(
        hour=DELIVERY_SERVICE_START.hour,
        minute=DELIVERY_SERVICE_START.minute,
        second=0,
        microsecond=0,
    )
    if local_now < start_today:
        return start_today
    next_day = local_now + timedelta(days=1)
    return next_day.replace(
        hour=DELIVERY_SERVICE_START.hour,
        minute=DELIVERY_SERVICE_START.minute,
        second=0,
        microsecond=0,
    )


def _is_service_window_active(now: Optional[datetime] = None) -> bool:
    current = (now or datetime.now(DELIVERY_SERVICE_TZ)).astimezone(DELIVERY_SERVICE_TZ)
    return DELIVERY_SERVICE_START <= current.time() < DELIVERY_SERVICE_END


async def get_delivery_service_availability(
    *,
    destination: Optional[Dict[str, Any]] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Return the current delivery-service state.

    Product ordering is independent of this service. This only answers whether
    customer delivery can be dispatched now and whether Fastest Delivery can
    be considered.
    """
    current = (now or datetime.now(DELIVERY_SERVICE_TZ)).astimezone(DELIVERY_SERVICE_TZ)
    active_window = _is_service_window_active(current)

    partners = []
    if active_window:
        try:
            partners = await delivery_repository.get_available_partners(
                location=destination,
                radius=50 if destination else None,
                limit=50,
            )
        except Exception:
            partners = []

    partner_count = len(partners)
    partner_available = partner_count > 0

    if active_window and partner_available:
        return {
            "serviceAvailable": True,
            "partnerAvailable": True,
            "availablePartnerCount": partner_count,
            "status": "available",
            "message": "Delivery service is currently available.",
            "nextServiceAt": None,
            "timezone": str(DELIVERY_SERVICE_TZ),
            "serviceStart": "06:00",
            "serviceEnd": "21:30",
        }

    next_start = _next_service_start(current)
    if not active_window:
        status = "scheduled_for_next_service"
        message = "Delivery partners are currently unavailable. Your order can still be placed and will be delivered in the next available delivery period."
    else:
        status = "waiting_for_delivery_partner"
        message = "No suitable delivery partner is currently available. Your order can still be placed and delivery will start when a partner becomes available."

    return {
        "serviceAvailable": False,
        "partnerAvailable": False,
        "availablePartnerCount": partner_count,
        "status": status,
        "message": message,
        "nextServiceAt": next_start if not active_window else None,
        "timezone": str(DELIVERY_SERVICE_TZ),
        "serviceStart": "06:00",
        "serviceEnd": "21:30",
    }


def estimate_fastest_eligibility(
    *,
    distance_km: Optional[float],
    packing_minutes: int = 5,
    partner_to_farmer_minutes: int = 5,
) -> Dict[str, Any]:
    """Conservative ETA gate for the 30-minute fastest-delivery promise."""
    if distance_km is None:
        return {
            "eligible": False,
            "estimatedMinutes": None,
            "reason": "Delivery distance could not be calculated.",
        }

    # Conservative road-speed approximation. A live routing provider can
    # replace this later without changing the eligibility contract.
    customer_leg = max(1, int(round((float(distance_km) / 25.0) * 60)))
    estimated = int(packing_minutes) + int(partner_to_farmer_minutes) + customer_leg
    return {
        "eligible": estimated <= FASTEST_DELIVERY_MINUTES,
        "estimatedMinutes": estimated,
        "promiseMinutes": FASTEST_DELIVERY_MINUTES,
        "reason": None if estimated <= FASTEST_DELIVERY_MINUTES else "The estimated end-to-end delivery time is longer than 30 minutes.",
    }
