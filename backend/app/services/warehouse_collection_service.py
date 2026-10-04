from typing import Any, Dict, Optional
from bson import ObjectId
from datetime import datetime
from app.repositories.warehouse_collection_repository import (
    warehouse_collection_repository,
    COLLECTION_READY,
)


async def ensure_collection_job(incoming: Dict[str, Any], collection_type: str, source_mode: str) -> Optional[Dict[str, Any]]:
    """Create one farm collection job for an incoming stock record."""
    if not incoming or not incoming.get("_id") or not incoming.get("warehouseId") or not incoming.get("farmerId"):
        return None
    existing = await warehouse_collection_repository.get_by_incoming(str(incoming["_id"]))
    if existing:
        return existing
    job_id = await warehouse_collection_repository.create_job({
        "warehouseId": incoming["warehouseId"],
        "incomingStockId": incoming["_id"],
        "orderId": incoming.get("orderId"),
        "farmerId": incoming["farmerId"],
        "productId": incoming.get("productId"),
        "variantId": incoming.get("variantId"),
        "quantity": float(incoming.get("quantity", 0) or 0),
        "packageCount": int(incoming.get("packageCount", 1) or 1),
        "collectionType": collection_type,
        "sourceMode": source_mode,
        "packingRequired": bool(incoming.get("packingRequired", True)),
        "packingVerified": incoming.get("packingRequired") is False or bool(incoming.get("packingVerified")),
        "readyForPickup": True,
        "pickupLocation": incoming.get("pickupLocation") or incoming.get("farmLocation") or {},
        "status": COLLECTION_READY if incoming.get("readyForPickup") else "scheduled",
        "readyAt": incoming.get("readyForPickupAt") or datetime.utcnow(),
    })
    return await warehouse_collection_repository.get_by_id(job_id) if job_id else None


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
    result["isBulkHarvest"] = result.get("collectionType") == "bulk_harvest"
    return result
