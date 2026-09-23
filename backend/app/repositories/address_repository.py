from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class AddressRepository(BaseRepository):
    """Address repository."""
    
    def __init__(self):
        super().__init__("addresses")
    
    async def create_address(self, user_id: str, address_data: Dict[str, Any]) -> Optional[str]:
        """Create a new address."""
        address_data["userId"] = ObjectId(user_id)
        address_data["createdAt"] = datetime.utcnow()
        address_data["updatedAt"] = datetime.utcnow()
        
        # If this is the default address, unset other defaults
        if address_data.get("is_default") or address_data.get("isDefault"):
            await self.unset_default_address(user_id)
        
        return await self.create(address_data)
    
    async def get_user_addresses(self, user_id: str) -> List[Dict[str, Any]]:
        """Get all addresses for a user."""
        try:
            return await self.find_many(
                {"userId": ObjectId(user_id), "deletedAt": None},
                sort=[("isDefault", -1), ("createdAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting user addresses: {str(e)}")
            return []
    
    async def get_address_by_id(self, address_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Get address by ID."""
        try:
            obj_id = ObjectId(address_id)
            return await self.find_one({
                "_id": obj_id,
                "userId": ObjectId(user_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting address: {str(e)}")
            return None
    
    async def update_address(self, address_id: str, user_id: str, data: Dict[str, Any]) -> bool:
        """Update address."""
        try:
            obj_id = ObjectId(address_id)
            data["updatedAt"] = datetime.utcnow()
            
            # If this is the default address, unset other defaults
            if data.get("isDefault"):
                await self.unset_default_address(user_id)
            
            return await self.update(
                {"_id": obj_id, "userId": ObjectId(user_id)},
                data
            )
        except Exception as e:
            logger.error(f"Error updating address: {str(e)}")
            return False
    
    async def delete_address(self, address_id: str, user_id: str) -> bool:
        """Delete address."""
        try:
            obj_id = ObjectId(address_id)
            return await self.delete({
                "_id": obj_id,
                "userId": ObjectId(user_id)
            })
        except Exception as e:
            logger.error(f"Error deleting address: {str(e)}")
            return False
    
    async def get_default_address(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get default address for user."""
        try:
            return await self.find_one({
                "userId": ObjectId(user_id),
                "isDefault": True,
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting default address: {str(e)}")
            return None
    
    async def unset_default_address(self, user_id: str) -> bool:
        """Unset default address for user."""
        try:
            await self.update(
                {
                    "userId": ObjectId(user_id),
                    "isDefault": True,
                    "deletedAt": None
                },
                {"isDefault": False}
            )
            return True
        except Exception as e:
            logger.error(f"Error unsetting default address: {str(e)}")
            return False

    async def unset_permanent_address(self, user_id: str, except_address_id: Optional[str] = None) -> bool:
        """Clear permanent flag from all addresses (optionally except one)."""
        try:
            query: Dict[str, Any] = {
                "userId": ObjectId(user_id),
                "address_type": "permanent",
                "deletedAt": None
            }
            if except_address_id:
                query["_id"] = {"$ne": ObjectId(except_address_id)}
            await self.collection.update_many(
                query,
                {"$set": {"address_type": "home", "updatedAt": datetime.utcnow()}}
            )
            return True
        except Exception as e:
            logger.error(f"Error unsetting permanent address: {str(e)}")
            return False

    async def set_permanent_address(self, address_id: str, user_id: str) -> bool:
        """Mark an address as the permanent address (single per user)."""
        try:
            address = await self.get_address_by_id(address_id, user_id)
            if not address:
                return False
            await self.unset_permanent_address(user_id, except_address_id=address_id)
            return await self.update_address(
                address_id,
                user_id,
                {"address_type": "permanent"}
            )
        except Exception as e:
            logger.error(f"Error setting permanent address: {str(e)}")
            return False
    
    async def find_nearby_addresses(
        self,
        location: Dict[str, Any],
        radius: int,  # in meters
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Find addresses near a location."""
        try:
            return await self.find_many({
                "location": {
                    "$near": {
                        "$geometry": location,
                        "$maxDistance": radius
                    }
                },
                "deletedAt": None
            }, limit=limit)
        except Exception as e:
            logger.error(f"Error finding nearby addresses: {str(e)}")
            return []

# Singleton instance
address_repository = AddressRepository()
