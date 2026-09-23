from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel
from typing import Optional
from bson import ObjectId
from datetime import datetime
from app.api.v1.auth import get_current_user
from app.repositories.wishlist_repository import wishlist_repository
from app.repositories.product_repository import product_repository
from app.repositories.user_repository import user_repository
from app.repositories.payment_repository import payment_repository
from app.repositories.order_repository import order_repository
from app.repositories.product_review_repository import product_review_repository
from app.services.product_alert_service import product_alert_service, VALID_ALERT_TYPES

router = APIRouter()


class ProductAlertCreate(BaseModel):
    alertType: str
    targetPrice: Optional[float] = None



def _require_customer(current_user: dict) -> None:
    if current_user.get("role") != "customer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can access this endpoint",
        )


@router.get("/me/dashboard")
async def customer_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only customers can access this dashboard")

    wishlist_count = await wishlist_repository.count_by_user(str(current_user["_id"]))

    return {
        "success": True,
        "data": {
            "roles": ["customer"],
            "marketplace": ["nearby", "district", "state", "national"],
            "activeOrders": 2,
            "wishlist": wishlist_count,
        },
    }


@router.get("/me/wishlist")
async def get_wishlist(current_user: dict = Depends(get_current_user)):
    """List the current customer's wishlist products (newest first)."""
    _require_customer(current_user)

    items = await wishlist_repository.get_by_user(str(current_user["_id"]))
    if not items:
        return {"success": True, "data": []}

    product_ids = [str(item["productId"]) for item in items]
    products = await product_repository.find_many({"_id": {"$in": [ObjectId(pid) for pid in product_ids]}})
    products = [p for p in products if not p.get("deletedAt")]
    product_map = {str(p["_id"]): p for p in products}

    farmer_ids = {str(p["farmerId"]) for p in products if p.get("farmerId")}
    farmers = await user_repository.find_many(
        {"_id": {"$in": [ObjectId(fid) for fid in farmer_ids]}}
    ) if farmer_ids else []
    farmer_map = {str(f["_id"]): f for f in farmers}

    result = []
    for item in items:
        pid = str(item["productId"])
        product = product_map.get(pid)
        if not product:
            continue
        farmer = farmer_map.get(str(product.get("farmerId")))
        farmer_name = "Local Farmer"
        if farmer:
            name = f"{farmer.get('firstName', '')} {farmer.get('lastName', '')}".strip()
            if name:
                farmer_name = name
        images = product.get("images") or []
        quantity = product.get("quantity", 0)
        result.append({
            "id": pid,
            "name": product.get("name"),
            "price": product.get("price"),
            "unit": product.get("unit"),
            "images": images,
            "image": images[0] if images else "/images/placeholder.jpg",
            "farmerId": str(product.get("farmerId")) if product.get("farmerId") else None,
            "farmerName": farmer_name,
            "quantity": quantity,
            "inStock": quantity > 0,
            "rating": (product.get("ratings") or {}).get("average") or 0,
            "pickupAvailable": product.get("pickupAvailable", False),
            "farmAddress": product.get("farmAddress", ""),
            "wishlistedAt": item.get("createdAt"),
        })

    return {"success": True, "data": result}


@router.post("/me/wishlist/{product_id}")
async def add_to_wishlist(product_id: str, current_user: dict = Depends(get_current_user)):
    """Add a product to the current customer's wishlist."""
    _require_customer(current_user)

    try:
        product = await product_repository.find_one({"_id": ObjectId(product_id), "deletedAt": None})
    except Exception:
        product = None
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    await wishlist_repository.add(str(current_user["_id"]), product_id)
    return {"success": True, "message": "Added to wishlist"}


@router.delete("/me/wishlist/{product_id}")
async def remove_from_wishlist(product_id: str, current_user: dict = Depends(get_current_user)):
    """Remove a product from the current customer's wishlist."""
    _require_customer(current_user)

    await wishlist_repository.remove(str(current_user["_id"]), product_id)
    return {"success": True, "message": "Removed from wishlist"}


@router.get("/me/alerts")
async def get_my_alerts(current_user: dict = Depends(get_current_user)):
    """List the current customer's active product alerts."""
    _require_customer(current_user)

    alerts = await product_alert_service.get_alerts(str(current_user["_id"]))
    return {"success": True, "data": alerts}


@router.post("/me/alerts/{product_id}")
async def create_product_alert(
    product_id: str,
    data: ProductAlertCreate,
    current_user: dict = Depends(get_current_user)
):
    """Subscribe the current customer to a back-in-stock or price-drop alert."""
    _require_customer(current_user)

    if data.alertType not in VALID_ALERT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="alertType must be 'back_in_stock' or 'price_drop'",
        )
    if data.alertType == "price_drop" and data.targetPrice is not None and data.targetPrice <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="targetPrice must be greater than zero",
        )

    try:
        product = await product_repository.find_one({"_id": ObjectId(product_id), "deletedAt": None})
    except Exception:
        product = None
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    alert = await product_alert_service.subscribe(
        str(current_user["_id"]),
        product_id,
        data.alertType,
        data.targetPrice,
    )
    if not alert:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create alert")

    return {"success": True, "data": alert}


@router.delete("/me/alerts/{alert_id}")
async def delete_product_alert(alert_id: str, current_user: dict = Depends(get_current_user)):
    """Remove one of the current customer's product alerts."""
    _require_customer(current_user)

    success = await product_alert_service.unsubscribe(str(current_user["_id"]), alert_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

    return {"success": True, "message": "Alert removed"}


def _payment_to_dict(payment: dict) -> dict:
    """Normalize a raw payment document for customer-facing responses."""
    return {
        "id": str(payment["_id"]),
        "orderId": str(payment.get("orderId", "")),
        "amount": payment.get("amount", 0),
        "currency": payment.get("currency", "INR"),
        "paymentMethod": payment.get("paymentMethod", ""),
        "status": payment.get("status", "pending"),
        "transactionId": str(payment.get("transactionId", "")) if payment.get("transactionId") else None,
        "refundAmount": payment.get("refundAmount"),
        "refundId": str(payment.get("refundId", "")) if payment.get("refundId") else None,
        "refundedAt": payment.get("refundedAt"),
        "paymentDate": payment.get("paymentDate"),
        "createdAt": payment.get("createdAt"),
    }


@router.get("/me/payments")
async def get_my_payments(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """List the current customer's payments (newest first)."""
    _require_customer(current_user)

    skip = (page - 1) * limit
    payments = await payment_repository.get_by_user_id(str(current_user["_id"]), skip, limit)

    result = []
    for p in payments:
        item = _payment_to_dict(p)
        order = await order_repository.get_by_id(str(p.get("orderId", ""))) if p.get("orderId") else None
        if order:
            item["orderNumber"] = order.get("orderNumber", "")
            item["orderStatus"] = order.get("orderStatus", "")
            item["itemsCount"] = len(order.get("items", []) or [])
        result.append(item)

    return {
        "success": True,
        "data": result,
        "pagination": {"page": page, "limit": limit, "total": len(result)},
    }


@router.get("/me/refunds")
async def get_my_refunds(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """List the current customer's refunds & returns (newest first).

    Returns refund requests from the refunds collection (any status), and falls
    back to legacy fully-refunded payment documents for historical records.
    """
    _require_customer(current_user)

    from app.repositories.refund_repository import refund_repository
    from app.services.refund_service import RefundService

    skip = (page - 1) * limit
    refunds = await refund_repository.get_by_customer(str(current_user["_id"]), skip, limit)
    total = await refund_repository.count_filtered(customer_id=str(current_user["_id"]))

    result = []
    for r in refunds:
        s = await RefundService.serialize(r)
        if s:
            result.append(s)

    # If the new refunds collection has nothing yet (legacy data), show the
    # older payment-based refund records so customers still see history.
    if not result:
        payments = await payment_repository.get_by_user_id(str(current_user["_id"]), skip, limit)
        legacy = [p for p in payments if p.get("status") in ("refunded", "partially_refunded")]
        for p in legacy:
            item = _payment_to_dict(p)
            order = await order_repository.get_by_id(str(p.get("orderId", ""))) if p.get("orderId") else None
            if order:
                item["orderNumber"] = order.get("orderNumber", "")
                item["orderStatus"] = order.get("orderStatus", "")
                item["itemsCount"] = len(order.get("items", []) or [])
            item["type"] = "full" if p.get("status") == "refunded" else "partial"
            item["status"] = "refunded"
            item["reason"] = None
            item["affectedItems"] = []
            item["timeline"] = []
            result.append(item)

    return {
        "success": True,
        "data": result,
        "pagination": {"page": page, "limit": limit, "total": total or len(result)},
    }


@router.get("/me/reviews")
async def get_my_reviews(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """List reviews written by the current customer (newest first)."""
    _require_customer(current_user)

    skip = (page - 1) * limit
    total = await product_review_repository.count_by_user(str(current_user["_id"]))
    reviews = await product_review_repository.get_by_user(str(current_user["_id"]), skip, limit)

    product_ids = [str(r.get("productId", "")) for r in reviews if r.get("productId")]
    products = await product_repository.find_many(
        {"_id": {"$in": [ObjectId(pid) for pid in product_ids]}}
    ) if product_ids else []
    product_map = {str(p["_id"]): p for p in products}

    result = []
    for r in reviews:
        product = product_map.get(str(r.get("productId")))
        images = product.get("images") or [] if product else []
        result.append({
            "id": str(r["_id"]),
            "productId": str(r.get("productId", "")),
            "productName": product.get("name", "Product") if product else "Product",
            "productImage": images[0] if images else "/images/placeholder.jpg",
            "rating": r.get("rating", 0),
            "comment": r.get("comment", ""),
            "images": r.get("images") or [],
            "isVerifiedPurchase": r.get("isVerifiedPurchase", False),
            "createdAt": r.get("createdAt"),
        })

    return {
        "success": True,
        "data": result,
        "summary": {"totalReviews": total},
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": (total + limit - 1) // limit,
        },
    }
