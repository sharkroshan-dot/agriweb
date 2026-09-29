"""Settlement lifecycle for farmer and delivery earnings.

Payment splits remain the source of calculated amounts; settlements provide an
explicit operational state machine for reconciliation and payout tracking.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from bson import ObjectId
from app.repositories.base_repository import BaseRepository

settlement_repository = BaseRepository("settlements")

VALID_STATUSES = ("pending", "approved", "processing", "paid", "failed", "reversed")


class SettlementService:
    @staticmethod
    async def create_for_payment(payment_id: str) -> List[Dict[str, Any]]:
        from app.repositories.payment_split_repository import payment_split_repository
        split = await payment_split_repository.get_by_payment_id(payment_id)
        if not split:
            return []

        created = []
        for item in split.get("splits", []):
            party = item.get("party")
            party_id = item.get("partyId")
            amount = float(item.get("amount") or 0)
            if party not in ("farmer", "delivery") or not party_id or amount <= 0:
                continue

            existing = await settlement_repository.find_one({
                "paymentId": ObjectId(payment_id),
                "party": party,
                "partyId": ObjectId(str(party_id)),
                "deletedAt": None,
            })
            if existing:
                created.append(existing)
                continue

            doc = {
                "paymentId": ObjectId(payment_id),
                "orderId": split.get("orderId"),
                "party": party,
                "partyId": ObjectId(str(party_id)),
                "amount": round(amount, 2),
                "currency": "INR",
                "status": "approved",
                "calculatedAt": datetime.utcnow(),
                "approvedAt": datetime.utcnow(),
                "createdAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
            }
            sid = await settlement_repository.create(doc)
            if sid:
                doc["_id"] = ObjectId(sid)
                created.append(doc)
        return created

    @staticmethod
    async def list_for_user(user_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
        query = {"partyId": ObjectId(user_id), "deletedAt": None}
        if status:
            query["status"] = status
        rows = await settlement_repository.find_many(query, sort=[("createdAt", -1)], limit=200)
        for row in rows:
            row["id"] = str(row["_id"])
            row["paymentId"] = str(row.get("paymentId")) if row.get("paymentId") else None
            row["orderId"] = str(row.get("orderId")) if row.get("orderId") else None
            row["partyId"] = str(row.get("partyId")) if row.get("partyId") else None
        return rows

    @staticmethod
    async def admin_update(settlement_id: str, status: str, admin_id: str, note: Optional[str] = None) -> Optional[Dict[str, Any]]:
        if status not in VALID_STATUSES:
            return None
        row = await settlement_repository.get_by_id(settlement_id)
        if not row:
            return None
        now = datetime.utcnow()
        update: Dict[str, Any] = {
            "status": status,
            "updatedAt": now,
            "updatedBy": ObjectId(admin_id),
        }
        if status == "approved":
            update["approvedAt"] = now
        elif status == "processing":
            update["processingAt"] = now
        elif status == "paid":
            update["paidAt"] = now
        elif status == "failed":
            update["failedAt"] = now
        elif status == "reversed":
            update["reversedAt"] = now
        if note:
            update["note"] = note
        await settlement_repository.update({"_id": ObjectId(settlement_id)}, update)
        return await settlement_repository.get_by_id(settlement_id)
