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


async def _choose_warehouse(origin: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Select the nearest active warehouse when an order has no preassigned warehouse."""
    docs = await MongoDB.get_collection("warehouses").find({
        "deletedAt": None,
        "status": {"$in": ["active", "approved", "operational"]},
    }).to_list(length=100)
    candidates = []
    for warehouse in docs:
        location = warehouse.get("location") or warehouse.get("coordinates")
        d = distance_km(origin, location)
        if d is not None:
            candidates.append((d, warehouse))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


async def _choose_hub(destination: Dict[str, Any], quantity: float, product: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    collection = MongoDB.get_collection("fulfillment_hubs")
    docs = await collection.find({
        "deletedAt": None,
        "isActive": True,
        "isLocalFulfillmentHub": True,
        "approvalStatus": "approved",
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


async def _nearby_stock_available(destination: Dict[str, Any], product: Dict[str, Any], radius_km: float = 25.0) -> float:
    """Find active stock of the same product already positioned near the customer."""
    product_id = product.get("_id")
    if not product_id:
        return 0.0
    inventories = await MongoDB.get_collection("inventory").find({
        "product_id": str(product_id), "deleted_at": None,
    }).to_list(length=200)
    total = 0.0
    for inv in inventories:
        loc = inv.get("location")
        d = distance_km(destination, loc)
        if d is None or d > radius_km:
            continue
        total += max(0.0, float(inv.get("total_stock", 0) or 0) - float(inv.get("reserved_stock", 0) or 0) - float(inv.get("sold_stock", 0) or 0))
    return round(total, 2)


async def _delivery_capacity_available(pickup: Dict[str, Any], quantity: float) -> Tuple[Optional[float], Optional[bool]]:
    """Return nearby delivery capacity for the requested load, when profiles exist."""
    docs = await MongoDB.get_collection("delivery_partners").find({
        "deletedAt": None, "isAvailable": True, "status": {"$in": ["available", None]}, "isVerified": True,
    }).to_list(length=100)
    available = 0.0
    for partner in docs:
        loc = partner.get("currentLocation") or partner.get("location")
        d = distance_km(pickup, loc)
        if d is None or d > 60:
            continue
        cap = partner.get("capacity")
        if cap is None:
            available += quantity
            continue
        active_weight = float(partner.get("activeLoad", 0) or 0)
        available += max(0.0, float(cap) - active_weight)
    if not docs:
        return None, None
    return round(available, 2), available >= quantity


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
    harvested = product.get("harvestedAt") or product.get("harvestDate")
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
    storage_condition = str(product.get("storageCondition") or "good").lower()
    storage_ok = storage_condition not in ("bad", "failed", "unsafe")
    risk = _risk(remaining, minutes, perishability, storage_ok)
    quantity = float(sum(float(i.get("quantity") or 0) for i in order.get("items") or []))
    nearby_stock = await _nearby_stock_available(destination, product) if destination else 0.0
    delivery_capacity, capacity_sufficient = await _delivery_capacity_available(origin, quantity) if origin else (None, None)

    source = "farmer"
    if order.get("warehouseId") and order.get("fulfillmentSource") == "warehouse":
        source = "warehouse"

    result: Dict[str, Any] = {
        "orderId": str(order["_id"]),
        "orderStatus": order.get("orderStatus"),
        "transferStatus": order.get("transferStatus"),
        "fulfillmentSource": source,
        "originLocation": origin,
        "customerLocation": destination,
        "estimatedDistanceKm": distance,
        "estimatedDeliveryMinutes": minutes,
        "remainingShelfLifeHours": round(float(remaining), 1) if remaining is not None else None,
        "perishabilityLevel": perishability,
        "perishabilityRisk": risk,
        "nearbyStockAvailable": nearby_stock,
        "deliveryCapacityAvailable": delivery_capacity,
        "deliveryCapacitySufficient": capacity_sufficient,
        "decisionAt": datetime.utcnow(),
    }

    if source == "farmer":
        if _should_use_warehouse(distance, minutes, risk) or capacity_sufficient is False:
            result.update({
                "fulfillmentSource": "warehouse",
                "nearbyFulfillmentRequired": False,
                "logisticsMode": "warehouse_inbound",
                "decision": "FARMER_TOO_FAR_TO_WAREHOUSE",
                "nextStep": "WAREHOUSE_RECEIVE",
            })
            warehouse_id = order.get("warehouseId")
            if not warehouse_id:
                warehouse = await _choose_warehouse(origin)
                if warehouse:
                    warehouse_id = warehouse["_id"]
                    await orders.update_one({"_id": order["_id"]}, {"$set": {"warehouseId": warehouse_id, "fulfillmentSource": "warehouse", "updatedAt": datetime.utcnow()}})
            if warehouse_id:
                incoming = MongoDB.get_collection("incoming_stock")
                for item in order.get("items") or []:
                    product_id = item.get("productId")
                    if not product_id:
                        continue
                    exists = await incoming.find_one({"orderId": order["_id"], "productId": ObjectId(str(product_id)), "deletedAt": None})
                    if not exists:
                        now = datetime.utcnow()
                        await incoming.insert_one({
                            "warehouseId": ObjectId(str(warehouse_id)),
                            "productId": ObjectId(str(product_id)),
                            "farmerId": order.get("farmerId"),
                            "orderId": order["_id"],
                            "quantity": int(item.get("quantity") or 0),
                            "expectedDate": now,
                            "batchNumber": item.get("batchId"),
                            "status": "scheduled",
                            "createdAt": now,
                            "updatedAt": now,
                            "deletedAt": None,
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
        if _should_use_warehouse(distance, minutes, risk) or capacity_sufficient is False:
            qty = quantity
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
