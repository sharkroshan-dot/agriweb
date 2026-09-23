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
async def train_model(
    request: ModelTrainingRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can train AI models"
        )

    return {
        "modelId": f"model_{datetime.utcnow().timestamp()}",
        "modelType": request.modelType,
        "status": "training",
        "accuracy": None,
        "metrics": None,
        "startedAt": datetime.utcnow(),
        "completedAt": None,
        "message": "Model training started"
    }

@router.get("/models/{model_id}/status")
async def get_model_status(
    model_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view model status"
        )

    return {
        "success": True,
        "data": {
            "modelId": model_id,
            "status": "ready",
            "progress": 100,
            "accuracy": 0.85
        }
    }

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
async def list_ai_models(
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view AI models"
        )

    models = [
        {
            "id": "price_prediction_v1",
            "type": "price_prediction",
            "version": "1.0",
            "status": "deployed",
            "accuracy": 0.85,
            "deployedAt": datetime.utcnow() - timedelta(days=30)
        },
        {
            "id": "demand_forecast_v1",
            "type": "demand_forecast",
            "version": "1.0",
            "status": "deployed",
            "accuracy": 0.82,
            "deployedAt": datetime.utcnow() - timedelta(days=25)
        },
        {
            "id": "route_optimization_v2",
            "type": "route_optimization",
            "version": "2.0",
            "status": "training",
            "accuracy": None,
            "deployedAt": None
        }
    ]

    return {
        "success": True,
        "data": models
    }

@router.post("/crop-recommendation", response_model=CropRecommendationResponse)
async def recommend_crop(
    request: CropRecommendationRequest,
    current_user: dict = Depends(get_current_user)
):
    await _require_farmer_feature(current_user, "smartRecommendations", "Smart recommendations")
    return await AIExtendedService.recommend_crop(request)

@router.post("/chatbot", response_model=ChatbotResponse)
async def chatbot_query(
    request: ChatbotRequest,
    current_user: dict = Depends(get_current_user)
):
    return await AIExtendedService.chatbot_response(request, current_user)

@router.post("/disease-detection", response_model=DiseaseDetectionResponse)
async def detect_disease(
    request: DiseaseDetectionRequest,
    current_user: dict = Depends(get_current_user)
):
    return await AIExtendedService.detect_disease(request)

@router.post("/voice-assistant", response_model=VoiceAssistantResponse)
async def voice_assistant(
    request: VoiceAssistantRequest,
    current_user: dict = Depends(get_current_user)
):
    return await AIExtendedService.voice_assistant(request, current_user)

@router.post("/smart-harvest", response_model=SmartHarvestResponse)
async def smart_harvest_planner(
    request: SmartHarvestRequest,
    current_user: dict = Depends(get_current_user)
):
    return await AIExtendedService.smart_harvest_planner(request)

@router.post("/delivery-time", response_model=DeliveryTimeResponse)
async def delivery_time_estimation(
    request: DeliveryTimeRequest,
    current_user: dict = Depends(get_current_user)
):
    return await AIExtendedService.delivery_time_estimation(request)

@router.post("/demand-heatmap", response_model=DemandHeatMapResponse)
async def demand_heat_map(
    request: DemandHeatMapRequest,
    current_user: dict = Depends(get_current_user)
):
    await _require_farmer_feature(current_user, "demandForecast", "Demand forecast")
    return await AIExtendedService.demand_heat_map(request, current_user)

@router.post("/community-grouping", response_model=CommunityOrderGroupingResponse)
async def community_order_grouping(
    request: CommunityOrderGroupingRequest,
    current_user: dict = Depends(get_current_user)
):
    return await AIExtendedService.community_order_grouping(request)

@router.post("/delivery-risk", response_model=DeliveryRiskResponse)
async def predict_delivery_risk(
    request: DeliveryRiskRequest,
    current_user: dict = Depends(get_current_user)
):
    """Predict delivery risk for an order before it starts.

    Embedded in the farmer Order Map / Smart Route and partner My Deliveries.
    Produces a recommendation only — the farmer/partner stays in control.
    """
    role = current_user.get("role")
    if role not in ["farmer", "delivery", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers, delivery partners and admins can access delivery risk"
        )

    result = await ai_risk_service.predict_delivery_risk(
        request.orderId,
        partner_id=request.partnerId,
        distance_km=request.distanceKm,
        time_window_minutes=request.timeWindowMinutes,
        delivery_slot=request.deliverySlot,
    )
    if result.get("error"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=result["error"]
        )
    return result

@router.post("/fraud-check", response_model=FraudCheckResponse)
async def check_fraud(
    request: FraudCheckRequest,
    current_user: dict = Depends(get_current_user)
):
    """Fraud risk check for an order.

    Shown in the Admin Security Center. A high score triggers manual review /
    additional verification — never an automatic ban.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can run fraud checks"
        )

    if not request.orderId:
        return {
            "orderId": "",
            "riskScore": 0,
            "riskLevel": "LOW",
            "flags": [],
            "recommendation": "No order provided",
            "factors": [],
            "confidence": 0,
            "timestamp": datetime.utcnow(),
        }

    result = await ai_risk_service.check_order_fraud(request.orderId)
    if result.get("error"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=result["error"]
        )
    return result

@router.get("/security-center", response_model=SecurityCenterResponse)
async def security_center(
    current_user: dict = Depends(get_current_user)
):
    """Admin Security Center: fraud alerts + system anomalies."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access the security center"
        )

    return await ai_risk_service.get_security_center()

@router.get("/farmer/insights")
async def farmer_insights(
    current_user: dict = Depends(get_current_user)
):
    """Farmer dashboard AI insights.

    Combines demand forecast, delivery risk, smart pricing and community
    delivery grouping into one payload for the farmer's dashboard.
    """
    role = current_user.get("role")
    if role != "farmer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers can access their AI insights"
        )

    insights = await ai_risk_service.get_farmer_insights(str(current_user.get("_id")))

    user_id = str(current_user.get("_id"))
    demand_ok = await farmer_settings_service.ai_enabled(user_id, "demandForecast")
    pricing_ok = await farmer_settings_service.ai_enabled(user_id, "pricePrediction")
    recs_ok = await farmer_settings_service.ai_enabled(user_id, "smartRecommendations")
    if not demand_ok:
        insights["demand"] = []
    if not pricing_ok:
        insights["pricing"] = []
    if not recs_ok:
        insights["community"] = {}

    return {
        "success": True,
        "data": insights
    }


@router.get("/copilot/brief")
async def copilot_brief(
    current_user: dict = Depends(get_current_user)
):
    """Return a compact role-aware AI brief for dashboard widgets."""
    role = (current_user.get("role") or "customer").lower()
    if role not in {"customer", "farmer", "delivery", "business"}:
        role = "customer"
    brief = await AICopilotService.build_brief(role, current_user)
    return {"success": True, "data": brief}
