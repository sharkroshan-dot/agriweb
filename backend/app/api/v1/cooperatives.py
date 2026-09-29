from datetime import datetime
from typing import Any, Dict, List
import secrets
import string

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.inventory_repository import inventory_repository

router = APIRouter()

cooperative_repo = BaseRepository("cooperatives")
member_repo = BaseRepository("cooperative_members")
user_repo = BaseRepository("users")
product_repo = BaseRepository("products")


def _require_farmer(user: dict) -> None:
    if user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can use cooperatives")


def _oid(value: str, label: str = "id") -> ObjectId:
    try:
        return ObjectId(str(value))
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid {label}")


def _public(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(doc)
    if out.get("_id") is not None:
        out["id"] = str(out.pop("_id"))
    for key in ("managerId", "cooperativeId", "userId"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    return out


def _invite_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "AGR-" + "".join(secrets.choice(alphabet) for _ in range(8))


async def _unique_invite_code() -> str:
    for _ in range(10):
        code = _invite_code()
        if not await cooperative_repo.find_one({"inviteCode": code, "deletedAt": None}):
            return code
    raise HTTPException(status_code=500, detail="Could not generate cooperative invite code")


async def _get_members(cooperative_id: ObjectId) -> List[Dict[str, Any]]:
    members = await member_repo.find_many(
        {"cooperativeId": cooperative_id, "status": "active", "deletedAt": None},
        limit=500,
        sort=[("role", 1), ("joinedAt", 1)],
    )
    ids = [m["userId"] for m in members if m.get("userId")]
    users = await user_repo.find_many({"_id": {"$in": ids}}, limit=500) if ids else []
    by_id = {str(u["_id"]): u for u in users}
    result = []
    for member in members:
        user = by_id.get(str(member.get("userId")), {})
        result.append({
            "id": str(member["_id"]),
            "userId": str(member["userId"]),
            "role": member.get("role", "member"),
            "status": member.get("status", "active"),
            "joinedAt": member.get("joinedAt"),
            "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or user.get("email", "Farmer"),
            "email": user.get("email"),
            "phone": user.get("phone"),
        })
    return result


async def _member_ids(cooperative_id: ObjectId) -> List[ObjectId]:
    members = await member_repo.find_many(
        {"cooperativeId": cooperative_id, "status": "active", "deletedAt": None},
        limit=500,
    )
    return [m["userId"] for m in members if m.get("userId")]


async def _stock_for_farmers(farmer_ids: List[ObjectId]) -> Dict[str, Any]:
    total = reserved = sold = available = 0.0
    product_count = 0
    contributions: Dict[str, float] = {str(fid): 0.0 for fid in farmer_ids}
    for fid in farmer_ids:
        stocks = await inventory_repository.get_by_farmer(str(fid))
        for stock in stocks:
            product_count += 1
            t = float(stock.get("total_stock") or 0)
            r = float(stock.get("reserved_stock") or 0)
            s = float(stock.get("sold_stock") or 0)
            a = max(0.0, t - r - s)
            total += t
            reserved += r
            sold += s
            available += a
            contributions[str(fid)] += a
    return {
        "productCount": product_count,
        "totalKg": round(total, 2),
        "reservedKg": round(reserved, 2),
        "soldKg": round(sold, 2),
        "availableKg": round(available, 2),
        "farmerAvailableKg": contributions,
    }


class CooperativeCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    location: str = Field(..., min_length=2, max_length=160)
    description: str = Field("", max_length=500)
    crops: List[str] = Field(default_factory=list)


class JoinRequest(BaseModel):
    inviteCode: str = Field(..., min_length=4, max_length=30)


class ManagerAction(BaseModel):
    userId: str


@router.post("", status_code=201)
async def create_cooperative(
    data: CooperativeCreate,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    user_id = _oid(current_user["_id"], "farmer id")

    existing = await member_repo.find_one({
        "userId": user_id,
        "role": "manager",
        "status": "active",
        "deletedAt": None,
    })
    if existing:
        raise HTTPException(400, "You already manage an active cooperative")

    now = datetime.utcnow()
    invite_code = await _unique_invite_code()
    cooperative = {
        "name": data.name.strip(),
        "location": data.location.strip(),
        "description": data.description.strip(),
        "crops": [c.strip() for c in data.crops if c.strip()],
        "managerId": user_id,
        "inviteCode": invite_code,
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }
    cooperative_id = await cooperative_repo.create(cooperative)
    if not cooperative_id:
        raise HTTPException(500, "Failed to create cooperative")

    member = {
        "cooperativeId": ObjectId(cooperative_id),
        "userId": user_id,
        "role": "manager",
        "status": "active",
        "joinedAt": now,
        "deletedAt": None,
    }
    if not await member_repo.create(member):
        await cooperative_repo.hard_delete({"_id": ObjectId(cooperative_id)})
        raise HTTPException(500, "Failed to create cooperative membership")

    created = await cooperative_repo.find_one({"_id": ObjectId(cooperative_id)})
    return {"success": True, "data": _public(created), "message": "Cooperative created. You are the manager."}


@router.get("/me")
async def my_cooperatives(current_user: dict = Depends(get_current_user)):
    _require_farmer(current_user)
    user_id = _oid(current_user["_id"], "farmer id")
    memberships = await member_repo.find_many(
        {"userId": user_id, "status": "active", "deletedAt": None},
        limit=100,
        sort=[("joinedAt", -1)],
    )
    result = []
    for membership in memberships:
        coop = await cooperative_repo.find_one({
            "_id": membership["cooperativeId"],
            "status": "active",
            "deletedAt": None,
        })
        if not coop:
            continue
        members = await _get_members(coop["_id"])
        stock = await _stock_for_farmers(await _member_ids(coop["_id"]))
        mine = stock["farmerAvailableKg"].get(str(user_id), 0)
        result.append({
            **_public(coop),
            "role": "manager" if str(coop.get("managerId")) == str(user_id) else "member",
            "memberCount": len(members),
            "combinedStock": stock["availableKg"],
            "availableKg": stock["availableKg"],
            "productCount": stock["productCount"],
            "myContributionKg": round(mine, 2),
            "members": members,
        })
    return {"success": True, "data": {"cooperatives": result, "count": len(result)}}


@router.get("/{cooperative_id}")
async def cooperative_detail(
    cooperative_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    membership = await member_repo.find_one({
        "cooperativeId": cid,
        "userId": uid,
        "status": "active",
        "deletedAt": None,
    })
    if not membership:
        raise HTTPException(403, "You are not a member of this cooperative")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop:
        raise HTTPException(404, "Cooperative not found")
    members = await _get_members(cid)
    stock = await _stock_for_farmers(await _member_ids(cid))
    return {
        "success": True,
        "data": {
            **_public(coop),
            "role": membership.get("role", "member"),
            "members": members,
            "memberCount": len(members),
            "stock": {k: v for k, v in stock.items() if k != "farmerAvailableKg"},
            "myContributionKg": round(stock["farmerAvailableKg"].get(str(uid), 0), 2),
        },
    }


@router.post("/join")
async def join_cooperative(
    data: JoinRequest,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    uid = _oid(current_user["_id"], "farmer id")
    code = data.inviteCode.strip().upper()
    coop = await cooperative_repo.find_one({
        "inviteCode": code,
        "status": "active",
        "deletedAt": None,
    })
    if not coop:
        raise HTTPException(404, "Cooperative invite code not found")
    if str(coop.get("managerId")) == str(uid):
        return {"success": True, "data": _public(coop), "message": "You already manage this cooperative"}

    existing = await member_repo.find_one({
        "cooperativeId": coop["_id"],
        "userId": uid,
        "deletedAt": None,
    })
    if existing and existing.get("status") == "active":
        return {"success": True, "data": _public(coop), "message": "You are already a member"}

    if existing:
        await member_repo.collection.update_one(
            {"_id": existing["_id"]},
            {"$set": {"status": "active", "joinedAt": datetime.utcnow(), "deletedAt": None}},
        )
    else:
        await member_repo.create({
            "cooperativeId": coop["_id"],
            "userId": uid,
            "role": "member",
            "status": "active",
            "joinedAt": datetime.utcnow(),
            "deletedAt": None,
        })
    return {"success": True, "data": _public(coop), "message": f"You joined {coop.get('name')}"}


@router.get("/{cooperative_id}/members")
async def cooperative_members(
    cooperative_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    membership = await member_repo.find_one({"cooperativeId": cid, "userId": uid, "status": "active", "deletedAt": None})
    if not membership:
        raise HTTPException(403, "You are not a member of this cooperative")
    return {"success": True, "data": {"members": await _get_members(cid)}}


@router.post("/{cooperative_id}/members/remove")
async def remove_member(
    cooperative_id: str,
    data: ManagerAction,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop or str(coop.get("managerId")) != str(uid):
        raise HTTPException(403, "Only the cooperative manager can remove members")
    target = _oid(data.userId, "member id")
    if str(target) == str(uid):
        raise HTTPException(400, "Manager cannot remove themselves. Transfer management first.")
    result = await member_repo.collection.update_one(
        {"cooperativeId": cid, "userId": target, "role": "member", "status": "active"},
        {"$set": {"status": "removed", "deletedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()}},
    )
    if not result.modified_count:
        raise HTTPException(404, "Active member not found")
    return {"success": True, "message": "Farmer removed from cooperative"}


@router.post("/{cooperative_id}/transfer-manager")
async def transfer_manager(
    cooperative_id: str,
    data: ManagerAction,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop or str(coop.get("managerId")) != str(uid):
        raise HTTPException(403, "Only the current cooperative manager can transfer management")
    target = _oid(data.userId, "member id")
    target_member = await member_repo.find_one({"cooperativeId": cid, "userId": target, "role": "member", "status": "active", "deletedAt": None})
    if not target_member:
        raise HTTPException(404, "Target farmer must be an active cooperative member")
    await member_repo.collection.update_many(
        {"cooperativeId": cid, "status": "active"},
        {"$set": {"role": "member", "updatedAt": datetime.utcnow()}},
    )
    await member_repo.collection.update_one({"_id": target_member["_id"]}, {"$set": {"role": "manager", "updatedAt": datetime.utcnow()}})
    await cooperative_repo.update({"_id": cid}, {"managerId": target})
    return {"success": True, "message": "Cooperative management transferred successfully"}


@router.post("/{cooperative_id}/leave")
async def leave_cooperative(
    cooperative_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    membership = await member_repo.find_one({"cooperativeId": cid, "userId": uid, "status": "active", "deletedAt": None})
    if not membership:
        raise HTTPException(404, "Active membership not found")
    if membership.get("role") == "manager":
        raise HTTPException(400, "Manager must transfer management before leaving")
    await member_repo.collection.update_one({"_id": membership["_id"]}, {"$set": {"status": "left", "deletedAt": datetime.utcnow()}})
    return {"success": True, "message": "You left the cooperative"}


@router.get("/{cooperative_id}/supply")
async def cooperative_supply(
    cooperative_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    membership = await member_repo.find_one({"cooperativeId": cid, "userId": uid, "status": "active", "deletedAt": None})
    if not membership:
        raise HTTPException(403, "You are not a member of this cooperative")
    ids = await _member_ids(cid)
    if not ids:
        return {"success": True, "data": {"products": [], "totalAvailableKg": 0}}
    products = await product_repo.find_many({"farmerId": {"$in": ids}, "isActive": {"$ne": False}}, limit=1000)
    rows = []
    for product in products:
        stock = await inventory_repository.get_stock_summary(str(product["_id"]))
        available = float((stock or {}).get("available_stock") or 0)
        if available <= 0:
            continue
        rows.append({
            "productId": str(product["_id"]),
            "farmerId": str(product.get("farmerId")),
            "productName": product.get("name", "Product"),
            "price": float(product.get("price") or 0),
            "unit": product.get("unit", "kg"),
            "availableKg": round(available, 2),
        })
    rows.sort(key=lambda x: (-x["availableKg"], x["productName"]))
    return {
        "success": True,
        "data": {
            "products": rows,
            "totalAvailableKg": round(sum(x["availableKg"] for x in rows), 2),
        },
    }



@router.post("/{cooperative_id}/b2b-allocation")
async def allocate_b2b_supply(
    cooperative_id: str,
    allocations: List[Dict[str, Any]] = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Record a manager-approved allocation of member-owned stock to a cooperative sale."""
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop or str(coop.get("managerId")) != str(uid):
        raise HTTPException(403, "Only the cooperative manager can allocate supply")
    members = await _member_ids(cid)
    member_set = {str(x) for x in members}
    result = []
    for item in allocations:
        farmer_id = str(item.get("farmerId") or "")
        product_id = str(item.get("productId") or "")
        quantity = float(item.get("quantityKg") or 0)
        if farmer_id not in member_set or quantity <= 0:
            raise HTTPException(400, "Each allocation must use an active cooperative farmer and a positive quantity")
        try:
            product = await product_repo.find_one({"_id": ObjectId(product_id), "farmerId": ObjectId(farmer_id), "isActive": {"$ne": False}})
        except Exception:
            product = None
        if not product:
            raise HTTPException(404, "Product not found for the selected farmer")
        stock = await inventory_repository.get_stock_summary(product_id)
        available = float((stock or {}).get("available_stock") or 0)
        if quantity > available:
            raise HTTPException(400, f"Insufficient available stock for {product.get('name', 'product')}")
        result.append({"farmerId": farmer_id, "productId": product_id, "productName": product.get("name"), "quantityKg": round(quantity, 2)})
    return {"success": True, "data": {"cooperativeId": str(cid), "allocations": result, "totalQuantityKg": round(sum(x["quantityKg"] for x in result), 2)}}
