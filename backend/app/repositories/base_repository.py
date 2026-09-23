from typing import Optional, List, Dict, Any, TypeVar, Generic
from datetime import datetime
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection
from app.database.mongodb import MongoDB
import logging

logger = logging.getLogger(__name__)

T = TypeVar('T')

class BaseRepository(Generic[T]):
    """Base repository with common CRUD operations."""
    
    def __init__(self, collection_name: str):
        self.collection_name = collection_name
        self._collection: Optional[AsyncIOMotorCollection] = None
    
    @property
    def collection(self) -> AsyncIOMotorCollection:
        """Get collection lazily."""
        if self._collection is None:
            self._collection = MongoDB.get_collection(self.collection_name)
        return self._collection
    
    async def find_one(self, filter: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Find a single document."""
        try:
            return await self.collection.find_one(filter)
        except Exception as e:
            logger.error(f"Error finding document: {str(e)}")
            return None
    
    async def find_many(
        self,
        filter: Dict[str, Any],
        skip: int = 0,
        limit: int = 100,
        sort: Optional[List[tuple]] = None
    ) -> List[Dict[str, Any]]:
        """Find multiple documents."""
        try:
            cursor = self.collection.find(filter).skip(skip).limit(limit)
            if sort:
                cursor = cursor.sort(sort)
            return await cursor.to_list(length=limit)
        except Exception as e:
            logger.error(f"Error finding documents: {str(e)}")
            return []
    
    async def create(self, data: Dict[str, Any]) -> Optional[str]:
        """Create a new document."""
        try:
            data["createdAt"] = datetime.utcnow()
            data["updatedAt"] = datetime.utcnow()
            result = await self.collection.insert_one(data)
            return str(result.inserted_id)
        except Exception as e:
            logger.error(f"Error creating document in '{self.collection_name}': {str(e)}", exc_info=True)
            return None
    
    async def update(
        self,
        filter: Dict[str, Any],
        data: Dict[str, Any],
        upsert: bool = False
    ) -> bool:
        """Update a document."""
        try:
            data["updatedAt"] = datetime.utcnow()
            result = await self.collection.update_one(
                filter,
                {"$set": data},
                upsert=upsert
            )
            return result.modified_count > 0 or result.upserted_id is not None
        except Exception as e:
            logger.error(f"Error updating document: {str(e)}")
            return False
    
    async def delete(self, filter: Dict[str, Any]) -> bool:
        """Delete a document (soft delete)."""
        try:
            result = await self.collection.update_one(
                filter,
                {
                    "$set": {
                        "deletedAt": datetime.utcnow(),
                        "isActive": False
                    }
                }
            )
            return result.modified_count > 0
        except Exception as e:
            logger.error(f"Error deleting document: {str(e)}")
            return False
    
    async def hard_delete(self, filter: Dict[str, Any]) -> bool:
        """Hard delete a document."""
        try:
            result = await self.collection.delete_one(filter)
            return result.deleted_count > 0
        except Exception as e:
            logger.error(f"Error hard deleting document: {str(e)}")
            return False
    
    async def count(self, filter: Dict[str, Any]) -> int:
        """Count documents matching filter."""
        try:
            return await self.collection.count_documents(filter)
        except Exception as e:
            logger.error(f"Error counting documents: {str(e)}")
            return 0
    
    async def aggregate(self, pipeline: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Execute an aggregation pipeline."""
        try:
            cursor = self.collection.aggregate(pipeline)
            return await cursor.to_list(length=None)
        except Exception as e:
            logger.error(f"Error executing aggregation: {str(e)}")
            return []
    
    def to_object_id(self, id_str: str) -> ObjectId:
        """Convert string ID to ObjectId."""
        try:
            return ObjectId(id_str)
        except Exception:
            raise ValueError(f"Invalid ObjectId: {id_str}")
