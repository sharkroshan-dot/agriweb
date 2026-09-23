from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from typing import List, Optional
from app.api.v1.auth import get_current_user
from app.schemas.order import (
    OrderResponse, OrderCreate, OrderUpdate,
    OrderStatusUpdate, OrderTrackingResponse,
    OrderSummaryResponse, OrderFilterParams, DeliveryType, AssignPartnerRequest
)
from app.services.order_service import (
    OrderService, ProductNotFoundError, InsufficientStockError,
    AddressNotFoundError, OrderCreationError
)
from app.repositories.order_repository import order_repository
from app.services.product_service import ProductService
from app.services.user_service import UserService
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
@router.post("", status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_order(
    data: OrderCreate,
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new order (Customer only).
    
    - **items**: List of products with quantities
    - **deliveryAddressId**: Address ID for delivery
    - **specialInstructions**: Optional delivery instructions
    - **paymentMethod**: cash, card, upi, wallet
    - **couponCode**: Optional discount coupon
    """
    if current_user.get("role") != "customer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only customers can create orders"
        )
    
    if data.deliveryType == DeliveryType.DELIVERY:
        addresses = await UserService.get_addresses(str(current_user["_id"]))
        address_ids = [str(a["_id"]) for a in addresses]
        if not data.deliveryAddressId or data.deliveryAddressId not in address_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid delivery address"
            )
    elif data.deliveryType == DeliveryType.PICKUP:
        if not data.pickupDate:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Pickup date is required for pickup orders"
            )
    
    try:
        order = await OrderService.create_order(str(current_user["_id"]), data)
    except ProductNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except InsufficientStockError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except AddressNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except OrderCreationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    if not order:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create order. Please check product availability."
        )
    
    return {
        "id": str(order["_id"]),
        "orderNumber": order.get("orderNumber", ""),
        "totalAmount": order.get("totalAmount", 0),
        "orderStatus": order.get("orderStatus", "pending"),
        "createdAt": order.get("createdAt")
    }

@router.get("/{order_id}", response_model=OrderResponse)
async def get_order(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get order by ID.
    
    Returns complete order details with customer, farmer, and delivery info.
    """
    order = await OrderService.get_order(
        order_id,
        str(current_user["_id"]),
        current_user.get("role")
    )
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found or access denied"
        )
    
    return order

@router.get("/{order_id}/track", response_model=OrderTrackingResponse)
async def track_order(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Track order delivery in real-time.
    
    Returns current location, ETA, delivery partner info, and route.
    """
    tracking = await OrderService.track_order(
        order_id,
        str(current_user["_id"]),
        current_user.get("role")
    )
    
    if not tracking:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found or access denied"
        )
    
    return tracking

@router.get("", response_model=dict)
async def get_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    from_date: Optional[str] = Query(None, alias="fromDate"),
    to_date: Optional[str] = Query(None, alias="toDate"),
    current_user: dict = Depends(get_current_user)
):
    """
    Get orders for the current user based on their role.
    
    - Customers see their orders
    - Farmers see orders for their products
    - Delivery partners see their assigned deliveries
    - Admins see all orders (with filters)
    """
    # Parse dates
    from datetime import datetime
    from_date_obj = None
    to_date_obj = None
    
    if from_date:
        try:
            from_date_obj = datetime.fromisoformat(from_date.replace('Z', '+00:00'))
        except:
            pass
    
    if to_date:
        try:
            to_date_obj = datetime.fromisoformat(to_date.replace('Z', '+00:00'))
        except:
            pass
    
    filter_params = OrderFilterParams(
        status=status,
        fromDate=from_date_obj,
        toDate=to_date_obj,
        page=page,
        limit=limit
    )
    
    result = await OrderService.get_orders_by_user(
        str(current_user["_id"]),
        current_user.get("role"),
        filter_params
    )
    
    return {
        "success": True,
        "data": result
    }

@router.put("/{order_id}/status")
async def update_order_status(
    order_id: str,
    data: OrderStatusUpdate,
    current_user: dict = Depends(get_current_user)
):
    """
    Update order status.
    
    Allowed transitions based on role:
    - Farmer: pending → confirmed → processing → ready_for_delivery
    - Delivery: dispatched → in_transit → delivered
    - Customer: pending/confirmed → cancelled
    - Admin: Any status change
    """
    order = await OrderService.update_order_status(
        order_id,
        str(current_user["_id"]),
        current_user.get("role"),
        data
    )
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid status transition or access denied"
        )
    
    order["id"] = str(order["_id"])
    return {
        "success": True,
        "data": order,
        "message": f"Order status updated to {data.status.value}"
    }

@router.put("/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    reason: str = Body(..., embed=True),
    current_user: dict = Depends(get_current_user)
):
    """
    Cancel an order.
    
    Customers can cancel pending or confirmed orders.
    Farmers can cancel orders they haven't confirmed yet.
    """
    status_update = OrderStatusUpdate(
        status="cancelled",
        note=reason
    )
    
    order = await OrderService.update_order_status(
        order_id,
        str(current_user["_id"]),
        current_user.get("role"),
        status_update
    )
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order cannot be cancelled at this stage or access denied"
        )
    
    return {
        "success": True,
        "message": "Order cancelled successfully",
        "refundStatus": "processing" if order.get("paymentStatus") == "paid" else "not_applicable"
    }

@router.get("/{order_id}/summary", response_model=OrderSummaryResponse)
async def get_order_summary(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Get order summary statistics.
    """
    # Get order with permission check
    order = await OrderService.get_order(
        order_id,
        str(current_user["_id"]),
        current_user.get("role")
    )
    
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found or access denied"
        )
    
    # Calculate summary
    summary = {
        "totalOrders": 1,
        "pendingOrders": 1 if order.get("orderStatus") in ["pending", "confirmed"] else 0,
        "deliveredOrders": 1 if order.get("orderStatus") == "delivered" else 0,
        "cancelledOrders": 1 if order.get("orderStatus") == "cancelled" else 0,
        "totalRevenue": order.get("totalAmount", 0) if order.get("orderStatus") == "delivered" else 0,
        "averageOrderValue": order.get("totalAmount", 0) if order.get("orderStatus") == "delivered" else 0
    }
    
    return summary

@router.put("/{order_id}/self-delivery")
async def mark_self_delivery(
    order_id: str,
    current_user: dict = Depends(get_current_user)
):
    """
    Farmer marks order for self-delivery.
    Farmer will deliver the order directly instead of assigning a delivery partner.
    """
    if current_user.get("role") != "farmer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers can mark orders for self-delivery"
        )
    
    success = await OrderService.mark_for_self_delivery(
        order_id,
        str(current_user["_id"])
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Order must be in ready_for_delivery status and belong to you"
        )
    
    return {"success": True, "message": "Order marked for self-delivery"}

@router.put("/{order_id}/assign-partner")
async def assign_delivery_partner_manual(
    order_id: str,
    data: AssignPartnerRequest = Body(default=AssignPartnerRequest()),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "farmer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers can assign delivery partners"
        )
    
    from app.services.order_service import OrderService
    result = await OrderService.assign_delivery_partner_to_order(
        order_id,
        str(current_user["_id"]),
        data.partnerId
    )
    if result is True:
        return {"success": True, "message": "Delivery partner assigned successfully"}
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=result or "Failed to assign delivery partner."
    )


@router.get("/farmer/delivery-routes")
async def get_delivery_routes(
    current_user: dict = Depends(get_current_user)
):
    """
    Get delivery route groups for farmer.
    Shows READY_FOR_DELIVERY orders grouped by delivery area,
    so the farmer can decide to self-deliver clustered routes.
    """
    if current_user.get("role") != "farmer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers can access delivery routes"
        )
    
    routes = await OrderService.get_delivery_route_groups(
        str(current_user["_id"])
    )
    return {"success": True, "data": routes}

# Admin endpoints
@router.get("/admin/all")
async def admin_get_all_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = None,
    farmer_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    delivery_partner_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """
    Get all orders with filters (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    
    # Parse dates
    from datetime import datetime
    from_date_obj = None
    to_date_obj = None
    
    if from_date:
        try:
            from_date_obj = datetime.fromisoformat(from_date.replace('Z', '+00:00'))
        except:
            pass
    
    if to_date:
        try:
            to_date_obj = datetime.fromisoformat(to_date.replace('Z', '+00:00'))
        except:
            pass
    
    filter_params = OrderFilterParams(
        status=status,
        fromDate=from_date_obj,
        toDate=to_date_obj,
        farmerId=farmer_id,
        customerId=customer_id,
        deliveryPartnerId=delivery_partner_id,
        page=page,
        limit=limit
    )
    
    orders, total = await order_repository.get_orders_by_filters(filter_params)
    
    # Enrich orders with user details
    for order in orders:
        order["id"] = str(order["_id"])
        # Add customer details
        customer = await UserService.get_user_by_id(str(order["customerId"]))
        if customer:
            order["customer"] = {
                "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}",
                "phone": customer.get("phone"),
                "email": customer.get("email")
            }
    
    return {
        "success": True,
        "data": {
            "orders": orders,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.get("/farmer/bulk-summary")
async def farmer_bulk_order_summary(
    current_user: dict = Depends(get_current_user)
):
    """
    Get bulk order summary for farmer.
    Shows aggregated orders per product that qualify for bulk pricing.
    """
    if current_user.get("role") != "farmer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only farmers can access this endpoint"
        )
    
    farmer_id = str(current_user["_id"])
    bulk_orders = await order_repository.get_bulk_order_summary(farmer_id)
    return {
        "success": True,
        "data": bulk_orders
    }

@router.put("/{order_id}/confirm-pickup")
async def confirm_pickup(
    order_id: str,
    current_user: dict = Depends(get_current_user),
    otp: Optional[str] = Body(None, embed=True)
):
    """
    Customer confirms pickup of their order.
    Used for pickup-type orders when customer collects from farm.
    """
    order = await OrderService.get_order(
        order_id,
        str(current_user["_id"]),
        current_user.get("role")
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    if order.get("deliveryType") != "pickup":
        raise HTTPException(status_code=400, detail="Not a pickup order")
    
    if order.get("orderStatus") != "ready_for_pickup":
        raise HTTPException(status_code=400, detail="Order is not ready for pickup")
    
    status_update = OrderStatusUpdate(
        status="picked_up",
        note="Customer confirmed pickup",
        otp=otp
    )
    updated = await OrderService.update_order_status(
        order_id,
        str(current_user["_id"]),
        current_user.get("role"),
        status_update
    )
    if not updated:
        raise HTTPException(status_code=400, detail="Failed to confirm pickup")
    
    return {"success": True, "message": "Pickup confirmed successfully"}

@router.get("/admin/stats")
async def admin_get_order_stats(
    period: str = Query("today", description="today, week, month, year"),
    current_user: dict = Depends(get_current_user)
):
    """
    Get order statistics (Admin only).
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    
    from datetime import datetime, timedelta
    
    # Calculate date range based on period
    now = datetime.utcnow()
    if period == "today":
        start_date = datetime(now.year, now.month, now.day)
        end_date = start_date + timedelta(days=1)
    elif period == "week":
        start_date = now - timedelta(days=7)
        end_date = now
    elif period == "month":
        start_date = now - timedelta(days=30)
        end_date = now
    elif period == "year":
        start_date = now - timedelta(days=365)
        end_date = now
    else:
        start_date = None
        end_date = None
    
    # Get stats
    stats = await order_repository.get_order_summary(
        date_from=start_date,
        date_to=end_date
    )
    
    # Get daily trend
    daily_stats = []
    if start_date and end_date:
        days = (end_date - start_date).days
        for i in range(min(days, 30)):  # Limit to 30 days
            day = start_date + timedelta(days=i)
            next_day = day + timedelta(days=1)
            day_stats = await order_repository.get_order_summary(
                date_from=day,
                date_to=next_day
            )
            daily_stats.append({
                "date": day.strftime("%Y-%m-%d"),
                "orders": day_stats.get("totalOrders", 0),
                "revenue": day_stats.get("totalRevenue", 0)
            })
    
    return {
        "success": True,
        "data": {
            "summary": stats,
            "trend": daily_stats,
            "period": period
        }
    }
