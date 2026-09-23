from typing import Optional, Dict, Any, List, Union
from bson import ObjectId
from datetime import datetime, timedelta
import random
import string
import math
from app.repositories.base_repository import BaseRepository
from app.schemas.order import OrderFilterParams, OrderStatus, DeliveryType
import logging

logger = logging.getLogger(__name__)

class OrderRepository(BaseRepository):
    """Order repository."""
    
    def __init__(self):
        super().__init__("orders")
    
    def generate_order_number(self) -> str:
        """Generate unique order number."""
        prefix = "ORD"
        date = datetime.utcnow().strftime("%Y%m%d")
        random_suffix = ''.join(random.choices(string.digits, k=6))
        return f"{prefix}-{date}-{random_suffix}"
    
    async def create_order(self, order_data: Dict[str, Any]) -> Optional[str]:
        """Create a new order."""
        # Generate order number
        order_data["orderNumber"] = self.generate_order_number()
        order_data["orderDate"] = datetime.utcnow()
        order_data["createdAt"] = datetime.utcnow()
        order_data["updatedAt"] = datetime.utcnow()
        order_data["statusHistory"] = [{
            "status": OrderStatus.PENDING.value,
            "changedBy": str(order_data.get("customerId")),
            "timestamp": datetime.utcnow()
        }]
        
        # Set default values
        order_data["orderStatus"] = OrderStatus.PENDING.value
        order_data["paymentStatus"] = "pending"
        order_data["deliveryCharge"] = order_data.get("deliveryCharge", 0)
        order_data["platformFee"] = order_data.get("platformFee", 0)
        order_data["discount"] = order_data.get("discount", 0)
        
        return await self.create(order_data)
    
    async def get_by_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get order by ID."""
        try:
            obj_id = ObjectId(order_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting order: {str(e)}")
            return None
    
    async def get_by_order_number(self, order_number: str) -> Optional[Dict[str, Any]]:
        """Get order by order number."""
        return await self.find_one({"orderNumber": order_number, "deletedAt": None})
    
    async def get_by_customer(
        self,
        customer_id: str,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get orders by customer."""
        filter = {
            "customerId": ObjectId(customer_id),
            "deletedAt": None
        }
        if status:
            filter["orderStatus"] = status
        
        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("orderDate", -1)]
        )
    
    async def get_by_farmer(
        self,
        farmer_id: str,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get orders by farmer."""
        filter = {
            "farmerId": ObjectId(farmer_id),
            "deletedAt": None
        }
        if status:
            filter["orderStatus"] = status
        
        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("orderDate", -1)]
        )
    
    async def get_by_delivery_partner(
        self,
        delivery_partner_id: str,
        skip: int = 0,
        limit: int = 100,
        status: Optional[str] = None,
        date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """Get orders by delivery partner.

        Matches deliveryPartnerId stored either as an ObjectId or as a plain
        string, since legacy records may use either representation.
        """
        partner_values = [delivery_partner_id]
        try:
            partner_values.append(ObjectId(delivery_partner_id))
        except Exception:
            pass
        filter = {
            "deliveryPartnerId": {"$in": partner_values},
            "deletedAt": None
        }
        if status:
            filter["orderStatus"] = status
        if date:
            # Get orders for specific date
            start_date = datetime(date.year, date.month, date.day)
            end_date = start_date + timedelta(days=1)
            filter["orderDate"] = {"$gte": start_date, "$lt": end_date}
        
        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("orderDate", -1)]
        )
    
    async def get_pending_orders(
        self,
        farmer_id: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get pending orders."""
        filter = {
            "orderStatus": {"$in": [OrderStatus.PENDING, OrderStatus.CONFIRMED]},
            "deletedAt": None
        }
        if farmer_id:
            filter["farmerId"] = ObjectId(farmer_id)
        
        return await self.find_many(
            filter,
            limit=limit,
            sort=[("orderDate", 1)]
        )
    
    async def get_ready_for_delivery(
        self,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get orders ready for delivery."""
        return await self.find_many(
            {
                "orderStatus": OrderStatus.READY_FOR_DELIVERY,
                "deliveryPartnerId": None,
                "deletedAt": None
            },
            limit=limit,
            sort=[("orderDate", 1)]
        )

    async def get_nearby_ready_for_delivery(
        self,
        lat: float,
        lng: float,
        radius_km: int,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get unassigned ready orders within a driver's current radius."""
        try:
            orders = await self.find_many({
                "orderStatus": OrderStatus.READY_FOR_DELIVERY,
                "deliveryPartnerId": None,
                "deletedAt": None,
            }, limit=1000, sort=[("orderDate", 1)])
            nearby = []
            for order in orders:
                coordinates = (order.get("deliveryAddress") or {}).get("location", {}).get("coordinates")
                if not coordinates or len(coordinates) < 2:
                    continue
                order_lng, order_lat = coordinates[0], coordinates[1]
                dlat = math.radians(order_lat - lat)
                dlng = math.radians(order_lng - lng)
                a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(order_lat)) * math.sin(dlng / 2) ** 2
                distance_km = 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                if distance_km <= radius_km:
                    nearby.append((distance_km, order))
            nearby.sort(key=lambda item: item[0])
            return [order for _, order in nearby[:limit]]
        except Exception as e:
            logger.error(f"Error getting nearby ready orders: {str(e)}")
            return []
    
    async def update_order_status(
        self,
        order_id: str,
        status: str,
        changed_by: str,
        note: Optional[str] = None,
        location: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update order status with history."""
        try:
            obj_id = ObjectId(order_id)
            
            # Add to status history
            status_entry = {
                "status": status,
                "changedBy": changed_by,
                "timestamp": datetime.utcnow()
            }
            if note:
                status_entry["note"] = note
            if location:
                status_entry["location"] = location
            
            update_data = {
                "orderStatus": status,
                "updatedAt": datetime.utcnow()
            }
            
            # Add delivered timestamp
            if status == OrderStatus.DELIVERED:
                update_data["deliveredAt"] = datetime.utcnow()
            
            # Update using push
            result = await self.collection.update_one(
                {"_id": obj_id},
                {
                    "$set": update_data,
                    "$push": {"statusHistory": status_entry}
                }
            )
            
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating order status: {str(e)}")
            return False
    
    async def get_active_rating_order(self, customer_id: str) -> Optional[Dict[str, Any]]:
        """Get the most recent delivered order with an active SMS rating session."""
        orders = await self.find_many(
            {
                "customerId": ObjectId(customer_id),
                "orderStatus": OrderStatus.DELIVERED.value,
                "smsRating.active": True,
                "deletedAt": None
            },
            limit=1,
            sort=[("deliveredAt", -1)]
        )
        return orders[0] if orders else None
    
    async def get_by_rating_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Get the order with an active SMS rating session for a rating link token."""
        return await self.find_one({
            "smsRating.ratingToken": token,
            "smsRating.active": True,
            "deletedAt": None
        })

    async def set_rating_session(self, order_id: str, session: Dict[str, Any]) -> bool:
        """Set the SMS rating session state on an order."""
        try:
            obj_id = ObjectId(order_id)
            result = await self.collection.update_one(
                {"_id": obj_id},
                {"$set": {"smsRating": session, "updatedAt": datetime.utcnow()}}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error setting rating session: {str(e)}")
            return False
    
    async def clear_rating_session(self, order_id: str) -> bool:
        """Mark the SMS rating session as finished on an order."""
        try:
            obj_id = ObjectId(order_id)
            result = await self.collection.update_one(
                {"_id": obj_id},
                {"$set": {"smsRating.active": False, "updatedAt": datetime.utcnow()}}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error clearing rating session: {str(e)}")
            return False
    
    async def update_rating_session(self, order_id: str, updates: Dict[str, Any]) -> bool:
        """Update individual ``smsRating.*`` fields on an order (e.g. progress)."""
        try:
            obj_id = ObjectId(order_id)
            set_dict = {f"smsRating.{key}": value for key, value in updates.items()}
            set_dict["updatedAt"] = datetime.utcnow()
            result = await self.collection.update_one(
                {"_id": obj_id},
                {"$set": set_dict}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating rating session: {str(e)}")
            return False
    
    async def assign_delivery_partner(
        self,
        order_id: str,
        delivery_partner_id: str
    ) -> bool:
        """Assign delivery partner to order."""
        try:
            obj_id = ObjectId(order_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "deliveryPartnerId": ObjectId(delivery_partner_id),
                    "orderStatus": OrderStatus.DISPATCHED,
                    "assignedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error assigning delivery partner: {str(e)}")
            return False
    
    async def get_orders_by_filters(
        self,
        params: OrderFilterParams
    ) -> tuple[List[Dict[str, Any]], int]:
        """Get orders with filters."""
        filter = {"deletedAt": None}
        
        if params.status:
            filter["orderStatus"] = params.status
        
        if params.fromDate or params.toDate:
            date_filter = {}
            if params.fromDate:
                date_filter["$gte"] = params.fromDate
            if params.toDate:
                date_filter["$lte"] = params.toDate
            filter["orderDate"] = date_filter
        
        if params.farmerId:
            filter["farmerId"] = ObjectId(params.farmerId)
        
        if params.customerId:
            filter["customerId"] = ObjectId(params.customerId)
        
        if params.deliveryPartnerId:
            filter["deliveryPartnerId"] = ObjectId(params.deliveryPartnerId)
        
        if params.deliveryType:
            filter["deliveryType"] = params.deliveryType.value
        
        if params.isBulkOrder is not None:
            filter["isBulkOrder"] = params.isBulkOrder
        
        # Get total count
        total = await self.count(filter)
        
        # Get orders
        skip = (params.page - 1) * params.limit
        orders = await self.find_many(
            filter,
            skip=skip,
            limit=params.limit,
            sort=[("orderDate", -1)]
        )
        
        return orders, total
    
    async def get_order_summary(
        self,
        farmer_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Get order summary statistics."""
        filter = {"deletedAt": None}
        
        if farmer_id:
            filter["farmerId"] = ObjectId(farmer_id)
        if customer_id:
            filter["customerId"] = ObjectId(customer_id)
        if date_from or date_to:
            date_filter = {}
            if date_from:
                date_filter["$gte"] = date_from
            if date_to:
                date_filter["$lte"] = date_to
            filter["orderDate"] = date_filter
        
        # Get all orders
        orders = await self.find_many(filter)
        
        total_orders = len(orders)
        delivered_orders = [o for o in orders if o.get("orderStatus") == OrderStatus.DELIVERED]
        pending_orders = [o for o in orders if o.get("orderStatus") in [OrderStatus.PENDING, OrderStatus.CONFIRMED]]
        cancelled_orders = [o for o in orders if o.get("orderStatus") == OrderStatus.CANCELLED]
        
        total_revenue = sum(o.get("totalAmount", 0) for o in delivered_orders)
        avg_order_value = total_revenue / len(delivered_orders) if delivered_orders else 0
        
        return {
            "totalOrders": total_orders,
            "pendingOrders": len(pending_orders),
            "deliveredOrders": len(delivered_orders),
            "cancelledOrders": len(cancelled_orders),
            "totalRevenue": total_revenue,
            "averageOrderValue": avg_order_value
        }
    
    async def get_order_tracking(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get order tracking information."""
        order = await self.get_by_id(order_id)
        if not order:
            return None
        
        # Get delivery partner location if in transit
        location = None
        delivery_partner = None
        partner = None
        
        if order.get("deliveryPartnerId") and order.get("orderStatus") in [
            OrderStatus.IN_TRANSIT,
            OrderStatus.DISPATCHED
        ]:
            from app.repositories.delivery_repository import delivery_repository
            partner = await delivery_repository.get_by_id(
                str(order["deliveryPartnerId"])
            )
            if not partner:
                partner = await delivery_repository.get_by_user_id(
                    str(order["deliveryPartnerId"])
                )
            if partner:
                delivery_partner = {
                    "id": str(partner["_id"]),
                    "name": partner.get("name", "Delivery Partner"),
                    "phone": partner.get("phone"),
                    "vehicleType": partner.get("vehicleType"),
                    "vehicleNumber": partner.get("vehicleNumber")
                }
                location = partner.get("currentLocation")
        
        # Get route if available
        route = None
        if order.get("routeId"):
            from app.repositories.route_repository import route_repository
            route_data = await route_repository.get_by_id(str(order["routeId"]))
            if route_data:
                route = route_data.get("waypoints", [])
        
        return {
            "orderId": order_id,
            "orderStatus": order.get("orderStatus"),
            "currentLocation": location,
            "deliveryPartner": delivery_partner,
            "route": route,
            "statusHistory": order.get("statusHistory", []),
            "locationUpdatedAt": partner.get("updatedAt") if partner else None,
        }

    async def update_order_field(
        self,
        order_id: str,
        field: str,
        value: Union[str, int, float, bool, dict, list, None]
    ) -> bool:
        """Update a single field on an order."""
        try:
            obj_id = ObjectId(order_id)
            result = await self.collection.update_one(
                {"_id": obj_id},
                {
                    "$set": {
                        field: value,
                        "updatedAt": datetime.utcnow()
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error updating order field {field}: {str(e)}")
            return False

    async def get_active_by_farmer_within_radius(
        self,
        farmer_id: str,
        lng: float,
        lat: float,
        radius_km: float,
        statuses: List[str]
    ) -> List[Dict[str, Any]]:
        """Mongo geospatial query: active orders whose delivery address GeoJSON
        falls inside the spherical circle around (lng, lat).

        Uses the 2dsphere index on ``deliveryAddress.location``.
        """
        try:
            return await self.find_many({
                "farmerId": ObjectId(farmer_id),
                "orderStatus": {"$in": statuses},
                "deletedAt": None,
                "deliveryAddress.location": {
                    "$geoWithin": {
                        "$centerSphere": [[float(lng), float(lat)], radius_km / 6378.1]
                    }
                },
            })
        except Exception as e:
            logger.error(f"Error in within-radius geospatial query: {str(e)}")
            return []

    @staticmethod
    def _ready_status_pipeline(fields: Dict[str, Any], unset: List[str]) -> list:
        """Aggregation-pipeline update that claims an order for self delivery.

        Advancing ``orderStatus`` to ``ready_for_delivery`` for pre-delivery
        states (pending/confirmed/processing) makes the claimed order appear in
        the farmer's Route, Delivery Calendar and Smart Route immediately, while
        keeping already-progressed statuses (dispatched/in_transit) untouched so
        callers can still decide whether to restore them.
        """
        set_fields = dict(fields)
        set_fields["updatedAt"] = datetime.utcnow()
        return [
            {
                "$set": {
                    **set_fields,
                    "orderStatus": {
                        "$switch": {
                            "branches": [
                                {
                                    "case": {"$in": ["$orderStatus", ["pending", "confirmed", "processing"]]},
                                    "then": "ready_for_delivery",
                                },
                            ],
                            "default": "$orderStatus",
                        }
                    },
                }
            },
            {"$unset": unset},
        ]

    async def claim_for_self_delivery(
        self,
        order_id: str,
        farmer_id: str,
        statuses: List[str]
    ) -> bool:
        """Atomically claim an order for farmer self-delivery.

        Compare-and-set: only succeeds when the order is not already claimed
        for self delivery and has no delivery partner assigned, which protects
        against two concurrent bulk actions double-claiming an order. The
        claimed order is advanced to ``ready_for_delivery`` so it immediately
        shows up on the farmer's Route, Delivery Calendar and Smart Route.
        """
        try:
            obj_id = ObjectId(order_id)
            result = await self.collection.update_one(
                {
                    "_id": obj_id,
                    "farmerId": ObjectId(farmer_id),
                    "deletedAt": None,
                    "orderStatus": {"$in": statuses},
                    "selfDelivery": {"$ne": True},
                    "deliveryPartnerId": None,
                },
                self._ready_status_pipeline(
                    {"selfDelivery": True, "partnerRequested": False},
                    ["deliveryPartnerId", "deliveryPartnerName", "assignedAt"],
                ),
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error claiming order {order_id} for self delivery: {str(e)}")
            return False

    async def reclaim_for_self_delivery(
        self,
        order_id: str,
        farmer_id: str,
        statuses: List[str]
    ) -> bool:
        """Atomically switch an order to self delivery, taking it back from a
        delivery partner.

        Like :meth:`claim_for_self_delivery` but also clears an existing partner
        assignment. Callers should first confirm the partner has not accepted
        the job (see the delivery_assignments collection).
        """
        try:
            obj_id = ObjectId(order_id)
            result = await self.collection.update_one(
                {
                    "_id": obj_id,
                    "farmerId": ObjectId(farmer_id),
                    "deletedAt": None,
                    "orderStatus": {"$in": statuses},
                    "selfDelivery": {"$ne": True},
                },
                self._ready_status_pipeline(
                    {"selfDelivery": True, "partnerRequested": False},
                    ["deliveryPartnerId", "deliveryPartnerName", "assignedAt"],
                ),
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error reclaiming order {order_id} for self delivery: {str(e)}")
            return False

    async def restore_after_reclaim(
        self,
        order_id: str,
        status: str
    ) -> bool:
        """After a farmer reclaims a partner-assigned order, restore a
        farmer-completable status (e.g. dispatched/in_transit -> ready_for_delivery).
        """
        try:
            obj_id = ObjectId(order_id)
            result = await self.collection.update_one(
                {"_id": obj_id},
                {"$set": {"orderStatus": status, "updatedAt": datetime.utcnow()}}
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error restoring order {order_id} to {status}: {str(e)}")
            return False

    async def assign_partner_safe(
        self,
        order_id: str,
        farmer_id: str,
        partner_id: str,
        statuses: List[str]
    ) -> bool:
        """Atomically assign a delivery partner to an order.

        Compare-and-set: only succeeds when the order has no partner assigned
        yet. Handing an order to a partner also clears ``selfDelivery`` so the
        order leaves the farmer's self-delivery feed. Bulk flows exclude
        self-delivery orders at selection time; the individual switch endpoint
        uses this method to move an order from self-delivery to a partner.
        """
        try:
            obj_id = ObjectId(order_id)
            result = await self.collection.update_one(
                {
                    "_id": obj_id,
                    "farmerId": ObjectId(farmer_id),
                    "deletedAt": None,
                    "orderStatus": {"$in": statuses},
                    "deliveryPartnerId": None,
                },
                {
                    "$set": {
                        "deliveryPartnerId": ObjectId(partner_id),
                        "deliveryPartnerName": "",
                        "orderStatus": "dispatched",
                        "assignedAt": datetime.utcnow(),
                        "selfDelivery": False,
                        "partnerRequested": False,
                        "updatedAt": datetime.utcnow(),
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error assigning partner to order {order_id}: {str(e)}")
            return False

    async def count_active_orders(self, farmer_id: str, statuses: List[str]) -> int:
        """Count the farmer's active orders for a set of statuses."""
        try:
            return await self.count({
                "farmerId": ObjectId(farmer_id),
                "orderStatus": {"$in": statuses},
                "deletedAt": None,
            })
        except Exception as e:
            logger.error(f"Error counting active orders: {str(e)}")
            return 0
    
    async def get_bulk_order_summary(
        self,
        farmer_id: str
    ) -> List[Dict[str, Any]]:
        """
        Aggregate orders per product for a farmer.
        Shows total pending quantity per product to help farmer decide
        if bulk/wholesale processing is worthwhile.
        """
        pipeline = [
            {
                "$match": {
                    "farmerId": ObjectId(farmer_id),
                    "orderStatus": {
                        "$in": [
                            OrderStatus.PENDING.value,
                            OrderStatus.CONFIRMED.value,
                            OrderStatus.PROCESSING.value
                        ]
                    },
                    "deletedAt": None
                }
            },
            {"$unwind": "$items"},
            {
                "$group": {
                    "_id": "$items.productId",
                    "productName": {"$first": "$items.productName"},
                    "totalQuantity": {"$sum": "$items.quantity"},
                    "orderCount": {"$sum": 1},
                    "orders": {"$push": {
                        "orderId": "$_id",
                        "quantity": "$items.quantity",
                        "orderDate": "$orderDate",
                        "customerId": "$customerId",
                        "orderStatus": "$orderStatus",
                        "deliveryType": "$deliveryType"
                    }},
                    "avgUnitPrice": {"$avg": "$items.unitPrice"},
                    "earliestOrderDate": {"$min": "$orderDate"},
                    "latestOrderDate": {"$max": "$orderDate"}
                }
            },
            {"$sort": {"totalQuantity": -1}},
            {"$limit": 50}
        ]
        
        results = await self.aggregate(pipeline)
        for r in results:
            r["productId"] = str(r["_id"])
            for o in r.get("orders", []):
                o["orderId"] = str(o["orderId"])
                o["customerId"] = str(o["customerId"])
        
        return results

    async def get_delivery_route_groups(
        self,
        farmer_id: str
    ) -> List[Dict[str, Any]]:
        """
        Group pending delivery orders by delivery area.
        For READY_FOR_DELIVERY orders that are not yet assigned.
        """
        pipeline = [
            {
                "$match": {
                    "farmerId": ObjectId(farmer_id),
                    "orderStatus": OrderStatus.READY_FOR_DELIVERY.value,
                    "deliveryType": DeliveryType.DELIVERY.value,
                    "deliveryPartnerId": None,
                    "deletedAt": None
                }
            },
            {
                "$addFields": {
                    "deliveryCity": {
                        "$ifNull": [
                            "$deliveryAddress.city",
                            {"$ifNull": ["$deliveryAddress.area", "Unknown Area"]}
                        ]
                    }
                }
            },
            {
                "$group": {
                    "_id": "$deliveryCity",
                    "orderCount": {"$sum": 1},
                    "totalAmount": {"$sum": "$totalAmount"},
                    "orders": {"$push": {
                        "orderId": "$_id",
                        "orderNumber": "$orderNumber",
                        "totalAmount": "$totalAmount",
                        "customerName": "$customerName",
                        "deliveryAddress": "$deliveryAddress",
                        "orderDate": "$orderDate",
                        "selfDelivery": {"$ifNull": ["$selfDelivery", False]},
                        "items": "$items"
                    }},
                    "earliestDate": {"$min": "$orderDate"},
                    "latestDate": {"$max": "$orderDate"}
                }
            },
            {
                "$sort": {"orderCount": -1}
            }
        ]
        
        results = await self.aggregate(pipeline)
        for r in results:
            r["routeName"] = str(r["_id"])
            for o in r.get("orders", []):
                o["orderId"] = str(o["orderId"])
        return results

# Singleton instance
order_repository = OrderRepository()
