from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime
from app.repositories.base_repository import BaseRepository
import logging

logger = logging.getLogger(__name__)

class CategoryRepository(BaseRepository):
    """Category repository."""
    
    def __init__(self):
        super().__init__("categories")
    
    async def create_category(self, category_data: Dict[str, Any]) -> Optional[str]:
        """Create a new category."""
        category_data["createdAt"] = datetime.utcnow()
        category_data["updatedAt"] = datetime.utcnow()
        category_data["isActive"] = category_data.get("isActive", True)
        return await self.create(category_data)
    
    async def get_by_slug(self, slug: str) -> Optional[Dict[str, Any]]:
        """Get category by slug."""
        return await self.find_one({"slug": slug, "deletedAt": None})
    
    async def get_by_id(self, category_id: str) -> Optional[Dict[str, Any]]:
        """Get category by ID."""
        try:
            obj_id = ObjectId(category_id)
            return await self.find_one({"_id": obj_id, "deletedAt": None})
        except Exception as e:
            logger.error(f"Error getting category: {str(e)}")
            return None
    
    async def get_all_categories(
        self,
        include_inactive: bool = False,
        parent_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get all categories."""
        filter = {"deletedAt": None}
        if not include_inactive:
            filter["isActive"] = True
        if parent_id:
            filter["parentId"] = ObjectId(parent_id) if parent_id != "null" else None
        
        return await self.find_many(
            filter,
            sort=[("order", 1), ("name", 1)]
        )
    
    async def get_category_tree(self) -> List[Dict[str, Any]]:
        """Get category tree with children."""
        # Get all categories
        categories = await self.get_all_categories()
        
        # Build tree
        category_map = {str(c["_id"]): {**c, "children": []} for c in categories}
        root_categories = []
        
        for category in categories:
            parent_id = category.get("parentId")
            if parent_id and str(parent_id) in category_map:
                category_map[str(parent_id)]["children"].append(category_map[str(category["_id"])])
            else:
                root_categories.append(category_map[str(category["_id"])])
        
        return root_categories
    
    async def update_category(self, category_id: str, data: Dict[str, Any]) -> bool:
        """Update category."""
        try:
            obj_id = ObjectId(category_id)
            data["updatedAt"] = datetime.utcnow()
            return await self.update({"_id": obj_id}, data)
        except Exception as e:
            logger.error(f"Error updating category: {str(e)}")
            return False
    
    async def delete_category(self, category_id: str) -> bool:
        """Delete category."""
        try:
            obj_id = ObjectId(category_id)
            return await self.delete({"_id": obj_id})
        except Exception as e:
            logger.error(f"Error deleting category: {str(e)}")
            return False
    
    async def get_category_stats(self, category_id: str) -> Dict[str, Any]:
        """Get category statistics."""
        try:
            obj_id = ObjectId(category_id)
            
            # Count products in this category
            from app.repositories.product_repository import ProductRepository
            product_repo = ProductRepository()
            product_count = await product_repo.count({
                "categoryId": obj_id,
                "deletedAt": None,
                "isActive": True
            })
            
            return {
                "productCount": product_count,
                "subCategoryCount": await self.count({"parentId": obj_id, "deletedAt": None})
            }
        except Exception as e:
            logger.error(f"Error getting category stats: {str(e)}")
            return {"productCount": 0, "subCategoryCount": 0}

# Singleton instance
category_repository = CategoryRepository()
