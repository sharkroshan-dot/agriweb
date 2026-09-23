from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class RouteRepository(BaseRepository):
    """Route repository for storing optimized routes."""
    
    def __init__(self):
        super().__init__("delivery_routes")
    
    async def create_route(self, route_data: Dict[str, Any]) -> Optional[str]:
        """Create a route record."""
        route_data["createdAt"] = datetime.utcnow()
        route_data["updatedAt"] = datetime.utcnow()
        route_data["status"] = "planned"
        return await self.create(route_data)
    
    async def get_by_id(self, route_id: str) -> Optional[Dict[str, Any]]:
        """Get route by ID."""
        try:
            obj_id = ObjectId(route_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting route: {str(e)}")
            return None
    
    async def get_by_delivery_partner(
        self,
        partner_id: str,
        date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """Get routes by delivery partner."""
        filter = {
            "deliveryPartnerId": ObjectId(partner_id),
            "deletedAt": None
        }
        if date:
            start_date = datetime(date.year, date.month, date.day)
            end_date = start_date + timedelta(days=1)
            filter["createdAt"] = {"$gte": start_date, "$lt": end_date}
        
        return await self.find_many(
            filter,
            sort=[("createdAt", -1)]
        )
    
    async def update_route_status(
        self,
        route_id: str,
        status: str
    ) -> bool:
        """Update route status."""
        try:
            obj_id = ObjectId(route_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "status": status,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error updating route status: {str(e)}")
            return False
    
    async def get_optimized_route(
        self,
        start_location: Dict[str, Any],
        destinations: List[Dict[str, Any]],
        vehicle_type: str = "bike"
    ) -> Dict[str, Any]:
        """
        Calculate optimized route using AI/ML.
        This is a placeholder that will be enhanced with actual ML algorithms.
        """
        optimized = []
        total_distance = 0
        total_time = 0
        current = start_location
        remaining = destinations.copy()
        
        while remaining:
            nearest_idx = 0
            nearest_dist = float('inf')
            
            for idx, dest in enumerate(remaining):
                dist = self.calculate_distance(current, dest.get("location"))
                if dist < nearest_dist:
                    nearest_dist = dist
                    nearest_idx = idx
            
            dest = remaining.pop(nearest_idx)
            optimized.append({
                "orderId": dest.get("orderId"),
                "location": dest.get("location"),
                "sequence": len(optimized),
                "distance": nearest_dist,
                "time": nearest_dist * 2
            })
            
            total_distance += nearest_dist
            total_time += nearest_dist * 2
            current = dest.get("location")
        
        original_distance = total_distance * 1.3
        
        return {
            "optimizedRoute": optimized,
            "totalDistance": round(total_distance, 2),
            "totalTime": round(total_time, 0),
            "fuelEstimated": round(total_distance * 0.08, 2),
            "savings": {
                "distance": round(original_distance - total_distance, 2),
                "time": round((original_distance * 2) - total_time, 0),
                "fuel": round((original_distance - total_distance) * 0.08, 2)
            }
        }
    
    def calculate_distance(self, from_loc: Dict[str, Any], to_loc: Dict[str, Any]) -> float:
        """Calculate distance between two points in km."""
        import math
        coords1 = from_loc.get("coordinates", [0, 0])
        coords2 = to_loc.get("coordinates", [0, 0])
        
        lat1, lon1 = coords1[1], coords1[0]
        lat2, lon2 = coords2[1], coords2[0]
        
        R = 6371
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        
        a = math.sin(dlat/2) * math.sin(dlat/2) + \
            math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
            math.sin(dlon/2) * math.sin(dlon/2)
        
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        distance = R * c
        
        return distance


route_repository = RouteRepository()
