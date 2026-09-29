from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from app.api.v1.auth import get_current_user
from app.services.settlement_service import SettlementService, settlement_repository

router = APIRouter()


@router.get("/me")
async def my_settlements(status: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") not in ("farmer", "delivery"):
        raise HTTPException(status_code=403, detail="Only earning parties can view settlements")
    return {"success": True, "data": await SettlementService.list_for_user(str(current_user["_id"]), status)}


@router.get("/admin")
async def admin_settlements(status: Optional[str] = Query(None), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access settlements")
    query = {"deletedAt": None}
    if status:
        query["status"] = status
    rows = await settlement_repository.find_many(query, sort=[("createdAt", -1)], limit=500)
    for row in rows:
        row["id"] = str(row["_id"])
        for field in ("paymentId", "orderId", "partyId"):
            if row.get(field):
                row[field] = str(row[field])
    return {"success": True, "data": rows}


@router.put("/admin/{settlement_id}")
async def update_settlement(
    settlement_id: str,
    status: str = Body(..., embed=True),
    note: Optional[str] = Body(None, embed=True),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can update settlements")
    row = await SettlementService.admin_update(settlement_id, status, str(current_user["_id"]), note)
    if not row:
        raise HTTPException(status_code=400, detail="Invalid settlement or status")
    row["id"] = str(row["_id"])
    return {"success": True, "data": row}
