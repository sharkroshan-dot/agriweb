"""Quality inspection records for farmer harvest lots.

Farmers record a declared grade, size, freshness %, damaged %, verified weight
and photo proof against a harvest lot (batch). A farmer's declared grade is
never trusted as-is: a non-farmer actor (admin, warehouse QC or an independent
inspector) must verify it before it becomes the customer-visible grade.

Verification propagates automatically: inspection -> batch -> product.

Collections:
  - quality_inspections: one inspection per lot / inspection event
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.product_repository import product_repository
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


class InspectionVerify(BaseModel):
    verifiedGrade: str
    method: str = VERIFICATION_METHOD_MANUAL
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
            }},
        )


def _require_verifier(current_user: dict) -> None:
    role = current_user.get("role")
    if role not in VERIFIER_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Only admins or warehouse managers can verify quality inspections",
        )


@router.post("/inspections", status_code=201)
@router.post("/inspections/", status_code=201, include_in_schema=False)
async def create_inspection(
    data: InspectionCreate,
    current_user: dict = Depends(get_current_user),
):
    """Record a quality inspection for a harvest lot (farmer)."""
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can record inspections")

    grade = (data.grade or "A").strip().upper()
    if grade not in VALID_GRADES:
        raise HTTPException(status_code=422, detail="Grade must be A, B or C")
    if not data.lotNumber.strip() or not data.cropName.strip():
        raise HTTPException(status_code=422, detail="lotNumber and cropName are required")

    batch_id = None
    if data.batchId:
        try:
            batch_oid = ObjectId(data.batchId)
        except Exception:
            batch_oid = None
        if batch_oid:
            batch = await batch_repo.find_one({"_id": batch_oid, "deletedAt": None})
            if not batch or str(batch.get("farmerId")) != str(current_user["_id"]):
                raise HTTPException(status_code=404, detail="Batch not found")
            batch_id = batch_oid

    inspection = {
        "farmerId": ObjectId(current_user["_id"]),
        "batchId": batch_id,
        "lotNumber": data.lotNumber.strip(),
        "cropName": data.cropName.strip(),
        "grade": grade,
        "farmerDeclaredGrade": grade,
        "size": data.size,
        "freshness": float(data.freshness),
        "damagedPct": float(data.damagedPct),
        "weightKg": float(data.weightKg),
        "inspectorNotes": data.inspectorNotes,
        "photos": data.photos or [],
        "status": _inspection_status(grade, float(data.damagedPct)),
        "verificationStatus": (
            VERIFICATION_STATUS_EVIDENCE if (data.photos or data.inspectorNotes)
            else VERIFICATION_STATUS_DECLARED
        ),
        "verifiedGrade": None,
        "verificationMethod": None,
        "verifiedBy": None,
        "verifiedAt": None,
        "verificationNotes": None,
        "inspectedAt": datetime.utcnow(),
        "deletedAt": None,
    }
    created = await inspection_repo.create(inspection)
    if not created:
        raise HTTPException(status_code=400, detail="Failed to save inspection")

    out = dict(inspection)
    out["_id"] = ObjectId(created)
    return {"success": True, "data": _serialize_inspection(out)}


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
async def verify_inspection(
    inspection_id: str,
    data: InspectionVerify,
    current_user: dict = Depends(get_current_user),
):
    """Verify (or re-verify) an inspection's grade. Admin / warehouse only.

    The declared grade never verifies itself: the verified grade is the one a
    customer will see as "Verified Grade X".
    """
    _require_verifier(current_user)

    grade = (data.verifiedGrade or "").strip().upper()
    if grade not in VALID_GRADES:
        raise HTTPException(status_code=422, detail="verifiedGrade must be A, B or C")
    method = data.method or VERIFICATION_METHOD_MANUAL
    if method not in VERIFICATION_METHODS:
        raise HTTPException(status_code=422, detail=f"Invalid verification method: {method}")

    try:
        oid = ObjectId(inspection_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inspection not found")

    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec:
        raise HTTPException(status_code=404, detail="Inspection not found")

    declared = rec.get("farmerDeclaredGrade") or rec.get("grade")
    # Buyer acceptance is a distinct trust level: the buyer accepted the
    # quality, so it is "buyer verified" rather than platform verified.
    new_status = VERIFICATION_STATUS_BUYER if method == VERIFICATION_METHOD_BUYER else VERIFICATION_STATUS_VERIFIED
    await inspection_repo.update(
        {"_id": oid},
        {
            "verifiedGrade": grade,
            "verificationStatus": new_status,
            "verificationMethod": method,
            "verifiedBy": ObjectId(current_user["_id"]),
            "verifiedAt": datetime.utcnow(),
            "verificationNotes": data.notes,
            "grade": grade,
        },
    )
    refreshed = await inspection_repo.find_one({"_id": oid})
    await _propagate_verification(refreshed)

    matched = declared is not None and declared.upper() == grade
    return {
        "success": True,
        "data": _serialize_inspection(refreshed),
        "message": "Inspection verified" if matched else "Verified grade differs from farmer's declared grade",
    }


@router.post("/inspections/{inspection_id}/reject")
async def reject_inspection(
    inspection_id: str,
    body: dict = None,
    current_user: dict = Depends(get_current_user),
):
    """Reject a declared grade / inspection (admin or warehouse only)."""
    _require_verifier(current_user)

    try:
        oid = ObjectId(inspection_id)
    except Exception:
        raise HTTPException(status_code=404, detail="Inspection not found")

    rec = await inspection_repo.find_one({"_id": oid, "deletedAt": None})
    if not rec:
        raise HTTPException(status_code=404, detail="Inspection not found")

    reason = (body or {}).get("reason") if isinstance(body, dict) else None
    await inspection_repo.update(
        {"_id": oid},
        {
            "verificationStatus": VERIFICATION_STATUS_REJECTED,
            "verificationNotes": reason or rec.get("verificationNotes"),
            "verifiedBy": ObjectId(current_user["_id"]),
            "verifiedAt": datetime.utcnow(),
        },
    )
    refreshed = await inspection_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize_inspection(refreshed)}


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