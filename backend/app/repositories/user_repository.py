from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
from app.utils.helpers import normalize_phone_number, escape_regex
import logging

logger = logging.getLogger(__name__)

class UserRepository(BaseRepository):
    """User repository with extended operations."""
    
    def __init__(self):
        super().__init__("users")
    
    async def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get user by email."""
        return await self.find_one({"email": email.lower(), "deletedAt": None})
    
    async def get_by_phone(self, phone: str) -> Optional[Dict[str, Any]]:
        """Get user by phone."""
        try:
            normalized_phone = normalize_phone_number(phone)
        except ValueError:
            normalized_phone = phone
        return await self.find_one({"phone": normalized_phone, "deletedAt": None})
    
    async def get_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID."""
        try:
            obj_id = ObjectId(user_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting user by ID: {str(e)}")
            return None
    
    async def get_by_ids(self, user_ids: List[str]) -> List[Dict[str, Any]]:
        """Get multiple users by IDs."""
        try:
            obj_ids = [ObjectId(id) for id in user_ids]
            return await self.find_many(
                {"_id": {"$in": obj_ids}, "deletedAt": None}
            )
        except Exception as e:
            logger.error(f"Error getting users by IDs: {str(e)}")
            return []
    
    async def create_user(self, user_data: Dict[str, Any]) -> Optional[str]:
        """Create a new user."""
        user_data["email"] = user_data["email"].lower()
        user_data["createdAt"] = datetime.utcnow()
        user_data["updatedAt"] = datetime.utcnow()
        return await self.create(user_data)
    
    async def update_user(self, user_id: str, data: Dict[str, Any]) -> bool:
        """Update user."""
        try:
            obj_id = ObjectId(user_id)
            data["updatedAt"] = datetime.utcnow()
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating user: {str(e)}")
            return False
    
    async def update_last_login(self, user_id: str) -> bool:
        """Update last login timestamp."""
        try:
            obj_id = ObjectId(user_id)
            return await self.update(
                {"_id": obj_id},
                {"lastLogin": datetime.utcnow()}
            )
        except Exception as e:
            logger.error(f"Error updating last login: {str(e)}")
            return False
    
    async def verify_user(self, user_id: str) -> bool:
        """Mark user as verified."""
        try:
            obj_id = ObjectId(user_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "isVerified": True,
                    "verifiedAt": datetime.utcnow()
                }
            )
        except Exception as e:
            logger.error(f"Error verifying user: {str(e)}")
            return False
    
    async def suspend_user(self, user_id: str, reason: str) -> bool:
        """Suspend user account."""
        try:
            obj_id = ObjectId(user_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "isActive": False,
                    "suspendedAt": datetime.utcnow(),
                    "suspensionReason": reason,
                    "status": "suspended"
                }
            )
        except Exception as e:
            logger.error(f"Error suspending user: {str(e)}")
            return False
    
    async def activate_user(self, user_id: str) -> bool:
        """Activate user account."""
        try:
            obj_id = ObjectId(user_id)
            return await self.update(
                {"_id": obj_id},
                {
                    "isActive": True,
                    "suspendedAt": None,
                    "suspensionReason": None,
                    "status": "active"
                }
            )
        except Exception as e:
            logger.error(f"Error activating user: {str(e)}")
            return False
    
    async def delete_user(self, user_id: str) -> bool:
        """Soft delete user."""
        try:
            obj_id = ObjectId(user_id)
            return await self.delete({"_id": obj_id})
        except Exception as e:
            logger.error(f"Error deleting user: {str(e)}")
            return False
    
    async def get_active_users(
        self,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get all non-deleted users."""
        return await self.find_many(
            {"deletedAt": None},
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )

    async def get_users_by_role(
        self,
        role: str,
        skip: int = 0,
        limit: int = 100,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Get users by role."""
        filter = {
            "role": role,
            "deletedAt": None
        }
        if is_active is not None:
            filter["isActive"] = is_active
        
        return await self.find_many(
            filter,
            skip=skip,
            limit=limit,
            sort=[("createdAt", -1)]
        )
    
    async def search_users(
        self,
        query: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Search users by name, email, or phone."""
        safe = escape_regex(query)
        return await self.find_many(
            {
                "$or": [
                    {"firstName": {"$regex": safe, "$options": "i"}},
                    {"lastName": {"$regex": safe, "$options": "i"}},
                    {"email": {"$regex": safe, "$options": "i"}},
                    {"phone": {"$regex": safe, "$options": "i"}}
                ],
                "deletedAt": None
            },
            skip=skip,
            limit=limit
        )
    
    async def get_user_stats(self, user_id: str) -> Dict[str, Any]:
        """Get user statistics."""
        user = await self.get_by_id(user_id)
        if not user:
            return {}
        
        stats = {
            "totalOrders": 0,
            "totalSpent": 0,
            "memberSince": user.get("createdAt")
        }
        
        # Get order stats if customer
        if user.get("role") == "customer":
            from app.repositories.order_repository import OrderRepository
            order_repo = OrderRepository()
            
            # Count orders
            stats["totalOrders"] = await order_repo.count({
                "customerId": ObjectId(user_id),
                "orderStatus": "delivered"
            })
            
            # Get total spent
            orders = await order_repo.find_many({
                "customerId": ObjectId(user_id),
                "orderStatus": "delivered"
            })
            stats["totalSpent"] = sum(o.get("totalAmount", 0) for o in orders)
        
        return stats

# Singleton instance
user_repository = UserRepository()
