"""Batch / lot management and product traceability.

Farmers group harvested produce into identifiable lots (LOT-YYYYMMDD-NNN).
Each batch tracks crop, harvest date, grade, storage type and freshness. A
batch can be converted into marketplace inventory (linked to a product) and,
once listed, customers can trace its journey via a public endpoint.

Collections:
  - batches: one harvest lot from a farmer
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.product_repository import product_repository
from app.repositories.user_repository import user_repository
from app.repositories.farmer_repository import farmer_repository
from app.core.quality import (
    VERIFICATION_STATUS_DECLARED,
    base_verification_fields,
    effective_grade,
)

logger = logging.getLogger(__name__)
router = APIRouter()

batch_repo = BaseRepository("batches")

STORAGE_TYPES = ["normal", "refrigerated", "cold_storage", "frozen"]
DEFAULT_SHELF_LIFE_DAYS = {"normal": 3, "refrigerated": 5, "cold_storage": 7, "frozen": 30}

BATCH_CREATED = "created"
BATCH_LISTED = "listed"
BATCH_EXPIRED = "expired"
BATCH_CANCELLED = "cancelled"


class BatchCreate(BaseModel):
    cropName: str
    quantityKg: float = Field(gt=0)
    harvestDate: Optional[datetime] = None
    qualityGrade: Optional[str] = None
    storageType: str = "normal"
    shelfLifeDays: Optional[int] = Field(None, ge=1, le=90)
    productId: Optional[str] = None
    sourceHarvestPlanId: Optional[str] = None
    notes: Optional[str] = None


def _to_naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _freshness(batch: dict) -> Dict[str, Any]:
    """Return freshness status based on harvest date and shelf life."""
    harvest = _to_naive_utc(batch.get("harvestDate"))
    shelf = int(batch.get("shelfLifeDays") or 0)
    now = datetime.utcnow()
    expires = batch.get("expiresAt")

    if batch.get("status") == BATCH_EXPIRED or harvest is None or shelf <= 0:
        return {"status": "expired" if harvest is not None else "unknown", "daysRemaining": 0, "expiresAt": expires}

    days_old = (now - harvest).days
    remaining = max(0, shelf - days_old)
    if remaining == 0:
        return {"status": "expired", "daysRemaining": 0, "expiresAt": expires}
    if remaining <= 1:
        return {"status": "expiring", "daysRemaining": remaining, "expiresAt": expires}
    return {"status": "fresh", "daysRemaining": remaining, "expiresAt": expires}


def _serialize_batch(batch: dict) -> dict:
    batch["id"] = str(batch["_id"])
    batch["farmerId"] = str(batch.get("farmerId"))
    if batch.get("productId"):
        batch["productId"] = str(batch["productId"])
    if batch.get("sourceHarvestPlanId"):
        batch["sourceHarvestPlanId"] = str(batch["sourceHarvestPlanId"])
    batch["farmerDeclaredGrade"] = batch.get("farmerDeclaredGrade") or batch.get("qualityGrade")
    batch["effectiveGrade"] = effective_grade(batch)
    batch.setdefault("verificationStatus", VERIFICATION_STATUS_DECLARED)
    batch["traceUrl"] = f"/trace/{batch.get('lotNumber', '')}"
    batch["freshness"] = _freshness(batch)
    return batch


async def _next_lot_number() -> str:
    """Build LOT-YYYYMMDD-NNN with a per-day counter."""
    day = datetime.utcnow().strftime("%Y%m%d")
    prefix = f"LOT-{day}-"
    existing = await batch_repo.find_many({"lotNumber": {"$regex": f"^{prefix}"}}, limit=1, sort=[("createdAt", -1)])
    seq = 1
    if existing:
        try:
            seq = int(str(existing[0].get("lotNumber", "")).split("-")[-1]) + 1
        except Exception:
            seq = 1
    return f"{prefix}{seq:03d}"


async def _farmer_context(farmer_id: str) -> dict:
    user = await user_repository.get_by_id(farmer_id)
    farm = None
    try:
        farm = await farmer_repository.find_one({"userId": ObjectId(farmer_id)})
    except Exception:
        farm = None
    name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() if user else ""
    farm = farm or {}
    return {
        "farmerName": name or "Farmer",
        "farmName": farm.get("farmName"),
        "village": farm.get("village"),
        "city": farm.get("city"),
        "district": farm.get("district"),
        "state": farm.get("state"),
        "pincode": farm.get("pincode"),
    }


@router.post("", status_code=201)
@router.post("/", status_code=201, include_in_schema=False)
async def create_batch(data: BatchCreate, current_user: dict = Depends(get_current_user)):
    """Create a new harvest batch / lot (farmer)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can create batches")

    storage = data.storageType if data.storageType in STORAGE_TYPES else "normal"
    shelf = data.shelfLifeDays or DEFAULT_SHELF_LIFE_DAYS.get(storage, 3)
    harvest = _to_naive_utc(data.harvestDate) or datetime.utcnow()
    lot_number = await _next_lot_number()

    batch = {
        "farmerId": ObjectId(current_user["_id"]),
        "lotNumber": lot_number,
        "cropName": data.cropName.strip(),
        "quantityKg": float(data.quantityKg),
        "remainingKg": float(data.quantityKg),
        "harvestDate": harvest,
        "qualityGrade": data.qualityGrade,
        "storageType": storage,
        "shelfLifeDays": shelf,
        "expiresAt": harvest + timedelta(days=shelf),
        "productId": ObjectId(data.productId) if data.productId else None,
        "sourceHarvestPlanId": ObjectId(data.sourceHarvestPlanId) if data.sourceHarvestPlanId else None,
        "notes": data.notes,
        "status": BATCH_CREATED,
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
        "deletedAt": None,
    }
    # A batch grade is farmer-declared until verified by a non-farmer actor.
    batch.update(base_verification_fields(data.qualityGrade))
    created = await batch_repo.create(batch)
    if not created:
        raise HTTPException(status_code=400, detail="Failed to create batch")

    out = dict(batch)
    out["_id"] = created
    return {"success": True, "data": _serialize_batch(out)}


@router.get("")
@router.get("/", include_in_schema=False)
async def list_batches(current_user: dict = Depends(get_current_user)):
    """List the current farmer's batches with freshness."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers have batches")

    batches = await batch_repo.find_many(
        {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None},
        sort=[("createdAt", -1)],
        limit=200,
    )
    return {"success": True, "data": {"batches": [_serialize_batch(b) for b in batches], "count": len(batches)}}


@router.get("/{batch_id}")
async def get_batch(batch_id: str, current_user: dict = Depends(get_current_user)):
    """Batch detail (owner only)."""
    try:
        oid = ObjectId(batch_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Batch not found")

    batch = await batch_repo.find_one({"_id": oid, "deletedAt": None})
    if not batch or str(batch.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Batch not found")

    return {"success": True, "data": _serialize_batch(batch)}


@router.post("/{batch_id}/convert")
async def convert_batch_to_inventory(
    batch_id: str,
    payload: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Link a batch to an existing product and add its remaining stock."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can convert batches")

    product_id = payload.get("productId") if payload else None
    if not product_id:
        raise HTTPException(status_code=400, detail="productId is required")

    try:
        oid = ObjectId(batch_id)
        pid = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid batch or product id")

    batch = await batch_repo.find_one({"_id": oid, "deletedAt": None})
    if not batch or str(batch.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.get("status") in (BATCH_EXPIRED, BATCH_CANCELLED):
        raise HTTPException(status_code=400, detail="Batch is not convertible")
    if batch.get("remainingKg", 0) <= 0:
        raise HTTPException(status_code=400, detail="Batch has no remaining stock")

    product = await product_repository.get_by_id(product_id)
    if not product or str(product.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Product not found")

    qty_kg = float(batch.get("remainingKg") or 0)
    current_qty = int(product.get("quantity") or 0)
    updated = await product_repository.update_product(
        product_id, {"quantity": current_qty + int(qty_kg), "updatedAt": datetime.utcnow()}
    )
    if not updated:
        raise HTTPException(status_code=400, detail="Failed to update product stock")

    await batch_repo.update(
        {"_id": oid},
        {
            "productId": pid,
            "status": BATCH_LISTED,
            "remainingKg": 0.0,
            "convertedAt": datetime.utcnow(),
        },
    )

    refreshed = await batch_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize_batch(refreshed)}


@router.get("/trace/{lot_number}", include_in_schema=True)
async def trace_batch(lot_number: str):
    """Public traceability endpoint by lot number."""
    batch = await batch_repo.find_one({"lotNumber": lot_number.upper().strip(), "deletedAt": None})
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")

    farmer_id = str(batch.get("farmerId"))
    context = await _farmer_context(farmer_id)

    result = {
        "lotNumber": batch.get("lotNumber"),
        "cropName": batch.get("cropName"),
        "quantityKg": batch.get("quantityKg"),
        "harvestDate": batch.get("harvestDate"),
        "qualityGrade": effective_grade(batch),
        "farmerDeclaredGrade": batch.get("farmerDeclaredGrade") or batch.get("qualityGrade"),
        "effectiveGrade": effective_grade(batch),
        "verificationStatus": batch.get("verificationStatus") or VERIFICATION_STATUS_DECLARED,
        "verifiedGrade": batch.get("verifiedGrade"),
        "verificationMethod": batch.get("verificationMethod"),
        "verifiedAt": batch.get("verifiedAt"),
        "storageType": batch.get("storageType"),
        "shelfLifeDays": batch.get("shelfLifeDays"),
        "expiresAt": batch.get("expiresAt"),
        "listed": batch.get("status") == BATCH_LISTED,
        "freshness": _freshness(batch),
        "traceUrl": f"/trace/{batch.get('lotNumber', '')}",
        "farmer": context,
    }
    if batch.get("productId"):
        product = await product_repository.get_by_id(str(batch["productId"]))
        if product:
            result["product"] = {
                "id": str(product["_id"]),
                "name": product.get("name"),
                "price": product.get("price"),
                "unit": product.get("unit"),
            }
    return {"success": True, "data": result}