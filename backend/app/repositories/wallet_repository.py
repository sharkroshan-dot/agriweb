from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
from app.schemas.payment import WalletTransactionStatus
import logging

logger = logging.getLogger(__name__)

class WalletRepository(BaseRepository):
    """Wallet repository."""
    
    def __init__(self):
        super().__init__("wallets")
    
    async def create_wallet(self, wallet_data: Dict[str, Any]) -> Optional[str]:
        """Create a wallet."""
        wallet_data["createdAt"] = datetime.utcnow()
        wallet_data["updatedAt"] = datetime.utcnow()
        wallet_data["balance"] = 0
        wallet_data["isActive"] = True
        return await self.create(wallet_data)
    
    async def get_by_user_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get wallet by user ID."""
        try:
            return await self.find_one({
                "userId": ObjectId(user_id),
                "deletedAt": None
            })
        except Exception as e:
            logger.error(f"Error getting wallet: {str(e)}")
            return None
    
    async def get_by_id(self, wallet_id: str) -> Optional[Dict[str, Any]]:
        """Get wallet by ID."""
        try:
            obj_id = ObjectId(wallet_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting wallet: {str(e)}")
            return None
    
    async def update_balance(
        self,
        wallet_id: str,
        amount: float,
        transaction_type: str
    ) -> bool:
        """Update wallet balance."""
        try:
            obj_id = ObjectId(wallet_id)
            if transaction_type == "credit":
                result = await self.collection.update_one(
                    {"_id": obj_id},
                    {
                        "$inc": {"balance": amount},
                        "$set": {"updatedAt": datetime.utcnow()}
                    }
                )
                return result.modified_count > 0
            elif transaction_type == "debit":
                # Check sufficient balance
                wallet = await self.get_by_id(wallet_id)
                if wallet and wallet.get("balance", 0) >= amount:
                    result = await self.collection.update_one(
                        {"_id": obj_id},
                        {
                            "$inc": {"balance": -amount},
                            "$set": {"updatedAt": datetime.utcnow()}
                        }
                    )
                    return result.modified_count > 0
            return False
        except Exception as e:
            logger.error(f"Error updating balance: {str(e)}")
            return False

class WalletTransactionRepository(BaseRepository):
    """Wallet transaction repository."""
    
    def __init__(self):
        super().__init__("wallet_transactions")
    
    async def create_transaction(self, transaction_data: Dict[str, Any]) -> Optional[str]:
        """Create a wallet transaction."""
        transaction_data["createdAt"] = datetime.utcnow()
        transaction_data["status"] = WalletTransactionStatus.COMPLETED
        return await self.create(transaction_data)
    
    async def get_by_wallet_id(
        self,
        wallet_id: str,
        skip: int = 0,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get transactions by wallet ID."""
        try:
            return await self.find_many(
                {
                    "walletId": ObjectId(wallet_id),
                    "deletedAt": None
                },
                skip=skip,
                limit=limit,
                sort=[("createdAt", -1)]
            )
        except Exception as e:
            logger.error(f"Error getting transactions: {str(e)}")
            return []
    
    async def get_by_user_id(
        self,
        user_id: str,
        skip: int = 0,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get transactions by user ID."""
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
            logger.error(f"Error getting transactions: {str(e)}")
            return []

# Initialize repositories
wallet_repository = WalletRepository()
wallet_transaction_repository = WalletTransactionRepository()
