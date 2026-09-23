"""Backfill legacy delivery assignments stuck in the old 'accepted' state.

Accepting a delivery used to move the assignment to 'accepted' (and the order
to 'dispatched'), which made accepted orders show as 'accepted' in the UI and
blocked the Delivered action. The accept flow now moves orders straight to
'in_transit'. This script migrates any leftover 'accepted' assignments (and
their linked 'dispatched' orders) to 'in_transit'.

Run from the backend directory:
    python -m scripts.backfill_accepted_deliveries
or:
    python scripts/backfill_accepted_deliveries.py
"""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

from bson import ObjectId

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database.mongodb import MongoDB  # noqa: E402


async def main() -> int:
    await MongoDB.connect()
    try:
        assignments = MongoDB.get_collection("delivery_assignments")
        orders = MongoDB.get_collection("orders")

        cursor = assignments.find({"status": "accepted", "deletedAt": None})
        now = datetime.utcnow()

        assignment_count = 0
        order_ids = []
        async for assignment in cursor:
            result = await assignments.update_one(
                {"_id": assignment["_id"], "status": "accepted"},
                {"$set": {"status": "in_transit", "updatedAt": now}}
            )
            if result.modified_count:
                assignment_count += 1
                oid = assignment.get("orderId")
                if oid:
                    order_ids.append(oid)

        order_count = 0
        for oid in order_ids:
            try:
                obj_id = ObjectId(oid)
            except Exception:
                continue
            result = await orders.update_one(
                {"_id": obj_id, "orderStatus": "dispatched"},
                {"$set": {"orderStatus": "in_transit", "updatedAt": now}}
            )
            if result.modified_count:
                order_count += 1

        print(f"Backfilled {assignment_count} assignment(s) and {order_count} order(s) to in_transit.")
        return 0
    finally:
        await MongoDB.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
