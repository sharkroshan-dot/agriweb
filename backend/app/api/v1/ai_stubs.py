from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from app.api.v1.auth import get_current_user
from app.schemas.ai_marketplace import SmartHarvestRequest
from app.schemas.ai import PricePredictionRequest, DemandForecastRequest, RouteOptimizationRequest
from app.services.ai_service import AIService
from app.services.ai_copilot_service import AICopilotService

router = APIRouter()


@router.get("/analytics")
async def get_ai_analytics_stub(
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can access AI analytics")
    now = datetime.utcnow()
    return {
        "success": True,
        "data": {
            "models": [
                {
                    "modelType": "price_prediction",
                    "predictionAccuracy": 0.85,
                    "totalPredictions": 1250,
                    "averageConfidence": 0.82,
                    "lastPrediction": now,
                    "status": "deployed",
                    "metrics": {"mae": 2.5, "rmse": 4.1, "r2": 0.78}
                },
                {
                    "modelType": "demand_forecast",
                    "predictionAccuracy": 0.82,
                    "totalPredictions": 980,
                    "averageConfidence": 0.79,
                    "lastPrediction": now,
                    "status": "deployed",
                    "metrics": {"mae": 3.2, "rmse": 5.8, "r2": 0.74}
                },
                {
                    "modelType": "route_optimization",
                    "predictionAccuracy": 0.90,
                    "totalPredictions": 560,
                    "averageConfidence": 0.85,
                    "lastPrediction": now,
                    "status": "training",
                    "metrics": {"savings_per_route": 23.5, "routes_optimized": 560}
                }
            ],
            "timestamp": now
        }
    }


@router.get("/models")
async def list_ai_models_stub(
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can view AI models")
    return {
        "success": True,
        "data": [
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
    }


@router.post("/price-predict")
async def predict_price_stub(request: PricePredictionRequest, current_user: dict = Depends(get_current_user)):
    role = current_user.get("role")
    if role not in ["farmer", "admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only farmers and admins can access price predictions")
    result = await AIService.predict_price(request)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/demand-forecast")
async def demand_forecast_stub(request: DemandForecastRequest, current_user: dict = Depends(get_current_user)):
    role = current_user.get("role")
    if role not in ["farmer", "admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only farmers and admins can access demand forecasts")
    result = await AIService.forecast_demand(request)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.post("/smart-harvest")
async def smart_harvest_stub(
    request: SmartHarvestRequest,
    current_user: dict = Depends(get_current_user),
):
    from app.services.ai_extended_service import AIExtendedService
    return await AIExtendedService.smart_harvest_planner(request)


@router.post("/route-optimize")
async def optimize_route_stub(request: RouteOptimizationRequest, current_user: dict = Depends(get_current_user)):
    role = current_user.get("role")
    if role not in ["farmer", "delivery", "admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only farmers, delivery partners, and admins can optimize routes")
    result = await AIService.optimize_route(request)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/copilot/brief")
async def copilot_brief_stub(current_user: dict = Depends(get_current_user)):
    role = (current_user.get("role") or "customer").lower()
    brief = await AICopilotService.build_brief(role, current_user)
    return {"success": True, "data": brief}
