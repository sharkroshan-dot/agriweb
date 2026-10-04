"""Master crop catalog and farmer crop configuration.

Master crops define authoritative default shelf life. Farmer crops reference a
master crop and snapshot the defaults used by the farmer's harvest workflow.
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from bson import ObjectId

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository

router = APIRouter()
master_repo = BaseRepository("master_crops")
farmer_crop_repo = BaseRepository("farmer_crops")

STORAGE_TYPES = ("normal", "refrigerated", "cold_storage", "frozen")
DEFAULT_MASTER_CROPS = [
    ("Tomato", 4), ("Spinach", 2), ("Leafy Greens", 2), ("Brinjal", 5),
    ("Capsicum", 7), ("Chilli", 7), ("Carrot", 14), ("Potato", 14),
    ("Onion", 30), ("Cucumber", 7), ("Beans", 5), ("Okra", 5),
    ("Cauliflower", 7), ("Cabbage", 14), ("Rice", 180), ("Wheat", 180),
]

class MasterCropCreate(BaseModel):
    name: str
    category: Optional[str] = None
    defaultShelfLifeDays: int = Field(ge=1, le=365)
    storageShelfLifeDays: dict[str, int] = Field(default_factory=dict)
    safeDeliveryBufferHours: int = Field(ge=0, le=168, default=24)
    isActive: bool = True

class MasterCropUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    defaultShelfLifeDays: Optional[int] = Field(None, ge=1, le=365)
    storageShelfLifeDays: Optional[dict[str, int]] = None
    safeDeliveryBufferHours: Optional[int] = Field(None, ge=0, le=168)
    isActive: Optional[bool] = None

class FarmerCropCreate(BaseModel):
    masterCropId: str
    name: Optional[str] = None
    variety: Optional[str] = None
    fieldName: Optional[str] = None
    areaAcres: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = None

class FarmerCropUpdate(BaseModel):
    masterCropId: Optional[str] = None
    name: Optional[str] = None
    variety: Optional[str] = None
    fieldName: Optional[str] = None
    areaAcres: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = None
    isActive: Optional[bool] = None

def _slug(name: str) -> str:
    return "-".join("".join(ch.lower() if ch.isalnum() else " " for ch in name).split())

def _serialize(doc: dict) -> dict:
    out = dict(doc)
    out["id"] = str(out.pop("_id"))
    for key in ("farmerId", "masterCropId"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    return out

async def seed_master_crops():
    now = datetime.utcnow()
    for name, days in DEFAULT_MASTER_CROPS:
        if await master_repo.find_one({"slug": _slug(name), "deletedAt": None}):
            continue
        await master_repo.create({
            "name": name, "slug": _slug(name), "category": "fresh_produce",
            "defaultShelfLifeDays": days,
            "storageShelfLifeDays": {
                "normal": days, "refrigerated": max(days + 2, days),
                "cold_storage": max(days + 5, days), "frozen": max(days + 27, days)
            },
            "safeDeliveryBufferHours": 24 if days >= 3 else 12,
            "isActive": True, "createdAt": now, "updatedAt": now, "deletedAt": None,
        })

@router.get("")
async def list_master_crops(active_only: bool = Query(True)):
    filt = {"deletedAt": None}
    if active_only:
        filt["isActive"] = True
    docs = await master_repo.find_many(filt, sort=[("name", 1)], limit=500)
    return {"success": True, "data": {"crops": [_serialize(x) for x in docs]}}

@router.post("", status_code=201)
async def create_master_crop(data: MasterCropCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage master crops")
    slug = _slug(data.name)
    if await master_repo.find_one({"slug": slug, "deletedAt": None}):
        raise HTTPException(status_code=409, detail="Master crop already exists")
    now = datetime.utcnow()
    doc = data.model_dump()
    doc.update({"name": data.name.strip(), "slug": slug, "createdAt": now, "updatedAt": now, "deletedAt": None})
    doc["storageShelfLifeDays"] = {**({"normal": data.defaultShelfLifeDays}), **data.storageShelfLifeDays}
    oid = await master_repo.create(doc)
    saved = await master_repo.find_one({"_id": oid})
    return {"success": True, "data": _serialize(saved)}

@router.put("/{crop_id}")
async def update_master_crop(crop_id: str, data: MasterCropUpdate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can manage master crops")
    try: oid = ObjectId(crop_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid master crop id")
    existing = await master_repo.find_one({"_id": oid, "deletedAt": None})
    if not existing: raise HTTPException(status_code=404, detail="Master crop not found")
    updates = data.model_dump(exclude_unset=True)
    if "name" in updates:
        updates["name"] = updates["name"].strip()
        updates["slug"] = _slug(updates["name"])
    if "storageShelfLifeDays" in updates:
        updates["storageShelfLifeDays"] = {**existing.get("storageShelfLifeDays", {}), **updates["storageShelfLifeDays"]}
    updates["updatedAt"] = datetime.utcnow()
    await master_repo.update({"_id": oid}, updates)
    return {"success": True, "data": _serialize(await master_repo.find_one({"_id": oid}))}

@router.get("/farmer")
async def list_farmer_crops(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can view farmer crops")
    docs = await farmer_crop_repo.find_many({"farmerId": ObjectId(current_user["_id"]), "deletedAt": None}, sort=[("createdAt", -1)], limit=500)
    return {"success": True, "data": {"crops": [_serialize(x) for x in docs]}}

@router.post("/farmer", status_code=201)
async def create_farmer_crop(data: FarmerCropCreate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can create farmer crops")
    try: master_id = ObjectId(data.masterCropId)
    except Exception: raise HTTPException(status_code=400, detail="Invalid master crop id")
    master = await master_repo.find_one({"_id": master_id, "deletedAt": None, "isActive": True})
    if not master: raise HTTPException(status_code=404, detail="Master crop not found")
    now = datetime.utcnow()
    doc = {
        "farmerId": ObjectId(current_user["_id"]), "masterCropId": master_id,
        "masterCropName": master["name"], "name": (data.name or master["name"]).strip(),
        "variety": data.variety, "fieldName": data.fieldName, "areaAcres": data.areaAcres,
        "notes": data.notes, "defaultShelfLifeDays": master["defaultShelfLifeDays"],
        "storageShelfLifeDays": master.get("storageShelfLifeDays", {}),
        "safeDeliveryBufferHours": master.get("safeDeliveryBufferHours", 24),
        "isActive": True, "createdAt": now, "updatedAt": now, "deletedAt": None,
    }
    oid = await farmer_crop_repo.create(doc)
    return {"success": True, "data": _serialize(await farmer_crop_repo.find_one({"_id": oid}))}

@router.put("/farmer/{crop_id}")
async def update_farmer_crop(crop_id: str, data: FarmerCropUpdate, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can update farmer crops")
    try: oid = ObjectId(crop_id)
    except Exception: raise HTTPException(status_code=400, detail="Invalid farmer crop id")
    existing = await farmer_crop_repo.find_one({"_id": oid, "farmerId": ObjectId(current_user["_id"]), "deletedAt": None})
    if not existing: raise HTTPException(status_code=404, detail="Farmer crop not found")
    updates = data.model_dump(exclude_unset=True)
    if "masterCropId" in updates:
        try: mid = ObjectId(updates["masterCropId"])
        except Exception: raise HTTPException(status_code=400, detail="Invalid master crop id")
        master = await master_repo.find_one({"_id": mid, "deletedAt": None, "isActive": True})
        if not master: raise HTTPException(status_code=404, detail="Master crop not found")
        updates.update({"masterCropId": mid, "masterCropName": master["name"], "defaultShelfLifeDays": master["defaultShelfLifeDays"], "storageShelfLifeDays": master.get("storageShelfLifeDays", {}), "safeDeliveryBufferHours": master.get("safeDeliveryBufferHours", 24)})
    updates["updatedAt"] = datetime.utcnow()
    await farmer_crop_repo.update({"_id": oid}, updates)
    return {"success": True, "data": _serialize(await farmer_crop_repo.find_one({"_id": oid}))}
