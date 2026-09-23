from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from bson import ObjectId
import logging

from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.core.security import require_role
from app.schemas.complaint import (
    ComplaintCreate, ComplaintResponse, ComplaintUpdate, ComplaintListResponse, ComplaintStatus
)

logger = logging.getLogger(__name__)
router = APIRouter()

COMPLAINT_COLLECTION = "complaints"

@router.post("/", response_model=ComplaintResponse)
async def create_complaint(data: ComplaintCreate, current_user: dict = Depends(get_current_user)):
    collection = MongoDB.get_collection(COMPLAINT_COLLECTION)
    now = datetime.utcnow()
    complaint = {
        "userId": str(current_user["_id"]),
        "userName": f"{current_user.get('firstName', '')} {current_user.get('lastName', '')}",
        "userRole": current_user.get("role", "customer"),
        "type": data.type.value,
        "subject": data.subject,
        "description": data.description,
        "status": "pending",
        "orderId": data.orderId,
        "productId": data.productId,
        "adminResponse": None,
        "resolvedAt": None,
        "createdAt": now,
        "updatedAt": now
    }
    result = await collection.insert_one(complaint)
    complaint["id"] = str(result.inserted_id)
    return complaint

@router.get("/", response_model=ComplaintListResponse)
async def list_complaints(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    collection = MongoDB.get_collection(COMPLAINT_COLLECTION)
    query = {}
    if current_user.get("role") != "admin":
        query["userId"] = str(current_user["_id"])
    if status:
        query["status"] = status
    if type:
        query["type"] = type
    total = await collection.count_documents(query)
    cursor = collection.find(query).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    complaints = await cursor.to_list(length=limit)
    return {
        "complaints": [{**c, "id": str(c["_id"])} for c in complaints],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@router.get("/{complaint_id}", response_model=ComplaintResponse)
async def get_complaint(complaint_id: str, current_user: dict = Depends(get_current_user)):
    collection = MongoDB.get_collection(COMPLAINT_COLLECTION)
    complaint = await collection.find_one({"_id": ObjectId(complaint_id)})
    if not complaint:
        raise HTTPException(404, "Complaint not found")
    if current_user.get("role") != "admin" and complaint["userId"] != str(current_user["_id"]):
        raise HTTPException(403, "Access denied")
    complaint["id"] = str(complaint["_id"])
    return complaint

@router.put("/{complaint_id}", response_model=ComplaintResponse)
async def update_complaint(complaint_id: str, data: ComplaintUpdate, current_user: dict = Depends(require_role("admin"))):
    collection = MongoDB.get_collection(COMPLAINT_COLLECTION)
    update = {}
    if data.status:
        update["status"] = data.status.value
    if data.adminResponse:
        update["adminResponse"] = data.adminResponse
    if data.status == ComplaintStatus.RESOLVED:
        update["resolvedAt"] = datetime.utcnow()
    if not update:
        raise HTTPException(400, "No fields to update")
    update["updatedAt"] = datetime.utcnow()
    result = await collection.find_one_and_update(
        {"_id": ObjectId(complaint_id)},
        {"$set": update},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Complaint not found")
    result["id"] = str(result["_id"])
    return result
