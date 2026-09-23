from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from bson import ObjectId
import logging
import math
import asyncio
from enum import Enum

from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.core.security import require_role
from app.schemas.subscription import (
    BasketPlanCreate, BasketPlanUpdate, BasketPlanResponse,
    SubscriptionCreate, SubscriptionResponse, WeeklyAdjustRequest,
    Cadence, SubscriptionStatus, BasketPlanStatus, BasketItem,
)
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority

logger = logging.getLogger(__name__)
router = APIRouter()

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _parse_coords(value: str) -> Optional[List[float]]:
    try:
        parts = value.split(",")
        lat, lng = float(parts[0]), float(parts[1])
        return [lat, lng]
    except Exception:
        return None


def _next_occurrence(cadence: Cadence, day: str, after: Optional[datetime] = None) -> datetime:
    """Next delivery date strictly after `after` (defaults to now)."""
    after = after or datetime.utcnow()
    after = after.replace(hour=0, minute=0, second=0, microsecond=0)
    if day.strip().lower() == "1st of month":
        if after.month == 12:
            nxt = after.replace(year=after.year + 1, month=1, day=1)
        else:
            nxt = after.replace(month=after.month + 1, day=1)
        return nxt
    try:
        target = WEEKDAYS.index(day.strip())
    except ValueError:
        target = after.weekday()
    delta = (target - after.weekday()) % 7
    if delta == 0:
        delta = 7
    nxt = after + timedelta(days=delta)
    if cadence == Cadence.BIWEEKLY:
        nxt = nxt + timedelta(days=7)
    return nxt


async def _get_farmer_profile(farmer_id: str) -> Optional[Dict[str, Any]]:
    col = MongoDB.get_collection("farmer_profiles")
    try:
        return await col.find_one({"userId": ObjectId(farmer_id), "deletedAt": None})
    except Exception:
        return await col.find_one({"userId": farmer_id})


async def _farmer_rating(farmer_id: str) -> Optional[float]:
    col = MongoDB.get_collection("products")
    cursor = col.find({"farmerId": ObjectId(farmer_id), "deletedAt": None})
    products = await cursor.to_list(length=10000)
    rated = [p.get("ratings") for p in products if (p.get("ratings") or {}).get("count", 0) > 0]
    if not rated:
        return None
    return round(sum(r.get("average", 0) for r in rated) / len(rated), 1)


async def _farmer_distance_km(farmer_id: str, coords: Optional[List[float]]) -> Optional[float]:
    if not coords:
        return None
    profile = await _get_farmer_profile(farmer_id)
    if not profile:
        return None
    loc = profile.get("location") or profile.get("farmLocation")
    if not isinstance(loc, dict):
        return None
    pt = loc.get("coordinates")
    if not pt or len(pt) < 2:
        return None
    return round(_haversine_km(coords[0], coords[1], pt[1], pt[0]), 1)


async def _count_subscribers(plan_id: ObjectId) -> int:
    col = MongoDB.get_collection("basket_subscriptions")
    return await col.count_documents(
        {"planId": ObjectId(plan_id), "status": {"$ne": SubscriptionStatus.CANCELLED.value}}
    )


async def _serialize_plan(plan: Dict[str, Any], coords: Optional[List[float]] = None) -> Dict[str, Any]:
    plan_id = plan["_id"]
    farmer_id = str(plan.get("farmerId"))
    farmer_name = plan.get("farmerName") or "Farmer"
    rating = await _farmer_rating(farmer_id)
    return {
        "id": str(plan_id),
        "farmerId": farmer_id,
        "farmerName": farmer_name,
        "name": plan.get("name", ""),
        "description": plan.get("description"),
        "cadence": plan.get("cadence", "weekly"),
        "day": plan.get("day", "Saturday"),
        "price": float(plan.get("price", 0)),
        "items": plan.get("items", []),
        "maxSubscribers": plan.get("maxSubscribers", 50),
        "subscriberCount": await _count_subscribers(plan_id),
        "deliveryMode": plan.get("deliveryMode", "delivery"),
        "status": plan.get("status", "active"),
        "rating": rating,
        "distanceKm": await _farmer_distance_km(farmer_id, coords),
        "createdAt": plan.get("createdAt"),
        "updatedAt": plan.get("updatedAt"),
    }


def _get_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(plan["_id"]),
        "farmerId": str(plan.get("farmerId")),
        "farmerName": plan.get("farmerName") or "Farmer",
        "name": plan.get("name", ""),
        "description": plan.get("description"),
        "cadence": plan.get("cadence", "weekly"),
        "day": plan.get("day", "Saturday"),
        "price": float(plan.get("price", 0)),
        "items": plan.get("items", []),
        "maxSubscribers": plan.get("maxSubscribers", 50),
        "deliveryMode": plan.get("deliveryMode", "delivery"),
        "status": plan.get("status", "active"),
        "createdAt": plan.get("createdAt"),
        "updatedAt": plan.get("updatedAt"),
    }


async def _get_customer_defaults(customer_id: str) -> Dict[str, Any]:
    """Return a customer's default delivery address (first address)."""
    col = MongoDB.get_collection("addresses")
    address = await col.find_one({"user_id": ObjectId(customer_id), "deletedAt": None})
    if not address:
        address = await col.find_one({"userId": ObjectId(customer_id), "deletedAt": None})
    if not address:
        return {}
    return {
        "addressLine1": address.get("address_line1") or address.get("addressLine1", ""),
        "addressLine2": address.get("address_line2") or address.get("addressLine2"),
        "city": address.get("city", ""),
        "state": address.get("state", ""),
        "zipCode": address.get("zip_code") or address.get("zipCode", ""),
        "country": address.get("country", ""),
        "location": address.get("location"),
    }


# ---------------------------------------------------------------------------
# Order generation for due subscriptions
# ---------------------------------------------------------------------------
async def generate_due_basket_orders() -> Dict[str, Any]:
    """Create an order for every active subscription whose next delivery is due."""
    subs_col = MongoDB.get_collection("basket_subscriptions")
    orders_col = MongoDB.get_collection("orders")
    plans_col = MongoDB.get_collection("basket_plans")
    now = datetime.utcnow()
    generated = []
    skipped = 0
    errors = 0

    cursor = subs_col.find(
        {"status": SubscriptionStatus.ACTIVE.value, "nextDelivery": {"$lte": now}}
    )
    subs = await cursor.to_list(length=500)
    for sub in subs:
        due_date = sub.get("nextDelivery")
        sub_id = sub["_id"]
        existing = await orders_col.find_one(
            {"subscriptionId": ObjectId(sub_id), "deliveryDate": due_date, "isBasketOrder": True}
        )
        if existing:
            skipped += 1
            continue
        try:
            plan = await plans_col.find_one({"_id": ObjectId(sub.get("planId"))})
            if not plan:
                errors += 1
                continue
            customer_id = str(sub.get("customerId"))
            farmer_id = str(sub.get("farmerId"))
            items = sub.get("items") or plan.get("items") or []
            order_items = []
            subtotal = 0.0
            for it in items:
                qty = float(it.get("quantity", 0))
                unit_price = float(it.get("unitPrice", 0))
                item_total = round(unit_price * qty, 2)
                subtotal += item_total
                order_items.append({
                    "productId": ObjectId(it["productId"]) if ObjectId.is_valid(it["productId"]) else None,
                    "variantId": None,
                    "productName": it.get("name", ""),
                    "quantity": qty,
                    "unitPrice": unit_price,
                    "originalUnitPrice": unit_price,
                    "totalPrice": item_total,
                    "attributes": {},
                    "pickupAvailable": True,
                    "farmAddress": plan.get("farmAddress") or "",
                })
            price = float(sub.get("price") or plan.get("price") or subtotal)
            delivery_mode = sub.get("deliveryMode") or plan.get("deliveryMode") or "delivery"
            is_pickup = delivery_mode == "pickup"
            delivery_address = None
            farm_address = None
            if not is_pickup:
                delivery_address = await _get_customer_defaults(customer_id)
            else:
                farm_address = plan.get("farmAddress")

            delivery_charge = 0
            delivery_details = None
            if not is_pickup:
                from app.services.delivery_fee_service import delivery_fee_service
                profile = await _get_farmer_profile(farmer_id)
                farm_loc = (profile or {}).get("farmLocation") or (profile or {}).get("location")
                weight_kg = float(sum(float(it.get("quantity", 0) or 0) for it in order_items))
                quote = await delivery_fee_service.calculate_delivery_fee(
                    from_location=farm_loc,
                    to_location=(delivery_address or {}).get("location"),
                    weight_kg=weight_kg,
                    method="farmer",
                    order_amount=price,
                )
                delivery_charge = quote["fee"]
                delivery_details = {
                    "method": quote["method"],
                    "distanceKm": quote["distanceKm"],
                    "weightKg": quote["weightKg"],
                    "baseFee": quote["baseFee"],
                    "distanceFee": quote["distanceFee"],
                    "weightFee": quote["weightFee"],
                    "minimumApplied": quote["minimumApplied"],
                    "fee": quote["fee"],
                    "freeDelivery": quote["freeDelivery"],
                    "subsidy": quote["subsidy"],
                    "distanceAvailable": quote["distanceAvailable"],
                }
            platform_fee = 0 if is_pickup else round(price * 0.05, 2)
            total = price + delivery_charge + platform_fee

            seq = int(datetime.utcnow().timestamp() % 1000000)
            order_number = f"FB-{datetime.utcnow().strftime('%Y%m%d')}-{seq:06d}"

            order_doc = {
                "orderNumber": order_number,
                "customerId": ObjectId(customer_id),
                "farmerId": ObjectId(farmer_id),
                "warehouseId": None,
                "items": order_items,
                "subtotal": subtotal,
                "deliveryCharge": delivery_charge,
                "platformFee": platform_fee,
                "platformCommission": platform_fee,
                "discount": 0,
                "totalAmount": round(total, 2),
                "paymentMethod": "cash",
                "paymentStatus": "pending",
                "orderStatus": "pending",
                "deliveryAddress": delivery_address,
                "deliveryType": delivery_mode,
                "farmAddress": farm_address,
                "isBasketOrder": True,
                "subscriptionId": ObjectId(sub_id),
                "basketPlanId": ObjectId(sub.get("planId")),
                "deliveryDetails": delivery_details,
                "deliveryDate": due_date,
                "orderDate": now,
                "createdAt": now,
                "updatedAt": now,
                "statusHistory": [{
                    "status": "pending",
                    "changedBy": customer_id,
                    "timestamp": now,
                }],
            }
            await orders_col.insert_one(order_doc)
            generated.append(order_number)

            week = sub.get("weekNumber", 0) + 1
            await subs_col.update_one(
                {"_id": sub_id},
                {"$set": {
                    "weekNumber": week,
                    "lastGeneratedAt": now,
                    "nextDelivery": _next_occurrence(Cadence(sub.get("cadence", "weekly")), sub.get("day", "Saturday"), due_date),
                }},
            )
            try:
                await NotificationService.create_in_app_notification(
                    customer_id,
                    NotificationType.ORDER,
                    "Basket order created",
                    f"Your {sub.get('planName', 'farm basket')} order {order_number} has been created for {due_date.strftime('%d %b')}.",
                    {"subscriptionId": str(sub_id), "orderNumber": order_number, "isBasketOrder": True},
                    NotificationPriority.MEDIUM,
                )
            except Exception as e:
                logger.warning(f"Basket order notification failed: {e}")
        except Exception as e:
            logger.exception(f"Failed to generate basket order for subscription {sub_id}: {e}")
            errors += 1

    return {"generated": len(generated), "orders": generated, "skipped": skipped, "errors": errors}


# ---------------------------------------------------------------------------
# Farmer: manage basket plans
# ---------------------------------------------------------------------------
async def _ensure_verified_farmer(current_user: dict) -> str:
    if current_user.get("role") != "farmer":
        raise HTTPException(403, "Only farmers can manage farm baskets")
    profile = await _get_farmer_profile(str(current_user["_id"]))
    if not profile or profile.get("isVerified") is not True:
        raise HTTPException(403, "Only verified farmers can create farm baskets. Please complete KYC verification.")
    return str(current_user["_id"])


async def _get_owned_plan(plan_id: str, farmer_id: str, is_admin: bool = False) -> Dict[str, Any]:
    try:
        obj_id = ObjectId(plan_id)
    except Exception:
        raise HTTPException(400, "Invalid basket plan id")
    col = MongoDB.get_collection("basket_plans")
    plan = await col.find_one({"_id": obj_id})
    if not plan:
        raise HTTPException(404, "Basket plan not found")
    if not is_admin and str(plan.get("farmerId")) != farmer_id:
        raise HTTPException(403, "You do not own this basket plan")
    return plan


@router.get("/plans/my", response_model=dict)
async def get_my_plans(current_user: dict = Depends(get_current_user)):
    farmer_id = await _ensure_verified_farmer(current_user)
    col = MongoDB.get_collection("basket_plans")
    cursor = col.find({"farmerId": ObjectId(farmer_id), "deletedAt": None}).sort("createdAt", -1)
    plans = await cursor.to_list(length=500)
    result = []
    for p in plans:
        result.append(await _serialize_plan(p))
    return {"success": True, "data": {"plans": result, "total": len(result)}}


@router.get("/plans/my/orders", response_model=dict)
async def get_my_basket_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    farmer_id = await _ensure_verified_farmer(current_user)
    col = MongoDB.get_collection("orders")
    query = {"farmerId": ObjectId(farmer_id), "isBasketOrder": True, "deletedAt": None}
    total = await col.count_documents(query)
    cursor = col.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    orders = await cursor.to_list(length=limit)
    result = []
    for o in orders:
        result.append({
            "id": str(o["_id"]),
            "orderNumber": o.get("orderNumber"),
            "customerId": str(o.get("customerId")),
            "totalAmount": o.get("totalAmount"),
            "orderStatus": o.get("orderStatus"),
            "paymentStatus": o.get("paymentStatus"),
            "deliveryType": o.get("deliveryType"),
            "deliveryDate": o.get("deliveryDate"),
            "items": o.get("items", []),
            "createdAt": o.get("createdAt"),
        })
    return {"success": True, "data": {"orders": result, "total": total, "page": page, "pages": (total + limit - 1) // limit}}


@router.post("/plans", response_model=dict, status_code=201)
async def create_plan(data: BasketPlanCreate, current_user: dict = Depends(get_current_user)):
    farmer_id = await _ensure_verified_farmer(current_user)
    profile = await _get_farmer_profile(farmer_id)
    farmer_name = (profile.get("farmName") if profile else None) or current_user.get("name") or "Farmer"
    now = datetime.utcnow()
    plan = {
        "farmerId": ObjectId(farmer_id),
        "farmerName": farmer_name,
        "name": data.name,
        "description": data.description,
        "cadence": data.cadence.value,
        "day": data.day,
        "price": data.price,
        "items": [it.model_dump() for it in data.items],
        "maxSubscribers": data.maxSubscribers,
        "deliveryMode": data.deliveryMode.value,
        "status": data.status.value,
        "farmAddress": (profile.get("farmAddress") if profile else None) or None,
        "createdAt": now,
        "updatedAt": now,
    }
    col = MongoDB.get_collection("basket_plans")
    result = await col.insert_one(plan)
    return {"success": True, "data": {**_get_plan(plan), "id": str(result.inserted_id), "farmerName": farmer_name, "subscriberCount": 0}}


@router.put("/plans/{plan_id}", response_model=dict)
async def update_plan(plan_id: str, data: BasketPlanUpdate, current_user: dict = Depends(get_current_user)):
    is_admin = current_user.get("role") == "admin"
    if is_admin:
        farmer_id = str(current_user["_id"])
    else:
        farmer_id = await _ensure_verified_farmer(current_user)
    plan = await _get_owned_plan(plan_id, farmer_id, is_admin=is_admin)
    updates = data.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    for k, v in updates.items():
        if isinstance(v, Enum):
            updates[k] = v.value
    updates["updatedAt"] = datetime.utcnow()
    col = MongoDB.get_collection("basket_plans")
    await col.update_one({"_id": plan["_id"]}, {"$set": updates})
    updated = await col.find_one({"_id": plan["_id"]})
    return {"success": True, "data": await _serialize_plan(updated)}


@router.delete("/plans/{plan_id}", response_model=dict)
async def delete_plan(plan_id: str, current_user: dict = Depends(get_current_user)):
    is_admin = current_user.get("role") == "admin"
    if is_admin:
        farmer_id = str(current_user["_id"])
    else:
        farmer_id = await _ensure_verified_farmer(current_user)
    plan = await _get_owned_plan(plan_id, farmer_id, is_admin=is_admin)
    col = MongoDB.get_collection("basket_plans")
    await col.update_one({"_id": plan["_id"]}, {"$set": {"deletedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}})
    return {"success": True, "message": "Basket plan deleted"}


@router.get("/plans/{plan_id}/subscribers", response_model=dict)
async def get_plan_subscribers(plan_id: str, current_user: dict = Depends(get_current_user)):
    farmer_id = await _ensure_verified_farmer(current_user)
    plan = await _get_owned_plan(plan_id, farmer_id)
    col = MongoDB.get_collection("basket_subscriptions")
    cursor = col.find({"planId": plan["_id"], "status": {"$ne": SubscriptionStatus.CANCELLED.value}}).sort("createdAt", -1)
    subs = await cursor.to_list(length=1000)
    users_col = MongoDB.get_collection("users")
    result = []
    for s in subs:
        user = await users_col.find_one({"_id": s.get("customerId")})
        result.append({
            "id": str(s["_id"]),
            "customerId": str(s.get("customerId")),
            "customerName": (user.get("name") if user else None) or (f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() if user else None) or "Customer",
            "status": s.get("status"),
            "weekNumber": s.get("weekNumber", 0),
            "nextDelivery": s.get("nextDelivery"),
            "createdAt": s.get("createdAt"),
        })
    return {"success": True, "data": {"subscribers": result, "total": len(result)}}


@router.post("/plans/{plan_id}/weekly-adjust", response_model=dict)
async def adjust_weekly_basket(plan_id: str, data: WeeklyAdjustRequest, current_user: dict = Depends(get_current_user)):
    farmer_id = await _ensure_verified_farmer(current_user)
    plan = await _get_owned_plan(plan_id, farmer_id)
    updates: Dict[str, Any] = {"updatedAt": datetime.utcnow()}
    if data.itemAdjustments is not None:
        updates["weeklyItemsOverride"] = [it.model_dump() for it in data.itemAdjustments]
    if data.priceAdjustment is not None:
        updates["weeklyPriceOverride"] = data.priceAdjustment
    col = MongoDB.get_collection("basket_plans")
    await col.update_one({"_id": plan["_id"]}, {"$set": updates})

    subs_col = MongoDB.get_collection("basket_subscriptions")
    cursor = subs_col.find({"planId": plan["_id"], "status": SubscriptionStatus.ACTIVE.value})
    subs = await cursor.to_list(length=1000)
    notified = 0
    for s in subs:
        try:
            await NotificationService.create_in_app_notification(
                str(s.get("customerId")),
                NotificationType.ORDER,
                f"Your basket was adjusted · {plan.get('name')}",
                data.note,
                {"planId": plan_id, "subscriptionId": str(s["_id"]), "isBasketOrder": True},
                NotificationPriority.HIGH,
            )
            notified += 1
        except Exception as e:
            logger.warning(f"Adjust notification failed for {s.get('_id')}: {e}")
    return {"success": True, "data": {"notified": notified, "note": data.note}}


# ---------------------------------------------------------------------------
# Customer: browse and subscribe
# ---------------------------------------------------------------------------
@router.get("/plans/available", response_model=dict)
async def list_available_plans(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: Optional[float] = Query(None, ge=1, le=500),
    cadence: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    col = MongoDB.get_collection("basket_plans")
    query: Dict[str, Any] = {"status": BasketPlanStatus.ACTIVE.value, "deletedAt": None}
    if cadence:
        query["cadence"] = cadence
    cursor = col.find(query).sort("createdAt", -1)
    plans = await cursor.to_list(length=500)
    result = []
    for p in plans:
        item = await _serialize_plan(p, [lat, lng] if lat is not None and lng is not None else None)
        if radius is not None and item.get("distanceKm") is not None and item["distanceKm"] > radius:
            continue
        result.append(item)
    if lat is not None and lng is not None:
        result.sort(key=lambda x: (x.get("distanceKm") if x.get("distanceKm") is not None else float("inf")))
    return {"success": True, "data": {"plans": result, "total": len(result)}}


@router.get("/plans/{plan_id}", response_model=dict)
async def get_plan(plan_id: str, current_user: dict = Depends(get_current_user)):
    try:
        obj_id = ObjectId(plan_id)
    except Exception:
        raise HTTPException(400, "Invalid basket plan id")
    col = MongoDB.get_collection("basket_plans")
    plan = await col.find_one({"_id": obj_id, "deletedAt": None})
    if not plan:
        raise HTTPException(404, "Basket plan not found")
    return {"success": True, "data": await _serialize_plan(plan)}


@router.get("/me", response_model=dict)
async def get_my_subscriptions(current_user: dict = Depends(get_current_user)):
    col = MongoDB.get_collection("basket_subscriptions")
    cursor = col.find({"customerId": ObjectId(str(current_user["_id"])), "deletedAt": None}).sort("createdAt", -1)
    subs = await cursor.to_list(length=500)
    result = []
    for s in subs:
        result.append({
            "id": str(s["_id"]),
            "planId": str(s.get("planId")),
            "customerId": str(s.get("customerId")),
            "customerName": s.get("customerName"),
            "planName": s.get("planName"),
            "cadence": s.get("cadence"),
            "day": s.get("day"),
            "price": s.get("price"),
            "items": s.get("items", []),
            "farmerId": str(s.get("farmerId")),
            "farmerName": s.get("farmerName"),
            "deliveryMode": s.get("deliveryMode"),
            "status": s.get("status"),
            "nextDelivery": s.get("nextDelivery"),
            "weekNumber": s.get("weekNumber", 0),
            "createdAt": s.get("createdAt"),
            "updatedAt": s.get("updatedAt"),
        })
    return {"success": True, "data": {"subscriptions": result, "total": len(result)}}


async def _get_subscription(sub_id: str, customer_id: str) -> Dict[str, Any]:
    try:
        obj_id = ObjectId(sub_id)
    except Exception:
        raise HTTPException(400, "Invalid subscription id")
    col = MongoDB.get_collection("basket_subscriptions")
    sub = await col.find_one({"_id": obj_id})
    if not sub:
        raise HTTPException(404, "Subscription not found")
    if str(sub.get("customerId")) != customer_id:
        raise HTTPException(403, "You do not own this subscription")
    return sub


@router.post("/", response_model=dict, status_code=201)
@router.post("", response_model=dict, status_code=201, include_in_schema=False)
async def subscribe(data: SubscriptionCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "customer":
        raise HTTPException(403, "Only customers can subscribe to farm baskets")
    try:
        plan_id = ObjectId(data.planId)
    except Exception:
        raise HTTPException(400, "Invalid basket plan id")
    plans_col = MongoDB.get_collection("basket_plans")
    plan = await plans_col.find_one({"_id": plan_id, "deletedAt": None})
    if not plan or plan.get("status") != BasketPlanStatus.ACTIVE.value:
        raise HTTPException(404, "Basket plan not found or not active")

    subs_col = MongoDB.get_collection("basket_subscriptions")
    existing = await subs_col.find_one(
        {"planId": plan_id, "customerId": ObjectId(str(current_user["_id"])), "deletedAt": None}
    )
    if existing:
        raise HTTPException(400, "You already have a subscription for this basket")

    subscribers = await _count_subscribers(plan_id)
    max_subs = plan.get("maxSubscribers", 50)
    if subscribers >= max_subs:
        raise HTTPException(400, "This basket has reached its maximum subscribers")

    customer_name = current_user.get("name")
    if not customer_name:
        customer_name = f"{current_user.get('firstName', '')} {current_user.get('lastName', '')}".strip() or "Customer"
    now = datetime.utcnow()
    sub = {
        "planId": plan_id,
        "customerId": ObjectId(str(current_user["_id"])),
        "customerName": customer_name,
        "planName": plan.get("name"),
        "cadence": plan.get("cadence", "weekly"),
        "day": plan.get("day", "Saturday"),
        "price": float(plan.get("price", 0)),
        "items": plan.get("items", []),
        "farmerId": plan.get("farmerId"),
        "farmerName": plan.get("farmerName") or "Farmer",
        "deliveryMode": plan.get("deliveryMode", "delivery"),
        "status": SubscriptionStatus.ACTIVE.value,
        "nextDelivery": _next_occurrence(Cadence(plan.get("cadence", "weekly")), plan.get("day", "Saturday")),
        "weekNumber": 0,
        "createdAt": now,
        "updatedAt": now,
    }
    result = await subs_col.insert_one(sub)
    return {
        "success": True,
        "data": {
            "id": str(result.inserted_id),
            "planId": str(plan_id),
            "customerId": str(current_user["_id"]),
            "customerName": customer_name,
            "planName": plan.get("name"),
            "cadence": sub.get("cadence"),
            "day": sub.get("day"),
            "price": sub.get("price"),
            "items": sub.get("items", []),
            "farmerId": str(plan.get("farmerId")),
            "farmerName": sub.get("farmerName"),
            "deliveryMode": sub.get("deliveryMode"),
            "status": sub.get("status"),
            "nextDelivery": sub.get("nextDelivery"),
            "weekNumber": sub.get("weekNumber", 0),
            "createdAt": now,
            "updatedAt": now,
        },
    }


@router.post("/{sub_id}/pause", response_model=dict)
async def pause_subscription(sub_id: str, current_user: dict = Depends(get_current_user)):
    sub = await _get_subscription(sub_id, str(current_user["_id"]))
    if sub.get("status") != SubscriptionStatus.ACTIVE.value:
        raise HTTPException(400, "Only active subscriptions can be paused")
    col = MongoDB.get_collection("basket_subscriptions")
    await col.update_one({"_id": sub["_id"]}, {"$set": {"status": SubscriptionStatus.PAUSED.value, "updatedAt": datetime.utcnow()}})
    return {"success": True, "message": "Basket paused"}


@router.post("/{sub_id}/resume", response_model=dict)
async def resume_subscription(sub_id: str, current_user: dict = Depends(get_current_user)):
    sub = await _get_subscription(sub_id, str(current_user["_id"]))
    if sub.get("status") != SubscriptionStatus.PAUSED.value:
        raise HTTPException(400, "Only paused subscriptions can be resumed")
    col = MongoDB.get_collection("basket_subscriptions")
    await col.update_one(
        {"_id": sub["_id"]},
        {"$set": {
            "status": SubscriptionStatus.ACTIVE.value,
            "nextDelivery": _next_occurrence(Cadence(sub.get("cadence", "weekly")), sub.get("day", "Saturday")),
            "updatedAt": datetime.utcnow(),
        }},
    )
    return {"success": True, "message": "Basket resumed"}


@router.post("/{sub_id}/cancel", response_model=dict)
async def cancel_subscription(sub_id: str, current_user: dict = Depends(get_current_user)):
    sub = await _get_subscription(sub_id, str(current_user["_id"]))
    if sub.get("status") == SubscriptionStatus.CANCELLED.value:
        raise HTTPException(400, "Subscription already cancelled")
    col = MongoDB.get_collection("basket_subscriptions")
    await col.update_one(
        {"_id": sub["_id"]},
        {"$set": {"status": SubscriptionStatus.CANCELLED.value, "deletedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}},
    )

    # Any already-generated future basket orders must be cancelled so the farmer
    # does not fulfil them. If the customer already paid for one (online
    # payment), a full refund is routed through the authoritative refund engine,
    # which also cancels the order on approval. Unpaid basket orders (COD /
    # pending) are cancelled directly.
    orders_col = MongoDB.get_collection("orders")
    cursor = orders_col.find({
        "subscriptionId": sub["_id"],
        "orderStatus": {"$nin": ["cancelled", "delivered", "picked_up"]},
        "deletedAt": None,
    })
    future_orders = await cursor.to_list(length=100)
    cancelled_orders = 0
    refunded_orders = 0
    for order in future_orders:
        order_id = str(order["_id"])
        if order.get("paymentStatus") == "paid":
            try:
                from app.schemas.refund import RefundRequestCreate, RefundType, RefundReason
                from app.services.refund_service import RefundService
                await RefundService.create_refund_request(
                    str(order["customerId"]),
                    order_id,
                    RefundRequestCreate(
                        refundType=RefundType.CANCELLATION,
                        reason=RefundReason.NO_LONGER_NEEDED,
                        resolution="full_refund",
                        description=f"Cancelled farm basket subscription {sub.get('planName', '')}",
                    ),
                    order=order,
                )
                refunded_orders += 1
                cancelled_orders += 1
            except Exception as e:
                logger.warning(f"Basket cancellation refund failed for order {order_id}: {e}")
        else:
            try:
                from app.schemas.order import OrderStatusUpdate
                from app.services.order_service import OrderService
                await OrderService.update_order_status(
                    order_id,
                    str(current_user["_id"]),
                    "customer",
                    OrderStatusUpdate(status="cancelled", note="Basket subscription cancelled"),
                )
                cancelled_orders += 1
            except Exception as e:
                logger.warning(f"Basket order cancellation failed for {order_id}: {e}")

    return {
        "success": True,
        "message": "Basket subscription cancelled",
        "data": {
            "cancelledOrders": cancelled_orders,
            "refundedOrders": refunded_orders,
            "nextBasket": "None (subscription cancelled)",
        },
    }


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------
@router.get("/plans", response_model=dict)
async def admin_list_plans(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_role("admin")),
):
    col = MongoDB.get_collection("basket_plans")
    query: Dict[str, Any] = {"deletedAt": None}
    if status:
        query["status"] = status
    total = await col.count_documents(query)
    cursor = col.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    plans = await cursor.to_list(length=limit)
    result = []
    for p in plans:
        result.append(await _serialize_plan(p))
    return {"success": True, "data": {"plans": result, "total": total, "page": page, "pages": (total + limit - 1) // limit}}


@router.post("/admin/generate-due", response_model=dict)
async def admin_generate_due(current_user: dict = Depends(require_role("admin"))):
    result = await generate_due_basket_orders()
    return {"success": True, "data": result}


@router.get("/admin/orders", response_model=dict)
async def admin_list_basket_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_role("admin")),
):
    col = MongoDB.get_collection("orders")
    query = {"isBasketOrder": True, "deletedAt": None}
    total = await col.count_documents(query)
    cursor = col.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    orders = await cursor.to_list(length=limit)
    result = []
    for o in orders:
        result.append({
            "id": str(o["_id"]),
            "orderNumber": o.get("orderNumber"),
            "customerId": str(o.get("customerId")),
            "farmerId": str(o.get("farmerId")),
            "totalAmount": o.get("totalAmount"),
            "orderStatus": o.get("orderStatus"),
            "paymentStatus": o.get("paymentStatus"),
            "deliveryType": o.get("deliveryType"),
            "deliveryDate": o.get("deliveryDate"),
            "createdAt": o.get("createdAt"),
        })
    return {"success": True, "data": {"orders": result, "total": total, "page": page, "pages": (total + limit - 1) // limit}}


async def basket_scheduler_loop():
    """Periodically generate due basket orders."""
    while True:
        try:
            await generate_due_basket_orders()
        except Exception as e:
            logger.warning(f"Basket order scheduler error: {e}")
        await asyncio.sleep(120)