from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

JOB_OPEN = "open"
JOB_ACCEPTED = "accepted"
JOB_EXPIRED = "expired"
JOB_NO_PARTNER_FOUND = "no_partner_found"
JOB_CANCELLED = "cancelled"
JOB_DELIVERED = "delivered"

# Statuses that still count as an active load on a partner.
_ACTIVE_JOB_STATUSES = (JOB_ACCEPTED,)


class DeliveryJobRepository(BaseRepository):
    """Delivery job repository (collection: delivery_jobs).

    A delivery job is the marketplace representation of an order that the
    farmer has opened to delivery partners. The job row is the single source
    of truth for who may accept the delivery: acceptance is an atomic
    compare-and-set on ``status`` so concurrent partners can never both win.
    """

    def __init__(self):
        super().__init__("delivery_jobs")

    async def create_job(self, job_data: Dict[str, Any]) -> Optional[str]:
        """Insert (or replace the row for) a job for an order."""
        now = datetime.utcnow()
        job_data.setdefault("openedAt", now)
        job_data.setdefault("expiresAt", now + timedelta(hours=2))
        job_data.setdefault("status", JOB_OPEN)
        job_data.setdefault("createdAt", now)
        job_data.setdefault("updatedAt", now)
        job_data["deletedAt"] = None
        try:
            await self.collection.update_one(
                {"orderId": ObjectId(job_data["orderId"]), "deletedAt": None},
                {"$set": job_data},
                upsert=True,
            )
            existing = await self.collection.find_one(
                {"orderId": ObjectId(job_data["orderId"]), "deletedAt": None}
            )
            return str(existing["_id"]) if existing else None
        except Exception as e:
            logger.error(f"Error upserting delivery job: {str(e)}")
            return None

    async def get_by_order_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting job by order {order_id}: {str(e)}")
            return None

    async def get_by_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self.find_one({"_id": ObjectId(job_id), "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting job {job_id}: {str(e)}")
            return None

    async def get_jobs_by_farmer(self, farmer_id: str) -> List[Dict[str, Any]]:
        """Every (non-deleted) job belonging to a farmer, newest first."""
        try:
            return await self.find_many(
                {"farmerId": ObjectId(farmer_id), "deletedAt": None},
                sort=[("openedAt", -1)],
            )
        except Exception as e:
            logger.error(f"Error listing jobs for farmer {farmer_id}: {str(e)}")
            return []

    async def get_jobs_for_partner(self, partner_id: str) -> List[Dict[str, Any]]:
        """Jobs this partner accepted (for their 'my jobs' list)."""
        try:
            return await self.find_many(
                {"acceptedBy": ObjectId(partner_id), "deletedAt": None},
                sort=[("acceptedAt", -1)],
            )
        except Exception as e:
            logger.error(f"Error listing jobs for partner {partner_id}: {str(e)}")
            return []

    async def find_open_jobs_near(
        self,
        lng: float,
        lat: float,
        radius_km: float,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Open, unexpired jobs whose pickup point is near a location.

        Uses the 2dsphere index on ``pickupLocation``.
        """
        now = datetime.utcnow()
        try:
            return await self.find_many(
                {
                    "status": JOB_OPEN,
                    "expiresAt": {"$gt": now},
                    "deletedAt": None,
                    "pickupLocation": {
                        "$near": {
                            "$geometry": {
                                "type": "Point",
                                "coordinates": [float(lng), float(lat)],
                            },
                            "$maxDistance": radius_km * 1000,
                        }
                    },
                },
                limit=limit,
            )
        except Exception as e:
            logger.error(f"Error in open-jobs geospatial query: {str(e)}")
            return []

    async def claim_job(self, job_id: str, partner_id: str) -> bool:
        """Atomically claim an open job for a partner.

        Compare-and-set on ``status``: only the first caller to transition the
        job from ``open`` to ``accepted`` wins.
        """
        try:
            now = datetime.utcnow()
            result = await self.collection.update_one(
                {"_id": ObjectId(job_id), "status": JOB_OPEN, "deletedAt": None},
                {
                    "$set": {
                        "status": JOB_ACCEPTED,
                        "acceptedBy": ObjectId(partner_id),
                        "acceptedAt": now,
                        "updatedAt": now,
                    }
                },
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error claiming job {job_id}: {str(e)}")
            return False

    async def release_job(self, job_id: str) -> bool:
        """Return a claimed job to open (used when the order update fails)."""
        try:
            now = datetime.utcnow()
            result = await self.collection.update_one(
                {"_id": ObjectId(job_id), "status": JOB_ACCEPTED, "deletedAt": None},
                {"$set": {"status": JOB_OPEN, "acceptedBy": None, "acceptedAt": None, "updatedAt": now}},
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error releasing job {job_id}: {str(e)}")
            return False

    async def mark_no_partner_found(self, job_id: str) -> bool:
        try:
            now = datetime.utcnow()
            result = await self.collection.update_one(
                {"_id": ObjectId(job_id), "status": JOB_OPEN, "deletedAt": None},
                {"$set": {"status": JOB_NO_PARTNER_FOUND, "updatedAt": now}},
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error marking job {job_id} no-partner-found: {str(e)}")
            return False

    async def sweep_expired(self, farmer_id: str) -> int:
        """Mark every expired open job of the farmer as no-partner-found."""
        now = datetime.utcnow()
        try:
            expired = await self.find_many(
                {
                    "farmerId": ObjectId(farmer_id),
                    "status": JOB_OPEN,
                    "expiresAt": {"$lte": now},
                    "deletedAt": None,
                }
            )
            count = 0
            for job in expired or []:
                if await self.mark_no_partner_found(str(job["_id"])):
                    count += 1
            return count
        except Exception as e:
            logger.error(f"Error sweeping expired jobs for farmer {farmer_id}: {str(e)}")
            return 0

    async def extend_expiry(self, job_id: str, minutes: int) -> bool:
        try:
            now = datetime.utcnow()
            result = await self.collection.update_one(
                {"_id": ObjectId(job_id), "deletedAt": None},
                {"$set": {"status": JOB_OPEN, "expiresAt": now + timedelta(minutes=minutes), "updatedAt": now}},
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error extending job {job_id}: {str(e)}")
            return False

    async def cancel_by_order(self, order_id: str, reason: str = "") -> bool:
        try:
            now = datetime.utcnow()
            result = await self.collection.update_one(
                {"orderId": ObjectId(order_id), "deletedAt": None},
                {"$set": {"status": JOB_CANCELLED, "cancelledAt": now, "cancelledReason": reason, "updatedAt": now}},
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error cancelling job for order {order_id}: {str(e)}")
            return False

    async def sync_order_status(self, job_id: str, order_status: str) -> bool:
        """Mirror the order's pipeline stage (processing/ready_for_delivery/...) onto the job."""
        try:
            now = datetime.utcnow()
            result = await self.collection.update_one(
                {"_id": ObjectId(job_id), "deletedAt": None},
                {"$set": {"orderStatus": order_status, "updatedAt": now}},
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error syncing order status onto job {job_id}: {str(e)}")
            return False

    async def complete_by_order(self, order_id: str) -> bool:
        try:
            now = datetime.utcnow()
            result = await self.collection.update_one(
                {"orderId": ObjectId(order_id), "deletedAt": None},
                {"$set": {"status": JOB_DELIVERED, "completedAt": now, "updatedAt": now}},
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error completing job for order {order_id}: {str(e)}")
            return False

    async def count_active_for_partner(self, partner_id: str) -> int:
        try:
            return await self.count({
                "acceptedBy": ObjectId(partner_id),
                "status": {"$in": list(_ACTIVE_JOB_STATUSES)},
                "deletedAt": None,
            })
        except Exception as e:
            logger.error(f"Error counting active jobs for partner {partner_id}: {str(e)}")
            return 0

    async def active_weight_for_partner(self, partner_id: str) -> float:
        """Total kg currently committed to a partner across accepted jobs."""
        try:
            cursor = self.collection.find({
                "acceptedBy": ObjectId(partner_id),
                "status": {"$in": list(_ACTIVE_JOB_STATUSES)},
                "deletedAt": None,
            }, {"weightKg": 1})
            total = 0.0
            async for doc in cursor:
                total += float(doc.get("weightKg") or 0)
            return total
        except Exception as e:
            logger.error(f"Error computing active weight for partner {partner_id}: {str(e)}")
            return 0.0

    async def notified_partner_ids(self, job_id: str) -> List[str]:
        """Ids stored on the job at open time (for removal broadcasts)."""
        try:
            job = await self.get_by_id(job_id)
            if not job:
                return []
            return [str(p) for p in (job.get("eligiblePartnerIds") or [])]
        except Exception as e:
            logger.error(f"Error reading eligible partners for job {job_id}: {str(e)}")
            return []


delivery_job_repository = DeliveryJobRepository()
