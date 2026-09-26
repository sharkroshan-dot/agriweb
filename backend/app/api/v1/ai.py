from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from app.api.v1.auth import get_current_user
from app.schemas.ai import (
    PricePredictionRequest, PricePredictionResponse,
    DemandForecastRequest, DemandForecastResponse,
    RouteOptimizationRequest, RouteOptimizationResponse,
    RecommendationRequest, RecommendationResponse,
    WeatherImpactRequest, WeatherImpactResponse,
    InventoryForecastRequest, InventoryForecastResponse,
    ModelTrainingRequest, ModelTrainingResponse,
    AIModelType
)
from app.services.ai_service import AIService
from app.services.ai_extended_service import AIExtendedService
from app.services.ai_copilot_service import AICopilotService
from app.services.product_service import ProductService
from app.services.warehouse_service import WarehouseService
from app.schemas.ai_extended import (
    CropRecommendationRequest, CropRecommendationResponse,
    ChatbotRequest, ChatbotResponse,
    DiseaseDetectionRequest, DiseaseDetectionResponse,
    VoiceAssistantRequest, VoiceAssistantResponse
)
from app.schemas.ai_marketplace import (
    SmartHarvestRequest, SmartHarvestResponse,
    DeliveryTimeRequest, DeliveryTimeResponse,
    DemandHeatMapRequest, DemandHeatMapResponse,
    CommunityOrderGroupingRequest, CommunityOrderGroupingResponse
)
from app.schemas.ai_risk import (
    DeliveryRiskRequest, DeliveryRiskResponse,
    FraudCheckRequest, FraudCheckResponse,
    SecurityCenterResponse,
)
from app.services.ai_risk_service import ai_risk_service
from app.services.ai_training_service import AITrainingService
from app.tasks.ai_tasks import train_model_task
from app.services.farmer_settings_service import farmer_settings_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter()


async def _require_farmer_feature(current_user: dict, feature: str, label: str) -> None:
    """Raise 403 when a farmer has the AI feature disabled in Settings."""
    if current_user.get("role") != "farmer":
        return
    enabled = await farmer_settings_service.ai_enabled(str(current_user.get("_id")), feature)
    if not enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{label} is disabled in your settings. Enable it under AI & analytics.",
        )

@router.post("/price-predict", response_model=PricePredictionResponse)
async def predict_price(
    request: PricePredictionRequest,
    current_user: dict = Depends(get_current_user)
):
    role = current_user.get("role")
    if role not in ["farmer", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers and admins can access price predictions"
        )
    await _require_farmer_feature(current_user, "pricePrediction", "Price prediction")

    product = await ProductService.get_product(request.productId)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )

    if role == "farmer" and str(product.get("farmerId")) != str(current_user.get("_id")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only predict prices for your own products"
        )

    predictions = await AIService.predict_price(request)
    if predictions.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=predictions["error"]
        )
    return predictions

@router.post("/demand-forecast", response_model=DemandForecastResponse)
async def forecast_demand(
    request: DemandForecastRequest,
    current_user: dict = Depends(get_current_user)
):
    role = current_user.get("role")
    if role not in ["farmer", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers and admins can access demand forecasts"
        )
    await _require_farmer_feature(current_user, "demandForecast", "Demand forecast")

    product = await ProductService.get_product(request.productId)
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found"
        )

    if role == "farmer" and str(product.get("farmerId")) != str(current_user.get("_id")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only forecast demand for your own products"
        )

    forecast = await AIService.forecast_demand(request)
    if forecast.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=forecast["error"]
        )
    return forecast

@router.post("/route-optimize", response_model=RouteOptimizationResponse)
async def optimize_route(
    request: RouteOptimizationRequest,
    current_user: dict = Depends(get_current_user)
):
    role = current_user.get("role")
    if role not in ["delivery", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only delivery partners and admins can optimize routes"
        )

    route = await AIService.optimize_route(request)
    if route.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=route["error"]
        )
    return route

@router.post("/recommendations", response_model=RecommendationResponse)
async def get_recommendations(
    request: RecommendationRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "customer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can get personalized recommendations"
        )

    request.userId = str(current_user.get("_id"))
    recommendations = await AIService.get_recommendations(request)
    if recommendations.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=recommendations["error"]
        )
    return recommendations

@router.post("/weather-impact", response_model=WeatherImpactResponse)
async def analyze_weather_impact(
    request: WeatherImpactRequest,
    current_user: dict = Depends(get_current_user)
):
    await _require_farmer_feature(current_user, "weatherIntegration", "Weather integration")
    analysis = await AIService.analyze_weather_impact(request)
    return analysis

@router.post("/inventory-forecast", response_model=InventoryForecastResponse)
async def forecast_inventory(
    request: InventoryForecastRequest,
    current_user: dict = Depends(get_current_user)
):
    role = current_user.get("role")
    if role not in ["warehouse", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers and admins can forecast inventory"
        )

    if role == "warehouse":
        warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user.get("_id")))
        if not warehouse or str(warehouse.get("_id")) != request.warehouseId:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only forecast inventory for your warehouse"
            )

    forecast = await AIService.forecast_inventory(request)
    if forecast.get("error"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=forecast["error"]
        )
    return forecast

@router.get("/analytics")
async def get_ai_analytics(
    model_type: Optional[AIModelType] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access AI analytics"
        )

    analytics = await AIService.get_ai_analytics(model_type)
    return {
        "success": True,
        "data": analytics
    }

@router.post("/models/train", response_model=ModelTrainingResponse)
async def train_model(request: ModelTrainingRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can train AI models")
    job = await AITrainingService.create_job(
        request.modelType.value, request.dataConfig, request.hyperparameters, str(current_user.get("_id"))
    )
    task = train_model_task.delay(
        request.modelType.value, request.dataConfig or {}, request.hyperparameters or {}, str(job["_id"])
    )
    await AITrainingService.update(str(job["_id"]), taskId=task.id)
    job["status"] = "queued"
    return AITrainingService.public(job)

@router.get("/models/{model_id}/status")
async def get_model_status(model_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can view model status")
    try:
        job = await AITrainingService.get(model_id)
    except Exception:
        job = None
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Training job not found")
    return {"success": True, "data": AITrainingService.public(job)}

@router.post("/bulk/price-predict")
async def bulk_price_predict(
    product_ids: List[str],
    days: int = Query(7, ge=1, le=30),
    current_user: dict = Depends(get_current_user)
):
    role = current_user.get("role")
    if role not in ["farmer", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers and admins can use bulk price prediction"
        )

    results = []
    for product_id in product_ids:
        request = PricePredictionRequest(productId=product_id, days=days)
        prediction = await AIService.predict_price(request)
        if not prediction.get("error"):
            results.append(prediction)

    return {
        "success": True,
        "data": {
            "total": len(results),
            "predictions": results
        }
    }

@router.get("/models")
async def list_ai_models(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can view AI models")
    jobs = await AITrainingService.list()
    return {"success": True, "data": [AITrainingService.public(job) for job in jobs]}


