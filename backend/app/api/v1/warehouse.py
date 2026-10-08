    notes: Optional[str] = None


class PickupRouteCreateRequest(BaseModel):
    collectionIds: List[str] = Field(default_factory=list)
    maxWeightKg: float = Field(0, ge=0)


class PickupRouteAssignRequest(BaseModel):
    deliveryPartnerId: str = Field(..., min_length=1)


@router.get("/me/pickup-team/applications")
async def get_pickup_team_applications(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can manage pickup teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    apps = await warehouse_pickup_team_repository.get_applications(str(warehouse["_id"]), status_filter)
    for item in apps:
        item["id"] = str(item["_id"])
        item["deliveryPartnerId"] = str(item["deliveryPartnerId"])
        try:
            user = await UserService.get_user_by_id(str(item.get("userId") or item["deliveryPartnerId"]))
            if user:
                item["name"] = (f"{user.get('firstName','')} {user.get('lastName','')}").strip() or user.get("name") or "Delivery Partner"
                item["phone"] = user.get("phone")
        except Exception:
            item["name"] = "Delivery Partner"
    return {"success": True, "data": {"applications": apps}}


@router.put("/me/pickup-team/applications/{application_id}")
async def review_pickup_team_application(
    application_id: str,
    decision: str = Query(..., pattern="^(approve|reject)$"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can review pickup team applications")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    apps = await warehouse_pickup_team_repository.get_applications(str(warehouse["_id"]), "pending")
    app = next((x for x in apps if str(x["_id"]) == application_id), None)
    if not app:
        raise HTTPException(status_code=404, detail="Pickup team application not found")
    now = datetime.utcnow()
    update = {
        "status": "approved" if decision == "approve" else "rejected",
        "reviewedAt": now,
        "reviewedBy": ObjectId(str(current_user["_id"])),
    }
    if decision == "approve":
        update["approvedAt"] = now
    await warehouse_pickup_team_repository.update_application(application_id, update)
    return {"success": True, "message": "Pickup team member approved" if decision == "approve" else "Application rejected"}


@router.get("/me/pickup-team/members")
async def get_pickup_team_members(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access pickup team")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    members = await warehouse_pickup_team_repository.get_approved_members(str(warehouse["_id"]))
    result = []
    for x in members:
        item = {**x, "id": str(x["_id"]), "deliveryPartnerId": str(x["deliveryPartnerId"])}
        try:
            user = await UserService.get_user_by_id(str(x.get("userId") or x["deliveryPartnerId"]))
            if user:
                item["name"] = (f"{user.get('firstName','')} {user.get('lastName','')}").strip() or user.get("name") or "Delivery Partner"
                item["phone"] = user.get("phone")
        except Exception:
            item["name"] = "Delivery Partner"
        result.append(item)
    return {"success": True, "data": {"members": result}}


@router.post("/me/pickup-routes")
async def create_pickup_routes(
    data: PickupRouteCreateRequest,
    current_user: dict = Depends(get_current_user)
):