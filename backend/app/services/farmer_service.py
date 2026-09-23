from typing import Optional, Dict, Any
from app.repositories.farmer_repository import farmer_repository
import logging

logger = logging.getLogger(__name__)

class FarmerService:
    @staticmethod
    async def get_farmer_profile(user_id: str) -> Optional[Dict[str, Any]]:
        return await farmer_repository.get_by_user_id(user_id)

    @staticmethod
    async def update_farmer_profile(user_id: str, data: Dict[str, Any]) -> bool:
        farmer = await farmer_repository.get_by_user_id(user_id)
        if not farmer:
            return False
        return await farmer_repository.update({"_id": farmer["_id"]}, data)
