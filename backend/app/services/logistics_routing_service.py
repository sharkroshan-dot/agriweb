from __future__ import annotations

from typing import Any, Dict, Optional, Tuple
from datetime import datetime
from bson import ObjectId
from app.database.mongodb import MongoDB
from app.services.warehouse_collection_service import ensure_collection_job
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationPriority, NotificationType


def is_packed_farmer_order(order: Dict[str, Any]) -> bool:
    """Use one packing rule across the delivery map and routing service.

    A normalized packed/dispatched stage is authoritative. The boolean flag
    supports legacy packed orders whose stage was not migrated. String values
    are parsed explicitly so values such as "false" are not treated as truthy.
    """
    stage = str(order.get("fulfillmentStage") or "").strip().lower()
    if stage in ("packed", "dispatched"):
        return True

    packing_complete = order.get("packingComplete")
    if packing_complete is True:
        return True
    return str(packing_complete or "").strip().lower() in ("true", "1", "yes")


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



async def allocate_farmer_fulfillment_warehouses(
    order: Dict[str, Any],
    origin: Optional[Dict[str, Any]],
    destination: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Split one already-packed farmer order across suitable warehouses.

    The customer still owns one order. Warehouse allocations are internal
    transfer legs only; no warehouse packing task is created.
    """
    warehouses = await MongoDB.get_collection("warehouses").find({
        "deletedAt": None,
        "status": {"$in": ["active", "approved", "operational"]},
    }).to_list(length=200)

    if not warehouses:
        raise ValueError("No active warehouses are available for farmer fulfillment transfer.")

    # Allocation uses live inventory-derived capacity, not stale warehouse profile values.
    for warehouse in warehouses:
        try:
            from app.repositories.warehouse_repository import warehouse_repository
            await warehouse_repository.sync_capacity_usage(str(warehouse["_id"]))
            refreshed = await warehouse_repository.get_by_id(str(warehouse["_id"]))
            if refreshed:
                warehouse.update(refreshed)
        except Exception:
            continue

    item_lines = []
    for item in order.get("items") or []:
        qty = float(item.get("quantity") or 0)
        if qty <= 0:
            continue
        item_lines.append({
            "productId": item.get("productId"),
            "variantId": item.get("variantId"),
            "productName": item.get("productName") or item.get("name") or "Product",
            "quantity": qty,
            "unit": item.get("unit") or "kg",
            "batchNumber": item.get("batchNumber"),
        })

    if not item_lines:
        raise ValueError("Farmer fulfillment order has no transferable packed items.")

    def capacity(w: Dict[str, Any]) -> float:
        total = float(w.get("totalCapacity") or 0)
        used = float(w.get("usedCapacity") or 0)
        # A warehouse with no configured capacity must not become an
        # unlimited fallback. Only explicit positive capacity is eligible.
        if total <= 0:
            return 0.0
        return max(0.0, total - used)

    scored = []
    for warehouse in warehouses:
        point = warehouse.get("location") or warehouse.get("coordinates")
        farm_distance = distance_km(origin, point) if origin and point else None
        customer_distance = distance_km(destination, point) if destination and point else None
        score = (farm_distance or 10**6) + (customer_distance or 10**6) * 0.75
        scored.append((score, farm_distance or 10**6, warehouse))
    scored.sort(key=lambda x: (x[0], x[1]))

    allocations = []
    for line in item_lines:
        remaining = float(line["quantity"])
        for _, _, warehouse in scored:
            if remaining <= 1e-9:
                break
            available = capacity(warehouse)
            already_allocated = sum(
                float(a["quantity"])
                for a in allocations
                if str(a["warehouseId"]) == str(warehouse["_id"])
            )
            take = min(remaining, max(0.0, available - already_allocated))
            if take <= 1e-9:
                continue
            allocations.append({
                "warehouseId": warehouse["_id"],
                "warehouseName": warehouse.get("name") or warehouse.get("warehouseName") or "Warehouse",
                "productId": line["productId"],
                "variantId": line["variantId"],
                "productName": line["productName"],
                "quantity": round(take, 3),
                "unit": line["unit"],
                "batchNumber": line.get("batchNumber"),
            })
            remaining -= take
        if remaining > 1e-9:
            raise ValueError(
                f"Insufficient warehouse transfer capacity for {line['productName']}: "
                f"{remaining:g} {line['unit']} still needs a warehouse."
            )

    warehouse_ids = []
    for allocation in allocations:
        wid = str(allocation["warehouseId"])
        if wid not in warehouse_ids:
            warehouse_ids.append(wid)

    # Prefer a dedicated consolidation warehouse that is not one of the source
    # warehouses. If none is configured, the best source warehouse becomes the
    # consolidation point so the order never gets stuck waiting for a missing
    # resource.
    consolidation_candidates = [
        w for _, _, w in scored
        if str(w["_id"]) not in warehouse_ids and bool(w.get("isConsolidationHub"))
    ]
    if not consolidation_candidates:
        consolidation_candidates = [
            w for _, _, w in scored
            if str(w["_id"]) not in warehouse_ids
        ]
    if not consolidation_candidates:
        consolidation_candidates = [w for _, _, w in scored]
    consolidation = consolidation_candidates[0]

    destination_point = destination or {}
    total_quantity = sum(float(x["quantity"]) for x in allocations)
    local_hub = await nearest_local_hub(destination_point, total_quantity) if destination_point else None

    now = datetime.utcnow()
    transfer_collection = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    consolidation_collection = MongoDB.get_collection("farmer_fulfillment_consolidations")

    existing = await consolidation_collection.find_one({
        "orderId": order["_id"],
        "deletedAt": None,
    })
    consolidation_id = existing["_id"] if existing else None

    if not consolidation_id:
        consolidation_doc = {
            "orderId": order["_id"],
            "orderNumber": order.get("orderNumber"),
            "farmerId": order.get("farmerId"),
            "sourceWarehouseIds": [ObjectId(x) for x in warehouse_ids],
            "consolidationWarehouseId": consolidation["_id"],
            "consolidationWarehouseName": consolidation.get("name") or consolidation.get("warehouseName") or "Consolidation Hub",
            "localHubId": local_hub["_id"] if local_hub else None,
            "localHubName": local_hub.get("name") if local_hub else None,
            "status": "collecting_from_warehouses",
            "createdAt": now,
            "updatedAt": now,
            "deletedAt": None,
        }
        ins = await consolidation_collection.insert_one(consolidation_doc)
        consolidation_id = ins.inserted_id
    else:
        await consolidation_collection.update_one(
            {"_id": consolidation_id},
            {"$set": {
                "sourceWarehouseIds": [ObjectId(x) for x in warehouse_ids],
                "consolidationWarehouseId": consolidation["_id"],
                "consolidationWarehouseName": consolidation.get("name") or consolidation.get("warehouseName") or "Consolidation Hub",
                "localHubId": local_hub["_id"] if local_hub else None,
                "localHubName": local_hub.get("name") if local_hub else None,
                "updatedAt": now,
            }},
        )

    # Rebuild only open/pending legs for idempotency.
    await transfer_collection.update_many(
        {"orderId": order["_id"], "legType": "warehouse_to_consolidation", "status": {"$in": ["pending", "in_transit"]}, "deletedAt": None},
        {"$set": {"deletedAt": now, "updatedAt": now}},
    )

    for allocation in allocations:
        await transfer_collection.insert_one({
            "orderId": order["_id"],
            "orderNumber": order.get("orderNumber"),
            "consolidationId": consolidation_id,
            "legType": "warehouse_to_consolidation",
            "sourceWarehouseId": allocation["warehouseId"],
            "sourceWarehouseName": allocation["warehouseName"],
            "destinationWarehouseId": consolidation["_id"],
            "destinationWarehouseName": consolidation.get("name") or consolidation.get("warehouseName") or "Consolidation Hub",
            "productId": ObjectId(str(allocation["productId"])) if allocation.get("productId") and ObjectId.is_valid(str(allocation["productId"])) else allocation.get("productId"),
            "variantId": ObjectId(str(allocation["variantId"])) if allocation.get("variantId") and ObjectId.is_valid(str(allocation["variantId"])) else None,
            "productName": allocation["productName"],
            "quantity": allocation["quantity"],
            "unit": allocation["unit"],
            # Every portion starts pending. A source warehouse that is
            # also the consolidation warehouse is marked received there only
            # after its incoming packed shipment has been received and stored.
            "status": "pending",
            "createdAt": now,
            "updatedAt": now,
            "deletedAt": None,
        })
    # A source allocation must never be considered received at the
    # consolidation warehouse merely because the source warehouse stored it.
    # The destination warehouse has an explicit receive action.
    # Create one packed-transfer incoming record per warehouse allocation.
    # These are receiving records, not warehouse packing tasks.
    incoming_collection = MongoDB.get_collection("incoming_stock")
    collection_jobs_by_warehouse: Dict[str, list] = {}
    await incoming_collection.update_many(
        {"orderId": order["_id"], "sourceMode": "farmer_fulfillment_transfer", "deletedAt": None},
        {"$set": {"deletedAt": now, "updatedAt": now}},
    )
    for allocation in allocations:
        wid = ObjectId(str(allocation["warehouseId"]))
        pid = ObjectId(str(allocation["productId"])) if allocation.get("productId") and ObjectId.is_valid(str(allocation["productId"])) else allocation.get("productId")
        vid = ObjectId(str(allocation["variantId"])) if allocation.get("variantId") and ObjectId.is_valid(str(allocation["variantId"])) else None
        incoming_doc = {
            "warehouseId": wid,
            "productId": pid,
            "variantId": vid,
            "productName": allocation.get("productName") or "Product",
            "unit": allocation.get("unit") or "kg",
            "farmerId": ObjectId(str(order.get("farmerId") or order.get("farmer_id"))) if ObjectId.is_valid(str(order.get("farmerId") or order.get("farmer_id") or "")) else None,
            "orderId": order["_id"],
            # Preserve the allocated quantity exactly; farmer-packed orders may
            # contain fractional weights (for example 2.5 kg).
            "quantity": float(allocation["quantity"]),
            "quantityReceived": 0,
            "usableQuantity": 0,
            "qualityCheck": "pending",
            "warehouseTransferType": "packed_order_transfer",
            "packingRequired": False,
            "warehousePackingRequired": False,
            "transferReadyForPickup": True,
            "warehouseTransferReadyForPickup": True,
            "warehouseTransferReadyAt": now,
            # The packed shipment is ready for collection, but is not in
            # physical transit until the collection team marks it collected.
            "readyForPickup": True,
            "readyForPickupAt": now,
            "pickupLocation": origin or order.get("farmLocation") or order.get("originLocation") or order.get("pickupLocation") or {},
            "farmLocation": origin or {},
            "status": "scheduled",
            "sourceMode": "farmer_fulfillment_transfer",
            "consolidationId": consolidation_id,
            "consolidationWarehouseId": consolidation["_id"],
            "batchNumber": allocation.get("batchNumber"),
            "createdAt": now,
            "updatedAt": now,
            "deletedAt": None,
        }
        incoming_result = await incoming_collection.insert_one(incoming_doc)
        incoming_doc["_id"] = incoming_result.inserted_id
        # Create the warehouse-side farm collection task tied to this incoming
        # stock line. It appears in Farm Collection Queue and progresses
        # ready_for_pickup -> team_assigned -> ... -> arrived_warehouse.
        collection_job = await ensure_collection_job(
            incoming_doc,
            collection_type="packed_orders_transfer",
            source_mode="farmer_fulfillment_transfer",
        )
        collection_jobs_by_warehouse.setdefault(str(wid), []).append({
            "incomingStockId": str(incoming_doc["_id"]),
            "collectionJobId": str(collection_job.get("_id")) if collection_job and collection_job.get("_id") else None,
            "productName": allocation.get("productName") or "Product",
            "quantity": float(allocation["quantity"]),
            "unit": allocation.get("unit") or "kg",
        })

    # Notify each assigned warehouse once, after its pickup queue records
    # exist. The warehouse manager still chooses/assigns the collection team;
    # the system never auto-assigns a human pickup team.
    warehouse_by_id = {str(w.get("_id")): w for w in warehouses}
    for warehouse_key, lines in collection_jobs_by_warehouse.items():
        source_warehouse = warehouse_by_id.get(warehouse_key) or {}
        # Older warehouse records may link the manager through userId rather than managerId.
        # Route-time notifications should resolve the same account that warehouse login resolves.
        manager_id = (
            source_warehouse.get("managerId")
            or source_warehouse.get("manager_id")
            or source_warehouse.get("userId")
            or source_warehouse.get("user_id")
        )
        if not manager_id or not ObjectId.is_valid(str(manager_id)):
            import logging
            logging.getLogger(__name__).warning(
                "Skipping farmer-fulfillment pickup notification: warehouse manager ID is missing or invalid",
                extra={"orderId": str(order["_id"]), "warehouseId": warehouse_key},
            )
            continue
        manager_id = str(ObjectId(str(manager_id)))
        item_summary = ", ".join(
            f"{line['productName']} {line['quantity']:g} {line['unit']}"
            for line in lines
        )
        try:
            created_notification = await NotificationService.create_in_app_notification(
                str(manager_id),
                NotificationType.WAREHOUSE,
                f"Packed order #{order.get('orderNumber') or str(order['_id'])} ready for pickup",
                (
                    f"Long-distance Farmer Fulfillment is ready for farm collection. "
                    f"Allocated items: {item_summary}. Open Warehouse → Incoming Stock → "
                    f"Farm Collection Queue and assign a pickup team. The shipment must "
                    f"be physically collected and marked Arrived Warehouse before receiving."
                ),
                data={
                    "type": "farmer_fulfillment_pickup_ready",
                    "orderId": str(order["_id"]),
                    "orderNumber": order.get("orderNumber"),
                    "warehouseId": warehouse_key,
                    "url": "/incoming",
                    "actionUrl": "/incoming",
                    "incomingStockIds": [line["incomingStockId"] for line in lines],
                    "collectionJobIds": [line["collectionJobId"] for line in lines if line["collectionJobId"]],
                    "logisticsMode": "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
                },
                priority=NotificationPriority.HIGH,
                mandatory=True,
            )
            if not created_notification:
                import logging
                logging.getLogger(__name__).warning(
                    "Warehouse pickup notification was not persisted",
                    extra={"orderId": str(order["_id"]), "warehouseId": warehouse_key, "managerId": manager_id},
                )
        except Exception:
            # A notification failure must not erase the route or the pickup job.
            import logging
            logging.getLogger(__name__).exception(
                "Failed to notify warehouse manager of farmer-packed pickup",
                extra={"orderId": str(order["_id"]), "warehouseId": warehouse_key},
            )


    return {
        "allocations": allocations,
        "warehouseIds": warehouse_ids,
        "warehouseCount": len(warehouse_ids),
        "consolidationId": str(consolidation_id),
        "consolidationWarehouse": {
            "id": str(consolidation["_id"]),
            "name": consolidation.get("name") or consolidation.get("warehouseName") or "Consolidation Hub",
        },
        "localHub": {
            "id": str(local_hub["_id"]),
            "name": local_hub.get("name") or local_hub.get("hubName") or "Local Fulfillment Hub",
            "address": local_hub.get("address") or "",
            "coordinates": (local_hub.get("location") or {}).get("coordinates")
                or (local_hub.get("coordinates") or {}).get("coordinates") or [],
        } if local_hub else None,
    }

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
    if str(order.get("fulfillmentMethod") or order.get("fulfillment_route") or "").lower() in ("farmer", "farm_direct"):
        # The Order Map, plan endpoint, and routing service share this rule.
        is_packed = is_packed_farmer_order(order)
        if not is_packed:
            raise ValueError("Farmer order must be packed before delivery routing.")
        if str(order.get("orderStatus") or order.get("status") or "").lower() in (
            "cancelled", "delivered", "picked_up", "refunded", "completed"
        ):
            raise ValueError("Farmer order is no longer eligible for delivery routing.")

    items = order.get("items") or []
    quantity = float(sum(float(i.get("quantity") or 0) for i in items))
    origin = order.get("farmLocation") or order.get("originLocation") or order.get("pickupLocation")
    delivery_address = order.get("deliveryAddress") or {}
    destination = (
        delivery_address.get("location")
        or delivery_address.get("deliveryLocation")
        or delivery_address.get("geo")
    )
    if not destination:
        lat = delivery_address.get("lat", delivery_address.get("latitude"))
        lng = delivery_address.get("lng", delivery_address.get("longitude"))
        if lat is not None and lng is not None:
            destination = {"lat": lat, "lng": lng}

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

    # Resource availability must not cancel the Farmer Order Map decision.
    # The route decision is automatic and should be persisted even when the
    # selected warehouse/hub is temporarily unavailable or has insufficient
    # capacity. The downstream handoff remains pending until the resource is
    # available; the farmer must not be asked to re-select the order.
    resource_pending = False
    if warehouse_route and mode == "long_distance" and not hub:
        resource_pending = True
    elif not warehouse_route and mode == "nearby" and not hub:
        resource_pending = True
    elif not warehouse_route and mode == "long_distance" and (not warehouse or not hub):
        resource_pending = True

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
            "hub_handoff_pending"
            if resource_pending and mode == "nearby"
            else "warehouse_transfer_pending"
            if resource_pending and mode == "long_distance"
            else "partner_pending"
            if mode == "nearby"
            else "warehouse_transfer_pending"
        ),
        "partnerAssignmentOpen": mode == "nearby" and not resource_pending,
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
    if not warehouse_route and mode == "long_distance":
        # The route decision creates farm-pickup collection work first. The
        # warehouse must not appear to have received the package until its
        # collection lifecycle reaches arrived_warehouse.
        update["warehouseFulfillmentStage"] = "awaiting_warehouse_receipt"
        update["warehouseCollectionStatus"] = "ready_for_pickup"

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

    # A long-distance farmer-packed order is not dispatched merely because
    # distance routing was chosen. It remains packed/in processing until the
    # farm collection team physically collects it for the warehouse transfer.
    # Warehouse dispatch and final delivery-job creation happen at their own
    # later handoff steps.
    if not warehouse_route and mode == "long_distance":
        update["fulfillmentStage"] = "packed"
        update["orderStatus"] = "processing"
        update["dispatchReadyChecklistComplete"] = False
        update["deliveryDispatchStatus"] = "pending"
        update["deliveryDispatchAt"] = None
        update["warehouseFulfillmentStage"] = "awaiting_warehouse_receipt"
        update["warehouseCollectionStatus"] = "ready_for_pickup"
    elif not warehouse_route:
        dispatch_at = datetime.utcnow()
        update["fulfillmentStage"] = "dispatched"
        update["orderStatus"] = "ready_for_delivery"
        update["dispatchedAt"] = dispatch_at
        update["dispatchReadyChecklistComplete"] = True
        update["deliveryDispatchStatus"] = "dispatched"
        update["deliveryDispatchAt"] = dispatch_at

    await MongoDB.get_collection("orders").update_one({"_id": order["_id"]}, {"$set": update})

    # Farmer Fulfillment + long distance may use several warehouses. The initial
    # route decision is saved above; merge the allocation/consolidation metadata
    # and persist it again so the customer order remains the single source of truth.
    #
    # transfer point. The farmer has already packed the individual order, so
    # the warehouse must never create another packing task for this route.
    multi_warehouse = None
    if mode == "long_distance" and str(order.get("fulfillmentMethod") or "").lower() in ("farmer", "farm_direct"):
        multi_warehouse = await allocate_farmer_fulfillment_warehouses(
            order,
            origin,
            destination,
        )
        warehouse_ids = [ObjectId(x) for x in multi_warehouse["warehouseIds"]]
        update["warehouseIds"] = warehouse_ids
        update["warehouseCount"] = multi_warehouse["warehouseCount"]
        update["warehouseAllocations"] = multi_warehouse["allocations"]
        update["warehouseId"] = ObjectId(multi_warehouse["warehouseIds"][0]) if len(multi_warehouse["warehouseIds"]) == 1 else None
        update["consolidationId"] = ObjectId(multi_warehouse["consolidationId"])
        update["consolidationWarehouseId"] = ObjectId(multi_warehouse["consolidationWarehouse"]["id"])
        update["consolidationWarehouseName"] = multi_warehouse["consolidationWarehouse"]["name"]
        update["consolidationStatus"] = "collecting_from_warehouses"
        if multi_warehouse.get("localHub"):
            update["nearbyFulfillmentLocationId"] = ObjectId(multi_warehouse["localHub"]["id"])
            update["nearbyFulfillmentLocation"] = multi_warehouse["localHub"]
        update["transferStatus"] = "warehouse_consolidation_pending"
        update["logisticsMode"] = "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
        await MongoDB.get_collection("orders").update_one({"_id": order["_id"]}, {"$set": update})

    return {
        "route": mode,
        "warehouse": {"id": str(warehouse["_id"]), "name": warehouse.get("name")} if warehouse else None,
        "hub": {"id": str(hub["_id"]), "name": hub.get("name")} if hub else None,
        "logisticsMode": update["logisticsMode"],
        "transferStatus": update["transferStatus"],
        "resourcePending": resource_pending,
        "warehouseAllocations": (multi_warehouse or {}).get("allocations", []),
        "warehouseCount": (multi_warehouse or {}).get("warehouseCount", 1 if warehouse else 0),
        "consolidationWarehouse": (multi_warehouse or {}).get("consolidationWarehouse"),
        "consolidationId": (multi_warehouse or {}).get("consolidationId"),
        "finalLocalHub": (multi_warehouse or {}).get("localHub") or ({"id": str(hub["_id"]), "name": hub.get("name")} if hub else None),
    }
