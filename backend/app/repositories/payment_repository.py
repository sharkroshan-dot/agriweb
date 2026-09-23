from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
from app.schemas.payment import PaymentStatus
import logging

logger = logging.getLogger(__name__)

class PaymentRepository(BaseRepository):
    """Payment repository."""
    
    def __init__(self):
        super().__init__("payments")
    
    async def create_payment(self, payment_data: Dict[str, Any]) -> Optional[str]:
        """Create a payment record."""
        payment_data["createdAt"] = datetime.utcnow()
        payment_data["updatedAt"] = datetime.utcnow()
        payment_data["status"] = payment_data.get("status", PaymentStatus.PENDING)
        return await self.create(payment_data)
    
    async def get_by_id(self, payment_id: str) -> Optional[Dict[str, Any]]:
        """Get payment by ID."""
        try:
            obj_id = ObjectId(payment_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting payment: {str(e)}")
            return None
    
    async def get_by_order_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get payment by order ID."""
        try:
            return await self.find_one({
                "orderId": ObjectId(order_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting payment by order: {str(e)}")
            return None
    
    async def get_by_transaction_id(self, transaction_id: str) -> Optional[Dict[str, Any]]:
        """Get payment by transaction ID."""
        return await self.find_one({
            "transactionId": transaction_id,
            "deletedAt": None
        })
    
    async def get_by_user_id(
        self,
        user_id: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get payments by user ID."""
        try:
            return await self.find_many(
                {
                    "userId": ObjectId(user_id),
                    "deletedAt": None
                },
                skip=skip,
                limit=limit,
                sort=[("createdAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting payments by user: {str(e)}")
            return []
    
    async def update_payment_status(
        self,
        payment_id: str,
        status: PaymentStatus,
        gateway_response: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Update payment status."""
        try:
            obj_id = ObjectId(payment_id)
            update_data = {
                "status": status,
                "updatedAt": datetime.utcnow()
            }
            if gateway_response:
                update_data["gatewayResponse"] = gateway_response
            if status == PaymentStatus.SUCCESS:
                update_data["paymentDate"] = datetime.utcnow()
            
            return await self.update({"_id": obj_id}, update_data)
        except Exception as e:
            logger.error(f"Error updating payment status: {str(e)}")
            return False
    
    async def update_transaction_id(
        self,
        payment_id: str,
        transaction_id: str
    ) -> bool:
        """Update transaction ID."""
        try:
            obj_id = ObjectId(payment_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "transactionId": transaction_id,
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error updating transaction ID: {str(e)}")
            return False
    
    async def mark_refunded(
        self,
        payment_id: str,
        refund_amount: float,
        refund_id: str,
        status: Optional[PaymentStatus] = None,
    ) -> bool:
        """Mark payment as refunded (or partially refunded)."""
        try:
            obj_id = ObjectId(payment_id)
            target_status = status or PaymentStatus.REFUNDED
            return await self.update(
                {"_id": obj_id},
                {
                    "status": target_status,
                    "refundAmount": refund_amount,
                    "refundId": refund_id,
                    "refundedAt": datetime.utcnow(),
                    "updatedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error marking refund: {str(e)}")
            return False
    
    async def get_payment_stats(
        self,
        user_id: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Get payment statistics."""
        filter = {"deletedAt": None}
        
        if user_id:
            filter["userId"] = ObjectId(user_id)
        
        if date_from or date_to:
            date_filter = {}
            if date_from:
                date_filter["$gte"] = date_from
            if date_to:
                date_filter["$lte"] = date_to
            filter["createdAt"] = date_filter
        
        # Get all payments
        payments = await self.find_many(filter)
        
        total_payments = len(payments)
        successful_payments = [p for p in payments if p.get("status") == PaymentStatus.SUCCESS]
        failed_payments = [p for p in payments if p.get("status") == PaymentStatus.FAILED]
        refunded_payments = [p for p in payments if p.get("status") == PaymentStatus.REFUNDED]
        
        total_amount = sum(p.get("amount", 0) for p in successful_payments)
        total_refunded = sum(p.get("refundAmount", 0) for p in refunded_payments)
        platform_fee = total_amount * 0.05  # 5% platform fee
        
        return {
            "totalPayments": total_payments,
            "successfulPayments": len(successful_payments),
            "failedPayments": len(failed_payments),
            "refundedPayments": len(refunded_payments),
            "totalAmount": total_amount,
            "totalRefunded": total_refunded,
            "platformFee": platform_fee,
            "successRate": (len(successful_payments) / total_payments * 100) if total_payments > 0 else 0
        }

# Singleton instance
payment_repository = PaymentRepository()
