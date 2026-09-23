from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from app.api.v1.auth import get_current_user
from app.schemas.analytics import (
    AnalyticsOverviewResponse,
    AnalyticsTrendPoint,
    AnalyticsMetricItem,
    FarmerAnalyticsResponse,
    WarehouseAnalyticsResponse
)
from app.services.analytics_service import AnalyticsService
from app.repositories.delivery_assignment_repository import delivery_assignment_repository
from app.repositories.delivery_repository import delivery_repository
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/delivery")
async def get_delivery_analytics(current_user: dict = Depends(get_current_user)):
    """Live delivery operations metrics for the admin dashboard."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges are required")

    base = {"deletedAt": None}
    counts = {}
    for delivery_status in ["assigned", "accepted", "picked_up", "in_transit", "delivered", "failed", "cancelled"]:
        counts[delivery_status] = await delivery_assignment_repository.count({**base, "status": delivery_status})

    total_assignments = sum(counts.values())
    active_partners = await delivery_repository.count({
        "deletedAt": None,
        "isAvailable": True,
        "status": {"$in": ["available", "busy"]},
    })
    completed = counts.get("delivered", 0)
    failed = counts.get("failed", 0)
    completion_rate = round((completed / total_assignments) * 100, 1) if total_assignments else 0

    return {
        "success": True,
        "data": {
            "totalAssignments": total_assignments,
            "activeDeliveries": sum(counts.get(key, 0) for key in ["assigned", "accepted", "picked_up", "in_transit"]),
            "delivered": completed,
            "failed": failed,
            "completionRate": completion_rate,
            "activePartners": active_partners,
            "byStatus": counts,
        },
    }

@router.get("/overview", response_model=AnalyticsOverviewResponse)
async def get_platform_overview(
    fromDate: Optional[datetime] = Query(None),
    toDate: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges are required"
        )
    return await AnalyticsService.get_platform_overview(fromDate, toDate)

@router.get("/sales/trends", response_model=List[AnalyticsTrendPoint])
async def get_sales_trends(
    fromDate: Optional[datetime] = Query(None),
    toDate: Optional[datetime] = Query(None),
    interval: str = Query("day", pattern="^(day|month)$"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges are required"
        )
    return await AnalyticsService.get_sales_trends(fromDate, toDate, interval)

@router.get("/top-products", response_model=List[AnalyticsMetricItem])
async def get_top_products(
    limit: int = Query(10, ge=1, le=50),
    fromDate: Optional[datetime] = Query(None),
    toDate: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges are required"
        )
    return await AnalyticsService.get_top_products(fromDate, toDate, limit)

@router.get("/top-farmers", response_model=List[AnalyticsMetricItem])
async def get_top_farmers(
    limit: int = Query(10, ge=1, le=50),
    fromDate: Optional[datetime] = Query(None),
    toDate: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges are required"
        )
    return await AnalyticsService.get_top_farmers(fromDate, toDate, limit)

@router.get("/farmers/{farmer_id}", response_model=FarmerAnalyticsResponse)
async def get_farmer_analytics(
    farmer_id: str,
    fromDate: Optional[datetime] = Query(None),
    toDate: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin" and str(current_user.get("_id")) != farmer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this farmer's analytics"
        )
    return await AnalyticsService.get_farmer_analytics(farmer_id, fromDate, toDate)

@router.get("/warehouses/{warehouse_id}", response_model=WarehouseAnalyticsResponse)
async def get_warehouse_analytics(
    warehouse_id: str,
    fromDate: Optional[datetime] = Query(None),
    toDate: Optional[datetime] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges are required"
        )
    return await AnalyticsService.get_warehouse_analytics(warehouse_id, fromDate, toDate)
