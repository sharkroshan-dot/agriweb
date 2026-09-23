from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

class AIModelType(str, Enum):
    PRICE_PREDICTION = "price_prediction"
    DEMAND_FORECAST = "demand_forecast"
    ROUTE_OPTIMIZATION = "route_optimization"
    PRODUCT_RECOMMENDATION = "product_recommendation"
    WEATHER_IMPACT = "weather_impact"
    INVENTORY_FORECAST = "inventory_forecast"

class ModelStatus(str, Enum):
    TRAINING = "training"
    READY = "ready"
    DEPLOYED = "deployed"
    FAILED = "failed"
    RETIRED = "retired"

# Price Prediction Schemas
class PricePredictionRequest(BaseModel):
    productId: str
    days: int = 7
    includeFactors: bool = True

class PricePredictionResponse(BaseModel):
    productId: str
    productName: str
    currentPrice: float
    predictedPrice: float
    trend: str  # upward, downward, stable
    confidence: float
    recommendation: str
    factors: Dict[str, float]
    predictions: List[Dict[str, Any]]
    timestamp: datetime

# Demand Forecast Schemas
class DemandForecastRequest(BaseModel):
    productId: str
    period: int = 7
    location: Optional[Dict[str, Any]] = None

class DemandForecastResponse(BaseModel):
    productId: str
    productName: str
    currentDemand: float
    predictedDemand: List[Dict[str, Any]]
    confidence: float
    recommendation: str
    seasonalFactors: Dict[str, Any]
    timestamp: datetime

# Route Optimization Schemas
class RouteOptimizationRequest(BaseModel):
    startLocation: Dict[str, Any]
    destinations: List[Dict[str, Any]]
    vehicleType: str = "bike"
    optimizationType: str = "distance"
    timeWindows: Optional[List[Dict[str, Any]]] = None
    maxWeight: Optional[float] = None

class RouteOptimizationResponse(BaseModel):
    optimizedRoute: List[Dict[str, Any]]
    totalDistance: float
    totalTime: float
    fuelEstimated: float
    savings: Dict[str, float]
    routeGeometry: Dict[str, Any]
    algorithm: str
    computationTime: float

# Product Recommendation Schemas
class RecommendationRequest(BaseModel):
    userId: str
    limit: int = 10
    type: str = "personalized"

class RecommendationResponse(BaseModel):
    recommendations: List[Dict[str, Any]]
    type: str
    total: int
    timestamp: datetime

# Weather Impact Schemas
class WeatherImpactRequest(BaseModel):
    location: Dict[str, Any]
    productId: Optional[str] = None
    days: int = 5

class WeatherImpactResponse(BaseModel):
    location: str
    product: Optional[str] = None
    weather: Dict[str, Any]
    impactScore: float
    recommendation: str
    forecast: List[Dict[str, Any]]
    timestamp: datetime

# Inventory Forecast Schemas
class InventoryForecastRequest(BaseModel):
    productId: str
    warehouseId: str
    days: int = 30

class InventoryForecastResponse(BaseModel):
    productId: str
    warehouseId: str
    currentStock: float
    predictedDemand: List[Dict[str, Any]]
    reorderPoint: float
    recommendedOrder: float
    confidence: float
    timestamp: datetime

# Model Training Schemas
class ModelTrainingRequest(BaseModel):
    modelType: AIModelType
    dataConfig: Dict[str, Any]
    hyperparameters: Optional[Dict[str, Any]] = None

class ModelTrainingResponse(BaseModel):
    modelId: str
    modelType: AIModelType
    status: ModelStatus
    accuracy: Optional[float] = None
    metrics: Optional[Dict[str, float]] = None
    startedAt: datetime
    completedAt: Optional[datetime] = None
    message: Optional[str] = None

# AI Analytics
class AIAnalytics(BaseModel):
    modelType: AIModelType
    predictionAccuracy: float
    totalPredictions: int
    averageConfidence: float
    lastPrediction: datetime
    status: ModelStatus
    metrics: Dict[str, float]
