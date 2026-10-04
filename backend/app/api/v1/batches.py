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
harvest_plan_repo = BaseRepository("harvest_plans")
quality_inspection_repo = BaseRepository("quality_inspections")

STORAGE_TYPES = ["normal", "refrigerated", "cold_storage", "frozen"]
DEFAULT_SHELF_LIFE_DAYS = {"normal": 3, "refrigerated": 5, "cold_storage": 7, "frozen": 30}

BATCH_CREATED = "created"
BATCH_LISTED = "listed"
BATCH_EXPIRED = "expired"
BATCH_CANCELLED = "cancelled"


class BatchCreate(BaseModel):
    cropName: str
    masterCropId: Optional[str] = None
    farmerCropId: Optional[str] = None
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

    product_id = None
    product = None
    if data.productId:
        try:
            product_id = ObjectId(data.productId)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid product id")
        product = await product_repository.get_by_id(data.productId)
        if not product or str(product.get("farmerId")) != str(current_user["_id"]):
            raise HTTPException(status_code=404, detail="Product not found")
        existing_product_batch = await batch_repo.find_one({
            "productId": product_id,
            "deletedAt": None,
            "status": {"$ne": BATCH_CANCELLED},
        })
        if existing_product_batch:
            raise HTTPException(
                status_code=409,
                detail=f"Product already has batch {existing_product_batch.get('lotNumber')}. One product can have only one batch.",
            )

    if not data.sourceHarvestPlanId:
        # Product-created harvest links are authoritative when present.
        linked_plan_id = product.get("sourceHarvestPlanId")
        if linked_plan_id:
            data.sourceHarvestPlanId = str(linked_plan_id)
        else:
            raise HTTPException(
                status_code=400,
                detail="This product is not linked to a harvested crop. Create/complete its harvest first.",
            )

    if not data.sourceHarvestPlanId:
        raise HTTPException(
            status_code=400,
            detail="A batch must be created from a harvested crop. Mark the harvest first.",
        )
    try:
        harvest_plan_id = ObjectId(data.sourceHarvestPlanId)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid source harvest plan")

    harvest_plan = await harvest_plan_repo.find_one({
        "_id": harvest_plan_id,
        "farmerId": ObjectId(current_user["_id"]),
        "deletedAt": None,
    })
    if not harvest_plan:
        raise HTTPException(status_code=404, detail="Source harvest plan not found")
    if harvest_plan.get("status") != "harvested":
        raise HTTPException(status_code=400, detail="Only harvested crops can be converted into a batch")

    existing_batch = await batch_repo.find_one({
        "sourceHarvestPlanId": harvest_plan_id,
        "deletedAt": None,
        "status": {"$ne": BATCH_CANCELLED},
    })
    if existing_batch:
        raise HTTPException(
            status_code=409,
            detail=f"This harvest already has batch {existing_batch.get('lotNumber')}. One harvest event can create only one batch.",
        )

    master_crop = None
    if harvest_plan.get("masterCropId"):
        master_crop = await BaseRepository("master_crops").find_one({"_id": harvest_plan["masterCropId"], "deletedAt": None})
    if not master_crop and data.masterCropId:
        try: master_crop = await BaseRepository("master_crops").find_one({"_id": ObjectId(data.masterCropId), "deletedAt": None})
        except Exception: master_crop = None
    if not master_crop:
        raise HTTPException(status_code=400, detail="A harvest batch requires a valid master crop")
    actual_qty = float(harvest_plan.get("actualQuantityKg") or 0)
    if actual_qty <= 0:
        raise HTTPException(status_code=400, detail="Actual harvested quantity is missing from the harvest record")
    if abs(float(data.quantityKg) - actual_qty) > 0.001:
        raise HTTPException(status_code=400, detail=f"Batch quantity must match the actual harvested quantity ({actual_qty:g} kg)")

    storage = data.storageType if data.storageType in STORAGE_TYPES else "normal"
    shelf = effective_shelf_life_days(master_crop, storage, data.shelfLifeDays)
    harvest = _to_naive_utc(harvest_plan.get("harvestedAt")) or datetime.utcnow()
    lot_number = await _next_lot_number()

    batch = {
        "farmerId": ObjectId(current_user["_id"]),
        "lotNumber": lot_number,
        "cropName": harvest_plan.get("cropName"),
        "masterCropId": harvest_plan.get("masterCropId") or (master_crop or {}).get("_id"),
        "masterCropName": harvest_plan.get("masterCropName") or (master_crop or {}).get("name"),
        "quantityKg": actual_qty,
        "remainingKg": actual_qty,
        "harvestDate": harvest,
        "qualityGrade": data.qualityGrade,
        "storageType": storage,
        "shelfLifeDays": shelf,
        "expiresAt": expiry_date(harvest, shelf),
        "safeDeliveryBufferHours": int(harvest_plan.get("safeDeliveryBufferHours") or (master_crop or {}).get("safeDeliveryBufferHours") or 24),
        "safeDeliveryDate": safe_delivery_date(harvest, shelf, int(harvest_plan.get("safeDeliveryBufferHours") or (master_crop or {}).get("safeDeliveryBufferHours") or 24)),
        "productId": product_id,
        "sourceHarvestPlanId": harvest_plan_id,
        "qualityStatus": "pending_inspection",
        "verificationStatus": VERIFICATION_STATUS_DECLARED,
        "notes": data.notes,
        "status": BATCH_CREATED,
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
        "deletedAt": None,
    }
    # A farmer declaration is never an approval. The batch remains unavailable
    # to marketplace inventory until an authorized quality inspector approves it.
    batch.update(base_verification_fields(data.qualityGrade))
    batch["qualityStatus"] = "pending_inspection"
    batch["verificationStatus"] = VERIFICATION_STATUS_DECLARED
    created = await batch_repo.create(batch)
    if not created:
        raise HTTPException(status_code=400, detail="Failed to create batch")

    # Every new batch automatically enters the independent quality queue.
    now = datetime.utcnow()
    hours_left = ((harvest + timedelta(days=shelf)) - now).total_seconds() / 3600
    priority = "critical" if hours_left <= 24 else "urgent" if hours_left <= 48 else "normal"
    due_hours = 2 if priority == "critical" else {
        "normal": 6,
        "refrigerated": 8,
        "cold_storage": 12,
        "frozen": 24,
    }.get(storage, 6)
    inspection_id = await quality_inspection_repo.create({
        "farmerId": ObjectId(current_user["_id"]),
        "batchId": created,
        "lotNumber": lot_number,
        "cropName": harvest_plan.get("cropName"),
        "farmerDeclaredGrade": data.qualityGrade,
        "grade": None,
        "status": "pending",
        "inspectionStatus": "pending",
        "verificationStatus": VERIFICATION_STATUS_DECLARED,
        "verifiedGrade": None,
        "verificationMethod": None,
        "verifiedBy": None,
        "verifiedAt": None,
        "verificationNotes": None,
        "photos": [],
        "requestedAt": now,
        "inspectionDueAt": now + timedelta(hours=due_hours),
        "priority": priority,
        "urgentRequested": False,
        "deletedAt": None,
        "updatedAt": now,
    })
    await batch_repo.update(
        {"_id": created},
        {
            "qualityStatus": "pending_inspection",
            "inspectionId": ObjectId(inspection_id) if inspection_id else None,
            "inspectionRequestedAt": now,
            "inspectionDueAt": now + timedelta(hours=due_hours),
            "inspectionPriority": priority,
        },
    )

    # Creating the batch is the explicit transition from Harvested -> Batched.
    await harvest_plan_repo.update(
        {"_id": harvest_plan_id},
        {"stage": "batched", "updatedAt": datetime.utcnow()},
    )

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
    if batch.get("qualityStatus") != "approved":
        raise HTTPException(status_code=400, detail="Batch must pass independent quality inspection before it can be listed")
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
        product_id,
        {
            "quantity": current_qty + int(qty_kg),
            "isActive": True,
            "qualityStatus": "approved",
            "verificationStatus": "verified",
            "verifiedGrade": batch.get("verifiedGrade"),
            "qualityGrade": batch.get("verifiedGrade"),
            "farmerDeclaredGrade": batch.get("farmerDeclaredGrade"),
            "verifiedAt": batch.get("verifiedAt"),
            "updatedAt": datetime.utcnow(),
        },
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
        "qualityGrade": batch.get("verifiedGrade") if batch.get("verificationStatus") == "verified" else None,
        "farmerDeclaredGrade": batch.get("farmerDeclaredGrade") or batch.get("qualityGrade"),
        "effectiveGrade": batch.get("verifiedGrade") if batch.get("verificationStatus") == "verified" else None,
        "verificationStatus": batch.get("verificationStatus") or VERIFICATION_STATUS_DECLARED,
        "verifiedGrade": batch.get("verifiedGrade"),
        "verificationMethod": batch.get("verificationMethod"),
        "verifiedAt": batch.get("verifiedAt"),
        "storageType": batch.get("storageType"),
        "shelfLifeDays": batch.get("shelfLifeDays"),
        "expiresAt": batch.get("expiresAt"),
        "safeDeliveryDate": batch.get("safeDeliveryDate"),
        "masterCropId": str(batch.get("masterCropId")) if batch.get("masterCropId") else None,
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