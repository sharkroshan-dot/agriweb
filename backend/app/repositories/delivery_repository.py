from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
from app.schemas.delivery import DeliveryPartnerStatus
import logging
import math
import httpx

logger = logging.getLogger(__name__)

# OSRM public road-routing server (free, no API key). Replaced per deployment via
# platform settings "roadDistanceUrl" if needed.
ROAD_ROUTING_URL = "https://router.project-osrm.org/route/v1/driving"
ROAD_ROUTING_TIMEOUT = 8.0


def vincenty_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """WGS-84 ellipsoidal geodesic distance (Vincenty inverse formula).

    Far more accurate than the spherical haversine approximation (error is in
    millimetres vs ~0.5% for haversine). Falls back to haversine on divergence.
    """
    a = 6378137.0                     # WGS-84 semi-major axis
    f = 1.0 / 298.257223563           # WGS-84 flattening
    b = (1.0 - f) * a                 # semi-minor axis

    if lat1 == lat2 and lon1 == lon2:
        return 0.0

    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    L = math.radians(lon2 - lon1)

    U1 = math.atan((1.0 - f) * math.tan(phi1))
    U2 = math.atan((1.0 - f) * math.tan(phi2))
    sin_u1, cos_u1 = math.sin(U1), math.cos(U1)
    sin_u2, cos_u2 = math.sin(U2), math.cos(U2)

    lam = L
    lam_prev = 0.0
    iterations = 0
    sin_sigma = 0.0
    cos_sigma = 1.0
    cos_sq_alpha = 1.0
    while abs(lam - lam_prev) > 1e-12 and iterations < 200:
        sin_lam, cos_lam = math.sin(lam), math.cos(lam)
        sin_sigma = math.hypot(
            cos_u2 * sin_lam,
            cos_u1 * sin_u2 - sin_u1 * cos_u2 * cos_lam,
        )
        if sin_sigma == 0.0:
            return 0.0
        cos_sigma = sin_u1 * sin_u2 + cos_u1 * cos_u2 * cos_lam
        sigma = math.atan2(sin_sigma, cos_sigma)
        sin_alpha = cos_u1 * cos_u2 * sin_lam / sin_sigma
        cos_sq_alpha = 1.0 - sin_alpha ** 2
        cos_2sigma_m = (
            cos_sigma - 2.0 * sin_u1 * sin_u2 / cos_sq_alpha
            if cos_sq_alpha else 0.0
        )
        c_factor = f / 16.0 * cos_sq_alpha * (4.0 + f * (4.0 - 3.0 * cos_sq_alpha))
        lam_prev = lam
        lam = L + (1.0 - c_factor) * f * sin_alpha * (
            sigma
            + c_factor * sin_sigma * (
                cos_2sigma_m + c_factor * cos_sigma * (-1.0 + 2.0 * cos_2sigma_m ** 2)
            )
        )
        iterations += 1

    if iterations >= 200:
        # Did not converge (e.g., near-antipodal points). Fall back to haversine.
        return _haversine_km(lat1, lon1, lat2, lon2)

    u_sq = cos_sq_alpha * (a ** 2 - b ** 2) / b ** 2
    a_factor = 1.0 + u_sq / 16384.0 * (4096.0 + u_sq * (-768.0 + u_sq * (320.0 - 175.0 * u_sq)))
    b_factor = u_sq / 1024.0 * (256.0 + u_sq * (-128.0 + u_sq * (74.0 - 47.0 * u_sq)))
    delta_sigma = b_factor * sin_sigma * (
        cos_2sigma_m
        + b_factor / 4.0 * (
            cos_sigma * (-1.0 + 2.0 * cos_2sigma_m ** 2)
            - b_factor / 6.0 * cos_2sigma_m * (-3.0 + 4.0 * sin_sigma ** 2) * (-3.0 + 4.0 * cos_2sigma_m ** 2)
        )
    )
    return b * a_factor * (sigma - delta_sigma) / 1000.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Spherical great-circle distance in km (last-resort fallback)."""
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

class DeliveryRepository(BaseRepository):
    """Delivery partner repository."""
    
    def __init__(self):
        super().__init__("delivery_profiles")
    
    async def create_profile(self, profile_data: Dict[str, Any]) -> Optional[str]:
        """Create delivery partner profile."""
        profile_data["createdAt"] = datetime.utcnow()
        profile_data["updatedAt"] = datetime.utcnow()
        profile_data["isAvailable"] = True
        profile_data["status"] = DeliveryPartnerStatus.AVAILABLE
        profile_data["rating"] = 0
        profile_data["totalDeliveries"] = 0
        return await self.create(profile_data)
    
    async def get_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get delivery partner by user ID."""
        try:
            return await self.find_one({
                "userId": ObjectId(user_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting delivery partner: {str(e)}")
            return None
    
    async def get_by_id(self, partner_id: str) -> Optional[Dict[str, Any]]:
        """Get delivery partner by ID."""
        try:
            obj_id = ObjectId(partner_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting delivery partner: {str(e)}")
            return None
    
    async def get_available_partners(
        self,
        location: Optional[Dict[str, Any]] = None,
        radius: Optional[int] = None,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get available delivery partners."""
        filter = {
            "isAvailable": True,
            "status": DeliveryPartnerStatus.AVAILABLE,
            "isVerified": True,
            "deletedAt": None
        }
        
        if location and radius:
            filter["currentLocation"] = {
                "$near": {
                    "$geometry": location,
                    "$maxDistance": radius * 1000
                }
            }
        
        return await self.find_many(
            filter,
            limit=limit,
            sort=[("rating", -1)]
        )
    
    async def update_location(
        self,
        partner_id: str,
        location: Dict[str, Any]
    ) -> bool:
        """Update delivery partner location."""
        try:
            obj_id = ObjectId(partner_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "currentLocation": location,
                    "lastLocationUpdate": datetime.utcnow(),
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error updating location: {str(e)}")
            return False
    
    async def update_status(
        self,
        partner_id: str,
        status: DeliveryPartnerStatus,
        is_available: bool = True
    ) -> bool:
        """Update delivery partner status."""
        try:
            obj_id = ObjectId(partner_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "status": status,
                    "isAvailable": is_available,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error updating status: {str(e)}")
            return False
    
    async def update_rating(
        self,
        partner_id: str,
        new_rating: float
    ) -> Dict[str, Any]:
        """Update delivery partner rating."""
        try:
            obj_id = ObjectId(partner_id)
            partner = await self.get_by_id(partner_id)
            if not partner:
                return {}
            
            current_rating = partner.get("rating", 0)
            total_deliveries = partner.get("totalDeliveries", 0)
            
            new_total = total_deliveries + 1
            new_avg = ((current_rating * total_deliveries) + new_rating) / new_total
            
            await self.update(
                {"_id": obj_id},
                {
                    "rating": round(new_avg, 1),
                    "totalDeliveries": new_total,
                    "updatedAt": datetime.utcnow()
                }
            )
            
            return {
                "rating": round(new_avg, 1),
                "totalDeliveries": new_total
            }
        except Exception as e:
            logger.error(f"Error updating rating: {str(e)}")
            return {}
    
    async def refresh_rating_stats(self, partner_id: str) -> Dict[str, Any]:
        """Recompute the partner's aggregated rating stats from delivery_ratings.

        Stores the overall average on the profile (``rating``) plus a
        ``ratingCount`` so existing dashboards keep working while the full
        breakdown lives in the delivery_ratings collection.
        """
        try:
            from app.repositories.delivery_rating_repository import delivery_rating_repository
            obj_id = ObjectId(partner_id)
            summary = await delivery_rating_repository.get_summary(partner_id)
            rating = summary.get("overallAvg", 0)
            rating_count = summary.get("count", 0)
            await self.update(
                {"_id": obj_id},
                {
                    "rating": round(rating, 1),
                    "ratingCount": rating_count,
                    "updatedAt": datetime.utcnow()
                }
            )
            return {
                "rating": round(rating, 1),
                "ratingCount": rating_count,
                "summary": summary
            }
        except Exception as e:
            logger.error(f"Error refreshing rating stats: {str(e)}")
            return {"rating": 0, "ratingCount": 0}

    async def get_nearby_partners(
        self,
        lat: float,
        lng: float,
        radius: int,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get nearby available delivery partners."""
        location = {
            "type": "Point",
            "coordinates": [lng, lat]
        }
        
        return await self.get_available_partners(location, radius, limit)
    
    async def calculate_distance(
        self,
        from_location: Dict[str, Any],
        to_location: Dict[str, Any]
    ) -> float:
        """Calculate distance between two points in km.

        Priority:
          1. Real road distance via OSRM routing (when enabled in platform
             settings and network is available).
          2. Vincenty ellipsoidal geodesic (accurate straight-line distance).
          3. Haversine spherical fallback.
        """
        coords1 = from_location.get("coordinates", [0, 0])
        coords2 = to_location.get("coordinates", [0, 0])
        try:
            lat1, lon1 = float(coords1[1]), float(coords1[0])
            lat2, lon2 = float(coords2[1]), float(coords2[0])
        except (TypeError, ValueError, IndexError):
            return 0.0

        if lat1 == lat2 and lon1 == lon2:
            return 0.0

        if await self._road_distance_enabled():
            try:
                return await self._road_distance_km(lon1, lat1, lon2, lat2)
            except Exception as e:
                logger.warning("Road distance failed (%s), using geodesic distance.", e)

        try:
            return vincenty_distance_km(lat1, lon1, lat2, lon2)
        except Exception as e:
            logger.warning("Vincenty distance failed (%s), using haversine.", e)
            return _haversine_km(lat1, lon1, lat2, lon2)

    async def _road_distance_enabled(self) -> bool:
        """Read the platform-wide road-distance toggle.

        Defaults to True once a settings document exists (key absent => on).
        Returns False when settings cannot be read (e.g. DB unavailable) so we
        never make external routing calls without configuration.
        """
        try:
            from app.repositories.settings_repository import platform_settings_repository
            doc = await platform_settings_repository.get_single()
        except Exception:
            return False
        if not doc:
            return False
        fees = ((doc.get("data") or {}).get("fees") or {})
        return bool(fees.get("useRoadDistance", True))

    async def _road_distance_km(self, lon1: float, lat1: float, lon2: float, lat2: float) -> float:
        """Real driving distance via OSRM public routing server."""
        url = f"{ROAD_ROUTING_URL}/{lon1},{lat1};{lon2},{lat2}"
        async with httpx.AsyncClient(timeout=ROAD_ROUTING_TIMEOUT) as client:
            resp = await client.get(url, params={"overview": "false"})
            resp.raise_for_status()
            data = resp.json()
            routes = data.get("routes") or []
            if not routes:
                raise ValueError("OSRM returned no routes")
            return float(routes[0]["distance"]) / 1000.0
    
    async def get_partner_stats(self, partner_id: str) -> Dict[str, Any]:
        """Get delivery partner statistics."""
        partner = await self.get_by_id(partner_id)
        if not partner:
            return {}
        
        from app.repositories.order_repository import order_repository
        orders = await order_repository.find_many({
            "deliveryPartnerId": ObjectId(partner_id),
            "deletedAt": None
        })
        
        total_orders = len(orders)
        delivered_orders = [o for o in orders if o.get("orderStatus") == "delivered"]
        cancelled_orders = [o for o in orders if o.get("orderStatus") == "cancelled"]
        
        total_earnings = sum(o.get("deliveryCharge", 0) for o in delivered_orders)
        
        # Today / week earnings
        now = datetime.utcnow()
        start_today = datetime(now.year, now.month, now.day)
        start_week = start_today - timedelta(days=start_today.weekday())
        
        today_earnings = 0
        week_earnings = 0
        for o in delivered_orders:
            at = o.get("deliveredAt") or o.get("orderDate")
            if at:
                if at >= start_today:
                    today_earnings += o.get("deliveryCharge", 0)
                if at >= start_week:
                    week_earnings += o.get("deliveryCharge", 0)
        
        on_time = 0
        for order in delivered_orders:
            assigned_time = order.get("assignedAt")
            delivered_time = order.get("deliveredAt")
            if assigned_time and delivered_time:
                diff = (delivered_time - assigned_time).total_seconds() / 60
                if diff <= 45:
                    on_time += 1
        
        on_time_percentage = (on_time / len(delivered_orders) * 100) if delivered_orders else 0

        # Delivery partner rating summary from the delivery_ratings collection
        from app.repositories.delivery_rating_repository import delivery_rating_repository
        rating_summary = await delivery_rating_repository.get_summary(partner_id)

        return {
            "totalDeliveries": total_orders,
            "completedDeliveries": len(delivered_orders),
            "pendingDeliveries": len([o for o in orders if o.get("orderStatus") in ["dispatched", "in_transit"]]),
            "cancelledDeliveries": len(cancelled_orders),
            "totalEarnings": total_earnings,
            "todayEarnings": today_earnings,
            "weekEarnings": week_earnings,
            "averageRating": partner.get("rating", rating_summary.get("overallAvg", 0)),
            "ratingCount": rating_summary.get("count", partner.get("ratingCount", 0)),
            "ratingSummary": {
                "overallAvg": rating_summary.get("overallAvg", 0),
                "onTimeAvg": rating_summary.get("onTimeAvg", 0),
                "professionalismAvg": rating_summary.get("professionalismAvg", 0),
                "handlingAvg": rating_summary.get("handlingAvg", 0),
                "communicationAvg": rating_summary.get("communicationAvg", 0),
                "onTimePercentage": rating_summary.get("onTimePercentage", 0),
                "distribution": rating_summary.get("distribution", {}),
            },
            "onTimeCount": on_time,
            "onTimeDelivery": round(on_time_percentage, 1),
            "isAvailable": partner.get("isAvailable", True),
            "status": partner.get("status", "offline")
        }


delivery_repository = DeliveryRepository()
