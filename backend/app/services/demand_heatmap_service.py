"""
Data-driven Demand Intelligence engine for the AgriConnect AI demand heatmap.

Pipeline:
  Customer orders (MongoDB, all farmers, delivered/completed)
    -> per-area aggregation (quantity, orders, unique customers, growth,
       customer-type segments, daily series)
    -> demand forecast for the next period (gradient-boosted model or a
       transparent statistical baseline)
    -> weighted demand score + explainable ranking of "where should I sell?"
    -> honest cold-start fallback ("early estimate") when there is no history

No fake values are invented: cold-start areas use real city coordinates for
distance and a transparent category baseline, clearly labelled as an early
estimate with low confidence.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

from app.services.bulk_order_service import haversine_km
from app.services import demand_model

logger = logging.getLogger(__name__)

# Real coordinates for major Indian cities. Used ONLY for honest distance
# estimates from the farm to an area (never for fake demand values).
CITY_COORDS: Dict[str, tuple] = {
    "Mumbai": (72.8777, 19.0760), "Pune": (73.8567, 18.5204), "Nagpur": (79.0882, 21.1458),
    "Nashik": (73.7898, 19.9975), "Aurangabad": (75.3433, 19.8762), "Solapur": (75.9104, 17.6599),
    "Lucknow": (80.9462, 26.8467), "Kanpur": (80.3319, 26.4499), "Varanasi": (82.9739, 25.3176),
    "Agra": (78.0081, 27.1767), "Prayagraj": (81.8463, 25.4358),
    "Chandigarh": (76.7794, 30.7333), "Ludhiana": (75.8573, 30.9010),
    "Amritsar": (74.8723, 31.6340), "Jalandhar": (75.5762, 31.3260), "Patiala": (76.3868, 30.3398),
    "Chennai": (80.2707, 13.0827), "Coimbatore": (76.9558, 11.0168),
    "Madurai": (78.1198, 9.9252), "Tiruchirappalli": (78.7047, 10.7905), "Salem": (78.1620, 11.6643),
    "Bengaluru": (77.5946, 12.9716), "Mysuru": (76.6394, 12.2958),
    "Hubli": (75.1239, 15.3647), "Mangaluru": (74.8560, 12.9141), "Belagavi": (74.4979, 15.8497),
    "Ahmedabad": (72.5714, 23.0225), "Surat": (72.8311, 21.1702), "Vadodara": (73.1812, 22.3072),
    "Rajkot": (70.8022, 22.3039), "Bhavnagar": (72.1397, 21.7645),
    "Delhi": (77.1025, 28.7041), "Hyderabad": (78.4867, 17.3850), "Kolkata": (88.3639, 22.5726),
    "Jaipur": (75.7873, 26.9124), "Bhopal": (77.4126, 23.2599), "Indore": (75.8577, 22.7196),
    "Patna": (85.1376, 25.5941), "Bhubaneswar": (85.8245, 20.2961),
    "Thiruvananthapuram": (76.9366, 8.5241), "Kochi": (76.2711, 10.0860),
    "Guwahati": (91.7362, 26.1445), "Dehradun": (78.0322, 30.3165), "Ranchi": (85.3096, 23.3441),
}

CITY_BY_STATE: Dict[str, List[str]] = {
    "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik", "Aurangabad", "Solapur"],
    "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Agra", "Prayagraj"],
    "Punjab": ["Chandigarh", "Ludhiana", "Amritsar", "Jalandhar", "Patiala"],
    "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem"],
    "Karnataka": ["Bengaluru", "Mysuru", "Hubli", "Mangaluru", "Belagavi"],
    "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar"],
    "Delhi": ["Delhi"], "West Bengal": ["Kolkata"], "Telangana": ["Hyderabad"],
    "Rajasthan": ["Jaipur"], "Madhya Pradesh": ["Bhopal", "Indore"], "Bihar": ["Patna"],
    "Odisha": ["Bhubaneswar"], "Kerala": ["Thiruvananthapuram", "Kochi"],
    "Assam": ["Guwahati"], "Uttarakhand": ["Dehradun"], "Jharkhand": ["Ranchi"],
    "Andhra Pradesh": ["Hyderabad"],
}

# Transparent per-category baseline daily demand (kg) used ONLY for the
# cold-start "early estimate" path when there is no order history yet.
CATEGORY_BASELINE_KG = {"vegetables": 35, "fruits": 20, "grains": 50, "dairy": 15}

# Demand score weights (transparent, tunable). Normalized 0..1 components.
DEMAND_WEIGHTS = {"quantity": 0.30, "frequency": 0.20, "customers": 0.15, "trend": 0.15, "predicted": 0.20}

DELIVERED_STATUSES = ["delivered", "completed"]
PERIOD_DAYS = {"today": 1, "3d": 3, "7d": 7, "30d": 30, "3m": 90}


# ----------------------------- helpers -----------------------------

def _norm(value: Any) -> str:
    if not value:
        return ""
    return " ".join(str(value).strip().lower().split())


def _item_name(item: Dict[str, Any]) -> str:
    return str(item.get("productName") or item.get("name") or item.get("product_title") or item.get("title") or "")


def _item_qty(item: Dict[str, Any]) -> float:
    return float(item.get("quantity") or item.get("quantityKg") or item.get("qty") or item.get("weight") or 0)


def _segment_of(order: Dict[str, Any]) -> str:
    """Classify an order into household / bulk_event / b2b."""
    if order.get("businessUserId"):
        return "b2b"
    buyer = _norm(order.get("buyerType"))
    rtype = _norm(order.get("requestType"))
    if buyer == "business" or rtype == "b2b":
        return "b2b"
    if order.get("requestId") or rtype == "bulk_event" or buyer == "bulk_event":
        return "bulk_event"
    return "household"


def _confidence(order_count: int, qty: float, hist_len: int) -> tuple:
    if order_count >= 15 and qty >= 50 and hist_len >= 21:
        return "high", None
    if order_count >= 5:
        return "medium", "Moderate order history"
    return "low", "Limited historical data — early estimate"


async def _resolve_farm(farmer_id: Optional[str]) -> Dict[str, Any]:
    from bson import ObjectId
    from app.repositories.farmer_repository import farmer_repository
    from app.repositories.user_repository import user_repository

    farm = {"name": "My Farm", "lat": None, "lng": None, "city": "", "state": "", "address": ""}
    if not farmer_id:
        return farm
    try:
        profile = await farmer_repository.find_one({"userId": ObjectId(farmer_id)})
    except Exception:
        profile = None
    if profile:
        farm["name"] = profile.get("farmName") or farm["name"]
        farm["address"] = profile.get("farmAddress") or ""
        farm["city"] = profile.get("farmCity") or profile.get("city") or ""
        farm["state"] = profile.get("farmState") or profile.get("state") or ""
        loc = profile.get("farmLocation") or profile.get("location")
        coords = (loc or {}).get("coordinates") if isinstance(loc, dict) else None
        if coords and len(coords) >= 2:
            farm["lng"], farm["lat"] = float(coords[0]), float(coords[1])
    if farm["lat"] is None:
        try:
            user = await user_repository.find_one({"_id": ObjectId(farmer_id)})
            if user:
                if farm["name"] == "My Farm":
                    farm["name"] = user.get("name") or user.get("firstName") or farm["name"]
                farm["city"] = farm["city"] or user.get("city") or ""
                farm["state"] = farm["state"] or user.get("state") or ""
                loc = user.get("farmLocation") or user.get("location")
                coords = (loc or {}).get("coordinates") if isinstance(loc, dict) else None
                if coords and len(coords) >= 2:
                    farm["lng"], farm["lat"] = float(coords[0]), float(coords[1])
        except Exception:
            pass
    return farm


async def _build_product_filter(
    orders: List[Dict[str, Any]],
    product: Optional[str],
    category: Optional[str],
) -> Optional[Set[str]]:
    """Return the set of normalized product names to keep, or None for all."""
    names: Set[str] = set()
    for order in orders or []:
        for item in order.get("items") or []:
            n = _norm(_item_name(item))
            if n:
                names.add(n)
    if not names:
        return None

    if product:
        p = _norm(product)
        matched = {n for n in names if p in n or n in p}
        return matched or None

    if category and _norm(category) != "all":
        wanted = _norm(category)
        try:
            from bson import ObjectId
            from app.repositories.product_repository import product_repository
            from app.repositories.category_repository import category_repository

            docs = await product_repository.find_many({"deletedAt": None}, limit=5000)
            name_to_cat: Dict[str, str] = {}
            for d in docs:
                name_to_cat.setdefault(_norm(d.get("name") or ""), str(d.get("categoryId") or ""))
            cats = await category_repository.find_many({"deletedAt": None}, limit=1000)
            cat_id_to_name = {
                str(c["_id"]): _norm(c.get("name") or "") for c in cats
            }
            result: Set[str] = set()
            for n in names:
                cid = name_to_cat.get(n, "")
                cat_name = cat_id_to_name.get(cid, "")
                if wanted in cat_name:
                    result.add(n)
            return result or None
        except Exception:
            return None
    return None


async def _farmer_supply(
    farmer_id: Optional[str],
    product: Optional[str],
    prod_filter: Optional[Set[str]],
) -> float:
    """Farmer's currently available stock (kg) matching the selection."""
    if not farmer_id:
        return 0.0
    try:
        from bson import ObjectId
        from app.repositories.inventory_repository import inventory_repository
        from app.repositories.product_repository import product_repository

        inv = await inventory_repository.get_by_farmer_with_pipeline(farmer_id) or []
        names_by_id: Dict[str, Dict[str, Any]] = {}
        for entry in inv:
            pd = entry.get("product") or {}
            if pd.get("name"):
                names_by_id[str(entry.get("product_id"))] = pd
        missing = [e for e in inv if not (e.get("product") or {}).get("name") and e.get("product_id")]
        if missing:
            pids = [ObjectId(str(e["product_id"])) for e in missing if e.get("product_id")]
            if pids:
                docs = await product_repository.find_many(
                    {"_id": {"$in": pids}, "deletedAt": None}, limit=len(pids)
                )
                for d in docs:
                    names_by_id[str(d["_id"])] = d

        total = 0.0
        for entry in inv:
            pid = str(entry.get("product_id"))
            pd = names_by_id.get(pid) or {}
            name = _norm(pd.get("name") or "")
            if not name:
                continue
            if prod_filter is not None and name not in prod_filter:
                continue
            if product and _norm(product) not in name and name not in _norm(product):
                continue
            qty = pd.get("quantity")
            if qty is None:
                qty = entry.get("total_stock", 0) - entry.get("reserved_stock", 0) - entry.get("sold_stock", 0)
            total += max(0.0, float(qty or 0))
        return round(total, 1)
    except Exception as e:
        logger.warning(f"Demand supply lookup failed: {e}")
        return 0.0


# ----------------------------- scoring -----------------------------

def _mode_value(loc: Dict[str, Any], mode: str) -> tuple:
    mode = (mode or "demand").lower()
    if mode == "predicted":
        return round(loc["predictedDemandKg"], 1), "kg", "predicted demand"
    if mode == "growth":
        return round(loc["growthPct"], 1), "%", "demand growth"
    if mode == "gap":
        return round(loc["gapKg"], 1), "kg", "unmet demand"
    seg = loc["_seg"]
    if mode == "b2b":
        return round(seg.get("b2b", 0.0), 1), "kg", "B2B demand"
    if mode == "bulk":
        return round(seg.get("bulk_event", 0.0), 1), "kg", "bulk/event demand"
    if mode == "household":
        return round(seg.get("household", 0.0), 1), "kg", "household demand"
    return round(loc["demandScore"], 2), "score", "demand intensity"


def _opportunity(loc: Dict[str, Any], radius: int, supply_share: float) -> tuple:
    gap = loc["gapKg"]
    conf = loc["confidence"]
    dist = loc["distanceKm"]
    if gap <= 0:
        return "LOW", 0.0
    if conf == "low":
        level = "MEDIUM"
    elif dist is not None and dist > radius:
        level = "MEDIUM"
    else:
        level = "HIGH" if gap >= 150 else "MEDIUM"
    rec = min(gap, supply_share) if supply_share > 0 else 0.0
    return level, round(max(0.0, rec), 1)


def _reasons(loc: Dict[str, Any]) -> List[str]:
    reasons: List[str] = []
    g = loc["growthPct"]
    if g > 5:
        reasons.append(f"Demand is growing +{round(g)}%")
    elif g < -5:
        reasons.append(f"Demand is slowing ({round(g)}%)")
    else:
        reasons.append("Demand is steady")
    rng = loc.get("predictedRange") or {}
    reasons.append(
        f"Expected demand: {int(loc['predictedDemandKg'])} kg "
        f"(range {int(rng.get('low', 0))}–{int(rng.get('high', 0))} kg)"
    )
    if loc["gapKg"] > 0:
        reasons.append(f"Unmet demand: {int(loc['gapKg'])} kg")
    else:
        reasons.append("No unmet demand expected")
    if loc["distanceKm"] is not None:
        reasons.append(f"Distance from farm: {round(loc['distanceKm'])} km")
    else:
        reasons.append("Distance unknown — check delivery range")
    reasons.append(f"Confidence: {loc['confidence'].title()}")
    return reasons


# ----------------------------- cold start -----------------------------

def _cold_start_rows(
    request,
    farm: Dict[str, Any],
    prod_filter: Optional[Set[str]],
    period_days: int,
    radius: int,
    now: datetime,
) -> List[Dict[str, Any]]:
    cities = CITY_BY_STATE.get(request.state or "", list(CITY_COORDS.keys())[:10])
    if not cities:
        cities = list(CITY_COORDS.keys())[:10]
    cities = cities[:8]
    base_daily = CATEGORY_BASELINE_KG.get(_norm(request.category) or "vegetables", 25)
    pred = base_daily * period_days
    rows: List[Dict[str, Any]] = []
    for city in cities:
        coords = CITY_COORDS.get(city)
        dist = None
        if coords and farm.get("lat") is not None and farm.get("lng") is not None:
            dist = haversine_km(farm["lat"], farm["lng"], coords[1], coords[0])
        rows.append({
            "name": city, "city": city, "state": request.state,
            "qtyCur": 0.0, "qtyPrev": 0.0, "growth": 0.0,
            "pred": pred, "lo": pred * 0.7, "hi": pred * 1.3,
            "dist": dist,
            "dist_score": (1.0 - min(1.0, (dist or radius * 0.6) / radius)) if dist is not None else 0.5,
            "order_count": 0, "uniq": 0, "freq": 0.0,
            "seg": {"household": 0.0, "bulk_event": 0.0, "b2b": 0.0},
            "top": [p.title() for p in list(prod_filter or ["Tomato", "Onion", "Potato", "Wheat", "Rice"])[:5]],
            "supply": 0.0, "gap": 0.0, "hist_len": 0,
            "cold": True,
        })
    return rows


# ----------------------------- main -----------------------------

async def build_demand_heatmap(request, current_user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    now = datetime.utcnow()
    period = (request.period or "7d")
    period_days = PERIOD_DAYS.get(period, 7)
    radius = max(1, int(request.radiusKm or 50))
    mode = (request.mode or "demand").lower()
    period_label = {
        "today": "Today", "3d": "Next 3 days", "7d": "Next 7 days",
        "30d": "Next 30 days", "3m": "Next 3 months",
    }.get(period, "Next 7 days")

    farmer_id = str(current_user["_id"]) if current_user and current_user.get("_id") else None
    farm = await _resolve_farm(farmer_id)

    rows: List[Dict[str, Any]] = []
    lookback = 0
    try:
        from app.repositories.order_repository import order_repository

        lookback = max(60, min(180, period_days * 3))
        start = now - timedelta(days=lookback)
        prev_start = start - timedelta(days=lookback)

        orders = await order_repository.find_many({
            "orderStatus": {"$in": DELIVERED_STATUSES},
            "deletedAt": None,
            "orderDate": {"$gte": prev_start, "$lte": now},
        }, limit=20000) or []

        prod_filter = await _build_product_filter(orders, request.product, request.category)

        agg: Dict[str, Dict[str, Any]] = {}
        for order in orders:
            od = order.get("orderDate")
            if not isinstance(od, datetime):
                continue
            is_prev = od < start
            seg = _segment_of(order)
            cust_key = str(order.get("customerId") or order.get("buyerUserId") or "")
            addr = order.get("deliveryAddress") or {}
            area_name = str(addr.get("area") or addr.get("city") or "").strip()
            city = str(addr.get("city") or area_name or "Other").strip()
            if not area_name:
                area_name = city or "Other"
            ostate = str(addr.get("state") or request.state or "").strip()
            key = _norm(area_name)
            a = agg.setdefault(key, {
                "name": area_name, "city": city, "state": ostate,
                "qtyCur": 0.0, "qtyPrev": 0.0,
                "orders": set(), "customers": set(),
                "seg": {"household": 0.0, "bulk_event": 0.0, "b2b": 0.0},
                "products": {}, "daily": {}, "prevDaily": {},
                "distances": [],
            })
            if cust_key:
                a["customers"].add(cust_key)
            a["orders"].add(str(order.get("_id") or ""))
            loc_raw = addr.get("location") or addr.get("geo")
            coords = None
            if isinstance(loc_raw, dict):
                if loc_raw.get("type") == "Point":
                    coords = loc_raw.get("coordinates")
                elif loc_raw.get("lat") is not None or loc_raw.get("lng") is not None:
                    coords = [loc_raw.get("lng", loc_raw.get("lon")), loc_raw.get("lat")]
            if coords and len(coords) >= 2 and farm.get("lat") is not None and farm.get("lng") is not None:
                d = haversine_km(farm["lat"], farm["lng"], float(coords[1]), float(coords[0]))
                if d is not None:
                    a["distances"].append(d)
            for item in order.get("items") or []:
                name = _item_name(item)
                if not name:
                    continue
                if prod_filter is not None and _norm(name) not in prod_filter:
                    continue
                qty = _item_qty(item)
                if qty <= 0:
                    continue
                a["products"][name] = a["products"].get(name, 0.0) + qty
                bucket = "prevDaily" if is_prev else "daily"
                day_key = od.date()
                a[bucket][day_key] = a[bucket].get(day_key, 0.0) + qty
                if is_prev:
                    a["qtyPrev"] += qty
                else:
                    a["qtyCur"] += qty
                    a["seg"][seg] = a["seg"].get(seg, 0.0) + qty

        for a in agg.values():
            qty_cur = a["qtyCur"]
            qty_prev = a["qtyPrev"]
            growth = ((qty_cur - qty_prev) / qty_prev * 100.0) if qty_prev > 0 else (100.0 if qty_cur > 0 else 0.0)
            hist = [{"date": d, "qty": v} for d, v in sorted(a["daily"].items())]
            if not hist:
                hist = [{"date": d, "qty": v} for d, v in sorted(a["prevDaily"].items())]
            pred, lo, hi, _ = demand_model.forecast_demand(hist, period_days, growth, now.month)
            dist = (sum(a["distances"]) / len(a["distances"])) if a["distances"] else None
            order_count = len(a["orders"])
            uniq = len(a["customers"])
            top = [n for n, _ in sorted(a["products"].items(), key=lambda kv: -kv[1])[:5]]
            rows.append({
                "name": a["name"], "city": a["city"], "state": a["state"],
                "qtyCur": qty_cur, "qtyPrev": qty_prev, "growth": growth,
                "pred": pred, "lo": lo, "hi": hi,
                "dist": dist,
                "dist_score": (1.0 - min(1.0, (dist or radius * 0.6) / radius)) if dist is not None else 0.5,
                "order_count": order_count, "uniq": uniq,
                "freq": round(order_count / max(1, lookback), 3),
                "seg": a["seg"], "top": top, "supply": 0.0, "gap": 0.0,
                "hist_len": len(hist), "cold": False,
            })
    except Exception as e:
        logger.warning(f"Demand heatmap aggregation failed, using cold-start fallback: {e}")
        rows = []

    if not rows:
        prod_filter = await _build_product_filter([], request.product, request.category)
        rows = _cold_start_rows(request, farm, prod_filter, period_days, radius, now)

    supply = await _farmer_supply(farmer_id, request.product, prod_filter)

    max_qty = max((r["qtyCur"] for r in rows), default=1) or 1
    max_orders = max((r["order_count"] for r in rows), default=1) or 1
    max_uniq = max((r["uniq"] for r in rows), default=1) or 1
    max_pred = max((r["pred"] for r in rows), default=1) or 1

    locations: List[Dict[str, Any]] = []
    for r in rows:
        q_score = min(1.0, r["qtyCur"] / max_qty)
        f_score = min(1.0, r["order_count"] / max_orders)
        c_score = min(1.0, r["uniq"] / max_uniq)
        t_score = (max(-1.0, min(1.0, r["growth"] / 100.0)) + 1.0) / 2.0
        p_score = min(1.0, r["pred"] / max_pred)
        score = (
            DEMAND_WEIGHTS["quantity"] * q_score
            + DEMAND_WEIGHTS["frequency"] * f_score
            + DEMAND_WEIGHTS["customers"] * c_score
            + DEMAND_WEIGHTS["trend"] * t_score
            + DEMAND_WEIGHTS["predicted"] * p_score
        )
        if score >= 0.75:
            label = "very-high"
        elif score >= 0.55:
            label = "high"
        elif score >= 0.35:
            label = "medium"
        else:
            label = "low"

        seg = r["seg"]
        seg_qty = seg.get("household", 0.0) + seg.get("bulk_event", 0.0) + seg.get("b2b", 0.0)
        gap = 0.0 if r.get("cold") else max(0.0, r["pred"] - r["qtyCur"])
        loc = {
            "location": r["name"],
            "area": r["name"],
            "city": r["city"],
            "state": r["state"],
            "distanceKm": round(r["dist"], 1) if r["dist"] is not None else None,
            "demandScore": round(score, 2),
            "demandLabel": label,
            "actualDemandKg": round(r["qtyCur"], 1),
            "predictedDemandKg": round(r["pred"], 1),
            "supplyKg": round(supply, 1),
            "gapKg": round(gap, 1),
            "growthPct": round(r["growth"], 1),
            "orderCount": r["order_count"],
            "uniqueCustomers": r["uniq"],
            "orderFrequency": r["freq"],
            "confidence": "low",
            "confidenceNote": None,
            "predictedRange": {"low": round(r["lo"], 1), "high": round(r["hi"], 1)},
            "customerBreakdown": {
                "householdKg": round(seg.get("household", 0.0), 1),
                "bulkEventKg": round(seg.get("bulk_event", 0.0), 1),
                "b2bKg": round(seg.get("b2b", 0.0), 1),
            },
            "factors": {
                "quantity": round(q_score, 2), "frequency": round(f_score, 2),
                "uniqueCustomers": round(c_score, 2), "trend": round(t_score, 2),
                "predicted": round(p_score, 2), "distance": round(r["dist_score"], 2),
            },
            "topProducts": r["top"],
            "seasonalFactor": 1.0,
            "populationFactor": 1.0,
            "_seg": seg,
        }
        conf, note = _confidence(r["order_count"], r["qtyCur"], r["hist_len"])
        if r.get("cold"):
            conf, note = "low", "No order history here yet — early estimate"
        loc["confidence"] = conf
        loc["confidenceNote"] = note
        mode_value, mode_unit, mode_label = _mode_value(loc, mode)
        loc["modeValue"] = mode_value
        loc["modeUnit"] = mode_unit
        loc["modeLabel"] = mode_label
        del loc["_seg"]
        locations.append(loc)

    locations.sort(key=lambda x: x["demandScore"], reverse=True)

    # Ranked "where should I sell?" areas --------------------------------
    total_pred = sum(l["predictedDemandKg"] for l in locations) or 1.0
    ranked_areas: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for loc in locations:
        if loc["location"] in seen:
            continue
        seen.add(loc["location"])
        if loc["distanceKm"] is not None and loc["distanceKm"] > radius:
            continue
        share = loc["predictedDemandKg"] / total_pred
        supply_share = supply * share
        level, rec = _opportunity(loc, radius, supply_share)
        reasons = _reasons(loc)
        if supply > 0 and loc["gapKg"] > 0:
            reasons.append(
                f"You have {int(supply)} kg available — listing ~{int(rec)} kg here fits this demand"
            )
        ranked_areas.append({
            "rank": len(ranked_areas) + 1,
            "location": loc["location"],
            "distanceKm": loc["distanceKm"],
            "demandScore": loc["demandScore"],
            "growthPct": loc["growthPct"],
            "predictedDemandKg": loc["predictedDemandKg"],
            "supplyKg": loc["supplyKg"],
            "gapKg": loc["gapKg"],
            "opportunity": level,
            "recommendedQuantityKg": rec,
            "confidence": loc["confidence"],
            "reasons": reasons,
            "topProducts": loc["topProducts"],
        })

    # Summary ------------------------------------------------------------
    seg_total = {"householdKg": 0.0, "bulkEventKg": 0.0, "b2bKg": 0.0}
    for loc in locations:
        cb = loc["customerBreakdown"]
        seg_total["householdKg"] += cb["householdKg"]
        seg_total["bulkEventKg"] += cb["bulkEventKg"]
        seg_total["b2bKg"] += cb["b2bKg"]
    total_actual = sum(l["actualDemandKg"] for l in locations)
    total_pred_sum = sum(l["predictedDemandKg"] for l in locations)
    total_gap = sum(l["gapKg"] for l in locations)
    total_demand_score = (
        sum(l["demandScore"] * l["predictedDemandKg"] for l in locations) / total_pred
        if locations else 0.0
    )
    overall_growth = 0.0
    top_loc = locations[0] if locations else None
    if top_loc:
        overall_growth = top_loc["growthPct"]
    best = ranked_areas[0] if ranked_areas else None

    summary = {
        "periodLabel": period_label,
        "actualDemandKg": round(total_actual, 1),
        "predictedDemandKg": round(total_pred_sum, 1),
        "supplyKg": round(supply, 1),
        "gapKg": round(total_gap, 1),
        "orderCount": sum(l["orderCount"] for l in locations),
        "uniqueCustomers": sum(l["uniqueCustomers"] for l in locations),
        "growthPct": round(overall_growth, 1),
        "segments": seg_total,
        "dataWindowDays": lookback if lookback else 0,
        "coldStart": not bool(locations) or all(l["confidence"] == "low" for l in locations),
        "opportunityLevel": best["opportunity"] if best else "LOW",
        "totalDemandScore": round(total_demand_score, 2),
    }

    if summary["coldStart"]:
        if not locations:
            recommendations = (
                "No demand data available yet. List your produce and check back once "
                "customers start ordering."
            )
        else:
            first = locations[0]["location"]
            recommendations = (
                f"No order history in this area yet — this is an early estimate based on "
                f"a typical {period_label.lower()} baseline. Start by listing your produce "
                f"around {first} and check back as real orders grow."
            )
    elif best:
        opp = best["opportunity"]
        if opp == "HIGH":
            tone = "Focus here — demand is strong and currently unmet."
        elif opp == "MEDIUM":
            tone = "Decent opportunity — worth checking when you list stock."
        else:
            tone = "Demand is currently met — monitor before investing delivery time."
        recommendations = (
            f"{tone} Best area: {best['location']} "
            f"({best['distanceKm']} km from your farm) with "
            f"{int(best['predictedDemandKg'])} kg expected demand over {period_label.lower()}."
        )
        if supply > 0 and best["recommendedQuantityKg"] > 0:
            recommendations += (
                f" You have {int(supply)} kg available; consider listing "
                f"~{int(best['recommendedQuantityKg'])} kg there."
            )
        elif supply <= 0:
            recommendations += (
                " List your stock on the marketplace to start capturing this demand."
            )
    elif locations:
        recommendations = (
            "No area has enough order history for a confident recommendation yet. "
            "This is an early estimate — list your produce and check back as orders grow."
        )
    else:
        recommendations = (
            "No demand data available yet. List your produce and check back once "
            "customers start ordering."
        )

    return {
        "state": request.state,
        "district": request.district,
        "category": request.category,
        "product": request.product,
        "period": period,
        "periodLabel": period_label,
        "radiusKm": radius,
        "mode": mode,
        "customerType": request.customerType or "all",
        "farm": farm,
        "products": sorted({p for l in locations for p in l["topProducts"]}),
        "locations": locations,
        "rankedAreas": ranked_areas,
        "summary": summary,
        "totalDemandScore": round(total_demand_score, 2),
        "recommendations": recommendations,
        "forecastModel": demand_model.model_name(),
        "timestamp": now,
    }