from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from typing import Optional
from bson import ObjectId
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository

router = APIRouter()
offer_repo = BaseRepository("farmer_offers")
coupon_repo = BaseRepository("coupons")
product_repo = BaseRepository("products")


def _farmer(user: dict):
    if user.get("role") != "farmer":
        raise HTTPException(403, "Only farmers can manage their offers and coupons")


def _serialize(doc: dict) -> dict:
    d = dict(doc)
    d["id"] = str(d.pop("_id"))
    for key in ("farmerId", "productId"):
        if d.get(key) is not None:
            d[key] = str(d[key])
    return d


class OfferCreate(BaseModel):
    productId: str
    name: str = Field(..., min_length=2, max_length=120)
    discountType: str = "percentage"
    discountValue: float = Field(..., gt=0)
    minQuantity: float = Field(0, ge=0)
    minOrderValue: float = Field(0, ge=0)
    startAt: datetime
    endAt: datetime
    eligibility: str = "all"


class CouponCreate(BaseModel):
    code: str = Field(..., min_length=3, max_length=40)
    description: str = ""
    discountType: str = "percentage"
    discountValue: float = Field(..., gt=0)
    minOrderValue: float = Field(0, ge=0)
    maxDiscount: Optional[float] = Field(None, ge=0)
    usageLimit: Optional[int] = Field(None, gt=0)
    expiresAt: Optional[datetime] = None
    eligibility: str = "all"


@router.get("/products")
async def farmer_offer_products(current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    docs = await product_repo.find_many({"farmerId": ObjectId(str(current_user["_id"])), "isActive": {"$ne": False}}, limit=500)
    return {"products": [{"id": str(x["_id"]), "name": x.get("name", "Product"), "price": x.get("price", 0), "unit": x.get("unit", "kg")} for x in docs]}


@router.get("/mine")
async def my_offers_and_coupons(current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    fid = ObjectId(str(current_user["_id"]))
    offers = await offer_repo.find_many({"farmerId": fid}, limit=500)
    coupons = await coupon_repo.find_many({"ownerType": "farmer", "farmerId": fid}, limit=500)
    return {"offers": [_serialize(x) for x in offers], "coupons": [_serialize(x) for x in coupons]}


@router.post("/offers")
async def create_offer(data: OfferCreate, current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    if data.endAt <= data.startAt:
        raise HTTPException(400, "End date must be after start date")
    try:
        product = await product_repo.find_one({"_id": ObjectId(data.productId), "farmerId": ObjectId(str(current_user["_id"]))})
    except Exception:
        product = None
    if not product:
        raise HTTPException(404, "Product not found or does not belong to you")
    if data.discountType not in ("percentage", "fixed"):
        raise HTTPException(400, "Discount type must be percentage or fixed")
    if data.discountType == "percentage" and data.discountValue > 100:
        raise HTTPException(400, "Percentage discount cannot exceed 100")
    now = datetime.utcnow()
    doc = data.model_dump()
    doc.update({"productId": ObjectId(data.productId), "farmerId": ObjectId(str(current_user["_id"])), "status": "scheduled" if data.startAt > now else "active", "createdAt": now, "updatedAt": now})
    result = await offer_repo.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


@router.put("/offers/{offer_id}")
async def update_offer(offer_id: str, data: OfferCreate, current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    try:
        oid = ObjectId(offer_id)
    except Exception:
        raise HTTPException(400, "Invalid offer id")
    doc = await offer_repo.find_one({"_id": oid, "farmerId": ObjectId(str(current_user["_id"]))})
    if not doc:
        raise HTTPException(404, "Offer not found")
    values = data.model_dump()
    values["productId"] = ObjectId(data.productId)
    values["status"] = "scheduled" if data.startAt > datetime.utcnow() else "active"
    values["updatedAt"] = datetime.utcnow()
    await offer_repo.collection.update_one({"_id": oid}, {"$set": values})
    doc.update(values)
    return _serialize(doc)


@router.delete("/offers/{offer_id}")
async def delete_offer(offer_id: str, current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    try: oid = ObjectId(offer_id)
    except Exception: raise HTTPException(400, "Invalid offer id")
    result = await offer_repo.collection.delete_one({"_id": oid, "farmerId": ObjectId(str(current_user["_id"]))})
    if not result.deleted_count: raise HTTPException(404, "Offer not found")
    return {"success": True}


@router.post("/coupons")
async def create_farmer_coupon(data: CouponCreate, current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    if data.discountType not in ("percentage", "fixed"):
        raise HTTPException(400, "Discount type must be percentage or fixed")
    if data.discountType == "percentage" and data.discountValue > 100:
        raise HTTPException(400, "Percentage discount cannot exceed 100")
    code = data.code.upper()
    if await coupon_repo.find_one({"code": code}):
        raise HTTPException(400, "Coupon code already exists")
    now = datetime.utcnow()
    doc = data.model_dump()
    doc.update({"code": code, "ownerType": "farmer", "farmerId": ObjectId(str(current_user["_id"])), "status": "scheduled" if data.startAt and data.startAt > now else "active", "usedCount": 0, "createdAt": now, "updatedAt": now})
    result = await coupon_repo.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


@router.put("/coupons/{coupon_id}")
async def update_farmer_coupon(coupon_id: str, data: CouponCreate, current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    try: oid = ObjectId(coupon_id)
    except Exception: raise HTTPException(400, "Invalid coupon id")
    doc = await coupon_repo.find_one({"_id": oid, "ownerType": "farmer", "farmerId": ObjectId(str(current_user["_id"]))})
    if not doc: raise HTTPException(404, "Coupon not found")
    values = data.model_dump()
    values["code"] = data.code.upper()
    values["updatedAt"] = datetime.utcnow()
    await coupon_repo.collection.update_one({"_id": oid}, {"$set": values})
    doc.update(values)
    return _serialize(doc)


@router.delete("/coupons/{coupon_id}")
async def delete_farmer_coupon(coupon_id: str, current_user: dict = Depends(get_current_user)):
    _farmer(current_user)
    try: oid = ObjectId(coupon_id)
    except Exception: raise HTTPException(400, "Invalid coupon id")
    result = await coupon_repo.collection.delete_one({"_id": oid, "ownerType": "farmer", "farmerId": ObjectId(str(current_user["_id"]))})
    if not result.deleted_count: raise HTTPException(404, "Coupon not found")
    return {"success": True}


@router.get("/available")
async def available_farmer_offers(productId: Optional[str] = Query(None)):
    now = datetime.utcnow()
    query = {"status": {"$in": ["active", "scheduled"]}, "startAt": {"$lte": now}, "endAt": {"$gte": now}}
    if productId:
        try: query["productId"] = ObjectId(productId)
        except Exception: raise HTTPException(400, "Invalid product id")
    offers = await offer_repo.find_many(query, limit=500)
    return {"offers": [_serialize(x) for x in offers]}


@router.get("/available-coupons")
async def available_farmer_coupons():
    now = datetime.utcnow()
    query = {"ownerType": "farmer", "status": "active", "$or": [{"expiresAt": {"$gte": now}}, {"expiresAt": None}]}
    coupons = await coupon_repo.find_many(query, limit=500)
    return {"coupons": [_serialize(x) for x in coupons]}
