from typing import Any, Dict, List, Optional
from datetime import datetime
from bson import ObjectId
import math

from app.repositories.warehouse_collection_repository import warehouse_collection_repository
from app.repositories.warehouse_pickup_route_repository import warehouse_pickup_route_repository
from app.repositories.warehouse_pickup_team_repository import warehouse_pickup_team_repository
from app.services.notification_service import NotificationService
from app.database.mongodb import MongoDB
from app.repositories.farmer_repository import farmer_repository
from app.repositories.delivery_repository import delivery_repository
from app.repositories.order_repository import order_repository
from app.repositories.warehouse_repository import warehouse_repository
from app.services.user_service import UserService


def _point(location: Optional[Dict[str, Any]]) -> Optional[tuple]:
    coords = (location or {}).get("coordinates")
    if coords and len(coords) >= 2:
        try:
            return float(coords[1]), float(coords[0])
        except (TypeError, ValueError):
            return None
    return None


def _distance(a: Optional[tuple], b: Optional[tuple]) -> float:
    if not a or not b:
        return 0.0
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    x = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.atan2(math.sqrt(x), math.sqrt(max(0.0, 1 - x)))


def _serialize_route(route: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(route)
    for key in ("_id", "warehouseId", "deliveryPartnerId"):
        if result.get(key) is not None:
            result["id" if key == "_id" else key] = str(result[key])
    result["stops"] = result.get("stops") or []
    for stop in result["stops"]:
        for key in ("collectionId", "farmerId", "orderId"):
            if stop.get(key) is not None:
                stop[key] = str(stop[key])
        for key in ("collectionIds", "orderIds"):
            if stop.get(key):
                stop[key] = [str(value) for value in stop[key]]
        for order in stop.get("orders") or []:
            for key in ("collectionId", "incomingStockId", "orderId", "farmerId", "productId", "variantId", "batchId"):
                if order.get(key) is not None:
                    order[key] = str(order[key])
    return result


def select_route_team_assignments(
    route_groups: List[Dict[str, Any]],
    memberships: List[Dict[str, Any]],
    busy_partner_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Choose one approved, capacity-suitable pickup team per route.

    Each team is assigned at most one route in this batch. Teams already carrying
    an active route are excluded. Best-fit selection avoids wasting the largest
    vehicles on small routes.
    """
    busy = {str(value) for value in (busy_partner_ids or [])}
    available = []
    for member in memberships:
        partner_id = str(member.get("deliveryPartnerId") or "")
        try:
            capacity = float(member.get("capacity") or 0)
        except (TypeError, ValueError):
            capacity = 0
        if partner_id and capacity > 0 and partner_id not in busy:
            item = dict(member)
            item["_assignmentCapacity"] = capacity
            available.append(item)

    assignments: List[Dict[str, Any]] = []
    for group in route_groups:
        required = float(group.get("totalQuantity") or 0)
        suitable = [member for member in available if member["_assignmentCapacity"] >= required]
        if not suitable:
            raise ValueError(
                f"No unassigned approved pickup team has enough capacity for a "
                f"{required:g} kg route. Offer routes to partners or review vehicle capacity."
            )
        chosen = min(suitable, key=lambda member: member["_assignmentCapacity"])
        available.remove(chosen)
        chosen.pop("_assignmentCapacity", None)
        assignments.append(chosen)
    return assignments


def _farm_key(job: Dict[str, Any]) -> str:
    """Use the farm identity first, then a known location when legacy data lacks it."""
    farmer_id = str(job.get("farmerId") or "").strip()
    if farmer_id:
        return f"farmer:{farmer_id.lower()}"
    location = job.get("pickupLocation") or {}
    coords = location.get("coordinates") if isinstance(location, dict) else None
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            return f"location:{round(float(coords[0]), 5)}:{round(float(coords[1]), 5)}"
        except (TypeError, ValueError):
            pass
    if isinstance(location, dict):
        address = (
            location.get("formattedAddress")
            or location.get("address")
            or location.get("farmAddress")
            or job.get("pickupAddress")
        )
        if address and str(address).strip():
            return f"address:{' '.join(str(address).lower().split())}"
    return f"collection:{job.get('_id')}"


def _group_jobs_by_farm(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One route stop per farm, with all order-level collection jobs nested inside."""
    grouped: Dict[str, Dict[str, Any]] = {}
    for job in jobs:
        key = _farm_key(job)
        if key not in grouped:
            grouped[key] = {
                "farmKey": key,
                "farmerId": str(job.get("farmerId")) if job.get("farmerId") else None,
                "farmerName": job.get("farmerName") or "Farmer",
                "pickupLocation": job.get("pickupLocation") or {},
                "orders": [],
            }
        group = grouped[key]
        order = {
            "collectionId": str(job["_id"]),
            "incomingStockId": str(job["incomingStockId"]) if job.get("incomingStockId") else None,
            "orderId": str(job["orderId"]) if job.get("orderId") else None,
            "farmerId": str(job["farmerId"]) if job.get("farmerId") else None,
            "productId": str(job["productId"]) if job.get("productId") else None,
            "variantId": str(job["variantId"]) if job.get("variantId") else None,
            "farmerName": job.get("farmerName") or group["farmerName"],
            "productName": job.get("productName") or "Farm Product",
            "quantity": float(job.get("quantity") or 0),
            "batchId": str(job["batchId"]) if job.get("batchId") else None,
            "batchNumber": job.get("batchNumber"),
            "qualityGrade": job.get("qualityGrade"),
            "storageType": job.get("storageType") or "ambient",
            "collectionType": job.get("collectionType"),
            "status": job.get("status") or "ready_for_pickup",
            "actualQuantity": job.get("actualCollectedQuantity"),
        }
        group["orders"].append(order)

    result = []
    for group in grouped.values():
        orders = group["orders"]
        total_quantity = sum(float(order.get("quantity") or 0) for order in orders)
        product_names = list(dict.fromkeys(
            str(order.get("productName") or "Farm Product") for order in orders
        ))
        first = orders[0]
        result.append({
            "farmKey": group["farmKey"],
            "farmerId": group["farmerId"],
            "farmerName": group["farmerName"],
            "pickupLocation": group["pickupLocation"],
            "collectionId": first["collectionId"],
            "collectionIds": [order["collectionId"] for order in orders],
            "orderIds": [order["orderId"] for order in orders if order.get("orderId")],
            "orders": orders,
            "orderCount": len(orders),
            "incomingStockId": first.get("incomingStockId"),
            "orderId": first.get("orderId"),
            "productId": first.get("productId"),
            "variantId": first.get("variantId"),
            "productName": product_names[0] if len(product_names) == 1 else f"{len(product_names)} product types",
            "quantity": total_quantity,
            "batchId": first.get("batchId"),
            "batchNumber": first.get("batchNumber"),
            "status": "pending",
        })
    return result


async def build_smart_routes(
    warehouse: Dict[str, Any],
    jobs: List[Dict[str, Any]],
    max_stops: Optional[int] = None,
    max_weight_kg: float = 0,
) -> List[Dict[str, Any]]:
    """Create farm-based routes, consolidating every selected order from the same farm."""
    warehouse_point = _point(warehouse.get("location"))
    remaining = _group_jobs_by_farm(jobs)
    routes: List[Dict[str, Any]] = []
    route_no = 1
    while remaining:
        current = warehouse_point
        selected = []
        weight = 0.0
        while remaining and (max_stops is None or len(selected) < max_stops):
            candidates = []
            for farm in remaining:
                qty = float(farm.get("quantity") or 0)
                if max_weight_kg > 0 and qty > max_weight_kg:
                    if not selected:
                        raise ValueError(
                            f"Orders from {farm.get('farmerName') or 'one farm'} total {qty:g} kg, "
                            f"which exceeds the selected vehicle capacity of {max_weight_kg:g} kg. "
                            "Select a larger vehicle or split the pickup into separate trips."
                        )
                    continue
                if max_weight_kg > 0 and selected and weight + qty > max_weight_kg:
                    continue
                point = _point(farm.get("pickupLocation"))
                candidates.append((_distance(current, point) if current and point else 999999.0, farm))
            if not candidates:
                break
            _, chosen = min(candidates, key=lambda entry: entry[0])
            remaining.remove(chosen)
            point = _point(chosen.get("pickupLocation"))
            chosen["sequence"] = len(selected) + 1
            selected.append(chosen)
            weight += float(chosen.get("quantity") or 0)
            current = point or current
        if not selected:
            break
        routes.append({
            "routeNumber": route_no,
            "stops": selected,
            "totalStops": len(selected),
            "totalOrders": sum(int(stop.get("orderCount") or 0) for stop in selected),
            "totalQuantity": weight,
        })
        route_no += 1
    return routes


async def assign_route(route: Dict[str, Any], membership: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    partner_id = str(membership["deliveryPartnerId"])
    route_id = str(route["_id"])
    await warehouse_pickup_route_repository.update_route(route_id, {
        "deliveryPartnerId": ObjectId(partner_id),
        "status": "assigned",
        "assignedAt": datetime.utcnow(),
        "assignedBy": route.get("assignedBy"),
    })
    for stop in route.get("stops") or []:
        collection_ids = stop.get("collectionIds") or [stop.get("collectionId")]
        for collection_id in collection_ids:
            if not collection_id or not ObjectId.is_valid(str(collection_id)):
                continue
            await warehouse_collection_repository.update_job(str(collection_id), {
                "pickupRouteId": ObjectId(route_id),
                "collectionTeamId": ObjectId(partner_id),
                "status": "team_assigned",
                "teamAssignedAt": datetime.utcnow(),
            })
    try:
        await NotificationService.send_custom_notification(
            str(membership["deliveryPartnerUserId"]),
            f"Pickup route {route.get('routeNumber', route_id)} assigned: {len(route.get('stops') or [])} farm stops.",
        )
    except Exception:
        pass
    return await warehouse_pickup_route_repository.get_by_id(route_id)


async def enrich_route_assignment(route: Dict[str, Any]) -> Dict[str, Any]:
    """Add stable winner identity/vehicle data for every eligible partner."""
    result = dict(route)
    partner_id = result.get("deliveryPartnerId")
    if partner_id:
        partner = None
        try:
            from app.repositories.delivery_repository import delivery_repository
            partner = await delivery_repository.get_by_id(str(partner_id))
        except Exception:
            partner = None
        if partner:
            result["deliveryPartnerVehicleType"] = (
                result.get("deliveryPartnerVehicleType")
                or partner.get("vehicleType")
            )
            result["deliveryPartnerVehicleNumber"] = (
                result.get("deliveryPartnerVehicleNumber")
                or partner.get("vehicleNumber")
            )
            if not result.get("deliveryPartnerName"):
                try:
                    from app.services.user_service import UserService
                    user = await UserService.get_user_by_id(str(partner.get("userId")))
                    if user:
                        result["deliveryPartnerName"] = (
                            f"{user.get('firstName', '')} {user.get('lastName', '')}".strip()
                            or user.get("name")
                        )
                except Exception:
                    pass
    return result



def _human_text(value: Any) -> Optional[str]:
    """Return readable field values while hiding raw database IDs."""
    if value is None or isinstance(value, ObjectId):
        return None
    text = str(value).strip()
    if not text or ObjectId.is_valid(text):
        return None
    return text


def _person_name(user: Optional[Dict[str, Any]]) -> Optional[str]:
    if not user:
        return None
    full_name = " ".join(
        piece for piece in (
            _human_text(user.get("firstName")),
            _human_text(user.get("lastName")),
        ) if piece
    )
    return full_name or _human_text(user.get("name")) or _human_text(user.get("displayName"))


async def enrich_pickup_route_display(route: Dict[str, Any]) -> Dict[str, Any]:
    """Enrich pickup routes from current collection records for warehouse and partner UIs."""
    if not route:
        return route
    result = dict(route)
    products = MongoDB.get_collection("products")
    batches = MongoDB.get_collection("batches")
    order_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    product_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    farmer_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    user_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    batch_cache: Dict[str, Optional[Dict[str, Any]]] = {}

    async def user_by_id(raw_id: Any) -> Optional[Dict[str, Any]]:
        key = str(raw_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in user_cache:
            user_cache[key] = await UserService.get_user_by_id(key)
        return user_cache[key]

    async def order_by_id(raw_id: Any) -> Optional[Dict[str, Any]]:
        key = str(raw_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in order_cache:
            order_cache[key] = await order_repository.get_by_id(key)
        return order_cache[key]

    async def product_by_id(raw_id: Any) -> Optional[Dict[str, Any]]:
        key = str(raw_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in product_cache:
            product_cache[key] = await products.find_one({"_id": ObjectId(key), "deletedAt": None})
            if not product_cache[key]:
                product_cache[key] = await products.find_one({"_id": key, "deletedAt": None})
        return product_cache[key]

    async def farmer_by_id(raw_id: Any) -> Optional[Dict[str, Any]]:
        key = str(raw_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in farmer_cache:
            profile = await farmer_repository.get_by_user_id(key)
            if not profile:
                profile = await farmer_repository.get_by_id(key)
            farmer_cache[key] = profile
        return farmer_cache[key]

    async def batch_by_id(raw_id: Any) -> Optional[Dict[str, Any]]:
        key = str(raw_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in batch_cache:
            batch_cache[key] = await batches.find_one({"_id": ObjectId(key), "deletedAt": None})
        return batch_cache[key]

    def address_text(raw_address: Any) -> Optional[str]:
        if isinstance(raw_address, str):
            return _human_text(raw_address)
        if not isinstance(raw_address, dict):
            return None
        for key in ("formattedAddress", "address", "farmAddress", "streetAddress", "addressLine"):
            value = _human_text(raw_address.get(key))
            if value:
                return value
        parts = [
            _human_text(raw_address.get(key))
            for key in ("addressLine1", "addressLine2", "street", "village", "city", "district", "state", "pincode", "zipCode")
        ]
        return ", ".join(part for part in parts if part) or None

    warehouse_id = str(result.get("warehouseId") or "")
    warehouse = await warehouse_repository.get_by_id(warehouse_id) if ObjectId.is_valid(warehouse_id) else None
    result["warehouseName"] = (
        _human_text(result.get("warehouseName"))
        or _human_text((warehouse or {}).get("name"))
        or _human_text((warehouse or {}).get("warehouseName"))
        or "Assigned warehouse"
    )
    route_number = _human_text(result.get("routeNumber"))
    if route_number and route_number.isdigit():
        route_number = f"Pickup Route {route_number}"
    result["routeNumber"] = route_number or "Pickup Route"

    partner_id = str(result.get("deliveryPartnerId") or "")
    partner = await delivery_repository.get_by_id(partner_id) if ObjectId.is_valid(partner_id) else None
    partner_user = await user_by_id((partner or {}).get("userId"))
    result["deliveryPartnerName"] = (
        _human_text(result.get("deliveryPartnerName"))
        or _person_name(partner_user)
        or _human_text((partner or {}).get("name"))
        or ("Assigned pickup partner" if partner_id else None)
    )
    result["deliveryPartnerVehicleType"] = (
        _human_text(result.get("deliveryPartnerVehicleType"))
        or _human_text((partner or {}).get("vehicleType"))
    )
    result["deliveryPartnerVehicleNumber"] = (
        _human_text(result.get("deliveryPartnerVehicleNumber"))
        or _human_text((partner or {}).get("vehicleNumber"))
    )

    display_stops = []
    for original_stop in result.get("stops") or []:
        stop = dict(original_stop)
        collection_id = str(stop.get("collectionId") or "")
        job = await warehouse_collection_repository.get_by_id(collection_id) if ObjectId.is_valid(collection_id) else None
        if job:
            order = await order_by_id(job.get("orderId") or stop.get("orderId"))
            items = (order or {}).get("items") or []
            product_id = job.get("productId") or stop.get("productId")
            order_item = next(
                (
                    value for value in items
                    if product_id and str(value.get("productId") or value.get("product_id") or "") == str(product_id)
                ),
                items[0] if items else {},
            )
            product = await product_by_id(product_id or order_item.get("productId"))
            farmer = await farmer_by_id(job.get("farmerId") or stop.get("farmerId"))
            job_farmer_name = _human_text(job.get("farmerName"))
            if job_farmer_name in ("Farmer", "Farm", "Unknown Farmer"):
                job_farmer_name = None
            farmer_name = (
                job_farmer_name
                or _human_text((farmer or {}).get("farmName"))
                or _human_text((farmer or {}).get("ownerName"))
                or _human_text((farmer or {}).get("name"))
            )
            farmer_user = await user_by_id((farmer or {}).get("userId") or job.get("farmerId"))
            if not farmer_name:
                farmer_name = _person_name(farmer_user)
            if not farmer_name and _human_text(stop.get("farmerName")) not in (None, "Farmer"):
                farmer_name = _human_text(stop.get("farmerName"))
            farmer_name = farmer_name or "Farmer details unavailable"
            job_product_name = _human_text(job.get("productName"))
            if job_product_name in ("Farm Product", "Product", "Product details unavailable"):
                job_product_name = None
            product_name = (
                job_product_name
                or _human_text((product or {}).get("name"))
                or _human_text((product or {}).get("productName"))
                or _human_text((product or {}).get("title"))
                or _human_text(order_item.get("productName"))
                or _human_text(order_item.get("name"))
                or "Product details unavailable"
            )
            batch = await batch_by_id(job.get("batchId"))
            order_number = (
                _human_text((order or {}).get("orderNumber"))
                or _human_text((order or {}).get("orderNo"))
                or _human_text((order or {}).get("referenceNumber"))
                or _human_text(stop.get("orderNumber"))
            )
            if order_number and not order_number.upper().startswith(("ORD", "ORDER", "#")):
                order_number = f"ORD-{order_number}"
            team_id = str(job.get("collectionTeamId") or "")
            team = await delivery_repository.get_by_id(team_id) if ObjectId.is_valid(team_id) else None
            team_user = await user_by_id((team or {}).get("userId"))
            location = job.get("pickupLocation") or stop.get("pickupLocation") or {}
            address = address_text(location)
            if not address and farmer:
                address = address_text(farmer.get("farmAddress") or farmer.get("address"))
            stop.update({
                "farmerName": farmer_name,
                "productName": product_name,
                "orderNumber": order_number or ("Order reference unavailable" if job.get("orderId") else None),
                "batchNumber": (
                    _human_text(job.get("batchNumber"))
                    or _human_text((batch or {}).get("lotNumber"))
                    or _human_text((batch or {}).get("batchNumber"))
                ),
                "pickupAddress": address or "Farm address not provided",
                "status": _human_text(job.get("status")) or "ready_for_pickup",
                "actualQuantity": job.get("actualCollectedQuantity", stop.get("actualQuantity")),
                "collectionTeamName": _person_name(team_user) or _human_text((team or {}).get("name")) or "Assigned pickup partner",
            })
        else:
            stop["farmerName"] = _human_text(stop.get("farmerName")) or "Farmer details unavailable"
            stop["productName"] = _human_text(stop.get("productName")) or "Product details unavailable"
            stop["orderNumber"] = _human_text(stop.get("orderNumber")) or None
            stop["pickupAddress"] = address_text(stop.get("pickupLocation")) or "Farm address not provided"
            stop["status"] = _human_text(stop.get("status")) or "pending"
        display_stops.append(stop)
    result["stops"] = display_stops
    return serialize_route(result)

def serialize_route(route: Dict[str, Any]) -> Dict[str, Any]:
    return _serialize_route(route)
