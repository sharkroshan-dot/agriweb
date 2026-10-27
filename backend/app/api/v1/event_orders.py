"""Event order sourcing and fulfillment workflow.

Creates one parent event order and multiple farmer fulfillment allocations.
Urgent events (delivery date within 24 hours / next day) use nearby ready-stock
first so the complete event can be delivered before its deadline.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
import re

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.product_repository import product_repository
from app.repositories.address_repository import address_repository
from app.repositories.inventory_repository import inventory_repository
from app.services.inventory_service import InventoryService
from app.services.bulk_order_service import haversine_km
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority

router = APIRouter()

event_request_repo = BaseRepository("bulk_requests")
event_order_repo = BaseRepository("event_orders")
event_fulfillment_repo = BaseRepository("event_fulfillments")

EVENT_STATUSES = [
    "awaiting_farmer_confirmation",
    "preparing",
    "packing",
    "collection_ready",
    "collecting",
    "consolidating",
    "ready_for_delivery",
    "dispatched",
    "in_transit",
    "delivered",
    "cancelled",
]

FULFILLMENT_STATUSES = [
    "awaiting_farmer_confirmation",
    "accepted",
    "preparing",
    "packing",
    "ready_for_collection",
    "collected",
    "declined",
    "cancelled",
]

class Selection(BaseModel):
    itemName: str
    farmerId: str
    productId: str
    quantityKg: float = Field(..., gt=0)

class ConfirmSourcing(BaseModel):
    selections: List[Selection] = Field(..., min_length=1)

class FulfillmentDecision(BaseModel):
    decision: str = Field(..., description="accept | decline")

class StatusUpdate(BaseModel):
    status: str


def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")


def _coords(location: Any) -> Optional[List[float]]:
    if isinstance(location, dict):
        c = location.get("coordinates")
        if isinstance(c, list) and len(c) >= 2:
            return c
    return None


def _farmer_coords(farmer: Dict[str, Any]) -> Optional[List[float]]:
    return _coords(farmer.get("location")) or _coords(farmer.get("farmLocation"))


def _delivery_datetime(request: Dict[str, Any]) -> Optional[datetime]:
    raw = request.get("requestedDeliveryDate")
    if not raw:
        return None
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        try:
            d = datetime.strptime(str(raw)[:10], "%Y-%m-%d")
        except Exception:
            return None
    time_raw = str(request.get("requestedDeliveryTime") or "")
    match = re.search(r"(\d{1,2}:\d{2})\s*(AM|PM)?", time_raw, re.I)
    if match:
        hour, minute = [int(x) for x in match.group(1).split(":")]
        ampm = (match.group(2) or "").upper()
        if ampm == "PM" and hour < 12:
            hour += 12
        if ampm == "AM" and hour == 12:
            hour = 0
        d = d.replace(hour=hour, minute=minute)
    return d


def _urgent(request: Dict[str, Any]) -> Dict[str, Any]:
    delivery = _delivery_datetime(request)
    if not delivery:
        return {"urgent": False, "hoursRemaining": None, "daysRemaining": None}
    delta = delivery - datetime.utcnow()
    return {
        "urgent": delta.total_seconds() <= 24 * 3600,
        "hoursRemaining": round(delta.total_seconds() / 3600, 1),
        "daysRemaining": max(0, delta.days),
    }


async def _resolve_destination(request: Dict[str, Any]) -> Optional[List[float]]:
    address = request.get("deliveryAddress") or {}
    coords = _coords(address.get("location"))
    if coords:
        return coords
    try:
        from app.services.order_service import geocode_address
        geo = await geocode_address({
            "address_line1": address.get("addressLine1") or address.get("address_line1") or "",
            "address_line2": address.get("addressLine2") or address.get("address_line2") or "",
            "city": address.get("city") or request.get("deliveryCity") or "",
            "state": address.get("state") or "",
            "zip_code": address.get("zipCode") or address.get("zip_code") or "",
            "country": "India",
        })
        return _coords(geo)
    except Exception:
        return None


async def _supply_for_farmer(farmer_id: str) -> List[Dict[str, Any]]:
    products = await product_repository.get_by_farmer(farmer_id, limit=500)
    result = []
    for product in products:
        try:
            available = float(await InventoryService.get_available_stock(str(product["_id"])))
        except Exception:
            available = 0.0
        if available <= 0:
            continue
        result.append({
            "productId": str(product["_id"]),
            "productName": product.get("name") or "",
            "nameKey": str(product.get("name") or "").strip().lower(),
            "availableKg": available,
            "pricePerKg": float(product.get("bulkPrice") or product.get("price") or 0),
            "qualityGrade": product.get("qualityGrade"),
        })
    return result


async def build_sourcing_plan(request: Dict[str, Any]) -> Dict[str, Any]:
    destination = await _resolve_destination(request)
    urgency = _urgent(request)
    farmers = await farmer_repository.find_many({"deletedAt": None}, limit=500)

    by_item: Dict[str, List[Dict[str, Any]]] = {
        str(i.get("name") or "").strip().lower(): [] for i in request.get("items", [])
    }

    for farmer in farmers:
        farmer_id = str(farmer.get("userId") or farmer.get("_id"))
        if not farmer_id:
            continue
        farm_coords = _farmer_coords(farmer)
        distance = 0.0
        if destination and farm_coords:
            distance = haversine_km(destination[1], destination[0], farm_coords[1], farm_coords[0])
        rating = float(farmer.get("rating") or 0)
        supply = await _supply_for_farmer(farmer_id)
        for s in supply:
            for item in request.get("items", []):
                requested = float(item.get("quantityKg") or 0)
                key = str(item.get("name") or "").strip().lower()
                if not key or key != s["nameKey"]:
                    continue
                coverage = min(100.0, s["availableKg"] / requested * 100.0) if requested else 0.0
                distance_score = 100.0 if distance <= 5 else 85.0 if distance <= 10 else 65.0 if distance <= 20 else 40.0 if distance <= 50 else 10.0
                readiness_score = 100.0 if s["availableKg"] >= requested else 80.0
                rating_score = min(100.0, rating * 20.0)
                score = (
                    coverage * 0.45 + distance_score * 0.30 + readiness_score * 0.15 + rating_score * 0.10
                    if urgency["urgent"]
                    else coverage * 0.40 + distance_score * 0.25 + rating_score * 0.20 + 75.0 * 0.15
                )
                by_item[key].append({
                    "farmerId": farmer_id,
                    "farmName": farmer.get("farmName") or farmer.get("ownerName") or "Farmer",
                    "productId": s["productId"],
                    "productName": s["productName"],
                    "availableKg": round(s["availableKg"], 2),
                    "pricePerKg": s["pricePerKg"],
                    "distanceKm": round(distance, 1),
                    "rating": rating,
                    "score": round(score, 1),
                    "urgentPriority": urgency["urgent"],
                })

    item_plans = []
    for item in request.get("items", []):
        key = str(item.get("name") or "").strip().lower()
        required = float(item.get("quantityKg") or 0)
        candidates = sorted(by_item.get(key, []), key=lambda x: (-x["score"], x["distanceKm"]))
        remaining = required
        selected = []
        for candidate in candidates:
            if remaining <= 0:
                break
            qty = min(remaining, candidate["availableKg"])
            if qty <= 0:
                continue
            row = dict(candidate)
            row["selectedQuantityKg"] = round(qty, 2)
            row["selected"] = True
            selected.append(row)
            remaining -= qty
        item_plans.append({
            "itemName": item.get("name"),
            "requiredKg": required,
            "plannedKg": round(required - max(remaining, 0), 2),
            "shortageKg": round(max(remaining, 0), 2),
            "fulfilled": remaining <= 0.0001,
            "candidates": candidates[:10],
            "selected": selected,
        })

    return {
        "urgent": urgency["urgent"],
        "hoursRemaining": urgency["hoursRemaining"],
        "daysRemaining": urgency["daysRemaining"],
        "strategy": "nearby_ready_stock_first" if urgency["urgent"] else "balanced_price_distance_availability",
        "destination": destination,
        "items": item_plans,
        "fullyFulfilled": all(i["fulfilled"] for i in item_plans),
    }


def _safe_event(order: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(order)
    for key in ("_id", "buyerUserId", "requestId"):
        if key in out and out[key] is not None:
            out[key if key != "_id" else "id"] = str(out.pop(key))
    return out


def _safe_fulfillment(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    for key in ("eventOrderId", "requestId", "farmerId", "productId", "buyerUserId"):
        if key in out and out[key] is not None:
            out[key] = str(out[key])
    return out


@router.get("/requests/{request_id}/sourcing")
async def sourcing_plan(request_id: str, current_user: dict = Depends(get_current_user)):
    request = await event_request_repo.find_one({"_id": _oid(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Event request not found")
    if str(request.get("buyerUserId")) != str(current_user.get("_id")) and current_user.get("role") not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Not your event request")
    existing = await event_order_repo.find_one({"requestId": request["_id"], "deletedAt": None})
    plan = await build_sourcing_plan(request)
    return {
        "success": True,
        "data": {
            "requestId": request_id,
            "requestNumber": request.get("requestNumber"),
            "purpose": request.get("purpose"),
            "guestCount": request.get("guestCount"),
            "eventDate": request.get("eventDate"),
            "requestedDeliveryDate": request.get("requestedDeliveryDate"),
            "requestedDeliveryTime": request.get("requestedDeliveryTime"),
            "urgent": plan["urgent"],
            "hoursRemaining": plan["hoursRemaining"],
            "strategy": plan["strategy"],
            "items": plan["items"],
            "fullyFulfilled": plan["fullyFulfilled"],
            "eventOrder": _safe_event(existing) if existing else None,
        },
    }


@router.post("/requests/{request_id}/confirm-sourcing")
async def confirm_sourcing(
    request_id: str,
    data: ConfirmSourcing,
    current_user: dict = Depends(get_current_user),
):
    request = await event_request_repo.find_one({"_id": _oid(request_id), "deletedAt": None})
    if not request:
        raise HTTPException(status_code=404, detail="Event request not found")
    if str(request.get("buyerUserId")) != str(current_user.get("_id")):
        raise HTTPException(status_code=403, detail="Not your event request")

    existing = await event_order_repo.find_one({"requestId": request["_id"], "deletedAt": None})
    if existing:
        return {"success": True, "data": {"eventOrder": _safe_event(existing)}, "message": "Event sourcing already confirmed"}

    plan = await build_sourcing_plan(request)
    plan_lookup = {}
    for item in plan["items"]:
        for c in item["selected"]:
            plan_lookup[(item["itemName"].strip().lower(), c["farmerId"], c["productId"])] = c

    if not data.selections:
        raise HTTPException(status_code=400, detail="At least one source selection is required")

    totals: Dict[str, float] = {}
    normalized = []
    for selection in data.selections:
        key = (selection.itemName.strip().lower(), selection.farmerId, selection.productId)
        candidate = plan_lookup.get(key)
        if not candidate:
            raise HTTPException(status_code=400, detail=f"Invalid or stale source selection for {selection.itemName}")
        qty = min(float(selection.quantityKg), float(candidate["availableKg"]))
        if qty <= 0:
            raise HTTPException(status_code=400, detail="Selected quantity is not available")
        totals[selection.itemName.strip().lower()] = totals.get(selection.itemName.strip().lower(), 0) + qty
        normalized.append({
            "itemName": selection.itemName.strip(),
            "farmerId": selection.farmerId,
            "productId": selection.productId,
            "quantityKg": round(qty, 2),
            "farmName": candidate["farmName"],
            "distanceKm": candidate["distanceKm"],
            "pricePerKg": candidate["pricePerKg"],
        })

    required = {str(i.get("name") or "").strip().lower(): float(i.get("quantityKg") or 0) for i in request.get("items", [])}
    shortages = {k: round(v - totals.get(k, 0), 2) for k, v in required.items() if totals.get(k, 0) + 0.0001 < v}
    if shortages:
        raise HTTPException(status_code=409, detail={"message": "The selected sources do not fully cover the event", "shortages": shortages})

    # Reserve every selected inventory row before creating the parent/children.
    reserved = []
    try:
        for row in normalized:
            ok = await inventory_repository.atomic_reserve(row["productId"], row["quantityKg"])
            if not ok:
                raise HTTPException(status_code=409, detail=f"Stock changed for {row['itemName']}; refresh sourcing and try again")
            reserved.append(row)
    except Exception:
        for row in reserved:
            await inventory_repository.atomic_release(row["productId"], row["quantityKg"])
        raise

    now = datetime.utcnow()
    event_order = {
        "requestId": request["_id"],
        "requestNumber": request.get("requestNumber"),
        "buyerUserId": request.get("buyerUserId"),
        "buyerName": request.get("buyerName"),
        "purpose": request.get("purpose"),
        "guestCount": request.get("guestCount"),
        "eventDate": request.get("eventDate"),
        "requestedDeliveryDate": request.get("requestedDeliveryDate"),
        "requestedDeliveryTime": request.get("requestedDeliveryTime"),
        "deliveryCity": request.get("deliveryCity"),
        "deliveryAddress": request.get("deliveryAddress"),
        "urgent": plan["urgent"],
        "fulfillmentStrategy": plan["strategy"],
        "status": "awaiting_farmer_confirmation",
        "totalWeightKg": round(sum(x["quantityKg"] for x in normalized), 2),
        "fulfillmentCount": len(normalized),
        "createdAt": now,
        "updatedAt": now,
    }
    event_id = await event_order_repo.create(event_order)
    if not event_id:
        for row in reserved:
            await inventory_repository.atomic_release(row["productId"], row["quantityKg"])
        raise HTTPException(status_code=500, detail="Failed to create event order")
    event_order["_id"] = ObjectId(event_id)

    fulfillments = []
    try:
        for row in normalized:
            fulfillment = {
                "eventOrderId": ObjectId(event_id),
                "requestId": request["_id"],
                "requestNumber": request.get("requestNumber"),
                "buyerUserId": request.get("buyerUserId"),
                "farmerId": ObjectId(row["farmerId"]),
                "productId": ObjectId(row["productId"]),
                "itemName": row["itemName"],
                "quantityKg": row["quantityKg"],
                "pricePerKg": row["pricePerKg"],
                "distanceKm": row["distanceKm"],
                "status": "awaiting_farmer_confirmation",
                "reservationActive": True,
                "createdAt": now,
                "updatedAt": now,
            }
            fid = await event_fulfillment_repo.create(fulfillment)
            if not fid:
                raise RuntimeError("Failed to create fulfillment")
            fulfillment["_id"] = ObjectId(fid)
            fulfillments.append(fulfillment)
            await NotificationService.create_in_app_notification(
                row["farmerId"],
                NotificationType.ORDER,
                "Urgent event fulfillment request" if plan["urgent"] else "New event fulfillment request",
                f"{row['itemName']} {row['quantityKg']} kg for {request.get('purpose') or 'event'} · {request.get('requestNumber')}",
                {"eventOrderId": event_id, "fulfillmentId": fid, "type": "event_fulfillment"},
                NotificationPriority.HIGH,
            )
    except Exception as exc:
        for row in reserved:
            await inventory_repository.atomic_release(row["productId"], row["quantityKg"])
        await event_order_repo.update({"_id": ObjectId(event_id)}, {"status": "cancelled", "updatedAt": datetime.utcnow()})
        raise HTTPException(status_code=500, detail=f"Failed to create event fulfillment: {exc}")

    await event_request_repo.update({"_id": request["_id"]}, {
        "status": "awarded",
        "eventOrderId": ObjectId(event_id),
        "fulfillmentStrategy": plan["strategy"],
        "urgent": plan["urgent"],
        "updatedAt": now,
    })

    return {
        "success": True,
        "data": {
            "eventOrder": _safe_event(event_order),
            "fulfillments": [_safe_fulfillment(x) for x in fulfillments],
        },
        "message": "Event sourcing confirmed; stock reserved and farmers notified",
    }


@router.get("/orders")
async def list_event_orders(current_user: dict = Depends(get_current_user)):
    role = current_user.get("role")
    if role in ("customer", "business"):
        match = {"buyerUserId": _oid(str(current_user["_id"])), "deletedAt": None}
    elif role == "farmer":
        match = {"farmerId": _oid(str(current_user["_id"])), "deletedAt": None}
    elif role in ("admin", "super_admin"):
        match = {"deletedAt": None}
    else:
        raise HTTPException(status_code=403, detail="Not allowed")
    rows = await event_order_repo.find_many(match, sort=[("createdAt", -1)], limit=200)
    return {"success": True, "data": {"orders": [_safe_event(x) for x in rows]}}


@router.get("/fulfillments")
async def list_fulfillments(current_user: dict = Depends(get_current_user)):
    role = current_user.get("role")
    if role == "farmer":
        match = {"farmerId": _oid(str(current_user["_id"])), "deletedAt": None}
    elif role in ("customer", "business"):
        match = {"buyerUserId": _oid(str(current_user["_id"])), "deletedAt": None}
    elif role in ("admin", "super_admin"):
        match = {"deletedAt": None}
    else:
        raise HTTPException(status_code=403, detail="Not allowed")
    rows = await event_fulfillment_repo.find_many(match, sort=[("createdAt", -1)], limit=300)
    return {"success": True, "data": {"fulfillments": [_safe_fulfillment(x) for x in rows]}}


@router.put("/fulfillments/{fulfillment_id}/decision")
async def fulfillment_decision(
    fulfillment_id: str,
    data: FulfillmentDecision,
    current_user: dict = Depends(get_current_user),
):
    fulfillment = await event_fulfillment_repo.find_one({"_id": _oid(fulfillment_id), "deletedAt": None})
    if not fulfillment:
        raise HTTPException(status_code=404, detail="Fulfillment not found")
    if str(fulfillment.get("farmerId")) != str(current_user.get("_id")) or current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only the assigned farmer can respond")

    if fulfillment.get("status") != "awaiting_farmer_confirmation":
        raise HTTPException(status_code=400, detail="This fulfillment is no longer awaiting confirmation")

    decision = data.decision.lower()
    if decision not in ("accept", "decline"):
        raise HTTPException(status_code=400, detail="Decision must be accept or decline")

    if decision == "accept":
        await event_fulfillment_repo.update({"_id": fulfillment["_id"]}, {
            "status": "accepted", "updatedAt": datetime.utcnow()
        })
        event_order_id = fulfillment["eventOrderId"]
        sibling = await event_fulfillment_repo.find_many({"eventOrderId": event_order_id, "deletedAt": None})
        if all(x.get("status") == "accepted" for x in sibling):
            await event_order_repo.update({"_id": event_order_id}, {"status": "preparing", "updatedAt": datetime.utcnow()})
        return {"success": True, "message": "Event fulfillment accepted"}

    await inventory_repository.atomic_release(fulfillment["productId"], fulfillment["quantityKg"])
    await event_fulfillment_repo.update({"_id": fulfillment["_id"]}, {
        "status": "declined", "reservationActive": False, "updatedAt": datetime.utcnow()
    })
    await event_order_repo.update({"_id": fulfillment["eventOrderId"]}, {
        "status": "needs_resourcing", "updatedAt": datetime.utcnow()
    })
    return {"success": True, "message": "Fulfillment declined; reserved stock released and event needs resourcing"}


@router.put("/fulfillments/{fulfillment_id}/status")
async def fulfillment_status(
    fulfillment_id: str,
    data: StatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    fulfillment = await event_fulfillment_repo.find_one({"_id": _oid(fulfillment_id), "deletedAt": None})
    if not fulfillment:
        raise HTTPException(status_code=404, detail="Fulfillment not found")
    allowed = current_user.get("role") == "farmer" and str(fulfillment.get("farmerId")) == str(current_user.get("_id"))
    if current_user.get("role") in ("admin", "super_admin"):
        allowed = True
    if not allowed:
        raise HTTPException(status_code=403, detail="Not allowed")
    status = data.status
    if status not in FULFILLMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid fulfillment status")
    history = list(fulfillment.get("statusHistory") or [])
    history.append({"status": status, "at": datetime.utcnow()})
    await event_fulfillment_repo.update({"_id": fulfillment["_id"]}, {
        "status": status, "statusHistory": history, "updatedAt": datetime.utcnow()
    })
    event = await event_order_repo.find_one({"_id": fulfillment["eventOrderId"], "deletedAt": None})
    if event:
        siblings = await event_fulfillment_repo.find_many({"eventOrderId": event["_id"], "deletedAt": None})
        statuses = [x.get("status") for x in siblings]
        parent = event.get("status")
        if statuses and all(s == "ready_for_collection" for s in statuses):
            parent = "collection_ready"
        elif statuses and all(s == "collected" for s in statuses):
            parent = "consolidating"
        elif statuses and all(s in ("accepted", "preparing", "packing") for s in statuses):
            parent = "preparing"
        await event_order_repo.update({"_id": event["_id"]}, {"status": parent, "updatedAt": datetime.utcnow()})
    return {"success": True, "data": _safe_fulfillment(fulfillment)}


@router.put("/orders/{event_order_id}/status")
async def event_order_status(
    event_order_id: str,
    data: StatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    event = await event_order_repo.find_one({"_id": _oid(event_order_id), "deletedAt": None})
    if not event:
        raise HTTPException(status_code=404, detail="Event order not found")
    allowed_roles = ("admin", "super_admin", "delivery_partner", "warehouse")
    if current_user.get("role") not in allowed_roles:
        raise HTTPException(status_code=403, detail="Only operations roles can update event delivery status")
    if data.status not in EVENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid event order status")
    await event_order_repo.update({"_id": event["_id"]}, {"status": data.status, "updatedAt": datetime.utcnow()})
    return {"success": True, "data": _safe_event({**event, "status": data.status})}
