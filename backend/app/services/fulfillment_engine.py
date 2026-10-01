from __future__ import annotations

from datetime import datetime, timedelta
from math import radians, sin, cos, asin, sqrt
from typing import Any, Dict, Optional, Tuple

from bson import ObjectId

from app.database.mongodb import MongoDB


# Operational defaults. These are deliberately conservative for fresh produce
# and can be overridden per product/order by explicit fields.
FARM_DIRECT_MAX_KM = 25.0
FARM_DIRECT_MAX_MINUTES = 75.0
WAREHOUSE_MAX_KM = 50.0
WAREHOUSE_MAX_MINUTES = 120.0
DEFAULT_SPEED_KMH = 35.0
DEFAULT_SHELF_LIFE_HOURS = 72.0


def _point(value: Any) -> Optional[Tuple[float, float]]:
    if not isinstance(value, dict):
        return None
    coords = value.get("coordinates")
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            return float(coords[1]), float(coords[0])
        except (TypeError, ValueError):
            return None
    lat = value.get("lat", value.get("latitude"))
    lon = value.get("lng", value.get("lon", value.get("longitude")))
    if lat is None or lon is None:
        return None
    try:
        return float(lat), float(lon)
    except (TypeError, ValueError):
        return None


def distance_km(a: Any, b: Any) -> Optional[float]:
    pa, pb = _point(a), _point(b)
    if not pa or not pb:
        return None
    lat1, lon1, lat2, lon2 = map(radians, [pa[0], pa[1], pb[0], pb[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return round(6371.0088 * 2 * asin(sqrt(h)), 2)


def eta_minutes(distance: Optional[float], speed_kmh: float = DEFAULT_SPEED_KMH) -> Optional[int]:
    if distance is None:
        return None
    return max(1, round(distance / max(speed_kmh, 1) * 60))


def _risk(
    remaining_hours: Optional[float],
    travel_minutes: Optional[int],
    perishability: str,
    storage_ok: bool = True,
) -> str:
    if remaining_hours is None:
        return "unknown"
    travel_hours = (travel_minutes or 0) / 60
    margin = remaining_hours - travel_hours
    level = (perishability or "medium").lower()
    if not storage_ok or margin <= 0:
        return "critical"
    if level == "high" and margin <= 24:
        return "high"
    if level == "high" and margin <= 48:
        return "medium"
    if margin <= 12:
        return "high"
    if margin <= 24:
        return "medium"
    return "low"


def _should_use_warehouse(distance: Optional[float], minutes: Optional[int], risk: str) -> bool:
    if risk == "critical":
        return True
    if distance is not None and distance > WAREHOUSE_MAX_KM:
        return True
    if minutes is not None and minutes > WAREHOUSE_MAX_MINUTES:
        return True
    return False


def _farmer_needs_partner(distance: Optional[float], minutes: Optional[int], risk: str) -> bool:
    # Farmer-direct remains the fulfillment source. "nearby" means a local
    # delivery-partner handoff, never a hub.
    if risk in ("high", "critical"):
        return True
    if distance is not None and distance > FARM_DIRECT_MAX_KM:
        return True
    if minutes is not None and minutes > FARM_DIRECT_MAX_MINUTES:
        return True
    return False


async def _first_item(order: Dict[str, Any]) -> Dict[str, Any]:
    item = (order.get("items") or [{}])[0]
    product_id = item.get("productId")
    if product_id:
        try:
            product = await MongoDB.get_collection("products").find_one({"_id": ObjectId(str(product_id))})
            if product:
                return product
        except Exception:
            pass
    return {}


async def _choose_hub(destination: Dict[str, Any], quantity: float, product: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    collection = MongoDB.get_collection("fulfillment_hubs")
    docs = await collection.find({
        "deletedAt": None,
        "isActive": True,
        "isLocalFulfillmentHub": True,
    }).to_list(length=100)
    candidates = []
    for hub in docs:
        if hub.get("availableCapacity", hub.get("storageCapacity", 0)) < quantity:
            continue
        supported = hub.get("supportedProducts") or []
        product_id = str(product.get("_id", ""))
        if supported and product_id not in [str(x) for x in supported]:
            continue
        d = distance_km(destination, hub.get("location"))
        if d is None:
            continue
        candidates.append((d, hub))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


async def evaluate_order(order_id: str, persist: bool = True) -> Dict[str, Any]:
    orders = MongoDB.get_collection("orders")
    order = await orders.find_one({"_id": ObjectId(order_id)})
    if not order:
        raise ValueError("Order not found")

    product = await _first_item(order)
    destination = (order.get("deliveryAddress") or {}).get("location")
    origin = order.get("currentFulfillmentLocation") or order.get("farmLocation") or order.get("pickupLocation")

    if not origin and order.get("farmerId"):
        farmer = await MongoDB.get_collection("farmers").find_one({"userId": order["farmerId"]})
        if farmer:
            origin = farmer.get("farmLocation") or farmer.get("location")
    if not origin and order.get("farmerId"):
        farmer = await MongoDB.get_collection("users").find_one({"_id": order["farmerId"]})
        if farmer:
            origin = farmer.get("farmLocation") or farmer.get("location")

    distance = distance_km(origin, destination)
    minutes = eta_minutes(distance)
    expected = float(product.get("expectedShelfLifeHours") or DEFAULT_SHELF_LIFE_HOURS)
    harvested = product.get("harvestedAt")
    remaining = product.get("remainingShelfLifeHours")
    if remaining is None and harvested:
        try:
            if harvested.tzinfo:
                now = datetime.now(harvested.tzinfo)
            else:
                now = datetime.utcnow()
            elapsed = max(0.0, (now - harvested).total_seconds() / 3600)
            remaining = max(0.0, expected - elapsed)
        except Exception:
            remaining = expected
    if remaining is None:
        remaining = expected

    perishability = product.get("perishabilityLevel") or (
        "high" if expected <= 48 else "medium" if expected <= 120 else "low"
    )
    risk = _risk(remaining, minutes, perishability, bool(product.get("storageTemperature") is not None or not perishability == "high"))

    source = "farmer"
    if order.get("warehouseId") and order.get("fulfillmentSource") == "warehouse":
        source = "warehouse"

    result: Dict[str, Any] = {
        "orderId": str(order["_id"]),
        "fulfillmentSource": source,
        "originLocation": origin,
        "customerLocation": destination,
        "estimatedDistanceKm": distance,
        "estimatedDeliveryMinutes": minutes,
        "remainingShelfLifeHours": round(float(remaining), 1) if remaining is not None else None,
        "perishabilityLevel": perishability,
        "perishabilityRisk": risk,
        "decisionAt": datetime.utcnow(),
    }

    if source == "farmer":
        if _should_use_warehouse(distance, minutes, risk):
            result.update({
                "fulfillmentSource": "warehouse",
                "nearbyFulfillmentRequired": False,
                "logisticsMode": "warehouse_inbound",
                "decision": "FARMER_TOO_FAR_TO_WAREHOUSE",
                "nextStep": "WAREHOUSE_RECEIVE",
            })
        elif _farmer_needs_partner(distance, minutes, risk):
            result.update({
                "nearbyFulfillmentRequired": True,
                "nearbyFulfillmentType": "delivery_partner",
                "logisticsMode": "farmer_to_delivery_partner",
                "decision": "FARMER_NEARBY_DELIVERY_PARTNER",
                "nextStep": "DELIVERY_PARTNER_ASSIGNMENT",
            })
        else:
            result.update({
                "nearbyFulfillmentRequired": False,
                "nearbyFulfillmentType": None,
                "logisticsMode": "farmer_direct",
                "decision": "FARMER_DIRECT",
                "nextStep": "FARMER_SELF_DELIVERY_OR_PARTNER",
            })
    else:
        # Warehouse path: only this path can select a Local Hub.
        if _should_use_warehouse(distance, minutes, risk):
            qty = float(sum(float(i.get("quantity") or 0) for i in order.get("items") or []))
            hub = await _choose_hub(destination, qty, product)
            if hub:
                hub_distance = distance_km(hub.get("location"), destination)
                result.update({
                    "nearbyFulfillmentRequired": True,
                    "nearbyFulfillmentType": "local_hub",
                    "nearbyFulfillmentLocationId": str(hub["_id"]),
                    "nearbyFulfillmentLocation": hub.get("name"),
                    "hubToCustomerDistanceKm": hub_distance,
                    "logisticsMode": "warehouse_to_local_hub",
                    "decision": "WAREHOUSE_NEARBY_LOCAL_HUB",
                    "nextStep": "HUB_TRANSFER",
                })
            else:
                result.update({
                    "nearbyFulfillmentRequired": False,
                    "nearbyFulfillmentType": "delivery_partner",
                    "logisticsMode": "warehouse_direct_delivery_partner",
                    "decision": "WAREHOUSE_DIRECT_DELIVERY_PARTNER",
                    "nextStep": "DELIVERY_PARTNER_ASSIGNMENT",
                })
        else:
            result.update({
                "nearbyFulfillmentRequired": False,
                "nearbyFulfillmentType": "delivery_partner",
                "logisticsMode": "warehouse_direct_delivery_partner",
                "decision": "WAREHOUSE_DIRECT_DELIVERY_PARTNER",
                "nextStep": "DELIVERY_PARTNER_ASSIGNMENT",
            })

    if persist:
        await orders.update_one(
            {"_id": order["_id"]},
            {"$set": {
                **{k: v for k, v in result.items() if k not in {"orderId"}},
                "updatedAt": datetime.utcnow(),
            }},
        )
    return result
