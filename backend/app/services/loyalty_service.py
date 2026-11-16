"""Transactional AgriPoints spending and reversal helpers."""
from datetime import datetime
from typing import Any, Dict

from bson import ObjectId

from app.database.mongodb import MongoDB


async def spend_points_for_order(customer_id: str, order_id: str, points: int, discount: float) -> None:
    """Debit points and write the spend ledger atomically; safe to retry per order."""
    points = int(points or 0)
    if points <= 0:
        return
    if points > 10000 or points % 100:
        raise ValueError("AgriPoints must be between 100 and 10,000 in multiples of 100.")

    account_collection = MongoDB.get_collection("loyalty_accounts")
    txn_collection = MongoDB.get_collection("loyalty_transactions")
    order_oid = ObjectId(order_id)
    user_oid = ObjectId(customer_id)

    async with await MongoDB.client.start_session() as session:
        async with session.start_transaction():
            existing = await txn_collection.find_one(
                {"orderId": order_oid, "reason": "checkout_discount", "type": "spend"},
                session=session,
            )
            if existing:
                if int(existing.get("points") or 0) != -points:
                    raise ValueError("This order already has a different AgriPoints redemption.")
                return

            account = await account_collection.find_one(
                {"userId": user_oid, "deletedAt": None}, session=session
            )
            if not account:
                raise ValueError("No AgriPoints balance is available for this account.")

            result = await account_collection.update_one(
                {"_id": account["_id"], "balance": {"$gte": points}},
                {"$inc": {"balance": -points, "lifetimeSpent": points}},
                session=session,
            )
            if result.modified_count != 1:
                raise ValueError("Insufficient AgriPoints balance. Refresh your points and try again.")

            await txn_collection.insert_one(
                {
                    "userId": user_oid,
                    "orderId": order_oid,
                    "type": "spend",
                    "points": -points,
                    "balanceAfter": int(account.get("balance") or 0) - points,
                    "reason": "checkout_discount",
                    "description": f"Used {points} AgriPoints for ₹{float(discount):g} order discount",
                    "createdAt": datetime.utcnow(),
                    "updatedAt": datetime.utcnow(),
                },
                session=session,
            )


async def restore_points_for_cancelled_order(order: Dict[str, Any]) -> int:
    """Restore all checkout points once when an order is cancelled."""
    points = int(order.get("loyaltyPointsUsed") or 0)
    if points <= 0:
        return 0

    account_collection = MongoDB.get_collection("loyalty_accounts")
    txn_collection = MongoDB.get_collection("loyalty_transactions")
    order_oid = order["_id"]
    user_oid = order.get("customerId")

    async with await MongoDB.client.start_session() as session:
        async with session.start_transaction():
            existing = await txn_collection.find_one(
                {"orderId": order_oid, "reason": "order_cancel_reversal", "type": "reversal"},
                session=session,
            )
            if existing:
                return 0

            account = await account_collection.find_one(
                {"userId": user_oid, "deletedAt": None}, session=session
            )
            if not account:
                raise ValueError("AgriPoints account was not found for cancellation reversal.")

            new_balance = int(account.get("balance") or 0) + points
            await account_collection.update_one(
                {"_id": account["_id"]},
                {"$inc": {"balance": points}, "$set": {"lifetimeSpent": max(0, int(account.get("lifetimeSpent") or 0) - points)}},
                session=session,
            )
            await txn_collection.insert_one(
                {
                    "userId": user_oid,
                    "orderId": order_oid,
                    "type": "reversal",
                    "points": points,
                    "balanceAfter": new_balance,
                    "reason": "order_cancel_reversal",
                    "description": "AgriPoints restored because the order was cancelled",
                    "createdAt": datetime.utcnow(),
                    "updatedAt": datetime.utcnow(),
                },
                session=session,
            )
            return points


async def restore_points_for_refund(order_id: str, refund_id: str, refund_amount: float) -> int:
    """Restore redeemed points proportionally to cumulative successful refunds.

    A full refund returns every redeemed point. Partial refunds return the
    corresponding proportion, with cumulative rounding so repeated partial
    refunds never restore more than the original redemption.
    """
    order_collection = MongoDB.get_collection("orders")
    account_collection = MongoDB.get_collection("loyalty_accounts")
    txn_collection = MongoDB.get_collection("loyalty_transactions")
    order_oid = ObjectId(order_id)
    refund_value = max(0.0, float(refund_amount or 0))

    async with await MongoDB.client.start_session() as session:
        async with session.start_transaction():
            existing = await txn_collection.find_one(
                {"refundId": str(refund_id), "reason": "order_refund_reversal", "type": "reversal"},
                session=session,
            )
            if existing:
                return 0

            order = await order_collection.find_one({"_id": order_oid}, session=session)
            if not order:
                raise ValueError("Order was not found while restoring AgriPoints.")

            points_used = int(order.get("loyaltyPointsUsed") or 0)
            if points_used <= 0:
                return 0

            # A cancellation reversal already returns the entire redemption.
            cancelled_reversal = await txn_collection.find_one(
                {"orderId": order_oid, "reason": "order_cancel_reversal", "type": "reversal"},
                session=session,
            )
            if cancelled_reversal:
                return 0

            total_paid_value = max(0.01, float(order.get("totalAmount") or 0))
            already_refunded_amount = float(order.get("loyaltyRefundedAmount") or 0)
            already_restored_points = int(order.get("loyaltyPointsRefunded") or 0)
            cumulative_refund = min(total_paid_value, already_refunded_amount + refund_value)
            target_restored_points = min(
                points_used,
                int((points_used * cumulative_refund) / total_paid_value + 1e-9),
            )
            points_to_restore = max(0, target_restored_points - already_restored_points)

            if points_to_restore:
                account = await account_collection.find_one(
                    {"userId": order.get("customerId"), "deletedAt": None},
                    session=session,
                )
                if not account:
                    raise ValueError("AgriPoints account was not found for refund reversal.")
                await account_collection.update_one(
                    {"_id": account["_id"]},
                    {"$inc": {"balance": points_to_restore}, "$set": {"lifetimeSpent": max(0, int(account.get("lifetimeSpent") or 0) - points_to_restore)}},
                    session=session,
                )
                balance_after = int(account.get("balance") or 0) + points_to_restore
                await txn_collection.insert_one(
                    {
                        "userId": order.get("customerId"),
                        "orderId": order_oid,
                        "refundId": str(refund_id),
                        "type": "reversal",
                        "points": points_to_restore,
                        "balanceAfter": balance_after,
                        "reason": "order_refund_reversal",
                        "description": f"Restored {points_to_restore} AgriPoints for refund {refund_id}",
                        "createdAt": datetime.utcnow(),
                        "updatedAt": datetime.utcnow(),
                    },
                    session=session,
                )

            await order_collection.update_one(
                {"_id": order_oid},
                {
                    "$set": {
                        "loyaltyRefundedAmount": cumulative_refund,
                        "loyaltyPointsRefunded": target_restored_points,
                        "updatedAt": datetime.utcnow(),
                    }
                },
                session=session,
            )
            return points_to_restore
