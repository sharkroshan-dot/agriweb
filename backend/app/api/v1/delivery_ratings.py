from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import Optional

from app.api.v1.auth import get_current_user
from app.schemas.delivery_rating import DeliveryRatingCreate, DeliveryRatingSummary
from app.services.delivery_rating_service import delivery_rating_service
from app.repositories.delivery_repository import delivery_repository

router = APIRouter()


def _require_customer(current_user: dict):
    if current_user.get("role") != "customer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can rate delivery partners"
        )


def _require_admin(current_user: dict):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )


@router.post("/", status_code=status.HTTP_201_CREATED)
@router.post("", status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def submit_rating(
    data: DeliveryRatingCreate,
    current_user: dict = Depends(get_current_user)
):
    """Submit a delivery partner rating for a delivered order (customer only).

    One rating per order - submitting twice for the same order returns 409.
    """
    _require_customer(current_user)
    rating = await delivery_rating_service.submit_rating(
        str(current_user["_id"]),
        data.orderId,
        data
    )
    return {
        "success": True,
        "message": "Thanks! Your delivery partner rating has been submitted.",
        "data": rating
    }


@router.get("/me")
async def get_my_ratings(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """List the delivery partner ratings submitted by the current customer."""
    _require_customer(current_user)
    result = await delivery_rating_service.get_customer_ratings(
        str(current_user["_id"]),
        page=page,
        limit=limit
    )
    return {"success": True, "data": result}


@router.get("/order/{order_id}")
async def get_order_rating_status(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Return whether the current customer has rated the partner for an order."""
    _require_customer(current_user)
    from app.repositories.delivery_rating_repository import delivery_rating_repository
    rating = await delivery_rating_repository.get_by_order(order_id)
    if not rating or str(rating.get("customerId")) != str(current_user["_id"]):
        return {"success": True, "data": {"rated": False}}
    return {
        "success": True,
        "data": {
            "rated": True,
            "id": str(rating["_id"]),
            "overallRating": rating.get("overallRating", 0),
            "onTimeRating": rating.get("onTimeRating", 0),
            "professionalismRating": rating.get("professionalismRating", 0),
            "handlingRating": rating.get("handlingRating", 0),
            "communicationRating": rating.get("communicationRating", 0),
            "feedback": rating.get("feedback"),
        }
    }


@router.get("/partner/me")
async def get_my_partner_ratings(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """Delivery partner view of their own ratings (no customer PII)."""
    if current_user.get("role") != "delivery":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners can access this endpoint"
        )
    profile = await delivery_repository.get_by_user_id(str(current_user["_id"]))
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delivery partner profile not found"
        )
    result = await delivery_rating_service.get_partner_ratings(
        str(profile["_id"]),
        page=page,
        limit=limit
    )
    return {"success": True, "data": result}


@router.get("/admin")
async def admin_list_ratings(
    partnerId: Optional[str] = Query(None, alias="partnerId"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """Admin listing of all delivery partner ratings."""
    _require_admin(current_user)
    result = await delivery_rating_service.list_for_admin(
        partner_id=partnerId,
        page=page,
        limit=limit
    )
    return {"success": True, "data": result}


@router.delete("/{rating_id}")
async def admin_delete_rating(
    rating_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Admin can remove an inappropriate delivery partner rating."""
    _require_admin(current_user)
    result = await delivery_rating_service.delete_rating(rating_id)
    return {"success": True, **result}
