from typing import Optional, Dict, Any, List
from datetime import datetime
from app.repositories.analytics_repository import analytics_repository
from app.repositories.user_repository import user_repository
from app.repositories.product_repository import product_repository
from app.repositories.warehouse_repository import warehouse_repository
from app.services.farmer_analytics import FarmerAnalyticsService
import logging

logger = logging.getLogger(__name__)

class AnalyticsService:
    """Analytics service for business logic and summarization."""

    @staticmethod
    async def get_platform_overview(
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        metrics = await analytics_repository.get_overview_metrics(from_date, to_date)
        status_counts = await analytics_repository.get_order_status_counts(from_date, to_date)
        top_products = await analytics_repository.get_top_products(from_date, to_date, limit=10)
        top_farmers = await analytics_repository.get_top_farmers(from_date, to_date, limit=10)

        return {
            "totalOrders": metrics.get("totalOrders", 0),
            "totalRevenue": float(metrics.get("totalRevenue", 0.0)),
            "averageOrderValue": float(metrics.get("averageOrderValue", 0.0)),
            "deliveredOrders": metrics.get("deliveredOrders", 0),
            "cancelledOrders": metrics.get("cancelledOrders", 0),
            "totalCustomers": await user_repository.count({"role": "customer", "deletedAt": None}),
            "totalFarmers": await user_repository.count({"role": "farmer", "deletedAt": None}),
            "totalProducts": await product_repository.count({"deletedAt": None}),
            "orderStatusCounts": status_counts,
            "topProducts": top_products,
            "topFarmers": top_farmers,
            "salesTrends": await analytics_repository.get_sales_trends(from_date, to_date, interval="day")
        }

    @staticmethod
    async def get_farmer_analytics(
        farmer_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        return await FarmerAnalyticsService.get_farmer_report(
            farmer_id,
            from_date,
            to_date
        )

    @staticmethod
    async def get_warehouse_analytics(
        warehouse_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        warehouse = await warehouse_repository.get_by_id(warehouse_id)
        metrics = await analytics_repository.get_warehouse_metrics(
            warehouse_id,
            from_date,
            to_date
        )

        if warehouse:
            metrics["warehouseName"] = warehouse.get("name")

        return metrics

    @staticmethod
    async def get_top_products(
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        return await analytics_repository.get_top_products(from_date, to_date, limit)

    @staticmethod
    async def get_top_farmers(
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        return await analytics_repository.get_top_farmers(from_date, to_date, limit)

    @staticmethod
    async def get_sales_trends(
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        interval: str = "day"
    ) -> List[Dict[str, Any]]:
        return await analytics_repository.get_sales_trends(from_date, to_date, interval)
