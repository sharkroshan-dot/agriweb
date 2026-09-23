from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from typing import Optional
from datetime import datetime, timedelta
import asyncio

from pydantic import BaseModel, Field
from bson import ObjectId

from app.api.v1.auth import get_current_user
from app.services.analytics_service import AnalyticsService
from app.services.farmer_service import FarmerService
from app.services.order_service import OrderService
from app.services.product_service import ProductService
from app.repositories.order_repository import order_repository
from app.repositories.product_repository import product_repository
from app.repositories.inventory_repository import inventory_repository
from app.repositories.analytics_repository import _build_revenue_trend
from app.repositories.delivery_repository import delivery_repository
from app.repositories.delivery_assignment_repository import delivery_assignment_repository
from app.repositories.payment_repository import payment_repository
from app.repositories.payment_split_repository import payment_split_repository
from app.repositories.wallet_repository import wallet_repository, wallet_transaction_repository
from app.repositories.withdrawal_repository import withdrawal_repository
from app.services.user_service import UserService
from app.services.notification_service import NotificationService
from app.repositories.user_repository import user_repository
from app.schemas.order import OrderStatusUpdate, PaymentStatus, DeliveryType
from app.utils.delivery_map_events import delivery_map_event_broker
from app.services.delivery_job_service import (
    delivery_job_repository,
    build_job_document,
    serialize_job_for_farmer,
    eligible_partners_for_job,
    job_weight_kg,
    job_earnings,
    JOB_DEFAULT_EXPIRY_MINUTES,
)
from app.repositories.delivery_job_repository import (
    JOB_OPEN,
    JOB_ACCEPTED,
    JOB_DELIVERED,
    JOB_NO_PARTNER_FOUND,
)
from app.services.farmer_settings_service import farmer_settings_service
from app.ai.models.route_optimization import route_optimization_model
from collections import Counter
import math
import httpx
import logging

logger = logging.getLogger(__name__)

class UpdateFarmerProfileRequest(BaseModel):
    farmName: Optional[str] = None
    ownerName: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    weeklyPickupWindow: Optional[str] = None
    farmAddress: Optional[str] = None
    pickupInstructions: Optional[str] = None

router = APIRouter()


def _ensure_farmer(user: dict) -> None:
    if user.get("role") != "farmer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers can access this endpoint",
        )


@router.get("/me/dashboard")
async def get_my_dashboard(
    period: str = Query("week", description="today, week, month, year"),
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    now = datetime.utcnow()
    if period == "today":
        from_date = datetime(now.year, now.month, now.day)
        to_date = from_date + timedelta(days=1)
    elif period == "week":
        from_date = now - timedelta(days=7)
        to_date = now
    elif period == "month":
        from_date = now - timedelta(days=30)
        to_date = now
    elif period == "year":
        from_date = now - timedelta(days=365)
        to_date = now
    else:
        from_date = None
        to_date = None

    farmer_id = str(current_user["_id"])
    summary = await order_repository.get_order_summary(
        farmer_id=farmer_id,
        date_from=from_date,
        date_to=to_date,
    )

    today_revenue = summary.get("totalRevenue", 0)
    if period == "today":
        try:
            today_orders = await order_repository.find_many(
                {"farmerId": ObjectId(farmer_id), "deletedAt": None},
                limit=500
            )
            today_revenue = sum(
                o.get("totalAmount", 0) for o in today_orders
                if o.get("orderDate") and from_date <= o["orderDate"] < to_date
            )
        except Exception:
            today_revenue = summary.get("totalRevenue", 0)

    average_rating = 0.0
    rating_count = 0
    try:
        products = await product_repository.find_many({"farmerId": ObjectId(farmer_id), "deletedAt": None})
        rated = [p.get("ratings", {}) for p in products if (p.get("ratings") or {}).get("count", 0) > 0]
        if rated:
            rating_count = sum(r.get("count", 0) for r in rated)
            average_rating = round(sum(r.get("average", 0) for r in rated) / len(rated), 1)
    except Exception:
        pass

    stats = {
        "totalRevenue": {"value": today_revenue, "change": "+0%", "trend": "up"},
        "totalOrders": {"value": summary.get("totalOrders", 0), "change": "+0%", "trend": "up"},
        "productsSold": {"value": summary.get("deliveredOrders", 0), "change": "+0%", "trend": "up"},
        "averageRating": {"value": average_rating, "ratingCount": rating_count, "change": "+0%", "trend": "up"},
    }

    revenueTrend = []
    try:
        orders_trend = []
        if from_date and to_date:
            orders_trend = await order_repository.find_many({
                "farmerId": ObjectId(farmer_id),
                "orderDate": {"$gte": from_date, "$lte": to_date},
                "deletedAt": None
            })
        revenueTrend = _build_revenue_trend(orders_trend, from_date, to_date, period)
    except Exception:
        revenueTrend = []

    categoryDistribution = []
    try:
        products = await product_repository.find_many({"farmerId": ObjectId(farmer_id), "deletedAt": None})
        cat_counts = {}
        for p in products:
            cat = p.get("category", "Other")
            cat_counts[cat] = cat_counts.get(cat, 0) + 1
        total = sum(cat_counts.values()) or 1
        categoryDistribution = [{"name": c, "value": round(cnt / total * 100)} for c, cnt in cat_counts.items()]
    except Exception:
        categoryDistribution = []

    return {
        "stats": stats,
        "revenueTrend": revenueTrend,
        "categoryDistribution": categoryDistribution,
    }


@router.get("/me/earnings")
async def get_my_earnings(current_user: dict = Depends(get_current_user)):
    _ensure_farmer(current_user)
    user_id = str(current_user["_id"])

    wallet = await wallet_repository.get_by_user_id(user_id)
    available_balance = round(float(wallet.get("balance", 0)), 2) if wallet else 0.0

    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1, microsecond=0)

    transactions = await wallet_transaction_repository.get_by_user_id(user_id, limit=100)
    total_earnings = 0.0
    today_earnings = 0.0
    week_earnings = 0.0
    month_earnings = 0.0
    recent = []

    for txn in transactions:
        amt = float(txn.get("amount", 0))
        created_at = txn.get("createdAt")
        if txn.get("type") == "credit":
            total_earnings += amt
            if created_at:
                if created_at >= today:
                    today_earnings += amt
                if created_at >= week_start:
                    week_earnings += amt
                if created_at >= month_start:
                    month_earnings += amt
        recent.append({
            "amount": round(amt, 2),
            "type": txn.get("type"),
            "description": txn.get("description"),
            "createdAt": created_at,
        })
        if len(recent) >= 20:
            break

    pending_earnings = round(await payment_split_repository.get_farmer_pending(user_id), 2)
    total_withdrawn = round(await withdrawal_repository.get_pending_total(user_id), 2)

    from app.repositories.pickup_commission_repository import pickup_commission_repository
    outstanding_pickup_commission = round(
        await pickup_commission_repository.get_outstanding_total(user_id), 2
    )

    withdrawals = await withdrawal_repository.get_by_user_id(user_id, limit=20)
    withdrawal_list = []
    for w in withdrawals:
        withdrawal_list.append({
            "id": str(w["_id"]),
            "amount": round(float(w.get("amount", 0)), 2),
            "status": w.get("status"),
            "razorpayPayoutId": w.get("razorpayPayoutId"),
            "simulated": bool(w.get("simulated", False)),
            "bankAccount": w.get("bankAccount") or {},
            "createdAt": w.get("createdAt"),
        })

    return {
        "success": True,
        "data": {
            "totalEarnings": round(total_earnings, 2),
            "todayEarnings": round(today_earnings, 2),
            "weekEarnings": round(week_earnings, 2),
            "monthEarnings": round(month_earnings, 2),
            "pendingEarnings": pending_earnings,
            "availableBalance": available_balance,
            "totalWithdrawn": total_withdrawn,
            "outstandingPickupCommission": outstanding_pickup_commission,
            "recentTransactions": recent,
            "withdrawals": withdrawal_list,
        }
    }


@router.get("/me/orders")
async def get_my_orders(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    skip = (page - 1) * limit
    orders = await order_repository.get_by_farmer(str(current_user["_id"]), skip, limit, status)
    total = await order_repository.count({"farmerId": current_user["_id"], "deletedAt": None})

    for order in orders:
        order["id"] = str(order["_id"])
        order["_id"] = str(order["_id"])
        if order.get("deliveryPartnerId"):
            try:
                partner = await delivery_repository.get_by_id(str(order["deliveryPartnerId"]))
                if partner:
                    user = await UserService.get_user_by_id(str(partner.get("userId")))
                    if user:
                        order["deliveryPartnerName"] = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
            except Exception:
                pass

    return {
        "success": True,
        "data": {
            "orders": orders,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit,
            },
        },
    }


@router.get("/me/top-products")
async def get_my_top_products(
    limit: int = Query(10, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    products = await product_repository.get_by_farmer(
        str(current_user["_id"]), 0, limit,
        include_inactive=True, include_basket_only=True
    )
    for product in products:
        product["id"] = str(product["_id"])
        product["_id"] = str(product["_id"])

    return {
        "success": True,
        "data": {
            "products": products,
        },
    }


@router.get("/me/products")
async def get_my_products(
    search: Optional[str] = None,
    status: Optional[str] = None,
    include_basket_only: bool = Query(False, alias="includeBasketOnly"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    skip = (page - 1) * limit
    products, total = await ProductService.get_farmer_products(
        str(current_user["_id"]), skip, limit, include_inactive=True, include_basket_only=include_basket_only
    )

    if search:
        search_lower = search.lower()
        products = [
            product
            for product in products
            if search_lower in str(product.get("name", "")).lower()
            or search_lower in str(product.get("category", "")).lower()
        ]

    # Build stock map for out-of-stock detection
    inventory_list = await inventory_repository.get_by_farmer(str(current_user["_id"]))
    stock_map = {
        str(inv["product_id"]): {
            "total": inv.get("total_stock", 0) or 0,
            "reserved": inv.get("reserved_stock", 0) or 0,
            "sold": inv.get("sold_stock", 0) or 0,
        }
        for inv in inventory_list
    }

    # Count orders placed per product (exact, one aggregation)
    order_counts = {}
    product_oids = [ObjectId(str(p["_id"])) for p in products]
    if product_oids:
        pipeline = [
            {"$match": {"items.productId": {"$in": product_oids}}},
            {"$unwind": "$items"},
            {"$match": {"items.productId": {"$in": product_oids}}},
            {"$group": {"_id": "$items.productId", "count": {"$sum": 1}}},
        ]
        for row in await order_repository.aggregate(pipeline):
            order_counts[str(row["_id"])] = row["count"]

    def effective_status(product: dict) -> str:
        stock = stock_map.get(str(product["_id"]))
        if stock is not None:
            available = stock["total"] - stock["reserved"] - stock["sold"]
        else:
            available = product.get("quantity", 0) or 0
        if available <= 0:
            return "out_of_stock"
        if not product.get("isActive", True):
            return "inactive"
        return product.get("status") or ("active" if product.get("isActive", True) else "inactive")

    if status and status != "all":
        products = [product for product in products if effective_status(product) == status]

    for p in products:
        p["id"] = str(p["_id"])
        p["_id"] = str(p["_id"])
        p["status"] = effective_status(p)
        p["orders"] = order_counts.get(str(p["id"]), 0)
        for k in ("farmerId", "categoryId", "subCategoryId"):
            if k in p and p[k] is not None:
                p[k] = str(p[k])

    return {
        "success": True,
        "data": {
            "products": products,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit,
            },
        },
    }


@router.get("/me/customers")
async def get_my_customers(
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    orders = await order_repository.get_by_farmer(farmer_id, 0, 1000)
    customer_map = {}
    for order in orders:
        cid = str(order["customerId"])
        if cid not in customer_map:
            customer_map[cid] = {
                "customerId": cid,
                "orderCount": 0,
                "totalSpent": 0,
                "lastOrderDate": None,
            }
        customer_map[cid]["orderCount"] += 1
        customer_map[cid]["totalSpent"] += order.get("totalAmount", 0)
        od = order.get("orderDate")
        if od and (not customer_map[cid]["lastOrderDate"] or od > customer_map[cid]["lastOrderDate"]):
            customer_map[cid]["lastOrderDate"] = od

    customers = []
    for cid, info in customer_map.items():
        user = await UserService.get_user_by_id(cid)
        if user:
            info["name"] = user.get("name", "Unknown")
            info["email"] = user.get("email", "")
            info["phone"] = user.get("phone", "")
            customers.append(info)

    customers.sort(key=lambda c: c["orderCount"], reverse=True)
    return {"success": True, "data": {"customers": customers}}


@router.get("/me/reviews")
async def get_my_reviews(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Return every customer rating across all of the farmer's products.

    Includes a per-product rating summary and the full list of individual
    customer reviews (product, customer, rating, comment, date).
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])

    products = await product_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "deletedAt": None},
        limit=10000,
    )

    empty_response = {
        "success": True,
        "data": {
            "products": [],
            "reviews": [],
            "summary": {"totalReviews": 0, "averageRating": 0.0},
            "pagination": {"page": page, "limit": limit, "total": 0, "totalPages": 0},
        },
    }
    if not products:
        return empty_response

    from app.repositories.product_review_repository import product_review_repository

    product_ids = [str(p["_id"]) for p in products]
    name_map = {str(p["_id"]): p.get("name", "Product") for p in products}

    skip = (page - 1) * limit
    total = await product_review_repository.count_by_products(product_ids)
    reviews = await product_review_repository.get_by_products(product_ids, skip, limit)

    result = []
    for r in reviews:
        user = await UserService.get_user_by_id(str(r.get("userId", "")))
        customer_name = "Customer"
        if user:
            customer_name = (
                user.get("name")
                or f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                or "Customer"
            )
        result.append({
            "id": str(r["_id"]),
            "productId": str(r.get("productId", "")),
            "productName": name_map.get(str(r.get("productId", "")), "Product"),
            "customerName": customer_name,
            "rating": r.get("rating", 0),
            "comment": r.get("comment", ""),
            "isVerifiedPurchase": r.get("isVerifiedPurchase", False),
            "createdAt": r.get("createdAt"),
        })

    rated_products = [
        {
            "productId": str(p["_id"]),
            "productName": p.get("name", "Product"),
            "average": (p.get("ratings") or {}).get("average", 0),
            "count": (p.get("ratings") or {}).get("count", 0),
        }
        for p in products
        if (p.get("ratings") or {}).get("count", 0) > 0
    ]
    rated_products.sort(key=lambda x: x["average"], reverse=True)

    total_reviews = sum(rp["count"] for rp in rated_products)
    average_rating = (
        round(sum(rp["average"] * rp["count"] for rp in rated_products) / total_reviews, 1)
        if total_reviews
        else 0.0
    )

    return {
        "success": True,
        "data": {
            "products": rated_products,
            "reviews": result,
            "summary": {"totalReviews": total_reviews, "averageRating": average_rating},
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit,
            },
        },
    }


@router.get("/me/profile")
async def get_my_profile(
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    profile = await FarmerService.get_farmer_profile(str(current_user["_id"]))
    if not profile:
        raise HTTPException(status_code=404, detail="Farmer profile not found")

    products = await product_repository.find_many(
        {"farmerId": ObjectId(profile["_id"]), "deletedAt": None},
        limit=10000
    )
    rated = [p.get("ratings", {}) for p in products if (p.get("ratings") or {}).get("count", 0) > 0]
    if rated:
        profile["rating"] = round(sum(r.get("average", 0) for r in rated) / len(rated), 1)
        profile["ratingCount"] = sum(r.get("count", 0) for r in rated)
    else:
        profile["rating"] = 0.0
        profile["ratingCount"] = 0

    profile["id"] = str(profile["_id"])
    del profile["_id"]
    return {"success": True, "data": profile}


@router.put("/me/profile")
async def update_my_profile(
    body: UpdateFarmerProfileRequest,
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = await FarmerService.update_farmer_profile(str(current_user["_id"]), data)
    if not updated:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
    return {"success": True, "message": "Profile updated"}


@router.get("/me/analytics")
async def get_my_analytics(
    range: str = Query("30d"),
    period: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    _ensure_farmer(current_user)
    now = datetime.utcnow()
    selected = period or range
    if selected in ("7d", "week"):
        from_date = now - timedelta(days=7)
    elif selected in ("90d",):
        from_date = now - timedelta(days=90)
    elif selected in ("year", "12m", "365d"):
        from_date = now - timedelta(days=365)
    elif selected in ("month", "30d"):
        from_date = now - timedelta(days=30)
    else:
        from_date = now - timedelta(days=30)

    report = await AnalyticsService.get_farmer_analytics(
        str(current_user["_id"]),
        from_date,
        now,
    )
    return {
        "success": True,
        "data": report,
    }


@router.get("/me/advisor")
async def get_my_advisor(
    period: Optional[str] = Query("30d"),
    current_user: dict = Depends(get_current_user),
):
    """AI Farm Advisor - a decision dashboard built from the farmer's real data."""
    _ensure_farmer(current_user)
    if not await farmer_settings_service.ai_enabled(str(current_user["_id"]), "smartRecommendations"):
        raise HTTPException(
            status_code=403,
            detail="Smart recommendations are disabled in your settings. Enable them under AI & analytics.",
        )
    from app.services.advisor_service import build_advisor
    report = await build_advisor(current_user, period or "30d")
    return {"success": True, "data": report}


_CALENDAR_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_CALENDAR_SLOT_ORDER = {"Morning": 0, "Mid-day": 1, "Afternoon": 2}


@router.get("/me/delivery-calendar")
async def get_delivery_calendar(current_user: dict = Depends(get_current_user)):
    """Get farmer's delivery calendar with weekly slots.

    Slots are aggregated by (delivery day, time slot) so the calendar can
    show the number of deliveries per cell plus the list of orders in it.
    Partner-handled orders are included and flagged so each cell can show a
    self/partner split, estimated workload and an overload warning when the
    farmer's own share exceeds their delivery capacity for one run.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    capacity = await _get_delivery_capacity(farmer_id)
    active_statuses = ["pending", "confirmed", "processing", "ready_for_delivery", "ready_for_pickup"]
    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": active_statuses}, "deletedAt": None}
    )
    orders = orders or []
    farm = await _get_farm_origin(farmer_id)

    groups: dict[tuple[str, str], list] = {}
    total_distance = 0.0
    total_revenue = 0.0
    self_total = 0
    partner_total = 0
    for order in orders:
        oid = str(order["_id"])
        is_partnered = bool(order.get("deliveryPartnerId"))
        day = order.get("deliveryDay") or order.get("createdAt", datetime.utcnow()).strftime("%A")
        time_slot = order.get("deliveryTimeSlot") or "Morning"
        addr = order.get("deliveryAddress", {}) or {}
        dist = 0.0
        if order.get("deliveryType", "delivery") != DeliveryType.PICKUP.value and farm.get("lat") is not None:
            lat, lng = await _stop_coords(addr, oid)
            if lat is not None:
                dist = _haversine_km(farm["lat"], farm["lng"], lat, lng)
        total_distance += dist
        total_revenue += float(order.get("totalAmount", 0) or 0)
        if is_partnered:
            partner_total += 1
        else:
            self_total += 1
        if day in _CALENDAR_DAYS:
            delivery = {
                "id": oid,
                "orderId": oid,
                "customerName": order.get("customerName", "Customer"),
                "address": addr.get("address") or addr.get("addressLine1") or "Pickup at farm",
                "items": len(order.get("items", []) or []),
                "total": float(order.get("totalAmount", 0) or 0),
                "status": order.get("orderStatus", "pending"),
                "distance": round(dist, 2),
                "deliveryType": order.get("deliveryType", "delivery"),
                "assignment": "partner" if is_partnered else "self",
                "isCOD": str(order.get("paymentMethod", "") or "").lower() == "cash",
            }
            groups.setdefault((day, time_slot), []).append(delivery)

    slots = []
    for (day, time_slot), items in groups.items():
        cell_distance = round(sum(float(d["distance"] or 0) for d in items), 2)
        cell_self = sum(1 for d in items if d["assignment"] == "self")
        cell_partner = len(items) - cell_self
        cell_minutes = round(cell_distance / 25 * 60 + max(0, cell_self - 1) * 10 + cell_partner * 5)
        slots.append({
            "day": day,
            "timeSlot": time_slot,
            "count": len(items),
            "selfCount": cell_self,
            "partnerCount": cell_partner,
            "distanceKm": cell_distance,
            "estimatedMinutes": cell_minutes,
            "income": round(sum(float(d.get("total") or 0) for d in items), 2),
            # A slot is overloaded when the farmer's own share alone exceeds
            # the orders they can handle in one delivery run.
            "overloaded": cell_self > int(capacity.get("maxOrders") or 20),
            "deliveries": items,
        })
    slots.sort(key=lambda s: (_CALENDAR_DAYS.index(s["day"]) if s["day"] in _CALENDAR_DAYS else 99, _CALENDAR_SLOT_ORDER.get(s["timeSlot"], 99)))

    fuel_cost_per_km = float(capacity.get("fuelCostPerKm") or 4.5)
    fuel_cost = round(total_distance * fuel_cost_per_km, 2)
    est_time_min = round(total_distance / 25 * 60 + len(orders) * 10, 0)
    hours = int(est_time_min // 60)
    minutes = int(est_time_min % 60)
    estimated_time = f"{hours} hrs {minutes} min" if hours else f"{minutes} min"
    summary = {
        "totalDeliveries": len(orders),
        "selfDeliveries": self_total,
        "partnerDeliveries": partner_total,
        "pendingPickups": sum(1 for o in orders if o.get("orderStatus") == "ready_for_pickup"),
        "pendingDeliveries": sum(1 for o in orders if o.get("orderStatus") == "ready_for_delivery"),
        "confirmed": sum(1 for o in orders if o.get("orderStatus") == "confirmed"),
        "totalDistance": f"{round(total_distance, 2)} km",
        "fuelCost": fuel_cost,
        "expectedIncome": round(total_revenue, 2),
        "estimatedTime": estimated_time,
    }
    return {"slots": slots, "summary": summary, "capacity": capacity}


@router.get("/me/smart-route")
async def get_smart_route(current_user: dict = Depends(get_current_user)):
    """Get farmer's AI-optimized route with cost & savings analysis."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    origin = await _get_farm_origin(farmer_id)
    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": _ACTIVE_DELIVERY_STATUSES}, "deletedAt": None}
    )
    orders = orders or []

    raw_stops = []
    for order in orders:
        if order.get("deliveryPartnerId") or order.get("partnerRequested"):
            continue
        oid = str(order["_id"])
        addr = order.get("deliveryAddress", {}) or {}
        order_items = order.get("items", []) or []
        lat, lng = await _stop_coords(addr, oid)
        raw_stops.append({
            "orderId": oid,
            "orderNumber": order.get("orderNumber", ""),
            "customerName": order.get("customerName", "Customer"),
            "address": addr.get("address") or addr.get("addressLine1") or "Pickup at farm",
            "city": addr.get("city", ""),
            "lat": lat,
            "lng": lng,
            "deliveryType": order.get("deliveryType", "delivery"),
            "timeSlot": order.get("deliveryTimeSlot", "Morning"),
            "status": order.get("orderStatus", "ready_for_delivery"),
            "items": [{"name": i.get("productName", i.get("name", "Item")), "quantity": i.get("quantity", 1)} for i in order_items],
            "total": float(order.get("totalAmount", 0) or 0),
            "deliveryCharge": float(order.get("deliveryCharge", 0) or 0),
            "deliveryWindow": f"{order.get('deliveryTimeSlot', 'Morning')} ({order.get('deliveryDay', 'Today')})"
        })

    # Compare naive (as recorded) ordering vs optimized ordering
    naive_distance = _route_total_distance(origin, raw_stops)
    optimized_stops, algorithm_label = _optimize_stops_ai(origin, raw_stops)
    _assign_stop_distances(origin, optimized_stops)
    optimized_distance = _route_total_distance(origin, optimized_stops)

    capacity = await _get_delivery_capacity(farmer_id)
    fuel_cost_per_km = float(capacity.get("fuelCostPerKm") or 4.5)
    total_distance = optimized_distance
    fuel_cost = round(total_distance * fuel_cost_per_km, 2)
    expected_income = round(sum(s["total"] for s in optimized_stops), 2)
    est_time_min = round(total_distance / 25 * 60 + len(optimized_stops) * 10, 0)
    savings_distance = round(max(0.0, naive_distance - optimized_distance), 2)
    savings = {
        "distance": savings_distance,
        "time": round(savings_distance / 25 * 60, 0),
        "fuel": round(savings_distance * fuel_cost_per_km, 2),
    }

    # Self-delivery vs handing every stop to a delivery partner: partner cost
    # uses the same earnings model as marketplace jobs (delivery charge when
    # present, otherwise distance-based estimate).
    partner_handoff_cost = round(
        sum(job_earnings({"deliveryCharge": s.get("deliveryCharge", 0)}, s.get("distance") or 0) for s in optimized_stops),
        2,
    )
    self_net = round(expected_income - fuel_cost, 2)
    partner_net = round(expected_income - partner_handoff_cost, 2)
    if not optimized_stops:
        recommendation = "No active orders to deliver yet."
    elif self_net >= partner_net:
        recommendation = "Self-delivery earns more on this route."
    else:
        recommendation = f"Handing off to partners may earn ₹{round(partner_net - self_net, 2)} more than driving yourself."

    summary = {
        "totalStops": len(optimized_stops),
        "totalOrders": len(optimized_stops),
        "totalDistance": round(total_distance, 2),
        "naiveDistance": round(naive_distance, 2),
        "estimatedTime": est_time_min,
        "fuelCost": fuel_cost,
        "expectedIncome": expected_income,
        "netIncome": round(expected_income - fuel_cost, 2),
        "customersCount": len(set(s["customerName"] for s in optimized_stops)),
        "savings": savings,
        "profitability": {
            "revenue": expected_income,
            "fuelCost": fuel_cost,
            "selfNet": self_net,
            "partnerFeeEstimate": partner_handoff_cost,
            "partnerNet": partner_net,
            "advantage": round(self_net - partner_net, 2),
            "recommendation": recommendation,
        },
        "algorithm": algorithm_label,
    }
    return {"summary": summary, "stops": optimized_stops, "origin": origin}


class DeliverySlotUpdateRequest(BaseModel):
    day: str
    timeSlot: str


@router.put("/me/orders/{order_id}/delivery-slot")
async def update_order_delivery_slot(
    order_id: str,
    body: DeliverySlotUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Assign a delivery day + time slot to one of the farmer's active orders.

    The calendar endpoint groups orders by these fields, so updating them
    reschedules the order on the farmer's delivery calendar.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    day = body.day.strip()
    time_slot = body.timeSlot.strip()
    if day not in _CALENDAR_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"day must be one of {', '.join(_CALENDAR_DAYS)}",
        )
    if time_slot not in _CALENDAR_SLOT_ORDER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"timeSlot must be one of {', '.join(_CALENDAR_SLOT_ORDER)}",
        )

    ok = await order_repository.update_order_field(order_id, "deliveryDay", day)
    ok = await order_repository.update_order_field(order_id, "deliveryTimeSlot", time_slot) and ok
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update delivery slot")
    return {"success": True, "message": "Delivery slot updated"}


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two coordinates in km."""
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


_GEOCODE_REJECT_TYPES = {"state", "country", "province", "region"}


async def _geocode(address: str):
    """Best-effort geocoding.

    Tries Photon (more lenient rate limits, exposes result admin level) then
    Nominatim. State/country-level matches are skipped so we don't collapse an
    address to a region centroid. Returns (lat, lng) or None.
    """
    if not address:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://photon.komoot.io/api/",
                params={"q": address, "limit": 1},
                headers={"User-Agent": "AgriConnect/1.0"},
            )
            resp.raise_for_status()
            features = resp.json().get("features") or []
            if features:
                props = features[0].get("properties", {}) or {}
                if props.get("type") not in _GEOCODE_REJECT_TYPES:
                    coords = features[0].get("geometry", {}).get("coordinates")
                    if coords:
                        return coords[1], coords[0]
    except Exception as e:
        logger.warning(f"Geocoding (photon) failed for '{address[:60]}': {e}")
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": address, "format": "json", "limit": 1},
                headers={"User-Agent": "AgriConnect/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data:
                return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception as e:
        logger.warning(f"Geocoding (nominatim) failed for '{address[:60]}': {e}")
    return None


async def _get_farm_origin(farmer_id: str) -> dict:
    """Resolve the farmer's farm location (profile -> user doc -> geocode -> defaults)."""
    farm = {"name": "My Farm", "lat": None, "lng": None, "address": ""}
    try:
        profile = await FarmerService.get_farmer_profile(farmer_id)
    except Exception:
        profile = None
    if profile:
        farm["name"] = profile.get("farmName") or profile.get("ownerName") or "My Farm"
        farm["address"] = profile.get("farmAddress") or ""
        loc = profile.get("farmLocation") or profile.get("location")
        if loc and loc.get("coordinates"):
            farm["lng"], farm["lat"] = loc["coordinates"][0], loc["coordinates"][1]
    # Fall back to the user document: many farmers never created a profile row.
    if farm["lat"] is None:
        try:
            user = await UserService.get_user_by_id(farmer_id)
            if user:
                if farm["name"] == "My Farm":
                    farm["name"] = user.get("name") or user.get("firstName") or "My Farm"
                farm["address"] = (
                    farm["address"]
                    or user.get("farmAddress")
                    or user.get("address")
                    or user.get("city")
                    or ""
                )
                loc = user.get("farmLocation") or user.get("location")
                if loc and loc.get("coordinates"):
                    farm["lng"], farm["lat"] = loc["coordinates"][0], loc["coordinates"][1]
        except Exception:
            pass
    if farm["lat"] is None and farm["address"]:
        coords = await _geocode(farm["address"])
        if coords:
            farm["lat"], farm["lng"] = coords
    return farm


def _route_total_distance(origin: dict, stops: list) -> float:
    """Round-trip distance (km) visiting stops in the given order."""
    total = 0.0
    prev_lat, prev_lng = origin.get("lat"), origin.get("lng")
    for s in stops:
        if prev_lat is None or s.get("lat") is None:
            prev_lat, prev_lng = s.get("lat"), s.get("lng")
            continue
        total += _haversine_km(prev_lat, prev_lng, s["lat"], s["lng"])
        prev_lat, prev_lng = s["lat"], s["lng"]
    if prev_lat is not None and origin.get("lat") is not None:
        total += _haversine_km(prev_lat, prev_lng, origin["lat"], origin["lng"])
    return total


def _optimize_stops(origin: dict, stops: list) -> list:
    """Nearest-neighbour ordering of stops starting from the farm."""
    remaining = [dict(s) for s in stops]
    ordered = []
    cur_lat, cur_lng = origin.get("lat"), origin.get("lng")
    while remaining:
        best_i, best_d = 0, float("inf")
        for i, s in enumerate(remaining):
            if cur_lat is None or s.get("lat") is None:
                d = 0.0
            else:
                d = _haversine_km(cur_lat, cur_lng, s["lat"], s["lng"])
            if d < best_d:
                best_d, best_i = d, i
        stop = remaining.pop(best_i)
        ordered.append(stop)
        cur_lat, cur_lng = stop.get("lat"), stop.get("lng")
    return ordered


_SMART_ROUTE_ALGORITHM_LABELS = {
    "nearest_neighbor_2opt": "AI route optimization (nearest-neighbour + 2-opt) from farm location",
    "simple": "Nearest-neighbour ordering from farm location",
}


def _optimize_stops_ai(origin: dict, stops: list) -> tuple[list, str]:
    """Order stops with the AI model (nearest-neighbour + 2-opt).

    Only stops with known coordinates can be fed to the distance matrix;
    unlocated stops keep their relative order at the end of the sequence.
    Falls back to plain nearest-neighbour when the model can't be used.
    Returns (ordered_stops, algorithm_label).
    """
    fallback_label = _SMART_ROUTE_ALGORITHM_LABELS["simple"]
    located = [s for s in stops if s.get("lat") is not None and s.get("lng") is not None]
    unlocated = [s for s in stops if not (s.get("lat") is not None and s.get("lng") is not None)]
    origin_lat, origin_lng = origin.get("lat"), origin.get("lng")

    if origin_lat is None or len(located) < 2:
        return _optimize_stops(origin, stops), fallback_label

    by_order_id = {s["orderId"]: s for s in located}
    try:
        result = route_optimization_model.optimize(
            start_location={"coordinates": [origin_lng, origin_lat]},
            destinations=[
                {"orderId": s["orderId"], "location": {"coordinates": [s["lng"], s["lat"]]}}
                for s in located
            ],
        )
        ordered_ids = [w["orderId"] for w in result.get("optimized_route", [])]
        ordered = [by_order_id[oid] for oid in ordered_ids if oid in by_order_id]
        # Keep any located stop the model dropped (defensive) in naive order.
        ordered += [s for s in located if s["orderId"] not in set(ordered_ids)]
        label = _SMART_ROUTE_ALGORITHM_LABELS.get(result.get("algorithm"), fallback_label)
        return ordered + unlocated, label
    except Exception as e:
        logger.warning(f"AI smart-route optimization failed, falling back to nearest-neighbour: {e}")
        return _optimize_stops(origin, stops), fallback_label


def _assign_stop_distances(origin: dict, stops: list) -> None:
    """Fill each stop's `distance` with the leg distance from the previous stop."""
    prev_lat, prev_lng = origin.get("lat"), origin.get("lng")
    for s in stops:
        if prev_lat is not None and s.get("lat") is not None:
            s["distance"] = round(_haversine_km(prev_lat, prev_lng, s["lat"], s["lng"]), 2)
        else:
            s["distance"] = 0
        prev_lat, prev_lng = s.get("lat"), s.get("lng")


def _strip_pin(part: str) -> str:
    q = part.rstrip("0123456789")
    q = q.rstrip("-– ").strip()
    return q


_GEOCODE_STATE_ONLY = {
    "tamilnadu", "tamil nadu", "tamil", "andhra pradesh", "andhrapradesh", "telangana",
    "kerala", "karnataka", "maharashtra", "delhi", "puducherry", "pondicherry",
    "gujarat", "rajasthan", "uttar pradesh", "west bengal", "odisha", "orissa", "bihar",
    "madhya pradesh", "haryana", "punjab", "chhattisgarh", "assam", "jharkhand", "goa",
    "himachal pradesh", "uttarakhand", "tripura", "manipur", "meghalaya", "nagaland",
    "mizoram", "sikkim", "arunachal pradesh", "india",
}


def _looks_like_place(part: str) -> bool:
    """A geocodable part: not a bare state/country, not a house number, long enough."""
    cleaned = _strip_pin(part)
    if not cleaned:
        return False
    if cleaned[0].isdigit():
        return False
    if len(cleaned) < 3:
        return False
    return cleaned.lower() not in _GEOCODE_STATE_ONLY


def _address_suffixes(address: str) -> list:
    """Progressively shorter address candidates for geocoder retries.

    Nominatim often fails on long Indian addresses, so we retry with shorter
    suffixes (keeping at least two parts), then individual place-like parts.
    Bare state/country names are skipped so geocoding does not collapse to a
    state-level centroid.
    """
    parts = [p.strip() for p in address.split(",") if p.strip()]
    candidates = [address.strip()] if address.strip() else []
    for i in range(len(parts)):
        if len(parts) - i >= 2:
            candidates.append(", ".join(parts[i:]))
    for p in parts:
        if _looks_like_place(p):
            candidates.append(p)
            cleaned = _strip_pin(p)
            if cleaned and cleaned != p:
                candidates.append(cleaned)
    seen, result = set(), []
    for c in candidates:
        c = c.strip()
        key = c.lower()
        if c and key not in seen:
            seen.add(key)
            result.append(c)
    return result


async def _geocode_cached(address: str):
    """Geocode with a persistent DB cache (``geocode_cache``) keyed by address.

    This keeps the map fast (no Nominatim call per request) while letting us
    replace fake/seed coordinates with the real location of the address.
    Long addresses are retried with progressively shorter suffixes.
    """
    if not address:
        return None
    try:
        col = MongoDB.get_collection("geocode_cache")
    except Exception:
        return None
    for candidate in _address_suffixes(address):
        key = " ".join(candidate.lower().split())
        if not key:
            continue
        try:
            cached = await col.find_one({"_id": key})
            if cached and cached.get("lat") is not None:
                return cached["lat"], cached["lng"]
        except Exception:
            return None
        coords = await _geocode(candidate)
        if not coords or not _looks_like_place(candidate):
            continue
        try:
            await col.update_one(
                {"_id": key},
                {"$set": {"lat": coords[0], "lng": coords[1], "updatedAt": datetime.utcnow()}},
                upsert=True,
            )
            full_key = " ".join(address.lower().split())
            if full_key and full_key != key:
                await col.update_one(
                    {"_id": full_key},
                    {"$set": {"lat": coords[0], "lng": coords[1], "updatedAt": datetime.utcnow()}},
                    upsert=True,
                )
        except Exception:
            pass
        return coords
    return None


async def _stop_coords(addr: dict, order_id: Optional[str] = None, refresh: bool = False):
    """Resolve stop coordinates (lat, lng).

    Prefers the stored GeoJSON location. When ``refresh`` is set, the stored
    location is re-checked against the geocoder so fake/seed coordinates get
    replaced with the real position of the delivery address. Geocoded results
    are cached in ``geocode_cache``. Returns (lat, lng) or (None, None).
    """
    loc = addr.get("location") or {}
    if loc.get("coordinates") and not refresh:
        return loc["coordinates"][1], loc["coordinates"][0]
    parts = []
    for k in ("addressLine1", "addressLine2", "address", "city", "state"):
        if addr.get(k):
            parts.append(str(addr[k]))
    query = ", ".join(parts)
    if not query:
        if loc.get("coordinates"):
            return loc["coordinates"][1], loc["coordinates"][0]
        return None, None
    coords = await _geocode_cached(query)
    if not coords:
        if loc.get("coordinates"):
            return loc["coordinates"][1], loc["coordinates"][0]
        return None, None
    lat, lng = coords
    if order_id:
        try:
            existing = loc.get("coordinates")
            stale = not existing or _haversine_km(lat, lng, existing[1], existing[0]) > 2
            if stale:
                await order_repository.update_order_field(
                    order_id,
                    "deliveryAddress.location",
                    {"type": "Point", "coordinates": [lng, lat]},
                )
        except Exception:
            pass
    return lat, lng


class RouteStopUpdateRequest(BaseModel):
    status: str = "delivered"
    note: Optional[str] = None


_ACTIVE_DELIVERY_STATUSES = [
    "pending",
    "confirmed",
    "processing",
    "ready_for_delivery",
    "ready_for_pickup",
    "dispatched",
    "in_transit",
]
_FINISHED_DELIVERY_STATUSES = ("delivered", "picked_up", "cancelled", "refunded", "failed")
_ROUTE_COMPLETABLE_STATUSES = ("ready_for_delivery", "ready_for_pickup")
_DELIVERED_WINDOWS = ("today", "week", "month", "year", "all")


def _delivered_window_start(window: str, now: datetime) -> Optional[datetime]:
    """Start of the delivered-history window, or None when 'all'."""
    if window == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if window == "week":
        return now - timedelta(days=7)
    if window == "month":
        return now - timedelta(days=30)
    if window == "year":
        return now - timedelta(days=365)
    return None


@router.get("/me/deliveries")
async def get_my_deliveries(current_user: dict = Depends(get_current_user)):
    """All of the farmer's active self-delivery orders (any status).

    A single feed used by the Route, Order Map and Smart Route pages so every
    page shows the same set of deliveries the farmer plans to handle himself.
    Orders already handed to a delivery partner are excluded.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": _ACTIVE_DELIVERY_STATUSES}, "deletedAt": None}
    )
    orders = orders or []
    farm = await _get_farm_origin(farmer_id)

    deliveries = []
    total_distance = 0.0
    total_quantity = 0
    total_revenue = 0.0
    cod_collection = 0.0
    online_orders = 0.0
    for order in orders:
        # Handed off to a partner -> partner queue, not self-delivery.
        if order.get("deliveryPartnerId") or order.get("partnerRequested"):
            continue
        oid = str(order["_id"])
        delivery_type = order.get("deliveryType", "delivery")
        addr = order.get("deliveryAddress", {}) or {}
        items = order.get("items", []) or []
        qty = sum(int(i.get("quantity", 0) or 0) for i in items)
        first = items[0] if items else {}
        product = first.get("productName") or first.get("name") or "Items"

        lat = lng = None
        if delivery_type == DeliveryType.PICKUP.value:
            lat, lng = farm["lat"], farm["lng"]
        else:
            lat, lng = await _stop_coords(addr, oid)

        dist = 0.0
        if delivery_type != DeliveryType.PICKUP.value and farm["lat"] is not None and lat is not None:
            dist = _haversine_km(farm["lat"], farm["lng"], lat, lng)

        status = order.get("orderStatus", "pending")
        total = float(order.get("totalAmount", 0) or 0)
        payment_method = str(order.get("paymentMethod", "") or "").lower()
        is_cod = payment_method == "cash"
        time_slot = order.get("deliveryTimeSlot") or "Morning"

        total_distance += dist
        total_quantity += qty
        total_revenue += total
        if is_cod:
            cod_collection += total
        else:
            online_orders += total

        deliveries.append({
            "id": oid,
            "orderId": oid,
            "orderNumber": order.get("orderNumber", ""),
            "buyerName": order.get("customerName") or "Customer",
            "customerName": order.get("customerName") or "Customer",
            "customerPhone": order.get("customerPhone") or "",
            "location": addr.get("address") or addr.get("addressLine1") or "Pickup at farm",
            "address": addr.get("address") or addr.get("addressLine1") or "Pickup at farm",
            "city": addr.get("city", ""),
            "lat": lat,
            "lng": lng,
            "quantity": f"{qty} kg",
            "quantityKg": qty,
            "product": product,
            "items": [
                {"name": i.get("productName") or i.get("name") or "Item", "quantity": i.get("quantity", 1)}
                for i in items
            ],
            "status": status,
            "time": time_slot,
            "deliveryDay": order.get("deliveryDay", ""),
            "deliveryTimeSlot": time_slot,
            "timeWindow": f"{time_slot} ({order.get('deliveryDay') or 'Today'})",
            "deliveryType": delivery_type,
            "isPickup": delivery_type == DeliveryType.PICKUP.value,
            "distance": round(dist, 2),
            "total": total,
            "paymentMethod": payment_method,
            "isCOD": is_cod,
            "priority": int(order.get("priority", 0) or 0),
            "selfDelivery": bool(order.get("selfDelivery")),
            "canComplete": status in _ROUTE_COMPLETABLE_STATUSES,
        })

    deliveries.sort(key=lambda d: d["distance"] if d["distance"] is not None else 1e9)
    total_duration = round(total_distance / 25 * 60 + len(deliveries) * 10, 0)
    summary = {
        "totalStops": len(deliveries),
        "totalOrders": len(deliveries),
        "totalDistance": round(total_distance, 2),
        "totalDuration": total_duration,
        "totalQuantity": total_quantity,
        "totalRevenue": round(total_revenue, 2),
        "codCollection": round(cod_collection, 2),
        "onlineOrders": round(online_orders, 2),
        "fuelCost": round(total_distance * 4.5, 2),
        "pendingStops": len([d for d in deliveries if d["status"] not in _FINISHED_DELIVERY_STATUSES]),
    }
    return {"success": True, "data": {"deliveries": deliveries, "summary": summary, "farm": farm}}


@router.get("/me/route")
async def get_my_route(current_user: dict = Depends(get_current_user)):
    """Get farmer's optimized pickup/delivery route for today."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    active_statuses = ["ready_for_delivery", "ready_for_pickup"]
    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": active_statuses}, "deletedAt": None}
    )
    orders = orders or []

    farm = await _get_farm_origin(farmer_id)

    stops = []
    total_distance = 0.0
    total_quantity = 0
    for order in orders:
        oid = str(order["_id"])
        delivery_type = order.get("deliveryType", "delivery")
        addr = order.get("deliveryAddress", {}) or {}
        items = order.get("items", []) or []
        qty = sum(int(i.get("quantity", 0) or 0) for i in items)
        first = items[0] if items else {}
        product = first.get("productName") or first.get("name") or "Items"

        lat = lng = None
        if delivery_type == "delivery":
            lat, lng = await _stop_coords(addr, oid)
        else:
            lat, lng = farm["lat"], farm["lng"]

        dist = 0.0
        if delivery_type == "delivery":
            if farm["lat"] is not None and lat is not None:
                dist = _haversine_km(farm["lat"], farm["lng"], lat, lng)

        total_distance += dist
        total_quantity += qty
        stops.append({
            "id": oid,
            "orderId": oid,
            "orderNumber": order.get("orderNumber", ""),
            "buyerName": order.get("customerName", "Customer"),
            "location": addr.get("address") or addr.get("addressLine1") or "Pickup at farm",
            "city": addr.get("city", ""),
            "lat": lat,
            "lng": lng,
            "quantity": f"{qty} kg",
            "quantityKg": qty,
            "product": product,
            "items": [
                {"name": i.get("productName") or i.get("name") or "Item", "quantity": i.get("quantity", 1)}
                for i in items
            ],
            "status": order.get("orderStatus", "ready_for_delivery"),
            "time": order.get("deliveryTimeSlot", "Morning"),
            "deliveryType": delivery_type,
            "distance": round(dist, 2),
            "total": float(order.get("totalAmount", 0) or 0),
            "customerPhone": order.get("customerPhone", ""),
        })

    stops.sort(key=lambda s: s["distance"])
    total_duration = round(total_distance / 25 * 60 + len(stops) * 10, 0)
    summary = {
        "totalDistance": round(total_distance, 2),
        "totalDuration": total_duration,
        "totalQuantity": total_quantity,
        "totalRevenue": round(sum(s["total"] for s in stops), 2),
        "totalStops": len(stops),
        "pendingStops": len([s for s in stops if s["status"] not in ("delivered", "picked_up")]),
    }
    return {"success": True, "data": {"route": stops, "summary": summary, "farm": farm}}


@router.put("/me/route/start")
async def start_my_route(current_user: dict = Depends(get_current_user)):
    """Mark all delivery orders as self-delivery so the farmer can complete them."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    active_statuses = ["ready_for_delivery"]
    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": active_statuses}, "deletedAt": None}
    )
    updated = 0
    for order in orders or []:
        if order.get("deliveryType") == "delivery" and not order.get("selfDelivery"):
            if await order_repository.update_order_field(str(order["_id"]), "selfDelivery", True):
                updated += 1
    return {"success": True, "data": {"updatedStops": updated}, "message": "Route started"}


@router.put("/me/route/{order_id}/status")
async def update_route_stop_status(
    order_id: str,
    body: RouteStopUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Complete a single route stop.

    - delivery orders: ready_for_delivery -> delivered (farmer self-delivery)
    - pickup orders: ready_for_pickup -> picked_up (farmer confirms hand-off)
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    is_pickup = order.get("deliveryType") == DeliveryType.PICKUP.value
    if is_pickup:
        if body.status != "picked_up":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pickup stops can only be marked picked_up",
            )
        ok = await order_repository.update_order_status(
            order_id, "picked_up", farmer_id, body.note or "Farmer confirmed pickup on route"
        )
        if not ok:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update stop")
        try:
            await payment_repository.update_payment_status(order_id, PaymentStatus.PAID)
        except Exception:
            pass
        try:
            await OrderService.update_inventory_after_delivery(order_id)
        except Exception:
            pass
        try:
            await order_repository.update_order_field(order_id, "pickedUpAt", datetime.utcnow())
        except Exception:
            pass
        try:
            await NotificationService.send_custom_notification(
                str(order["customerId"]),
                "Thank you for picking up your order! Your payment has been processed.",
            )
        except Exception:
            pass
    else:
        if body.status != "delivered":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Delivery stops can only be marked delivered",
            )
        if not order.get("selfDelivery"):
            await order_repository.update_order_field(order_id, "selfDelivery", True)
        updated = await OrderService.update_order_status(
            order_id,
            farmer_id,
            "farmer",
            OrderStatusUpdate(status="delivered", note=body.note or "Farmer completed delivery on route"),
        )
        if not updated:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid status transition or access denied",
            )
        await delivery_job_repository.complete_by_order(order_id)

    _notify_delivery_map(
        farmer_id,
        "order.delivered",
        orderId=order_id,
        orderNumber=order.get("orderNumber", ""),
        status=body.status,
    )

    return {"success": True, "message": "Route stop updated"}


class PickupVerifyRequest(BaseModel):
    code: str = Field(..., min_length=4, max_length=12, description="Pickup verification code shown by the customer")


@router.put("/me/orders/{order_id}/confirm-pickup")
async def confirm_farm_pickup(
    order_id: str,
    body: PickupVerifyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Farmer confirms a farm-pickup hand-off.

    The customer presents the 6-digit pickup code (or scans its QR) at the
    farm. The farmer enters the code and confirms; only a matching code
    advances the order to ``picked_up``, preventing false collection.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    is_pickup = order.get("deliveryType") == DeliveryType.PICKUP.value
    if not is_pickup:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a pickup order")
    if order.get("orderStatus") != "ready_for_pickup":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order is not ready for pickup",
        )

    expected = order.get("pickupCode")
    if not expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No pickup code issued for this order")
    if body.code.strip() != str(expected):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid pickup code")

    updated = await OrderService.update_order_status(
        order_id,
        farmer_id,
        "farmer",
        OrderStatusUpdate(status="picked_up", note="Farmer verified pickup code and confirmed hand-off"),
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to confirm pickup",
        )

    _notify_delivery_map(
        farmer_id,
        "order.picked_up",
        orderId=order_id,
        orderNumber=order.get("orderNumber", ""),
        status="picked_up",
    )

    return {"success": True, "message": "Pickup confirmed successfully"}


class DeliveryProblemReport(BaseModel):
    category: str
    note: Optional[str] = None


DELIVERY_PROBLEM_CATEGORIES = [
    "customer_unavailable",
    "wrong_address",
    "customer_cancelled",
    "vehicle_problem",
    "product_damaged",
    "payment_problem",
    "weather_problem",
    "other",
]


@router.get("/me/delivery-problem-categories")
async def delivery_problem_categories(current_user: dict = Depends(get_current_user)):
    """Categories offered when reporting a delivery problem."""
    _ensure_farmer(current_user)
    return {"success": True, "data": {"categories": DELIVERY_PROBLEM_CATEGORIES}}


@router.post("/me/route/{order_id}/problem")
async def report_route_problem(
    order_id: str,
    body: DeliveryProblemReport,
    current_user: dict = Depends(get_current_user),
):
    """Report a delivery problem instead of silently failing the order.

    The report is stored on the order (so the map/calendar flag it) and the
    farmer is pointed at the follow-up actions: retry later via reschedule,
    open the order to the partner marketplace, or cancel the delivery request.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    category = (body.category or "").strip()
    if category not in DELIVERY_PROBLEM_CATEGORIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"category must be one of {', '.join(DELIVERY_PROBLEM_CATEGORIES)}",
        )

    report = {
        "category": category,
        "note": (body.note or "").strip() or None,
        "reportedAt": datetime.utcnow().isoformat(),
        "orderStatus": order.get("orderStatus", ""),
    }
    ok = await order_repository.update_order_field(order_id, "deliveryProblem", report)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to save problem report")

    _notify_delivery_map(
        farmer_id,
        "order.problem",
        orderId=order_id,
        orderNumber=order.get("orderNumber", ""),
        category=category,
    )
    return {
        "success": True,
        "data": {
            "orderId": order_id,
            **report,
            "suggestedActions": ["reschedule", "open_marketplace", "self_deliver", "cancel_request"],
        },
        "message": "Problem reported. Choose the next step for this order.",
    }


# ---------------------------------------------------------------------------
# Order Map — radius-based self-delivery / delivery-partner assignment
# ---------------------------------------------------------------------------

class DeliveryMapRadiusRequest(BaseModel):
    radius: int = Field(10, ge=1, le=200)
    maxOrders: Optional[int] = Field(None, ge=1, le=500)
    maxWeightKg: Optional[float] = Field(None, ge=1, le=10000)
    maxRouteMinutes: Optional[int] = Field(None, ge=15, le=1440)


class AssignOutsideRequest(BaseModel):
    radius: int = Field(10, ge=1, le=200)
    mode: str = "marketplace"  # "marketplace" | "ai" | "manual"
    partnerIds: Optional[dict] = None  # orderId -> partnerId (explicit manual picks)


class AssignmentUpdateRequest(BaseModel):
    mode: str  # "self" | "partner"
    partnerId: Optional[str] = None


class JobExpiryRequest(BaseModel):
    minutes: int = Field(JOB_DEFAULT_EXPIRY_MINUTES, ge=15, le=720)


class DeliveryCapacityRequest(BaseModel):
    maxOrders: int = Field(20, ge=1, le=500)
    maxWeightKg: float = Field(100, ge=1, le=10000)
    maxRouteMinutes: int = Field(180, ge=30, le=1440)
    fuelCostPerKm: float = Field(4.5, ge=0, le=200)


_DEFAULT_DELIVERY_CAPACITY: dict = {
    "maxOrders": 20,
    "maxWeightKg": 100.0,
    "maxRouteMinutes": 180,
    "fuelCostPerKm": 4.5,
}


async def _get_delivery_capacity(farmer_id: str) -> dict:
    """Farmer's delivery capacity settings (with sensible defaults)."""
    cap = dict(_DEFAULT_DELIVERY_CAPACITY)
    try:
        user = await UserService.get_user_by_id(farmer_id)
        stored = (user or {}).get("deliveryCapacity") or {}
        for key in cap:
            if stored.get(key) is not None:
                cap[key] = float(stored[key])
        cap["maxOrders"] = int(cap["maxOrders"])
        cap["maxRouteMinutes"] = int(cap["maxRouteMinutes"])
    except Exception:
        logger.warning("Could not load delivery capacity for farmer %s", farmer_id, exc_info=True)
    return cap


@router.get("/me/delivery-capacity")
async def get_delivery_capacity(current_user: dict = Depends(get_current_user)):
    """Get the farmer's delivery capacity (orders / weight / route time / fuel rate)."""
    _ensure_farmer(current_user)
    return {"success": True, "data": await _get_delivery_capacity(str(current_user["_id"]))}


@router.put("/me/delivery-capacity")
async def update_delivery_capacity(
    body: DeliveryCapacityRequest,
    current_user: dict = Depends(get_current_user),
):
    """Save the farmer's delivery capacity used by bulk-accept and profitability."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    data = {
        "maxOrders": body.maxOrders,
        "maxWeightKg": body.maxWeightKg,
        "maxRouteMinutes": body.maxRouteMinutes,
        "fuelCostPerKm": body.fuelCostPerKm,
    }
    ok = await user_repository.update({"_id": ObjectId(farmer_id)}, {"deliveryCapacity": data})
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to save delivery capacity")
    return {"success": True, "data": data, "message": "Delivery capacity updated"}


def _valid_coord(lat, lng) -> bool:
    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= lat <= 90 and -180 <= lng <= 180


async def _partner_display(partner: dict) -> dict:
    """Human-friendly partner info (id, name, phone, userId)."""
    name = "Delivery Partner"
    phone = ""
    user_id = str(partner.get("userId") or "")
    try:
        user = await UserService.get_user_by_id(user_id) if user_id else None
        if user:
            name = (
                f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                or user.get("name")
                or name
            )
            phone = user.get("phone") or ""
    except Exception:
        pass
    return {"id": str(partner["_id"]), "name": name, "phone": phone, "userId": user_id}


async def _available_partners_with_load(center: dict, radius_km: int = 50) -> list:
    """Available verified delivery partners near the center with current load."""
    partners = []
    if center.get("lat") is not None:
        try:
            partners = await delivery_repository.get_nearby_partners(
                center["lat"], center["lng"], radius_km, limit=30
            )
        except Exception:
            partners = []
    if not partners:
        # Fallback when the $near query fails (e.g. the 2dsphere index on
        # currentLocation is missing): filter available partners by haversine.
        all_available = await delivery_repository.get_available_partners(None, None, limit=50)
        for p in all_available or []:
            coords = (p.get("currentLocation") or {}).get("coordinates")
            if not coords:
                partners.append(p)
            elif center.get("lat") is not None:
                d = _haversine_km(center["lat"], center["lng"], coords[1], coords[0])
                if d <= radius_km:
                    partners.append(p)
    result = []
    for p in partners or []:
        info = await _partner_display(p)
        load = await delivery_assignment_repository.count_active_for_partner(str(p["_id"]))
        dist = None
        coords = (p.get("currentLocation") or {}).get("coordinates")
        if center.get("lat") is not None and coords:
            dist = round(_haversine_km(center["lat"], center["lng"], coords[1], coords[0]), 2)
        result.append({
            **info,
            "rating": round(float(p.get("rating", 0) or 0), 1),
            "vehicleType": p.get("vehicleType", "bike"),
            "vehicleNumber": p.get("vehicleNumber", ""),
            "capacity": p.get("capacity"),
            "activeLoad": load,
            "distanceKm": dist,
            "isAvailable": bool(p.get("isAvailable")),
            "status": p.get("status", "offline"),
            "isVerified": bool(p.get("isVerified")),
        })
    result.sort(key=lambda x: (x["activeLoad"], x["distanceKm"] if x["distanceKm"] is not None else 1e9))
    return result


async def _map_order_payload(
    order: dict,
    farm: dict,
    center: dict,
    radius: float,
    customers: Optional[dict] = None,
    refresh_coords: bool = False,
    job_info: Optional[dict] = None,
) -> dict:
    """Build the delivery-map order payload and classify it into a radius bucket.

    ``customers`` maps customerId -> user document so the map shows the real
    customer name/phone even when the order row only stores a customerId.
    ``refresh_coords`` re-geocodes the delivery address so fake/seed stored
    coordinates are replaced with the true location.
    """
    oid = str(order["_id"])
    delivery_type = order.get("deliveryType", "delivery")
    addr = order.get("deliveryAddress", {}) or {}
    items = order.get("items", []) or []
    qty = sum(int(i.get("quantity", 0) or 0) for i in items)
    first = items[0] if items else {}
    product = first.get("productName") or first.get("name") or "Items"
    status = order.get("orderStatus", "pending")
    total = float(order.get("totalAmount", 0) or 0)
    payment_method = str(order.get("paymentMethod", "") or "").lower()
    time_slot = order.get("deliveryTimeSlot") or "Morning"
    is_pickup = delivery_type == DeliveryType.PICKUP.value

    cust = (customers or {}).get(str(order.get("customerId"))) or {}
    first_name = cust.get("firstName") or cust.get("name") or ""
    last_name = cust.get("lastName") or ""
    real_name = " ".join(p for p in (first_name, last_name) if p).strip()
    customer_name = order.get("customerName") or real_name or "Customer"
    customer_phone = order.get("customerPhone") or cust.get("phone") or cust.get("mobile") or ""

    lat = lng = None
    if is_pickup:
        lat, lng = farm.get("lat"), farm.get("lng")
    else:
        lat, lng = await _stop_coords(addr, oid, refresh=refresh_coords)

    dist = None
    if lat is not None and center.get("lat") is not None:
        dist = round(_haversine_km(center["lat"], center["lng"], lat, lng), 2)

    in_radius = dist is not None and dist <= radius

    has_partner = bool(order.get("deliveryPartnerId"))
    is_delivered = status in ("delivered", "picked_up")
    is_problem = status == "failed" or bool(order.get("deliveryProblem"))
    job = job_info or {}
    job_status = job.get("status")
    no_partner_found = job_status in (JOB_NO_PARTNER_FOUND, "expired")
    if is_delivered:
        delivery_state = "delivered"
    elif is_problem:
        delivery_state = "problem"
    elif is_pickup or order.get("selfDelivery"):
        delivery_state = "self_delivery"
    elif has_partner:
        delivery_state = "partner_assigned"
    elif order.get("partnerAssignmentOpen") or job_status == JOB_OPEN:
        delivery_state = "partner_assignment_open"
    elif order.get("partnerRequested"):
        delivery_state = "partner_assignment_pending"
    else:
        delivery_state = "pending_assignment"

    # The three-way assignment bucket drives the map markers, the per-order
    # assignment selector and the summary counts (self / partner / unassigned).
    if has_partner or order.get("partnerRequested"):
        assignment = "partner"
    elif is_pickup or order.get("selfDelivery"):
        assignment = "self"
    else:
        assignment = "unassigned"

    return {
        "id": oid,
        "orderId": oid,
        "orderNumber": order.get("orderNumber", ""),
        "buyerName": customer_name,
        "customerName": customer_name,
        "customerPhone": customer_phone,
        "location": addr.get("address") or addr.get("addressLine1") or "Pickup at farm",
        "address": addr.get("address") or addr.get("addressLine1") or "Pickup at farm",
        "city": addr.get("city", ""),
        "lat": lat,
        "lng": lng,
        "quantity": f"{qty} kg",
        "quantityKg": qty,
        "product": product,
        "items": [
            {"name": i.get("productName") or i.get("name") or "Item", "quantity": i.get("quantity", 1)}
            for i in items
        ],
        "status": status,
        "time": time_slot,
        "deliveryDay": order.get("deliveryDay", ""),
        "deliveryTimeSlot": time_slot,
        "timeWindow": f"{time_slot} ({order.get('deliveryDay') or 'Today'})",
        "deliveryType": delivery_type,
        "isPickup": is_pickup,
        "distance": dist,
        "inRadius": in_radius,
        "total": total,
        "paymentMethod": payment_method,
        "isCOD": payment_method == "cash",
        "priority": int(order.get("priority", 0) or 0),
        "selfDelivery": bool(order.get("selfDelivery")),
        "deliveryPartnerId": str(order["deliveryPartnerId"]) if has_partner else None,
        "deliveryPartnerName": order.get("deliveryPartnerName") or "",
        "assignment": assignment,
        "deliveryState": delivery_state,
        "deliveryProblem": is_problem,
        "partnerAssignmentOpen": bool(order.get("partnerAssignmentOpen")) or job_status == JOB_OPEN,
        "jobStatus": job_status,
        "noPartnerFound": no_partner_found,
        "jobExpiresAt": job.get("expiresAt") if job else None,
        "canComplete": status in _ROUTE_COMPLETABLE_STATUSES,
        "deliveredAt": order.get("deliveredAt") or order.get("updatedAt"),
        "isDelivered": is_delivered,
    }


@router.get("/me/delivery-map")
async def get_my_delivery_map(
    radius: int = Query(10, ge=1, le=200),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    delivered: str = Query("today"),
    current_user: dict = Depends(get_current_user),
):
    """All orders on a map, split into within / outside radius buckets.

    ``radius`` is measured from the farm (or from the supplied ``lat``/``lng``
    override). The within-radius bucket is determined with a MongoDB
    ``$geoWithin`` spherical query on the order's GeoJSON delivery address.

    ``delivered`` selects the time window for the whole map (today | week |
    month | year | all). It filters active orders by their creation date and
    completed deliveries by their delivered date, so every panel on the page
    (within / outside / unlocated / delivered / summary) reflects the same
    selected window.
    """
    _ensure_farmer(current_user)
    delivered_window = (delivered or "today").strip().lower()
    if delivered_window not in _DELIVERED_WINDOWS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="delivered must be one of today, week, month, year, all",
        )
    farmer_id = str(current_user["_id"])
    farm = await _get_farm_origin(farmer_id)
    if _valid_coord(lat, lng):
        farm = {**farm, "lat": float(lat), "lng": float(lng)}
    center = {"lat": farm.get("lat"), "lng": farm.get("lng")}
    window_start = _delivered_window_start(delivered_window, datetime.utcnow())

    orders_filter = {
        "farmerId": ObjectId(farmer_id),
        "orderStatus": {"$in": _ACTIVE_DELIVERY_STATUSES},
        "deletedAt": None,
    }
    if window_start is not None:
        orders_filter["createdAt"] = {"$gte": window_start}
    orders = await order_repository.find_many(orders_filter)
    orders = orders or []

    # Sweep expired open jobs (open -> no_partner_found) and index the rest by
    # orderId so each map marker can report its marketplace job state.
    await delivery_job_repository.sweep_expired(farmer_id)
    farmer_jobs = await delivery_job_repository.get_jobs_by_farmer(farmer_id)
    jobs_by_order = {}
    order_ids = {str(o["_id"]) for o in orders}
    for j in (farmer_jobs or []):
        jid, oid = str(j["_id"]), str(j.get("orderId"))
        if oid not in order_ids:
            continue
        order = await order_repository.get_by_id(oid)
        if not order:
            continue
        o_status = order.get("orderStatus")
        if o_status in ("delivered", "picked_up") and j.get("status") == JOB_ACCEPTED:
            await delivery_job_repository.complete_by_order(oid)
            j["status"] = JOB_DELIVERED
        elif j.get("orderStatus") != o_status:
            await delivery_job_repository.sync_order_status(jid, o_status)
            j["orderStatus"] = o_status
        if order.get("selfDelivery") and j.get("status") == JOB_OPEN:
            await delivery_job_repository.cancel_by_order(oid, "Order switched to self delivery")
            j["status"] = "cancelled"
        jobs_by_order[oid] = j

    delivered_filter = {"farmerId": ObjectId(farmer_id), "orderStatus": "delivered", "deletedAt": None}
    dstart = _delivered_window_start(delivered_window, datetime.utcnow())
    if dstart is not None:
        delivered_filter["deliveredAt"] = {"$gte": dstart}
    delivered_orders = await order_repository.find_many(delivered_filter)
    delivered_orders = delivered_orders or []

    customer_ids = {
        str(o.get("customerId"))
        for o in (orders + delivered_orders)
        if o.get("customerId")
    }
    customers = {}
    if customer_ids:
        try:
            for c in (await user_repository.get_by_ids(list(customer_ids))) or []:
                customers[str(c["_id"])] = c
        except Exception:
            logger.warning("Failed to resolve delivery-map customer details", exc_info=True)

    delivered_payloads = []
    for order in delivered_orders:
        payload = await _map_order_payload(order, farm, center, radius, customers=customers)
        payload["isDelivered"] = True
        delivered_payloads.append(payload)
    delivered_payloads.sort(key=lambda p: (p["distance"] or 0))

    payloads = []
    for order in orders:
        payload = await _map_order_payload(
            order, farm, center, radius, customers=customers,
            refresh_coords=True, job_info=jobs_by_order.get(str(order["_id"])),
        )
        payloads.append(payload)

    within = [p for p in payloads if p["inRadius"]]
    outside = [p for p in payloads if not p["inRadius"] and p["distance"] is not None]
    unlocated = [p for p in payloads if p["distance"] is None]
    outside.sort(key=lambda p: (p["distance"] or 0))
    within.sort(key=lambda p: (p["distance"] or 0))

    cod_collection = round(sum(p["total"] for p in payloads if p["isCOD"]), 2)
    online_orders = round(sum(p["total"] for p in payloads if not p["isCOD"]), 2)

    # Order Summary panel: value, product weight and estimated travel distance.
    total_value = round(sum(p["total"] for p in payloads), 2)
    within_value = round(sum(p["total"] for p in within), 2)
    outside_value = round(sum(p["total"] for p in outside), 2)
    total_weight = round(sum(float(p.get("quantityKg") or 0) for p in payloads), 2)
    within_weight = round(sum(float(p.get("quantityKg") or 0) for p in within), 2)
    outside_weight = round(sum(float(p.get("quantityKg") or 0) for p in outside), 2)
    # Estimated distance: straight-line round-trip covering every active stop.
    est_distance = round(
        sum(float(p.get("distance") or 0) for p in payloads) * 2, 2
    )
    within_distance = round(sum(float(p.get("distance") or 0) for p in within) * 2, 2)
    outside_distance = round(sum(float(p.get("distance") or 0) for p in outside) * 2, 2)

    summary = {
        "radius": radius,
        "totalOrders": len(payloads),
        "withinRadius": len(within),
        "outsideRadius": len(outside),
        "unlocated": len(unlocated),
        "selfDelivery": sum(1 for p in payloads if p["assignment"] == "self"),
        "partnerAssigned": sum(1 for p in payloads if p["assignment"] == "partner"),
        "unassigned": sum(1 for p in payloads if p["assignment"] == "unassigned"),
        "waitingForPartner": sum(1 for p in payloads if p["deliveryState"] == "partner_assignment_open"),
        "noPartnerFound": sum(1 for p in payloads if p.get("noPartnerFound")),
        "delivered": len(delivered_payloads),
        "deliveredWindow": delivered_window,
        "codCollection": cod_collection,
        "onlineOrders": online_orders,
        "totalValue": total_value,
        "withinValue": within_value,
        "outsideValue": outside_value,
        "totalWeight": total_weight,
        "withinWeight": within_weight,
        "outsideWeight": outside_weight,
        "estimatedDistance": est_distance,
        "withinDistance": within_distance,
        "outsideDistance": outside_distance,
        "deliveryProblem": sum(1 for p in payloads if p.get("deliveryProblem")),
    }

    partners = await _available_partners_with_load(center, max(radius, 50))

    return {
        "success": True,
        "data": {
            "farm": farm,
            "radius": radius,
            "summary": summary,
            "withinRadius": within,
            "outsideRadius": outside,
            "unlocated": unlocated,
            "delivered": delivered_payloads,
            "partners": partners,
        },
    }


def _notify_delivery_map(farmer_id: str, event_type: str, **payload) -> None:
    """Broadcast a realtime event to the farmer's Order Map SSE stream.

    Fire-and-forget: a failed publish must never break the mutation that
    triggered it. The client keeps a polling fallback for multi-process runs.
    """
    try:
        asyncio.create_task(
            delivery_map_event_broker.publish(farmer_id, {"type": event_type, **payload})
        )
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Delivery map event publish failed: %s", e)


@router.get("/me/delivery-map/events")
async def delivery_map_events(current_user: dict = Depends(get_current_user)):
    """Server-Sent-Events stream for the farmer's Order Map.

    Emits ``order.accepted``, ``order.assigned`` and ``order.delivered`` events
    so the map refreshes in real time when an order is claimed, assigned,
    switched, cancelled or completed — without a full page reload. The client
    auto-reconnects and falls back to polling if the stream drops.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])

    async def event_stream():
        queue = delivery_map_event_broker.subscribe(farmer_id)
        try:
            yield ": connected\n\n"
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {message}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            delivery_map_event_broker.unsubscribe(farmer_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/me/delivery-map/partners")
async def get_my_delivery_partners(
    radius: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Available delivery partners near the farm with current workload."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    farm = await _get_farm_origin(farmer_id)
    partners = await _available_partners_with_load({"lat": farm.get("lat"), "lng": farm.get("lng")}, radius)
    return {"success": True, "data": {"partners": partners, "farm": farm}}


@router.put("/me/delivery-map/accept-within")
async def accept_within_for_self_delivery(
    body: DeliveryMapRadiusRequest,
    current_user: dict = Depends(get_current_user),
):
    """Accept orders inside the radius for farmer self-delivery, nearest first.

    Claims respect the farmer's delivery capacity (max orders, total weight and
    estimated route time). Candidates are filled nearest-first until a limit is
    reached; orders that no longer fit stay unassigned and are reported back so
    the UI can offer to open them on the delivery marketplace.
    Each order is claimed with an atomic compare-and-set so concurrent actions
    can never double-claim the same order.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    radius = max(1, min(body.radius, 200))
    farm = await _get_farm_origin(farmer_id)
    center = {"lat": farm.get("lat"), "lng": farm.get("lng")}
    if center.get("lat") is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Farm location is not set. Please add your farm address in Settings first.",
        )

    cap = await _get_delivery_capacity(farmer_id)
    max_orders = int(body.maxOrders) if body.maxOrders else int(cap["maxOrders"])
    max_weight = float(body.maxWeightKg) if body.maxWeightKg else float(cap["maxWeightKg"])
    max_minutes = int(body.maxRouteMinutes) if body.maxRouteMinutes else int(cap["maxRouteMinutes"])

    within_ids = set()
    within = await order_repository.get_active_by_farmer_within_radius(
        farmer_id, center["lng"], center["lat"], radius, _ACTIVE_DELIVERY_STATUSES
    )
    within_ids = {str(o["_id"]) for o in (within or [])}

    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": _ACTIVE_DELIVERY_STATUSES}, "deletedAt": None}
    )

    # Collect claimable candidates first so they can be filled nearest-first
    # under the capacity limits instead of claiming in arbitrary doc order.
    candidates: list[tuple[float, str, dict]] = []
    already_self = 0
    skipped_partner = 0
    skipped_other = 0
    for order in orders or []:
        oid = str(order["_id"])
        if order.get("deliveryType") == DeliveryType.PICKUP.value:
            continue
        if order.get("selfDelivery"):
            already_self += 1
            continue
        if order.get("deliveryPartnerId"):
            skipped_partner += 1
            continue
        addr = order.get("deliveryAddress", {}) or {}
        lat, lng = await _stop_coords(addr, oid)
        if lat is None:
            skipped_other += 1
            continue
        dist = _haversine_km(center["lat"], center["lng"], lat, lng)
        if oid not in within_ids and dist > radius:
            skipped_other += 1
            continue
        candidates.append((dist, oid, order))
    candidates.sort(key=lambda t: t[0])

    claimed = 0
    claimed_weight = 0.0
    est_minutes = 0.0
    over_capacity = 0
    claimed_ids = []
    for dist, oid, order in candidates:
        weight = job_weight_kg(order)
        leg_minutes = dist / 25.0 * 60.0 + 10.0
        next_weight = claimed_weight + weight
        next_minutes = est_minutes + leg_minutes
        if claimed + 1 > max_orders or next_weight > max_weight + 1e-9 or next_minutes > max_minutes:
            over_capacity += 1
            continue
        if await order_repository.claim_for_self_delivery(oid, farmer_id, _ACTIVE_DELIVERY_STATUSES):
            claimed += 1
            claimed_weight += weight
            est_minutes += leg_minutes
            claimed_ids.append(oid)
            if order.get("orderStatus") in ("dispatched", "in_transit"):
                await order_repository.restore_after_reclaim(oid, "ready_for_delivery")
            await delivery_assignment_repository.cancel_by_order_id(
                oid, "Farmer accepted order for self-delivery"
            )
            await delivery_job_repository.cancel_by_order(oid, "Farmer accepted order for self-delivery")
            await order_repository.update_order_field(oid, "partnerAssignmentOpen", False)
            try:
                await NotificationService.send_custom_notification(
                    str(order.get("customerId")),
                    f"Your order {order.get('orderNumber', '')} will be delivered directly by the farmer.",
                )
            except Exception:
                pass

    _notify_delivery_map(
        farmer_id,
        "orders.accepted",
        radius=radius,
        count=claimed,
        orderIds=claimed_ids,
        overCapacity=over_capacity,
    )

    message = f"{claimed} of {len(candidates)} nearby orders accepted for self-delivery within {radius} km"
    if over_capacity:
        message += f" · {over_capacity} left out by your capacity limits"
    return {
        "success": True,
        "data": {
            "radius": radius,
            "considered": len(candidates),
            "claimed": claimed,
            "alreadySelf": already_self,
            "skipped": skipped_partner + skipped_other,
            "skippedPartner": skipped_partner,
            "acceptedWeightKg": round(claimed_weight, 2),
            "estimatedMinutes": round(est_minutes),
            "capacity": {
                "maxOrders": max_orders,
                "maxWeightKg": max_weight,
                "maxRouteMinutes": max_minutes,
            },
            "overCapacity": over_capacity,
        },
        "message": message,
    }


def _manual_partner_plan(targets, available: list, partner_ids: dict) -> list:
    """Assign each target order to the least-loaded partner (or an explicit pick)."""
    load = {p["id"]: p["activeLoad"] for p in available}
    plan = []
    for order, dist in sorted(targets, key=lambda t: t[1]):
        oid = str(order["_id"])
        pid = (partner_ids or {}).get(oid)
        if pid and any(p["id"] == pid for p in available):
            partner = next(p for p in available if p["id"] == pid)
            reason = "Manual partner selection"
        else:
            partner = min(
                available,
                key=lambda p: (load[p["id"]], p["distanceKm"] if p.get("distanceKm") is not None else 1e9),
            )
            reason = "Least-loaded available partner"
        load[partner["id"]] += 1
        plan.append((order, partner, reason))
    return plan


def _ai_partner_plan(targets, available: list) -> list:
    """Score-based AI assignment for the orders outside the farmer's radius.

    Each order (nearest first) is handed to the available partner with the best
    score, considering:

    - delivery partner rating
    - current workload (number of already-active orders)
    - distance from the partner to the farm
    - vehicle capacity vs. the order weight already committed (running load)
    - delivery time slot balance (avoid piling the whole batch into one slot)

    This is a deterministic heuristic in the same spirit as the app's other
    on-device 'AI' models (route optimisation, demand clustering).
    """
    max_rating = max((p["rating"] for p in available), default=1) or 1
    max_load = max((p["activeLoad"] for p in available), default=1) or 1
    running_weight = {p["id"]: 0.0 for p in available}
    running_slots: dict = {p["id"]: Counter() for p in available}
    plan = []
    for order, dist in sorted(targets, key=lambda t: t[1]):
        qty = sum(int(i.get("quantity", 0) or 0) for i in (order.get("items") or []))
        slot = str(order.get("deliveryTimeSlot") or order.get("deliveryDay") or "").strip() or "Morning"
        best, best_score = None, -1e9
        for p in available:
            pdist = p.get("distanceKm") if p.get("distanceKm") is not None else 50.0
            capacity = float(p.get("capacity") or 0) or None
            remaining = capacity - running_weight[p["id"]] if capacity else None
            capacity_ok = remaining is None or remaining >= qty - 1e-9
            slot_load = running_slots[p["id"]].get(slot, 0)
            slot_fit = 1.0 - min(slot_load / max(p["activeLoad"] + 1, 1), 0.5)
            score = (
                0.30 * (p["rating"] / max_rating)
                + 0.25 * (1 - (p["activeLoad"] / max_load))
                + 0.25 * (1 - min(pdist / 50.0, 1.0))
                + 0.20 * slot_fit
            )
            if not capacity_ok:
                score -= 0.75
            if score > best_score:
                best_score = score
                best = p
        if best:
            running_weight[best["id"]] += qty
            running_slots[best["id"]][slot] += 1
            plan.append((order, best, f"AI match (score {round(best_score, 2)})"))
    return plan


@router.post("/me/delivery-map/assign-outside")
async def assign_outside_to_partners(
    body: AssignOutsideRequest,
    current_user: dict = Depends(get_current_user),
):
    """Assign every order outside the radius to delivery partners.

    - ``mode=marketplace`` (default): posts every outside order as an open
      marketplace job. ALL eligible delivery partners see it in their app and
      the first one to accept wins (atomic compare-and-set, so two or more
      partners can never both accept the same order). Once accepted, the order
      moves to ``in_transit`` and the job disappears from other partners.
    - ``mode=manual``: nearest / least-loaded partner (or explicit ``partnerIds``).
    - ``mode=ai``: heuristic score combining rating, load and proximity.
    Each direct-assigned order is handed off with an atomic compare-and-set.
    """
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    radius = max(1, min(body.radius, 200))
    farm = await _get_farm_origin(farmer_id)
    center = {"lat": farm.get("lat"), "lng": farm.get("lng")}
    if center.get("lat") is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Farm location is not set. Please add your farm address in Settings first.",
        )

    within_ids = set()
    within = await order_repository.get_active_by_farmer_within_radius(
        farmer_id, center["lng"], center["lat"], radius, _ACTIVE_DELIVERY_STATUSES
    )
    within_ids = {str(o["_id"]) for o in (within or [])}

    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": _ACTIVE_DELIVERY_STATUSES}, "deletedAt": None}
    )

    targets = []
    for order in orders or []:
        if order.get("deliveryType") == DeliveryType.PICKUP.value:
            continue
        if order.get("selfDelivery") or order.get("deliveryPartnerId"):
            continue
        oid = str(order["_id"])
        addr = order.get("deliveryAddress", {}) or {}
        lat, lng = await _stop_coords(addr, oid)
        if lat is None:
            continue
        dist = _haversine_km(center["lat"], center["lng"], lat, lng)
        if oid not in within_ids and dist > radius:
            targets.append((order, dist))

    if not targets:
        return {"success": True, "data": {"assigned": 0, "targets": 0, "results": [], "mode": body.mode, "radius": radius}}

    # Marketplace mode: broadcast every outside order to ALL eligible delivery
    # partners. Each order becomes an open job; the first partner to accept it
    # (claim_job is an atomic compare-and-set) locks the order for everyone
    # else and the order advances to in_transit.
    if body.mode == "marketplace":
        opened = 0
        skipped = 0
        results = []
        for order, _dist in targets:
            oid = str(order["_id"])
            existing = await delivery_job_repository.get_by_order_id(oid)
            if existing and existing.get("status") == JOB_OPEN:
                results.append({
                    "orderId": oid,
                    "jobId": str(existing["_id"]),
                    "status": "already_open",
                    "job": serialize_job_for_farmer(existing),
                })
                continue
            res = await _open_job_for_order(order, farm, farmer_id)
            if res["status"] == "open":
                opened += 1
            else:
                skipped += 1
            results.append(res)
        _notify_delivery_map(farmer_id, "jobs.opened", count=opened)
        return {
            "success": True,
            "data": {
                "opened": opened,
                "skipped": skipped,
                "targets": len(targets),
                "results": results,
                "mode": "marketplace",
                "radius": radius,
            },
            "message": f"Posted {opened} orders for all delivery partners to accept",
        }

    available = await _available_partners_with_load(center, max(radius, 50))
    eligible = [p for p in available if p["isAvailable"] and p["isVerified"]]
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No available verified delivery partners nearby. Please try a larger radius or contact support.",
        )

    if body.mode == "ai":
        plan = _ai_partner_plan(targets, eligible)
    else:
        plan = _manual_partner_plan(targets, eligible, body.partnerIds or {})

    assigned = 0
    results = []
    for order, partner, reason in plan:
        oid = str(order["_id"])
        if not await order_repository.assign_partner_safe(oid, farmer_id, partner["id"], _ACTIVE_DELIVERY_STATUSES):
            results.append({"orderId": oid, "status": "skipped", "reason": "Already assigned or no longer eligible"})
            continue
        try:
            await order_repository.update_order_field(oid, "deliveryPartnerName", partner["name"])
        except Exception:
            pass
        try:
            existing = await delivery_assignment_repository.get_by_order_id(oid)
            if existing:
                await delivery_assignment_repository.reassign_open_assignment(oid, partner["id"])
            else:
                await delivery_assignment_repository.create_assignment({
                    "orderId": ObjectId(oid),
                    "deliveryPartnerId": ObjectId(partner["id"]),
                    "farmerId": ObjectId(farmer_id),
                    "priority": 1,
                    "source": "farmer_order_map",
                    "assignee": "farmer",
                    "assignmentMethod": "ai" if body.mode == "ai" else "manual",
                })
        except Exception as e:
            logger.warning(f"Assignment record error for {oid}: {e}")
        try:
            if partner.get("userId"):
                await NotificationService.send_custom_notification(
                    partner["userId"],
                    f"New delivery assigned: order {order.get('orderNumber', '')}.",
                )
        except Exception:
            pass
        assigned += 1
        results.append({
            "orderId": oid,
            "partnerId": partner["id"],
            "partnerName": partner["name"],
            "status": "assigned",
            "reason": reason,
        })
        _notify_delivery_map(
            farmer_id,
            "order.assigned",
            orderId=oid,
            partnerId=partner["id"],
            partnerName=partner["name"],
        )

    _notify_delivery_map(farmer_id, "orders.assigned", radius=radius, count=assigned)

    return {
        "success": True,
        "data": {"assigned": assigned, "targets": len(targets), "results": results, "mode": body.mode, "radius": radius},
        "message": f"{assigned} orders assigned to delivery partners",
    }


@router.put("/me/delivery-map/orders/{order_id}/assignment")
async def update_order_assignment(
    order_id: str,
    body: AssignmentUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Switch a single order between farmer self-delivery and a delivery partner."""
    _ensure_farmer(current_user)
    if body.mode not in ("self", "partner"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mode must be 'self' or 'partner'")
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.get("deliveryType") == DeliveryType.PICKUP.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pickup orders are handled at the farm and cannot be re-assigned",
        )

    if body.mode == "self":
        # Block reclaiming an order a partner has already accepted/picked up.
        active = await delivery_assignment_repository.get_by_order_id(order_id)
        if active and active.get("status") in ("accepted", "picked_up", "in_transit"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A delivery partner has already accepted this order and it cannot be switched back.",
            )
        if await order_repository.reclaim_for_self_delivery(order_id, farmer_id, _ACTIVE_DELIVERY_STATUSES):
            if order.get("orderStatus") in ("dispatched", "in_transit"):
                await order_repository.restore_after_reclaim(order_id, "ready_for_delivery")
            await delivery_assignment_repository.cancel_by_order_id(
                order_id, "Farmer switched order to self-delivery"
            )
            await delivery_job_repository.cancel_by_order(order_id, "Farmer switched order to self-delivery")
            await order_repository.update_order_field(order_id, "partnerAssignmentOpen", False)
            try:
                await NotificationService.send_custom_notification(
                    str(order.get("customerId")),
                    f"Your order {order.get('orderNumber', '')} will be delivered directly by the farmer.",
                )
            except Exception:
                pass
            _notify_delivery_map(farmer_id, "order.updated", orderId=order_id, mode="self", orderNumber=order.get("orderNumber", ""))
            return {"success": True, "message": "Order switched to self delivery"}
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order could not be switched to self delivery (it was already marked for self delivery).",
        )

    if body.mode == "partner":
        partner_id = body.partnerId
        if not partner_id:
            addr = order.get("deliveryAddress", {}) or {}
            lat, lng = await _stop_coords(addr, order_id)
            partner = None
            if lat is not None:
                nearby = await _available_partners_with_load({"lat": lat, "lng": lng}, 50)
                partner = nearby[0] if nearby else None
            if not partner:
                await order_repository.update_order_field(order_id, "partnerRequested", True)
                return {
                    "success": True,
                    "message": "No partner available nearby; order flagged for partner request",
                }
            partner_id = partner["id"]
            partner_info = partner
        else:
            partner = await delivery_repository.get_by_id(partner_id)
            if not partner:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery partner not found")
            partner_info = await _partner_display(partner)

        if await order_repository.assign_partner_safe(order_id, farmer_id, partner_id, _ACTIVE_DELIVERY_STATUSES):
            try:
                await order_repository.update_order_field(order_id, "deliveryPartnerName", partner_info["name"])
            except Exception:
                pass
            try:
                existing = await delivery_assignment_repository.get_by_order_id(order_id)
                if existing:
                    await delivery_assignment_repository.reassign_open_assignment(order_id, partner_id)
                else:
                    await delivery_assignment_repository.create_assignment({
                        "orderId": ObjectId(order_id),
                        "deliveryPartnerId": ObjectId(partner_id),
                        "farmerId": ObjectId(farmer_id),
                        "priority": 1,
                        "source": "farmer_order_map",
                        "assignee": "farmer",
                        "assignmentMethod": "manual",
                    })
            except Exception:
                pass
            try:
                if partner_info.get("userId"):
                    await NotificationService.send_custom_notification(
                        partner_info["userId"],
                        f"New delivery assigned: order {order.get('orderNumber', '')}.",
                    )
            except Exception:
                pass
            _notify_delivery_map(farmer_id, "order.updated", orderId=order_id, mode="partner", partnerId=partner_id, orderNumber=order.get("orderNumber", ""))
            return {"success": True, "message": "Delivery partner assigned"}
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order could not be assigned (already self-delivery or an accepted partner assignment exists)",
        )


async def _open_job_for_order(order: dict, farm: dict, farmer_id: str, expires_in_minutes: int = JOB_DEFAULT_EXPIRY_MINUTES) -> dict:
    """Open (or refresh) the marketplace delivery job for a single order.

    Resolves the delivery coordinates for the distance/earnings estimate, finds
    the eligible partners and snapshots their ids onto the job so their app can
    be notified of removal later. Returns a summary of the result.
    """
    oid = str(order["_id"])
    addr = order.get("deliveryAddress", {}) or {}
    lat, lng = await _stop_coords(addr, oid)
    distance_km = None
    if lat is not None and farm.get("lat") is not None:
        distance_km = round(_haversine_km(farm["lat"], farm["lng"], lat, lng), 2)

    eligible = await eligible_partners_for_job(
        farm.get("lat") or 0.0,
        farm.get("lng") or 0.0,
        job_weight_kg(order),
    )
    eligible_ids = [p["id"] for p in eligible]

    job_doc = build_job_document(
        order,
        farm,
        distance_km,
        expires_in_minutes=expires_in_minutes,
        eligible_partner_ids=eligible_ids,
    )
    job_id = await delivery_job_repository.create_job(job_doc)
    await order_repository.update_order_field(oid, "partnerAssignmentOpen", True)
    await order_repository.update_order_field(oid, "partnerRequested", False)
    try:
        await order_repository.update_order_field(oid, "partnerAssignmentOpenedAt", datetime.utcnow())
    except Exception:
        pass
    if job_id:
        await delivery_job_repository.sync_order_status(job_id, order.get("orderStatus", "pending"))

    for p in eligible:
        try:
            if p.get("userId"):
                await NotificationService.send_custom_notification(
                    p["userId"],
                    f"New delivery available near you: order {order.get('orderNumber', '')} ({job_doc['weightKg']} kg, ₹{job_doc['earnings']}).",
                )
        except Exception:
            pass

    job = await delivery_job_repository.get_by_id(job_id) if job_id else None
    return {
        "orderId": oid,
        "jobId": job_id,
        "status": "open" if job else "failed",
        "weightKg": job_doc["weightKg"],
        "earnings": job_doc["earnings"],
        "distanceKm": job_doc["distanceKm"],
        "eligibleCount": len(eligible_ids),
        "expiresAt": job_doc["expiresAt"],
        "job": serialize_job_for_farmer(job) if job else None,
    }


@router.get("/me/delivery-map/jobs")
async def list_my_delivery_jobs(
    current_user: dict = Depends(get_current_user),
):
    """All marketplace delivery jobs opened by the farmer, newest first."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    await delivery_job_repository.sweep_expired(farmer_id)
    jobs = await delivery_job_repository.get_jobs_by_farmer(farmer_id)
    serialized = []
    for job in jobs or []:
        order = await order_repository.get_by_id(str(job.get("orderId")))
        if not order:
            continue
        o_status = order.get("orderStatus")
        j_status = job.get("status")
        if o_status in ("delivered", "picked_up") and j_status == JOB_ACCEPTED:
            await delivery_job_repository.complete_by_order(str(order["_id"]))
        elif job.get("orderStatus") != o_status:
            await delivery_job_repository.sync_order_status(str(job["_id"]), o_status)
        payload = serialize_job_for_farmer(job)
        payload["orderStatus"] = o_status
        payload["selfDelivery"] = bool(order.get("selfDelivery"))
        if j_status == JOB_ACCEPTED and job.get("acceptedBy"):
            try:
                partner_doc = await delivery_repository.get_by_id(str(job["acceptedBy"]))
                if partner_doc:
                    display = await _partner_display(partner_doc)
                    payload["partnerName"] = display.get("name") or "Delivery Partner"
                    payload["partnerPhone"] = display.get("phone") or ""
            except Exception:
                logger.warning("Could not resolve accepted partner for job %s", job.get("_id"))
        serialized.append(payload)
    return {
        "success": True,
        "data": {
            "jobs": serialized,
        },
    }


@router.post("/me/delivery-map/jobs/open-remaining")
async def open_jobs_for_remaining_orders(
    body: JobExpiryRequest,
    current_user: dict = Depends(get_current_user),
):
    """Open marketplace jobs for every unassigned, non-pickup active order."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    farm = await _get_farm_origin(farmer_id)
    if farm.get("lat") is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Farm location is not set. Please add your farm address in Settings first.",
        )

    orders = await order_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "orderStatus": {"$in": _ACTIVE_DELIVERY_STATUSES}, "deletedAt": None}
    )
    orders = orders or []
    results = []
    opened = 0
    skipped = 0
    for order in orders:
        oid = str(order["_id"])
        if order.get("deliveryType") == DeliveryType.PICKUP.value:
            skipped += 1
            continue
        if order.get("selfDelivery") or order.get("deliveryPartnerId"):
            skipped += 1
            continue
        existing = await delivery_job_repository.get_by_order_id(oid)
        if existing and existing.get("status") == JOB_OPEN:
            results.append({
                "orderId": oid,
                "jobId": str(existing["_id"]),
                "status": "already_open",
                "job": serialize_job_for_farmer(existing),
            })
            continue
        res = await _open_job_for_order(order, farm, farmer_id, body.minutes)
        if res["status"] == "open":
            opened += 1
        results.append(res)

    _notify_delivery_map(farmer_id, "jobs.opened", count=opened)

    return {
        "success": True,
        "data": {"opened": opened, "skipped": skipped, "total": len(orders), "results": results},
        "message": f"Delivery jobs opened for {opened} orders",
    }


@router.post("/me/delivery-map/jobs/{order_id}/open")
async def open_job_for_order(
    order_id: str,
    body: JobExpiryRequest,
    current_user: dict = Depends(get_current_user),
):
    """Open a marketplace delivery job for a single order."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.get("deliveryType") == DeliveryType.PICKUP.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pickup orders are handled at the farm and cannot be posted to delivery partners",
        )
    if order.get("selfDelivery"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This order is marked for farmer self-delivery. Switch it back to partner first.",
        )
    if order.get("deliveryPartnerId"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A delivery partner is already assigned to this order.",
        )
    farm = await _get_farm_origin(farmer_id)
    if farm.get("lat") is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Farm location is not set. Please add your farm address in Settings first.",
        )

    existing = await delivery_job_repository.get_by_order_id(order_id)
    if existing and existing.get("status") == JOB_OPEN:
        return {
            "success": True,
            "data": serialize_job_for_farmer(existing),
            "message": "Delivery job is already open",
        }

    res = await _open_job_for_order(order, farm, farmer_id, body.minutes)
    _notify_delivery_map(farmer_id, "job.opened", orderId=order_id, jobId=res["jobId"])
    if res["status"] != "open":
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not open delivery job")
    return {"success": True, "data": res, "message": "Delivery job opened for partners"}


@router.post("/me/delivery-map/jobs/{order_id}/close")
async def close_job_for_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Close/cancel a marketplace job for an order (partners stop seeing it)."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    job = await delivery_job_repository.get_by_order_id(order_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No open delivery job for this order")
    if job.get("status") == JOB_ACCEPTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A delivery partner has already accepted this job. Complete or cancel the assignment instead.",
        )
    await delivery_job_repository.cancel_by_order(order_id, "Closed by farmer")
    await order_repository.update_order_field(order_id, "partnerAssignmentOpen", False)
    _notify_delivery_map(farmer_id, "job.closed", orderId=order_id)
    return {"success": True, "message": "Delivery job closed"}


@router.post("/me/delivery-map/jobs/{order_id}/extend")
async def extend_job_expiry(
    order_id: str,
    body: JobExpiryRequest,
    current_user: dict = Depends(get_current_user),
):
    """Re-open / extend the expiry of a job (e.g. after no_partner_found)."""
    _ensure_farmer(current_user)
    farmer_id = str(current_user["_id"])
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    if order.get("deliveryPartnerId"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A delivery partner is already assigned to this order.",
        )
    job = await delivery_job_repository.get_by_order_id(order_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No delivery job for this order")
    if job.get("status") == JOB_ACCEPTED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A delivery partner has already accepted this job.",
        )
    await delivery_job_repository.extend_expiry(str(job["_id"]), body.minutes)
    await order_repository.update_order_field(order_id, "partnerAssignmentOpen", True)
    refreshed = await delivery_job_repository.get_by_order_id(order_id)
    _notify_delivery_map(farmer_id, "job.extended", orderId=order_id)
    return {
        "success": True,
        "data": serialize_job_for_farmer(refreshed) if refreshed else None,
        "message": f"Delivery job extended by {body.minutes} minutes",
    }


async def _advance_job_order(order_id: str, farmer_id: str, target_status: str) -> dict:
    """Advance a job's order through the order-map pipeline and sync the job.

    Uses OrderService.update_order_status so validation, status history and
    customer notifications behave exactly like the order map.
    """
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("farmerId")) != farmer_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    updated = await OrderService.update_order_status(
        order_id,
        farmer_id,
        "farmer",
        OrderStatusUpdate(status=target_status),
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Order cannot move from '{order.get('orderStatus', 'unknown')}' "
                f"to '{target_status}'. Advance it through the order map pipeline first."
            ),
        )
    job = await delivery_job_repository.get_by_order_id(order_id)
    if job:
        await delivery_job_repository.sync_order_status(str(job["_id"]), target_status)
    _notify_delivery_map(farmer_id, "job.pipeline", orderId=order_id, orderStatus=target_status)
    return {
        "orderId": order_id,
        "orderStatus": target_status,
        "job": serialize_job_for_farmer(job) if job else None,
    }


@router.post("/me/delivery-map/jobs/{order_id}/process")
async def process_job_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Advance a job's order to 'processing' (same as the order map)."""
    _ensure_farmer(current_user)
    result = await _advance_job_order(order_id, str(current_user["_id"]), "processing")
    return {"success": True, "data": result, "message": "Order is now being processed"}


@router.post("/me/delivery-map/jobs/{order_id}/ready")
async def mark_job_order_ready(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Advance a job's order to 'ready_for_delivery' (same as the order map).

    Once ready, delivery partners can accept the job from their app.
    """
    _ensure_farmer(current_user)
    result = await _advance_job_order(order_id, str(current_user["_id"]), "ready_for_delivery")
    return {"success": True, "data": result, "message": "Order is ready for delivery"}



