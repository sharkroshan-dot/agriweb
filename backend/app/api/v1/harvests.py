"""Harvest calendar, pre-order and notify-me.

Farmers publish expected harvest plans (crop, date, quantity, price). Customers
can either pre-order the planned harvest or subscribe for a "notify me when
harvested" alert. When the farmer marks the plan harvested, subscribers are
notified and pre-orders are confirmed.

Collections:
  - harvest_plans:      one planned harvest from a farmer
  - harvest_preorders:  customer reservations against a plan
  - harvest_notifications: customer "notify me" subscriptions
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel
from bson import ObjectId
import logging
import math

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.product_repository import product_repository
from app.repositories.inventory_repository import inventory_repository
from app.repositories.user_repository import user_repository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.address_repository import address_repository
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority

logger = logging.getLogger(__name__)
router = APIRouter()

harvest_plan_repo = BaseRepository("harvest_plans")
harvest_preorder_repo = BaseRepository("harvest_preorders")
harvest_notify_repo = BaseRepository("harvest_notifications")
harvest_route_repo = BaseRepository("harvest_routes")
harvest_batch_repo = BaseRepository("batches")
harvest_order_repo = BaseRepository("orders")

_ACTIVE_DELIVERY_STATUSES = [
    "pending", "confirmed", "processing", "ready_for_delivery", "ready_for_pickup", "dispatched", "in_transit",
]

# Status values for a harvest plan
PLAN_PLANNED = "planned"        # not yet accepting pre-orders
PLAN_PREORDER = "preorder"      # accepting pre-orders / notify-me
PLAN_HARVESTED = "harvested"    # crop harvested; pre-orders fulfilled
PLAN_CANCELLED = "cancelled"


def _plan_cutoff_status(plan: dict) -> str:
    """Effective status for customers: preorder only until cutoff passes."""
    status = plan.get("status", PLAN_PLANNED)
    cutoff = plan.get("preOrderCutoff")
    if status == PLAN_PREORDER and cutoff and _to_naive_utc(cutoff) < datetime.utcnow():
        return "closed"
    return status


def _to_naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Convert a timezone-aware datetime to naive UTC (or pass through)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _serialize_plan(plan: dict) -> dict:
    plan["id"] = str(plan["_id"])
    plan["farmerId"] = str(plan.get("farmerId"))
    if plan.get("productId"):
        plan["productId"] = str(plan["productId"])
    plan["status"] = _plan_cutoff_status(plan)
    return plan


async def _farmer_info(farmer_id: str) -> dict:
    user = await user_repository.get_by_id(farmer_id)
    farm = await farmer_repository.find_one({"userId": ObjectId(farmer_id)}) if farmer_id else None
    if not user:
        return {"name": "Farmer", "farmName": None, "rating": None}
    name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
    return {
        "name": name or "Farmer",
        "farmName": farm.get("farmName") if farm else None,
        "rating": farm.get("rating") if farm else None,
    }


# ================== DELIVERY ROUTE HELPERS ==================

def _haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Great-circle distance between two (lat, lng) points in km."""
    lat1, lng1 = a
    lat2, lng2 = b
    earth = 6371.0
    d_lat = (lat2 - lat1) * 3.141592653589793 / 180
    d_lng = (lng2 - lng1) * 3.141592653589793 / 180
    lat1_r = lat1 * 3.141592653589793 / 180
    lat2_r = lat2 * 3.141592653589793 / 180
    h = (d_lat / 2) ** 2 + lat1_r * lat2_r * (d_lng / 2) ** 2
    return earth * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def _point_coords(location: Optional[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    """Extract (lat, lng) from a GeoJSON Point or {lat,lng}/{longitude,latitude}."""
    if not location:
        return None
    if location.get("type") == "Point":
        coords = location.get("coordinates") or []
        if len(coords) >= 2:
            lng, lat = float(coords[0]), float(coords[1])
            if math.isfinite(lat) and math.isfinite(lng):
                return (lat, lng)
        return None
    lat = location.get("lat", location.get("latitude"))
    lng = location.get("lng", location.get("lon", location.get("longitude")))
    if lat is not None and lng is not None:
        lat, lng = float(lat), float(lng)
        if math.isfinite(lat) and math.isfinite(lng):
            return (lat, lng)
    return None


async def _farm_origin(farmer_id: str, plan: dict) -> Optional[Dict[str, Any]]:
    """Resolve the route origin: plan location -> farmer profile farm location."""
    plan_loc = plan.get("location")
    if _point_coords(plan_loc):
        return plan_loc
    farm = await farmer_repository.find_one({"userId": ObjectId(farmer_id)}) if farmer_id else None
    if farm:
        for key in ("farmLocation", "location"):
            loc = farm.get(key)
            if _point_coords(loc):
                return loc
    return None


async def _build_preorder_route(
    plan: dict,
    farmer_id: str,
) -> Dict[str, Any]:
    """Build an optimized delivery route from the farm through the crop's
    confirmed pre-orders plus the farmer's active delivery orders.

    Ordering is nearest-neighbour from the farm origin. Stops without
    coordinates are appended last (the frontend geocodes them by address).
    """
    origin = await _farm_origin(farmer_id, plan)
    origin_pt = _point_coords(origin)

    raw = []

    # 1. Confirmed pre-orders for this plan.
    preorders = await harvest_preorder_repo.find_many(
        {"harvestPlanId": plan["_id"], "status": "confirmed", "deletedAt": None}
    )
    for po in preorders:
        addr = po.get("deliveryAddress") or {}
        coords = _point_coords(addr.get("location") or addr.get("geo") or addr)
        customer = await user_repository.get_by_id(str(po.get("customerId"))) if po.get("customerId") else None
        name = (customer or {}).get("fullName") or (customer or {}).get("name") or "Customer"
        full_address = addr.get("address") or ", ".join(
            p for p in [
                addr.get("addressLine1"),
                addr.get("area"),
                addr.get("city"),
                addr.get("state"),
                addr.get("zipCode"),
            ] if p
        ) or "Delivery address"
        raw.append({
            "source": "preorder",
            "preorderId": str(po["_id"]),
            "orderId": None,
            "customerId": str(po.get("customerId") or ""),
            "customerName": name,
            "phone": (customer or {}).get("phone") or (customer or {}).get("phoneNumber") or "",
            "address": full_address,
            "city": addr.get("city") or "",
            "quantityKg": float(po.get("quantityKg", 0) or 0),
            "total": round(float(po.get("total", 0) or 0), 2),
            "cropName": po.get("cropName") or plan.get("cropName"),
            "lat": coords[0] if coords else None,
            "lng": coords[1] if coords else None,
            "coords": coords,
        })

    # 2. The farmer's active delivery orders for this crop.
    orders = await harvest_order_repo.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": _ACTIVE_DELIVERY_STATUSES}, "deletedAt": None},
        limit=200,
    )
    for order in orders or []:
        items = order.get("items") or []
        matches_crop = any(
            (i.get("productName") or i.get("name") or "").lower() == str(plan.get("cropName")).lower()
            for i in items
        ) if plan.get("cropName") else True
        if not matches_crop:
            continue
        addr = order.get("deliveryAddress") or {}
        coords = _point_coords(addr.get("location") or addr.get("geo") or addr)
        qty_kg = sum(float(i.get("quantity") or 0) for i in items)
        addr_parts = [
            addr.get("address") or addr.get("addressLine1"),
            addr.get("area"),
            addr.get("city"),
            addr.get("state"),
            addr.get("zipCode"),
        ]
        full_address = addr.get("address") or ", ".join(p for p in addr_parts if p) or "Delivery address"
        raw.append({
            "source": "order",
            "preorderId": None,
            "orderId": str(order["_id"]),
            "customerId": str(order.get("customerId") or order.get("userId") or ""),
            "customerName": order.get("customerName") or "Customer",
            "phone": order.get("customerPhone") or order.get("phone") or "",
            "address": full_address,
            "city": addr.get("city") or "",
            "quantityKg": qty_kg,
            "total": float(order.get("totalAmount") or 0) or 0.0,
            "cropName": plan.get("cropName"),
            "lat": coords[0] if coords else None,
            "lng": coords[1] if coords else None,
            "coords": coords,
        })

    if not raw:
        return {"origin": origin, "waypoints": [], "summary": {
            "totalStops": 0, "totalQuantityKg": 0, "totalValue": 0,
            "totalDistanceKm": 0, "customers": 0, "algorithm": "Nearest-neighbour from farm location",
        }}

    # Nearest-neighbour ordering from the farm origin.
    remaining = list(raw)
    ordered: List[dict] = []
    cur = origin_pt
    while remaining:
        with_coords = [s for s in remaining if s["coords"]]
        if with_coords and cur:
            nxt = min(with_coords, key=lambda s: _haversine_km(cur, s["coords"]))
        else:
            nxt = remaining[0]
        remaining.remove(nxt)
        if nxt["coords"] and origin_pt:
            nxt["distanceFromStartKm"] = round(_haversine_km(origin_pt, nxt["coords"]), 2)
        else:
            nxt["distanceFromStartKm"] = None
        ordered.append(nxt)
        if nxt["coords"]:
            cur = nxt["coords"]

    for i, stop in enumerate(ordered):
        dist = stop["distanceFromStartKm"]
        eta_min = round((dist or 0) / 25 * 60 + i * 10)
        stop["eta"] = f"{eta_min} min"
        stop["sequence"] = i + 1
        stop["status"] = "pending"
        stop.pop("coords", None)

    return {
        "origin": origin,
        "waypoints": ordered,
        "summary": {
            "totalStops": len(ordered),
            "totalQuantityKg": round(sum(s["quantityKg"] for s in ordered), 2),
            "totalValue": round(sum(s["total"] for s in ordered), 2),
            "totalDistanceKm": round(sum(s["distanceFromStartKm"] or 0 for s in ordered), 2),
            "customers": len(set(s["customerId"] for s in ordered if s["customerId"])),
            "preorders": sum(1 for s in ordered if s["source"] == "preorder"),
            "orders": sum(1 for s in ordered if s["source"] == "order"),
            "algorithm": "Nearest-neighbour from farm location",
        },
    }


# ================== FARMER ENDPOINTS ==================

class HarvestPlanCreate(BaseModel):
    cropName: str
    expectedHarvestDate: datetime
    expectedQuantityKg: float
    preOrderPricePerKg: Optional[float] = None
    preOrderEnabled: bool = False
    preOrderCutoff: Optional[datetime] = None
    productId: Optional[str] = None
    notes: Optional[str] = None
    imageUrl: Optional[str] = None
    location: Optional[Dict[str, Any]] = None
    fieldName: Optional[str] = None
    areaAcres: Optional[float] = None
    season: Optional[str] = None
    soilType: Optional[str] = None
    plantingDate: Optional[datetime] = None
    storageType: Optional[str] = None
    source: Optional[str] = "calendar"
    stage: Optional[str] = None


@router.post("/plans")
async def create_harvest_plan(
    data: HarvestPlanCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a harvest plan (Farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can create harvest plans")

    expected_date = _to_naive_utc(data.expectedHarvestDate)
    if expected_date is None or expected_date < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Expected harvest date must be in the future")

    plan = {
        "farmerId": ObjectId(current_user["_id"]),
        "cropName": data.cropName.strip(),
        "expectedHarvestDate": expected_date,
        "expectedQuantityKg": data.expectedQuantityKg,
        "preOrderPricePerKg": data.preOrderPricePerKg,
        "preOrderEnabled": bool(data.preOrderEnabled and data.preOrderPricePerKg),
        "preOrderCutoff": _to_naive_utc(data.preOrderCutoff),
        "productId": ObjectId(data.productId) if data.productId else None,
        "notes": data.notes,
        "imageUrl": data.imageUrl,
        "location": data.location,
        "fieldName": data.fieldName,
        "areaAcres": data.areaAcres,
        "season": data.season,
        "soilType": data.soilType,
        "plantingDate": _to_naive_utc(data.plantingDate),
        "storageType": data.storageType,
        "source": data.source or "calendar",
        "stage": data.stage or "planned",
        "status": (
            PLAN_PREORDER
            if data.source != "planner" and (data.preOrderEnabled and data.preOrderPricePerKg)
            else PLAN_PLANNED
        ),
        "actualQuantityKg": None,
        "harvestedAt": None,
    }

    plan_id = await harvest_plan_repo.create(plan)
    if not plan_id:
        raise HTTPException(status_code=400, detail="Failed to create harvest plan")
    plan["_id"] = ObjectId(plan_id)
    return {"success": True, "data": _serialize_plan(plan)}


@router.get("/farmer/plans")
async def get_farmer_harvest_plans(
    include_cancelled: bool = Query(False),
    source: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """List the current farmer's harvest plans (newest first)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can view their harvest plans")

    filter = {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None}
    if source:
        filter["source"] = {"$in": [source, None]} if source == "calendar" else source
    if not include_cancelled:
        filter["status"] = {"$ne": PLAN_CANCELLED}

    plans = await harvest_plan_repo.find_many(filter, sort=[("expectedHarvestDate", -1)], limit=200)
    for p in plans:
        _serialize_plan(p)
        p["preorderCount"] = await harvest_preorder_repo.count({
            "harvestPlanId": p["_id"],
            "status": {"$ne": "cancelled"},
            "deletedAt": None,
        })
        p["notifyCount"] = await harvest_notify_repo.count({
            "harvestPlanId": p["_id"],
            "deletedAt": None,
        })
    return {"success": True, "data": {"plans": plans, "count": len(plans)}}


@router.put("/plans/{plan_id}")
async def update_harvest_plan(
    plan_id: str,
    data: HarvestPlanCreate,
    current_user: dict = Depends(get_current_user),
):
    """Update a harvest plan (own farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can update harvest plans")

    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")
    if str(plan.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your harvest plan")
    if plan.get("status") == PLAN_HARVESTED:
        raise HTTPException(status_code=400, detail="Cannot update an already-harvested plan")

    updates = {
        "cropName": data.cropName.strip(),
        "expectedHarvestDate": _to_naive_utc(data.expectedHarvestDate),
        "expectedQuantityKg": data.expectedQuantityKg,
        "preOrderPricePerKg": data.preOrderPricePerKg,
        "preOrderEnabled": bool(data.preOrderEnabled and data.preOrderPricePerKg),
        "preOrderCutoff": _to_naive_utc(data.preOrderCutoff),
        "productId": ObjectId(data.productId) if data.productId else None,
        "notes": data.notes,
        "imageUrl": data.imageUrl,
        "location": data.location,
        "fieldName": data.fieldName,
        "areaAcres": data.areaAcres,
        "season": data.season,
        "soilType": data.soilType,
        "plantingDate": _to_naive_utc(data.plantingDate),
        "storageType": data.storageType,
        "source": data.source or "calendar",
        "status": PLAN_PREORDER if (data.preOrderEnabled and data.preOrderPricePerKg) else PLAN_PLANNED,
    }
    ok = await harvest_plan_repo.update({"_id": ObjectId(plan_id)}, updates)
    if not ok:
        raise HTTPException(status_code=400, detail="Failed to update harvest plan")

    updated = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id)})
    return {"success": True, "data": _serialize_plan(updated)}


async def _apply_harvest(plan: dict) -> int:
    """Confirm pre-orders, notify subscribers, bump linked product stock.

    Shared by the direct harvest endpoint and the lifecycle stage transition.
    Returns the number of subscribers notified.
    """
    plan_id = plan["_id"]
    # Confirm all pending pre-orders.
    await harvest_preorder_repo.collection.update_many(
        {"harvestPlanId": plan_id, "status": "pending", "deletedAt": None},
        {"$set": {"status": "confirmed", "confirmedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}},
    )

    # Notify "notify me" subscribers.
    subs = await harvest_notify_repo.find_many({"harvestPlanId": plan_id, "deletedAt": None})
    notified = 0
    for sub in subs:
        cid = sub.get("customerId")
        if not cid:
            continue
        await NotificationService.create_in_app_notification(
            str(cid),
            NotificationType.SYSTEM,
            f"{plan.get('cropName')} is harvested! 🌾",
            f"{plan.get('cropName')} is now available. Check the farm and order fresh today.",
            {"harvestPlanId": str(plan_id), "cropName": plan.get("cropName"), "type": "harvest"},
            NotificationPriority.HIGH,
        )
        notified += 1
        await harvest_notify_repo.update({"_id": sub["_id"]}, {"notifiedAt": datetime.utcnow()})

    # Bump the linked product's stock (if any) so the harvested crop is sellable.
    product_id = plan.get("productId")
    if product_id:
        try:
            qty = int(plan.get("expectedQuantityKg", 0)) or 0
            await product_repository.collection.update_one(
                {"_id": product_id},
                {"$inc": {"quantity": qty},
                 "$set": {"isActive": True, "harvestDate": datetime.utcnow(), "updatedAt": datetime.utcnow()}},
            )
            inv = await inventory_repository.get_by_product_id(str(product_id))
            if inv:
                await inventory_repository.atomic_restock(str(inv["_id"]), qty)
            else:
                await inventory_repository.ensure_inventory_exists(
                    str(product_id), str(plan.get("farmerId")), qty, "kg"
                )
        except Exception as e:
            logger.error(f"Failed to bump product inventory on harvest {plan_id}: {e}")
    return notified


@router.post("/plans/{plan_id}/harvest")
async def mark_harvested(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark a harvest plan as harvested; notify subscribers + confirm pre-orders."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can mark a harvest")

    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")
    if str(plan.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your harvest plan")
    if plan.get("status") == PLAN_HARVESTED:
        raise HTTPException(status_code=400, detail="Plan is already marked harvested")
    if plan.get("productCreated"):
        raise HTTPException(
            status_code=400,
            detail="A product was already created from this harvest plan, so it cannot be harvested again.",
        )

    await harvest_plan_repo.update(
        {"_id": ObjectId(plan_id)},
        {"status": PLAN_HARVESTED, "harvestedAt": datetime.utcnow()},
    )

    notified = await _apply_harvest(plan)

    return {
        "success": True,
        "data": {"planId": plan_id, "notifiedCount": notified},
        "message": f"Harvest marked. {notified} subscribers notified.",
    }


class StageTransition(BaseModel):
    action: str  # "next" | "prev"


def _plan_stage_index(plan: dict, has_batch: bool) -> int:
    """0 Planned, 1 Growing, 2 Ready, 3 Harvested, 4 Batched, -1 Cancelled."""
    if plan.get("status") == PLAN_CANCELLED:
        return -1
    stage = plan.get("stage")
    if stage == "planned":
        return 0
    if stage == "growing":
        return 1
    if stage == "ready":
        return 2
    if stage == "batched":
        return 4
    if stage == "harvested" or plan.get("status") == PLAN_HARVESTED:
        return 4 if has_batch else 3
    # Fallback inference for legacy plans without an explicit stage field.
    now = datetime.utcnow()
    plant = plan.get("plantingDate")
    exp = plan.get("expectedHarvestDate")
    if not plant:
        return 0
    if exp and exp <= now:
        return 2
    if plant < now:
        return 1
    return 0


@router.post("/plans/{plan_id}/stage")
async def transition_plan_stage(
    plan_id: str,
    body: StageTransition,
    current_user: dict = Depends(get_current_user),
):
    """Move a harvest plan forward or backward along the lifecycle route:
    Planned -> Growing -> Ready for Harvest -> Harvested -> Batched.

    Forward transitions update the plan's dates/status (or trigger the real
    harvest / batch creation). Backward transitions reverse the corresponding
    changes so the route can be walked in both directions.
    """
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can advance harvest plans")

    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")
    if str(plan.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your harvest plan")

    batch = await harvest_batch_repo.find_one({"sourceHarvestPlanId": ObjectId(plan_id), "deletedAt": None})
    stage = _plan_stage_index(plan, bool(batch))
    if stage < 0:
        raise HTTPException(status_code=400, detail="Cancelled plans cannot be moved along the route")

    action = (body.action or "next").lower()
    if action not in ("next", "prev"):
        raise HTTPException(status_code=400, detail="action must be 'next' or 'prev'")

    target = stage + 1 if action == "next" else stage - 1
    if target < 0 or target > 4:
        raise HTTPException(
            status_code=400,
            detail="Already at the start/end of the lifecycle route",
        )

    if action == "prev" and plan.get("productCreated"):
        raise HTTPException(
            status_code=400,
            detail="A product was already created from this harvest plan, so the previous step is locked.",
        )
    if action == "next" and target == 3 and plan.get("productCreated"):
        raise HTTPException(
            status_code=400,
            detail="A product was already created from this harvest plan, so it cannot be harvested again.",
        )

    now = datetime.utcnow()

    if target == 0:  # Planned
        await harvest_plan_repo.update(
            {"_id": ObjectId(plan_id)},
            {
                "stage": "planned",
                "plantingDate": now + timedelta(days=10),
                "expectedHarvestDate": now + timedelta(days=90),
                "preOrderEnabled": False,
                "status": PLAN_PLANNED,
                "harvestedAt": None,
            },
        )
        # Close any pending pre-orders taken during the ready stage.
        await harvest_preorder_repo.collection.update_many(
            {"harvestPlanId": ObjectId(plan_id), "status": "pending", "deletedAt": None},
            {"$set": {"status": "cancelled", "cancelledReason": "Pre-orders closed", "updatedAt": now}},
        )
    elif target == 1:  # Growing
        await harvest_plan_repo.update(
            {"_id": ObjectId(plan_id)},
            {
                "stage": "growing",
                "plantingDate": now - timedelta(days=40),
                "expectedHarvestDate": now + timedelta(days=60),
                "preOrderEnabled": False,
                "status": PLAN_PLANNED,
                "harvestedAt": None,
            },
        )
        await harvest_preorder_repo.collection.update_many(
            {"harvestPlanId": ObjectId(plan_id), "status": "pending", "deletedAt": None},
            {"$set": {"status": "cancelled", "cancelledReason": "Pre-orders closed", "updatedAt": now}},
        )
    elif target == 2:  # Ready for harvest -> open pre-orders
        # A future harvest date keeps the plan visible on the customer's
        # pre-harvest page (/harvests/upcoming), where they can pre-order.
        price = plan.get("preOrderPricePerKg")
        if not price:
            product = await product_repository.get_by_id(str(plan.get("productId"))) if plan.get("productId") else None
            price = (product or {}).get("price") or 20
        await harvest_plan_repo.update(
            {"_id": ObjectId(plan_id)},
            {
                "stage": "ready",
                "expectedHarvestDate": now + timedelta(days=3),
                "preOrderEnabled": True,
                "preOrderPricePerKg": float(price),
                "preOrderCutoff": now + timedelta(days=2),
                "status": PLAN_PREORDER,
                "harvestedAt": None,
            },
        )
    elif target == 3:  # Harvested
        await harvest_plan_repo.update(
            {"_id": ObjectId(plan_id)},
            {"stage": "harvested", "status": PLAN_HARVESTED, "harvestedAt": now, "previousStatus": plan.get("status") or PLAN_PLANNED},
        )
        await _apply_harvest(plan)
    elif target == 4:  # Batched
        if plan.get("status") != PLAN_HARVESTED:
            await harvest_plan_repo.update(
                {"_id": ObjectId(plan_id)},
                {"stage": "harvested", "status": PLAN_HARVESTED, "harvestedAt": plan.get("harvestedAt") or now},
            )
        if not batch:
            lot_number = f"BATCH-{datetime.utcnow().strftime('%Y%m%d')}-{str(plan_id)[-4:].upper()}"
            await harvest_batch_repo.create({
                "farmerId": plan.get("farmerId"),
                "lotNumber": lot_number,
                "cropName": plan.get("cropName"),
                "quantityKg": float(plan.get("expectedQuantityKg", 0) or 0),
                "remainingKg": float(plan.get("expectedQuantityKg", 0) or 0),
                "harvestDate": plan.get("harvestedAt") or now,
                "qualityGrade": "standard",
                "storageType": plan.get("storageType") or "normal",
                "shelfLifeDays": 3,
                "expiresAt": (plan.get("harvestedAt") or now) + timedelta(days=3),
                "productId": plan.get("productId"),
                "sourceHarvestPlanId": ObjectId(plan_id),
                "notes": f"Auto batch from harvest plan {plan.get('cropName')}",
                "status": "created",
                "deletedAt": None,
            })
        await harvest_plan_repo.update({"_id": ObjectId(plan_id)}, {"stage": "batched"})

    # Reverse transitions that need to undo an existing batch.
    if target < 4 and batch:
        await harvest_batch_repo.update(
            {"_id": batch["_id"]},
            {"deletedAt": now, "status": "cancelled"},
        )

    await harvest_plan_repo.update({"_id": ObjectId(plan_id)}, {"previousStatus": None})

    updated = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id)})
    batch_after = await harvest_batch_repo.find_one({"sourceHarvestPlanId": ObjectId(plan_id), "deletedAt": None})
    new_stage = _plan_stage_index(updated, bool(batch_after))

    return {
        "success": True,
        "data": {
            "planId": plan_id,
            "stage": new_stage,
            "stageLabel": ["Planned", "Growing", "Ready for Harvest", "Harvested", "Batched"][new_stage] if new_stage >= 0 else "Cancelled",
            "plan": _serialize_plan(updated),
        },
        "message": f"Moved {updated.get('cropName')} to the {['Planned', 'Growing', 'Ready for Harvest', 'Harvested', 'Batched'][new_stage]} stage",
    }


@router.post("/plans/{plan_id}/route")
async def generate_preorder_route(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Build + store an optimized delivery route from the farm through the
    confirmed pre-orders of a harvested plan (Farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can generate delivery routes")

    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")
    if str(plan.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your harvest plan")
    if plan.get("status") != PLAN_HARVESTED:
        raise HTTPException(status_code=400, detail="Mark the plan as harvested before generating a route")

    route = await _build_preorder_route(plan, str(current_user["_id"]))
    if not route["waypoints"]:
        raise HTTPException(
            status_code=400,
            detail="No deliveries to route yet — customers must pre-order or place an order for this crop first.",
        )

    await harvest_route_repo.update(
        {"planId": ObjectId(plan_id)},
        {
            "farmerId": ObjectId(current_user["_id"]),
            "planId": ObjectId(plan_id),
            "planName": plan.get("cropName"),
            "origin": route["origin"],
            "waypoints": route["waypoints"],
            "summary": route["summary"],
            "generatedAt": datetime.utcnow(),
        },
        upsert=True,
    )

    summary = route["summary"]
    message = f"Delivery route generated for {summary['totalStops']} stop(s)"
    if summary.get("preorders") or summary.get("orders"):
        message += f" ({summary.get('preorders', 0)} pre-order(s), {summary.get('orders', 0)} order(s))"

    return {
        "success": True,
        "data": {"planId": plan_id, "origin": route["origin"], "waypoints": route["waypoints"], "summary": route["summary"]},
        "message": message,
    }


@router.get("/plans/{plan_id}/route")
async def get_preorder_route(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Fetch the stored delivery route for a harvested plan (Farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can view delivery routes")
    route = await harvest_route_repo.find_one({"planId": ObjectId(plan_id), "farmerId": ObjectId(current_user["_id"])})
    if not route:
        raise HTTPException(status_code=404, detail="No route generated for this plan yet")
    return {
        "success": True,
        "data": {
            "planId": plan_id,
            "origin": route.get("origin"),
            "waypoints": route.get("waypoints", []),
            "summary": route.get("summary", {}),
        },
    }


@router.post("/plans/{plan_id}/cancel")
async def cancel_harvest_plan(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Cancel a harvest plan (own farmer only)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can cancel harvest plans")

    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")
    if str(plan.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=403, detail="Not your harvest plan")

    await harvest_plan_repo.update({"_id": ObjectId(plan_id)}, {"status": PLAN_CANCELLED})
    await harvest_preorder_repo.collection.update_many(
        {"harvestPlanId": ObjectId(plan_id), "status": "pending", "deletedAt": None},
        {"$set": {"status": "cancelled", "cancelledReason": "Harvest plan cancelled", "updatedAt": datetime.utcnow()}},
    )
    return {"success": True, "message": "Harvest plan cancelled"}


# ================== CUSTOMER / PUBLIC ENDPOINTS ==================

@router.get("/upcoming")
async def list_upcoming_harvests(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: int = Query(20, ge=2, le=100),
    state: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    """List harvest plans customers can pre-order, get notified about, or recently harvested.

    Pass `status=harvested` to list plans that have already been harvested.
    """
    now = datetime.utcnow()
    plan_status = status or PLAN_PREORDER
    match: dict = {
        "deletedAt": None,
        "status": plan_status,
    }
    if plan_status == PLAN_PREORDER:
        match["expectedHarvestDate"] = {"$gte": now}
    if state:
        match["state"] = state
    if district:
        match["district"] = district

    pipeline = [
        {"$match": match},
        {"$lookup": {
            "from": "farmer_profiles",
            "localField": "farmerId",
            "foreignField": "userId",
            "as": "farm"
        }},
        {"$unwind": {"path": "$farm", "preserveNullAndEmptyArrays": True}},
        {"$addFields": {
            "useLocation": {
                "$cond": {
                    "if": {"$and": [{"$isArray": "$location.coordinates"}, {"$gt": [{"$size": "$location.coordinates"}, 0]}]},
                    "then": "$location",
                    "else": "$farm.location",
                }
            }
        }},
        {"$sort": {"harvestedAt": -1} if plan_status == PLAN_HARVESTED else {"expectedHarvestDate": 1}},
        {"$limit": 100},
    ]

    if lat and lng:
        pipeline.append({
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [lng, lat]},
                "distanceField": "distance",
                "maxDistance": radius * 1000,
                "spherical": True,
                "query": {
                    "status": plan_status,
                    "deletedAt": None,
                    **({"expectedHarvestDate": {"$gte": now}} if plan_status == PLAN_PREORDER else {}),
                    **({"state": state} if state else {}),
                    **({"district": district} if district else {}),
                },
            }
        })
        pipeline = pipeline[1:]

    plans = await harvest_plan_repo.aggregate(pipeline)
    for p in plans:
        _serialize_plan(p)
        if p.get("distance"):
            p["distanceKm"] = round(p["distance"] / 1000, 2)
        farmer = p.pop("farm", None) or {}
        p["farmerInfo"] = {
            "name": farmer.get("farmName") or "Farmer",
            "farmName": farmer.get("farmName"),
            "rating": farmer.get("rating"),
        }
        p["preorderCount"] = await harvest_preorder_repo.count({
            "harvestPlanId": p["_id"],
            "status": {"$ne": "cancelled"},
            "deletedAt": None,
        })

    return {"success": True, "data": {"plans": plans, "count": len(plans)}}


@router.get("/{plan_id}")
async def get_harvest_plan(plan_id: str, current_user: dict = Depends(get_current_user)):
    """Get a single harvest plan (any authenticated user)."""
    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")

    _serialize_plan(plan)
    plan["farmerInfo"] = await _farmer_info(str(plan.get("farmerId")))
    plan["preorderCount"] = await harvest_preorder_repo.count({
        "harvestPlanId": ObjectId(plan_id),
        "status": {"$ne": "cancelled"},
        "deletedAt": None,
    })
    if current_user.get("role") == "customer":
        plan["myPreorder"] = await harvest_preorder_repo.find_one({
            "harvestPlanId": ObjectId(plan_id),
            "customerId": ObjectId(current_user["_id"]),
            "status": {"$ne": "cancelled"},
            "deletedAt": None,
        })
        plan["myNotify"] = bool(await harvest_notify_repo.find_one({
            "harvestPlanId": ObjectId(plan_id),
            "customerId": ObjectId(current_user["_id"]),
            "deletedAt": None,
        }))
        if plan["myPreorder"]:
            plan["myPreorder"]["id"] = str(plan["myPreorder"]["_id"])
    return {"success": True, "data": plan}


@router.post("/{plan_id}/preorder")
async def create_preorder(
    plan_id: str,
    quantityKg: float = Body(..., gt=0, embed=True),
    current_user: dict = Depends(get_current_user),
):
    """Reserve part of a planned harvest (Customer only)."""
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can pre-order")

    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")
    if plan.get("status") != PLAN_PREORDER:
        raise HTTPException(status_code=400, detail="Pre-orders are not open for this harvest")
    cutoff = plan.get("preOrderCutoff")
    if cutoff and _to_naive_utc(cutoff) < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Pre-order cutoff has passed")
    price = plan.get("preOrderPricePerKg")
    if not price or price <= 0:
        raise HTTPException(status_code=400, detail="No pre-order price set for this harvest")

    # Respect expected quantity (no overbooking beyond the planned yield).
    sold = await harvest_preorder_repo.aggregate([
        {"$match": {"harvestPlanId": ObjectId(plan_id), "status": {"$ne": "cancelled"}, "deletedAt": None}},
        {"$group": {"_id": None, "total": {"$sum": "$quantityKg"}}},
    ])
    sold_total = float(sold[0]["total"]) if sold and sold[0].get("total") else 0.0
    if sold_total + quantityKg > float(plan.get("expectedQuantityKg", 0)):
        raise HTTPException(status_code=400, detail="Quantity exceeds the planned harvest yield")

    existing = await harvest_preorder_repo.find_one({
        "harvestPlanId": ObjectId(plan_id),
        "customerId": ObjectId(current_user["_id"]),
        "status": {"$ne": "cancelled"},
        "deletedAt": None,
    })
    if existing:
        raise HTTPException(status_code=400, detail="You already have a pre-order for this harvest")

    # Snapshot the customer's default delivery address so a delivery route can
    # be built after harvest even if the customer edits their address later.
    default_addr = await address_repository.get_default_address(str(current_user["_id"]))
    delivery_address = None
    if default_addr:
        addr_parts = [
            default_addr.get("address") or default_addr.get("addressLine1"),
            default_addr.get("area"),
            default_addr.get("city"),
            default_addr.get("state"),
            default_addr.get("zipCode") or default_addr.get("zip_code") or default_addr.get("pincode"),
        ]
        delivery_address = {
            "address": ", ".join(p for p in addr_parts if p) or "",
            "addressLine1": default_addr.get("addressLine1") or default_addr.get("address") or "",
            "area": default_addr.get("area") or "",
            "city": default_addr.get("city") or "",
            "state": default_addr.get("state") or "",
            "zipCode": default_addr.get("zipCode") or default_addr.get("zip_code") or default_addr.get("pincode") or "",
            "location": default_addr.get("location") or default_addr.get("geo"),
        }

    preorder = {
        "harvestPlanId": ObjectId(plan_id),
        "farmerId": plan.get("farmerId"),
        "customerId": ObjectId(current_user["_id"]),
        "cropName": plan.get("cropName"),
        "quantityKg": quantityKg,
        "unitPricePerKg": price,
        "total": round(quantityKg * price, 2),
        "deliveryAddress": delivery_address,
        "status": "pending",
        "confirmedAt": None,
    }
    po_id = await harvest_preorder_repo.create(preorder)
    if not po_id:
        raise HTTPException(status_code=400, detail="Failed to create pre-order")
    preorder["_id"] = ObjectId(po_id)
    preorder["id"] = str(po_id)
    preorder["harvestPlanId"] = str(plan_id)
    preorder["customerId"] = str(current_user["_id"])

    await NotificationService.create_in_app_notification(
        str(current_user["_id"]),
        NotificationType.ORDER,
        "Pre-order placed 🥕",
        f"You pre-ordered {quantityKg} kg of {plan.get('cropName')} for ₹{preorder['total']}.",
        {"harvestPlanId": plan_id, "type": "preorder", "amount": preorder["total"]},
        NotificationPriority.HIGH,
    )

    return {"success": True, "data": preorder, "message": f"Pre-order placed for {quantityKg} kg of {plan.get('cropName')}"}


@router.post("/{plan_id}/notify")
async def subscribe_notify(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Subscribe for a 'notify me when harvested' alert (Customer only)."""
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can subscribe")

    plan = await harvest_plan_repo.find_one({"_id": ObjectId(plan_id), "deletedAt": None})
    if not plan:
        raise HTTPException(status_code=404, detail="Harvest plan not found")
    if plan.get("status") == PLAN_HARVESTED:
        raise HTTPException(status_code=400, detail="This harvest is already complete")

    existing = await harvest_notify_repo.find_one({
        "harvestPlanId": ObjectId(plan_id),
        "customerId": ObjectId(current_user["_id"]),
        "deletedAt": None,
    })
    if existing:
        return {"success": True, "data": {"id": str(existing["_id"])}, "message": "Already subscribed"}

    sub = {
        "harvestPlanId": ObjectId(plan_id),
        "customerId": ObjectId(current_user["_id"]),
        "notifiedAt": None,
    }
    sub_id = await harvest_notify_repo.create(sub)
    if not sub_id:
        raise HTTPException(status_code=400, detail="Failed to subscribe")
    return {"success": True, "data": {"id": sub_id}, "message": f"You'll be notified when {plan.get('cropName')} is harvested"}


@router.delete("/{plan_id}/notify")
async def unsubscribe_notify(
    plan_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Remove a 'notify me' subscription."""
    ok = await harvest_notify_repo.delete({
        "harvestPlanId": ObjectId(plan_id),
        "customerId": ObjectId(current_user["_id"]),
    })
    return {"success": True, "message": "Unsubscribed" if ok else "No active subscription"}


@router.get("/my/preorders")
async def get_my_preorders(current_user: dict = Depends(get_current_user)):
    """List the current customer's pre-orders with plan details."""
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can view pre-orders")

    pipeline = [
        {"$match": {"customerId": ObjectId(current_user["_id"]), "deletedAt": None}},
        {"$lookup": {
            "from": "harvest_plans",
            "localField": "harvestPlanId",
            "foreignField": "_id",
            "as": "plan",
        }},
        {"$unwind": {"path": "$plan", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"createdAt": -1}},
        {"$limit": 100},
    ]
    preorders = await harvest_preorder_repo.aggregate(pipeline)
    for po in preorders:
        po["id"] = str(po["_id"])
        po["harvestPlanId"] = str(po.get("harvestPlanId"))
        if po.get("plan"):
            _serialize_plan(po["plan"])
            po["plan"]["farmerInfo"] = await _farmer_info(str(po["plan"].get("farmerId")))
    return {"success": True, "data": {"preorders": preorders, "count": len(preorders)}}


@router.get("/my/notifications")
async def get_my_harvest_notifications(current_user: dict = Depends(get_current_user)):
    """List the customer's harvest 'notify me' subscriptions."""
    pipeline = [
        {"$match": {"customerId": ObjectId(current_user["_id"]), "deletedAt": None}},
        {"$lookup": {
            "from": "harvest_plans",
            "localField": "harvestPlanId",
            "foreignField": "_id",
            "as": "plan",
        }},
        {"$unwind": {"path": "$plan", "preserveNullAndEmptyArrays": True}},
        {"$sort": {"createdAt": -1}},
        {"$limit": 100},
    ]
    subs = await harvest_notify_repo.aggregate(pipeline)
    for s in subs:
        s["id"] = str(s["_id"])
        s["harvestPlanId"] = str(s.get("harvestPlanId"))
        if s.get("plan"):
            _serialize_plan(s["plan"])
    return {"success": True, "data": {"subscriptions": subs, "count": len(subs)}}