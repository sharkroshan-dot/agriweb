from fastapi import APIRouter, HTTPException, Depends, Query, Body, UploadFile, File
from typing import Optional
from datetime import datetime
from bson import ObjectId
import logging
import os
import uuid

from app.core.config import settings

from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.core.security import require_role
from app.services.audit_service import AuditService
from app.schemas.farmer_kyc import KYCUpdateSubmission, KYCResponse, KYCDocumentType
from app.schemas.delivery_kyc import (
    DeliveryKYCSubmission, DeliveryKYCResponse, DeliveryKYCStatus,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _trust_score(flags: dict) -> int:
    """Compute a simple 0-100 trust score from verified capabilities.

    Flags expected: mobile, identity, bank, farm (farmer) or vehicle (delivery).
    """
    weights = {
        "mobile": 30,
        "identity": 25,
        "bank": 20,
        "farm": 25,
        "vehicle": 25,
    }
    score = 0
    for key, weight in weights.items():
        if flags.get(key):
            score += weight
    return min(100, score)


@router.post("/upload")
async def upload_kyc_document(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("farmer")),
):
    """Upload a KYC document (Aadhaar, PAN, land record, farm photo, land video...).

    Mirrors the generic product/refund upload: the file is validated by magic
    bytes and stored under the platform uploads directory; the returned URL is
    served from ``/uploads``.
    """
    from app.utils.file_security import validate_upload, UploadValidationError

    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)

    content = await file.read()
    try:
        ext = validate_upload(
            file.filename or "file",
            content,
            content_type=file.content_type,
            max_bytes=settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/{filename}"
    return {"success": True, "data": {"url": url, "filename": filename}}


@router.post("/submit", response_model=KYCResponse)
async def submit_kyc(data: KYCUpdateSubmission, current_user: dict = Depends(require_role("farmer"))):
    """Submit or update farmer KYC.

    Accepts a partial payload (only the step the farmer is working on), merging
    it onto the existing record. A full submission is just one call that
    provides every field.
    """
    collection = MongoDB.get_collection("farmer_kyc")
    existing = await collection.find_one({"userId": str(current_user["_id"])})

    provided: dict = {}
    if data.farmName is not None:
        provided["farmName"] = data.farmName
    if data.farmAddress is not None:
        provided["farmAddress"] = data.farmAddress
    if data.farmCity is not None:
        provided["farmCity"] = data.farmCity
    if data.farmState is not None:
        provided["farmState"] = data.farmState
    if data.farmPincode is not None:
        provided["farmPincode"] = data.farmPincode
    if data.farmSizeAcres is not None:
        provided["farmSizeAcres"] = data.farmSizeAcres
    if data.documents is not None:
        merged_docs: dict = {}
        for d in (existing.get("documents") or []) if existing else []:
            merged_docs[d.get("type")] = d
        for d in [doc.dict() for doc in data.documents]:
            merged_docs[d.get("type")] = d
        provided["documents"] = list(merged_docs.values())
    if data.bankAccount is not None:
        provided["bankAccount"] = data.bankAccount.dict()

    if not provided:
        raise HTTPException(400, "No KYC fields to update")

    now = datetime.utcnow()
    if existing:
        base = {
            "farmName": existing.get("farmName") or "",
            "farmAddress": existing.get("farmAddress") or "",
            "farmCity": existing.get("farmCity") or "",
            "farmState": existing.get("farmState") or "",
            "farmPincode": existing.get("farmPincode") or "",
            "farmSizeAcres": existing.get("farmSizeAcres") or 0,
            "documents": existing.get("documents") or [],
            "bankAccount": existing.get("bankAccount"),
        }
        base.update(provided)
        # Stay verified if the record is already approved; otherwise go to review.
        base["status"] = "verified" if existing.get("status") == "verified" else "submitted"
        base["updatedAt"] = now
        await collection.update_one({"_id": existing["_id"]}, {"$set": base})
        base["id"] = str(existing["_id"])
        return base

    kyc = {
        "userId": str(current_user["_id"]),
        "farmName": provided.get("farmName", ""),
        "farmAddress": provided.get("farmAddress", ""),
        "farmCity": provided.get("farmCity", ""),
        "farmState": provided.get("farmState", ""),
        "farmPincode": provided.get("farmPincode", ""),
        "farmSizeAcres": provided.get("farmSizeAcres", 0),
        "documents": provided.get("documents", []),
        "bankAccount": provided.get("bankAccount"),
        "status": "submitted",
        "adminRemark": None,
        "submittedAt": now,
        "verifiedAt": None,
        "updatedAt": now
    }
    result = await collection.insert_one(kyc)
    kyc["id"] = str(result.inserted_id)
    return kyc


@router.get("/status", response_model=Optional[KYCResponse])
async def get_kyc_status(current_user: dict = Depends(require_role("farmer"))):
    collection = MongoDB.get_collection("farmer_kyc")
    kyc = await collection.find_one({"userId": str(current_user["_id"])})
    if not kyc:
        return None
    kyc["id"] = str(kyc["_id"])
    return kyc


@router.post("/delivery/submit", response_model=DeliveryKYCResponse)
async def submit_delivery_kyc(data: DeliveryKYCSubmission, current_user: dict = Depends(require_role("delivery"))):
    """Submit KYC for a delivery partner (identity, vehicle, driving licence, bank)."""
    collection = MongoDB.get_collection("delivery_kyc")
    existing = await collection.find_one({"userId": str(current_user["_id"])})
    if existing and existing.get("status") == "verified":
        raise HTTPException(400, "KYC already verified")
    now = datetime.utcnow()
    kyc = {
        "userId": str(current_user["_id"]),
        "fullName": data.fullName,
        "phone": data.phone,
        "address": data.address,
        "emergencyContactName": data.emergencyContactName,
        "emergencyContactPhone": data.emergencyContactPhone,
        "vehicleType": data.vehicleType,
        "vehicleNumber": data.vehicleNumber,
        "drivingLicenseNumber": data.drivingLicenseNumber,
        "drivingLicenseExpiry": data.drivingLicenseExpiry,
        "documents": [d.dict() for d in data.documents],
        "bankAccount": data.bankAccount.dict() if data.bankAccount else None,
        "status": DeliveryKYCStatus.SUBMITTED.value,
        "adminRemark": None,
        "submittedAt": now,
        "verifiedAt": None,
        "updatedAt": now
    }
    if existing:
        await collection.update_one({"_id": existing["_id"]}, {"$set": kyc})
        kyc["id"] = str(existing["_id"])
    else:
        result = await collection.insert_one(kyc)
        kyc["id"] = str(result.inserted_id)

    # Mirror basic info onto the delivery profile for ops convenience.
    from app.repositories.delivery_repository import delivery_repository
    profile = await delivery_repository.get_by_user_id(str(current_user["_id"]))
    if profile:
        patch = {}
        if data.vehicleNumber:
            patch["vehicleNumber"] = data.vehicleNumber
        if data.vehicleType:
            patch["vehicleType"] = data.vehicleType
        if data.drivingLicenseNumber:
            patch["drivingLicenseNumber"] = data.drivingLicenseNumber
        if data.drivingLicenseExpiry:
            patch["drivingLicenseExpiry"] = data.drivingLicenseExpiry
        if data.fullName:
            patch["fullName"] = data.fullName
        if patch:
            await delivery_repository.update({"_id": profile["_id"]}, patch)

    return kyc


@router.get("/delivery/status", response_model=Optional[DeliveryKYCResponse])
async def get_delivery_kyc_status(current_user: dict = Depends(require_role("delivery"))):
    collection = MongoDB.get_collection("delivery_kyc")
    kyc = await collection.find_one({"userId": str(current_user["_id"])})
    if not kyc:
        return None
    kyc["id"] = str(kyc["_id"])
    return kyc


@router.get("/verification-status", response_model=dict)
async def get_verification_status(current_user: dict = Depends(get_current_user)):
    """Return the current user's verification status + trust score."""
    user_id = str(current_user["_id"])
    users = MongoDB.get_collection("users")
    user = await users.find_one({"_id": ObjectId(user_id)})
    is_mobile_verified = bool((user or {}).get("isVerified"))

    status = {"mobile": is_mobile_verified, "identity": False, "bank": False, "farm": False, "vehicle": False}
    kyc = None

    if current_user.get("role") == "farmer":
        collection = MongoDB.get_collection("farmer_kyc")
        kyc = await collection.find_one({"userId": user_id})
        if kyc:
            docs = {d.get("type"): d for d in (kyc.get("documents") or [])}
            # Each step is marked verified as soon as the farmer completes it —
            # no admin approval is needed to show it on the score checklist.
            status["identity"] = bool(docs.get("aadhaar") and docs.get("pan"))
            farm_filled = bool(
                kyc.get("farmName") and kyc.get("farmAddress") and kyc.get("farmCity")
                and kyc.get("farmState") and kyc.get("farmPincode") and (kyc.get("farmSizeAcres") or 0) > 0
            )
            status["farm"] = bool(farm_filled and docs.get("land_document") and docs.get("land_video"))
            bank = kyc.get("bankAccount") or {}
            status["bank"] = bool(bank.get("accountNumber") and bank.get("ifscCode"))
    elif current_user.get("role") == "delivery":
        collection = MongoDB.get_collection("delivery_kyc")
        kyc = await collection.find_one({"userId": user_id})
        if kyc:
            verified = kyc.get("status") == "verified"
            status["identity"] = verified
            status["vehicle"] = verified
            bank = kyc.get("bankAccount") or {}
            status["bank"] = bank.get("status") == "verified"

    score = _trust_score(status)
    return {
        "userId": user_id,
        "role": current_user.get("role"),
        "status": status,
        "trustScore": score,
        "kycStatus": (kyc or {}).get("status"),
        "bankStatus": ((kyc or {}).get("bankAccount") or {}).get("status"),
    }


# ---------------- Admin review ----------------

@router.get("/pending", response_model=dict)
async def list_pending_kyc(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(require_role("admin"))
):
    """List pending farmer + delivery KYC for admin review."""
    farmer_collection = MongoDB.get_collection("farmer_kyc")
    delivery_collection = MongoDB.get_collection("delivery_kyc")

    farmer_query = {"status": "submitted"}
    farmer_total = await farmer_collection.count_documents(farmer_query)
    farmer_cursor = farmer_collection.find(farmer_query).sort("submittedAt", -1).skip((page - 1) * limit).limit(limit)
    farmers = await farmer_cursor.to_list(length=limit)

    delivery_query = {"status": "submitted"}
    delivery_total = await delivery_collection.count_documents(delivery_query)
    delivery_cursor = delivery_collection.find(delivery_query).sort("submittedAt", -1).skip((page - 1) * limit).limit(limit)
    deliveries = await delivery_cursor.to_list(length=limit)

    return {
        "farmers": [{**k, "id": str(k["_id"])} for k in farmers],
        "deliveryPartners": [{**k, "id": str(k["_id"])} for k in deliveries],
        "totals": {"farmers": farmer_total, "deliveryPartners": delivery_total},
        "page": page,
        "pages": max((farmer_total + limit - 1) // limit, (delivery_total + limit - 1) // limit, 1)
    }


@router.put("/{kyc_id}/verify")
async def verify_kyc(
    kyc_id: str,
    remark: Optional[str] = None,
    verifyBank: bool = Body(False, embed=True),
    current_user: dict = Depends(require_role("admin"))
):
    """Verify a farmer KYC (optionally approving the bank account too)."""
    collection = MongoDB.get_collection("farmer_kyc")
    update: dict = {"status": "verified", "adminRemark": remark, "verifiedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}
    if verifyBank:
        update["bankAccount.status"] = "verified"
    result = await collection.find_one_and_update(
        {"_id": ObjectId(kyc_id)},
        {"$set": update},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "KYC not found")
    await MongoDB.get_collection("users").update_one(
        {"_id": ObjectId(result["userId"])},
        {"$set": {"isVerified": True, "updatedAt": datetime.utcnow()}}
    )
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role="admin", action="kyc_verify",
        resource="farmer_kyc", resource_id=kyc_id, outcome="success",
        metadata={"userId": result.get("userId"), "verifyBank": verifyBank},
    )
    return {"message": "KYC verified, farmer activated"}


@router.put("/{kyc_id}/reject")
async def reject_kyc(
    kyc_id: str,
    remark: Optional[str] = "Documents need correction",
    current_user: dict = Depends(require_role("admin"))
):
    collection = MongoDB.get_collection("farmer_kyc")
    result = await collection.find_one_and_update(
        {"_id": ObjectId(kyc_id)},
        {"$set": {"status": "rejected", "adminRemark": remark, "updatedAt": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "KYC not found")
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role="admin", action="kyc_reject",
        resource="farmer_kyc", resource_id=kyc_id, outcome="success",
        metadata={"userId": result.get("userId"), "remark": remark},
    )
    return {"message": "KYC rejected", "remark": remark}


@router.put("/delivery/{kyc_id}/verify")
async def verify_delivery_kyc(
    kyc_id: str,
    remark: Optional[str] = None,
    verifyBank: bool = Body(False, embed=True),
    current_user: dict = Depends(require_role("admin"))
):
    """Verify a delivery partner KYC."""
    collection = MongoDB.get_collection("delivery_kyc")
    update: dict = {"status": "verified", "adminRemark": remark, "verifiedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}
    if verifyBank:
        update["bankAccount.status"] = "verified"
    result = await collection.find_one_and_update(
        {"_id": ObjectId(kyc_id)},
        {"$set": update},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "KYC not found")

    user_id = str(result["userId"])
    await MongoDB.get_collection("users").update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"isVerified": True, "updatedAt": datetime.utcnow()}}
    )
    # Activate the delivery profile.
    from app.repositories.delivery_repository import delivery_repository
    profile = await delivery_repository.get_by_user_id(user_id)
    if profile:
        await delivery_repository.update(
            {"_id": profile["_id"]},
            {"isVerified": True, "updatedAt": datetime.utcnow()}
        )
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role="admin", action="kyc_verify",
        resource="delivery_kyc", resource_id=kyc_id, outcome="success",
        metadata={"userId": user_id, "verifyBank": verifyBank},
    )
    return {"message": "Delivery partner KYC verified, profile activated"}


@router.put("/delivery/{kyc_id}/reject")
async def reject_delivery_kyc(
    kyc_id: str,
    remark: Optional[str] = "Documents need correction",
    current_user: dict = Depends(require_role("admin"))
):
    collection = MongoDB.get_collection("delivery_kyc")
    result = await collection.find_one_and_update(
        {"_id": ObjectId(kyc_id)},
        {"$set": {"status": "rejected", "adminRemark": remark, "updatedAt": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "KYC not found")
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role="admin", action="kyc_reject",
        resource="delivery_kyc", resource_id=kyc_id, outcome="success",
        metadata={"userId": result.get("userId"), "remark": remark},
    )
    return {"message": "Delivery partner KYC rejected", "remark": remark}