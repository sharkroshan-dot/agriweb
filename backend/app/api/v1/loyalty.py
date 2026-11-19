"""Loyalty / AgriPoints program.

Points are earned on delivered orders and behavior that improves logistics
(pickup, community delivery, nearby farmer). Points can be redeemed for wallet
credit. All movements are recorded in an immutable-style ledger.

Collections:
  - loyalty_accounts: per-user balance
  - loyalty_transactions: points ledger (earn/spend)
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, Field
from bson import ObjectId
import logging

from app.api.v1.auth import get_current_user
from app.repositories.base_repository import BaseRepository
from app.repositories.order_repository import order_repository
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType, NotificationPriority

logger = logging.getLogger(__name__)
router = APIRouter()

account_repo = BaseRepository("loyalty_accounts")
txn_repo = BaseRepository("loyalty_transactions")

# Rules
POINTS_PER_RUPEE = 0.01          # ₹100 spent -> 1 point
BASE_POINTS_PER_ORDER = 5
BONUS_PICKUP = 10
BONUS_COMMUNITY = 20
BONUS_NEARBY = 5
POINTS_PER_RS_REWARD = 100       # 500 points -> ₹5 wallet credit
MAX_REDEEM_POINTS = 10000


async def _get_account(user_id: str) -> dict:
    account = await account_repo.find_one({"userId": ObjectId(user_id), "deletedAt": None})
    if not account:
        account_id = await account_repo.create({
            "userId": ObjectId(user_id),
            "balance": 0,
            "lifetimeEarned": 0,
        })
        account = await account_repo.find_one({"_id": ObjectId(account_id)})
    return account


def _serialize_txn(t: dict) -> dict:
    t["id"] = str(t["_id"])
    t["userId"] = str(t.get("userId"))
    if t.get("orderId"):
        t["orderId"] = str(t["orderId"])
    return t


def _nearby_order(order: dict) -> bool:
    """Heuristic: order delivered within the farmer's own radius (self-delivery)."""
    return bool(order.get("selfDelivery") or (order.get("distanceKm") and float(order.get("distanceKm")) <= 10))


async def award_points_for_delivered_order(order: dict) -> Optional[dict]:
    """Credit AgriPoints for a delivered/picked-up order. Idempotent per order."""
    order_id = str(order["_id"])
    customer_id = str(order.get("customerId"))
    if not customer_id:
        return None

    already = await txn_repo.find_one({
        "orderId": ObjectId(order_id),
        "type": "earn",
        "deletedAt": None,
    })
    if already:
        return None

    amount = float(order.get("totalAmount") or 0)
    points = BASE_POINTS_PER_ORDER + int(amount * POINTS_PER_RUPEE)

    if order.get("deliveryType") == "pickup":
        points += BONUS_PICKUP
    if order.get("communityDelivery") or order.get("communityScheduleId"):
        points += BONUS_COMMUNITY
    if _nearby_order(order):
        points += BONUS_NEARBY

    account = await _get_account(customer_id)
    new_balance = int(account.get("balance") or 0) + points

    await account_repo.update(
        {"_id": account["_id"]},
        {"balance": new_balance, "lifetimeEarned": int(account.get("lifetimeEarned") or 0) + points},
    )

    txn = {
        "userId": ObjectId(customer_id),
        "orderId": ObjectId(order_id),
        "type": "earn",
        "points": points,
        "balanceAfter": new_balance,
        "reason": "order_delivered",
        "description": f"Points for order #{order.get('orderNumber', order_id)}",
    }
    txn_id = await txn_repo.create(txn)
    if txn_id:
        await NotificationService.create_in_app_notification(
            customer_id,
            NotificationType.CUSTOMER,
            "AgriPoints earned 🌱",
            f"You earned {points} AgriPoints for order #{order.get('orderNumber', order_id)}.",
            {"points": points, "balance": new_balance, "type": "loyalty"},
            NotificationPriority.MEDIUM,
        )
    return {"points": points, "balance": new_balance}


# ================== ENDPOINTS ==================

@router.get("/me")
async def get_my_points(current_user: dict = Depends(get_current_user)):
    """Get the customer's AgriPoints balance and recent history.

    Reconcile recent completed orders as well as awarding points on the live
    delivery transition. This safely backfills orders completed before the
    loyalty award hook was enabled; the award function is idempotent per order.
    """
    user_id = str(current_user["_id"])
    completed_orders = []
    for completed_status in ("delivered", "picked_up"):
        completed_orders.extend(
            await order_repository.get_by_customer(
                user_id,
                limit=100,
                status=completed_status,
            )
        )
    for completed_order in completed_orders:
        try:
            await award_points_for_delivered_order(completed_order)
        except Exception:
            logger.exception(
                "Failed to reconcile AgriPoints for completed order %s",
                completed_order.get("_id"),
            )

    account = await _get_account(user_id)
    txns = await txn_repo.find_many(
        {"userId": ObjectId(current_user["_id"]), "deletedAt": None},
        sort=[("createdAt", -1)],
        limit=50,
    )
    for t in txns:
        _serialize_txn(t)

    reward_rs = int((account.get("balance") or 0) / POINTS_PER_RS_REWARD)
    return {
        "success": True,
        "data": {
            "balance": int(account.get("balance") or 0),
            "lifetimeEarned": int(account.get("lifetimeEarned") or 0),
            "rewardValueRs": reward_rs,
            "redeemablePoints": int(account.get("balance") or 0),
            "rules": {
                "pointsPerRupee": POINTS_PER_RUPEE,
                "basePointsPerOrder": BASE_POINTS_PER_ORDER,
                "bonusPickup": BONUS_PICKUP,
                "bonusCommunity": BONUS_COMMUNITY,
                "bonusNearby": BONUS_NEARBY,
                "pointsPerRsReward": POINTS_PER_RS_REWARD,
            },
            "transactions": txns,
            "count": len(txns),
        },
    }


async def redeem_points_for_order(user_id: str, points: int, order_id: str) -> dict:
    """Atomically debit AgriPoints for an order and write a ledger entry."""
    if points <= 0:
        return {"redeemedPoints": 0, "discountRs": 0}
    if points > MAX_REDEEM_POINTS or points % POINTS_PER_RS_REWARD:
        raise ValueError(
            f"Points must be a multiple of {POINTS_PER_RS_REWARD} and no more than {MAX_REDEEM_POINTS}."
        )

    account = await _get_account(user_id)
    result = await account_repo.collection.update_one(
        {"_id": account["_id"], "balance": {"$gte": points}},
        {"$inc": {"balance": -points}, "$set": {"updatedAt": datetime.utcnow()}},
    )
    if getattr(result, "modified_count", 0) != 1:
        raise ValueError("Your AgriPoints balance changed. Refresh checkout and try again.")

    updated_account = await account_repo.find_one({"_id": account["_id"]})
    new_balance = int((updated_account or {}).get("balance") or 0)
    discount_rs = points // POINTS_PER_RS_REWARD
    try:
        await txn_repo.create({
            "userId": ObjectId(user_id),
            "orderId": ObjectId(order_id),
            "type": "redeem",
            "points": -points,
            "balanceAfter": new_balance,
            "reason": "order_checkout_redemption",
            "description": f"Used {points} AgriPoints for order checkout",
        })
    except Exception:
        await account_repo.collection.update_one(
            {"_id": account["_id"]},
            {"$inc": {"balance": points}, "$set": {"updatedAt": datetime.utcnow()}},
        )
        raise
    return {"redeemedPoints": points, "discountRs": discount_rs, "newBalance": new_balance}


async def refund_order_points(user_id: str, order_id: str) -> Optional[dict]:
    """Restore checkout points once when the associated order is cancelled/refunded."""
    order_object_id = ObjectId(order_id)
    redemption = await txn_repo.find_one({
        "userId": ObjectId(user_id),
        "orderId": order_object_id,
        "type": "redeem",
        "reason": "order_checkout_redemption",
        "deletedAt": None,
    })
    if not redemption:
        return None
    already_refunded = await txn_repo.find_one({
        "userId": ObjectId(user_id),
        "orderId": order_object_id,
        "type": "refund",
        "reason": "order_checkout_redemption_refund",
        "deletedAt": None,
    })
    if already_refunded:
        return None

    points = abs(int(redemption.get("points") or 0))
    if points <= 0:
        return None
    account = await _get_account(user_id)
    new_balance = int(account.get("balance") or 0) + points
    await account_repo.update(
        {"_id": account["_id"]},
        {"balance": new_balance, "updatedAt": datetime.utcnow()},
    )
    await txn_repo.create({
        "userId": ObjectId(user_id),
        "orderId": order_object_id,
        "type": "refund",
        "points": points,
        "balanceAfter": new_balance,
        "reason": "order_checkout_redemption_refund",
        "description": f"Restored {points} AgriPoints for cancelled/refunded order",
    })
    return {"refundedPoints": points, "newBalance": new_balance}


class RedeemRequest(BaseModel):
    points: int = Field(..., ge=1)


@router.post("/redeem")
async def redeem_points(
    data: RedeemRequest,
    current_user: dict = Depends(get_current_user),
):
    """Redeem AgriPoints for wallet credit."""
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Only customers can redeem points")

    if data.points > MAX_REDEEM_POINTS:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_REDEEM_POINTS} points per redemption")

    account = await _get_account(str(current_user["_id"]))
    balance = int(account.get("balance") or 0)
    if data.points > balance:
        raise HTTPException(status_code=400, detail="Insufficient points")

    if data.points % POINTS_PER_RS_REWARD != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Points must be a multiple of {POINTS_PER_RS_REWARD} (each {POINTS_PER_RS_REWARD} points = ₹1)",
        )

    reward_rs = data.points // POINTS_PER_RS_REWARD
    new_balance = balance - data.points

    await account_repo.update(
        {"_id": account["_id"]},
        {"balance": new_balance},
    )

    txn = {
        "userId": ObjectId(current_user["_id"]),
        "type": "redeem",
        "points": -data.points,
        "balanceAfter": new_balance,
        "reason": "redeem",
        "description": f"Redeemed for ₹{reward_rs} wallet credit",
    }
    txn_id = await txn_repo.create(txn)

    # Credit the customer wallet + record the wallet transaction.
    from app.repositories.wallet_repository import wallet_repository, wallet_transaction_repository
    wallet = await wallet_repository.get_by_user_id(str(current_user["_id"]))
    if not wallet:
        raise HTTPException(status_code=400, detail="No wallet found for redemption")
    await wallet_repository.update_balance(str(wallet["_id"]), reward_rs, "credit")
    await wallet_transaction_repository.create_transaction({
        "walletId": wallet["_id"],
        "userId": ObjectId(current_user["_id"]),
        "type": "credit",
        "amount": reward_rs,
        "description": "AgriPoints redemption",
        "reference": txn_id or None,
        "balanceAfter": float((wallet.get("balance") or 0) + reward_rs),
    })

    await NotificationService.create_in_app_notification(
        str(current_user["_id"]),
        NotificationType.CUSTOMER,
        "Points redeemed 🎉",
        f"₹{reward_rs} has been credited to your wallet.",
        {"points": data.points, "rewardRs": reward_rs, "type": "loyalty"},
        NotificationPriority.HIGH,
    )

    return {
        "success": True,
        "data": {"redeemedPoints": data.points, "rewardRs": reward_rs, "newBalance": new_balance},
        "message": f"₹{reward_rs} credited to your wallet",
    }