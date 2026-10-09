from typing import Any, Dict, Optional
from bson import ObjectId
from datetime import datetime
from app.repositories.warehouse_collection_repository import (
    warehouse_collection_repository,
    COLLECTION_READY,
)


async def ensure_collection_job(incoming: Dict[str, Any], collection_type: str, source_mode: str) -> Optional[Dict[str, Any]]:
    """Create one farm collection job for an incoming stock record."""
    if not incoming or not incoming.get("_id") or not incoming.get("warehouseId"):
        return None
    ready_for_pickup = bool(
        incoming.get("readyForPickup")
        or incoming.get("transferReadyForPickup")
        or incoming.get("warehouseTransferReadyForPickup")
    )
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
        "readyAt": incoming.get("readyForPickupAt") or incoming.get("warehouseTransferReadyAt") or datetime.utcnow(),
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
    return result
