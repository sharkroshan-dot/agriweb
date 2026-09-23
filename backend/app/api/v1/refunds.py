from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from typing import Optional, List
from app.api.v1.auth import get_current_user
from app.schemas.refund import (
    RefundResponse, RefundRequestCreate, CancelOrderRequest,
    RefundActionRequest, RefundRejectRequest, RefundType,
    RefundReason,
)
from app.services.refund_service import (
    RefundService, RefundNotFoundError, RefundNotEligibleError,
    RefundAlreadyProcessedError,
)
from app.services.order_service import OrderService
from app.schemas.order import OrderStatusUpdate
from app.repositories.refund_repository import refund_repository
from app.repositories.order_repository import order_repository
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


# ============== EVIDENCE UPLOAD ==============

import os
import uuid
from fastapi import UploadFile, File
from app.core.config import settings


@router.post("/upload")
async def upload_evidence(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload refund evidence (photos). Returns a URL to attach to a refund request.

    Files are validated by content and extension before being stored under the
    platform's uploads directory; the returned URL is served from ``/uploads``.
    """
    from app.utils.file_security import validate_upload, UploadValidationError

    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)

    content = await file.read()
    try:
        ext = validate_upload(
            file.filename or "file",
            content,
            content_type=file.content_type,
            max_bytes=settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
        )
    except UploadValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(upload_dir, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    url = f"/uploads/{filename}"
    return {"success": True, "data": {"url": url, "filename": filename, "evidence": url}}


# ============== ORDER LEVEL (cancel / report problem) ==============

@router.get("/orders/{order_id}/refunds", response_model=dict)
async def get_order_refunds(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List refund requests for a specific order (order owner / admin)."""
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only customers can view order refunds")

    order = await OrderService.get_order(order_id, str(current_user["_id"]), "customer")
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    refunds = await refund_repository.get_by_order_id(order_id)
    result = []
    for r in refunds:
        s = await RefundService.serialize(r)
        if s:
            result.append(s)
    return {"success": True, "data": result}


@router.get("/orders/{order_id}/eligibility")
async def get_refund_eligibility(
    order_id: str,
    type: str = Query("cancellation", description="cancellation or a problem refund type"),
    current_user: dict = Depends(get_current_user),
):
    """Return whether the current customer can cancel / request a refund.

    Read-only eligibility preview used by the customer dashboard to decide
    which buttons to show. The backend is authoritative: the estimated refund
    amount is computed from the order, payment and policy - never from the
    client.
    """
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only customers can view refund eligibility")

    order = await OrderService.get_order(order_id, str(current_user["_id"]), "customer")
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    eligibility = await RefundService.get_eligibility(order, refund_type=type)
    return {"success": True, "data": eligibility}


@router.post("/orders/{order_id}/cancel")
async def cancel_order_with_refund(
    order_id: str,
    data: CancelOrderRequest = Body(default=CancelOrderRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Cancel an order and start the refund lifecycle when paid.

    The customer picks a cancellation reason. The backend decides eligibility
    from the order state and refund policy; the refund amount is computed
    server-side. Auto-eligible early cancellations are refunded immediately,
    later-stage cancellations enter review (the order is only cancelled once
    the refund is approved).
    """
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only customers can cancel orders")

    order = await OrderService.get_order(order_id, str(current_user["_id"]), "customer")
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    # Authoritative eligibility check first - never let the client decide.
    eligibility = await RefundService.eligibility_for_order(order, RefundType.CANCELLATION.value)
    if not eligibility.get("eligible"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=eligibility.get("reason", "Order cannot be cancelled at this stage"))

    requires_review = eligibility.get("requiresReview", False)

    # Direct cancellation only for auto-eligible early states. Review-based
    # cancellations (out for delivery) create a refund request that support
    # approves first; the order is cancelled at approval time.
    if not requires_review:
        status_update = OrderStatusUpdate(
            status="cancelled",
            note=data.reason or "Not specified",
        )
        updated = await OrderService.update_order_status(
            order_id,
            str(current_user["_id"]),
            current_user.get("role"),
            status_update,
        )
        if not updated:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order cannot be cancelled at this stage")

    # Create the refund request through the authoritative engine. For early
    # cancellations it auto-approves and processes the payout immediately; for
    # review cancellations it stays under review.
    refund = None
    try:
        from app.schemas.refund import RefundRequestCreate, RefundReason
        created = await RefundService.create_refund_request(
            str(current_user["_id"]),
            order_id,
            RefundRequestCreate(
                refundType=RefundType.CANCELLATION,
                reason=data.reasonCode or RefundReason.OTHER,
                resolution="full_refund",
                description=data.reason or "Customer cancelled the order",
            ),
            order=order,
        )
        refund = created
    except Exception as e:
        logger.warning(f"Refund engine declined cancellation refund for {order_id}: {e}")
        refunds = await refund_repository.get_by_order_id(order_id)
        if refunds:
            refund = await RefundService.serialize(refunds[0])

    if requires_review:
        return {
            "success": True,
            "message": "Cancellation request submitted. The order is pending review.",
            "orderId": order_id,
            "requiresReview": True,
            "refund": refund or {"status": "under_review", "reason": "Cancellation pending review"},
        }

    return {
        "success": True,
        "message": "Order cancelled successfully",
        "orderId": order_id,
        "requiresReview": False,
        "refund": refund or {
            "status": "not_applicable",
            "reason": "No paid refund was required",
        },
    }


@router.post("/orders/{order_id}/delivery-failed")
async def mark_delivery_failed(
    order_id: str,
    note: str = Body(default="", embed=False),
    current_user: dict = Depends(get_current_user),
):
    """Mark an out-for-delivery order as failed and auto-refund the customer.

    Admin / support only (delivery partners use the delivery assignment flow).
    The order is cancelled and, when the customer already paid, a full
    ``delivery_failed`` refund is auto-approved and processed immediately.
    """
    if current_user.get("role") not in ("admin", "support"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins and support can mark deliveries as failed")

    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")

    order_status = (order.get("orderStatus") or "").lower()
    if order_status not in ("ready_for_delivery", "dispatched", "in_transit"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Delivery failure can only be marked while the order is out for delivery",
        )

    try:
        refund = await RefundService.create_refund_request(
            str(order["customerId"]),
            order_id,
            RefundRequestCreate(
                refundType=RefundType.DELIVERY_FAILED,
                reason=RefundReason.OTHER,
                resolution="full_refund",
                description=note or "Delivery failed - full refund issued",
            ),
            order=order,
            actor_role=current_user.get("role"),
        )
    except RefundNotEligibleError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RefundAlreadyProcessedError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {
        "success": True,
        "message": "Delivery marked as failed. Customer refunded.",
        "data": refund,
    }


@router.post("/orders/{order_id}/refund-request", response_model=RefundResponse)
async def create_refund_request(
    order_id: str,
    data: RefundRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    """Report a problem / request a refund for an order (Customer only).

    - **refundType**: full, partial, cancellation, damaged_product, ...
    - **reason**: why the customer is requesting it
    - **resolution**: full_refund, replacement, partial_refund
    - **affectedItems**: which products / quantities are affected
    - **requestedAmount**: the amount the customer *thinks* they are owed. The
      backend computes the actual eligible amount - this value is only used as
      an optional cap and is never blindly trusted.
    """
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only customers can request refunds")

    try:
        refund = await RefundService.create_refund_request(
            str(current_user["_id"]),
            order_id,
            data,
        )
    except RefundNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except RefundNotEligibleError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RefundAlreadyProcessedError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return refund


# ============== REFUND LISTING / DETAIL ==============

@router.get("", response_model=dict)
@router.get("/", response_model=dict, include_in_schema=False)
async def list_my_refunds(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """List the current customer's refund requests (or all for admin)."""
    result = await RefundService.get_refunds_for_user(
        str(current_user["_id"]),
        current_user.get("role"),
        page,
        limit,
    )
    return {"success": True, "data": result}


@router.get("/{refund_id}", response_model=RefundResponse)
async def get_refund_detail(
    refund_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single refund with its full timeline."""
    refund = await RefundService.get_refund(
        refund_id,
        str(current_user["_id"]),
        current_user.get("role"),
    )
    if not refund:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Refund not found or access denied")
    return refund


# ============== ADMIN / SUPPORT ACTIONS ==============

@router.get("/admin/all")
async def admin_list_refunds(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    refund_status: Optional[str] = Query(None, alias="status"),
    customer_id: Optional[str] = Query(None, alias="customerId"),
    order_id: Optional[str] = Query(None, alias="orderId"),
    current_user: dict = Depends(get_current_user),
):
    """List all refund requests with filters (Admin only)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can access this endpoint")

    from app.repositories.refund_repository import refund_repository

    skip = (page - 1) * limit
    refunds = await refund_repository.get_all(
        skip, limit, refund_status, customer_id, order_id
    )
    total = await refund_repository.count_filtered(refund_status, customer_id, order_id)

    result = []
    for r in refunds:
        s = await RefundService.serialize(r)
        if s:
            result.append(s)

    return {
        "success": True,
        "data": {
            "refunds": result,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if total else 0,
            },
        },
    }


@router.post("/{refund_id}/approve")
async def approve_refund(
    refund_id: str,
    data: RefundActionRequest = Body(default=RefundActionRequest()),
    current_user: dict = Depends(get_current_user),
):
    """Approve a refund and trigger processing (Admin / support)."""
    if current_user.get("role") not in ("admin", "support"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins and support can approve refunds")

    try:
        refund = await RefundService.approve_refund(
            refund_id,
            str(current_user["_id"]),
            current_user.get("role"),
            data.note,
        )
    except RefundNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except (RefundNotEligibleError, RefundAlreadyProcessedError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"success": True, "data": refund, "message": "Refund approved and processing"}


@router.post("/{refund_id}/reject")
async def reject_refund(
    refund_id: str,
    data: RefundRejectRequest,
    current_user: dict = Depends(get_current_user),
):
    """Reject a refund request (Admin / support)."""
    if current_user.get("role") not in ("admin", "support"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins and support can reject refunds")

    try:
        refund = await RefundService.reject_refund(
            refund_id,
            str(current_user["_id"]),
            current_user.get("role"),
            data.reason,
        )
    except RefundNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except RefundAlreadyProcessedError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"success": True, "data": refund, "message": "Refund request rejected"}


@router.post("/{refund_id}/process")
async def process_refund_payout(
    refund_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Process the payment payout for an approved refund (Admin / support)."""
    if current_user.get("role") not in ("admin", "support"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins and support can process refunds")

    try:
        refund = await RefundService.process_refund(
            refund_id,
            str(current_user["_id"]),
            current_user.get("role"),
        )
    except RefundNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except (RefundNotEligibleError, RefundAlreadyProcessedError) as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {"success": True, "data": refund, "message": "Refund processed"}