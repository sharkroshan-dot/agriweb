from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.delivery_repository import delivery_repository
from app.repositories.delivery_assignment_repository import delivery_assignment_repository
from app.repositories.route_repository import route_repository
from app.repositories.order_repository import order_repository
from app.schemas.delivery import (
    DeliveryPartnerCreate, DeliveryPartnerUpdate,
    DeliveryAssignmentCreate, DeliveryAssignmentUpdate,
    DeliveryStatus, DeliveryPartnerStatus,
    RouteOptimizationRequest
)
from app.services.notification_service import NotificationService
from app.services.payment_service import PaymentService
import logging

logger = logging.getLogger(__name__)

class DeliveryService:
    """Delivery service with business logic."""
    
    @staticmethod
    async def create_delivery_partner(
        user_id: str,
        data: DeliveryPartnerCreate
    ) -> Optional[Dict[str, Any]]:
        """Create a delivery partner profile."""
        existing = await delivery_repository.get_by_user_id(user_id)
        if existing:
            return None
        
        profile_data = data.dict()
        profile_data["userId"] = ObjectId(user_id)
        
        partner_id = await delivery_repository.create_profile(profile_data)
        if not partner_id:
            return None
        
        return await delivery_repository.get_by_id(partner_id)
    
    @staticmethod
    async def get_delivery_partner(user_id: str) -> Optional[Dict[str, Any]]:
        """Get delivery partner by user ID."""
        return await delivery_repository.get_by_user_id(user_id)
    
    @staticmethod
    async def update_delivery_partner(
        partner_id: str,
        data: DeliveryPartnerUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update delivery partner."""
        partner = await delivery_repository.get_by_id(partner_id)
        if not partner:
            return None
        
        update_data = data.dict(exclude_unset=True)
        success = await delivery_repository.update(
            {"_id": ObjectId(partner_id)},
            update_data
        )
        
        if not success:
            return None
        
        return await delivery_repository.get_by_id(partner_id)
    
    @staticmethod
    async def update_location(
        partner_id: str,
        lat: float,
        lng: float
    ) -> bool:
        """Update delivery partner's current location."""
        location = {
            "type": "Point",
            "coordinates": [lng, lat]
        }
        return await delivery_repository.update_location(partner_id, location)
    
    @staticmethod
    async def update_status(
        partner_id: str,
        status: DeliveryPartnerStatus,
        is_available: bool = True
    ) -> bool:
        """Update delivery partner status."""
        return await delivery_repository.update_status(partner_id, status, is_available)
    
    @staticmethod
    async def find_nearest_partner(
        location: Optional[Dict[str, Any]],
        radius: int = 10
    ) -> Optional[Dict[str, Any]]:
        partners = await delivery_repository.get_available_partners(
            location,
            radius,
            limit=1
        )
        
        return partners[0] if partners else None
    
    @staticmethod
    async def calculate_delivery_fee(
        from_location: Dict[str, Any],
        to_location: Dict[str, Any],
        weight_kg: float = 0.0,
        method: str = "farmer"
    ) -> float:
        """Calculate delivery fee based on distance (delegates to the fee engine)."""
        from app.services.delivery_fee_service import delivery_fee_service
        quote = await delivery_fee_service.calculate_delivery_fee(
            from_location=from_location,
            to_location=to_location,
            weight_kg=weight_kg,
            method=method,
        )
        return quote["fee"]
    
    @staticmethod
    async def assign_delivery(
        order_id: str,
        partner_id: Optional[str] = None,
        auto_assign: bool = True
    ) -> Optional[Dict[str, Any]]:
        """Assign delivery to a partner."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            return None
        
        existing = await delivery_assignment_repository.get_by_order_id(order_id)
        if existing:
            return existing
        
        if not partner_id and auto_assign:
            delivery_address = order.get("deliveryAddress", {})
            location = delivery_address.get("location")
            partner = await DeliveryService.find_nearest_partner(location)
            if partner:
                partner_id = str(partner["_id"])
        
        if not partner_id:
            return None
        
        assignment_data = {
            "orderId": ObjectId(order_id),
            "deliveryPartnerId": ObjectId(partner_id),
            "status": DeliveryStatus.ASSIGNED
        }
        
        assignment_id = await delivery_assignment_repository.create_assignment(assignment_data)
        if not assignment_id:
            return None
        
        await order_repository.update(
            {"_id": ObjectId(order_id)},
            {
                "deliveryPartnerId": ObjectId(partner_id),
                "orderStatus": "dispatched",
                "assignedAt": datetime.utcnow()
            }
        )
        
        assignment = await delivery_assignment_repository.get_by_id(assignment_id)
        await NotificationService.send_delivery_assignment(
            partner_id,
            order_id
        )
        
        return assignment
    
    @staticmethod
    async def accept_delivery(
        assignment_id: str,
        partner_id: str
    ) -> Optional[Dict[str, Any]]:
        """Accept delivery assignment and move it to in-transit."""
        assignment = await delivery_assignment_repository.get_by_id(assignment_id)
        if not assignment:
            return None
        
        if str(assignment["deliveryPartnerId"]) != partner_id:
            return None
        
        success = await delivery_assignment_repository.update_status(
            assignment_id,
            DeliveryStatus.IN_TRANSIT
        )
        
        if not success:
            return None
        
        await delivery_repository.update_status(
            partner_id,
            DeliveryPartnerStatus.BUSY,
            is_available=False
        )
        
        await order_repository.update_order_status(
            str(assignment["orderId"]),
            "in_transit",
            partner_id,
            "Delivery accepted by partner"
        )
        
        return await delivery_assignment_repository.get_by_id(assignment_id)
    
    @staticmethod
    async def pick_up_delivery(
        assignment_id: str,
        partner_id: str,
        location: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """Mark delivery as picked up."""
        assignment = await delivery_assignment_repository.get_by_id(assignment_id)
        if not assignment:
            return None
        
        if str(assignment["deliveryPartnerId"]) != partner_id:
            return None
        
        success = await delivery_assignment_repository.update_status(
            assignment_id,
            DeliveryStatus.PICKED_UP,
            {"location": location} if location else None
        )
        
        if not success:
            return None
        
        await order_repository.update_order_status(
            str(assignment["orderId"]),
            "in_transit",
            partner_id,
            "Package picked up"
        )
        
        if location:
            await delivery_repository.update_location(
                partner_id,
                location
            )
        
        order = await order_repository.get_by_id(str(assignment["orderId"]))
        if order:
            await NotificationService.send_order_in_transit(
                str(order["customerId"]),
                str(assignment["orderId"]) 
            )
        
        return await delivery_assignment_repository.get_by_id(assignment_id)
    
    @staticmethod
    async def deliver_order(
        assignment_id: str,
        partner_id: str,
        otp: str,
        delivery_photo: Optional[str] = None,
        location: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """Mark order as delivered."""
        assignment = await delivery_assignment_repository.get_by_id(assignment_id)
        if not assignment:
            return None
        
        if str(assignment["deliveryPartnerId"]) != partner_id:
            return None
        
        order = await order_repository.get_by_id(str(assignment["orderId"]))
        if not order:
            return None
        
        if len(otp) != 4 or not otp.isdigit():
            return None
        
        success = await delivery_assignment_repository.update_status(
            assignment_id,
            DeliveryStatus.DELIVERED,
            {
                "deliveryPhoto": delivery_photo,
                "location": location,
                "otp": otp
            }
        )
        
        if not success:
            return None
        
        await order_repository.update_order_status(
            str(assignment["orderId"]),
            "delivered",
            partner_id,
            "Order delivered"
        )

        try:
            from app.repositories.delivery_job_repository import delivery_job_repository
            await delivery_job_repository.complete_by_order(str(assignment["orderId"]))
        except Exception as e:
            logger.warning(f"Failed to complete delivery job for order {assignment['orderId']}: {e}")
        
        await delivery_repository.update_rating(partner_id, 5)
        
        await delivery_repository.update_status(
            partner_id,
            DeliveryPartnerStatus.AVAILABLE,
            is_available=True
        )
        
        await PaymentService.process_delivery_payment(str(assignment["orderId"]))
        
        if order:
            await NotificationService.send_order_delivered(
                str(order["customerId"]),
                str(assignment["orderId"])
            )
            if order.get("farmerId"):
                await NotificationService.send_order_delivered_to_farmer(
                    str(order["farmerId"]),
                    order,
                    delivery_photo
                )
        
        await NotificationService.send_delivery_completed(
            partner_id,
            str(assignment["orderId"])
        )
        
        return await delivery_assignment_repository.get_by_id(assignment_id)
    
    @staticmethod
    async def get_assignment_by_order(
        order_id: str,
        partner_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Get delivery assignment by order ID."""
        assignment = await delivery_assignment_repository.get_by_order_id(order_id)
        if not assignment:
            return None
        
        if partner_id and str(assignment["deliveryPartnerId"]) != partner_id:
            return None
        
        return assignment
    
    @staticmethod
    async def get_partner_deliveries(
        partner_id: str,
        date: Optional[datetime] = None,
        status: Optional[DeliveryStatus] = None,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get deliveries for a partner."""
        return await delivery_assignment_repository.get_by_delivery_partner(
            partner_id,
            status,
            date,
            skip,
            limit
        )
    
    @staticmethod
    async def optimize_route(
        request: RouteOptimizationRequest
    ) -> Dict[str, Any]:
        """Optimize delivery route."""
        route = await route_repository.get_optimized_route(
            request.startLocation,
            request.destinations,
            request.vehicleType
        )
        
        route_data = {
            "deliveryPartnerId": None,
            "orderIds": [d.get("orderId") for d in route.get("optimizedRoute", [])],
            "routeGeometry": {
                "type": "LineString",
                "coordinates": [
                    request.startLocation.get("coordinates")
                ] + [d.get("location", {}).get("coordinates") for d in route.get("optimizedRoute", [])]
            },
            "waypoints": route.get("optimizedRoute", []),
            "totalDistance": route.get("totalDistance", 0),
            "estimatedTime": route.get("totalTime", 0),
            "status": "planned"
        }
        
        route_id = await route_repository.create_route(route_data)
        if route_id:
            route["id"] = route_id
        
        return route
    
    @staticmethod
    async def get_partner_route(
        partner_id: str,
        date: Optional[datetime] = None
    ) -> Optional[Dict[str, Any]]:
        """Get route for a delivery partner."""
        routes = await route_repository.get_by_delivery_partner(partner_id, date)
        if routes:
            return routes[0]
        return None
    
    @staticmethod
    async def complete_assignment(
        assignment_id: str,
        partner_id: str,
        delivery_photo: Optional[str] = None,
        location: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """Mark an assignment as delivered without an OTP (mobile quick-complete flow)."""
        assignment = await delivery_assignment_repository.get_by_id(assignment_id)
        if not assignment:
            return None

        if str(assignment["deliveryPartnerId"]) != partner_id:
            return None

        success = await delivery_assignment_repository.update_status(
            assignment_id,
            DeliveryStatus.DELIVERED,
            {
                "deliveryPhoto": delivery_photo,
                "location": location,
                "completedBy": "partner"
            }
        )
        if not success:
            return None

        order_id = str(assignment["orderId"])
        await order_repository.update_order_status(
            order_id,
            "delivered",
            partner_id,
            "Order delivered"
        )
        await delivery_repository.update_rating(partner_id, 5)
        await delivery_repository.update_status(
            partner_id,
            DeliveryPartnerStatus.AVAILABLE,
            is_available=True
        )
        await PaymentService.process_delivery_payment(order_id)

        order = await order_repository.get_by_id(order_id)
        if order:
            await NotificationService.send_order_delivered(
                str(order["customerId"]), order_id
            )
            if order.get("farmerId"):
                await NotificationService.send_order_delivered_to_farmer(
                    str(order["farmerId"]),
                    order,
                    delivery_photo or (assignment.get("proofOfDelivery") or {}).get("photoUrl")
                )
        await NotificationService.send_delivery_completed(partner_id, order_id)

        return await delivery_assignment_repository.get_by_id(assignment_id)

    @staticmethod
    async def get_delivery_stats(partner_id: str) -> Dict[str, Any]:
        """Get delivery partner statistics."""
        return await delivery_repository.get_partner_stats(partner_id)
    
    @staticmethod
    async def get_nearby_partners(
        lat: float,
        lng: float,
        radius: int = 10,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Get nearby available delivery partners."""
        return await delivery_repository.get_nearby_partners(lat, lng, radius, limit)
    
    @staticmethod
    async def track_delivery(
        order_id: str,
        customer_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Track delivery in real-time."""
        assignment = await delivery_assignment_repository.get_by_order_id(order_id)
        if not assignment:
            return None
        
        partner = await delivery_repository.get_by_id(
            str(assignment["deliveryPartnerId"])
        )
        if not partner:
            return None
        
        order = await order_repository.get_by_id(order_id)
        if not order:
            return None
        
        eta = None
        distance_remaining = None
        current_location = partner.get("currentLocation")
        destination = order.get("deliveryAddress", {}).get("location")
        
        if current_location and destination:
            distance_remaining = await delivery_repository.calculate_distance(
                current_location,
                destination
            )
            from app.core.constants import format_eta_minutes
            eta = format_eta_minutes(distance_remaining * 2)
        
        return {
            "orderId": order_id,
            "deliveryPartnerId": str(partner["_id"]),
            "currentLocation": current_location,
            "status": assignment.get("status"),
            "speed": partner.get("currentLocation", {}).get("speed"),
            "bearing": partner.get("currentLocation", {}).get("bearing"),
            "eta": eta if eta else "Calculating...",
            "distanceRemaining": round(distance_remaining, 1) if distance_remaining else None,
            "updatedAt": partner.get("updatedAt")
        }


delivery_service = DeliveryService()
