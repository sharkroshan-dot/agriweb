from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from datetime import datetime
from bson import ObjectId
import logging
from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.services.marketplace_service import MarketplaceService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/nearby")
async def get_nearby_products(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: int = Query(10, ge=2, le=50),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if not lat or not lng:
        return {"success": True, "data": {"farmers": [], "count": 0, "message": "Location not provided. Please enable location services."}}

    if not current_user:
        return {"success": True, "data": {"farmers": [], "count": 0, "message": "Please login to see nearby products."}}

    result = await MarketplaceService.get_products_nearby(lat, lng, radius, category, search)
    return {"success": True, "data": result}


@router.get("/state")
async def get_state_products(
    state: str = Query(..., description="State name"),
    district: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    country: Optional[str] = Query(None, description="Country name"),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    result = await MarketplaceService.get_products_by_state(state, district, city, country, category, search, page, limit)
    return {"success": True, "data": result}


@router.get("/national")
async def get_national_products(
    country: Optional[str] = Query(None, description="Country name"),
    state: Optional[str] = Query(None),
    district: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: str = Query("createdAt", alias="sortBy"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    result = await MarketplaceService.get_products_national(country, state, district, city, category, sort_by, search, page, limit)
    return {"success": True, "data": result}


@router.get("/country-list")
async def list_countries():
    result = await MarketplaceService.get_country_list()
    return {"success": True, "data": result}


@router.get("/state-list")
async def list_states(
    country: Optional[str] = Query(None, description="Country name")
):
    result = await MarketplaceService.get_state_list(country)
    return {"success": True, "data": result}


@router.get("/district-list")
async def list_districts(
    country: Optional[str] = Query(None, description="Country name"),
    state: str = Query(..., description="State name")
):
    result = await MarketplaceService.get_district_list(country, state)
    return {"success": True, "data": result}


@router.get("/city-list")
async def list_cities(
    state: str = Query(..., description="Indian state name"),
    district: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    result = await MarketplaceService.get_city_list(state, district)
    return {"success": True, "data": result}


@router.get("/farmer-nearby")
async def get_nearby_customers_for_farmer(
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius: int = Query(10, ge=2, le=50),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "farmer":
        raise HTTPException(status_code=403, detail="Only farmers can access this endpoint")

    if not lat or not lng:
        return {"success": True, "data": {"customers": [], "groups": [], "count": 0, "message": "Location not provided."}}

    result = await MarketplaceService.get_nearby_customers(str(current_user["_id"]), lat, lng, radius)
    return {"success": True, "data": result}
