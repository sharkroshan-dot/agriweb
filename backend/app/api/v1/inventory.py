from fastapi import APIRouter, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from typing import Optional, List
from datetime import datetime
import json
import logging

from app.api.v1.auth import get_current_user
from app.services.inventory_service import inventory_service, active_stock_connections
from app.schemas.inventory import (
    ReserveRequest,
    ReserveResponse,
    ConfirmReservationRequest,
    ConfirmReservationResponse,
    CancelReservationRequest,
    CancelReservationResponse,
    StockResponse,
    FarmerStockSummary,
    InventoryAnalytics,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/reserve", response_model=ReserveResponse)
async def reserve_stock(
    data: ReserveRequest,
    current_user: dict = Depends(get_current_user),
):
    """Reserve stock for a product. Stock is held for 15 minutes."""
    if current_user.get("role") not in ("customer", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only customers can reserve stock")

    result = await inventory_service.reserve_product(
        str(current_user["_id"]), data.product_id, data.quantity
    )
    if not result:
        stock = await inventory_service.get_stock(data.product_id)
        if stock and stock.available_stock < data.quantity:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient stock. Available: {stock.available_stock}",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to reserve stock. Product may not exist.",
        )

    return ReserveResponse(**result)


@router.post("/confirm")
async def confirm_reservation(
    data: ConfirmReservationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Confirm a reservation after successful payment. Moves reserved → sold."""
    result = await inventory_service.confirm_reservation(data.reservation_id, data.order_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reservation not found, already expired, or already confirmed.",
        )
    return {"success": True, "data": result}


@router.post("/cancel")
async def cancel_reservation(
    data: CancelReservationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Cancel a reservation and release the stock back."""
    result = await inventory_service.cancel_reservation(data.reservation_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reservation not found or already processed.",
        )
    return {"success": True, "data": result}


@router.get("/stock/{product_id}", response_model=StockResponse)
async def get_product_stock(product_id: str):
    """Get live stock information for a product."""
    stock = await inventory_service.get_stock(product_id)
    if not stock:
        stock = StockResponse(
            product_id=product_id,
            total_stock=0,
            reserved_stock=0,
            sold_stock=0,
            available_stock=0,
            unit="kg",
            is_out_of_stock=True,
        )
    return stock


@router.get("/farmer/summary")
async def get_farmer_stock_summary(
    current_user: dict = Depends(get_current_user),
):
    """Get stock summary for the current farmer's products."""
    if current_user.get("role") not in ("farmer", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only farmers can view stock summary")

    farmer_id = str(current_user["_id"])
    summary = await inventory_service.get_farmer_stock_summary(farmer_id)
    return {"success": True, "data": summary}


@router.get("/customer/reservations")
async def get_customer_reservations(
    current_user: dict = Depends(get_current_user),
):
    """Get all reservations for the current customer."""
    if current_user.get("role") != "customer":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only customers can view their reservations")

    reservations = await inventory_service.get_customer_reservations(
        str(current_user["_id"])
    )
    return {"success": True, "data": reservations}


@router.get("/admin/analytics")
async def get_admin_inventory_analytics(
    current_user: dict = Depends(get_current_user),
):
    """Get inventory analytics (Admin only)."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    analytics = await inventory_service.get_admin_inventory_analytics()
    return {"success": True, "data": analytics}


@router.websocket("/ws/stock/{product_id}")
async def stock_websocket(websocket: WebSocket, product_id: str):
    """WebSocket endpoint for real-time stock updates on a product."""
    await websocket.accept()

    if product_id not in active_stock_connections:
        active_stock_connections[product_id] = []
    active_stock_connections[product_id].append(websocket)

    try:
        stock = await inventory_service.get_stock(product_id)
        if stock:
            await websocket.send_json({
                "type": "stock_update",
                "data": stock.dict(),
            })

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error for product {product_id}: {str(e)}")
    finally:
        if product_id in active_stock_connections:
            if websocket in active_stock_connections[product_id]:
                active_stock_connections[product_id].remove(websocket)
            if not active_stock_connections[product_id]:
                del active_stock_connections[product_id]
