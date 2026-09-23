from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class AnalyticsMetric(BaseModel):
    id: Optional[str]
    name: str
    revenue: float = 0.0
    quantity: int = 0
    orderCount: int = 0

class AnalyticsTrend(BaseModel):
    period: str
    orderCount: int = 0
    revenue: float = 0.0

class AnalyticsOverview(BaseModel):
    totalOrders: int = 0
    totalRevenue: float = 0.0
    averageOrderValue: float = 0.0
    deliveredOrders: int = 0
    cancelledOrders: int = 0
    totalCustomers: int = 0
    totalFarmers: int = 0
    totalProducts: int = 0
    orderStatusCounts: Dict[str, int] = {}
    topProducts: List[AnalyticsMetric] = []
    topFarmers: List[AnalyticsMetric] = []
    salesTrends: List[AnalyticsTrend] = []
