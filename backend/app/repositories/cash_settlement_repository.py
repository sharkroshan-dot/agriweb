from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

# Settlement lifecycle:
#   pending_remit  -> cash collected, partner still owes the platform
#   submitted      -> partner filed a settlement (method + UTR/reference), awaiting verification
#   verified       -> finance reconciled the reference, money confirmed received
#   rejected       -> reference did not reconcile, back to owing
#   remitted       -> (legacy) marked settled without verification
STATUSES = ("pending_remit", "submitted", "verified", "rejected", "remitted")


class CashSettlementRepository(BaseRepository):
    """Cash-on-delivery settlement repository.

    Tracks the cash a delivery partner collected on a COD order. The partner
    keeps their delivery fee and must remit the balance (farmer + platform
    share) back to the platform. The farmer is paid from the settlement once
    the order is delivered.

    Lifecycle: ``pending_remit`` -> ``submitted`` -> ``verified`` (settled).
    The partner submits a UTR/reference, finance verifies it against the bank
    statement, and only then is the settlement marked as done.
    """

    def __init__(self):
        super().__init__("cash_settlements")

    async def create(self, data: Dict[str, Any]) -> Optional[str]:
        data["createdAt"] = datetime.utcnow()
        data["updatedAt"] = datetime.utcnow()
        data.setdefault("status", "pending_remit")
        return await super().create(data)

    async def get_by_id(self, settlement_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(settlement_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting cash settlement: {str(e)}")
            return None

    async def get_by_order_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get a settlement for an order (idempotency guard)."""
        try:
            return await self.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting cash settlement by order: {str(e)}")
            return None

    async def get_by_delivery_partner(
        self,
        delivery_user_id: str,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """List settlements for a delivery partner (keyed by their user id)."""
        try:
            values: List[Any] = [delivery_user_id]
            try:
                values.append(ObjectId(delivery_user_id))
            except Exception:
                pass
            filter = {"deliveryPartnerId": {"$in": values}, "deletedAt": None}
            if status:
                filter["status"] = status
            return await self.find_many(
                filter, skip=skip, limit=limit, sort=[("cashCollectedAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting cash settlements by partner: {str(e)}")
            return []

    async def get_partner_totals(self, delivery_user_id: str) -> Dict[str, Any]:
        """Aggregate cash collected and pending remit for a delivery partner."""
        try:
            values: List[Any] = [delivery_user_id]
            try:
                values.append(ObjectId(delivery_user_id))
            except Exception:
                pass
            pipeline = [
                {"$match": {"deliveryPartnerId": {"$in": values}, "deletedAt": None}},
                {"$group": {
                    "_id": None,
                    "cashCollected": {"$sum": "$amount"},
                    "deliveryFees": {"$sum": "$deliveryFee"},
                    "pendingRemit": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["verified", "remitted"]]},
                                0.0,
                                "$amountToRemit",
                            ]
                        }
                    },
                    "inVerification": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["submitted"]]},
                                "$amountToRemit",
                                0.0,
                            ]
                        }
                    },
                    "pendingSubmission": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["pending_remit", "rejected"]]},
                                "$amountToRemit",
                                0.0,
                            ]
                        }
                    },
                    "alreadyDeposited": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["verified", "remitted"]]},
                                "$amountToRemit",
                                0.0,
                            ]
                        }
                    },
                }},
            ]
            result = await self.aggregate(pipeline)
            row = result[0] if result else {}
            return {
                "cashCollected": float(row.get("cashCollected", 0) or 0),
                "deliveryFees": float(row.get("deliveryFees", 0) or 0),
                "pendingRemit": float(row.get("pendingRemit", 0) or 0),
                "pendingSubmission": float(row.get("pendingSubmission", 0) or 0),
                "inVerification": float(row.get("inVerification", 0) or 0),
                "alreadyDeposited": float(row.get("alreadyDeposited", 0) or 0),
            }
        except Exception as e:
            logger.error(f"Error getting cash settlement totals: {str(e)}")
            return {
                "cashCollected": 0.0,
                "deliveryFees": 0.0,
                "pendingRemit": 0.0,
                "pendingSubmission": 0.0,
                "inVerification": 0.0,
                "alreadyDeposited": 0.0,
            }

    async def get_today_total(self, delivery_user_id: str) -> float:
        """Total cash collected today by a delivery partner."""
        try:
            values: List[Any] = [delivery_user_id]
            try:
                values.append(ObjectId(delivery_user_id))
            except Exception:
                pass
            start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            pipeline = [
                {
                    "$match": {
                        "deliveryPartnerId": {"$in": values},
                        "deletedAt": None,
                        "cashCollectedAt": {"$gte": start},
                    }
                },
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
            ]
            result = await self.aggregate(pipeline)
            return float(result[0]["total"]) if result else 0.0
        except Exception as e:
            logger.error(f"Error getting today cash total: {str(e)}")
            return 0.0

    async def get_today_settlements(
        self,
        delivery_user_id: str,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        """Detailed list of today's COD settlements for a delivery partner.

        Returns the per-order breakdown (amount, delivery fee, farmer share,
        platform share, amount to remit, status) collected today.
        """
        try:
            values: List[Any] = [delivery_user_id]
            try:
                values.append(ObjectId(delivery_user_id))
            except Exception:
                pass
            start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            filter = {
                "deliveryPartnerId": {"$in": values},
                "deletedAt": None,
                "cashCollectedAt": {"$gte": start},
            }
            return await self.find_many(
                filter, limit=limit, sort=[("cashCollectedAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting today cash settlements: {str(e)}")
            return []

    async def get_outstanding_total(self, delivery_user_id: str) -> float:
        """Total COD cash a partner currently holds (anything not yet verified)."""
        totals = await self.get_partner_totals(delivery_user_id)
        return round(totals["pendingRemit"], 2)

    async def get_overdue(
        self,
        delivery_user_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Settlements still owing past the due window (admin + partner)."""
        due_hours = getattr(settings, "COD_SETTLEMENT_DUE_HOURS", 24)
        cutoff = datetime.utcnow() - timedelta(hours=due_hours)
        filter = {
            "deletedAt": None,
            "status": {"$in": ["pending_remit", "rejected"]},
            "cashCollectedAt": {"$lt": cutoff},
        }
        if delivery_user_id:
            values: List[Any] = [delivery_user_id]
            try:
                values.append(ObjectId(delivery_user_id))
            except Exception:
                pass
            filter["deliveryPartnerId"] = {"$in": values}
        return await self.find_many(filter, limit=limit, sort=[("cashCollectedAt", 1)])

    async def count_overdue(self, delivery_user_id: str) -> int:
        due_hours = getattr(settings, "COD_SETTLEMENT_DUE_HOURS", 24)
        cutoff = datetime.utcnow() - timedelta(hours=due_hours)
        values: List[Any] = [delivery_user_id]
        try:
            values.append(ObjectId(delivery_user_id))
        except Exception:
            pass
        return await self.count({
            "deletedAt": None,
            "deliveryPartnerId": {"$in": values},
            "status": {"$in": ["pending_remit", "rejected"]},
            "cashCollectedAt": {"$lt": cutoff},
        })

    async def get_all(
        self,
        status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
        partner_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List every COD settlement (admin)."""
        try:
            filter = {"deletedAt": None}
            if status:
                filter["status"] = status
            if partner_id:
                values: List[Any] = [partner_id]
                try:
                    values.append(ObjectId(partner_id))
                except Exception:
                    pass
                filter["deliveryPartnerId"] = {"$in": values}
            return await self.find_many(
                filter, skip=skip, limit=limit, sort=[("cashCollectedAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting all cash settlements: {str(e)}")
            return []

    async def submit_settlement(
        self,
        settlement_id: str,
        method: str,
        reference: str,
        submitted_by: str,
    ) -> bool:
        """Partner files a settlement: method + bank/UTR reference."""
        try:
            return await self.update(
                {"_id": ObjectId(settlement_id)},
                {
                    "status": "submitted",
                    "method": method,
                    "reference": reference,
                    "submittedAt": datetime.utcnow(),
                    "submittedBy": submitted_by,
                },
            )
        except Exception as e:
            logger.error(f"Error submitting cash settlement: {str(e)}")
            return False

    async def verify_settlement(
        self,
        settlement_id: str,
        verified_by: str,
        notes: Optional[str] = None,
    ) -> bool:
        """Finance verified the transfer reference; money received."""
        try:
            return await self.update(
                {"_id": ObjectId(settlement_id)},
                {
                    "status": "verified",
                    "verifiedAt": datetime.utcnow(),
                    "verifiedBy": verified_by,
                    "verificationNotes": notes,
                },
            )
        except Exception as e:
            logger.error(f"Error verifying cash settlement: {str(e)}")
            return False

    async def reject_settlement(
        self,
        settlement_id: str,
        rejected_by: str,
        reason: str = "Reference could not be reconciled",
    ) -> bool:
        """Reject a submission that didn't reconcile; partner must re-submit."""
        try:
            return await self.update(
                {"_id": ObjectId(settlement_id)},
                {
                    "status": "rejected",
                    "rejectedAt": datetime.utcnow(),
                    "rejectedBy": rejected_by,
                    "rejectionReason": reason,
                },
            )
        except Exception as e:
            logger.error(f"Error rejecting cash settlement: {str(e)}")
            return False

    async def mark_remitted(self, settlement_id: str, remitted_by: str) -> bool:
        """Legacy: mark a settlement as remitted to the platform without verification."""
        try:
            return await self.update(
                {"_id": ObjectId(settlement_id)},
                {
                    "status": "remitted",
                    "remittedAt": datetime.utcnow(),
                    "remittedBy": remitted_by,
                },
            )
        except Exception as e:
            logger.error(f"Error marking cash settlement remitted: {str(e)}")
            return False

    async def admin_summary(self) -> Dict[str, Any]:
        """Aggregate dashboard numbers across all partners (admin finance view)."""
        try:
            start_today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            due_hours = getattr(settings, "COD_SETTLEMENT_DUE_HOURS", 24)
            cutoff = datetime.utcnow() - timedelta(hours=due_hours)
            pipeline = [
                {"$match": {"deletedAt": None}},
                {"$group": {
                    "_id": None,
                    "todaysCOD": {
                        "$sum": {"$cond": [{"$gte": ["$cashCollectedAt", start_today]}, "$amount", 0.0]}
                    },
                    "collected": {"$sum": "$amount"},
                    "settled": {
                        "$sum": {
                            "$cond": [{"$in": ["$status", ["verified", "remitted"]]}, "$amountToRemit", 0.0]
                        }
                    },
                    "pendingRemit": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["pending_remit", "rejected", "submitted"]]},
                                "$amountToRemit",
                                0.0,
                            ]
                        }
                    },
                    "inVerification": {
                        "$sum": {
                            "$cond": [{"$eq": ["$status", "submitted"]}, "$amountToRemit", 0.0]
                        }
                    },
                    "overdue": {
                        "$sum": {
                            "$cond": [
                                {
                                    "$and": [
                                        {"$in": ["$status", ["pending_remit", "rejected"]]},
                                        {"$lt": ["$cashCollectedAt", cutoff]},
                                    ]
                                },
                                "$amountToRemit",
                                0.0,
                            ]
                        }
                    },
                }},
            ]
            result = await self.aggregate(pipeline)
            row = result[0] if result else {}
            return {
                "todaysCOD": round(float(row.get("todaysCOD", 0) or 0), 2),
                "collected": round(float(row.get("collected", 0) or 0), 2),
                "settled": round(float(row.get("settled", 0) or 0), 2),
                "pendingRemit": round(float(row.get("pendingRemit", 0) or 0), 2),
                "inVerification": round(float(row.get("inVerification", 0) or 0), 2),
                "overdue": round(float(row.get("overdue", 0) or 0), 2),
            }
        except Exception as e:
            logger.error(f"Error building cash settlement admin summary: {str(e)}")
            return {
                "todaysCOD": 0.0,
                "collected": 0.0,
                "settled": 0.0,
                "pendingRemit": 0.0,
                "inVerification": 0.0,
                "overdue": 0.0,
            }

    async def partners_outstanding(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Per-partner outstanding owed to the platform (admin finance view)."""
        try:
            pipeline = [
                {"$match": {"deletedAt": None}},
                {"$group": {
                    "_id": "$deliveryPartnerId",
                    "outstanding": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$status", ["pending_remit", "rejected", "submitted"]]},
                                "$amountToRemit",
                                0.0,
                            ]
                        }
                    },
                    "orderCount": {"$sum": 1},
                }},
                {"$sort": {"outstanding": -1}},
                {"$limit": limit},
            ]
            return await self.aggregate(pipeline)
        except Exception as e:
            logger.error(f"Error getting partners outstanding: {str(e)}")
            return []


cash_settlement_repository = CashSettlementRepository()
