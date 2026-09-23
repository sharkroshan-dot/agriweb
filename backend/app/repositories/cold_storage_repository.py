from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class ColdStorageRepository(BaseRepository):
    """Cold storage repository."""

    def __init__(self):
        super().__init__("cold_storage")

    async def create_cold_storage(self, data: Dict[str, Any]) -> Optional[str]:
        data["createdAt"] = datetime.utcnow()
        data["updatedAt"] = datetime.utcnow()
        return await self.create(data)

    async def get_by_id(self, storage_id: str) -> Optional[Dict[str, Any]]:
        try:
            obj_id = ObjectId(storage_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting cold storage item: {str(e)}")
            return None

    async def get_by_warehouse_id(
        self,
        warehouse_id: str,
        skip: int = 0,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        try:
            return await self.find_many(
                {"warehouseId": ObjectId(warehouse_id), "deletedAt": None},
                skip=skip,
                limit=limit,
                sort=[("updatedAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting cold storage by warehouse: {str(e)}")
            return []

    async def update(self, filter: Dict[str, Any], data: Dict[str, Any]) -> bool:
        data["updatedAt"] = datetime.utcnow()
        return await super().update(filter, data)


cold_storage_repository = ColdStorageRepository()
