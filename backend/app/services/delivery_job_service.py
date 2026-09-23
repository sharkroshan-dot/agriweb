"""Delivery job logic: building jobs, matching eligible partners and
sanitizing the job payloads shown to partners before/after acceptance.

The matching considers partner GPS proximity, availability, verified status,
vehicle capacity vs. committed weight, current workload and rating. Job rows
in ``delivery_jobs`` are the single source of truth for who may accept.
"""

from typing import Any, Dict, List, Optional, Tuple
from bson import ObjectId
from datetime import datetime, timedelta
import math

from app.repositories.delivery_job_repository import (
    delivery_job_repository,
    JOB_OPEN,
    JOB_ACCEPTED,
    JOB_NO_PARTNER_FOUND,
)
from app.repositories import delivery_repository
from app.services.user_service import UserService
import logging

logger = logging.getLogger(__name__)

# Order statuses a partner may still pick up (mirrors the farmer map list).
ACTIVE_DELIVERY_STATUSES = [
    "pending",
    "confirmed",
    "processing",
    "ready_for_delivery",
    "ready_for_pickup",
    "dispatched",
    "in_transit",
]

JOB_DEFAULT_EXPIRY_MINUTES = 120
JOB_SEARCH_RADIUS_KM = 60
PARTNER_MAX_ACTIVE_JOBS = 10

# Order statuses at which a partner may pick up the job (the order has been
# processed and marked ready by the farmer). Mirrors the order map pipeline:
# pending -> confirmed -> processing -> ready_for_delivery -> dispatched -> in_transit -> delivered.
ACCEPTABLE_ORDER_STATUSES = [
    "ready_for_delivery",
    "dispatched",
    "in_transit",
]
# Statuses a partner can still complete a delivery from.
COMPLETABLE_ORDER_STATUSES = ACCEPTABLE_ORDER_STATUSES + ["delivered", "picked_up"]


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    if lat1 is None or lng1 is None or lat2 is None or lng2 is None:
        return 0.0
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


def job_weight_kg(order: dict) -> float:
    return round(sum(int(i.get("quantity", 0) or 0) for i in (order.get("items") or [])), 2)


def job_earnings(order: dict, distance_km: Optional[float]) -> float:
    """Delivery earnings offered for a job.

    Prefers the order's delivery charge; falls back to a distance-based
    estimate capped at ₹150.
    """
    charge = float(order.get("deliveryCharge") or 0)
    if charge and charge > 0:
        return round(charge, 2)
    dist = float(distance_km or 0)
    return round(min(30 + dist * 8, 150), 2)


async def _partner_display_name(partner: dict) -> str:
    user_id = str(partner.get("userId") or "")
    if not user_id:
        return partner.get("name") or "Delivery Partner"
    try:
        user = await UserService.get_user_by_id(user_id)
        if user:
            return (
                f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                or user.get("name")
                or partner.get("name")
                or "Delivery Partner"
            )
    except Exception:
        pass
    return partner.get("name") or "Delivery Partner"


async def available_partners_near(
    lat: float, lng: float, radius_km: int = JOB_SEARCH_RADIUS_KM
) -> List[dict]:
    """Available, verified partners near a point with display info + distance."""
    partners = []
    try:
        partners = await delivery_repository.get_nearby_partners(lat, lng, radius_km, limit=40)
    except Exception:
        partners = []
    if not partners:
        try:
            all_available = await delivery_repository.get_available_partners(None, None, limit=50)
            for p in all_available or []:
                coords = (p.get("currentLocation") or {}).get("coordinates")
                if not coords:
                    partners.append(p)
                else:
                    d = _haversine_km(lat, lng, coords[1], coords[0])
                    if d <= radius_km:
                        partners.append(p)
        except Exception:
            partners = []
    result = []
    for p in partners or []:
        coords = (p.get("currentLocation") or {}).get("coordinates")
        dist = None
        if coords:
            dist = round(_haversine_km(lat, lng, coords[1], coords[0]), 2)
        result.append({
            "id": str(p["_id"]),
            "userId": str(p.get("userId") or ""),
            "name": await _partner_display_name(p),
            "rating": round(float(p.get("rating", 0) or 0), 1),
            "capacity": float(p["capacity"]) if p.get("capacity") is not None else None,
            "distanceKm": dist,
            "isAvailable": bool(p.get("isAvailable")),
            "status": p.get("status", "offline"),
            "isVerified": bool(p.get("isVerified")),
            "totalDeliveries": int(p.get("totalDeliveries", 0) or 0),
        })
    return result


async def partner_commitment(partner_id: str) -> Tuple[int, float]:
    """(active job count, committed kg) for a partner."""
    count = await delivery_job_repository.count_active_for_partner(partner_id)
    weight = await delivery_job_repository.active_weight_for_partner(partner_id)
    return count, weight


def passes_capacity(partner: dict, committed_weight: float, job_weight: float) -> bool:
    cap = partner.get("capacity")
    if cap is None:
        return True
    return float(cap) - committed_weight >= job_weight - 1e-9


async def eligible_partners_for_job(
    pickup_lat: float,
    pickup_lng: float,
    job_weight: float,
    partners: Optional[List[dict]] = None,
) -> List[dict]:
    """Filter partners to those eligible for a job and rank them.

    Eligibility: available + verified + within search radius + under max
    workload + enough remaining vehicle capacity for this job's weight.
    Ranking: least active jobs first, then nearest.
    """
    if partners is None:
        partners = await available_partners_near(pickup_lat, pickup_lng, JOB_SEARCH_RADIUS_KM)
    eligible = []
    for p in partners:
        if not (p.get("isAvailable") and p.get("isVerified")):
            continue
        if p.get("status") not in ("available", None):
            continue
        count, committed = await partner_commitment(p["id"])
        if count >= PARTNER_MAX_ACTIVE_JOBS:
            continue
        if not passes_capacity(p, committed, job_weight):
            continue
        eligible.append({
            **p,
            "activeJobs": count,
            "committedWeight": round(committed, 2),
        })
    eligible.sort(key=lambda p: (p["activeJobs"], p["distanceKm"] if p.get("distanceKm") is not None else 1e9))
    return eligible


def build_job_document(
    order: dict,
    farm: dict,
    distance_km: Optional[float],
    expires_in_minutes: int = JOB_DEFAULT_EXPIRY_MINUTES,
    eligible_partner_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Construct the delivery_jobs document for an order."""
    addr = order.get("deliveryAddress", {}) or {}
    loc = addr.get("location") or {}
    coords = loc.get("coordinates") or []
    qty = job_weight_kg(order)
    items = order.get("items", []) or []
    product = ""
    for i in items:
        product = i.get("productName") or i.get("name") or ""
        if product:
            break
    now = datetime.utcnow()
    return {
        "orderId": order["_id"],
        "farmerId": order.get("farmerId"),
        "orderNumber": order.get("orderNumber", ""),
        "status": JOB_OPEN,
        "openedAt": now,
        "expiresAt": now + timedelta(minutes=expires_in_minutes),
        "acceptedBy": None,
        "acceptedAt": None,
        "pickupLocation": {
            "type": "Point",
            "coordinates": [float(farm.get("lng") or 0), float(farm.get("lat") or 0)],
        },
        "pickupName": farm.get("name") or "Farm",
        "pickupAddress": farm.get("address") or "",
        "pickupPhone": order.get("farmerPhone") or "",
        "deliveryLocation": {
            "type": "Point",
            "coordinates": [float(coords[0]) if coords else 0, float(coords[1]) if len(coords) > 1 else 0],
        } if coords else None,
        "deliveryArea": addr.get("area") or addr.get("city") or "",
        "deliveryCity": addr.get("city") or "",
        "deliveryAddress": addr.get("address") or addr.get("addressLine1") or "",
        "customerName": order.get("customerName") or "Customer",
        "customerPhone": order.get("customerPhone") or "",
        "distanceKm": round(float(distance_km or 0), 2),
        "weightKg": qty,
        "earnings": job_earnings(order, distance_km),
        "timeSlot": order.get("deliveryTimeSlot") or "Morning",
        "deliveryDay": order.get("deliveryDay") or "Today",
        "deliveryType": order.get("deliveryType", "delivery"),
        "orderStatus": order.get("orderStatus", "pending"),
        "selfDelivery": bool(order.get("selfDelivery")),
        "productSummary": product or "Farm produce",
        "items": [
            {"name": i.get("productName") or i.get("name") or "Item", "quantity": i.get("quantity", 1)}
            for i in items
        ],
        "eligiblePartnerIds": eligible_partner_ids or [],
        "notificationSent": False,
        "version": 1,
    }


def serialize_job_for_partner(job: dict, distance_from_partner: Optional[float] = None, reveal: bool = False) -> dict:
    """Privacy-safe job payload for the partner dashboard.

    Before acceptance the customer's full address and phone are hidden; only
    the approximate distance, general area, time slot, product, weight and
    earnings are shown. After acceptance ``reveal`` includes the delivery
    address and customer phone.
    """
    return {
        "id": str(job["_id"]),
        "orderId": str(job["orderId"]),
        "orderNumber": job.get("orderNumber", ""),
        "status": job.get("status"),
        "orderStatus": job.get("orderStatus", "pending"),
        "selfDelivery": bool(job.get("selfDelivery")),
        "pickupName": job.get("pickupName", "Farm"),
        "pickupAddress": job.get("pickupAddress") if reveal else None,
        "pickupPhone": job.get("pickupPhone") if reveal else None,
        "deliveryArea": job.get("deliveryArea") or job.get("deliveryCity") or "—",
        "deliveryCity": job.get("deliveryCity") or "",
        "deliveryAddress": job.get("deliveryAddress") if reveal else None,
        "customerName": job.get("customerName") if reveal else None,
        "customerPhone": job.get("customerPhone") if reveal else None,
        "distanceKm": job.get("distanceKm"),
        "distanceFromPartner": round(float(distance_from_partner), 2) if distance_from_partner is not None else None,
        "weightKg": job.get("weightKg", 0),
        "earnings": job.get("earnings", 0),
        "timeSlot": job.get("timeSlot"),
        "deliveryDay": job.get("deliveryDay"),
        "productSummary": job.get("productSummary", "Farm produce"),
        "items": job.get("items", []),
        "expiresAt": job.get("expiresAt"),
        "accepted": job.get("status") == JOB_ACCEPTED,
    }


def serialize_job_for_farmer(job: dict) -> dict:
    return {
        "id": str(job["_id"]),
        "orderId": str(job["orderId"]),
        "orderNumber": job.get("orderNumber", ""),
        "status": job.get("status"),
        "orderStatus": job.get("orderStatus", "pending"),
        "selfDelivery": bool(job.get("selfDelivery")),
        "openedAt": job.get("openedAt"),
        "expiresAt": job.get("expiresAt"),
        "acceptedBy": str(job["acceptedBy"]) if job.get("acceptedBy") else None,
        "weightKg": job.get("weightKg", 0),
        "earnings": job.get("earnings", 0),
        "distanceKm": job.get("distanceKm"),
        "eligibleCount": len(job.get("eligiblePartnerIds") or []),
    }
