from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class AnalyticsMetricItem(BaseModel):
    id: Optional[str] = None
    name: str
    revenue: float = 0.0
    quantity: int = 0
    orderCount: int = 0

class AnalyticsTrendPoint(BaseModel):
    period: str
    orderCount: int = 0
    revenue: float = 0.0

class AnalyticsOverviewResponse(BaseModel):
    totalOrders: int = 0
    totalRevenue: float = 0.0
    averageOrderValue: float = 0.0
    deliveredOrders: int = 0
    cancelledOrders: int = 0
    totalCustomers: int = 0
    totalFarmers: int = 0
    totalProducts: int = 0
    orderStatusCounts: Dict[str, int] = {}
    topProducts: List[AnalyticsMetricItem] = []
    topFarmers: List[AnalyticsMetricItem] = []
    salesTrends: List[AnalyticsTrendPoint] = []

class FarmerAnalyticsResponse(BaseModel):
    farmerId: str
    totalOrders: int = 0
    totalRevenue: float = 0.0
    averageOrderValue: float = 0.0
    deliveredOrders: int = 0
    cancelledOrders: int = 0
    topProducts: List[AnalyticsMetricItem] = []
    orderStatusCounts: Dict[str, int] = {}
    orderStats: Dict[str, int] = {}
    categoryDistribution: List[Dict[str, Any]] = []
    revenueTrend: List[Dict[str, Any]] = []
    productStock: List[Dict[str, Any]] = []
    walletBalance: float = 0.0
    pendingEarnings: float = 0.0
    avgRating: float = 0.0
    reviewCount: int = 0
    harvestPlans: int = 0
    upcomingHarvests: int = 0
    preOrders: int = 0
    notifyMe: int = 0
    insights: List[Dict[str, Any]] = []

class WarehouseAnalyticsResponse(BaseModel):
    warehouseId: str
    totalOrders: int = 0
    totalRevenue: float = 0.0
    averageOrderValue: float = 0.0
    pendingOrders: int = 0
    deliveredOrders: int = 0
    cancelledOrders: int = 0
