from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from bson import ObjectId
import logging

from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.core.security import require_role
from app.schemas.coupon import (
    CouponCreate, CouponUpdate, CouponResponse,
    CouponValidateRequest, CouponValidateResponse
)

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/", response_model=CouponResponse)
async def create_coupon(data: CouponCreate, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("coupons")
    existing = await collection.find_one({"code": data.code.upper()})
    if existing:
        raise HTTPException(400, "Coupon code already exists")
    now = datetime.utcnow()
    coupon = {
        "code": data.code.upper(),
        "description": data.description,
        "discountType": data.discountType.value,
        "discountValue": data.discountValue,
        "minOrderValue": data.minOrderValue,
        "maxDiscount": data.maxDiscount,
        "usageLimit": data.usageLimit,
        "usedCount": 0,
        "status": "active",
        "expiresAt": data.expiresAt,
        "createdBy": str(current_user["_id"]),
        "createdAt": now,
        "updatedAt": now
    }
    result = await collection.insert_one(coupon)
    coupon["id"] = str(result.inserted_id)
    return coupon

@router.get("/", response_model=dict)
async def list_coupons(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    current_user: dict = Depends(require_role("admin"))
):
    collection = MongoDB.get_collection("coupons")
    query = {}
    if status:
        query["status"] = status
    total = await collection.count_documents(query)
    cursor = collection.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    coupons = await cursor.to_list(length=limit)
    cleaned = []
    for c in coupons:
        c["id"] = str(c.pop("_id"))
        cleaned.append(c)
    return {
        "coupons": cleaned,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@router.get("/available", response_model=dict)
async def list_available_coupons(
    current_user: dict = Depends(get_current_user),
):
    """List active, non-expired coupons a customer can use at checkout."""
    collection = MongoDB.get_collection("coupons")
    now = datetime.utcnow()
    cursor = collection.find(
        {
            "status": "active",
            "$or": [
                {"expiresAt": {"$gte": now}},
                {"expiresAt": None},
            ],
        }
    ).sort("createdAt", -1)
    coupons = await cursor.to_list(length=100)
    result = []
    for c in coupons:
        if c.get("usageLimit") and c.get("usedCount", 0) >= c["usageLimit"]:
            continue
        c["id"] = str(c.pop("_id"))
        result.append(c)
    return {"coupons": result, "total": len(result)}

@router.get("/{coupon_id}", response_model=CouponResponse)
async def get_coupon(coupon_id: str, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("coupons")
    coupon = await collection.find_one({"_id": ObjectId(coupon_id)})
    if not coupon:
        raise HTTPException(404, "Coupon not found")
    coupon["id"] = str(coupon["_id"])
    return coupon

@router.put("/{coupon_id}", response_model=CouponResponse)
async def update_coupon(coupon_id: str, data: CouponUpdate, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("coupons")
    update = {k: v for k, v in data.dict(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    update["updatedAt"] = datetime.utcnow()
    result = await collection.find_one_and_update(
        {"_id": ObjectId(coupon_id)},
        {"$set": update},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Coupon not found")
    result["id"] = str(result["_id"])
    return result

@router.delete("/{coupon_id}")
async def delete_coupon(coupon_id: str, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection("coupons")
    result = await collection.delete_one({"_id": ObjectId(coupon_id)})
    if result.deleted_count == 0:
        raise HTTPException(404, "Coupon not found")
    return {"message": "Coupon deleted"}

@router.post("/validate", response_model=CouponValidateResponse)
async def validate_coupon(data: CouponValidateRequest, current_user: dict = Depends(get_current_user)):
    collection = MongoDB.get_collection("coupons")
    coupon = await collection.find_one({"code": data.code.upper(), "status": "active"})
    if not coupon:
        return CouponValidateResponse(valid=False, message="Invalid or expired coupon code")
    now = datetime.utcnow()
    if coupon.get("expiresAt") and coupon["expiresAt"] < now:
        return CouponValidateResponse(valid=False, message="Coupon has expired")
    if data.orderValue < coupon.get("minOrderValue", 0):
        return CouponValidateResponse(
            valid=False,
            message=f"Minimum order value of Rs {coupon['minOrderValue']} required"
        )
    if coupon.get("usageLimit") and coupon.get("usedCount", 0) >= coupon["usageLimit"]:
        return CouponValidateResponse(valid=False, message="Coupon usage limit reached")
    discount = data.orderValue * coupon["discountValue"] / 100 if coupon["discountType"] == "percentage" else coupon["discountValue"]
    if coupon.get("maxDiscount"):
        discount = min(discount, coupon["maxDiscount"])
    final_amount = max(0, data.orderValue - discount)
    coupon["id"] = str(coupon["_id"])
    return CouponValidateResponse(
        valid=True,
        coupon=coupon,
        discountAmount=round(discount, 2),
        finalAmount=round(final_amount, 2)
    )

@router.post("/{coupon_id}/increment-usage")
async def increment_coupon_usage(coupon_id: str):
    collection = MongoDB.get_collection("coupons")
    await collection.update_one(
        {"_id": ObjectId(coupon_id)},
        {"$inc": {"usedCount": 1}}
    )
    return {"message": "Usage count incremented"}
