from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
from datetime import datetime
from bson import ObjectId
from app.database.mongodb import MongoDB


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
    lng = value.get("lng", value.get("lon", value.get("longitude")))
    if lat is None or lng is None:
        return None
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def distance_km(a: Any, b: Any) -> Optional[float]:
    from math import radians, sin, cos, asin, sqrt
    pa, pb = _point(a), _point(b)
    if not pa or not pb:
        return None
    lat1, lon1, lat2, lon2 = map(radians, [pa[0], pa[1], pb[0], pb[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return round(6371.0088 * 2 * asin(sqrt(h)), 2)


async def nearest_warehouse(origin: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    docs = await MongoDB.get_collection("warehouses").find({
        "deletedAt": None,
        "status": {"$in": ["active", "approved", "operational"]},
    }).to_list(length=100)
    candidates = []
    for doc in docs:
        d = distance_km(origin, doc.get("location") or doc.get("coordinates"))
        if d is not None:
            candidates.append((d, doc))
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1] if candidates else None


async def nearest_local_hub(destination: Dict[str, Any], quantity: float = 0) -> Optional[Dict[str, Any]]:
    docs = await MongoDB.get_collection("fulfillment_hubs").find({
        "deletedAt": None,
        "isLocalFulfillmentHub": True,
        "isActive": True,
        "approvalStatus": "approved",
    }).to_list(length=100)
    candidates = []
    for doc in docs:
        capacity = float(doc.get("availableCapacity", doc.get("storageCapacity", 0)) or 0)
        if capacity < quantity:
            continue
        d = distance_km(destination, doc.get("location") or doc.get("coordinates"))
        if d is not None:
            candidates.append((d, doc))
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1] if candidates else None


async def apply_partner_route(
    order: Dict[str, Any],
    route_mode: str,
    radius_km: float,
    warehouse_id: Optional[str] = None,
    hub_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Persist the physical logistics route after a delivery-partner decision.

    nearby: FARM -> LOCAL HUB -> DELIVERY PARTNER -> CUSTOMER
    long_distance: FARM -> WAREHOUSE -> LOCAL HUB -> DELIVERY PARTNER -> CUSTOMER
    """
    mode = "nearby" if route_mode == "nearby" else "long_distance"
    items = order.get("items") or []
    quantity = float(sum(float(i.get("quantity") or 0) for i in items))
    origin = order.get("farmLocation") or order.get("originLocation") or order.get("pickupLocation")
    destination = (order.get("deliveryAddress") or {}).get("location")

    hub = None
    warehouse = None
    if hub_id:
        hub = await MongoDB.get_collection("fulfillment_hubs").find_one({"_id": ObjectId(hub_id), "deletedAt": None})
    if not hub and destination:
        hub = await nearest_local_hub(destination, quantity)

    if mode == "long_distance":
        if warehouse_id:
            warehouse = await MongoDB.get_collection("warehouses").find_one({"_id": ObjectId(warehouse_id), "deletedAt": None})
        if not warehouse and origin:
            warehouse = await nearest_warehouse(origin)

    update: Dict[str, Any] = {
        "deliveryPartnerRoute": mode,
        "deliveryPartnerRouteSelectedAt": datetime.utcnow(),
        "nearbyFulfillmentRequired": True,
        "nearbyFulfillmentType": "local_hub",
        "nearbyFulfillmentLocationId": hub.get("_id") if hub else None,
        "nearbyFulfillmentLocation": ({
            "id": str(hub.get("_id")),
            "name": hub.get("name") or hub.get("hubName") or "Local Fulfillment Hub",
            "address": hub.get("address") or "",
            "coordinates": (hub.get("location") or {}).get("coordinates") or (hub.get("coordinates") or {}).get("coordinates") or [],
        } if hub else None),
        "deliveryRadiusKm": radius_km,
        "logisticsMode": (
            "farmer_to_local_hub_to_delivery_partner"
            if mode == "nearby" and str(order.get("fulfillmentSource") or "") != "warehouse"
            else "warehouse_to_local_hub_to_delivery_partner"
            if mode == "nearby" and str(order.get("fulfillmentSource") or "") == "warehouse"
            else "farmer_to_warehouse_to_local_hub_to_delivery_partner"
            if str(order.get("fulfillmentSource") or "") != "warehouse"
            else "warehouse_to_local_hub_to_delivery_partner"
        ),
        "transferStatus": "pending" if mode == "long_distance" else "hub_handoff_pending",
        "updatedAt": datetime.utcnow(),
    }
    if warehouse:
        update["warehouseId"] = warehouse.get("_id")
        update["fulfillmentSource"] = "warehouse"
        update["warehouseRequiredForLastMile"] = True
        update["currentFulfillmentLocation"] = warehouse.get("location")
    else:
        update["fulfillmentSource"] = order.get("fulfillmentSource") or "farmer"

    await MongoDB.get_collection("orders").update_one({"_id": order["_id"]}, {"$set": update})
    return {
        "route": mode,
        "warehouse": {"id": str(warehouse["_id"]), "name": warehouse.get("name")} if warehouse else None,
        "hub": {"id": str(hub["_id"]), "name": hub.get("name")} if hub else None,
        "logisticsMode": update["logisticsMode"],
        "transferStatus": update["transferStatus"],
    }
