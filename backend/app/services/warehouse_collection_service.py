from typing import Any, Dict, Optional
from bson import ObjectId
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from app.repositories.warehouse_collection_repository import (
    warehouse_collection_repository,
    COLLECTION_READY,
)

_DISTRICT_ALIASES = {
    "trichy": "tiruchirappalli",
    "trichirapalli": "tiruchirappalli",
    "tiruchirapalli": "tiruchirappalli",
    "tiruchirappalli": "tiruchirappalli",
    "krishnagiri district": "krishnagiri",
}
_KNOWN_DISTRICT_ALIASES = {
    "tiruchirappalli": ("tiruchirappalli", "tiruchirapalli", "trichirapalli", "trichy"),
    "krishnagiri": ("krishnagiri",),
    "perambalur": ("perambalur",),
    "coimbatore": ("coimbatore",),
    "tiruppur": ("tiruppur", "tirupur"),
    "erode": ("erode",),
    "salem": ("salem",),
    "madurai": ("madurai",),
    "thanjavur": ("thanjavur", "tanjore"),
    "chennai": ("chennai",),
}


def normalize_collection_district(value: Any) -> str:
    raw = " ".join(str(value or "").strip().lower().replace(",", " ").replace("-", " ").split())
    return _DISTRICT_ALIASES.get(raw, raw)


def warehouse_collection_districts(warehouse: Dict[str, Any]) -> set[str]:
    """Return configured farm coverage, falling back to the warehouse Settings location."""
    configured = {
        normalize_collection_district(value)
        for value in (warehouse.get("farmCollectionDistricts") or [])
        if str(value or "").strip()
    }
    if configured:
        return configured

    address = warehouse.get("address") if isinstance(warehouse.get("address"), dict) else {}
    location = warehouse.get("location") if isinstance(warehouse.get("location"), dict) else {}
    candidates = (
        warehouse.get("farmCollectionDistrict"),
        warehouse.get("district"),
        address.get("district"),
        address.get("city"),
        location.get("district"),
        location.get("city"),
    )
    district = next(
        (normalize_collection_district(value) for value in candidates if isinstance(value, str) and value.strip()),
        None,
    )
    if district:
        return {district}

    location_text = normalize_collection_district(" ".join(str(value or "") for value in (
        address.get("line1"),
        address.get("line2"),
        address.get("street"),
        address.get("address"),
        location.get("address"),
        location.get("formattedAddress"),
    )))
    return {
        district
        for district, aliases in _KNOWN_DISTRICT_ALIASES.items()
        if any(alias in location_text for alias in aliases)
    }


def farmer_collection_district(
    profile: Optional[Dict[str, Any]],
    pickup_location: Any,
    configured_districts: set[str],
) -> Optional[str]:
    """Resolve a farmer's district only when it matches warehouse farm coverage."""
    if profile:
        for key in ("farmDistrict", "district", "farmCity", "city"):
            value = profile.get(key)
            if isinstance(value, str) and value.strip():
                candidate = normalize_collection_district(value)
                if candidate in configured_districts:
                    return candidate
        for address_key in ("farmAddress", "address"):
            address = profile.get(address_key)
            if isinstance(address, dict):
                for key in ("district", "city", "village"):
                    value = address.get(key)
                    if isinstance(value, str) and value.strip():
                        candidate = normalize_collection_district(value)
                        if candidate in configured_districts:
                            return candidate
                address_text = " ".join(str(value) for value in address.values() if value)
            else:
                address_text = str(address or "")
            normalized_address = normalize_collection_district(address_text)
            for district in configured_districts:
                aliases = _KNOWN_DISTRICT_ALIASES.get(district, (district,))
                if any(alias in normalized_address for alias in aliases):
                    return district
    if isinstance(pickup_location, dict):
        address_text = " ".join(
            str(pickup_location.get(key) or "")
            for key in ("district", "city", "address", "formattedAddress", "farmAddress", "streetAddress")
        )
        normalized_address = normalize_collection_district(address_text)
        for district in configured_districts:
            aliases = _KNOWN_DISTRICT_ALIASES.get(district, (district,))
            if any(alias in normalized_address for alias in aliases):
                return district
    return None


async def ensure_collection_job(incoming: Dict[str, Any], collection_type: str, source_mode: str) -> Optional[Dict[str, Any]]:
    """Create one farm collection job for an incoming stock record."""
    if not incoming or not incoming.get("_id") or not incoming.get("warehouseId"):
        return None
    ready_for_pickup = bool(
        incoming.get("readyForPickup")
        or incoming.get("transferReadyForPickup")
        or incoming.get("warehouseTransferReadyForPickup")
    )
    # Shared operating windows are stored in India Standard Time (IST).
    # Farm collection is overnight; warehouse-to-warehouse/local-hub transfers
    # are daytime activities.
    ist = ZoneInfo("Asia/Kolkata")
    now_ist = datetime.now(ist)
    night_start = now_ist.replace(hour=20, minute=0, second=0, microsecond=0)
    if now_ist.hour < 6:
        # If a job is created during an active overnight window, retain that
        # current window rather than postponing collection by almost a day.
        next_night_start = night_start - timedelta(days=1)
    else:
        next_night_start = night_start if now_ist >= night_start else night_start
    night_end = (next_night_start + timedelta(days=1)).replace(hour=6, minute=0, second=0, microsecond=0)
    packing_required = bool(incoming.get("packingRequired", True))
    job_fields = {
        "warehouseId": incoming["warehouseId"],
        "incomingStockId": incoming["_id"],
        "orderId": incoming.get("orderId"),
        "farmerId": incoming.get("farmerId"),
        "productId": incoming.get("productId"),
        "variantId": incoming.get("variantId"),
        "quantity": float(incoming.get("quantity", 0) or 0),
        "packageCount": int(incoming.get("packageCount", 1) or 1),
        "collectionType": collection_type,
        "sourceMode": source_mode,
        "packingRequired": packing_required,
        "packingVerified": (not packing_required) or bool(incoming.get("packingVerified")),
        "readyForPickup": ready_for_pickup,
        "pickupLocation": incoming.get("pickupLocation") or incoming.get("farmLocation") or {},
        "batchId": incoming.get("batchId"),
        "warehousePackingRequired": packing_required,
        "pickupResolutionStatus": incoming.get("pickupResolutionStatus"),
        "pickupResolutionMessage": incoming.get("pickupResolutionMessage"),
        "readyAt": incoming.get("readyForPickupAt") or incoming.get("warehouseTransferReadyAt") or datetime.utcnow(),
        "pickupSchedule": {
            "window": "overnight",
            "timezone": "Asia/Kolkata",
            "startAt": next_night_start.isoformat(),
            "endAt": night_end.isoformat(),
            "startLocal": "20:00",
            "endLocal": "06:00",
            "purpose": "farm_collection",
        },
        "downstreamTransferSchedule": {
            "window": "daytime",
            "timezone": "Asia/Kolkata",
            "startLocal": "06:00",
            "endLocal": "20:00",
            "purpose": "warehouse_to_warehouse_or_local_hub",
        },
    }

    existing = await warehouse_collection_repository.get_by_incoming(str(incoming["_id"]))
    if existing:
        # Reconcile stale scheduled jobs when the associated shipment has since
        # been marked ready. Do not reset a team-assigned or in-progress pickup.
        updates = dict(job_fields)
        if ready_for_pickup and str(existing.get("status") or "scheduled") in ("", "scheduled"):
            updates["status"] = COLLECTION_READY
        if updates:
            await warehouse_collection_repository.update_job(str(existing["_id"]), updates)
            refreshed = await warehouse_collection_repository.get_by_id(str(existing["_id"]))
            if refreshed:
                return refreshed
        return existing

    job_fields["status"] = COLLECTION_READY if ready_for_pickup else "scheduled"
    job_id = await warehouse_collection_repository.create_job(job_fields)
    return await warehouse_collection_repository.get_by_id(job_id) if job_id else None


def _serialize_mongo_values(value: Any) -> Any:
    """Recursively convert BSON ObjectIds before returning API response data.

    Collection records can contain ObjectIds inside nested fields such as
    pickupLocation. Converting only known top-level IDs leaves FastAPI/Pydantic
    unable to serialize those nested values.
    """
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {key: _serialize_mongo_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_serialize_mongo_values(item) for item in value]
    if isinstance(value, tuple):
        return [_serialize_mongo_values(item) for item in value]
    return value


def serialize_collection(job: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(job)
    for key in ("id", "_id", "warehouseId", "incomingStockId", "orderId", "farmerId", "productId", "variantId", "collectionTeamId"):
        if result.get(key) is not None:
            result["id" if key == "_id" else key] = str(result[key])
    if result.get("_id") is not None:
        result["id"] = str(result["_id"])
    result["readyForPickup"] = result.get("status") == COLLECTION_READY or bool(result.get("readyForPickup"))
    result["packingVerified"] = bool(result.get("packingVerified"))
    result["isPackedTransfer"] = result.get("collectionType") == "packed_orders_transfer"
    result["warehousePackingRequired"] = bool(result.get("packingRequired", True)) and not result["isPackedTransfer"]
    result["isBulkHarvest"] = result.get("collectionType") == "bulk_harvest"
    return _serialize_mongo_values(result)
