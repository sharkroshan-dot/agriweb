from datetime import datetime, timedelta
from typing import Any, Dict, List
import secrets
import string

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.inventory_repository import inventory_repository
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority

router = APIRouter()

cooperative_repo = BaseRepository("cooperatives")
member_repo = BaseRepository("cooperative_members")
user_repo = BaseRepository("users")
product_repo = BaseRepository("products")
harvest_plan_repo = BaseRepository("harvest_plans")
batch_repo = BaseRepository("batches")
order_repo = BaseRepository("orders")
delivery_assignment_repo = BaseRepository("delivery_assignments")
cooperative_allocation_repo = BaseRepository("cooperative_allocations")
cooperative_message_repo = BaseRepository("cooperative_messages")


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


async def _get_members(cooperative_id: ObjectId, include_pending: bool = False) -> List[Dict[str, Any]]:
    members = await member_repo.find_many(
        {"cooperativeId": cooperative_id, "status": {"$in": ["active", "pending"]} if include_pending else "active", "deletedAt": None},
        limit=500,
        sort=[("status", 1), ("role", 1), ("joinedAt", 1)],
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
            "joinSource": member.get("joinSource", "manual"),
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
    source: str = Field(default="manual", max_length=20)


class ManagerAction(BaseModel):
    userId: str


class CooperativeInvitationCreate(BaseModel):
    farmerId: str


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


@router.get("/discover")
async def discover_cooperatives(
    search: str = Query("", max_length=100),
    location: str = Query("", max_length=160),
    crop: str = Query("", max_length=80),
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    query: Dict[str, Any] = {"status": "active", "deletedAt": None}
    if search.strip():
        query["name"] = {"$regex": search.strip(), "$options": "i"}
    if location.strip():
        query["location"] = {"$regex": location.strip(), "$options": "i"}
    if crop.strip():
        query["crops"] = {"$regex": crop.strip(), "$options": "i"}
    coops = await cooperative_repo.find_many(query, limit=100, sort=[("name", 1)])
    uid = _oid(current_user["_id"], "farmer id")
    result = []
    for coop in coops:
        if str(coop.get("managerId")) == str(uid):
            continue
        active = await member_repo.find_one({"cooperativeId": coop["_id"], "userId": uid, "status": "active", "deletedAt": None})
        pending = await member_repo.find_one({"cooperativeId": coop["_id"], "userId": uid, "status": "pending", "deletedAt": None})
        member_count = await member_repo.collection.count_documents({"cooperativeId": coop["_id"], "status": "active", "deletedAt": None})
        result.append({"id": str(coop["_id"]), "name": coop.get("name"), "location": coop.get("location"), "description": coop.get("description"), "crops": coop.get("crops", []), "memberCount": member_count, "joinStatus": "member" if active else ("pending" if pending else "available")})
    return {"success": True, "data": {"cooperatives": result, "count": len(result)}}


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



@router.get("/farmers/search")
async def search_farmers(
    search: str = Query("", max_length=100),
    limit: int = Query(20, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Find other farmers who can receive a cooperative invitation."""
    _require_farmer(current_user)
    uid = _oid(current_user["_id"], "farmer id")
    query: Dict[str, Any] = {
        "role": "farmer",
        "deletedAt": None,
        "_id": {"$ne": uid},
    }
    term = search.strip()
    if term:
        query["$or"] = [
            {"firstName": {"$regex": term, "$options": "i"}},
            {"lastName": {"$regex": term, "$options": "i"}},
            {"email": {"$regex": term, "$options": "i"}},
            {"phone": {"$regex": term, "$options": "i"}},
        ]
    farmers = await user_repo.find_many(query, limit=limit, sort=[("firstName", 1), ("lastName", 1)])
    return {
        "success": True,
        "data": {
            "farmers": [
                {
                    "id": str(f["_id"]),
                    "name": f"{f.get('firstName', '')} {f.get('lastName', '')}".strip() or f.get("email", "Farmer"),
                    "email": f.get("email"),
                    "phone": f.get("phone"),
                }
                for f in farmers
            ]
        },
    }




@router.get("/farmers/discover")
async def discover_farmers_for_cooperative(
    location: str = Query("", max_length=160),
    crop: str = Query("", max_length=80),
    search: str = Query("", max_length=100),
    cooperative_id: str = Query("", alias="cooperativeId", max_length=64),
    limit: int = Query(30, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Discover farmers by farm location and crops for a manager's cooperative invitations."""
    _require_farmer(current_user)
    if not cooperative_id:
        raise HTTPException(400, "Select a cooperative before discovering farmers")
    cid = _oid(cooperative_id, "cooperative id")
    target_cooperative = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not target_cooperative or str(target_cooperative.get("managerId")) != str(current_user["_id"]):
        raise HTTPException(403, "Only the cooperative manager can discover farmers to invite")
    location_term = location.strip()
    crop_term = crop.strip()
    name_term = search.strip()
    if not location_term and not crop_term and not name_term:
        raise HTTPException(400, "Enter a location, crop or farmer name/contact to discover farmers")

    uid = _oid(current_user["_id"], "farmer id")
    users_query: Dict[str, Any] = {
        "role": "farmer",
        "deletedAt": None,
        "_id": {"$ne": uid},
    }
    if name_term:
        users_query["$or"] = [
            {"firstName": {"$regex": name_term, "$options": "i"}},
            {"lastName": {"$regex": name_term, "$options": "i"}},
            {"name": {"$regex": name_term, "$options": "i"}},
            {"phone": {"$regex": name_term, "$options": "i"}},
            {"email": {"$regex": name_term, "$options": "i"}},
        ]
    users = await user_repo.find_many(users_query, limit=500, sort=[("firstName", 1), ("lastName", 1)])
    if not users:
        return {"success": True, "data": {"farmers": [], "count": 0}}

    user_ids = [u["_id"] for u in users]
    user_id_strings = [str(value) for value in user_ids]
    profiles = await BaseRepository("farmer_profiles").find_many(
        {"userId": {"$in": user_ids + user_id_strings}, "deletedAt": None},
        limit=1000,
    )
    profile_by_user = {str(p.get("userId")): p for p in profiles if p.get("userId") is not None}

    products = await product_repo.find_many(
        {
            "farmerId": {"$in": user_ids + user_id_strings},
            "deletedAt": None,
            "isActive": {"$ne": False},
        },
        limit=5000,
    )
    products_by_farmer: Dict[str, List[Dict[str, Any]]] = {}
    for product in products:
        farmer_key = str(product.get("farmerId", ""))
        products_by_farmer.setdefault(farmer_key, []).append(product)

    location_pattern = location_term.lower()
    crop_pattern = crop_term.lower()
    matches = []
    for farmer in users:
        farmer_id = str(farmer["_id"])
        profile = profile_by_user.get(farmer_id, {})
        profile_location = profile.get("location") or {}
        if isinstance(profile_location, dict):
            location_values = [
                profile_location.get("city"), profile_location.get("district"),
                profile_location.get("state"), profile_location.get("village"),
                profile_location.get("address"),
            ]
        else:
            location_values = [profile_location]
        location_values.extend([
            profile.get("city"), profile.get("district"), profile.get("state"),
            profile.get("farmAddress"), farmer.get("city"), farmer.get("district"),
            farmer.get("state"),
        ])
        location_text = ", ".join(str(v) for v in location_values if v)
        if location_pattern and location_pattern not in location_text.lower():
            continue

        farmer_products = products_by_farmer.get(farmer_id, [])
        farmer_crops = []
        for product in farmer_products:
            product_name = product.get("name") or product.get("productName") or product.get("cropName")
            category = product.get("category")
            if product_name:
                farmer_crops.append(str(product_name))
            if category:
                farmer_crops.append(str(category))
        profile_crops = profile.get("crops") or profile.get("cropTypes") or []
        if isinstance(profile_crops, str):
            profile_crops = [part.strip() for part in profile_crops.split(",") if part.strip()]
        farmer_crops.extend(str(value) for value in profile_crops if value)
        unique_crops = list(dict.fromkeys(farmer_crops))
        matching_crops = [
            value for value in unique_crops
            if not crop_pattern or crop_pattern in value.lower()
        ]
        if crop_pattern and not matching_crops:
            continue

        existing_membership = await member_repo.find_one({
            "cooperativeId": cid, "userId": farmer["_id"], "status": "active", "deletedAt": None
        })
        pending_membership = await member_repo.find_one({
            "cooperativeId": cid, "userId": farmer["_id"], "status": "pending", "deletedAt": None
        })
        pending_invitation = await cooperative_repo.find_one({
            "type": "invitation", "cooperativeId": cid, "farmerId": farmer["_id"], "status": "pending",
            "deletedAt": None, "expiresAt": {"$gt": datetime.utcnow()},
        })
        full_location = ", ".join(dict.fromkeys(str(v).strip() for v in location_values if v))
        matches.append({
            "id": farmer_id,
            "name": f"{farmer.get('firstName', '')} {farmer.get('lastName', '')}".strip()
                    or farmer.get("name") or "Farmer",
            "farmName": profile.get("farmName") or profile.get("ownerName"),
            "phone": farmer.get("phone"),
            "email": farmer.get("email"),
            "location": full_location or "Location not provided",
            "crops": unique_crops[:12],
            "matchingCrops": matching_crops[:8],
            "membershipStatus": "member" if existing_membership else ("pending" if pending_membership else "available"),
            "invitationStatus": "invited" if pending_invitation else "not_invited",
        })
        if len(matches) >= limit:
            break

    return {"success": True, "data": {"farmers": matches, "count": len(matches)}}

@router.get("/public/invite/{invite_code}")
async def public_cooperative_invite_details(invite_code: str):
    """Public, read-only preview used when a farmer scans a cooperative QR code."""
    code = invite_code.strip().upper()
    coop = await cooperative_repo.find_one({
        "inviteCode": code,
        "status": "active",
        "deletedAt": None,
    })
    if not coop:
        raise HTTPException(404, "This cooperative invitation is invalid or no longer available")
    member_count = await member_repo.collection.count_documents({
        "cooperativeId": coop["_id"],
        "status": "active",
        "deletedAt": None,
    })
    return {
        "success": True,
        "data": {
            "id": str(coop["_id"]),
            "name": coop.get("name"),
            "location": coop.get("location"),
            "description": coop.get("description") or "",
            "crops": coop.get("crops", []),
            "memberCount": member_count,
            "status": coop.get("status"),
        },
    }


@router.get("/invite/{invite_code}")
async def cooperative_invite_details(
    invite_code: str,
    current_user: dict = Depends(get_current_user),
):
    """Resolve a QR/deep-link invite without exposing membership internals."""
    _require_farmer(current_user)
    code = invite_code.strip().upper()
    coop = await cooperative_repo.find_one({"inviteCode": code, "status": "active", "deletedAt": None})
    if not coop:
        raise HTTPException(404, "Cooperative invitation not found")
    uid = _oid(current_user["_id"], "farmer id")
    if str(coop.get("managerId")) == str(uid):
        status = "manager"
    else:
        membership = await member_repo.find_one({"cooperativeId": coop["_id"], "userId": uid, "deletedAt": None})
        status = membership.get("status") if membership else "available"
    return {
        "success": True,
        "data": {
            "id": str(coop["_id"]),
            "name": coop.get("name"),
            "location": coop.get("location"),
            "description": coop.get("description"),
            "crops": coop.get("crops", []),
            "memberCount": await member_repo.collection.count_documents({"cooperativeId": coop["_id"], "status": "active", "deletedAt": None}),
            "status": status,
        },
    }


@router.post("/{cooperative_id}/invitations")
async def send_cooperative_invitation(
    cooperative_id: str,
    data: CooperativeInvitationCreate,
    current_user: dict = Depends(get_current_user),
):
    """Send a direct in-app invitation from a cooperative manager to another farmer."""
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    manager_id = _oid(current_user["_id"], "farmer id")
    target_id = _oid(data.farmerId, "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop or str(coop.get("managerId")) != str(manager_id):
        raise HTTPException(403, "Only the cooperative manager can invite farmers")
    if str(target_id) == str(manager_id):
        raise HTTPException(400, "You cannot invite yourself")
    target = await user_repo.find_one({"_id": target_id, "role": "farmer", "deletedAt": None})
    if not target:
        raise HTTPException(404, "Farmer not found")
    existing_member = await member_repo.find_one({"cooperativeId": cid, "userId": target_id, "deletedAt": None})
    if existing_member and existing_member.get("status") == "active":
        raise HTTPException(409, "Farmer is already a cooperative member")
    existing_invite = await cooperative_repo.find_one({
        "type": "invitation",
        "cooperativeId": cid,
        "farmerId": target_id,
        "status": "pending",
        "deletedAt": None,
        "expiresAt": {"$gt": datetime.utcnow()},
    })
    if existing_invite:
        raise HTTPException(409, "A pending invitation already exists for this farmer")
    inviter_name = f"{current_user.get('firstName', '')} {current_user.get('lastName', '')}".strip() or "Your cooperative manager"
    now = datetime.utcnow()
    invitation_id = await cooperative_repo.create({
        "type": "invitation",
        "cooperativeId": cid,
        "farmerId": target_id,
        "managerId": manager_id,
        "status": "pending",
        "createdAt": now,
        "expiresAt": now + timedelta(days=7),
        "deletedAt": None,
    })
    if not invitation_id:
        raise HTTPException(500, "Failed to create cooperative invitation")
    await NotificationService.create_in_app_notification(
        user_id=str(target_id),
        type=NotificationType.FARMER,
        title=f"Invitation to join {coop.get('name', 'a cooperative')}",
        message=f"{inviter_name} invited you to join {coop.get('name', 'their cooperative')}.",
        data={
            "kind": "cooperative_invitation",
            "invitationId": str(invitation_id),
            "cooperativeId": str(cid),
            "cooperativeName": coop.get("name"),
            "location": coop.get("location"),
            "expiresAt": (now + timedelta(days=7)).isoformat(),
        },
        priority=NotificationPriority.HIGH,
    )
    return {"success": True, "data": {"invitationId": str(invitation_id)}, "message": "Invitation sent to the farmer"}


@router.get("/invitations/mine")
async def my_cooperative_invitations(current_user: dict = Depends(get_current_user)):
    _require_farmer(current_user)
    uid = _oid(current_user["_id"], "farmer id")
    invitations = await cooperative_repo.find_many(
        {
            "type": "invitation",
            "farmerId": uid,
            "status": "pending",
            "deletedAt": None,
            "expiresAt": {"$gt": datetime.utcnow()},
        },
        limit=50,
        sort=[("createdAt", -1)],
    )
    result = []
    for invitation in invitations:
        coop = await cooperative_repo.find_one({
            "_id": invitation.get("cooperativeId"),
            "status": "active",
            "deletedAt": None,
        })
        if not coop:
            continue
        result.append({
            "id": str(invitation["_id"]),
            "cooperativeId": str(invitation["cooperativeId"]),
            "cooperativeName": coop.get("name"),
            "location": coop.get("location"),
            "description": coop.get("description"),
            "crops": coop.get("crops", []),
            "invitedAt": invitation.get("createdAt"),
            "expiresAt": invitation.get("expiresAt"),
        })
    return {"success": True, "data": {"invitations": result, "count": len(result)}}


@router.post("/invitations/{invitation_id}/accept")
async def accept_cooperative_invitation(
    invitation_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    iid = _oid(invitation_id, "invitation id")
    uid = _oid(current_user["_id"], "farmer id")
    invitation = await cooperative_repo.find_one({
        "_id": iid,
        "type": "invitation",
        "farmerId": uid,
        "status": "pending",
        "deletedAt": None,
    })
    if not invitation:
        raise HTTPException(404, "Invitation not found or already handled")
    if invitation.get("expiresAt") and invitation["expiresAt"] <= datetime.utcnow():
        await cooperative_repo.update({"_id": iid}, {"status": "expired"})
        raise HTTPException(410, "This invitation has expired")
    cid = invitation["cooperativeId"]
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop:
        raise HTTPException(404, "Cooperative is no longer available")
    existing = await member_repo.find_one({"cooperativeId": cid, "userId": uid, "deletedAt": None})
    now = datetime.utcnow()
    if existing and existing.get("status") == "active":
        await cooperative_repo.update({"_id": iid}, {"status": "accepted", "respondedAt": now})
        return {"success": True, "message": "You are already a member of this cooperative"}
    if existing:
        await member_repo.collection.update_one(
            {"_id": existing["_id"]},
            {"$set": {"status": "active", "role": "member", "joinedAt": now, "approvedAt": now, "deletedAt": None}},
        )
    else:
        await member_repo.create({
            "cooperativeId": cid,
            "userId": uid,
            "role": "member",
            "status": "active",
            "joinedAt": now,
            "approvedAt": now,
            "deletedAt": None,
        })
    await cooperative_repo.update({"_id": iid}, {"status": "accepted", "respondedAt": now})
    return {"success": True, "data": {"cooperativeId": str(cid)}, "message": f"You joined {coop.get('name', 'the cooperative')}"}


@router.post("/invitations/{invitation_id}/reject")
async def reject_cooperative_invitation(
    invitation_id: str,
    current_user: dict = Depends(get_current_user),
):
    _require_farmer(current_user)
    iid = _oid(invitation_id, "invitation id")
    uid = _oid(current_user["_id"], "farmer id")
    invitation = await cooperative_repo.find_one({
        "_id": iid,
        "type": "invitation",
        "farmerId": uid,
        "status": "pending",
        "deletedAt": None,
    })
    if not invitation:
        raise HTTPException(404, "Invitation not found or already handled")
    await cooperative_repo.update({"_id": iid}, {"status": "rejected", "respondedAt": datetime.utcnow()})
    return {"success": True, "message": "Cooperative invitation rejected"}


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
    source = data.source.strip().lower() or "manual"
    if source not in {"manual", "qr"}:
        raise HTTPException(400, "Invalid cooperative join source")
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

    now = datetime.utcnow()
    if existing:
        await member_repo.collection.update_one({"_id": existing["_id"]}, {"$set": {"status": "pending", "requestedAt": now, "joinSource": source, "joinInviteCode": code, "deletedAt": None}})
    else:
        await member_repo.create({"cooperativeId": coop["_id"], "userId": uid, "role": "member", "status": "pending", "requestedAt": now, "joinSource": source, "joinInviteCode": code, "deletedAt": None})
    return {"success": True, "data": _public(coop), "message": f"Join request sent to {coop.get('name')}. Waiting for manager approval."}


@router.post("/{cooperative_id}/join-request")
async def request_to_join_cooperative(cooperative_id: str, current_user: dict = Depends(get_current_user)):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id"); uid = _oid(current_user["_id"], "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop: raise HTTPException(404, "Cooperative not found")
    if str(coop.get("managerId")) == str(uid): raise HTTPException(400, "You already manage this cooperative")
    existing = await member_repo.find_one({"cooperativeId": cid, "userId": uid, "deletedAt": None})
    if existing and existing.get("status") == "active": return {"success": True, "message": "You are already a member"}
    now = datetime.utcnow()
    if existing:
        await member_repo.collection.update_one({"_id": existing["_id"]}, {"$set": {"status": "pending", "requestedAt": now, "deletedAt": None}})
    else:
        await member_repo.create({"cooperativeId": cid, "userId": uid, "role": "member", "status": "pending", "requestedAt": now, "deletedAt": None})
    return {"success": True, "data": _public(coop), "message": f"Join request sent to {coop.get('name')}. Waiting for manager approval."}


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


@router.get("/{cooperative_id}/join-requests")
async def cooperative_join_requests(cooperative_id: str, current_user: dict = Depends(get_current_user)):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id"); uid = _oid(current_user["_id"], "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop or str(coop.get("managerId")) != str(uid): raise HTTPException(403, "Only the cooperative manager can view join requests")
    return {"success": True, "data": {"requests": await _get_members(cid, include_pending=True)}}


@router.post("/{cooperative_id}/join-requests/approve")
async def approve_join_request(cooperative_id: str, data: ManagerAction, current_user: dict = Depends(get_current_user)):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id"); uid = _oid(current_user["_id"], "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop or str(coop.get("managerId")) != str(uid): raise HTTPException(403, "Only the cooperative manager can approve members")
    target = _oid(data.userId, "farmer id")
    result = await member_repo.collection.update_one({"cooperativeId": cid, "userId": target, "status": "pending", "deletedAt": None}, {"$set": {"status": "active", "joinedAt": datetime.utcnow(), "approvedAt": datetime.utcnow(), "deletedAt": None}})
    if not result.modified_count: raise HTTPException(404, "Pending join request not found")
    target_user = await user_repo.find_one({"_id": target})
    target_name = "{} {}".format((target_user or {}).get("firstName", ""), (target_user or {}).get("lastName", "")).strip() or "A farmer"
    await _create_cooperative_system_message(cid, f"{target_name} joined the cooperative.")
    return {"success": True, "message": "Farmer approved and added to the cooperative"}


@router.post("/{cooperative_id}/join-requests/reject")
async def reject_join_request(cooperative_id: str, data: ManagerAction, current_user: dict = Depends(get_current_user)):
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id"); uid = _oid(current_user["_id"], "farmer id")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    if not coop or str(coop.get("managerId")) != str(uid): raise HTTPException(403, "Only the cooperative manager can reject members")
    target = _oid(data.userId, "farmer id")
    result = await member_repo.collection.update_one({"cooperativeId": cid, "userId": target, "status": "pending", "deletedAt": None}, {"$set": {"status": "rejected", "rejectedAt": datetime.utcnow(), "deletedAt": datetime.utcnow()}})
    if not result.modified_count: raise HTTPException(404, "Pending join request not found")
    return {"success": True, "message": "Join request rejected"}


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




@router.get("/dashboard/{cooperative_id}")
async def cooperative_dashboard(cooperative_id: str, current_user: dict = Depends(get_current_user)):
    """Return live cooperative production, inventory, orders, distribution and earnings."""
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    membership = await member_repo.find_one({"cooperativeId": cid, "userId": uid, "status": "active", "deletedAt": None})
    if not membership:
        raise HTTPException(403, "You are not a member of this cooperative")
    coop = await cooperative_repo.find_one({"_id": cid, "status": "active", "deletedAt": None})
    member_ids = await _member_ids(cid)
    stock = await _stock_for_farmers(member_ids)

    plans = await harvest_plan_repo.find_many({"farmerId": {"$in": member_ids}, "deletedAt": None}, limit=1000, sort=[("expectedHarvestDate", 1)])
    production_rows = []
    expected_kg = harvested_kg = 0.0
    active_plan_count = cancelled_plan_count = 0
    for plan in plans:
        expected = float(plan.get("expectedQuantityKg") or 0)
        actual = float(plan.get("actualQuantityKg") or 0)
        raw_status = str(plan.get("status") or plan.get("stage") or "planned").strip().lower()
        is_cancelled = raw_status in {"cancelled", "canceled", "rejected", "deleted"}
        if is_cancelled:
            cancelled_plan_count += 1
        else:
            active_plan_count += 1
            expected_kg += expected
        harvested_kg += actual
        display_status = "harvest_update_required" if raw_status in {"harvested", "completed"} and actual <= 0 else raw_status
        farmer_id = str(plan.get("farmerId") or "")
        farmer_user = await user_repo.find_one({"_id": plan.get("farmerId")}) if plan.get("farmerId") else None
        farmer_name = f"{(farmer_user or {}).get('firstName', '')} {(farmer_user or {}).get('lastName', '')}".strip() or (farmer_user or {}).get("email") or "Cooperative farmer"
        production_rows.append({"id": str(plan["_id"]), "farmerId": farmer_id, "farmerName": farmer_name, "isMine": farmer_id == str(uid), "cropName": plan.get("cropName") or plan.get("crop") or "Crop", "expectedQuantityKg": round(expected, 2), "actualQuantityKg": round(actual, 2), "expectedHarvestDate": plan.get("expectedHarvestDate"), "status": display_status, "isCancelled": is_cancelled})

    batches = await batch_repo.find_many({"farmerId": {"$in": member_ids}, "deletedAt": None}, limit=1000)
    batch_counts = {}
    for b in batches:
        status = str(b.get("qualityStatus") or b.get("status") or "pending")
        batch_counts[status] = batch_counts.get(status, 0) + 1

    orders = await order_repo.find_many({"farmerId": {"$in": member_ids}, "deletedAt": None}, limit=2000, sort=[("createdAt", -1)])
    order_summary = {"total": len(orders), "pending": 0, "processing": 0, "inTransit": 0, "delivered": 0, "completed": 0, "revenue": 0.0}
    order_rows = []
    order_ids = []
    for order in orders:
        status = str(order.get("orderStatus") or "pending")
        key = {"pending": "pending", "confirmed": "pending", "processing": "processing", "ready_for_delivery": "processing", "ready_for_pickup": "processing", "dispatched": "inTransit", "in_transit": "inTransit", "delivered": "delivered", "completed": "completed"}.get(status)
        if key:
            order_summary[key] += 1
        if status in ("delivered", "completed"):
            order_summary["revenue"] += float(order.get("totalAmount") or 0)
        order_ids.append(order["_id"])
        order_rows.append({"id": str(order["_id"]), "orderNumber": order.get("orderNumber"), "farmerId": str(order.get("farmerId")), "status": status, "totalAmount": float(order.get("totalAmount") or 0), "createdAt": order.get("createdAt") or order.get("orderDate")})

    assignments = await delivery_assignment_repo.find_many({"orderId": {"$in": order_ids}, "deletedAt": None}, limit=2000) if order_ids else []
    distribution = {"total": len(assignments), "assigned": 0, "pickedUp": 0, "inTransit": 0, "delivered": 0, "failed": 0}
    for assignment in assignments:
        status = str(assignment.get("status") or "").lower()
        if "assign" in status or "accept" in status: distribution["assigned"] += 1
        elif "pickup" in status: distribution["pickedUp"] += 1
        elif "transit" in status: distribution["inTransit"] += 1
        elif "deliver" in status or status == "completed": distribution["delivered"] += 1
        elif "fail" in status or "cancel" in status: distribution["failed"] += 1

    allocations = await cooperative_allocation_repo.find_many({"cooperativeId": cid, "deletedAt": None}, limit=2000, sort=[("createdAt", -1)])
    allocated_kg = round(sum(float(x.get("quantityKg") or 0) for x in allocations), 2)
    return {"success": True, "data": {"cooperativeId": str(cid), "role": "manager" if str((coop or {}).get("managerId")) == str(uid) else "member", "production": {"plans": production_rows, "activePlans": active_plan_count, "cancelledPlans": cancelled_plan_count, "expectedKg": round(expected_kg, 2), "harvestedKg": round(harvested_kg, 2), "batchCounts": batch_counts}, "inventory": {k: v for k, v in stock.items() if k != "farmerAvailableKg"}, "orders": {"summary": order_summary, "recent": order_rows[:20]}, "distribution": distribution, "earnings": {"grossSales": round(order_summary["revenue"], 2), "allocatedB2BKg": allocated_kg}, "reports": {"members": len(member_ids), "productionPlans": len(plans), "batches": len(batches), "products": stock["productCount"], "orders": len(orders), "deliveries": len(assignments)}}}


class CooperativeMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)
    replyTo: str | None = Field(default=None, max_length=64)


async def _create_cooperative_system_message(cooperative_id: ObjectId, content: str) -> None:
    now = datetime.utcnow()
    await cooperative_message_repo.create({
        "cooperativeId": cooperative_id,
        "senderId": None,
        "senderName": "AgriConnect",
        "messageType": "system",
        "content": content[:1000],
        "createdAt": now,
        "deletedAt": None,
    })


@router.get("/{cooperative_id}/messages")
async def list_cooperative_messages(
    cooperative_id: str,
    limit: int = Query(60, ge=1, le=100),
    before: str | None = Query(None, max_length=64),
    current_user: dict = Depends(get_current_user),
):
    """List recent group messages. Only active cooperative members can read them."""
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    membership = await member_repo.find_one({
        "cooperativeId": cid, "userId": uid, "status": "active", "deletedAt": None
    })
    if not membership:
        raise HTTPException(403, "Only active cooperative members can view group messages")
    query: Dict[str, Any] = {"cooperativeId": cid, "deletedAt": None}
    if before:
        try:
            cursor_message = await cooperative_message_repo.find_one({"_id": ObjectId(before), "cooperativeId": cid})
        except Exception:
            cursor_message = None
        if not cursor_message:
            raise HTTPException(400, "Invalid message cursor")
        query["createdAt"] = {"$lt": cursor_message.get("createdAt")}
    messages = await cooperative_message_repo.find_many(query, limit=limit, sort=[("createdAt", -1)])
    messages.reverse()
    sender_ids = []
    for message in messages:
        sender = message.get("senderId")
        if isinstance(sender, ObjectId):
            sender_ids.append(sender)
    senders = await user_repo.find_many({"_id": {"$in": sender_ids}}, limit=100) if sender_ids else []
    sender_by_id = {str(user["_id"]): user for user in senders}
    rows = []
    for message in messages:
        sender_id = message.get("senderId")
        sender = sender_by_id.get(str(sender_id), {}) if sender_id else {}
        rows.append({
            "id": str(message["_id"]),
            "senderId": str(sender_id) if sender_id else None,
            "senderName": message.get("senderName") or (f"{sender.get('firstName', '')} {sender.get('lastName', '')}".strip() or "Farmer"),
            "messageType": message.get("messageType", "text"),
            "content": message.get("content", ""),
            "createdAt": message.get("createdAt"),
            "replyTo": message.get("replyTo"),
            "isMine": str(sender_id) == str(uid) if sender_id else False,
        })
    return {"success": True, "data": {"messages": rows, "hasMore": len(rows) == limit}}


@router.post("/{cooperative_id}/messages", status_code=201)
async def send_cooperative_message(
    cooperative_id: str,
    data: CooperativeMessageCreate,
    current_user: dict = Depends(get_current_user),
):
    """Send a text message to the cooperative's private group."""
    _require_farmer(current_user)
    cid = _oid(cooperative_id, "cooperative id")
    uid = _oid(current_user["_id"], "farmer id")
    membership = await member_repo.find_one({
        "cooperativeId": cid, "userId": uid, "status": "active", "deletedAt": None
    })
    if not membership:
        raise HTTPException(403, "Only active cooperative members can send group messages")
    content = data.content.strip()
    if not content:
        raise HTTPException(400, "Message cannot be empty")
    now = datetime.utcnow()
    sender_name = f"{current_user.get('firstName', '')} {current_user.get('lastName', '')}".strip() or "Farmer"
    message_id = await cooperative_message_repo.create({
        "cooperativeId": cid,
        "senderId": uid,
        "senderName": sender_name,
        "messageType": "text",
        "content": content,
        "replyTo": data.replyTo,
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    })
    if not message_id:
        raise HTTPException(500, "Could not send message")
    return {"success": True, "data": {"id": str(message_id), "senderId": str(uid), "senderName": sender_name, "messageType": "text", "content": content, "createdAt": now, "replyTo": data.replyTo}}


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
    if result:
        now = datetime.utcnow()
        await cooperative_allocation_repo.create({"cooperativeId": cid, "managerId": uid, "allocations": result, "quantityKg": round(sum(x["quantityKg"] for x in result), 2), "status": "approved", "createdAt": now, "updatedAt": now, "deletedAt": None})
        await _create_cooperative_system_message(cid, f"Manager recorded a cooperative supply allocation of {round(sum(x['quantityKg'] for x in result), 2)} kg. Check Inventory for the farmer-wise breakdown.")
    return {"success": True, "data": {"cooperativeId": str(cid), "allocations": result, "totalQuantityKg": round(sum(x["quantityKg"] for x in result), 2), "status": "approved"}}
