from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class CouponRepository(BaseRepository):
    """Coupon repository."""
    
    def __init__(self):
        super().__init__("coupons")
    
    async def get_by_code(self, code: str) -> Optional[Dict[str, Any]]:
        """Get coupon by code."""
        return await self.find_one({"code": code.upper(), "deletedAt": None})
    
    async def validate_coupon(
        self,
        code: str,
        user_id: str,
        order_value: float
    ) -> bool:
        """Validate coupon for use."""
        coupon = await self.get_by_code(code)
        if not coupon:
            return False
        
        # Check if active
        if coupon.get("status") != "active":
            return False
        
        # Check date range
        now = datetime.utcnow()
        if coupon.get("expiresAt") and coupon.get("expiresAt") < now:
            return False
        
        # Check usage limit
        used_count = coupon.get("usedCount", 0)
        usage_limit = coupon.get("usageLimit")
        if usage_limit and used_count >= usage_limit:
            return False
        
        # Check minimum order value
        min_order = coupon.get("minOrderValue")
        if min_order and order_value < min_order:
            return False
        
        return True
    
    async def calculate_discount(self, code: str, order_value: float) -> float:
        """Calculate discount amount."""
        coupon = await self.get_by_code(code)
        if not coupon:
            return 0
        
        discount_type = coupon.get("discountType")
        discount_value = coupon.get("discountValue", 0)
        
        if discount_type == "percentage":
            discount = (order_value * discount_value) / 100
            # Apply max discount if set
            max_discount = coupon.get("maxDiscount")
            if max_discount and discount > max_discount:
                discount = max_discount
        else:  # fixed
            discount = discount_value
        
        return min(discount, order_value)  # Can't discount more than order value
    
    async def record_usage(self, code: str, user_id: str) -> bool:
        """Record coupon usage."""
        try:
            coupon = await self.get_by_code(code)
            if not coupon:
                return False
            
            # Increment usage count
            result = await self.collection.update_one(
                {"_id": coupon["_id"]},
                {"$inc": {"usedCount": 1}}
            )
            
            # Record usage in coupon_usage collection
            usage_collection = self.db["coupon_usage"]
            await usage_collection.insert_one({
                "couponId": coupon["_id"],
                "userId": ObjectId(user_id),
                "usedAt": datetime.utcnow()
            })
            
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error recording coupon usage: {str(e)}")
            return False

# backend/app/repositories/payment_repository.py
class PaymentRepository(BaseRepository):
    """Payment repository."""
    
    def __init__(self):
        super().__init__("payments")
    
    async def create_payment(self, data: Dict[str, Any]) -> Optional[str]:
        """Create a payment record."""
        data["createdAt"] = datetime.utcnow()
        data["updatedAt"] = datetime.utcnow()
        return await self.create(data)
    
    async def get_by_order_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get payment by order ID."""
        try:
            return await self.find_one({
                "orderId": ObjectId(order_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting payment: {str(e)}")
            return None
    
    async def update_payment_status(
        self,
        order_id: str,
        status: str
    ) -> bool:
        """Update payment status."""
        try:
            return await self.update(
                {"orderId": ObjectId(order_id)},
                {
                    "status": status,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error updating payment status: {str(e)}")
            return False
    
    async def get_by_transaction_id(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        """Get payment by transaction ID."""
        return await self.find_one({"transactionId": transaction_id, "deletedAt": None})

# Initialize repositories
coupon_repository = CouponRepository()
payment_repository = PaymentRepository()
