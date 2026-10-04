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
    """Persist the physical delivery-partner route after the Farmer Order Map
    delivery decision.

    Farmer fulfillment:
      packed -> nearby -> Dispatch -> Local Hub -> Delivery Partner
      packed -> long_distance -> Dispatch -> Warehouse -> Local Hub -> Delivery Partner

    Self delivery is dispatched separately by the Farmer Order Map:
      packed -> self delivery -> Dispatch -> Farmer -> Customer.
    """
    mode = "nearby" if route_mode == "nearby" else "long_distance"
    if str(order.get("fulfillmentMethod") or "") == "farmer":
        if str(order.get("fulfillmentStage") or "") != "packed":
            raise ValueError("Farmer order must be packed before delivery routing.")
        if str(order.get("orderStatus") or "") != "processing":
            raise ValueError("Farmer order must still be processing before delivery routing.")

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

    warehouse_route = str(order.get("fulfillmentMethod") or "") == "warehouse"
    if warehouse_route and mode == "nearby":
        logistics_mode = "warehouse_to_delivery_partner"
        route_requires_hub = False
        transfer_status = "warehouse_handoff_pending"
    elif warehouse_route and mode == "long_distance":
        logistics_mode = "warehouse_to_local_hub_to_delivery_partner"
        route_requires_hub = True
        transfer_status = "hub_handoff_pending"
    elif mode == "nearby":
        logistics_mode = "farmer_to_local_hub_to_delivery_partner"
        route_requires_hub = True
        transfer_status = "hub_handoff_pending"
    else:
        logistics_mode = "farmer_to_warehouse_to_local_hub_to_delivery_partner"
        route_requires_hub = True
        transfer_status = "pending"

    if warehouse_route and mode == "nearby":
        hub = None
    elif warehouse_route and mode == "long_distance" and not hub:
        raise ValueError("No active local hub with available capacity was found for this shipment.")
    elif not warehouse_route and mode == "nearby" and not hub:
        raise ValueError("No active local hub with available capacity was found for this shipment.")
    elif not warehouse_route and mode == "long_distance":
        if not warehouse:
            raise ValueError("No warehouse is available for this long-distance farmer route.")
        if not hub:
            raise ValueError("No active local hub with available capacity was found for this shipment.")

    pickup = None
    if mode == "nearby" and warehouse:
        location = warehouse.get("location") or warehouse.get("coordinates") or {}
        coords = location.get("coordinates") if isinstance(location, dict) else None
        pickup = {
            "type": "warehouse",
            "id": str(warehouse.get("_id")),
            "name": warehouse.get("name") or warehouse.get("warehouseName") or "Warehouse",
            "address": warehouse.get("address") or "",
            "coordinates": coords or [],
        }
    elif mode == "long_distance" and hub:
        pickup = {
            "type": "local_hub",
            "id": str(hub.get("_id")),
            "name": hub.get("name") or hub.get("hubName") or "Local Fulfillment Hub",
            "address": hub.get("address") or "",
            "coordinates": (hub.get("location") or {}).get("coordinates") or (hub.get("coordinates") or {}).get("coordinates") or [],
        }
    elif hub:
        pickup = {
            "type": "local_hub",
            "id": str(hub.get("_id")),
            "name": hub.get("name") or hub.get("hubName") or "Local Fulfillment Hub",
            "address": hub.get("address") or "",
            "coordinates": (hub.get("location") or {}).get("coordinates") or (hub.get("coordinates") or {}).get("coordinates") or [],
        }

    update: Dict[str, Any] = {
        "deliveryPartnerRoute": mode,
        "deliveryDecision": mode,
        "deliveryDispatchStatus": "pending",
        "deliveryDispatchAt": None,
        "deliveryRouteSequence": (
            ["packed", "dispatch", "local_hub", "delivery_partner", "customer"]
            if mode == "nearby"
            else ["packed", "dispatch", "warehouse", "local_hub", "delivery_partner", "customer"]
        ),
        "deliveryDecisionSource": "distance",
        "deliveryPartnerRouteSelectedAt": datetime.utcnow(),
        "deliveryResponsibility": "delivery_partner",
        "deliveryDecisionStatus": (
            "partner_pending"
            if mode == "nearby"
            else "warehouse_transfer_pending"
        ),
        "partnerAssignmentOpen": mode == "nearby",
        "partnerRequested": False,
        "nearbyFulfillmentRequired": route_requires_hub,
        "nearbyFulfillmentType": "local_hub" if route_requires_hub else None,
        "nearbyFulfillmentLocationId": hub.get("_id") if route_requires_hub and hub else None,
        "nearbyFulfillmentLocation": ({
            "id": str(hub.get("_id")),
            "name": hub.get("name") or hub.get("hubName") or "Local Fulfillment Hub",
            "address": hub.get("address") or "",
            "coordinates": (hub.get("location") or {}).get("coordinates") or (hub.get("coordinates") or {}).get("coordinates") or [],
        } if route_requires_hub and hub else None),
        "deliveryPickupLocation": pickup,
        "deliveryRadiusKm": radius_km,
        "logisticsMode": logistics_mode,
        "transferStatus": transfer_status,
        "updatedAt": datetime.utcnow(),
    }
    if warehouse:
        update["warehouseId"] = warehouse.get("_id")
        update["fulfillmentSource"] = "warehouse"
        update["warehouseRequiredForLastMile"] = True
        update["currentFulfillmentLocation"] = warehouse.get("location")
    else:
        update["fulfillmentSource"] = order.get("fulfillmentSource") or "farmer"

    # Warehouse Fulfillment: nearby means the partner collects directly from
    # the warehouse; long-distance means warehouse -> local hub -> partner.
    if warehouse_route and mode == "nearby":
        update["nearbyFulfillmentRequired"] = False
        update["nearbyFulfillmentLocationId"] = None
        update["nearbyFulfillmentLocation"] = None
        update["transferStatus"] = "warehouse_handoff_pending"
        update["logisticsMode"] = "warehouse_to_delivery_partner"
    elif warehouse_route and mode == "long_distance":
        update["nearbyFulfillmentRequired"] = True
        update["nearbyFulfillmentType"] = "local_hub"
        update["transferStatus"] = "hub_handoff_pending"
        update["logisticsMode"] = "warehouse_to_local_hub_to_delivery_partner"

    # Partner delivery begins with the Dispatch handoff. Packing is already
    # complete; this transition is intentionally created only after the
    # distance-based delivery decision and route resources are available.
    if not warehouse_route:
        dispatch_at = datetime.utcnow()
        update["fulfillmentStage"] = "dispatched"
        update["orderStatus"] = "ready_for_delivery"
        update["dispatchedAt"] = dispatch_at
        update["dispatchReadyChecklistComplete"] = True
        update["deliveryDispatchStatus"] = "dispatched"
        update["deliveryDispatchAt"] = dispatch_at

    await MongoDB.get_collection("orders").update_one({"_id": order["_id"]}, {"$set": update})

    # Farmer Fulfillment + long distance uses the warehouse only as a
    # transfer point. The farmer has already packed the individual order, so
    # the warehouse must never create another packing task for this route.
    if mode == "long_distance" and str(order.get("fulfillmentMethod") or "") == "farmer" and warehouse:
        incoming = MongoDB.get_collection("incoming_stock")
        for item in items:
            existing = await incoming.find_one({
                "orderId": order["_id"],
                "warehouseId": warehouse["_id"],
                "productId": ObjectId(str(item.get("productId"))),
                "packingRequired": False,
                "deletedAt": None,
            })
            if not existing:
                await incoming.insert_one({
                    "warehouseId": warehouse["_id"],
                    "productId": ObjectId(str(item.get("productId"))),
                    "variantId": ObjectId(str(item.get("variantId"))) if item.get("variantId") else None,
                    "farmerId": ObjectId(str(order.get("farmerId"))),
                    "orderId": order["_id"],
                    "quantity": int(item.get("quantity", 0) or 0),
                    "quantityReceived": 0,
                    "expectedDate": datetime.utcnow(),
                    "status": "in_transit",
                    "packingRequired": False,
                    "sourceMode": "farmer_fulfillment_transfer",
                    "batchNumber": item.get("batchNumber"),
                    "createdAt": datetime.utcnow(),
                    "updatedAt": datetime.utcnow(),
                    "deletedAt": None,
                })

    return {
        "route": mode,
        "warehouse": {"id": str(warehouse["_id"]), "name": warehouse.get("name")} if warehouse else None,
        "hub": {"id": str(hub["_id"]), "name": hub.get("name")} if hub else None,
        "logisticsMode": update["logisticsMode"],
        "transferStatus": update["transferStatus"],
    }
