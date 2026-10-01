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
from app.services.user_service import UserService
from app.services.logistics_routing_service import apply_partner_route
from app.services.delivery_job_service import build_job_document, eligible_partners_for_job, job_weight_kg, JOB_DEFAULT_EXPIRY_MINUTES
from app.repositories.delivery_job_repository import delivery_job_repository, JOB_OPEN
from app.repositories.warehouse_packing_repository import warehouse_packing_repository
from app.schemas.warehouse_packing import PackingTeamAssignment, PackingCompleteRequest, PackingVerifyRequest
from app.repositories.warehouse_collection_repository import warehouse_collection_repository
from app.services.warehouse_collection_service import serialize_collection
import logging

logger = logging.getLogger(__name__)
class WarehouseReceiveRequest(BaseModel):
    quantity: int = Field(..., gt=0)
    usableQuantity: Optional[float] = Field(None, ge=0)
    qualityCheck: str = Field(..., pattern="^(pending|passed|failed)$")
    notes: Optional[str] = None


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

class CollectionTeamAssignment(BaseModel):
    teamId: str = Field(..., min_length=1, max_length=100)


@router.get("/me/collections", response_model=dict)
async def get_collection_queue(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access collection jobs")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    jobs = await warehouse_collection_repository.get_by_warehouse(str(warehouse["_id"]), status)
    return {"success": True, "data": {"collections": [serialize_collection(x) for x in jobs]}}


@router.put("/me/collections/{collection_id}/assign")
async def assign_collection_team(collection_id: str, data: CollectionTeamAssignment, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign collection teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    job = await warehouse_collection_repository.get_by_id(collection_id)
    if not warehouse or not job or str(job.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Collection job not found")
    if job.get("status") not in ("ready_for_pickup", "team_assigned"):
        raise HTTPException(status_code=400, detail="Collection job is not waiting for team assignment")
    await warehouse_collection_repository.update_job(collection_id, {"collectionTeamId": data.teamId, "status": "team_assigned", "teamAssignedAt": datetime.utcnow()})
    if job.get("orderId"):
        await order_repository.update({"_id": ObjectId(str(job["orderId"]))}, {"warehouseCollectionStatus": "team_assigned", "warehouseCollectionTeamId": data.teamId, "warehouseFulfillmentStage": "collection_team_assigned", "updatedAt": datetime.utcnow()})
        await order_repository.append_tracking_event(str(job["orderId"]), "collection_team_assigned", "Collection team assigned", "A warehouse collection team has been assigned to collect the farm shipment.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"teamId": data.teamId})
    return {"success": True, "data": serialize_collection(await warehouse_collection_repository.get_by_id(collection_id))}


@router.put("/me/collections/{collection_id}/status")
async def update_collection_status(collection_id: str, collection_status: str = Query(..., alias="status", pattern="^(en_route|arrived_at_farm|collected|departed_farm|arrived_warehouse)$"), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can update collection jobs")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    job = await warehouse_collection_repository.get_by_id(collection_id)
    if not warehouse or not job or str(job.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Collection job not found")
    allowed = {
        "team_assigned": {"en_route"}, "en_route": {"arrived_at_farm"},
        "arrived_at_farm": {"collected"}, "collected": {"departed_farm"},
        "departed_farm": {"arrived_warehouse"},
    }
    current = str(job.get("status") or "")
    if collection_status not in allowed.get(current, set()):
        raise HTTPException(status_code=400, detail=f"Invalid collection transition: {current} -> {collection_status}")
    update = {"status": collection_status}
    if collection_status == "collected": update["collectedAt"] = datetime.utcnow()
    if collection_status == "arrived_warehouse": update["arrivedWarehouseAt"] = datetime.utcnow()
    await warehouse_collection_repository.update_job(collection_id, update)
    incoming_id = job.get("incomingStockId")
    if incoming_id and collection_status == "collected":
        from app.repositories.incoming_stock_repository import incoming_stock_repository
        await incoming_stock_repository.update({"_id": ObjectId(str(incoming_id))}, {"status": "in_transit", "collectedAt": datetime.utcnow(), "updatedAt": datetime.utcnow()})
    if incoming_id and collection_status == "arrived_warehouse":
        # Arrival at the warehouse is not the same as warehouse receipt.
        # Keep the incoming shipment in transit until staff performs Receive + QC.
        from app.repositories.incoming_stock_repository import incoming_stock_repository
        await incoming_stock_repository.update({"_id": ObjectId(str(incoming_id))}, {"status": "in_transit", "arrivedWarehouseAt": datetime.utcnow(), "updatedAt": datetime.utcnow()})
        if job.get("orderId"):
            await order_repository.update({"_id": ObjectId(str(job["orderId"]))}, {"warehouseCollectionStatus": "arrived_warehouse", "warehouseFulfillmentStage": "warehouse_arrived", "updatedAt": datetime.utcnow()})
            await order_repository.append_tracking_event(str(job["orderId"]), "arrived_warehouse", "Shipment arrived at warehouse", "The collection team has arrived at the warehouse. Warehouse receiving and quality check are still required.", actor_id=str(current_user["_id"]), actor_role="warehouse")
    elif job.get("orderId"):
        stage_map = {"en_route": "collection_en_route", "arrived_at_farm": "collection_arrived", "collected": "collected", "departed_farm": "collection_departed"}
        await order_repository.update({"_id": ObjectId(str(job["orderId"]))}, {"warehouseCollectionStatus": collection_status, "warehouseFulfillmentStage": stage_map[collection_status], "updatedAt": datetime.utcnow()})
        await order_repository.append_tracking_event(str(job["orderId"]), f"collection_{collection_status}", {"en_route":"Collection team en route","arrived_at_farm":"Collection team arrived at farm","collected":"Product collected from farm","departed_farm":"Collection team departed farm"}[collection_status], "Warehouse collection progress updated.", actor_id=str(current_user["_id"]), actor_role="warehouse")
    return {"success": True, "data": serialize_collection(await warehouse_collection_repository.get_by_id(collection_id))}


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
    usable_quantity: Optional[float] = Query(None, ge=0, alias="usableQuantity"),
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
        str(warehouse["_id"]),
        usable_quantity
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
        if task.get("orderId"):
            order = await order_repository.get_by_id(str(task["orderId"]))
            if order:
                task["orderNumber"] = order.get("orderNumber")
                task["deliveryAddress"] = order.get("deliveryAddress") or {}
                task["items"] = [
                    {
                        "productId": str(item.get("productId")),
                        "productName": item.get("productName") or "Product",
                        "quantity": float(item.get("quantity", 0) or 0),
                        "unitPrice": item.get("unitPrice", 0),
                    }
                    for item in (order.get("items") or [])
                ]
                customer = await UserService.get_user_by_id(str(order.get("customerId"))) if order.get("customerId") else None
                task["customer"] = {
                    "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip() if customer else "Customer",
                    "phone": customer.get("phone") if customer else None,
                }
    return {"success": True, "data": {"tasks": tasks}}

@router.get("/me/packing-tasks/{task_id}/label")
async def get_packing_label(task_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access packing labels")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Packing task not found")
    order = await order_repository.get_by_id(str(task["orderId"])) if task.get("orderId") else None
    if not order:
        raise HTTPException(status_code=404, detail="Order not found for packing task")
    customer = await UserService.get_user_by_id(str(order.get("customerId"))) if order.get("customerId") else None
    address = order.get("deliveryAddress") or {}
    items = [
        {"productName": item.get("productName") or "Product", "quantity": float(item.get("quantity", 0) or 0), "unit": item.get("unit") or "kg"}
        for item in (order.get("items") or [])
    ]
    return {"success": True, "data": {
        "packageId": task.get("packageId") or f"PKG-{str(task['_id'])[-8:]}",
        "orderId": str(order["_id"]),
        "orderNumber": order.get("orderNumber"),
        "customer": {"name": f"{customer.get('firstName','')} {customer.get('lastName','')}".strip() if customer else "Customer", "phone": customer.get("phone") if customer else None},
        "items": items,
        "address": address,
        "quantityTotal": sum(x["quantity"] for x in items),
    }}

@router.put("/me/packing-tasks/{task_id}/assign")
async def assign_packing_team(task_id: str, data: PackingTeamAssignment, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can assign packing teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    await warehouse_packing_repository.update_task(task_id, {"packingTeamId": data.packingTeamId, "status": "assigned"})
    from app.repositories.order_repository import order_repository
    await order_repository.update(
        {"_id": ObjectId(str(task["orderId"]))},
        {"warehouseFulfillmentStage": "packing_team_assigned", "packingTeamId": data.packingTeamId, "updatedAt": datetime.utcnow()},
    )
    await order_repository.append_tracking_event(str(task["orderId"]), "packing_team_assigned", "Packing team assigned", "The warehouse packing team has been assigned to this customer order.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"packingTeamId": data.packingTeamId, "quantityRequired": task.get("quantityRequired", 0)})
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.put("/me/packing-tasks/{task_id}/start")
async def start_packing_task(task_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can start packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    if task.get("status") not in ("ready_for_packing","assigned"): raise HTTPException(status_code=400, detail="Task is not ready to start packing")
    await warehouse_packing_repository.update_task(task_id, {"status":"packing"})
    from app.repositories.order_repository import order_repository
    await order_repository.update(
        {"_id": ObjectId(str(task["orderId"]))},
        {"warehouseFulfillmentStage": "packing", "updatedAt": datetime.utcnow()},
    )
    await order_repository.append_tracking_event(str(task["orderId"]), "packing_started", "Packing started", "The packing team has started preparing your customer package.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"quantityRequired": task.get("quantityRequired", 0)})
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.put("/me/packing-tasks/{task_id}/complete")
async def complete_packing_task(task_id: str, data: PackingCompleteRequest, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse": raise HTTPException(status_code=403, detail="Only warehouse managers can complete packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]): raise HTTPException(status_code=404, detail="Packing task not found")
    required = float(task.get("quantityRequired") or 0)
    if task.get("status") not in ("ready_for_packing","assigned","packing","partially_packed"):
        raise HTTPException(status_code=400, detail="Task is not packable")
    packing_items = [dict(x) for x in (task.get("packingItems") or [])]
    if not packing_items:
        raise HTTPException(status_code=400, detail="Packing checklist is missing for this order. Re-sync the warehouse packing task before packing.")

    # The actual packed quantity is the authoritative shortage check.
    # Do not decide the final shortage from inventory availability alone.
    requested = {}
    for item in (data.items or []):
        key = (str(item.productId), str(item.variantId or ""))
        requested[key] = max(0.0, float(item.packedQuantity))

    if not requested:
        # Backward-compatible clients pack the currently available quantity.
        for line in packing_items:
            key = (str(line.get("productId")), str(line.get("variantId") or ""))
            available = float(line.get("quantityAvailable") or 0)
            requested[key] = available

    any_shortage = False
    for line in packing_items:
        key = (str(line.get("productId")), str(line.get("variantId") or ""))
        required_line = float(line.get("quantityRequired") or 0)
        already_packed = float(line.get("packedQuantity") or 0)
        actual = max(already_packed, requested.get(key, 0.0))
        if actual > required_line + 1e-9:
            raise HTTPException(status_code=400, detail=f"Packed quantity cannot exceed required quantity for {line.get('productName') or line.get('productId')}")
        line["packedQuantity"] = min(required_line, actual)
        line["verified"] = False
        line["quantityShort"] = max(0.0, required_line - line["packedQuantity"])
        # This is informational until packing is complete; it becomes the
        # authoritative shortage only after the final pack action.
        any_shortage = any_shortage or line["quantityShort"] > 1e-9

    packed_total = sum(float(x.get("packedQuantity") or 0) for x in packing_items)
    all_packed = all(float(x.get("packedQuantity") or 0) + 1e-9 >= float(x.get("quantityRequired") or 0) for x in packing_items)
    packed_status = "packed" if all_packed else "partially_packed"

    await warehouse_packing_repository.update_task(
        task_id,
        {
            "packedQuantity": packed_total,
            "packingItems": packing_items,
            "packageId": data.packageId or f"PKG-{str(task['_id'])[-8:]}",
            "packingNotes": data.notes,
            "status": packed_status,
            "packingAttemptComplete": True,
            "shortageDetectedAfterPacking": any_shortage,
        },
    )

    from app.repositories.order_repository import order_repository
    order = await order_repository.get_by_id(str(task["orderId"]))
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if all_packed:
        await order_repository.update(
            {"_id": ObjectId(str(task["orderId"]))},
            {"warehouseFulfillmentStage": "packed", "packingComplete": True, "updatedAt": datetime.utcnow()},
        )
        event = ("packing_completed", "Order packing completed",
                 "All customer-order quantities were physically packed. Final shortage check found no shortage.")
    else:
        # Final shortage is now known from the physical pack result.
        # Create/update shortage cases only now; do not use an inventory
        # availability shortage as the final business decision.
        from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
        existing_cases = await warehouse_shortage_repository.get_by_warehouse(str(warehouse["_id"]), status=None, limit=1000)
        existing_by_key = {
            (str(x.get("orderId")), str(x.get("productId")), str(x.get("variantId") or "")): x
            for x in existing_cases
            if str(x.get("orderId")) == str(task["orderId"]) and x.get("status") not in ("resolved", "cancelled")
        }
        for line in packing_items:
            short = float(line.get("quantityShort") or 0)
            if short <= 1e-9:
                continue
            key = (str(task["orderId"]), str(line.get("productId")), str(line.get("variantId") or ""))
            case = existing_by_key.get(key)
            payload = {
                "orderId": ObjectId(str(task["orderId"])),
                "warehouseId": ObjectId(str(warehouse["_id"])),
                "productId": ObjectId(str(line["productId"])),
                "variantId": ObjectId(str(line["variantId"])) if line.get("variantId") else None,
                "requiredQuantity": float(line.get("quantityRequired") or 0),
                "availableQuantity": float(line.get("packedQuantity") or 0),
                "shortageQuantity": short,
                "shortageType": "packing_shortage",
                "status": (case or {}).get("status") or "resolution_required",
                "resolutionType": (case or {}).get("resolutionType"),
                "notes": "Final shortage determined from actual physical packing.",
            }
            if case:
                await warehouse_shortage_repository.update_case(str(case["_id"]), payload)
            else:
                await warehouse_shortage_repository.create_case(payload)

        await order_repository.update(
            {"_id": ObjectId(str(task["orderId"]))},
            {
                "warehouseFulfillmentStage": "shortage_pending",
                "packingComplete": True,
                "shortageDetected": True,
                "shortageResolutionRequired": True,
                "updatedAt": datetime.utcnow(),
            },
        )
        event = ("packing_completed_with_shortage", "Packing completed with shortage",
                 "Physical packing finished and the unresolved quantity requires a shortage resolution before dispatch.")

    await order_repository.append_tracking_event(
        str(task["orderId"]), event[0], event[1], event[2],
        actor_id=str(current_user["_id"]), actor_role="warehouse",
        metadata={"packedQuantity": packed_total, "quantityRequired": required,
                  "packageId": data.packageId or f"PKG-{str(task['_id'])[-8:]}"}
    )
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

@router.get("/me/orders/{order_id}/fulfillment-check")
async def warehouse_fulfillment_check(order_id: str, current_user: dict = Depends(get_current_user)):
    """Return a hard completion checklist before a warehouse order can dispatch."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can audit fulfillment")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order or str(order.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Warehouse order not found")
    tasks = await warehouse_packing_repository.get_by_order_all(order_id)
    outgoing = await outgoing_stock_repository.find_many({"orderId": ObjectId(order_id), "warehouseId": ObjectId(str(warehouse["_id"])), "deletedAt": None}, skip=0, limit=1000)
    required = [{"productId": str(i.get("productId")), "variantId": str(i.get("variantId") or ""), "quantity": float(i.get("quantity") or 0), "productName": i.get("productName") or "Product"} for i in (order.get("items") or [])]
    packed = {}
    for t in tasks:
        for line in (t.get("packingItems") or []):
            packed[str(line.get("itemKey"))] = float(line.get("packedQuantity") or 0)
    missing=[]
    for i in required:
        key=f"{i['productId']}:{i['variantId']}"
        qty=packed.get(key, 0.0)
        if qty + 1e-9 < i["quantity"]:
            missing.append({**i, "packedQuantity": qty})
    all_verified=bool(tasks) and all(t.get("verified") is True for t in tasks) and not missing
    outgoing_keys={(str(x.get("productId")), str(x.get("variantId") or "")): float(x.get("quantity") or 0) for x in outgoing}
    missing_outgoing=[]
    for i in required:
        qty=outgoing_keys.get((i["productId"],i["variantId"]),0)
        if qty + 1e-9 < i["quantity"]: missing_outgoing.append({**i,"outgoingQuantity":qty})
    shortage_pending = bool(order.get("shortageResolutionRequired")) or str(order.get("warehouseFulfillmentStage") or "") == "shortage_pending"
    # A resolved Cancel/Refund shortage changes the final order quantities.
    # Dispatch is evaluated against those final quantities, never the original
    # customer-requested quantity.
    final_quantity_complete = not missing
    ready=all_verified and final_quantity_complete and not missing_outgoing and not shortage_pending and str(order.get("warehouseFulfillmentStage")) in ("ready_for_dispatch","delivery_decision")
    return {"success":True,"data":{"orderId":order_id,"orderNumber":order.get("orderNumber"),"readyForDispatch":ready,"packingComplete":not missing,"allPackingVerified":all_verified,"outgoingComplete":not missing_outgoing,"shortagePending":shortage_pending,"missingItems":missing,"missingOutgoing":missing_outgoing,"taskCount":len(tasks),"outgoingCount":len(outgoing)}}

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
        packing_items = task.get("packingItems") or []
        if not packing_items or any(float(x.get("packedQuantity") or 0) + 1e-9 < float(x.get("quantityRequired") or 0) for x in packing_items):
            raise HTTPException(status_code=400, detail="Every customer order item must be completely packed before verification")
        await warehouse_packing_repository.update_task(task_id, {"packingItems": [{**x, "verified": True} for x in packing_items]})
        await order_repository.update({"_id":ObjectId(order_id)}, {"warehouseFulfillmentStage":"ready_for_dispatch","packingComplete":True,"packingVerified":True,"packingTaskId":task["_id"],"updatedAt":datetime.utcnow()})
        await order_repository.append_tracking_event(order_id, "packing_verified", "Packing verified", "Every product in the customer order was packed and verified. The complete package is ready for dispatch.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"packageId": task.get("packageId"), "quantity": task.get("packedQuantity", 0), "itemCount": len(packing_items)})
        # One outgoing shipment record is created for every customer-order line.
        # No line is allowed to disappear behind a single-product outgoing row.
        for line in packing_items:
            existing=await outgoing_stock_repository.get_by_order_id(order_id,str(line["productId"]),str(line.get("variantId") or ""))
            if not existing:
                created = await WarehouseService.create_outgoing(OutgoingStockCreate(warehouseId=str(warehouse["_id"]),productId=str(line["productId"]),variantId=str(line.get("variantId")) if line.get("variantId") else None,orderId=order_id,quantity=int(line.get("packedQuantity") or 0),batchNumber=line.get("batchNumber")))
                if not created:
                    raise HTTPException(status_code=400, detail=f"Could not create dispatch record for {line.get('productName') or line.get('productId')}")
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
    if outgoing.get("status") not in ("pending", "dispatched"):
        raise HTTPException(
            status_code=400,
            detail="Delivery routing can be selected only when the package is Ready for Dispatch or already Dispatched",
        )

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
    # Delivery routing is an order-level decision. Persist it to every
    # outgoing line so a multi-product package cannot split accidentally.
    order_outgoings = await outgoing_stock_repository.find_many(
        {"orderId": ObjectId(str(order_id)), "warehouseId": ObjectId(str(warehouse["_id"])), "deletedAt": None},
        skip=0, limit=1000,
    )
    for row in order_outgoings:
        await outgoing_stock_repository.update(
            {"_id": row["_id"]},
            {
                "deliveryPartnerRoute": data.route,
                "deliveryRouteRadiusKm": data.radius,
                "deliveryRouteSelectedAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow(),
            },
        )
    # Ready for Dispatch -> Delivery Decision happens before the physical
    # warehouse dispatch. The delivery job is opened only after the outgoing
    # shipment is actually dispatched.
    if outgoing.get("status") == "pending":
        await order_repository.update(
            {"_id": ObjectId(str(order_id))},
            {
                "warehouseFulfillmentStage": "delivery_decision",
                "deliveryPartnerRoute": data.route,
                "updatedAt": datetime.utcnow(),
            },
        )
        return {
            "success": True,
            "data": {**result, "deliveryJob": None},
            "message": "Delivery route selected. Dispatch the warehouse shipment next.",
        }

    await order_repository.update_order_field(
        str(order_id), "warehouseFulfillmentStage", "dispatched"
    )

    # Warehouse Fulfillment delivery decision:
    # nearby -> Warehouse -> Delivery Partner -> Customer
    # long-distance -> Warehouse -> Local Hub -> Delivery Partner -> Customer
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
        raise HTTPException(status_code=403, detail="Only warehouse managers can update outgoing status")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    outgoing = await outgoing_stock_repository.get_by_id(outgoing_id)
    if not outgoing or str(outgoing.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Outgoing record not found")
    if status != "dispatched":
        updated = await WarehouseService.update_outgoing_status(outgoing_id, status, str(warehouse["_id"]), {"notes": notes} if notes else None)
        if not updated:
            raise HTTPException(status_code=400, detail="Outgoing status update is not allowed")
        return {"success": True, "data": updated, "message": f"Outgoing status updated to {status}"}

    # Dispatch is an ORDER-level operation. A multi-product customer order
    # must leave the warehouse as one complete shipment; never dispatch only
    # the line that happened to be clicked in the UI.
    order_id = str(outgoing.get("orderId") or "")
    if not order_id:
        raise HTTPException(status_code=400, detail="Outgoing record is not linked to an order")
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Warehouse order not found")
    all_outgoing = await outgoing_stock_repository.find_many({
        "orderId": ObjectId(order_id), "warehouseId": ObjectId(str(warehouse["_id"])), "deletedAt": None
    }, skip=0, limit=1000)
    required = {(str(i.get("productId")), str(i.get("variantId") or "")): float(i.get("quantity") or 0) for i in (order.get("items") or [])}
    by_key = {(str(x.get("productId")), str(x.get("variantId") or "")): x for x in all_outgoing}
    missing=[]
    for key, qty in required.items():
        row=by_key.get(key)
        if not row or float(row.get("quantity") or 0) + 1e-9 < qty:
            missing.append({"productId":key[0],"variantId":key[1] or None,"required":qty,"outgoing":float((row or {}).get("quantity") or 0)})
        if row and str(row.get("deliveryPartnerRoute") or "") not in ("nearby","long_distance"):
            missing.append({"productId":key[0],"reason":"Delivery route not selected"})
    if missing:
        raise HTTPException(status_code=400, detail={"message":"This customer order cannot be dispatched because one or more order lines are incomplete.","missing":missing})
    if any(str(x.get("status") or "pending") == "dispatched" for x in all_outgoing) and not all(str(x.get("status") or "pending") == "dispatched" for x in all_outgoing):
        raise HTTPException(status_code=409, detail="This order is partially dispatched. Resolve the shipment before continuing.")
    dispatched=[]
    for row in all_outgoing:
        if str(row.get("status") or "pending") == "dispatched":
            dispatched.append(str(row["_id"]))
            continue
        updated = await WarehouseService.update_outgoing_status(str(row["_id"]), "dispatched", str(warehouse["_id"]), {"notes": notes} if notes else None)
        if not updated:
            raise HTTPException(status_code=400, detail=f"Could not dispatch complete order line {row.get('productId')}")
        dispatched.append(str(row["_id"]))
    await order_repository.append_tracking_event(order_id, "warehouse_order_dispatched", "Complete customer order dispatched", "All packed customer-order lines were dispatched together from the warehouse.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"outgoingCount":len(dispatched),"route":outgoing.get("deliveryPartnerRoute")})
    return {"success":True,"data":{"orderId":order_id,"outgoingIds":dispatched},"message":"Complete customer order dispatched. No order line was left behind."}

class ShortageResolutionRequest(BaseModel):
    resolutionType: str = Field(
        ...,
        pattern="^(farmer_replenishment|customer_approval_pending|substitution_pending|refund_cancellation)$",
    )
    notes: Optional[str] = None
    resolvedQuantity: Optional[float] = Field(None, ge=0)
    approvedQuantity: Optional[float] = Field(None, ge=0)
    substituteProductId: Optional[str] = None
    substituteVariantId: Optional[str] = None


@router.put("/me/shortages/{shortage_id}/resolution")
async def update_shortage_resolution(
    shortage_id: str,
    data: ShortageResolutionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Record and execute a shortage resolution for one affected order line.

    Available stock is never discarded. This endpoint only resolves the
    missing quantity; the packing task is then recalculated so already
    available quantity can continue through packing immediately.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can resolve shortage cases")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
    case = await warehouse_shortage_repository.get_by_id(shortage_id)
    if not case or str(case.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Shortage case not found")
    if case.get("status") in ("resolved", "cancelled"):
        raise HTTPException(status_code=400, detail="Shortage case is already closed")

    required = float(case.get("requiredQuantity") or 0)
    available = float(case.get("availableQuantity") or 0)
    shortage = max(0.0, required - available)
    resolution = data.resolutionType

    if resolution == "farmer_replenishment":
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "replenishment_requested",
            "replenishmentQuantity": shortage,
            "notes": data.notes or "Farmer replenishment requested for the unresolved quantity.",
        })
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": f"Replenishment requested for {shortage:g} kg. The available quantity remains packable."}

    if resolution == "customer_approval_pending":
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "customer_approval_pending",
            "proposedQuantity": data.approvedQuantity if data.approvedQuantity is not None else available,
            "notes": data.notes or "Customer approval is required for the reduced quantity.",
        })
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": "Customer approval is pending. Available quantity remains reserved for this order."}

    if resolution == "substitution_pending":
        if not data.substituteProductId:
            raise HTTPException(status_code=400, detail="substituteProductId is required for substitution")
        if not ObjectId.is_valid(data.substituteProductId):
            raise HTTPException(status_code=400, detail="Invalid substitute product ID")
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "substitution_pending",
            "substituteProductId": ObjectId(data.substituteProductId),
            "substituteVariantId": ObjectId(data.substituteVariantId) if data.substituteVariantId else None,
            "proposedQuantity": shortage,
            "notes": data.notes or "Substitute product requires customer approval before packing.",
        })
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": "Substitution proposal recorded. Customer approval is required."}

    if resolution == "refund_cancellation":
        if data.resolvedQuantity is None or data.resolvedQuantity <= 0:
            raise HTTPException(status_code=400, detail="resolvedQuantity is required for refund/cancellation")
        if data.resolvedQuantity > shortage + 1e-9:
            raise HTTPException(status_code=400, detail="Refund quantity cannot exceed the shortage")
        order = await order_repository.get_by_id(str(case["orderId"]))
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        # Do not silently alter the paid amount. Record the exact quantity
        # approved for cancellation/refund for the payment/refund workflow.
        new_available = available + float(data.resolvedQuantity)
        fully_resolved = new_available + 1e-9 >= required
        await warehouse_shortage_repository.update_case(shortage_id, {
            "resolutionType": resolution,
            "status": "resolved" if fully_resolved else "partial_allocation",
            "refundQuantity": float(data.resolvedQuantity),
            "availableQuantity": new_available,
            "remainingShortage": max(0.0, required - new_available),
            "resolvedAt": datetime.utcnow() if fully_resolved else None,
            "notes": data.notes or "Unfulfilled quantity marked for refund/cancellation processing.",
        })
        # Cancel/refund the unavailable portion of the customer order. The
        # physically packed quantity stays unchanged; only the order line and
        # payable amount are reduced.
        cancel_qty = float(data.resolvedQuantity)
        items = [dict(x) for x in (order.get("items") or [])]
        for item in items:
            if str(item.get("productId")) == str(case.get("productId")) and str(item.get("variantId") or "") == str(case.get("variantId") or ""):
                original_qty = float(item.get("quantity") or 0)
                if cancel_qty > max(0.0, original_qty - available) + 1e-9:
                    raise HTTPException(status_code=400, detail="Cancellation quantity exceeds the unresolved packed shortage")
                item["quantity"] = max(0.0, original_qty - cancel_qty)
                item["totalPrice"] = float(item.get("unitPrice") or 0) * item["quantity"]
                break
        items = [x for x in items if float(x.get("quantity") or 0) > 1e-9]
        final_subtotal = sum(float(x.get("totalPrice") or 0) for x in items)
        final_discount = min(float(order.get("discount") or 0), final_subtotal)
        final_total = max(0.0, final_subtotal + float(order.get("deliveryCharge") or 0) + float(order.get("platformFee") or 0) - final_discount)
        payment_method = str(order.get("paymentMethod") or "").lower()
        is_cod = payment_method in ("cash", "cod", "cash_on_delivery")
        order_update = {
            "items": items,
            "subtotal": final_subtotal,
            "discount": final_discount,
            "totalAmount": final_total,
            "finalPayableAmount": final_total,
            "shortageResolutionRequired": False if fully_resolved else True,
            "shortageResolved": fully_resolved,
            "warehouseFulfillmentStage": "packed" if fully_resolved else "shortage_pending",
            "shortagePaymentHandling": "cod_amount_reduced" if is_cod else "refund_required",
            "updatedAt": datetime.utcnow(),
        }
        if not is_cod and str(order.get("paymentStatus") or "").lower() == PaymentStatus.PAID.value:
            order_update["refundStatus"] = "pending"
            order_update["refundRequiredAmount"] = float(data.resolvedQuantity) * float(case.get("unitPrice") or 0)
        await order_repository.update({"_id": order["_id"]}, order_update)

        # Align the packing checklist with the final customer quantities after
        # cancellation/refund, so verification checks the final order, not the
        # original unavailable quantity.
        packing_task = await warehouse_packing_repository.get_by_order(str(case["orderId"]))
        if packing_task:
            final_lines = []
            for line in (packing_task.get("packingItems") or []):
                key_product = str(line.get("productId"))
                key_variant = str(line.get("variantId") or "")
                matched = next(
                    (x for x in items if str(x.get("productId")) == key_product and str(x.get("variantId") or "") == key_variant),
                    None,
                )
                final_required = float(matched.get("quantity") or 0) if matched else 0.0
                final_lines.append({
                    **line,
                    "quantityRequired": final_required,
                    "quantityShort": 0.0,
                    "packedQuantity": min(float(line.get("packedQuantity") or 0), final_required),
                    "verified": False,
                })
            await warehouse_packing_repository.update_task(
                str(packing_task["_id"]),
                {
                    "quantityRequired": sum(float(x.get("quantityRequired") or 0) for x in final_lines),
                    "packedQuantity": sum(float(x.get("packedQuantity") or 0) for x in final_lines),
                    "packingItems": final_lines,
                    "status": "packed",
                },
            )

        await order_repository.append_tracking_event(
            str(case["orderId"]),
            "shortage_refund_requested",
            "Short quantity marked for refund/cancellation",
            f"{data.resolvedQuantity:g} kg of shortage was marked for refund/cancellation.",
            actor_id=str(current_user["_id"]),
            actor_role="warehouse",
            metadata={"shortageId": shortage_id, "quantity": float(data.resolvedQuantity)},
        )
        await WarehouseService.ensure_order_packing_task(str(case["orderId"]), str(warehouse["_id"]))
        return {"success": True, "data": await warehouse_shortage_repository.get_by_id(shortage_id),
                "message": "Short quantity recorded for refund/cancellation and packing was recalculated."}

    raise HTTPException(status_code=400, detail="Unsupported shortage resolution")


@router.get("/me/shortages")
async def get_my_shortages(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access shortage cases")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
    cases = await warehouse_shortage_repository.get_by_warehouse(str(warehouse["_id"]), status_filter)
    for case in cases:
        case["id"] = str(case["_id"])
        for key in ("orderId", "warehouseId", "productId", "variantId"):
            if case.get(key) is not None:
                case[key] = str(case[key])
    return {"success": True, "data": {"shortages": cases}}


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
