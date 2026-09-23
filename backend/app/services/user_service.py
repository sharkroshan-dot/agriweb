from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.user_repository import user_repository
from app.repositories.address_repository import address_repository
from app.core.security import Security
from app.schemas.user import UserUpdate, AddressCreate, AddressUpdate
import logging

logger = logging.getLogger(__name__)

class UserService:
    """User service with business logic."""
    
    @staticmethod
    async def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID."""
        return await user_repository.get_by_id(user_id)
    
    @staticmethod
    async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
        """Get user by email."""
        return await user_repository.get_by_email(email)
    
    @staticmethod
    async def get_user_by_phone(phone: str) -> Optional[Dict[str, Any]]:
        """Get user by phone."""
        return await user_repository.get_by_phone(phone)
    
    @staticmethod
    async def update_user(user_id: str, update_data: UserUpdate) -> Optional[Dict[str, Any]]:
        """Update user profile."""
        # Get current user
        user = await user_repository.get_by_id(user_id)
        if not user:
            return None
        
        # Prepare update data
        data = update_data.dict(exclude_unset=True)
        if not data:
            return user
        
        # Update user
        success = await user_repository.update_user(user_id, data)
        if not success:
            return None
        
        # Get updated user
        return await user_repository.get_by_id(user_id)
    
    @staticmethod
    async def change_password(user_id: str, current_password: str, new_password: str) -> bool:
        """Change user password."""
        # Get user
        user = await user_repository.get_by_id(user_id)
        if not user:
            return False
        
        # Verify current password
        if not Security.verify_password(current_password, user.get("passwordHash", "")):
            return False
        
        # Hash new password
        hashed_password = Security.get_password_hash(new_password)
        
        # Update password
        return await user_repository.update_user(
            user_id,
            {"passwordHash": hashed_password}
        )
    
    @staticmethod
    async def update_last_login(user_id: str) -> bool:
        """Update last login timestamp."""
        return await user_repository.update_last_login(user_id)

    @staticmethod
    async def update_totp_secret(user_id: str, secret: str, enabled: bool) -> bool:
        """Set (or clear) a user's TOTP secret and enablement state."""
        return await user_repository.update_user(
            user_id,
            {"totpSecret": secret, "totpEnabled": bool(enabled)},
        )
    
    @staticmethod
    async def mark_verified(user_id: str) -> bool:
        """Mark user as verified."""
        return await user_repository.verify_user(user_id)
    
    @staticmethod
    async def suspend_user(user_id: str, reason: str) -> bool:
        """Suspend user account."""
        return await user_repository.suspend_user(user_id, reason)
    
    @staticmethod
    async def activate_user(user_id: str) -> bool:
        """Activate user account."""
        return await user_repository.activate_user(user_id)
    
    @staticmethod
    async def delete_user(user_id: str) -> bool:
        """Delete user account."""
        return await user_repository.delete_user(user_id)
    
    @staticmethod
    async def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
        """Get complete user profile with role-specific data and stats."""
        # Get user
        user = await user_repository.get_by_id(user_id)
        if not user:
            return None
        
        # Get addresses
        addresses = await address_repository.get_user_addresses(user_id)
        
        # Get role-specific profile
        role_profile = None
        role = user.get("role")
        
        if role == "farmer":
            from app.repositories.farmer_repository import farmer_repository
            role_profile = await farmer_repository.get_by_user_id(user_id)
        elif role == "delivery":
            from app.repositories.delivery_repository import delivery_repository
            role_profile = await delivery_repository.get_by_user_id(user_id)
        elif role == "warehouse":
            from app.repositories.warehouse_repository import warehouse_repository
            role_profile = await warehouse_repository.get_by_user_id(user_id)
        elif role == "customer":
            from app.repositories.customer_repository import customer_repository
            role_profile = await customer_repository.get_by_user_id(user_id)
        
        # Get stats
        stats = await user_repository.get_user_stats(user_id)
        
        return {
            "user": user,
            "role_profile": role_profile,
            "addresses": addresses,
            "stats": stats
        }
    
    @staticmethod
    async def create_address(user_id: str, address_data: AddressCreate) -> Optional[Dict[str, Any]]:
        """Create a new address for user."""
        # If this is the first address, make it default
        existing_addresses = await address_repository.get_user_addresses(user_id)
        if not existing_addresses:
            address_data.is_default = True
        
        address_id = await address_repository.create_address(
            user_id,
            address_data.dict()
        )
        
        if not address_id:
            return None
        
        return await address_repository.get_address_by_id(address_id, user_id)
    
    @staticmethod
    async def update_address(
        user_id: str,
        address_id: str,
        address_data: AddressUpdate
    ) -> Optional[Dict[str, Any]]:
        """Update user address."""
        # Check if address exists
        existing = await address_repository.get_address_by_id(address_id, user_id)
        if not existing:
            return None
        
        # Update address
        success = await address_repository.update_address(
            address_id,
            user_id,
            address_data.dict(exclude_unset=True)
        )
        
        if not success:
            return None
        
        return await address_repository.get_address_by_id(address_id, user_id)
    
    @staticmethod
    async def delete_address(user_id: str, address_id: str) -> bool:
        """Delete user address."""
        # Check if address exists
        address = await address_repository.get_address_by_id(address_id, user_id)
        if not address:
            return False
        
        # Delete address
        return await address_repository.delete_address(address_id, user_id)
    
    @staticmethod
    async def set_default_address(user_id: str, address_id: str) -> bool:
        """Set address as default."""
        # Check if address exists
        address = await address_repository.get_address_by_id(address_id, user_id)
        if not address:
            return False
        
        # Unset current default
        await address_repository.unset_default_address(user_id)
        
        # Set new default
        return await address_repository.update_address(
            address_id,
            user_id,
            {"isDefault": True}
        )
    
    @staticmethod
    async def set_permanent_address(user_id: str, address_id: str) -> bool:
        """Set an address as the permanent address."""
        return await address_repository.set_permanent_address(address_id, user_id)

    @staticmethod
    async def get_addresses(user_id: str) -> List[Dict[str, Any]]:
        """Get all addresses for user."""
        return await address_repository.get_user_addresses(user_id)
    
    @staticmethod
    async def search_users(query: str, skip: int = 0, limit: int = 100) -> List[Dict[str, Any]]:
        """Search users."""
        return await user_repository.search_users(query, skip, limit)
    
    @staticmethod
    async def get_users_by_role(
        role: str,
        skip: int = 0,
        limit: int = 100,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Get users by role."""
        return await user_repository.get_users_by_role(role, skip, limit, is_active)

# Singleton instance
user_service = UserService()
