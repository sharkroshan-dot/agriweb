from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# Delivery Risk Schemas
class DeliveryRiskRequest(BaseModel):
    orderId: str
    partnerId: Optional[str] = None
    distanceKm: Optional[float] = None
    timeWindowMinutes: Optional[int] = None
    deliverySlot: Optional[str] = None


class RiskFactor(BaseModel):
    factor: str
    impact: str
    detail: str
    points: float


class DeliveryRiskResponse(BaseModel):
    orderId: str
    orderNumber: str = ""
    riskScore: float
    riskLevel: str
    expectedDeliveryMinutes: float = 0
    recommendation: str
    factors: List[RiskFactor] = []
    confidence: float
    timestamp: datetime


# Fraud Detection Schemas
class FraudCheckRequest(BaseModel):
    orderId: Optional[str] = None
    customerId: Optional[str] = None


class FraudAlert(BaseModel):
    orderId: str
    orderNumber: str = ""
    customerId: str = ""
    customerName: str = ""
    riskScore: float
    riskLevel: str
    flags: List[str] = []
    recommendation: str
    totalAmount: float = 0
    paymentMethod: str = ""
    orderDate: Optional[datetime] = None


class FraudCheckResponse(BaseModel):
    orderId: str = ""
    orderNumber: str = ""
    customerId: str = ""
    customerName: str = ""
    riskScore: float
    riskLevel: str
    flags: List[str] = []
    recommendation: str
    factors: List[RiskFactor] = []
    confidence: float
    timestamp: datetime


# Anomaly Detection Schemas
class AnomalyAlert(BaseModel):
    entityId: str
    entityName: str
    entityType: str
    metric: str
    current: float
    median: float
    zScore: float
    isAnomaly: bool
    reason: str
    detectedAt: datetime


class SecurityCenterResponse(BaseModel):
    fraudAlerts: List[FraudAlert] = []
    anomalies: List[AnomalyAlert] = []
    fraudAlertCount: int = 0
    anomalyCount: int = 0
    timestamp: datetime


# Farmer AI Insights Schemas
class DemandInsight(BaseModel):
    productId: str
    productName: str
    expectedKg: float = 0
    level: str
    recommendation: str = ""


class DeliveryInsight(BaseModel):
    totalOrders: int = 0
    lowRisk: int = 0
    mediumRisk: int = 0
    highRisk: int = 0
    riskyOrders: List[Dict[str, Any]] = []


class PricingInsight(BaseModel):
    productId: str
    productName: str
    currentPrice: float = 0
    recommendedMin: float = 0
    recommendedMax: float = 0
    demand: str = ""
    reasons: List[str] = []


class CommunityGroupInsight(BaseModel):
    orderIds: List[str] = []
    customerCount: int = 0
    totalWeight: float = 0
    totalDistance: float = 0
    groupCount: int = 0
    savingsKm: float = 0


class FarmerInsightsResponse(BaseModel):
    demand: List[DemandInsight] = []
    delivery: DeliveryInsight
    pricing: List[PricingInsight] = []
    community: CommunityGroupInsight
    timestamp: datetime


class FarmerInsightsSummary(BaseModel):
    insights: FarmerInsightsResponse
    timestamp: datetime
