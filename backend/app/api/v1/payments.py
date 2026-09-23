from fastapi import APIRouter, Depends, HTTPException, status, Query, Body, Request
from typing import List, Optional
from pydantic import BaseModel
from bson import ObjectId
import json
import stripe
from app.core.config import settings
from app.api.v1.auth import get_current_user
from app.schemas.payment import (
    PaymentResponse, PaymentIntentResponse,
    RefundRequest, RefundResponse,
    WalletResponse, WalletTransactionResponse,
    WalletAddFunds, WalletWithdraw
)
from app.services.payment_service import PaymentService, razorpay_client
from app.services.order_service import OrderService
from app.repositories.payment_repository import payment_repository
from app.repositories.wallet_repository import wallet_repository
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


def _payment_response(payment: dict) -> dict:
    """Convert a raw payment document into a PaymentResponse-safe dict.

    The PaymentResponse schema requires string ids, but raw Mongo documents
    store orderId/userId as ObjectId. FastAPI's response validation fails on
    ObjectId, so normalize every id field to a string here.
    """
    data = dict(payment)
    data["id"] = str(data["_id"])
    for field in ("orderId", "userId"):
        if data.get(field) is not None:
            data[field] = str(data[field])
    if "transactionId" in data and data.get("transactionId") is not None:
        data["transactionId"] = str(data["transactionId"])
    return data

# ============== PAYMENT ENDPOINTS ==============

@router.post("/create-intent")
async def create_payment_intent(
    order_id: str = Body(..., embed=True),
    payment_method: str = Body(..., embed=True),
    current_user: dict = Depends(get_current_user)
):
    """
    Create a payment intent for an order.
    
    - **order_id**: Order ID
    - **payment_method**: card, upi, wallet, cash, razorpay
    """
    # Get order and validate ownership
    order = await OrderService.get_order(
        order_id,
        str(current_user["_id"]),
        current_user.get("role")
    )
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    # Check if order is already paid
    if order.get("paymentStatus") == "paid":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order already paid"
        )
    
    # Get total amount
    total_amount = order.get("totalAmount", 0)
    
    # Create payment intent
    result = await PaymentService.create_payment_intent(
        order_id,
        total_amount,
        payment_method
    )
    
    if result.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )
    
    return result

@router.post("/confirm", response_model=PaymentResponse)
async def confirm_payment(
    payment_intent_id: str = Body(..., embed=True),
    gateway_response: dict = Body(None, embed=True),
    current_user: dict = Depends(get_current_user)
):
    """
    Confirm a payment after gateway callback.
    
    - **payment_intent_id**: Payment intent ID from gateway
    - **gateway_response**: Response from payment gateway
    """
    payment = await PaymentService.confirm_payment(
        payment_intent_id,
        gateway_response or {},
        user_id=str(current_user["_id"]),
    )
    
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment confirmation failed"
        )
    
    return _payment_response(payment)

@router.post("/verify", response_model=PaymentResponse)
async def verify_payment(
    payment_id: str = Body(..., embed=True),
    razorpay_order_id: str = Body(..., embed=True),
    razorpay_payment_id: str = Body(..., embed=True),
    razorpay_signature: str = Body(..., embed=True),
    current_user: dict = Depends(get_current_user)
):
    """
    Verify a Razorpay payment after the Checkout returns to the app.

    The signature is checked server-side against the Razorpay secret before the
    payment is marked successful and the order confirmed.
    """
    # Only the payment's owner may confirm it.
    payment = await payment_repository.get_by_id(payment_id)
    if not payment or str(payment.get("userId")) != str(current_user["_id"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment verification failed"
        )

    payment = await PaymentService.verify_razorpay_payment(
        payment_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
    )

    if not payment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment verification failed"
        )

    return _payment_response(payment)

@router.get("/{order_id}", response_model=PaymentResponse)
async def get_payment_status(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get payment status for an order.
    """
    # Get order and validate ownership
    order = await OrderService.get_order(
        order_id,
        str(current_user["_id"]),
        current_user.get("role")
    )
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    payment = await payment_repository.get_by_order_id(order_id)
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found"
        )
    
    return _payment_response(payment)

@router.post("/{order_id}/refund", response_model=RefundResponse)
async def process_refund(
    order_id: str,
    refund_data: RefundRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Process a refund for an order.
    
    - **order_id**: Order ID
    - **amount**: Refund amount (full if not specified)
    - **reason**: Reason for refund
    """
    # Check if admin or farmer
    if current_user.get("role") not in ["admin", "farmer"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins and farmers can process refunds"
        )
    
    # Get order
    order = await OrderService.get_order(
        order_id,
        str(current_user["_id"]),
        current_user.get("role")
    )
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found"
        )
    
    # Check if order is delivered
    if order.get("orderStatus") != "delivered":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only delivered orders can be refunded"
        )
    
    # Process refund
    success = await PaymentService.process_refund(order_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refund processing failed"
        )
    
    from app.services.audit_service import AuditService
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role=current_user.get("role"),
        action="refund", resource="order", resource_id=order_id, outcome="success",
        metadata={"amount": refund_data.amount},
    )
    
    # Get refund details
    payment = await payment_repository.get_by_order_id(order_id)
    
    return {
        "id": payment.get("refundId", ""),
        "orderId": order_id,
        "amount": refund_data.amount or payment.get("amount", 0),
        "status": "completed",
        "transactionId": payment.get("refundId", ""),
        "processedAt": datetime.utcnow()
    }

# ============== WALLET ENDPOINTS ==============

@router.get("/wallet", response_model=WalletResponse)
async def get_wallet(current_user: dict = Depends(get_current_user)):
    """
    Get wallet information.
    """
    wallet = await wallet_repository.get_by_user_id(str(current_user["_id"]))
    if not wallet:
        # Create wallet if doesn't exist
        wallet_id = await wallet_repository.create_wallet({
            "userId": ObjectId(current_user["_id"])
        })
        wallet = await wallet_repository.get_by_id(wallet_id)
    
    wallet["id"] = str(wallet["_id"])
    return wallet

@router.get("/wallet/transactions")
async def get_wallet_transactions(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """
    Get wallet transactions.
    """
    wallet = await wallet_repository.get_by_user_id(str(current_user["_id"]))
    if not wallet:
        return {
            "success": True,
            "data": {
                "transactions": [],
                "pagination": {
                    "page": page,
                    "limit": limit,
                    "total": 0,
                    "totalPages": 0
                }
            }
        }
    
    skip = (page - 1) * limit
    transactions = await wallet_transaction_repository.get_by_wallet_id(
        str(wallet["_id"]),
        skip=skip,
        limit=limit
    )
    
    total = await wallet_transaction_repository.count({
        "walletId": wallet["_id"],
        "deletedAt": None
    })
    
    for txn in transactions:
        txn["id"] = str(txn["_id"])
    
    return {
        "success": True,
        "data": {
            "transactions": transactions,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/wallet/add-funds")
async def add_wallet_funds(
    data: WalletAddFunds,
    current_user: dict = Depends(get_current_user)
):
    """
    Add funds to wallet.
    
    - **amount**: Amount to add (min ₹1, max ₹100,000)
    - **paymentMethod**: card, upi
    """
    result = await PaymentService.add_wallet_funds(
        str(current_user["_id"]),
        data
    )
    
    if result.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )
    
    return {
        "success": True,
        "data": result
    }

@router.post("/wallet/verify-topup")
async def verify_wallet_topup(
    payment_id: str = Body(..., embed=True),
    razorpay_order_id: str = Body(..., embed=True),
    razorpay_payment_id: str = Body(..., embed=True),
    razorpay_signature: str = Body(..., embed=True),
    current_user: dict = Depends(get_current_user)
):
    """
    Verify a Razorpay wallet top-up after the Checkout returns to the app.

    The signature is checked server-side before the wallet is credited.
    """
    ok = await PaymentService.verify_wallet_topup(
        payment_id,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        user_id=str(current_user["_id"]),
    )

    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Wallet top-up verification failed"
        )

    return {"success": True, "message": "Wallet top-up verified and credited"}

@router.post("/wallet/withdraw")
async def withdraw_wallet_funds(
    data: WalletWithdraw,
    current_user: dict = Depends(get_current_user)
):
    """
    Withdraw funds from wallet.
    
    - **amount**: Amount to withdraw (min ₹100)
    - **bankAccount**: Bank account details
    """
    result = await PaymentService.withdraw_wallet_funds(
        str(current_user["_id"]),
        data
    )
    
    if result.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result["error"]
        )
    
    return {
        "success": True,
        "data": result
    }

@router.get("/wallet/info")
async def get_wallet_info(current_user: dict = Depends(get_current_user)):
    """
    Get wallet info with balance and recent transactions.
    """
    info = await PaymentService.get_wallet_info(str(current_user["_id"]))
    return {
        "success": True,
        "data": info
    }

@router.get("/wallet/withdrawals")
async def get_my_withdrawals(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    """
    Get the current user's withdrawal requests.
    """
    from app.repositories.withdrawal_repository import withdrawal_repository

    skip = (page - 1) * limit
    withdrawals = await withdrawal_repository.get_by_user_id(
        str(current_user["_id"]), skip=skip, limit=limit
    )
    total = await withdrawal_repository.count({
        "userId": ObjectId(current_user["_id"]),
        "deletedAt": None
    })

    for w in withdrawals:
        w["id"] = str(w["_id"])
        w["bankAccount"] = w.get("bankAccount") or {}

    return {
        "success": True,
        "data": {
            "withdrawals": withdrawals,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

# ============== FINANCIAL LEDGER ==============

@router.get("/ledger/me")
async def get_my_ledger(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    entry_type: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Get the current user's financial ledger (append-only money movements).
    """
    from app.repositories.ledger_repository import ledger_repository

    user_id = str(current_user["_id"])
    filter = {"userId": ObjectId(user_id), "deletedAt": None}
    if entry_type:
        filter["type"] = entry_type

    skip = (page - 1) * limit
    entries = await ledger_repository.find_many(
        filter, skip=skip, limit=limit, sort=[("createdAt", -1)]
    )
    total = await ledger_repository.count(filter)
    balance = await ledger_repository.get_balance_for_user(user_id)

    for e in entries:
        e["id"] = str(e["_id"])
        e.pop("_id", None)
        if e.get("orderId"):
            e["orderId"] = str(e["orderId"])
        if e.get("paymentId"):
            e["paymentId"] = str(e["paymentId"])
        if e.get("userId"):
            e["userId"] = str(e["userId"])
        e.pop("reverses", None)

    return {
        "success": True,
        "data": {
            "entries": entries,
            "balance": balance,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.get("/admin/ledger")
async def get_admin_ledger(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    user_id: Optional[str] = Query(None),
    entry_type: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """
    Get the financial ledger (Admin only). Optional user / entry-type filters.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")

    from app.repositories.ledger_repository import ledger_repository

    filter = {"deletedAt": None}
    if user_id:
        filter["userId"] = ObjectId(user_id)
    if entry_type:
        filter["type"] = entry_type

    skip = (page - 1) * limit
    entries = await ledger_repository.find_many(
        filter, skip=skip, limit=limit, sort=[("createdAt", -1)]
    )
    total = await ledger_repository.count(filter)

    for e in entries:
        e["id"] = str(e["_id"])
        e.pop("_id", None)
        for key in ("orderId", "paymentId", "userId", "createdBy"):
            if e.get(key) and key != "createdBy":
                e[key] = str(e[key])

    return {
        "success": True,
        "data": {
            "entries": entries,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.get("/admin/withdrawals")
async def get_all_withdrawals(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all withdrawal requests with user details (Admin only).
    """
    from app.repositories.withdrawal_repository import withdrawal_repository

    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )

    filter = {"deletedAt": None}
    if status:
        filter["status"] = status

    skip = (page - 1) * limit
    withdrawals = await withdrawal_repository.find_many(
        filter,
        skip=skip,
        limit=limit,
        sort=[("createdAt", -1)]
    )
    total = await withdrawal_repository.count(filter)

    from app.services.user_service import UserService
    for w in withdrawals:
        w["id"] = str(w["_id"])
        user = await UserService.get_user_by_id(str(w.get("userId")))
        if user:
            w["user"] = {
                "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip(),
                "email": user.get("email"),
                "phone": user.get("phone"),
                "role": user.get("role"),
            }
        w["bankAccount"] = w.get("bankAccount") or {}

    return {
        "success": True,
        "data": {
            "withdrawals": withdrawals,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

# ============== ADMIN ENDPOINTS ==============

@router.get("/admin/cash-settlements")
async def get_all_cash_settlements(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all cash-on-delivery settlements (Admin only).

    Shows the cash each delivery partner collected on COD orders, their
    delivery fee, and how much they still owe to remit to the platform. The
    farmer's share is credited to the farmer's wallet when the order is
    delivered.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )

    from app.repositories.cash_settlement_repository import cash_settlement_repository

    filter = {"deletedAt": None}
    if status:
        filter["status"] = status

    skip = (page - 1) * limit
    settlements = await cash_settlement_repository.find_many(
        filter,
        skip=skip,
        limit=limit,
        sort=[("cashCollectedAt", -1)]
    )
    total = await cash_settlement_repository.count(filter)

    from app.services.user_service import UserService
    for s in settlements:
        s["id"] = str(s["_id"])
        s["orderId"] = str(s["orderId"]) if s.get("orderId") else None
        delivery_user = None
        if s.get("deliveryPartnerId"):
            delivery_user = await UserService.get_user_by_id(str(s["deliveryPartnerId"]))
        if delivery_user:
            s["deliveryPartner"] = {
                "name": f"{delivery_user.get('firstName', '')} {delivery_user.get('lastName', '')}".strip(),
                "email": delivery_user.get("email"),
                "phone": delivery_user.get("phone"),
            }

    return {
        "success": True,
        "data": {
            "settlements": settlements,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if total else 0
            }
        }
    }

@router.get("/admin/cash-settlements/stats")
async def cash_settlement_stats(current_user: dict = Depends(get_current_user)):
    """Finance dashboard numbers for COD collections (Admin only)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access this endpoint")

    from app.repositories.cash_settlement_repository import cash_settlement_repository
    return {
        "success": True,
        "data": await cash_settlement_repository.admin_summary(),
    }

@router.get("/admin/cash-settlements/partners-outstanding")
async def cash_settlement_partners_outstanding(
    limit: int = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user)
):
    """Per-partner COD cash owed to the platform (Admin only)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access this endpoint")

    from app.repositories.cash_settlement_repository import cash_settlement_repository
    from app.services.user_service import UserService
    rows = await cash_settlement_repository.partners_outstanding(limit=limit)
    for r in rows:
        pid = r.get("_id")
        r["partnerId"] = str(pid) if pid else None
        r["outstanding"] = round(float(r.get("outstanding", 0) or 0), 2)
        user = None
        if pid:
            user = await UserService.get_user_by_id(str(pid))
        r["partner"] = {
            "name": f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() if user else "Unknown",
            "phone": user.get("phone") if user else "",
        } if user else {"name": "Unknown", "phone": ""}
    return {
        "success": True,
        "data": {"partners": rows},
    }

class VerifySettlementRequest(BaseModel):
    notes: Optional[str] = None

@router.post("/admin/cash-settlements/{settlement_id}/verify")
async def verify_cash_settlement(
    settlement_id: str,
    data: VerifySettlementRequest = Body(default=VerifySettlementRequest()),
    current_user: dict = Depends(get_current_user)
):
    """Finance verified the transfer reference; money received (Admin only).

    This is the reconciliation step - the delivery partner's submission only
    becomes settled after an admin confirms the UTR/transfer against the bank
    statement.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access this endpoint")

    from app.repositories.cash_settlement_repository import cash_settlement_repository
    settlement = await cash_settlement_repository.get_by_id(settlement_id)
    if not settlement:
        raise HTTPException(status_code=404, detail="Cash settlement not found")
    if settlement.get("status") != "submitted":
        raise HTTPException(
            status_code=400,
            detail="Only submitted settlements can be verified (current status: {})".format(
                settlement.get("status")
            ),
        )

    ok = await cash_settlement_repository.verify_settlement(
        settlement_id, str(current_user["_id"]), data.notes
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to verify settlement")

    from app.services.audit_service import AuditService
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role="admin", action="settlement_verify",
        resource="cash_settlement", resource_id=settlement_id, outcome="success",
        metadata={"amount": round(float(settlement.get("amountToRemit", 0)), 2), "notes": data.notes},
    )

    return {
        "success": True,
        "data": {
            "id": settlement_id,
            "status": "verified",
            "amount": round(float(settlement.get("amountToRemit", 0)), 2),
        },
        "message": "Settlement verified. Cash reconciled.",
    }

@router.post("/admin/cash-settlements/{settlement_id}/reject")
async def reject_cash_settlement(
    settlement_id: str,
    data: VerifySettlementRequest = Body(default=VerifySettlementRequest()),
    current_user: dict = Depends(get_current_user)
):
    """Reject a settlement submission that didn't reconcile (Admin only)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access this endpoint")

    from app.repositories.cash_settlement_repository import cash_settlement_repository
    settlement = await cash_settlement_repository.get_by_id(settlement_id)
    if not settlement:
        raise HTTPException(status_code=404, detail="Cash settlement not found")
    if settlement.get("status") != "submitted":
        raise HTTPException(status_code=400, detail="Only submitted settlements can be rejected")

    reason = data.notes or "Reference could not be reconciled"
    ok = await cash_settlement_repository.reject_settlement(
        settlement_id, str(current_user["_id"]), reason
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to reject settlement")

    from app.services.audit_service import AuditService
    await AuditService.log(
        actor_id=str(current_user["_id"]), actor_role="admin", action="settlement_reject",
        resource="cash_settlement", resource_id=settlement_id, outcome="success",
        metadata={"reason": reason},
    )

    return {
        "success": True,
        "data": {"id": settlement_id, "status": "rejected"},
        "message": f"Settlement rejected: {reason}",
    }

@router.get("/admin/payments/stats")
async def get_payment_stats(
    period: str = Query("month", description="day, week, month, year"),
    current_user: dict = Depends(get_current_user)
):
    """
    Get payment statistics (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    
    from datetime import datetime, timedelta
    
    # Calculate date range
    now = datetime.utcnow()
    if period == "day":
        start_date = datetime(now.year, now.month, now.day)
    elif period == "week":
        start_date = now - timedelta(days=7)
    elif period == "month":
        start_date = now - timedelta(days=30)
    elif period == "year":
        start_date = now - timedelta(days=365)
    else:
        start_date = None
    
    stats = await payment_repository.get_payment_stats(
        date_from=start_date,
        date_to=now
    )
    
    return {
        "success": True,
        "data": {
            "stats": stats,
            "period": period
        }
    }

@router.get("/admin/transactions")
async def get_all_transactions(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all payment transactions (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    
    # Parse dates
    from datetime import datetime
    from_date_obj = None
    to_date_obj = None
    
    if from_date:
        try:
            from_date_obj = datetime.fromisoformat(from_date.replace('Z', '+00:00'))
        except:
            pass
    
    if to_date:
        try:
            to_date_obj = datetime.fromisoformat(to_date.replace('Z', '+00:00'))
        except:
            pass
    
    # Build filter
    filter = {"deletedAt": None}
    if status:
        filter["status"] = status
    if from_date_obj or to_date_obj:
        date_filter = {}
        if from_date_obj:
            date_filter["$gte"] = from_date_obj
        if to_date_obj:
            date_filter["$lte"] = to_date_obj
        filter["createdAt"] = date_filter
    
    skip = (page - 1) * limit
    payments = await payment_repository.find_many(
        filter,
        skip=skip,
        limit=limit,
        sort=[("createdAt", -1)]
    )
    
    total = await payment_repository.count(filter)
    
    # Enrich with user details
    from app.services.user_service import UserService
    for payment in payments:
        payment["id"] = str(payment["_id"])
        user = await UserService.get_user_by_id(str(payment["userId"]))
        if user:
            payment["user"] = {
                "name": f"{user.get('firstName', '')} {user.get('lastName', '')}",
                "email": user.get("email")
            }
    
    return {
        "success": True,
        "data": {
            "payments": payments,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

# ============== WEBHOOK ENDPOINTS ==============

@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """
    Stripe webhook handler.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
        
        # Process webhook
        success = await PaymentService.handle_webhook(event)
        
        if success:
            return {"status": "success"}
        else:
            return {"status": "ignored"}, 200
            
    except ValueError as e:
        # Invalid payload
        raise HTTPException(status_code=400, detail=str(e))
    except stripe.error.SignatureVerificationError as e:
        # Invalid signature
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    """
    Razorpay webhook handler.
    """
    payload = await request.body()
    signature = request.headers.get("x-razorpay-signature")

    try:
        # Verify webhook signature
        razorpay_client.utility.verify_webhook_signature(
            payload,
            signature,
            settings.RAZORPAY_WEBHOOK_SECRET
        )

        event = json.loads(payload)

        # Process webhook
        success = await PaymentService.handle_webhook(event)

        if success:
            return {"status": "success"}
        else:
            return {"status": "ignored"}, 200

    except Exception as e:
        logger.error(f"Razorpay webhook error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/audit-logs")
async def get_audit_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    action: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    """Security audit trail (Admin only). Entries are retained 180 days."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can access this endpoint")

    from app.repositories.audit_log_repository import audit_log_repository

    filter = {}
    if action:
        filter["action"] = action
    if user_id:
        filter["actorId"] = user_id

    skip = (page - 1) * limit
    logs = await audit_log_repository.find_many(
        filter, skip=skip, limit=limit, sort=[("createdAt", -1)]
    )
    total = await audit_log_repository.count(filter)

    for entry in logs:
        entry["id"] = str(entry.pop("_id", ""))

    return {
        "success": True,
        "data": {
            "logs": logs,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit if total else 0
            }
        }
    }
