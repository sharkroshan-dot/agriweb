"""District-based routing and authorization for farmer quality inspections."""
from typing import Any, Dict, Optional, Tuple
from fastapi import HTTPException
from app.repositories.farmer_repository import farmer_repository
from app.repositories.warehouse_repository import warehouse_repository
from app.services.warehouse_collection_service import (
    farmer_collection_district,
    warehouse_collection_districts,
)


async def resolve_quality_inspection_warehouse(
    farmer_id: Any,
    batch: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], str]:
    """Resolve exactly one active warehouse configured for the farmer's district.

    No nearest-warehouse or arbitrary fallback is allowed: quality evidence must
    be reviewed by the warehouse explicitly responsible for that farm district.
    """
    farmer_profile = await farmer_repository.get_by_user_id(str(farmer_id)) if farmer_id else None
    if not farmer_profile and farmer_id:
        farmer_profile = await farmer_repository.get_by_id(str(farmer_id))
    if not farmer_profile:
        raise HTTPException(
            status_code=409,
            detail="Cannot route quality inspection: farmer profile is missing.",
        )

    pickup_location = (
        farmer_profile.get("farmLocation")
        or farmer_profile.get("farmAddress")
        or farmer_profile.get("location")
        or farmer_profile.get("address")
        or (batch or {}).get("farmLocation")
        or (batch or {}).get("pickupLocation")
        or {}
    )

    warehouses = await warehouse_repository.get_all_warehouses(is_active=True, limit=1000)
    coverage_by_id = {}
    all_configured_districts = set()
    for warehouse in warehouses:
        districts = warehouse_collection_districts(warehouse)
        coverage_by_id[str(warehouse["_id"])] = districts
        all_configured_districts.update(districts)

    if not all_configured_districts:
        raise HTTPException(
            status_code=409,
            detail="No active warehouse has a configured farm-collection district. Configure warehouse district coverage before submitting quality evidence.",
        )

    farmer_district = farmer_collection_district(
        farmer_profile,
        pickup_location,
        all_configured_districts,
    )
    if not farmer_district:
        raise HTTPException(
            status_code=409,
            detail="Cannot determine the farmer's district or match it to an active warehouse. Update the farmer's farm district/address and warehouse district coverage.",
        )

    matches = [
        warehouse for warehouse in warehouses
        if farmer_district in coverage_by_id.get(str(warehouse["_id"]), set())
    ]
    if not matches:
        raise HTTPException(
            status_code=409,
            detail=f"No active warehouse is assigned to the farmer's district ({farmer_district}). Configure an active warehouse for this district.",
        )
    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"Multiple active warehouses are configured for {farmer_district}. Each district must have exactly one receiving warehouse.",
        )

    return matches[0], farmer_district


async def require_assigned_warehouse_access(
    inspection: Dict[str, Any],
    current_user: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Admins retain oversight; warehouse accounts are restricted to their assignment."""
    if current_user.get("role") == "admin":
        return None
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only the assigned warehouse or an admin can process this inspection.")

    warehouse = await warehouse_repository.get_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=403, detail="No warehouse is assigned to this account.")

    assigned_id = inspection.get("assignedWarehouseId")
    if not assigned_id:
        raise HTTPException(
            status_code=409,
            detail="This inspection has no receiving warehouse assignment. Ask an admin to resolve its district routing before processing.",
        )
    if str(assigned_id) != str(warehouse["_id"]):
        raise HTTPException(status_code=403, detail="This inspection belongs to another district's warehouse.")

    return warehouse
