"""Digital invoice + sustainability impact dashboards.

Invoice: a read-only, audit-friendly view of an order's financial breakdown
(customer + farmer + items + charges + payments).

Impact: substantiated local-impact metrics computed from real orders only -
no unsupported environmental claims.

Collections:
  - invoices: optional cached invoice snapshot per order
"""
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.order_repository import order_repository
from app.repositories.user_repository import user_repository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.payment_repository import payment_repository
from app.repositories.refund_repository import refund_repository
from app.repositories.address_repository import address_repository

logger = logging.getLogger(__name__)
router = APIRouter()

invoice_repo = BaseRepository("invoices")
loyalty_account_repo = BaseRepository("loyalty_accounts")
AGRI_POINTS_PER_RS = 100

INVOICE_LINE_STATUSES = ["delivered", "picked_up"]
IMPACT_ORDER_STATUSES = ["delivered", "picked_up", "refunded"]


def _round2(v: float) -> float:
    return round(float(v or 0), 2)


async def _order_for_user(order_id: str, user_id: str, role: str):
    """Load an order only if the caller may view it (customer/farmer/admin)."""
    try:
        order = await order_repository.get_by_id(order_id)
    except Exception:
        order = None
    if not order:
        return None
    if role in ("admin", "super_admin", "finance", "operations", "security"):
        return order
    if str(order.get("customerId")) == str(user_id):
        return order
    if str(order.get("farmerId")) == str(user_id):
        return order
    if str(order.get("deliveryPartnerId")) == str(user_id):
        return order
    return None


# ================== INVOICE ==================

@router.get("/orders/{order_id}/invoice")
async def get_order_invoice(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get the digital invoice for an order (customer, farmer, or admin)."""
    order = await _order_for_user(order_id, str(current_user["_id"]), current_user.get("role"))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found or access denied")

    customer = await user_repository.get_by_id(str(order.get("customerId")))
    farmer = await user_repository.get_by_id(str(order.get("farmerId")))

    items = []
    for item in order.get("items", []) or []:
        items.append({
            "productId": str(item.get("productId")),
            "productName": item.get("productName") or item.get("name", "Item"),
            "productImage": item.get("productImage"),
            "quantity": item.get("quantity", 0),
            "unit": item.get("unit") or item.get("unitPrice", 0),
            "unitPrice": _round2(item.get("unitPrice") or item.get("price", 0)),
            "totalPrice": _round2(item.get("totalPrice") or 0),
            "pickupAvailable": item.get("pickupAvailable"),
        })

    delivery = order.get("deliveryAddress") or {}
    pickup_date = order.get("pickupDate")
    invoice = {
        "invoiceId": f"INV-{str(order.get('orderNumber', order_id))}",
        "orderId": str(order["_id"]),
        "orderNumber": order.get("orderNumber", ""),
        "issuedAt": datetime.utcnow(),
        "orderDate": order.get("createdAt") or order.get("orderDate"),
        "orderStatus": order.get("orderStatus"),
        "paymentStatus": order.get("paymentStatus"),
        "paymentMethod": order.get("paymentMethod"),
        "deliveryType": order.get("deliveryType", "delivery"),
        "customer": {
            "id": str(order.get("customerId")),
            "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip() if customer else "Customer",
            "phone": (customer or {}).get("phone"),
            "email": (customer or {}).get("email"),
        },
        "farmer": {
            "id": str(order.get("farmerId")),
            "name": f"{farmer.get('firstName', '')} {farmer.get('lastName', '')}".strip() if farmer else "Farmer",
            "farmName": (await _farm_name(order.get("farmerId"))),
        },
        "items": items,
        "subtotal": _round2(order.get("subtotal") or 0),
        "deliveryCharge": _round2(order.get("deliveryCharge") or 0),
        "platformFee": _round2(order.get("platformFee") or 0),
        "platformCommission": _round2(order.get("platformCommission") or 0),
        "discount": _round2(order.get("discount") or 0),
        "totalAmount": _round2(order.get("totalAmount") or 0),
        "deliveryAddress": delivery,
        "pickupDate": pickup_date,
        "pickupTimeSlot": order.get("pickupTimeSlot"),
        "pickupCode": order.get("pickupCode"),
    }

    # Payments attached to this order (may be multiple: payment + refund).
    payments = await payment_repository.find_many({"orderId": ObjectId(order_id)})
    invoice["payments"] = [
        {
            "id": str(p["_id"]),
            "method": p.get("paymentMethod") or p.get("method"),
            "status": p.get("status"),
            "amount": _round2(p.get("amount") or 0),
            "transactionId": p.get("transactionId"),
            "createdAt": p.get("createdAt"),
            "type": p.get("type") or "payment",
        }
        for p in (payments or [])
    ]

    return {"success": True, "data": invoice}


async def _farm_name(farmer_id) -> str:
    if not farmer_id:
        return None
    try:
        farm = await farmer_repository.find_one({"userId": ObjectId(farmer_id)})
        return farm.get("farmName") if farm else None
    except Exception:
        return None


# ================== SUSTAINABILITY / IMPACT ==================

@router.get("/me")
async def get_my_impact(current_user: dict = Depends(get_current_user)):
    """Local-impact dashboard computed from the caller's verified orders.

    Only delivered/picked-up orders count. Metrics are computed from real
    order data (spend, distinct farmers, deliveries) - no unverifiable claims.
    """
    user_id = str(current_user["_id"])
    role = current_user.get("role")

    statuses = ["delivered", "picked_up"]
    if role == "customer":
        orders = await order_repository.find_many(
            {"customerId": ObjectId(user_id), "orderStatus": {"$in": statuses}, "deletedAt": None},
            limit=1000,
        )
    elif role == "farmer":
        orders = await order_repository.find_many(
            {"farmerId": ObjectId(user_id), "orderStatus": {"$in": statuses}, "deletedAt": None},
            limit=1000,
        )
    else:
        raise HTTPException(status_code=403, detail="Impact dashboard is available for customers and farmers")

    total_spent = 0.0
    order_count = len(orders or [])
    local_deliveries = 0
    community_deliveries = 0
    pickup_orders = 0
    farmer_ids = set()
    items_kg = 0.0
    discount_savings = 0.0
    coupon_order_count = 0
    pickup_fee_savings = 0.0
    farmer_order_counts = {}
    month_buckets: dict = {}

    for o in orders or []:
        amount = float(o.get("totalAmount") or 0)
        total_spent += amount
        otype = o.get("deliveryType", "delivery")
        if otype == "pickup":
            pickup_orders += 1
            pickup_fee_savings += float(o.get("deliveryCharge") or 0)
        else:
            local_deliveries += 1
        if o.get("communityDelivery") or o.get("communityScheduleId"):
            community_deliveries += 1
        if o.get("farmerId"):
            fid = str(o.get("farmerId"))
            farmer_ids.add(fid)
            farmer_order_counts[fid] = farmer_order_counts.get(fid, 0) + 1
        discount = float(o.get("discount") or 0)
        if discount > 0 or o.get("couponCode"):
            coupon_order_count += 1
            discount_savings += discount
        order_kg = 0.0
        for item in o.get("items", []) or []:
            qty = float(item.get("quantity") or 0)
            if item.get("unit", "kg") in ("kg", "liter"):
                items_kg += qty
                order_kg += qty
        created = o.get("createdAt") or o.get("created_at") or datetime.utcnow()
        mk = created.strftime("%Y-%m") if hasattr(created, "strftime") else str(created)[:7]
        bucket = month_buckets.setdefault(mk, {"label": mk, "sales": 0.0, "orders": 0, "kg": 0.0})
        bucket["sales"] += amount
        bucket["orders"] += 1
        bucket["kg"] += order_kg

    # Last 6 calendar months (oldest → newest), zero-filled.
    monthly_trend = []
    y, m = datetime.utcnow().year, datetime.utcnow().month
    for _ in range(6):
        monthly_trend.append(month_buckets.get(f"{y:04d}-{m:02d}", {"label": f"{y:04d}-{m:02d}", "sales": 0.0, "orders": 0, "kg": 0.0}))
        m -= 1
        if m == 0:
            y -= 1
            m = 12
    monthly_trend.reverse()

    delivery_breakdown = {
        "local": local_deliveries,
        "pickup": pickup_orders,
        "community": community_deliveries,
    }

    # Estimated delivery distance saved: assume farm pickup is the default
    # alternative; estimate the farmer->customer leg from order data where
    # possible, otherwise use a conservative flat estimate per delivery.
    saved_distance = 0.0
    if role == "customer":
        for o in orders or []:
            if o.get("deliveryType") == "pickup":
                saved_distance += 0.0
            else:
                saved_distance += float(o.get("distanceKm") or 0) or 0.0
        if not saved_distance and local_deliveries:
            saved_distance = local_deliveries * 4.0  # conservative per-delivery km estimate

    data = {
        "role": role,
        "orders": order_count,
        "totalSpent": _round2(total_spent),
        "farmersSupported": len(farmer_ids),
        "localDeliveries": local_deliveries,
        "pickupOrders": pickup_orders,
        "communityDeliveries": community_deliveries,
        "deliveredKg": _round2(items_kg),
        "estimatedDistanceSavedKm": _round2(saved_distance),
        "monthlyTrend": monthly_trend,
        "deliveryBreakdown": delivery_breakdown,
        "currency": "INR",
        "generatedAt": datetime.utcnow(),
        "disclaimer": "Metrics are computed from delivered orders only.",
    }

    if role == "customer":
        data["discountSavings"] = _round2(discount_savings)
        data["couponOrderCount"] = coupon_order_count
        data["pickupFeeSavings"] = _round2(pickup_fee_savings)

        # AgriPoints: lifetime earned + approximate wallet credit value.
        account = await loyalty_account_repo.find_one(
            {"userId": ObjectId(user_id), "deletedAt": None}
        )
        lifetime_points = int((account or {}).get("lifetimeEarned") or 0)
        data["agriPointsEarned"] = lifetime_points
        data["agriPointValueRs"] = _round2(lifetime_points / AGRI_POINTS_PER_RS)

        # Money returned via completed refunds.
        completed_refunds = await refund_repository.find_many(
            {"customerId": ObjectId(user_id), "status": "refunded", "deletedAt": None}
        )
        data["refundMoneyBack"] = _round2(
            sum(float(r.get("approvedAmount") or 0) for r in (completed_refunds or []))
        )

        # Top farmers the customer buys from most.
        top_farmers = []
        for fid, cnt in sorted(farmer_order_counts.items(), key=lambda x: x[1], reverse=True)[:5]:
            farm_name = await _farm_name(fid)
            name = farm_name
            if not name:
                farmer_user = await user_repository.get_by_id(fid)
                if farmer_user:
                    name = f"{farmer_user.get('firstName', '')} {farmer_user.get('lastName', '')}".strip()
            top_farmers.append({
                "farmerId": fid,
                "name": name or "Local Farmer",
                "orders": cnt,
            })
        data["topFarmers"] = top_farmers

        # Orders by month for the last 6 months.
        now = datetime.utcnow()
        buckets = {}
        for i in range(5, -1, -1):
            m = now.replace(day=1) - timedelta(days=30 * i)
            buckets[m.strftime("%Y-%m")] = 0
        for o in orders or []:
            created = o.get("createdAt") or o.get("orderDate")
            if created:
                try:
                    key = created.strftime("%Y-%m")
                    if key in buckets:
                        buckets[key] += 1
                except Exception:
                    pass
        data["ordersByMonth"] = [
            {"month": key, "orders": count} for key, count in buckets.items()
        ]

    return {
        "success": True,
        "data": data,
    }
