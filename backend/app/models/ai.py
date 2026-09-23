from pydantic import BaseModel
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

class AIModelMetadata(BaseModel):
    modelId: str
    modelType: AIModelType
    version: str
    status: ModelStatus
    accuracy: Optional[float] = None
    metrics: Optional[Dict[str, float]] = None
    registeredAt: datetime
    deployedAt: Optional[datetime] = None

class AIAnalyticsReport(BaseModel):
    modelType: AIModelType
    predictionAccuracy: float
    totalPredictions: int
    averageConfidence: float
    lastPrediction: datetime
    status: ModelStatus
    metrics: Dict[str, float]
