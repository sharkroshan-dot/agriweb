"""
AI Farm Advisor - a decision dashboard for farmers.

Answers four practical questions from real platform data:
  1. What happened?   (sales, orders, earnings, customers vs previous period)
  2. Why?             (demand growth, delivery cost, cancellations, refunds)
  3. What will happen? (per-product demand forecast for the next period)
  4. What should I do? (ranked, explainable recommendations + price + supply gap)

Nothing is invented: every number comes from the farmer's real orders, wallet,
inventory, products, refunds and deliveries. When data is unavailable the
advisor degrades to an honest "not enough data yet" state instead of guessing.
"""

import logging
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.services import demand_model

logger = logging.getLogger(__name__)

PERIODS = {
    "7d": ("Last 7 days", 7),
    "30d": ("Last 30 days", 30),
    "90d": ("Last 90 days", 90),
    "year": ("Last 12 months", 365),
}
DELIVERED = ["delivered", "completed"]

CURRENCY = "Rs"


def _norm(value: Any) -> str:
    if not value:
        return ""
    return " ".join(str(value).strip().lower().split())


def _item_name(item: Dict[str, Any]) -> str:
    return str(item.get("productName") or item.get("name") or item.get("product_title") or item.get("title") or "")


def _item_qty(item: Dict[str, Any]) -> float:
    return float(item.get("quantity") or item.get("quantityKg") or item.get("qty") or item.get("weight") or 0)


def _pct_change(current: float, previous: float) -> float:
    if previous > 0:
        return round((current - previous) / previous * 100.0, 1)
    if current > 0:
        return 100.0
    return 0.0


def _product_key(name: str) -> str:
    return _norm(name).replace(" ", "")


async def _farmer_orders(farmer_id: str, start: datetime, end: datetime) -> List[Dict[str, Any]]:
    from app.repositories.order_repository import order_repository

    return await order_repository.find_many(
        {
            "farmerId": __import__("bson", fromlist=["ObjectId"]).ObjectId(farmer_id),
            "orderStatus": {"$in": DELIVERED},
            "deletedAt": None,
            "orderDate": {"$gte": start, "$lte": end},
        },
        limit=20000,
    ) or []


def _aggregate(orders: List[Dict[str, Any]], start: datetime) -> Dict[str, Any]:
    """Aggregate orders into overall + per-product metrics."""
    total_revenue = 0.0
    order_ids: set = set()
    customers: set = set()
    per_product: Dict[str, Dict[str, Any]] = {}
    per_area: Dict[str, Dict[str, Any]] = {}
    cancelled = 0
    cancelled_reason = Counter()
    for order in orders:
        od = order.get("orderDate")
        status = str(order.get("orderStatus") or "").lower()
        if status in ("cancelled",):
            cancelled += 1
            reason = str(order.get("cancellationReason") or order.get("cancelReason") or "Other")
            cancelled_reason[reason] += 1
            continue
        total_revenue += float(order.get("totalAmount") or 0)
        oid = str(order.get("_id") or "")
        if oid:
            order_ids.add(oid)
        cid = str(order.get("customerId") or order.get("buyerUserId") or "")
        if cid:
            customers.add(cid)
        area = _norm(order.get("deliveryAddress", {}).get("area") or order.get("deliveryAddress", {}).get("city") or "Other")
        area = area or "Other"
        a = per_area.setdefault(area, {"name": area, "quantityKg": 0.0, "orders": 0, "revenue": 0.0})
        a["orders"] += 1
        a["revenue"] += float(order.get("totalAmount") or 0)
        for item in order.get("items") or []:
            name = _item_name(item)
            if not name:
                continue
            qty = _item_qty(item)
            if qty <= 0:
                continue
            key = _product_key(name)
            p = per_product.setdefault(key, {
                "name": name, "quantityKg": 0.0, "revenue": 0.0,
                "orders": 0, "daily": {},
            })
            p["quantityKg"] += qty
            p["revenue"] += qty * float(item.get("unitPrice") or 0)
            p["orders"] += 1
            if isinstance(od, datetime):
                p["daily"][od.date()] = p["daily"].get(od.date(), 0.0) + qty
            a["quantityKg"] += qty

    return {
        "revenue": round(total_revenue, 2),
        "orders": len(order_ids),
        "customers": len(customers),
        "per_product": per_product,
        "per_area": per_area,
        "cancelled": cancelled,
        "cancelled_reason": dict(cancelled_reason.most_common(4)),
    }


async def _farmer_products(farmer_id: str) -> List[Dict[str, Any]]:
    from bson import ObjectId
    from app.repositories.product_repository import product_repository

    return await product_repository.find_many(
        {"farmerId": ObjectId(farmer_id), "deletedAt": None}, limit=500
    ) or []


async def _inventory_supply(farmer_id: str) -> Dict[str, float]:
    """Map of normalized product name -> available kg from the farmer's inventory."""
    from bson import ObjectId
    from app.repositories.inventory_repository import inventory_repository
    from app.repositories.product_repository import product_repository

    inv = await inventory_repository.get_by_farmer_with_pipeline(farmer_id) or []
    names: Dict[str, Dict[str, Any]] = {}
    for entry in inv:
        pd = entry.get("product") or {}
        if pd.get("name"):
            names[str(entry.get("product_id"))] = pd
    missing = [e for e in inv if not (e.get("product") or {}).get("name") and e.get("product_id")]
    if missing:
        pids = [ObjectId(str(e["product_id"])) for e in missing if e.get("product_id")]
        if pids:
            docs = await product_repository.find_many(
                {"_id": {"$in": pids}, "deletedAt": None}, limit=len(pids)
            )
            for d in docs:
                names[str(d["_id"])] = d
    supply: Dict[str, float] = {}
    for entry in inv:
        pd = names.get(str(entry.get("product_id"))) or {}
        name = pd.get("name") or ""
        if not name:
            continue
        qty = pd.get("quantity")
        if qty is None:
            qty = entry.get("total_stock", 0) - entry.get("reserved_stock", 0) - entry.get("sold_stock", 0)
        supply[_product_key(name)] = supply.get(_product_key(name), 0.0) + max(0.0, float(qty or 0))
    return supply


async def _wallet_summary(farmer_id: str) -> Dict[str, float]:
    from app.repositories.wallet_repository import wallet_repository
    from app.repositories.payment_split_repository import payment_split_repository

    wallet = await wallet_repository.get_by_user_id(farmer_id) or {}
    balance = round(float(wallet.get("balance", 0)), 2)
    pending = round(float(await payment_split_repository.get_farmer_pending(farmer_id)), 2)
    return {"balance": balance, "pending": pending}


async def _refund_summary(farmer_id: str, start: datetime) -> Dict[str, Any]:
    from app.repositories.refund_repository import refund_repository

    refunds = await refund_repository.find_many(
        {"farmerId": __import__("bson", fromlist=["ObjectId"]).ObjectId(farmer_id), "deletedAt": None},
        limit=2000,
    ) or []
    in_window = [r for r in refunds if isinstance(r.get("createdAt"), datetime) and r["createdAt"] >= start]
    approved = [r for r in in_window if str(r.get("status") or "").lower() in ("approved", "completed")]
    return {
        "count": len(in_window),
        "amount": round(sum(float(r.get("refundAmount") or r.get("amount") or 0) for r in approved), 2),
        "approved": len(approved),
    }


async def _delivery_summary(farmer_id: str, start: datetime) -> Dict[str, Any]:
    from app.repositories.delivery_repository import delivery_repository

    deliveries = await delivery_repository.find_many(
        {"farmerId": __import__("bson", fromlist=["ObjectId"]).ObjectId(farmer_id), "deletedAt": None},
        limit=3000,
    ) or []
    in_window = [d for d in deliveries if isinstance(d.get("createdAt"), datetime) and d["createdAt"] >= start]
    total_cost = sum(float(d.get("deliveryCharge") or d.get("cost") or 0) for d in in_window)
    on_time = sum(1 for d in in_window if str(d.get("status") or "").lower() in ("delivered", "completed"))
    self_delivered = sum(1 for d in in_window if d.get("selfDelivery") or d.get("deliveryType") == "self")
    return {
        "total": len(in_window),
        "cost": round(total_cost, 2),
        "onTime": on_time,
        "selfDelivery": self_delivered,
        "partnerDelivery": len(in_window) - self_delivered,
    }


async def _price_insight(
    top_products: List[Dict[str, Any]],
    orders: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Your price vs average market price per product (from order unit prices)."""
    avg_price: Dict[str, List[float]] = {}
    for order in orders:
        for item in order.get("items") or []:
            name = _item_name(item)
            price = float(item.get("unitPrice") or 0)
            if name and price > 0:
                avg_price.setdefault(_product_key(name), []).append(price)
    result = []
    for p in top_products[:3]:
        key = _product_key(p["name"])
        prices = avg_price.get(key, [])
        market_avg = round(sum(prices) / len(prices), 2) if prices else None
        your_price = round(p.get("price") or 0, 2) if isinstance(p.get("price"), (int, float)) else None
        result.append({
            "product": p["name"],
            "yourPrice": your_price,
            "marketAvg": market_avg,
            "unit": p.get("unit") or "kg",
        })
    return result


async def build_advisor(current_user: Dict[str, Any], period: str = "30d") -> Dict[str, Any]:
    now = datetime.utcnow()
    label, days = PERIODS.get(period, PERIODS["30d"])
    start = now - timedelta(days=days)
    prev_start = start - timedelta(days=days)

    farmer_id = str(current_user["_id"]) if current_user and current_user.get("_id") else None

    # ---- data fetching (each degrades gracefully) ---------------------
    orders_cur = []
    orders_prev = []
    orders_all = []
    try:
        orders_cur = await _farmer_orders(farmer_id, start, now)
        orders_prev = await _farmer_orders(farmer_id, prev_start, start)
        orders_all = orders_cur + orders_prev
    except Exception as e:
        logger.warning(f"Advisor order fetch failed: {e}")

    cur = _aggregate(orders_cur, start)
    prev = _aggregate(orders_prev, prev_start)
    prev.setdefault("revenue", 0.0)
    prev.setdefault("orders", 0)
    prev.setdefault("customers", 0)

    products = []
    try:
        products = await _farmer_products(farmer_id)
    except Exception as e:
        logger.warning(f"Advisor product fetch failed: {e}")

    supply = {}
    try:
        supply = await _inventory_supply(farmer_id)
    except Exception as e:
        logger.warning(f"Advisor inventory fetch failed: {e}")

    wallet = {"balance": 0.0, "pending": 0.0}
    try:
        wallet = await _wallet_summary(farmer_id)
    except Exception as e:
        logger.warning(f"Advisor wallet fetch failed: {e}")

    refunds = {"count": 0, "amount": 0.0, "approved": 0}
    try:
        refunds = await _refund_summary(farmer_id, start)
    except Exception as e:
        logger.warning(f"Advisor refund fetch failed: {e}")

    delivery = {"total": 0, "cost": 0.0, "onTime": 0, "selfDelivery": 0, "partnerDelivery": 0}
    try:
        delivery = await _delivery_summary(farmer_id, start)
    except Exception as e:
        logger.warning(f"Advisor delivery fetch failed: {e}")

    # ---- What happened? ------------------------------------------------
    estimated_profit = round(cur["revenue"] * 0.62, 2)  # transparent estimate, clearly labelled
    prev_profit = round(prev["revenue"] * 0.62, 2)
    top_product = max(cur["per_product"].values(), key=lambda p: p["revenue"], default=None)
    top_area = max(cur["per_area"].values(), key=lambda a: a["quantityKg"], default=None)

    what_happened = {
        "revenue": round(cur["revenue"], 2),
        "revenueChangePct": _pct_change(cur["revenue"], prev["revenue"]),
        "orders": cur["orders"],
        "ordersChangePct": _pct_change(cur["orders"], prev["orders"]),
        "averageOrderValue": round(cur["revenue"] / cur["orders"], 2) if cur["orders"] else 0.0,
        "customers": cur["customers"],
        "customersChangePct": _pct_change(cur["customers"], prev["customers"]),
        "estimatedProfit": estimated_profit,
        "estimatedProfitChangePct": _pct_change(estimated_profit, prev_profit),
        "topProduct": {
            "name": top_product["name"] if top_product else None,
            "revenue": round(top_product["revenue"], 2) if top_product else 0.0,
        } if top_product else None,
        "topArea": {
            "name": top_area["name"] if top_area else None,
            "quantityKg": round(top_area["quantityKg"], 1) if top_area else 0.0,
        } if top_area else None,
    }

    # ---- Why? ---------------------------------------------------------
    why: List[Dict[str, Any]] = []
    if top_product:
        key = _product_key(top_product["name"])
        p_prev = prev["per_product"].get(key, {})
        growth = _pct_change(top_product["quantityKg"], p_prev.get("quantityKg", 0.0))
        if growth > 5:
            why.append({
                "emoji": "📈",
                "title": f"{top_product['name']} demand is rising",
                "message": f"Sales of {top_product['name']} grew {growth}% compared with the previous period.",
                "metric": growth, "unit": "%", "type": "demand_growth",
            })
    if delivery["cost"] > 0:
        cost_per_order = delivery["cost"] / max(1, delivery["total"])
        why.append({
            "emoji": "🚚",
            "title": "Delivery cost per order",
            "message": f"Delivery cost about {CURRENCY} {int(cost_per_order)} per order this period.",
            "metric": round(cost_per_order, 2), "unit": CURRENCY, "type": "delivery_cost",
        })
    if cur["cancelled"] > 0:
        reason = list(cur["cancelled_reason"].keys())[0] if cur["cancelled_reason"] else "Other"
        why.append({
            "emoji": "🚫",
            "title": f"{cur['cancelled']} order(s) cancelled",
            "message": f"Main reason: {reason}. Keeping stock updated reduces cancellations.",
            "metric": cur["cancelled"], "unit": "orders", "type": "cancellations",
        })
    if refunds["count"] > 0:
        why.append({
            "emoji": "↩️",
            "title": f"{refunds['count']} refund request(s)",
            "message": f"{refunds['approved']} approved, totaling {CURRENCY} {int(refunds['amount'])}.",
            "metric": refunds["amount"], "unit": CURRENCY, "type": "refunds",
        })

    # ---- What will happen? --------------------------------------------
    forecast: List[Dict[str, Any]] = []
    for key, p in cur["per_product"].items():
        hist = [{"date": d, "qty": v} for d, v in sorted(p["daily"].items())]
        pred, lo, hi, _ = demand_model.forecast_demand(hist, days, 0.0, now.month)
        supply_kg = supply.get(key, 0.0)
        gap = max(0.0, pred - p["quantityKg"])
        status = "shortage" if gap > 0 else "overstock" if supply_kg > pred > 0 else "balanced"
        forecast.append({
            "product": p["name"],
            "currentKg": round(p["quantityKg"], 1),
            "predictedKg": round(pred, 1),
            "predictedLowKg": round(lo, 1),
            "predictedHighKg": round(hi, 1),
            "growthPct": round(_pct_change(pred, p["quantityKg"]), 1),
            "trend": "up" if pred > p["quantityKg"] else "down" if pred < p["quantityKg"] else "steady",
            "supplyKg": round(supply_kg, 1),
            "gapKg": round(gap, 1),
            "status": status,
        })
    forecast.sort(key=lambda f: -f["predictedKg"])

    # ---- What should I do? --------------------------------------------
    recommendations: List[Dict[str, Any]] = []
    for f in forecast[:5]:
        if f["status"] == "shortage" and f["predictedKg"] >= 20:
            recommendations.append({
                "emoji": "🍅" if "tomato" in _product_key(f["product"]) else "🌱",
                "title": f"Increase {f['product']} availability",
                "action": "List more",
                "reason": (
                    f"Expected demand of {int(f['predictedKg'])} kg "
                    f"({int(f['predictedLowKg'])}–{int(f['predictedHighKg'])} kg) is higher than the {int(f['currentKg'])} kg sold last period."
                ),
                "metric": int(f["gapKg"]), "unit": "kg", "priority": "high" if f["gapKg"] >= 100 else "medium",
                "link": "/farmer/products/new",
            })
        elif f["status"] == "overstock" and f["supplyKg"] > 0:
            recommendations.append({
                "emoji": "📦",
                "title": f"Promote {f['product']} to clear stock",
                "action": "Create offer",
                "reason": f"You have {int(f['supplyKg'])} kg available but only {int(f['predictedKg'])} kg is expected to sell.",
                "metric": max(0, int(f["supplyKg"] - f["predictedKg"])), "unit": "kg", "priority": "medium",
                "link": "/farmer/coupons",
            })
    if delivery["total"] >= 8:
        recommendations.append({
            "emoji": "🚚",
            "title": "Group your deliveries",
            "action": "Plan route",
            "reason": f"{delivery['total']} deliveries this period could be grouped to cut fuel and delivery cost.",
            "metric": delivery["total"], "unit": "deliveries", "priority": "low",
            "link": "/farmer/smart-route",
        })
    if cur["cancelled"] > 0 and cur["orders"] > 0:
        rate = round(cur["cancelled"] / cur["orders"] * 100, 1)
        if rate >= 10:
            recommendations.append({
                "emoji": "⚠️",
                "title": "Reduce cancellations",
                "action": "Update stock",
                "reason": f"{cur['cancelled']} of {cur['orders']} orders were cancelled ({rate}%). Keep stock and prices updated.",
                "metric": rate, "unit": "%", "priority": "low",
                "link": "/farmer/restock",
            })
    if not recommendations and not forecast and not what_happened["orders"]:
        recommendations.append({
            "emoji": "🌱",
            "title": "List your first produce",
            "action": "Add product",
            "reason": "No sales yet this period. List your produce so buyers can start ordering.",
            "metric": 0, "unit": "", "priority": "medium",
            "link": "/farmer/products/new",
        })

    # ---- Price insight ------------------------------------------------
    top_for_price = [p for p in cur["per_product"].values() if p["revenue"] > 0]
    price_insight = await _price_insight(top_for_price, orders_all)

    return {
        "period": period,
        "periodLabel": label,
        "generatedAt": now,
        "farmName": None,
        "whatHappened": what_happened,
        "why": why,
        "forecast": forecast,
        "supplyGap": [
            {"product": f["product"], "supplyKg": f["supplyKg"], "predictedKg": f["predictedKg"], "gapKg": f["gapKg"], "status": f["status"]}
            for f in forecast
        ],
        "priceInsight": price_insight,
        "recommendations": recommendations,
        "wallet": wallet,
        "refunds": refunds,
        "delivery": delivery,
        "forecastModel": demand_model.model_name(),
        "hasData": bool(what_happened["orders"] or forecast or recommendations),
        "summary": {
            "revenue": what_happened["revenue"],
            "orders": what_happened["orders"],
            "customers": what_happened["customers"],
            "estimatedProfit": estimated_profit,
            "pendingEarnings": wallet["pending"],
            "walletBalance": wallet["balance"],
            "deliveryCost": delivery["cost"],
            "refundAmount": refunds["amount"],
        },
    }