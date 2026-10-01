from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from bson import ObjectId
from app.api.v1.auth import get_current_user
from app.repositories.warehouse_repository import warehouse_repository
from app.repositories.order_repository import order_repository
from app.repositories.outgoing_stock_repository import outgoing_stock_repository
from app.schemas.warehouse import (
    WarehouseResponse, WarehouseCreate, WarehouseUpdate,
    WarehouseStockResponse, WarehouseStockCreate, WarehouseStockUpdate,
    IncomingStockResponse, IncomingStockCreate,
    OutgoingStockResponse, OutgoingStockCreate, OutgoingStockUpdate,
    ColdStorageResponse, ColdStorageCreate, ColdStorageUpdate,
    WarehouseTransferResponse, WarehouseTransferCreate,
    WarehouseDashboardResponse
)
from app.services.warehouse_service import WarehouseService
from app.services.logistics_routing_service import apply_partner_route
from app.services.delivery_job_service import build_job_document, eligible_partners_for_job, job_weight_kg, JOB_DEFAULT_EXPIRY_MINUTES
from app.repositories.delivery_job_repository import delivery_job_repository, JOB_OPEN
from app.repositories.warehouse_packing_repository import warehouse_packing_repository
from app.schemas.warehouse_packing import PackingTeamAssignment, PackingCompleteRequest, PackingVerifyRequest
import logging

logger = logging.getLogger(__name__)
class WarehouseDeliveryRouteRequest(BaseModel):
    route: str = Field(..., pattern="^(nearby|long_distance)$")
    radius: int = Field(10, ge=1, le=200)


router = APIRouter()

@router.get("/me", response_model=WarehouseResponse)
async def get_my_warehouse(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found for this user"
        )
    warehouse["id"] = str(warehouse["_id"])
    return warehouse

@router.get("/me/dashboard", response_model=WarehouseDashboardResponse)
async def get_my_dashboard(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    dashboard = await WarehouseService.get_warehouse_dashboard(str(warehouse["_id"]))
    return dashboard

@router.put("/me", response_model=WarehouseResponse)
async def update_my_warehouse(
    data: WarehouseUpdate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can update their warehouse"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse and current_user.get("role") == "warehouse":
        # Self-heal legacy warehouse accounts created before managerId was
        # standardized. This creates a profile only when none exists at all.
        from app.repositories.warehouse_repository import warehouse_repository
        now = datetime.utcnow()
        warehouse_id = await warehouse_repository.create({
            "userId": ObjectId(str(current_user["_id"])),
            "managerId": ObjectId(str(current_user["_id"])),
            "name": f"Warehouse of {current_user.get('firstName', 'Manager')}",
            "warehouseName": f"Warehouse of {current_user.get('firstName', 'Manager')}",
            "location": {},
            "address": {},
            "totalCapacity": 0,
            "coldStorageCapacity": 0,
            "usedCapacity": 0,
            "coldStorageUsed": 0,
            "isActive": True,
            "isVerified": False,
            "deletedAt": None,
            "createdAt": now,
            "updatedAt": now,
        })
        warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse profile could not be created for this account"
        )
    try:
        updated = await WarehouseService.update_warehouse(str(warehouse["_id"]), data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        ) from exc
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to update warehouse"
        )
    updated["id"] = str(updated["_id"])
    return updated

@router.get("/me/stock", response_model=dict)
async def get_my_warehouse_stock(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    stock, total = await WarehouseService.get_warehouse_stock(
        str(warehouse["_id"]),
        skip,
        limit,
        status
    )
    for item in stock:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "stock": stock,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/stock", response_model=WarehouseStockResponse)
async def add_stock(
    data: WarehouseStockCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can add stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.warehouseId = str(warehouse["_id"])
    try:
        stock = await WarehouseService.add_stock(data)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc)
        ) from exc
    if not stock:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to add stock"
        )
    stock["id"] = str(stock["_id"])
    return stock

@router.put("/me/stock/{stock_id}", response_model=WarehouseStockResponse)
async def update_stock(
    stock_id: str,
    data: WarehouseStockUpdate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can update stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    stock = await WarehouseService.update_stock(stock_id, data, str(warehouse["_id"]))
    if not stock:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stock not found"
        )
    stock["id"] = str(stock["_id"])
    return stock

@router.get("/me/incoming", response_model=dict)
async def get_my_incoming_stock(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    incoming, total = await WarehouseService.get_incoming_stock(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    for item in incoming:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "incoming": incoming,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/incoming", response_model=IncomingStockResponse)
async def schedule_incoming(
    data: IncomingStockCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can schedule incoming stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.warehouseId = str(warehouse["_id"])
    incoming = await WarehouseService.schedule_incoming(data)
    if not incoming:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to schedule incoming stock"
        )
    incoming["id"] = str(incoming["_id"])
    return incoming

@router.put("/me/incoming/{incoming_id}/receive")
async def receive_incoming_stock(
    incoming_id: str,
    quantity: int = Query(..., gt=0),
    quality_check: str = Query(..., pattern="^(pending|passed|failed)$"),
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can receive stock"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    incoming = await WarehouseService.receive_incoming(
        incoming_id,
        quantity,
        quality_check,
        notes,
        str(warehouse["_id"])
    )
    if not incoming:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to receive stock"
        )
    return {
        "success": True,
        "data": incoming,
        "message": "Stock received successfully" if quality_check == "passed" else "Stock rejected"
    }

@router.put("/me/incoming/{incoming_id}/store")
async def store_incoming_stock(
    incoming_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can store incoming stock")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    incoming = await WarehouseService.store_incoming(
        incoming_id, str(warehouse["_id"])
    )
    if not incoming:
        raise HTTPException(status_code=400, detail="Incoming stock must be received and quality approved before storage")
    return {"success": True, "data": incoming, "message": "Stock stored successfully"}


@router.get("/me/packing-tasks", response_model=dict)
async def get_packing_tasks(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access packing tasks")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse: raise HTTPException(status_code=404, detail="Warehouse not found")
    tasks = await warehouse_packing_repository.get_by_warehouse(str(warehouse["_id"]), status)
    for task in tasks:
        task["id"] = str(task["_id"])
        for key in ("warehouseId","orderId","farmerId","productId","variantId","batchId"):
            if task.get(key) is not None: task[key] = str(task[key])
    return {"success": True, "data": {"tasks": tasks}}

@router.put("/me/packing-tasks/{task_id}/assign")
async def assign_packing_team(task_id: str, data: PackingTeamAssignment, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can assign packing teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    await warehouse_packing_repository.update_task(task_id, {"packingTeamId": data.packingTeamId, "status": "assigned"})
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.put("/me/packing-tasks/{task_id}/start")
async def start_packing_task(task_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can start packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    if task.get("status") not in ("ready_for_packing","assigned"): raise HTTPException(status_code=400, detail="Task is not ready to start packing")
    await warehouse_packing_repository.update_task(task_id, {"status":"packing"})
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.put("/me/packing-tasks/{task_id}/complete")
async def complete_packing_task(task_id: str, data: PackingCompleteRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can complete packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    required = float(task.get("quantityRequired",0))
    if data.packedQuantity > required: raise HTTPException(status_code=400, detail="Packed quantity cannot exceed required quantity")
    if task.get("status") not in ("ready_for_packing","assigned","packing","partially_packed"): raise HTTPException(status_code=400, detail="Task is not packable")
    await warehouse_packing_repository.update_task(task_id, {"packedQuantity":data.packedQuantity,"packageId":data.packageId or f"PKG-{str(task['_id'])[-8:]}","packingNotes":data.notes,"status":"packed" if data.packedQuantity >= required else "partially_packed"})
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.put("/me/packing-tasks/{task_id}/verify")
async def verify_packing_task(task_id: str, data: PackingVerifyRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can verify packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    if data.verified and task.get("packedQuantity",0) < task.get("quantityRequired",0): raise HTTPException(status_code=400, detail="Complete the required quantity before verification")
    await warehouse_packing_repository.update_task(task_id, {"verified":data.verified,"verificationNotes":data.notes,"status":"ready_for_dispatch" if data.verified else "packed"})
    if data.verified:
        from app.repositories.order_repository import order_repository
        order_id=str(task["orderId"])
        await order_repository.update({"_id":ObjectId(order_id)}, {"warehouseFulfillmentStage":"ready_for_dispatch","updatedAt":datetime.utcnow()})
        existing=await outgoing_stock_repository.get_by_order_id(order_id,str(task["productId"]),str(task.get("variantId") or ""))
        if not existing:
            await WarehouseService.create_outgoing(OutgoingStockCreate(warehouseId=str(warehouse["_id"]),productId=str(task["productId"]),variantId=str(task["variantId"]) if task.get("variantId") else None,orderId=order_id,quantity=int(task.get("packedQuantity",0)),batchNumber=task.get("batchNumber")))
    return {"success":True,"data":await warehouse_packing_repository.get_by_id(task_id)}

@router.post("/me/outgoing/{outgoing_id}/delivery-route")
async def choose_warehouse_delivery_route(
    outgoing_id: str,
    data: WarehouseDeliveryRouteRequest,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can choose delivery routing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    outgoing = await outgoing_stock_repository.get_by_id(outgoing_id)
    if not outgoing or str(outgoing.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Outgoing shipment not found")
    if outgoing.get("status") != "dispatched":
        raise HTTPException(status_code=400, detail="Choose delivery routing only after warehouse dispatch")

    order_id = outgoing.get("orderId")
    if not order_id:
        raise HTTPException(status_code=400, detail="This shipment is not linked to an order")
    order = await order_repository.get_by_id(str(order_id))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    result = await apply_partner_route(
        order,
        data.route,
        data.radius,
        warehouse_id=str(warehouse["_id"]),
    )
    await order_repository.update_order_field(
        str(order_id), "warehouseFulfillmentStage", "dispatched"
    )

    # Warehouse Fulfillment delivery decision:
    # nearby -> Warehouse -> Delivery Partner -> Customer
    # long-distance -> Warehouse -> Local Hub -> Delivery Partner -> Customer
    # The partner job is opened only after the warehouse has dispatched.
    refreshed = await order_repository.get_by_id(str(order_id)) or order
    existing_job = await delivery_job_repository.get_by_order_id(str(order_id))
    job = existing_job
    if not existing_job or existing_job.get("status") != JOB_OPEN:
        destination = (refreshed.get("deliveryAddress") or {}).get("location") or {}
        coords = destination.get("coordinates") or []
        pickup = refreshed.get("deliveryPickupLocation") or {}
        pickup_coords = pickup.get("coordinates") or []
        pickup_lat = float(pickup_coords[1]) if len(pickup_coords) >= 2 else 0.0
        pickup_lng = float(pickup_coords[0]) if len(pickup_coords) >= 2 else 0.0
        delivery_lat = float(coords[1]) if len(coords) >= 2 else 0.0
        delivery_lng = float(coords[0]) if len(coords) >= 2 else 0.0
        from app.services.delivery_job_service import _haversine_km
        distance = _haversine_km(pickup_lat, pickup_lng, delivery_lat, delivery_lng)
        partners = await eligible_partners_for_job(
            pickup_lat, pickup_lng, job_weight_kg(refreshed)
        )
        eligible_ids = [p["id"] for p in partners]
        farm_location = refreshed.get("farmLocation") or {"lat": pickup_lat, "lng": pickup_lng}
        job_doc = build_job_document(
            refreshed, farm_location, distance,
            expires_in_minutes=JOB_DEFAULT_EXPIRY_MINUTES,
            eligible_partner_ids=eligible_ids,
        )
        job_id = await delivery_job_repository.create(job_doc)
        if job_id:
            job = await delivery_job_repository.get_by_id(job_id)

    return {
        "success": True,
        "data": {**result, "deliveryJob": {"id": str(job["_id"]), "status": job.get("status")} if job else None},
        "message": "Delivery decision saved and delivery partner job opened",
    }


@router.get("/me/outgoing", response_model=dict)
async def get_my_outgoing_stock(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    outgoing, total = await WarehouseService.get_outgoing_stock(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    for item in outgoing:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "outgoing": outgoing,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.put("/me/outgoing/{outgoing_id}/status")
async def update_outgoing_status(
    outgoing_id: str,
    status: str = Query(..., pattern="^(pending|packed|dispatched)$"),
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can update outgoing status"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    outgoing = await WarehouseService.update_outgoing_status(
        outgoing_id,
        status,
        str(warehouse["_id"]),
        {"notes": notes} if notes else None
    )
    if not outgoing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outgoing record not found"
        )
    return {
        "success": True,
        "data": outgoing,
        "message": f"Outgoing status updated to {status}"
    }

@router.get("/me/cold-storage", response_model=dict)
async def get_my_cold_storage(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    storage, total = await WarehouseService.get_cold_storage(
        str(warehouse["_id"]),
        skip,
        limit
    )
    for item in storage:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "coldStorage": storage,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/cold-storage", response_model=ColdStorageResponse)
async def add_cold_storage(
    data: ColdStorageCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can add to cold storage"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.warehouseId = str(warehouse["_id"])
    storage = await WarehouseService.add_cold_storage(data)
    if not storage:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to add cold storage item"
        )
    storage["id"] = str(storage["_id"])
    return storage

@router.get("/me/transfers", response_model=dict)
async def get_my_transfers(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    skip = (page - 1) * limit
    transfers, total = await WarehouseService.get_transfers(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    for item in transfers:
        item["id"] = str(item["_id"])
    return {
        "success": True,
        "data": {
            "transfers": transfers,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/me/transfers", response_model=WarehouseTransferResponse)
async def create_transfer(
    data: WarehouseTransferCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can create transfers"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    data.fromWarehouseId = str(warehouse["_id"])
    transfer = await WarehouseService.create_transfer(data)
    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create transfer. Insufficient stock or invalid destination."
        )
    transfer["id"] = str(transfer["_id"])
    return transfer

@router.put("/me/transfers/{transfer_id}/complete")
async def complete_transfer(
    transfer_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only warehouse managers can complete transfers"
        )
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    transfer = await WarehouseService.complete_transfer(
        transfer_id,
        str(current_user["_id"]),
        str(warehouse["_id"])
    )
    if not transfer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to complete transfer"
        )
    return {
        "success": True,
        "data": transfer,
        "message": "Transfer completed successfully"
    }

@router.get("/admin", response_model=dict)
async def get_all_warehouses(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    is_active: Optional[bool] = True,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    skip = (page - 1) * limit
    warehouses = await warehouse_repository.get_all_warehouses(
        is_active, skip, limit
    )
    total = await warehouse_repository.count({
        "deletedAt": None,
        "isActive": is_active if is_active is not None else True
    })
    for warehouse in warehouses:
        warehouse["id"] = str(warehouse["_id"])
    return {
        "success": True,
        "data": {
            "warehouses": warehouses,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "totalPages": (total + limit - 1) // limit
            }
        }
    }

@router.post("/admin", response_model=WarehouseResponse)
async def create_warehouse(
    data: WarehouseCreate,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can create warehouses"
        )
    warehouse = await WarehouseService.create_warehouse(data)
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create warehouse"
        )
    warehouse["id"] = str(warehouse["_id"])
    return warehouse

@router.get("/admin/{warehouse_id}", response_model=WarehouseResponse)
async def get_warehouse(
    warehouse_id: str,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    warehouse = await WarehouseService.get_warehouse(warehouse_id)
    if not warehouse:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Warehouse not found"
        )
    warehouse["id"] = str(warehouse["_id"])
    return warehouse

@router.get("/admin/stats")
async def get_warehouse_stats(
    period: str = Query("month", description="day, week, month"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can access this endpoint"
        )
    warehouses = await warehouse_repository.find_many({"deletedAt": None})
    total_warehouses = len(warehouses)
    active_warehouses = len([w for w in warehouses if w.get("isActive")])
    total_capacity = sum(w.get("totalCapacity", 0) for w in warehouses)
    total_used = sum(w.get("usedCapacity", 0) for w in warehouses)
    total_cold_capacity = sum(w.get("coldStorageCapacity", 0) for w in warehouses)
    total_cold_used = sum(w.get("coldStorageUsed", 0) for w in warehouses)
    return {
        "success": True,
        "data": {
            "summary": {
                "totalWarehouses": total_warehouses,
                "activeWarehouses": active_warehouses,
                "totalCapacity": total_capacity,
                "usedCapacity": total_used,
                "capacityUtilization": round((total_used / total_capacity * 100) if total_capacity > 0 else 0, 1),
                "coldCapacity": total_cold_capacity,
                "coldUsed": total_cold_used,
                "coldUtilization": round((total_cold_used / total_cold_capacity * 100) if total_cold_capacity > 0 else 0, 1)
            }
        }
    }
