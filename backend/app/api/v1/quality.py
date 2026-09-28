"""Quality inspection records for farmer harvest lots.

Farmers record a declared grade, size, freshness %, damaged %, verified weight
and photo proof against a harvest lot (batch). A farmer's declared grade is
never trusted as-is: a non-farmer actor (admin, warehouse QC or an independent
inspector) must verify it before it becomes the customer-visible grade.

Verification propagates automatically: inspection -> batch -> product.

Collections:
  - quality_inspections: one inspection per lot / inspection event
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.product_repository import product_repository
from app.repositories.base_repository import BaseRepository
harvest_preorder_repository = BaseRepository("harvest_preorders")
from app.services.quality_ai import assess_quality
from app.core.quality import (
    VERIFICATION_STATUS_DECLARED,
    VERIFICATION_STATUS_EVIDENCE,
    VERIFICATION_STATUS_VERIFIED,
    VERIFICATION_STATUS_BUYER,
    VERIFICATION_STATUS_REJECTED,
    VERIFICATION_METHOD_MANUAL,
    VERIFICATION_METHOD_WAREHOUSE_QC,
    VERIFICATION_METHOD_BUYER,
    VERIFICATION_METHOD_AI,
    VERIFICATION_STATUSES,
    VERIFICATION_METHODS,
    base_verification_fields,
    effective_grade,
)

logger = logging.getLogger(__name__)
router = APIRouter()

inspection_repo = BaseRepository("quality_inspections")
batch_repo = BaseRepository("batches")

VALID_GRADES = ("A", "B", "C")

STATUS_PASSED = "passed"
STATUS_REVIEW = "review"
STATUS_FAILED = "failed"

# Roles allowed to verify an inspection (never the declaring farmer).
VERIFIER_ROLES = ("admin", "warehouse")

INSPECTION_SLA_HOURS = {"normal": 6, "refrigerated": 8, "cold_storage": 12, "frozen": 24}

def _inspection_priority(expires_at: Optional[datetime], urgent: bool = False) -> str:
    if urgent:
        return "critical"
    if not expires_at:
        return "normal"
    hours_left = (expires_at - datetime.utcnow()).total_seconds() / 3600
    if hours_left <= 24:
        return "critical"
    if hours_left <= 48:
        return "urgent"
    return "normal"


class InspectionCreate(BaseModel):
    lotNumber: str
    cropName: str
    grade: str = "A"
    size: Optional[str] = None
    freshness: float = Field(0, ge=0, le=100)
    damagedPct: float = Field(0, ge=0, le=100)
    weightKg: float = Field(gt=0)
    inspectorNotes: Optional[str] = None
    photos: List[str] = []
    batchId: Optional[str] = None


class InspectionRequest(BaseModel):
    batchId: str
    urgent: bool = False


class InspectionVerify(BaseModel):
    verifiedGrade: str
    method: str = VERIFICATION_METHOD_WAREHOUSE_QC
    notes: Optional[str] = None
    freshness: Optional[float] = Field(None, ge=0, le=100)
    damagedPct: Optional[float] = Field(None, ge=0, le=100)
    weightKg: Optional[float] = Field(None, gt=0)
    photos: List[str] = []


class InspectionReject(BaseModel):
    reason: str


class InspectionClaim(BaseModel):
    notes: Optional[str] = None


class InspectionEvidence(BaseModel):
    photos: List[str] = []
    notes: Optional[str] = None


def _inspection_status(grade: str, damaged_pct: float) -> str:
    """Derive a simple pass/review/failed disposition from damage %."""
    if damaged_pct > 10:
        return STATUS_FAILED
    if damaged_pct > 3:
        return STATUS_REVIEW
    return STATUS_PASSED


def _grade_value(grade: str) -> int:
    return {"A": 3, "B": 2, "C": 1}.get(grade, 0)


def _serialize_inspection(rec: dict) -> dict:
    rec["id"] = str(rec["_id"])
    rec["farmerId"] = str(rec.get("farmerId"))
    if rec.get("batchId"):
        rec["batchId"] = str(rec["batchId"])
    # grade = the currently effective grade (verified once set, else declared)
    rec["grade"] = effective_grade(rec)
    rec["effectiveGrade"] = rec["grade"]
    rec["farmerDeclaredGrade"] = rec.get("farmerDeclaredGrade") or rec.get("grade")
    rec.setdefault("verificationStatus", VERIFICATION_STATUS_DECLARED)
    return rec


async def _propagate_verification(inspection: dict) -> None:
    """Push verified grade to the linked batch and (via batch) its product."""
    if not inspection.get("verifiedGrade"):
        return
    batch_id = inspection.get("batchId")
    if not batch_id:
        return
    batch = await batch_repo.find_one({"_id": batch_id, "deletedAt": None})
    if not batch:
        return
    await batch_repo.update(
        {"_id": batch_id},
        {
            "qualityGrade": inspection["verifiedGrade"],
            "farmerDeclaredGrade": inspection.get("farmerDeclaredGrade"),
            "verifiedGrade": inspection["verifiedGrade"],
            "verificationStatus": inspection.get("verificationStatus", VERIFICATION_STATUS_VERIFIED),
            "verificationMethod": inspection.get("verificationMethod"),
            "verifiedBy": inspection.get("verifiedBy"),
            "verifiedAt": inspection.get("verifiedAt"),
            "verificationNotes": inspection.get("verificationNotes"),
        },
    )
    product_id = batch.get("productId")
    if product_id:
        await product_repository.collection.update_one(
            {"_id": product_id, "deletedAt": None},
            {"$set": {
                "qualityGrade": inspection["verifiedGrade"],
                "farmerDeclaredGrade": inspection.get("farmerDeclaredGrade"),
                "verifiedGrade": inspection["verifiedGrade"],
                "verificationStatus": inspection.get("verificationStatus", VERIFICATION_STATUS_VERIFIED),
                "verificationMethod": inspection.get("verificationMethod"),
                "verifiedBy": inspection.get("verifiedBy"),
                "verifiedAt": inspection.get("verifiedAt"),
                "verificationNotes": inspection.get("verificationNotes"),
                "qualityStatus": "approved",
                "isActive": True,
            }},
        )

    # Quality approval is the gate that turns a harvested pre-order
    # reservation into a customer action: confirm purchase + pay.
    if product_id:
        preorders = await harvest_preorder_repository.find_many({
            "harvestPlanId": batch.get("sourceHarvestPlanId"),
            "status": {"$in": ["confirmed"]},
            "deletedAt": None,
        }, limit=1000) if batch.get("sourceHarvestPlanId") else []
        for po in preorders or []:
            try:
                now = datetime.utcnow()
                await harvest_preorder_repository.update(
                    {"_id": po["_id"]},
                    {
                        "status": "ready_for_confirmation",
                        "qualityApprovedAt": now,
                        "updatedAt": now,
                    },
                )
                await NotificationService.create_in_app_notification(
                    str(po.get("customerId")),
                    NotificationType.ORDER,
                    "Your pre-order is ready to confirm 🎉",
                    f"{po.get('cropName', 'Harvest')} passed quality inspection. Your {float(po.get('quantityKg', 0) or 0):g} kg pre-order is ready for checkout at the agreed pre-order price of ₹{float(po.get('unitPricePerKg', 0) or 0):g}/kg.",
                    {
                        "harvestPlanId": str(batch.get("sourceHarvestPlanId")),
                        "preorderId": str(po["_id"]),
                        "productId": str(product_id),
                        "type": "preorder_ready_for_confirmation",
                        "action": "confirm_preorder",
                    },
                    NotificationPriority.HIGH,
                )
            except Exception:
                logger.exception("Failed to advance pre-order %s after quality approval", po.get("_id"))


def _require_verifier(current_user: dict) -> None:
    role = current_user.get("role")
    if role not in VERIFIER_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only admins or warehouse managers can verify quality inspections",
        )


@router.post("/inspections/request", status_code=201)
async def request_inspection(data: InspectionRequest, current_user: dict = Depends(get_current_user)):
    """Farmer requests an independent physical inspection for a harvested batch."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can request inspection")
    try:
        batch_id = ObjectId(data.batchId)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid batch id")
    batch = await batch_repo.find_one({"_id": batch_id, "farmerId": ObjectId(current_user["_id"]), "deletedAt": None})
    if not batch: raise HTTPException(status_code=404, detail="Batch not found")
    now = datetime.utcnow()
    priority = _inspection_priority(batch.get("expiresAt"), data.urgent)
    due_at = now + timedelta(hours=2 if priority == "critical" else INSPECTION_SLA_HOURS.get(batch.get("storageType"), 6))
    existing = await inspection_repo.find_one({"batchId": batch_id, "deletedAt": None})
    payload = {"farmerId": ObjectId(current_user["_id"]), "batchId": batch_id, "lotNumber": batch.get("lotNumber"), "cropName": batch.get("cropName"),
        "farmerDeclaredGrade": batch.get("farmerDeclaredGrade"), "grade": None, "status": "pending", "inspectionStatus": "pending",
        "verificationStatus": VERIFICATION_STATUS_DECLARED, "verifiedGrade": None, "verificationMethod": None, "verifiedBy": None, "verifiedAt": None,
        "verificationNotes": None, "photos": [], "requestedAt": now, "inspectionDueAt": due_at, "priority": priority, "urgentRequested": bool(data.urgent),
        "assignedTo": existing.get("assignedTo") if existing else None, "assignedAt": existing.get("assignedAt") if existing else None, "deletedAt": None, "updatedAt": now}
    if existing:
        await inspection_repo.update({"_id": existing["_id"]}, payload); inspection_id = existing["_id"]
    else:
        inspection_id = await inspection_repo.create(payload)
        if not inspection_id: raise HTTPException(status_code=400, detail="Failed to request inspection")
    await batch_repo.update({"_id": batch_id}, {"qualityStatus": "pending_inspection", "inspectionId": ObjectId(inspection_id),
        "inspectionRequestedAt": now, "inspectionDueAt": due_at, "inspectionPriority": priority})
    refreshed = await inspection_repo.find_one({"_id": ObjectId(inspection_id)})
    return {"success": True, "data": _serialize_inspection(refreshed)}


@router.get("/inspections/queue")
async def inspection_queue(current_user: dict = Depends(get_current_user)):
    """Priority queue for authorized warehouse/admin inspectors."""
    _require_verifier(current_user)
    records = await inspection_repo.find_many({"deletedAt": None, "inspectionStatus": {"$in": ["pending", "in_progress"]}}, limit=500)
    rank = {"critical": 0, "urgent": 1, "normal": 2}
    queue = []
    for rec in records:
        batch = await batch_repo.find_one({"_id": rec.get("batchId"), "deletedAt": None})
        if not batch: continue
        item = _serialize_inspection(rec)
        item["batch"] = {"id": str(batch["_id"]), "lotNumber": batch.get("lotNumber"), "cropName": batch.get("cropName"), "quantityKg": batch.get("quantityKg"),
            "harvestDate": batch.get("harvestDate"), "storageType": batch.get("storageType"), "expiresAt": batch.get("expiresAt"), "qualityStatus": batch.get("qualityStatus")}
        item["sortPriority"] = rank.get(item.get("priority"), 2); queue.append(item)
    queue.sort(key=lambda x: (x["sortPriority"], x.get("inspectionDueAt") or datetime.max))
    return {"success": True, "data": {"inspections": queue, "count": len(queue)}}


@router.post("/inspections/{inspection_id}/claim")
async def claim_inspection(inspection_id: str, data: InspectionClaim, current_user: dict = Depends(get_current_user)):
    _require_verifier(current_user)
    try: oid = ObjectId(inspection_id)
    except Exception: raise HTTPException(status_code=404, detail="Inspection not found")
    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec: raise HTTPException(status_code=404, detail="Inspection not found")
    now = datetime.utcnow()
    await inspection_repo.update({"_id": oid}, {"inspectionStatus": "in_progress", "assignedTo": ObjectId(current_user["_id"]), "assignedAt": now, "claimNotes": data.notes, "updatedAt": now})
    await batch_repo.update({"_id": rec.get("batchId")}, {"qualityStatus": "inspection_in_progress", "inspectionAssignedTo": ObjectId(current_user["_id"])})
    refreshed = await inspection_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize_inspection(refreshed)}


@router.post("/inspections/{inspection_id}/urgent")
async def mark_inspection_urgent(inspection_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer": raise HTTPException(status_code=403, detail="Only farmers can request urgent inspection")
    try: oid = ObjectId(inspection_id)
    except Exception: raise HTTPException(status_code=404, detail="Inspection not found")
    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec or str(rec.get("farmerId")) != str(current_user["_id"]): raise HTTPException(status_code=404, detail="Inspection not found")
    due_at = datetime.utcnow() + timedelta(hours=2)
    await inspection_repo.update({"_id": oid}, {"priority": "critical", "urgentRequested": True, "inspectionDueAt": due_at, "updatedAt": datetime.utcnow()})
    await batch_repo.update({"_id": rec.get("batchId")}, {"inspectionPriority": "critical", "inspectionDueAt": due_at, "qualityStatus": "pending_inspection"})
    refreshed = await inspection_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize_inspection(refreshed)}


@router.post("/inspections", status_code=201)
@router.post("/inspections/", status_code=201, include_in_schema=False)
async def create_inspection(data: InspectionCreate, current_user: dict = Depends(get_current_user)):
    """Record the independent physical inspection. Farmers cannot call this."""
    _require_verifier(current_user)
    grade = (data.grade or "").strip().upper()
    if grade not in VALID_GRADES: raise HTTPException(status_code=422, detail="Grade must be A, B or C")
    if not data.batchId: raise HTTPException(status_code=422, detail="batchId is required")
    try: batch_id = ObjectId(data.batchId)
    except Exception: raise HTTPException(status_code=400, detail="Invalid batch id")
    batch = await batch_repo.find_one({"_id": batch_id, "deletedAt": None})
    if not batch: raise HTTPException(status_code=404, detail="Batch not found")
    now = datetime.utcnow()
    inspection = {"farmerId": batch.get("farmerId"), "batchId": batch_id, "lotNumber": batch.get("lotNumber") or data.lotNumber.strip(),
        "cropName": batch.get("cropName") or data.cropName.strip(), "farmerDeclaredGrade": batch.get("farmerDeclaredGrade"), "grade": grade, "size": data.size,
        "freshness": float(data.freshness), "damagedPct": float(data.damagedPct), "weightKg": float(data.weightKg), "inspectorNotes": data.inspectorNotes,
        "photos": data.photos or [], "status": _inspection_status(grade, float(data.damagedPct)), "inspectionStatus": "completed", "verificationStatus": VERIFICATION_STATUS_EVIDENCE,
        "verifiedGrade": None, "verificationMethod": None, "verifiedBy": None, "verifiedAt": None, "verificationNotes": None,
        "inspectorId": ObjectId(current_user["_id"]), "inspectedAt": now, "updatedAt": now, "deletedAt": None}
    existing = await inspection_repo.find_one({"batchId": batch_id, "deletedAt": None})
    if existing: await inspection_repo.update({"_id": existing["_id"]}, inspection); inspection["_id"] = existing["_id"]
    else:
        created = await inspection_repo.create(inspection)
        if not created: raise HTTPException(status_code=400, detail="Failed to save inspection")
        inspection["_id"] = ObjectId(created)
    await batch_repo.update({"_id": batch_id}, {"qualityStatus": "inspection_completed", "inspectionId": inspection["_id"], "inspectionCompletedAt": now, "inspectionInspectorId": ObjectId(current_user["_id"])})
    return {"success": True, "data": _serialize_inspection(inspection)}


@router.post("/inspections/{inspection_id}/evidence")
async def submit_inspection_evidence(
    inspection_id: str,
    data: InspectionEvidence,
    current_user: dict = Depends(get_current_user),
):
    """Farmer attaches photos/notes as evidence; moves status to evidence_submitted."""
    try:
        oid = ObjectId(inspection_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inspection not found")

    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec or str(rec.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Inspection not found")

    await inspection_repo.update(
        {"_id": oid},
        {
            "photos": data.photos or rec.get("photos") or [],
            "inspectorNotes": data.notes or rec.get("inspectorNotes"),
            "verificationStatus": VERIFICATION_STATUS_EVIDENCE,
        },
    )
    refreshed = await inspection_repo.find_one({"_id": oid})
    # Re-run AI screening on the fresh evidence.
    assessment = assess_quality(refreshed)
    assessment["assessedAt"] = datetime.utcnow()
    await inspection_repo.update(
        {"_id": oid},
        {"aiAssessment": assessment, "aiAssessedAt": assessment["assessedAt"]},
    )
    refreshed = await inspection_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize_inspection(refreshed)}


@router.post("/inspections/{inspection_id}/verify")
async def verify_inspection(inspection_id: str, data: InspectionVerify, current_user: dict = Depends(get_current_user)):
    """Finalize an independent inspection and approve the batch."""
    _require_verifier(current_user)
    grade = (data.verifiedGrade or "").strip().upper()
    if grade not in VALID_GRADES: raise HTTPException(status_code=422, detail="verifiedGrade must be A, B or C")
    try: oid = ObjectId(inspection_id)
    except Exception: raise HTTPException(status_code=404, detail="Inspection not found")
    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec: raise HTTPException(status_code=404, detail="Inspection not found")
    now = datetime.utcnow()
    update = {"verifiedGrade": grade, "verificationStatus": VERIFICATION_STATUS_VERIFIED, "verificationMethod": data.method or VERIFICATION_METHOD_WAREHOUSE_QC,
        "verifiedBy": ObjectId(current_user["_id"]), "verifiedAt": now, "verificationNotes": data.notes, "inspectionStatus": "approved", "grade": grade, "updatedAt": now}
    if data.freshness is not None: update["freshness"] = float(data.freshness)
    if data.damagedPct is not None: update["damagedPct"] = float(data.damagedPct)
    if data.weightKg is not None: update["weightKg"] = float(data.weightKg)
    if data.photos: update["photos"] = data.photos
    await inspection_repo.update({"_id": oid}, update)
    refreshed = await inspection_repo.find_one({"_id": oid}); await _propagate_verification(refreshed)
    if refreshed.get("batchId"):
        await batch_repo.update({"_id": refreshed["batchId"]}, {"qualityStatus": "approved", "verificationStatus": VERIFICATION_STATUS_VERIFIED,
            "qualityGrade": grade, "verifiedGrade": grade, "verifiedBy": ObjectId(current_user["_id"]), "verifiedAt": now, "inspectionCompletedAt": now, "updatedAt": now})
    return {"success": True, "data": _serialize_inspection(refreshed), "message": "Quality inspection approved"}


@router.post("/inspections/{inspection_id}/reject")
async def reject_inspection(inspection_id: str, data: InspectionReject, current_user: dict = Depends(get_current_user)):
    """Reject a batch after independent inspection."""
    _require_verifier(current_user)
    try: oid = ObjectId(inspection_id)
    except Exception: raise HTTPException(status_code=404, detail="Inspection not found")
    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec: raise HTTPException(status_code=404, detail="Inspection not found")
    now = datetime.utcnow()
    await inspection_repo.update({"_id": oid}, {"verificationStatus": VERIFICATION_STATUS_REJECTED, "verificationNotes": data.reason,
        "verifiedBy": ObjectId(current_user["_id"]), "verifiedAt": now, "inspectionStatus": "rejected", "status": STATUS_FAILED, "updatedAt": now})
    if rec.get("batchId"):
        await batch_repo.update({"_id": rec["batchId"]}, {"qualityStatus": "rejected", "verificationStatus": VERIFICATION_STATUS_REJECTED,
            "verificationNotes": data.reason, "verifiedBy": ObjectId(current_user["_id"]), "verifiedAt": now, "updatedAt": now})
    refreshed = await inspection_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize_inspection(refreshed), "message": "Batch rejected after quality inspection"}


@router.post("/inspections/{inspection_id}/ai-assess")
async def ai_assess_inspection(
    inspection_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Run AI quality screening on the evidence.

    Returns an ESTIMATED grade + confidence. It never verifies a lot: a
    mismatch with the declared grade routes the lot to manual inspection.
    Owner farmer or any verifier may trigger it.
    """
    try:
        oid = ObjectId(inspection_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inspection not found")

    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if current_user.get("role") == "farmer" and str(rec.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Inspection not found")

    assessment = assess_quality(rec)
    assessment["assessedAt"] = datetime.utcnow()
    update: dict = {
        "aiAssessment": assessment,
        "aiAssessedAt": assessment["assessedAt"],
    }
    if rec.get("verificationStatus") == VERIFICATION_STATUS_DECLARED and assessment.get("mismatch"):
        # Suspicious claim: keep it unverified and route to manual inspection.
        update["verificationStatus"] = VERIFICATION_STATUS_EVIDENCE

    await inspection_repo.update({"_id": oid}, update)
    refreshed = await inspection_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize_inspection(refreshed)}


@router.get("/trust/me")
async def my_quality_trust(current_user: dict = Depends(get_current_user)):
    """Farmer quality reliability score based on explainable evidence.

    Score 0-100 from: verified-inspection grade accuracy, number of verified
    inspections, quality complaints on the farmer's products and poor-quality
    refunds. Never AI-only: every metric is traceable to a record.
    """
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers have a quality trust score")

    farmer_id = ObjectId(current_user["_id"])
    inspections = await inspection_repo.find_many(
        {"farmerId": farmer_id, "deletedAt": None, "verificationStatus": VERIFICATION_STATUS_VERIFIED},
        limit=500,
    )

    matches = 0
    mismatches = 0
    for insp in inspections:
        declared = (insp.get("farmerDeclaredGrade") or insp.get("grade") or "").strip().upper()
        verified = (insp.get("verifiedGrade") or "").strip().upper()
        if declared and verified:
            if declared == verified:
                matches += 1
            else:
                mismatches += 1

    verified_total = matches + mismatches
    accuracy = round((matches / verified_total * 100), 1) if verified_total else None

    # Quality complaints on the farmer's products.
    product_ids = []
    try:
        cursor = product_repository.collection.find(
            {"farmerId": farmer_id, "deletedAt": None},
            {"_id": 1},
        )
        product_ids = [p["_id"] for p in await cursor.to_list(length=10000)]
    except Exception as e:
        logger.warning(f"trust: product lookup failed: {e}")

    complaint_count = 0
    try:
        complaint_repo = BaseRepository("complaints")
        complaint_count = await complaint_repo.count({
            "type": {"$in": ["product", "product_quality", "poor_quality"]},
            "productId": {"$in": product_ids},
            "deletedAt": None,
        }) if product_ids else 0
    except Exception as e:
        logger.warning(f"trust: complaint lookup failed: {e}")

    refund_count = 0
    try:
        refund_repo = BaseRepository("refunds")
        refund_count = await refund_repo.count({
            "type": {"$in": ["poor_quality", "quality"]},
            "productId": {"$in": product_ids},
            "deletedAt": None,
        }) if product_ids else 0
    except Exception as e:
        logger.warning(f"trust: refund lookup failed: {e}")

    score = 100.0
    score -= min(40.0, mismatches * 12.0)
    score -= min(25.0, (complaint_count + refund_count) * 5.0)
    if verified_total >= 3 and accuracy is not None and accuracy >= 90:
        score += 5.0
    score = round(max(0.0, min(100.0, score)), 1)

    if score >= 85:
        status = "good"
    elif score >= 70:
        status = "watch"
    else:
        status = "restricted"

    return {
        "success": True,
        "data": {
            "score": score,
            "status": status,
            "verifiedCount": verified_total,
            "declaredCount": len(inspections),
            "gradeAccuracy": accuracy,
            "gradeMismatches": mismatches,
            "qualityComplaints": complaint_count,
            "poorQualityRefunds": refund_count,
        },
    }


@router.get("/inspections/me")
async def list_my_inspections(current_user: dict = Depends(get_current_user)):
    """List the current farmer's inspections, newest first."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers have inspections")

    inspections = await inspection_repo.find_many(
        {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None},
        sort=[("inspectedAt", -1)],
        limit=200,
    )
    return {
        "success": True,
        "data": {
            "inspections": [_serialize_inspection(r) for r in inspections],
            "count": len(inspections),
        },
    }


@router.get("/inspections")
@router.get("/inspections/", include_in_schema=False)
async def list_inspections(current_user: dict = Depends(get_current_user)):
    """List inspections the current user may see.

    Farmers see their own; verifiers (admin/warehouse) see all pending ones.
    """
    if current_user.get("role") == "farmer":
        inspections = await inspection_repo.find_many(
            {"farmerId": ObjectId(current_user["_id"]), "deletedAt": None},
            sort=[("inspectedAt", -1)],
            limit=200,
        )
    else:
        inspections = await inspection_repo.find_many(
            {"deletedAt": None},
            sort=[("inspectedAt", -1)],
            limit=500,
        )
    return {
        "success": True,
        "data": {
            "inspections": [_serialize_inspection(r) for r in inspections],
            "count": len(inspections),
        },
    }


@router.get("/inspections/{inspection_id}")
async def get_inspection(
    inspection_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Inspection detail (owner or verifier only)."""
    try:
        oid = ObjectId(inspection_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inspection not found")

    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if current_user.get("role") == "farmer" and str(rec.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Inspection not found")

    return {"success": True, "data": _serialize_inspection(rec)}


@router.delete("/inspections/{inspection_id}")
async def delete_inspection(
    inspection_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Soft delete an inspection (owner only)."""
    try:
        oid = ObjectId(inspection_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inspection not found")

    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec or str(rec.get("farmerId")) != str(current_user["_id"]):
        raise HTTPException(status_code=404, detail="Inspection not found")

    await inspection_repo.delete({"_id": oid})
    return {"success": True, "message": "Inspection deleted"}