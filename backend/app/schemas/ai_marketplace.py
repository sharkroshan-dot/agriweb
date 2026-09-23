from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class SmartHarvestRequest(BaseModel):
    productId: str
    plantingDate: datetime
    expectedYield: float = Field(gt=0)
    location: str
    cropType: str


class HarvestDateRange(BaseModel):
    start: str
    end: str
    quality: str
    score: float


class SmartHarvestResponse(BaseModel):
    productId: str
    cropType: str
    recommendedDateRange: HarvestDateRange
    alternativeWindows: List[HarvestDateRange]
    expectedQualityAtDifferentDates: List[Dict[str, Any]]
    marketTimingScore: float
    weatherAdvisory: str
    festivalDemandSpikes: List[Dict[str, Any]]
    timestamp: datetime


class DeliveryTimeRequest(BaseModel):
    originLat: float
    originLng: float
    destinationLat: float
    destinationLng: float
    vehicleType: str = "truck"
    timeOfDay: int = Field(ge=0, le=23)
    dayOfWeek: int = Field(ge=0, le=6)


class FactorBreakdown(BaseModel):
    distance: float
    baseTime: float
    trafficMultiplier: float
    weatherMultiplier: float
    dayMultiplier: float
    vehicleSpeed: float


class DeliveryTimeResponse(BaseModel):
    estimatedMinutes: float
    estimatedDistance: float
    confidence: float
    factors: FactorBreakdown
    timestamp: datetime


class DemandHeatMapRequest(BaseModel):
    state: str
    district: Optional[str] = None
    category: Optional[str] = None
    product: Optional[str] = None
    period: str = "7d"
    radiusKm: int = 500
    mode: str = "demand"
    customerType: str = "all"


class CustomerBreakdown(BaseModel):
    householdKg: float = 0.0
    bulkEventKg: float = 0.0
    b2bKg: float = 0.0


class PredictedRange(BaseModel):
    low: float = 0.0
    high: float = 0.0


class DemandFactors(BaseModel):
    quantity: float = 0.0
    frequency: float = 0.0
    uniqueCustomers: float = 0.0
    trend: float = 0.0
    predicted: float = 0.0
    distance: float = 0.0


class LocationDemand(BaseModel):
    model_config = ConfigDict(extra="allow")
    location: str
    area: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    distanceKm: Optional[float] = None
    demandScore: float
    demandLabel: str
    actualDemandKg: float = 0.0
    predictedDemandKg: float = 0.0
    supplyKg: float = 0.0
    gapKg: float = 0.0
    growthPct: float = 0.0
    orderCount: int = 0
    uniqueCustomers: int = 0
    orderFrequency: float = 0.0
    confidence: str = "low"
    confidenceNote: Optional[str] = None
    predictedRange: Optional[PredictedRange] = None
    customerBreakdown: Optional[CustomerBreakdown] = None
    factors: Optional[DemandFactors] = None
    topProducts: List[str] = []
    seasonalFactor: float = 1.0
    populationFactor: float = 1.0
    modeValue: float = 0.0
    modeUnit: str = "kg"
    modeLabel: str = "demand"


class RankedArea(BaseModel):
    model_config = ConfigDict(extra="allow")
    rank: int
    location: str
    distanceKm: Optional[float] = None
    demandScore: float = 0.0
    growthPct: float = 0.0
    predictedDemandKg: float = 0.0
    supplyKg: float = 0.0
    gapKg: float = 0.0
    opportunity: str = "LOW"
    recommendedQuantityKg: float = 0.0
    confidence: str = "low"
    reasons: List[str] = []
    topProducts: List[str] = []


class DemandHeatMapResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    state: str
    district: Optional[str] = None
    category: Optional[str] = None
    product: Optional[str] = None
    period: str = "7d"
    periodLabel: str = "Next 7 days"
    radiusKm: int = 50
    mode: str = "demand"
    customerType: str = "all"
    farm: Optional[Dict[str, Any]] = None
    products: List[str] = []
    locations: List[LocationDemand]
    rankedAreas: List[RankedArea] = []
    summary: Dict[str, Any] = {}
    totalDemandScore: float
    recommendations: str
    forecastModel: str = "statistical baseline"
    timestamp: datetime


class OrderGroupItem(BaseModel):
    orderId: str
    lat: float
    lng: float
    deliveryTimeWindowStart: Optional[str] = None
    deliveryTimeWindowEnd: Optional[str] = None
    weight: float = Field(default=0, gt=0)


class CommunityOrderGroupingRequest(BaseModel):
    orders: List[OrderGroupItem]
    vehicleCapacity: float = Field(default=100, gt=0)
    maxRadiusKm: float = Field(default=50, gt=0)


class GroupRoute(BaseModel):
    stopSequence: List[str]
    totalDistanceKm: float
    totalTimeMinutes: float
    optimizedRoute: List[Dict[str, float]]


class OrderGroup(BaseModel):
    groupId: int
    orders: List[str]
    centroid: Dict[str, float]
    route: GroupRoute
    utilizationPercent: float


class CommunityOrderGroupingResponse(BaseModel):
    groups: List[OrderGroup]
    totalGroups: int
    totalDistanceKm: float
    totalTimeMinutes: float
    unassignedOrders: List[str]
    timestamp: datetime
