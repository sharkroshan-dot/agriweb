from typing import Any, Dict, List, Optional
from datetime import datetime
from bson import ObjectId
import math

from app.repositories.warehouse_collection_repository import warehouse_collection_repository
from app.repositories.warehouse_pickup_route_repository import warehouse_pickup_route_repository
from app.repositories.warehouse_pickup_team_repository import warehouse_pickup_team_repository
from app.services.notification_service import NotificationService


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
    return result


async def build_smart_routes(
    warehouse: Dict[str, Any],
    jobs: List[Dict[str, Any]],
    max_stops: int = 8,
    max_weight_kg: float = 0,
) -> List[Dict[str, Any]]:
    """Build one or more warehouse pickup routes using nearest-neighbour ordering.

    Capacity/stops split routes; farms with no coordinates are kept as individual
    stops so they are not silently lost.
    """
    warehouse_point = _point(warehouse.get("location"))
    remaining = list(jobs)
    routes: List[Dict[str, Any]] = []
    route_no = 1
    while remaining:
        current = warehouse_point
        selected = []
        weight = 0.0
        while remaining and len(selected) < max_stops:
            candidates = []
            for job in remaining:
                qty = float(job.get("quantity") or 0)
                if max_weight_kg > 0 and selected and weight + qty > max_weight_kg:
                    continue
                p = _point(job.get("pickupLocation"))
                candidates.append((_distance(current, p) if current and p else 999999.0, job))
            if not candidates:
                break
            _, chosen = min(candidates, key=lambda x: x[0])
            remaining.remove(chosen)
            p = _point(chosen.get("pickupLocation"))
            selected.append({
                "collectionId": str(chosen["_id"]),
                "incomingStockId": str(chosen["incomingStockId"]) if chosen.get("incomingStockId") else None,
                "orderId": str(chosen["orderId"]) if chosen.get("orderId") else None,
                "farmerId": str(chosen["farmerId"]) if chosen.get("farmerId") else None,
                "productId": str(chosen["productId"]) if chosen.get("productId") else None,
                "variantId": str(chosen["variantId"]) if chosen.get("variantId") else None,
                "farmerName": chosen.get("farmerName") or "Farmer",
                "productName": chosen.get("productName") or "Farm Product",
                "quantity": float(chosen.get("quantity") or 0),
                "pickupLocation": chosen.get("pickupLocation") or {},
                "status": "pending",
                "sequence": len(selected),
            })
            weight += float(chosen.get("quantity") or 0)
            current = p or current
        if not selected:
            break
        routes.append({
            "routeNumber": route_no,
            "stops": selected,
            "totalStops": len(selected),
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
        collection_id = str(stop["collectionId"])
        await warehouse_collection_repository.update_job(collection_id, {
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


def serialize_route(route: Dict[str, Any]) -> Dict[str, Any]:
    return _serialize_route(route)
