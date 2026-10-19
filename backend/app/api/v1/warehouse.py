from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import Any, Dict, List, Optional
from datetime import datetime
import math
from zoneinfo import ZoneInfo
from pydantic import BaseModel, Field
from bson import ObjectId
from app.database.mongodb import MongoDB
from app.api.v1.auth import get_current_user
from app.repositories.warehouse_repository import warehouse_repository
from app.repositories.farmer_repository import farmer_repository
from app.repositories.delivery_repository import delivery_repository
from app.repositories.order_repository import order_repository
from app.repositories.address_repository import address_repository
from app.repositories.product_repository import product_repository
from app.repositories.outgoing_stock_repository import outgoing_stock_repository
from app.repositories.incoming_stock_repository import incoming_stock_repository
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
from app.services.logistics_routing_service import apply_partner_route, allocate_farmer_fulfillment_warehouses, classify_farmer_fulfillment_route, distance_km, nearest_local_hub, warehouse_for_district
from app.services.delivery_job_service import build_job_document, build_warehouse_pickup_job, eligible_partners_for_job, job_weight_kg, JOB_DEFAULT_EXPIRY_MINUTES
from app.repositories.delivery_job_repository import delivery_job_repository, JOB_OPEN
from app.repositories.warehouse_packing_repository import warehouse_packing_repository
from app.schemas.warehouse_packing import PackingTeamAssignment, PackingCompleteRequest, PackingVerifyRequest
from app.repositories.warehouse_collection_repository import warehouse_collection_repository
from app.services.warehouse_collection_service import (
    ensure_collection_job,
    farmer_collection_district,
    serialize_collection,
    warehouse_collection_districts,
)
from app.repositories.warehouse_pickup_team_repository import warehouse_pickup_team_repository
from app.repositories.warehouse_pickup_route_repository import warehouse_pickup_route_repository
from app.services.warehouse_pickup_route_service import build_smart_routes, serialize_route, assign_route, enrich_pickup_route_display
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationPriority, NotificationType
import logging

logger = logging.getLogger(__name__)


def _make_json_safe(value: Any) -> Any:
    """Convert MongoDB values (especially nested ObjectIds) to API-safe JSON values."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _make_json_safe(child) for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_make_json_safe(child) for child in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return value
class WarehouseReceiveRequest(BaseModel):
    quantity: int = Field(..., gt=0)
    usableQuantity: Optional[float] = Field(None, ge=0)
    qualityCheck: str = Field(..., pattern="^(pending|passed|failed)$")
    notes: Optional[str] = None


class WarehouseIncomingQualityRequest(BaseModel):
    qualityCheck: str = Field(..., pattern="^(passed|failed)$")
    usableQuantity: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None


class WarehouseIncomingStoreRequest(BaseModel):
    usableQuantity: Optional[float] = Field(None, gt=0)
    storageLocation: Optional[str] = Field(None, min_length=1, max_length=120)
    storageType: Optional[str] = Field(None, pattern="^(ambient|cold|refrigerated|frozen|dry|other)$")


class WarehouseDeliveryRouteRequest(BaseModel):
    """Route a warehouse-fulfilled shipment using the shared 15 km default threshold.

    Farmer-packed orders are intentionally handled by the dedicated
    farmer-fulfillment transfer endpoints instead of the normal outgoing route.
    """
    route: str = Field(..., pattern="^(nearby|long_distance)$")
    radius: int = Field(15, ge=1, le=200)


class WarehouseFarmerReturnRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)
    quantity: Optional[float] = Field(None, gt=0)


router = APIRouter()


def _enforce_warehouse_operating_window(window: str) -> None:
    """Enforce warehouse logistics windows in IST at the API boundary."""
    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    is_farm_pickup_window = now.hour >= 20 or now.hour < 6
    if window == "farm_pickup" and not is_farm_pickup_window:
        raise HTTPException(status_code=409, detail="Farm pickup routes can only be assigned or started between 20:00 and 06:00 IST.")
    if window == "downstream_transfer" and is_farm_pickup_window:
        raise HTTPException(status_code=409, detail="Warehouse-to-warehouse and local-hub transfers can only be dispatched between 06:00 and 20:00 IST.")


async def _get_farmer_fulfillment_incoming_rows(order: dict, warehouse_id: str) -> List[Dict[str, Any]]:
    """Load packed receipt rows linked to an order across supported legacy schemas."""
    order_id = str(order.get("_id") or "")
    if not ObjectId.is_valid(order_id):
        return []

    link_clauses = [{"orderId": {"$in": [ObjectId(order_id), order_id]}}]
    order_number = order.get("orderNumber")
    if order_number:
        link_clauses.extend([
            {"orderNumber": order_number},
            {"orderNo": order_number},
        ])

    collections = await warehouse_collection_repository.get_by_order(order_id)
    collection_ids = [collection["_id"] for collection in collections if collection.get("_id")]
    if collection_ids:
        link_clauses.append({
            "collectionId": {"$in": collection_ids + [str(value) for value in collection_ids]}
        })
    packed_collection_ids = {
        str(collection.get("_id"))
        for collection in collections
        if (
            str(collection.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
            or collection.get("packingRequired") is False
            or str(collection.get("collectionType") or "").strip().lower() == "packed_orders_transfer"
        )
    }

    rows = await incoming_stock_repository.find_many({
        "$and": [
            {"warehouseId": {"$in": [ObjectId(warehouse_id), warehouse_id]}},
            {"deletedAt": None},
            {"$or": link_clauses},
        ],
    }, skip=0, limit=1000)
    return [
        row for row in rows
        if (
            str(row.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
            or row.get("packingRequired") is False
            or str(row.get("collectionType") or "").strip().lower() == "packed_orders_transfer"
            or str(row.get("fulfillmentType") or "").strip().lower() == "farmer_fulfillment"
            or str(row.get("shipmentType") or "").strip().lower() == "farmer_fulfillment"
            or bool(row.get("orderId") and row.get("pickupRouteId"))
            or str(row.get("collectionId") or "") in packed_collection_ids
        )
    ]


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
    return _make_json_safe(dashboard)


# ---------------------------------------------------------------------------
# Warehouse fulfillment control plane
# ---------------------------------------------------------------------------

@router.get("/me/collections", response_model=dict)
async def get_my_collections(
    status_filter: Optional[str] = Query("all", alias="status"),
    current_user: dict = Depends(get_current_user),
):
    """Return warehouse collection jobs with human-readable related entity details."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access farm collections")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    warehouse_id = str(warehouse["_id"])
    jobs = await warehouse_collection_repository.get_by_warehouse(warehouse_id, status_filter, limit=1000)
    products_collection = MongoDB.get_collection("products")
    batches_collection = MongoDB.get_collection("batches")

    order_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    product_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    batch_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    farmer_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    user_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    partner_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    route_cache: Dict[str, Optional[Dict[str, Any]]] = {}

    def readable(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text or ObjectId.is_valid(text):
            return None
        return text

    configured_districts = warehouse_collection_districts(warehouse)
    # Explicit farm-collection coverage wins; otherwise the Settings location
    # district is used as this warehouse's default coverage.
    district_source = (
        "farm_collection_settings"
        if warehouse.get("farmCollectionDistricts")
        else "warehouse_settings_location" if configured_districts else None
    )

    async def get_user(user_id: Optional[str]) -> Optional[Dict[str, Any]]:
        key = str(user_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in user_cache:
            user_cache[key] = await UserService.get_user_by_id(key)
        return user_cache[key]

    async def get_order(order_id: Optional[str]) -> Optional[Dict[str, Any]]:
        key = str(order_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in order_cache:
            order_cache[key] = await order_repository.get_by_id(key)
        return order_cache[key]

    async def get_product(product_id: Optional[str]) -> Optional[Dict[str, Any]]:
        key = str(product_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in product_cache:
            product_cache[key] = await products_collection.find_one({"_id": ObjectId(key), "deletedAt": None})
            if not product_cache[key]:
                # Some legacy records store references as strings.
                product_cache[key] = await products_collection.find_one({"_id": key, "deletedAt": None})
        return product_cache[key]

    async def get_batch(batch_id: Optional[str]) -> Optional[Dict[str, Any]]:
        key = str(batch_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in batch_cache:
            batch_cache[key] = await batches_collection.find_one({"_id": ObjectId(key), "deletedAt": None})
        return batch_cache[key]

    async def get_farmer(farmer_id: Optional[str]) -> Optional[Dict[str, Any]]:
        key = str(farmer_id or "")
        if not key or not ObjectId.is_valid(key):
            return None
        if key not in farmer_cache:
            profile = await farmer_repository.get_by_user_id(key)
            if not profile:
                profile = await farmer_repository.get_by_id(key)
            farmer_cache[key] = profile
        return farmer_cache[key]

    # Reconcile incoming-stock records first. This covers BOTH warehouse
    # fulfillment bulk pickups and sealed Farmer Fulfillment transfers, even if
    # the order document has a legacy/missing fulfillmentMethod or the older
    # order-based recovery query cannot classify it.
    incoming_refs = [ObjectId(warehouse_id), warehouse_id]
    incoming_candidates = await incoming_stock_repository.find_many({
        "$and": [
            {"warehouseId": {"$in": incoming_refs}},
            {"deletedAt": None},
            {"$or": [
                {"readyForPickup": True},
                {"transferReadyForPickup": True},
                {"warehouseTransferReadyForPickup": True},
                {"status": {"$in": ["ready_for_pickup", "team_assigned", "en_route", "arrived_at_farm", "collected", "departed_farm"]}},
                {"sourceMode": "farmer_fulfillment_transfer"},
                {"collectionType": "packed_orders_transfer"},
            ]},
        ]
    }, skip=0, limit=2000)

    recovered_from_incoming = 0
    for incoming in incoming_candidates:
        incoming_status = str(incoming.get("status") or "").strip().lower()
        if incoming_status in {"received", "quality_check", "stored", "rejected", "cancelled", "delivered"}:
            continue
        # A transfer row is always sealed; bulk rows require the farmer's
        # explicit ready flag or ready status before pickup can be scheduled.
        is_packed_transfer = (
            str(incoming.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
            or str(incoming.get("collectionType") or "").strip().lower() == "packed_orders_transfer"
            or incoming.get("packingRequired") is False
        )
        ready_flag = bool(
            incoming.get("readyForPickup")
            or incoming.get("transferReadyForPickup")
            or incoming.get("warehouseTransferReadyForPickup")
            or incoming_status in {"ready_for_pickup", "team_assigned", "en_route", "arrived_at_farm", "collected", "departed_farm"}
        )
        if not is_packed_transfer and not ready_flag:
            continue
        existing_job = await warehouse_collection_repository.get_by_incoming(str(incoming.get("_id") or ""))
        if existing_job:
            # Keep already-started route progress intact; only reconcile a
            # not-yet-assigned job to Ready for Pickup when the source is ready.
            existing_status = str(existing_job.get("status") or "scheduled").strip().lower()
            if ready_flag and existing_status in {"", "scheduled"}:
                await warehouse_collection_repository.update_job(str(existing_job["_id"]), {
                    "status": "ready_for_pickup",
                    "readyForPickup": True,
                    "readyAt": incoming.get("readyForPickupAt") or incoming.get("updatedAt") or datetime.utcnow(),
                })
            continue
        source_mode = str(incoming.get("sourceMode") or "warehouse_fulfillment")
        collection_type = str(incoming.get("collectionType") or ("packed_orders_transfer" if is_packed_transfer else "bulk_harvest"))
        await ensure_collection_job(incoming, collection_type, source_mode)
        recovered_from_incoming += 1

    # Reconcile ready warehouse-fulfillment orders by farm district. An old
    # source assignment may point to a warehouse outside the farmer's district;
    # the receiving warehouse's explicit coverage (or Settings location when
    # coverage is empty) is authoritative for an unplanned farm pickup.
    orders_collection = MongoDB.get_collection("orders")
    warehouse_refs = [ObjectId(warehouse_id), warehouse_id]
    # Also recover warehouse-fulfillment orders whose Ready for Pickup
    # action was saved on the order but whose incoming-stock lines were never
    # created (legacy data or an interrupted request).
    warehouse_ready_orders = await orders_collection.find({
        "$and": [
            # Ready flags are written by different versions of the Farmer
            # Orders workflow. Query all supported persisted markers, not only
            # the status strings, otherwise ready warehouse-fulfillment orders
            # can be invisible to Farm Collection.
            {"$or": [
                {"warehouseCollectionStatus": {"$in": ["ready_for_pickup", "pickup_requested"]}},
                {"warehouseFulfillmentStage": {"$in": ["pickup_requested", "ready_for_pickup"]}},
                {"orderStatus": "ready_for_pickup"},
                {"transferStatus": {"$in": ["awaiting_farm_pickup", "ready_for_pickup", "pickup_requested"]}},
                {"readyForPickup": True},
                {"transferReadyForPickup": True},
                {"warehouseTransferReadyForPickup": True},
            ]},
            {"$or": [
                {"fulfillmentMethod": {"$in": ["warehouse", "warehouse_fulfillment", "warehouse_transfer"]}},
                {"fulfillmentType": {"$in": ["warehouse", "warehouse_fulfillment", "warehouse_transfer"]}},
                {"fulfillment_type": {"$in": ["warehouse", "warehouse_fulfillment", "warehouse_transfer"]}},
            ]},
            {"deletedAt": None},
        ]
    }).to_list(length=1000)
    # These orders are handled by the warehouse-fulfillment reconciliation
    # below. Do not let the generic legacy transfer recovery reclassify them
    # as sealed Farmer Fulfillment transfers.
    warehouse_ready_order_ids = {
        str(order.get("_id")) for order in warehouse_ready_orders if order.get("_id")
    }

    for ready_order in warehouse_ready_orders:
        order_oid = ready_order.get("_id")
        if not order_oid:
            continue
        assigned_refs = [
            str(ready_order.get("sourceWarehouseId") or ""),
            str(ready_order.get("warehouseId") or ""),
        ]
        assigned_refs = [value for value in assigned_refs if value and value not in {"None", ""}]
        order_id_text = str(order_oid)
        farm_profile = await get_farmer(str(ready_order.get("farmerId") or ""))
        farm_location = (
            ready_order.get("farmLocation")
            or ready_order.get("farmerLocation")
            or ready_order.get("pickupLocation")
            or (farm_profile or {}).get("farmLocation")
            or (farm_profile or {}).get("location")
            or (farm_profile or {}).get("address")
            or {}
        )
        if not isinstance(farm_location, dict):
            farm_location = {"address": str(farm_location)}
        candidate_district = farmer_collection_district(farm_profile, farm_location, configured_districts)
        if not candidate_district:
            continue

        assigned_to_another_warehouse = any(value != warehouse_id for value in assigned_refs)
        if assigned_to_another_warehouse:
            assigned_warehouse_ids = {
                value for value in assigned_refs
                if ObjectId.is_valid(value) and value != warehouse_id
            }
            assigned_warehouse_serves_farm = False
            for assigned_warehouse_id in assigned_warehouse_ids:
                assigned_warehouse = await warehouse_repository.get_by_id(assigned_warehouse_id)
                if assigned_warehouse and candidate_district in warehouse_collection_districts(assigned_warehouse):
                    assigned_warehouse_serves_farm = True
                    break
            if assigned_warehouse_serves_farm:
                continue

            collection_jobs = MongoDB.get_collection("warehouse_collections")
            order_refs = [order_oid, order_id_text]
            active_collection = await collection_jobs.find_one({
                "$and": [
                    {"orderId": {"$in": order_refs}},
                    {"deletedAt": None},
                    {"$or": [
                        {"pickupRouteId": {"$exists": True, "$nin": [None, ""]}},
                        {"collectionTeamId": {"$exists": True, "$nin": [None, ""]}},
                        {"status": {"$in": ["team_assigned", "en_route", "arrived_at_farm", "collected", "departed_farm", "arrived_warehouse"]}},
                    ]},
                ]
            })
            if active_collection:
                continue

            now = datetime.utcnow()
            warehouse_name = warehouse.get("name") or warehouse.get("warehouseName")
            warehouse_location = warehouse.get("location") or warehouse.get("coordinates") or warehouse.get("address")
            await orders_collection.update_one(
                {"_id": order_oid},
                {"$set": {
                    "warehouseId": ObjectId(warehouse_id),
                    "sourceWarehouseId": ObjectId(warehouse_id),
                    "sourceWarehouseName": warehouse_name,
                    "sourceWarehouseLocation": warehouse_location,
                    "updatedAt": now,
                }},
            )
            await incoming_stock_repository.collection.update_many(
                {
                    "$and": [
                        {"orderId": {"$in": order_refs}},
                        {"deletedAt": None},
                        {"status": {"$nin": ["received", "quality_check", "stored", "rejected", "cancelled", "delivered"]}},
                    ]
                },
                {"$set": {
                    "warehouseId": ObjectId(warehouse_id),
                    "updatedAt": now,
                }},
            )
            await collection_jobs.update_many(
                {
                    "$and": [
                        {"orderId": {"$in": order_refs}},
                        {"deletedAt": None},
                        {"status": {"$in": ["scheduled", "ready_for_pickup"]}},
                        {"pickupRouteId": {"$in": [None, ""]}},
                        {"collectionTeamId": {"$in": [None, ""]}},
                    ]
                },
                {"$set": {
                    "warehouseId": ObjectId(warehouse_id),
                    "districtAssignmentSource": district_source or "warehouse_settings_location",
                    "districtAssignedAt": now,
                    "updatedAt": now,
                }},
            )
            ready_order["warehouseId"] = ObjectId(warehouse_id)
            ready_order["sourceWarehouseId"] = ObjectId(warehouse_id)
            assigned_refs = [warehouse_id]
            logger.info(
                "Reassigned unplanned ready farm pickup order %s to warehouse %s by farm district %s",
                order_id_text, warehouse_id, candidate_district,
            )
        elif not assigned_refs:
            # Persist the resolved source assignment so later fulfillment stages
            # and the next Farm Collection refresh use the same warehouse.
            await orders_collection.update_one(
                {"_id": order_oid},
                {"$set": {
                    "warehouseId": ObjectId(warehouse_id),
                    "sourceWarehouseId": ObjectId(warehouse_id),
                    "sourceWarehouseName": warehouse.get("name") or warehouse.get("warehouseName"),
                    "updatedAt": datetime.utcnow(),
                }},
            )
        current_rows = await incoming_stock_repository.find_many({
            "$and": [
                {"warehouseId": {"$in": warehouse_refs}},
                {"orderId": {"$in": [order_oid, order_id_text]}},
                {"deletedAt": None},
            ]
        }, skip=0, limit=1000)
        now = datetime.utcnow()
        for line in (ready_order.get("items") or []):
            qty = float(line.get("actualPackedQuantity", line.get("packedQuantity", line.get("quantity", 0))) or 0)
            if qty <= 0:
                continue
            product_id = str(line.get("productId") or line.get("product_id") or "")
            variant_id = str(line.get("variantId") or line.get("variant_id") or "")
            current = next((
                row for row in current_rows
                if str(row.get("productId") or "") == product_id
                and str(row.get("variantId") or "") == variant_id
            ), None)
            if current:
                current["readyForPickup"] = True
                current["warehouseTransferReadyForPickup"] = True
                current["packingRequired"] = bool(current.get("packingRequired", True))
                await ensure_collection_job(current, str(current.get("collectionType") or "bulk_harvest"), str(current.get("sourceMode") or "warehouse_fulfillment"))
                continue
            incoming_doc = {
                "warehouseId": ObjectId(warehouse_id),
                "orderId": order_oid,
                "orderNumber": ready_order.get("orderNumber") or ready_order.get("orderNo"),
                "farmerId": ObjectId(str(ready_order.get("farmerId"))) if ObjectId.is_valid(str(ready_order.get("farmerId") or "")) else ready_order.get("farmerId"),
                "productId": ObjectId(product_id) if ObjectId.is_valid(product_id) else product_id,
                "variantId": ObjectId(variant_id) if ObjectId.is_valid(variant_id) else (variant_id or None),
                "productName": line.get("productName") or line.get("name") or "Product",
                "quantity": qty,
                "expectedQuantity": qty,
                "unit": line.get("unit") or "kg",
                "sourceMode": "warehouse_fulfillment",
                "collectionType": "bulk_harvest",
                "fulfillmentType": "warehouse_fulfillment",
                "packingRequired": True,
                "readyForPickup": True,
                "warehouseTransferReadyForPickup": True,
                "readyForPickupAt": ready_order.get("warehouseCollectionRequestedAt") or now,
                "pickupLocation": farm_location,
                "farmLocation": farm_location,
                "status": "scheduled",
                "expectedDate": now,
                "createdAt": now,
                "updatedAt": now,
                "deletedAt": None,
            }
            incoming_id = await incoming_stock_repository.create_incoming(incoming_doc)
            if not incoming_id:
                logger.error("Could not recover incoming stock for ready warehouse order %s", order_id_text)
                continue
            incoming_doc["_id"] = ObjectId(str(incoming_id))
            await ensure_collection_job(incoming_doc, "bulk_harvest", "warehouse_fulfillment")

    candidate_orders = await orders_collection.find({
        "$and": [
            {"deletedAt": None},
            {"$or": [
                {"warehouseId": {"$in": warehouse_refs}},
                {"sourceWarehouseId": {"$in": warehouse_refs}},
            ]},
        ]
    }).to_list(length=1000)

    for order_doc in candidate_orders:
        if str(order_doc.get("_id") or "") in warehouse_ready_order_ids:
            continue
        # Farmer-ready pickup orders have used several fulfillment labels over
        # the lifetime of the app. Treat the persisted warehouse/source
        # assignment plus explicit ready-for-pickup markers as authoritative,
        # rather than silently excluding orders because one label differs.
        fulfillment_method = str(
            order_doc.get("fulfillmentMethod")
            or order_doc.get("fulfillmentType")
            or order_doc.get("fulfillment_type")
            or ""
        ).strip().lower().replace("-", "_").replace(" ", "_")
        eligible_fulfillment_methods = {
            "farm_direct", "farmer", "farm_direct_delivery",
            "farmer_fulfillment", "farmer_fulfillment_transfer",
            "warehouse", "warehouse_fulfillment", "warehouse_transfer",
        }
        if fulfillment_method and fulfillment_method not in eligible_fulfillment_methods:
            continue
        order_status = str(order_doc.get("orderStatus") or "").strip().lower()
        pickup_marker = str(order_doc.get("warehouseCollectionStatus") or "").strip().lower()
        transfer_marker = str(order_doc.get("transferStatus") or "").strip().lower()
        stage_marker = str(order_doc.get("warehouseFulfillmentStage") or "").strip().lower()
        explicitly_ready = (
            order_status == "ready_for_pickup"
            or pickup_marker in {"ready_for_pickup", "pickup_requested"}
            or transfer_marker in {"awaiting_farm_pickup", "ready_for_pickup", "pickup_requested"}
            or stage_marker in {"pickup_requested", "ready_for_pickup"}
            or bool(order_doc.get("readyForPickup"))
            or bool(order_doc.get("transferReadyForPickup"))
            or bool(order_doc.get("warehouseTransferReadyForPickup"))
        )
        if not explicitly_ready:
            continue
        order_status = str(order_doc.get("orderStatus") or "").strip().lower()
        pickup_marker = str(order_doc.get("warehouseCollectionStatus") or "").strip().lower()
        transfer_marker = str(order_doc.get("transferStatus") or "").strip().lower()
        stage_marker = str(order_doc.get("warehouseFulfillmentStage") or "").strip().lower()
        # Do not apply a second, narrower status check here: explicitly-ready
        # booleans and the newer ready_for_pickup stage were accepted above but
        # used to be discarded at this point, preventing legacy orders from
        # being reconciled into incoming stock and collection jobs.

        order_oid = order_doc.get("_id")
        if not order_oid:
            continue
        order_id_text = str(order_oid)
        farmer_id_text = str(order_doc.get("farmerId") or "")
        profile = await get_farmer(farmer_id_text)
        farm_location = (
            order_doc.get("farmLocation")
            or order_doc.get("farmerLocation")
            or order_doc.get("pickupLocation")
            or (profile or {}).get("farmLocation")
            or (profile or {}).get("location")
            or (profile or {}).get("address")
            or {}
        )
        if not isinstance(farm_location, dict):
            farm_location = {"address": str(farm_location)}

        existing_rows = await incoming_stock_repository.find_many({
            "$and": [
                {"warehouseId": {"$in": warehouse_refs}},
                {"orderId": {"$in": [order_oid, order_id_text]}},
                {"sourceMode": "farmer_fulfillment_transfer"},
                {"deletedAt": None},
            ]
        }, skip=0, limit=1000)

        items = order_doc.get("items") or []
        for line in items:
            quantity = float(line.get("actualPackedQuantity", line.get("packedQuantity", line.get("quantity", 0))) or 0)
            if quantity <= 0:
                continue
            product_id = str(line.get("productId") or line.get("product_id") or "")
            variant_id = str(line.get("variantId") or line.get("variant_id") or "")
            existing = next((
                row for row in existing_rows
                if str(row.get("productId") or "") == product_id
                and str(row.get("variantId") or "") == variant_id
            ), None)
            if existing:
                existing["readyForPickup"] = True
                existing["packingRequired"] = False
                await ensure_collection_job(existing, "packed_orders_transfer", "farmer_fulfillment_transfer")
                continue

            now = datetime.utcnow()
            incoming_doc = {
                "warehouseId": ObjectId(warehouse_id),
                "orderId": order_oid,
                "orderNumber": order_doc.get("orderNumber") or order_doc.get("orderNo"),
                "farmerId": ObjectId(farmer_id_text) if ObjectId.is_valid(farmer_id_text) else farmer_id_text,
                "productId": ObjectId(product_id) if ObjectId.is_valid(product_id) else product_id,
                "variantId": ObjectId(variant_id) if ObjectId.is_valid(variant_id) else (variant_id or None),
                "productName": line.get("productName") or line.get("name") or "Product",
                "quantity": quantity,
                "expectedQuantity": quantity,
                "unit": line.get("unit") or "kg",
                "sourceMode": "farmer_fulfillment_transfer",
                "collectionType": "packed_orders_transfer",
                "fulfillmentType": "farmer_fulfillment",
                "shipmentType": "farmer_fulfillment",
                "packingRequired": False,
                "warehousePackingRequired": False,
                "packingVerified": True,
                "readyForPickup": True,
                "transferReadyForPickup": True,
                "readyForPickupAt": order_doc.get("warehouseCollectionRequestedAt") or now,
                "pickupLocation": farm_location,
                "farmLocation": farm_location,
                "packageCount": 1,
                "status": "scheduled",
                "expectedDate": now,
                "createdAt": now,
                "updatedAt": now,
                "deletedAt": None,
            }
            incoming_id = await incoming_stock_repository.create_incoming(incoming_doc)
            if not incoming_id:
                logger.error("Could not recover incoming stock row for packed order %s", order_id_text)
                continue
            incoming_doc["_id"] = ObjectId(str(incoming_id))
            await ensure_collection_job(incoming_doc, "packed_orders_transfer", "farmer_fulfillment_transfer")

    logger.info(
        "Farm Collection reconciliation warehouse=%s incoming_candidates=%s incoming_recovered=%s warehouse_ready_orders=%s total_jobs_before_reload=%s",
        warehouse_id,
        len(incoming_candidates),
        recovered_from_incoming,
        len(warehouse_ready_orders),
        len(jobs),
    )

    # Reload after reconciliation so newly-created pickup jobs appear immediately.
    jobs = await warehouse_collection_repository.get_by_warehouse(warehouse_id, status_filter, limit=1000)

    async def display_name_for_profile(profile: Optional[Dict[str, Any]], default: str) -> str:
        if not profile:
            return default
        for key in ("farmName", "ownerName", "fullName", "name", "displayName"):
            candidate = readable(profile.get(key))
            if candidate:
                return candidate
        owner_user = await get_user(str(profile.get("userId") or ""))
        if owner_user:
            candidate = " ".join(
                part for part in (
                    readable(owner_user.get("firstName")),
                    readable(owner_user.get("lastName")),
                ) if part
            )
            if candidate:
                return candidate
            for key in ("name", "displayName", "email"):
                candidate = readable(owner_user.get(key))
                if candidate:
                    return candidate
        return default

    # Recover legacy collection jobs that were created without a warehouseId.
    # They may only be attached to this warehouse after the farmer's district is
    # verified against this warehouse's explicit coverage or Settings location.
    # Never claim a job already assigned to another warehouse.
    unassigned_jobs = await warehouse_collection_repository.find_many({
        "deletedAt": None,
        "$or": [
            {"warehouseId": {"$exists": False}},
            {"warehouseId": None},
            {"warehouseId": ""},
        ],
    }, skip=0, limit=1000, sort=[("createdAt", 1)])

    for candidate_job in unassigned_jobs:
        farmer_profile = await get_farmer(str(candidate_job.get("farmerId") or ""))
        candidate_district = farmer_collection_district(
            farmer_profile, candidate_job.get("pickupLocation") or {}, configured_districts
        )
        if not configured_districts or not candidate_district or candidate_district not in configured_districts:
            continue
        candidate_id = str(candidate_job.get("_id") or "")
        if not ObjectId.is_valid(candidate_id):
            continue
        await warehouse_collection_repository.update_job(candidate_id, {
            "warehouseId": ObjectId(warehouse_id),
            "districtAssignmentSource": district_source or "farm_collection_district",
            "districtAssignedAt": datetime.utcnow(),
        })
        candidate_job["warehouseId"] = ObjectId(warehouse_id)
        jobs.append(candidate_job)

    # Avoid duplicate rows if a job appeared in both the assigned and recovery query.
    unique_jobs: Dict[str, Dict[str, Any]] = {}
    for job in jobs:
        unique_jobs[str(job.get("_id") or job.get("id") or id(job))] = job

    result: List[Dict[str, Any]] = []
    for job in unique_jobs.values():
        item = serialize_collection(job)
        order = await get_order(str(job.get("orderId") or ""))
        order_items = (order or {}).get("items") or []
        product_id = str(job.get("productId") or "")
        order_item = next(
            (
                value for value in order_items
                if product_id and str(value.get("productId") or value.get("product_id") or "") == product_id
            ),
            order_items[0] if order_items else {},
        )
        product = await get_product(product_id or str(order_item.get("productId") or ""))
        batch = await get_batch(str(job.get("batchId") or ""))
        # Legacy collection jobs often omit farmerId even though the linked order,
        # order line, or product still points to the farmer profile.
        farmer_id_candidates = [
            job.get("farmerId"),
            (order or {}).get("farmerId"),
            (order or {}).get("farmer_id"),
            order_item.get("farmerId"),
            order_item.get("farmer_id"),
            (product or {}).get("farmerId"),
            (product or {}).get("farmer_id"),
            (product or {}).get("ownerId"),
            (product or {}).get("sellerId"),
        ]
        farmer_profile = None
        resolved_farmer_id = ""
        for farmer_ref in farmer_id_candidates:
            if farmer_ref:
                farmer_profile = await get_farmer(str(farmer_ref))
                if farmer_profile:
                    resolved_farmer_id = str(farmer_ref)
                    break
        farmer_profile = farmer_profile or {}
        farmer_district = farmer_collection_district(
            farmer_profile, job.get("pickupLocation") or (order or {}).get("farmLocation") or {}, configured_districts
        )
        # An existing warehouseId is an explicit assignment, so do not hide
        # that job merely because legacy address data cannot be matched. Surface
        # the discrepancy in the UI instead of returning an empty queue.
        if farmer_district in configured_districts and configured_districts:
            district_match_status = "matched"
        elif not farmer_district or not configured_districts:
            district_match_status = "needs_location_data"
        else:
            district_match_status = "district_mismatch"
        profile_name = await display_name_for_profile(farmer_profile, "")
        farmer_user_id = str(farmer_profile.get("userId") or resolved_farmer_id or job.get("farmerId") or "")
        farmer_user = await get_user(farmer_user_id)

        farmer_name = (readable(job.get("farmerName")) or readable((order or {}).get("farmerName")) or readable((product or {}).get("farmerName")) or readable(farmer_profile.get("farmName")) or profile_name)
        if not farmer_name and farmer_user:
            farmer_name = " ".join(
                part for part in (
                    readable(farmer_user.get("firstName")),
                    readable(farmer_user.get("lastName")),
                ) if part
            )
            farmer_name = farmer_name or readable(farmer_user.get("name")) or readable(farmer_user.get("displayName"))
        farmer_name = farmer_name or "Farmer details unavailable"

        product_name = (
            readable(job.get("productName"))
            or readable((product or {}).get("name"))
            or readable((product or {}).get("productName"))
            or readable((product or {}).get("title"))
            or readable(order_item.get("productName"))
            or readable(order_item.get("name"))
            or "Product details unavailable"
        )
        order_number = (
            readable((order or {}).get("orderNumber"))
            or readable((order or {}).get("orderNo"))
            or readable((order or {}).get("referenceNumber"))
        )
        if order_number and not order_number.upper().startswith(("ORD", "ORDER", "#")):
            order_number = f"ORD-{order_number}"
        if not order_number and job.get("orderId"):
            order_number = "Order reference unavailable"

        team_id = str(job.get("collectionTeamId") or "")
        team = None
        if team_id and ObjectId.is_valid(team_id):
            if team_id not in partner_cache:
                partner_cache[team_id] = await delivery_repository.get_by_id(team_id)
            team = partner_cache[team_id]
        team_user = await get_user(str((team or {}).get("userId") or ""))
        team_name = None
        if team_user:
            team_name = " ".join(
                part for part in (
                    readable(team_user.get("firstName")),
                    readable(team_user.get("lastName")),
                ) if part
            ) or readable(team_user.get("name")) or readable(team_user.get("displayName"))
        team_name = team_name or readable((team or {}).get("name"))
        team_name = team_name or ("Assigned pickup partner" if team_id else "Not assigned")

        route_id = str(job.get("pickupRouteId") or "")
        route = None
        if route_id and ObjectId.is_valid(route_id):
            if route_id not in route_cache:
                route_cache[route_id] = await warehouse_pickup_route_repository.get_by_id(route_id)
            route = route_cache[route_id]

        pickup_location = job.get("pickupLocation") or (order or {}).get("farmLocation") or (order or {}).get("farmerLocation") or (product or {}).get("farmLocation") or (farmer_profile.get("farmLocation") if isinstance(farmer_profile, dict) else None) or {}
        pickup_address = None
        for key in ("address", "formattedAddress", "farmAddress", "streetAddress"):
            pickup_address = readable(pickup_location.get(key)) if isinstance(pickup_location, dict) else None
            if pickup_address:
                break
        if not pickup_address and farmer_profile:
            address = farmer_profile.get("farmAddress") or farmer_profile.get("address") or farmer_profile.get("location") or (order or {}).get("farmAddress") or (order or {}).get("pickupAddress") or {}
            if isinstance(address, dict):
                address_parts = [
                    readable(address.get(key))
                    for key in ("addressLine1", "addressLine2", "street", "village", "city", "district", "state", "pincode")
                ]
                pickup_address = ", ".join(part for part in address_parts if part) or None
            else:
                pickup_address = readable(address)
            if not pickup_address:
                address_parts = [
                    readable(farmer_profile.get(key))
                    for key in ("farmCity", "farmDistrict", "farmState", "farmPincode")
                ]
                pickup_address = ", ".join(part for part in address_parts if part) or None

        item.update({
            "farmerName": farmer_name,
            "productName": product_name,
            "orderNumber": order_number,
            "batchNumber": (
                readable(job.get("batchNumber"))
                or readable((batch or {}).get("lotNumber"))
                or readable((batch or {}).get("batchNumber"))
                or readable((batch or {}).get("name"))
            ),
            "collectionTeamName": team_name,
            "collectionTeamVehicleType": readable((team or {}).get("vehicleType")),
            "collectionTeamVehicleNumber": readable((team or {}).get("vehicleNumber")),
            "routeNumber": readable((route or {}).get("routeNumber")),
            "pickupAddress": pickup_address or "Farm address not provided",
            "warehouseName": readable(warehouse.get("name")) or readable(warehouse.get("warehouseName")) or "Assigned warehouse",
            "farmDistrict": farmer_district,
            "districtMatchStatus": district_match_status,
            "districtMatchMessage": (
                None if district_match_status == "matched"
                else (
                    "Farm district differs from this warehouse's configured district. Verify the assignment before planning pickup."
                    if district_match_status == "district_mismatch"
                    else "Farm district could not be verified. Confirm the farmer's district/address before assigning this pickup route."
                )
            ),
            "actualCollectedQuantity": job.get("actualCollectedQuantity"),
        })
        result.append(item)

    return {
        "success": True,
        "data": {
            "configuredFarmCollectionDistricts": sorted(configured_districts),
            "farmCollectionDistrictSource": district_source,
            "districtConfigurationRequired": not bool(configured_districts),
            "collections": result,
            "counts": {
                "total": len(result),
                "readyForPickup": sum(1 for x in result if x.get("status") == "ready_for_pickup"),
                "assigned": sum(1 for x in result if x.get("status") == "team_assigned"),
                "enRoute": sum(1 for x in result if x.get("status") == "en_route"),
                "atFarm": sum(1 for x in result if x.get("status") == "arrived_at_farm"),
                "collected": sum(1 for x in result if x.get("status") == "collected"),
                "departed": sum(1 for x in result if x.get("status") == "departed_farm"),
                "atWarehouse": sum(1 for x in result if x.get("status") == "arrived_warehouse"),
            },
        },
    }


@router.get("/me/workflow")
async def get_warehouse_workflow(current_user: dict = Depends(get_current_user)):
    """Return one authoritative snapshot of every warehouse fulfillment stage."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access warehouse workflow")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    wid = ObjectId(str(warehouse["_id"]))
    active_order_filter = {
        "warehouseId": wid,
        "fulfillmentMethod": "warehouse",
        "deletedAt": None,
        "orderStatus": {"$nin": ["delivered", "completed", "cancelled", "refunded"]},
    }
    orders = await order_repository.find_many(active_order_filter, skip=0, limit=1000, sort=[("orderDate", -1), ("createdAt", -1)])
    incoming = await WarehouseService.get_incoming_stock(str(warehouse["_id"]), None, 0, 1000)
    collections = await warehouse_collection_repository.get_by_warehouse(str(warehouse["_id"]), None)
    packing = await warehouse_packing_repository.get_by_warehouse(str(warehouse["_id"]), None)
    outgoing = await WarehouseService.get_outgoing_stock(str(warehouse["_id"]), None, 0, 1000)
    from app.repositories.warehouse_shortage_repository import warehouse_shortage_repository
    shortages = await warehouse_shortage_repository.get_by_warehouse(str(warehouse["_id"]), None, limit=1000)

    stage_counts: Dict[str, int] = {}
    for order in orders:
        stage = str(order.get("warehouseFulfillmentStage") or "awaiting_farmer_confirmation")
        stage_counts[stage] = stage_counts.get(stage, 0) + 1

    return {
        "success": True,
        "data": {
            "warehouse": {
                "id": str(warehouse["_id"]),
                "name": warehouse.get("name") or warehouse.get("warehouseName"),
                "totalCapacity": warehouse.get("totalCapacity", 0),
                "usedCapacity": warehouse.get("usedCapacity", 0),
            },
            "counts": {
                "orders": len(orders),
                "collections": len(collections),
                "incoming": len(incoming[0]),
                "packing": len(packing),
                "outgoing": len(outgoing[0]),
                "shortages": len([x for x in shortages if x.get("status") not in ("resolved", "cancelled")]),
            },
            "stages": stage_counts,
        },
    }


@router.get("/me/farmer-fulfillment-transfers")
async def get_farmer_fulfillment_transfers(
    status_filter: Optional[str] = Query(None, alias="status"),
    include_completed: bool = Query(False, alias="include_completed"),
    current_user: dict = Depends(get_current_user),
):
    """Packed farmer-fulfillment transfers routed through this warehouse.

    These shipments are already packed and verified by the farmer. Warehouse
    staff must never create a second packing task for them.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access farmer fulfillment transfers")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    warehouse_id = str(warehouse["_id"])
    warehouse_oid = ObjectId(warehouse_id)
    # Support both legacy single-warehouse fields and allocation-based
    # multi-warehouse orders. Some existing records store IDs as strings.
    warehouse_refs = [warehouse_oid, warehouse_id]
    query: Dict[str, Any] = {
        "$and": [
            {"deletedAt": None},
            ({} if include_completed else {"orderStatus": {"$nin": ["delivered", "completed", "cancelled", "refunded"]}}),
            {"$or": [
                {"fulfillmentMethod": {"$regex": "^(farmer|farm_direct)$", "$options": "i"}},
                {"fulfillment_route": {"$regex": "^(farmer|farm_direct)$", "$options": "i"}},
                {"logisticsMode": {"$in": [
                    "farmer_to_delivery_partner",
                    "farmer_to_warehouse_to_local_hub_to_delivery_partner",
                    "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
                    "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
                ]}},
            ]},
            {"$or": [
                {"warehouseId": {"$in": warehouse_refs}},
                {"sourceWarehouseId": {"$in": warehouse_refs}},
                {"warehouseIds": {"$in": warehouse_refs}},
                {"warehouseAllocations.warehouseId": {"$in": warehouse_refs}},
                {"warehouseAllocations.sourceWarehouseId": {"$in": warehouse_refs}},
                {"consolidationWarehouseId": {"$in": warehouse_refs}},
                {"destinationWarehouseId": {"$in": warehouse_refs}},
                {"destinationWarehouseIds": {"$in": warehouse_refs}},
            ]},
        ],
    }
    if status_filter:
        query["warehouseFulfillmentStage"] = status_filter

    orders = await order_repository.find_many(
        query, skip=0, limit=200,
        sort=[("orderDate", -1), ("createdAt", -1), ("updatedAt", -1), ("_id", -1)],
    )

    # If the incoming transfer row exists but an older order is missing its
    # assignment/logistics metadata, use that physical warehouse record as the
    # authoritative link so the transfers page still shows the real shipment.
    # Farmer-packed receipts can be created by either the dedicated transfer
    # flow or the Farm Collection bulk-receipt flow. Both are valid links into
    # this workspace; do not hide a packed order merely because an older receipt
    # row lacks sourceMode=farmer_fulfillment_transfer.
    # Read from the same warehouse-scoped source as Incoming Stock. Some legacy
    # receipts store warehouseId as ObjectId and others as string, and older
    # packed collection receipts may be linked by order number rather than order _id.
    transfer_incoming_rows = await incoming_stock_repository.find_many({
        "deletedAt": None,
        "$and": [
            {"warehouseId": {"$in": [warehouse_oid, warehouse_id]}},
            {"$or": [
                {"sourceMode": {"$regex": "^farmer_fulfillment_transfer$", "$options": "i"}},
                {"packingRequired": False},
                {"pickupRouteId": {"$exists": True, "$nin": [None, ""]}},
                {"collectionType": {"$regex": "^packed_orders_transfer$", "$options": "i"}},
                {"fulfillmentType": {"$regex": "^farmer_fulfillment$", "$options": "i"}},
                {"shipmentType": {"$regex": "^farmer_fulfillment$", "$options": "i"}},
                {"collectionId": {"$exists": True, "$nin": [None, ""]}},
            ]},
        ],
    }, skip=0, limit=2000, sort=[("createdAt", -1)])
    known_order_ids = {str(item.get("_id")) for item in orders if item.get("_id")}
    unlinked_packed_packets = []
    packed_incoming_by_order: Dict[str, List[Dict[str, Any]]] = {}
    for incoming_row in transfer_incoming_rows:
        collection_job = None
        collection_id = str(incoming_row.get("collectionId") or "")
        if collection_id and ObjectId.is_valid(collection_id):
            collection_job = await warehouse_collection_repository.get_by_id(collection_id)
        linked_order_id = str(incoming_row.get("orderId") or "")
        if not linked_order_id and collection_job:
            linked_order_id = str(collection_job.get("orderId") or "")
        linked_order = await order_repository.get_by_id(linked_order_id) if ObjectId.is_valid(linked_order_id) else None
        order_number = str(
            incoming_row.get("orderNumber") or incoming_row.get("orderNo")
            or (collection_job or {}).get("orderNumber") or ""
        )
        if not linked_order:
            linked_order = await order_repository.find_one({"orderNumber": order_number, "deletedAt": None}) if order_number else None
        # A dedicated incoming row with sourceMode=farmer_fulfillment_transfer
        # is the authoritative proof that this order belongs in the warehouse
        # transfer workflow. Older orders may not have fulfillmentMethod,
        # fulfillment_route, or logisticsMode populated consistently.
        packed_receipt = (
            str(incoming_row.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
            or incoming_row.get("packingRequired") is False
            or str(incoming_row.get("collectionType") or "").strip().lower() == "packed_orders_transfer"
            or str(incoming_row.get("fulfillmentType") or "").strip().lower() == "farmer_fulfillment"
            or str(incoming_row.get("shipmentType") or "").strip().lower() == "farmer_fulfillment"
            # Match Incoming Stock's packed-order detection for legacy rows.
            or bool(incoming_row.get("orderId") and incoming_row.get("pickupRouteId"))
        )
        if not packed_receipt and incoming_row.get("collectionId"):
            packed_receipt = bool(collection_job) and (
                str(collection_job.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
                or collection_job.get("packingRequired") is False
                or str(collection_job.get("collectionType") or "").strip().lower() == "packed_orders_transfer"
            )
        if not linked_order:
            if packed_receipt:
                unlinked_packed_packets.append({
                    "id": str(incoming_row.get("_id") or ""),
                    "orderNumber": order_number or None,
                    "productName": incoming_row.get("productName") or "Packed order",
                    "status": incoming_row.get("status"),
                    "quantity": incoming_row.get("quantity") or incoming_row.get("expectedQuantity") or 0,
                    "quantityReceived": incoming_row.get("quantityReceived") or incoming_row.get("receivedQuantity") or 0,
                    "collectionId": collection_id or None,
                })
            continue
        linked_order_id = str(linked_order.get("_id") or "")
        if not linked_order_id:
            continue
        # Do not silently mutate order assignment during a GET. Expose a clear
        # recovery action instead, which persists the warehouse link only after
        # verifying the packed receipt and complete physical quantity.
        if not (
            linked_order.get("warehouseId") or linked_order.get("sourceWarehouseId")
            or linked_order.get("warehouseAllocations") or linked_order.get("warehouseIds")
        ):
            linked_order["isUnassigned"] = True
        linked_method = str(
            linked_order.get("fulfillmentMethod")
            or linked_order.get("fulfillment_route")
            or ""
        ).strip().lower()
        linked_status = str(linked_order.get("orderStatus") or linked_order.get("status") or "").lower()
        linked_logistics = str(linked_order.get("logisticsMode") or "").strip().lower()
        # An explicit warehouse-fulfillment method always wins over legacy
        # incoming-row hints. This endpoint must never pull a warehouse-packed
        # customer order into the farmer transfer workflow just because an old
        # receipt happens to contain pickupRouteId/packingRequired metadata.
        is_explicit_warehouse_order = linked_method in (
            "warehouse", "warehouse_fulfillment", "warehouse-fulfillment"
        )
        is_farmer_transfer = not is_explicit_warehouse_order and (
            linked_method in ("farmer", "farm_direct")
            or linked_logistics in (
                "farmer_to_delivery_partner",
                "farmer_to_warehouse_to_local_hub_to_delivery_partner",
                "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
                "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
            )
            or packed_receipt
        )
        # The history/progress view intentionally includes in-flight transfers
        # as well as delivered orders. The operational queue (default) hides
        # terminal orders, but history must preserve every real workflow stage.
        if not is_farmer_transfer or (
            linked_status in ("delivered", "completed", "cancelled", "refunded")
            and not include_completed
        ):
            continue
        packed_incoming_by_order.setdefault(linked_order_id, []).append(incoming_row)
        if linked_order_id not in known_order_ids:
            orders.append(linked_order)
            known_order_ids.add(linked_order_id)

    result = []
    for order in orders:
        outgoing = await outgoing_stock_repository.find_many({
            "orderId": {"$in": [order["_id"], str(order["_id"])]},
            "warehouseId": {"$in": [ObjectId(str(warehouse["_id"])), str(warehouse["_id"])]},
            "deletedAt": None,
        }, skip=0, limit=1000)
        incoming = await incoming_stock_repository.find_many({
            "orderId": {"$in": [order["_id"], str(order["_id"])]},
            "warehouseId": {"$in": [ObjectId(str(warehouse["_id"])), str(warehouse["_id"])]},
            "deletedAt": None,
        }, skip=0, limit=1000)
        incoming_by_id = {str(row.get("_id")): row for row in incoming if row.get("_id")}
        incoming_by_id.update({
            str(row.get("_id")): row
            for row in packed_incoming_by_order.get(str(order["_id"]), [])
            if row.get("_id")
        })
        incoming = list(incoming_by_id.values())
        logistics_mode = str(order.get("logisticsMode") or "")
        is_consolidation_warehouse = (
            logistics_mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
            and str(order.get("consolidationWarehouseId") or "") == warehouse_id
        )
        # Identify this warehouse's role from persisted assignment fields, rather
        # than showing the source warehouse as the destination (or vice versa).
        source_warehouse_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
        destination_warehouse_id = str(order.get("destinationWarehouseId") or "")
        is_destination_warehouse = bool(destination_warehouse_id and destination_warehouse_id == warehouse_id)
        is_allocated_source_warehouse = (
            any(
                str(allocation.get("warehouseId") or "") == warehouse_id
                for allocation in (order.get("warehouseAllocations") or [])
                if isinstance(allocation, dict)
            )
            or any(str(assigned_id) == warehouse_id for assigned_id in (order.get("warehouseIds") or []))
        )
        is_source_warehouse = bool(source_warehouse_id and source_warehouse_id == warehouse_id) or is_allocated_source_warehouse
        consolidation = {
            "isConsolidationWarehouse": is_consolidation_warehouse,
            "canReceive": False,
            "canComplete": False,
            "canHandoffLocalHub": False,
            "canConfirmHubReceipt": False,
            "hubTransferStatus": None,
            "totalLegs": 0,
            "inTransitLegs": 0,
            "receivedLegs": 0,
            "allSourcePortionsStored": False,
        }
        order_stage = str(order.get("warehouseFulfillmentStage") or "awaiting_warehouse_receipt")
        source_legs = []
        if logistics_mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
            legs_collection = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
            legs = await legs_collection.find({
                "orderId": order["_id"],
                "destinationWarehouseId": warehouse_oid,
                "legType": "warehouse_to_consolidation",
                "deletedAt": None,
            }).to_list(length=1000) if is_consolidation_warehouse else []
            source_legs = await legs_collection.find({
                "orderId": order["_id"],
                "sourceWarehouseId": warehouse_oid,
                "legType": "warehouse_to_consolidation",
                "deletedAt": None,
            }).to_list(length=1000) if logistics_mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" else []
            all_source_incoming = await incoming_stock_repository.find_many({
                "orderId": order["_id"],
                "sourceMode": "farmer_fulfillment_transfer",
                "deletedAt": None,
            }, skip=0, limit=1000) if is_consolidation_warehouse else []
            legs_received = bool(legs) and all(
                str(x.get("status") or "") == "received_at_consolidation" for x in legs
            )
            # Farmer Fulfillment portions are already packed. A physically received
            # receipt is sufficient; optional temporary storage must not block consolidation.
            all_source_stored = bool(all_source_incoming) and all(
                str(x.get("status") or "") in ("received", "stored")
                and float(x.get("quantityReceived") or 0) >= float(x.get("quantity") or 0)
                for x in all_source_incoming
            )
            in_transit_legs = [x for x in legs if str(x.get("status") or "") == "in_transit"]
            hub_transfer = await MongoDB.get_collection("farmer_fulfillment_hub_transfers").find_one({
                "orderId": order["_id"],
                "deletedAt": None,
            }) if is_consolidation_warehouse else None
            consolidation_status = str(order.get("consolidationStatus") or "")
            consolidation.update({
                "canReceive": bool(in_transit_legs),
                "canComplete": legs_received and all_source_stored and consolidation_status != "consolidated",
                "canHandoffLocalHub": consolidation_status == "consolidated",
                "canConfirmHubReceipt": consolidation_status == "hub_handoff_pending" and str((hub_transfer or {}).get("status") or "") == "in_transit",
                "hubTransferStatus": (hub_transfer or {}).get("status"),
                "totalLegs": len(legs),
                "inTransitLegs": len(in_transit_legs),
                "receivedLegs": sum(1 for x in legs if str(x.get("status") or "") == "received_at_consolidation"),
                "allSourcePortionsStored": all_source_stored,
            })
        if logistics_mode in (
            "farmer_to_delivery_partner",
            "farmer_to_warehouse_to_local_hub_to_delivery_partner",
            "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
            "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
            "long_distance_pending",
        ):
            # Derive the displayed stage from this warehouse's own incoming
            # lines. The parent order is shared across warehouses, so one
            # warehouse storing its portion must not make every warehouse's
            # portion look ready for dispatch.
            if incoming and all(str(x.get("status") or "") == "stored" for x in incoming):
                order_stage = "stored"
            elif incoming and any(str(x.get("status") or "") in ("scheduled", "in_transit") for x in incoming):
                order_stage = "awaiting_warehouse_receipt" if any(not x.get("arrivedWarehouseAt") for x in incoming) else "warehouse_arrived"
            elif incoming and all(
                str(x.get("status") or "") in ("received", "stored")
                and float(
                    x.get("quantityReceived")
                    or x.get("receivedQuantity")
                    or x.get("actualQuantityReceived")
                    or x.get("receivedQty")
                    or (x.get("quantity") or x.get("expectedQuantity") or 0)
                ) + 1e-9 >= float(x.get("quantity") or x.get("expectedQuantity") or 0)
                for x in incoming
            ):
                order_stage = (
                    "quality_approved"
                    if all(str(x.get("qualityCheck") or "").lower() == "passed" for x in incoming)
                    else "received_transfer"
                )
            elif incoming and any(str(x.get("status") or "").lower() == "received" for x in incoming):
                order_stage = "received_transfer"

        if (
            logistics_mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
            and not is_consolidation_warehouse
            and incoming
            and all(
                str(x.get("status") or "") in ("received", "stored")
                and float(x.get("quantityReceived") or 0) >= float(x.get("quantity") or 0)
                for x in incoming
            )
            and source_legs
            and all(str(x.get("status") or "") in ("in_transit", "received_at_consolidation") for x in source_legs)
        ):
            order_stage = (
                "source_portion_received_at_consolidation"
                if all(str(x.get("status") or "") == "received_at_consolidation" for x in source_legs)
                else "source_portion_in_transit"
            )

        if is_consolidation_warehouse:
            consolidation_status = str(order.get("consolidationStatus") or "")
            # When the consolidation warehouse is also a source warehouse,
            # its own packed shipment must still pass collection, receipt,
            # quality and storage before the consolidation action is offered.
            if incoming and any(str(x.get("status") or "") in ("scheduled", "in_transit") for x in incoming) and any(not x.get("arrivedWarehouseAt") for x in incoming):
                order_stage = "awaiting_warehouse_receipt"
            elif incoming and all(str(x.get("status") or "") == "stored" for x in incoming):
                if consolidation_status in ("hub_handoff_pending", "local_hub_ready"):
                    order_stage = consolidation_status
                elif consolidation_status == "consolidated":
                    order_stage = "consolidated"
                elif consolidation["totalLegs"] and consolidation["receivedLegs"] == consolidation["totalLegs"]:
                    order_stage = "consolidation_portions_received"
                else:
                    order_stage = "consolidation_waiting_for_sources"
            elif incoming and all(
                str(x.get("status") or "") in ("received", "stored")
                and str(x.get("qualityCheck") or "") == "passed"
                for x in incoming
            ):
                order_stage = "quality_approved"
            elif incoming and any(str(x.get("status") or "") == "received" for x in incoming):
                order_stage = "received_transfer"
            elif incoming:
                order_stage = "warehouse_arrived"
            elif consolidation_status in ("hub_handoff_pending", "local_hub_ready"):
                order_stage = consolidation_status
            elif consolidation_status == "consolidated":
                order_stage = "consolidated"
            elif consolidation["totalLegs"] and consolidation["receivedLegs"] == consolidation["totalLegs"]:
                order_stage = "consolidation_portions_received"
            elif consolidation["inTransitLegs"]:
                order_stage = "consolidation_in_transit"
            else:
                order_stage = "consolidation_waiting_for_sources"

        # Resolve route data from the saved order AND its farmer profile. Order
        # snapshots in older records often omit coordinates even when the profile
        # contains a GeoJSON Point (coordinates are [longitude, latitude]).
        def _coords(value):
            if isinstance(value, (list, tuple)) and len(value) >= 2:
                try:
                    # GeoJSON coordinate arrays are [longitude, latitude].
                    lon, lat = float(value[0]), float(value[1])
                    if -90 <= lat <= 90 and -180 <= lon <= 180:
                        return (lat, lon)
                except (TypeError, ValueError):
                    return None
            if not isinstance(value, dict):
                return None
            coordinates = value.get("coordinates")
            if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
                # GeoJSON Point uses [longitude, latitude].
                point = _coords(coordinates)
                if point:
                    return point
            lat = value.get("latitude", value.get("lat"))
            lon = value.get("longitude", value.get("lng", value.get("lon", value.get("long"))))
            try:
                lat, lon = float(lat), float(lon)
                if -90 <= lat <= 90 and -180 <= lon <= 180:
                    return (lat, lon)
            except (TypeError, ValueError):
                pass
            # Some address/profile schemas nest the actual point.
            for key in ("location", "farmLocation", "coordinates", "geo", "address"):
                nested = value.get(key)
                if isinstance(nested, (dict, list, tuple)):
                    point = _coords(nested)
                    if point:
                        return point
            return None

        farmer_profile = None
        farmer_id_value = order.get("farmerId")
        if farmer_id_value:
            try:
                farmer_profile = await farmer_repository.get_by_id(str(farmer_id_value))
                if not farmer_profile:
                    farmer_profile = await farmer_repository.get_by_user_id(str(farmer_id_value))
            except Exception:
                farmer_profile = None

        item_locations = []
        for line in (order.get("items") or []):
            item_locations.extend([
                line.get("farmLocation"), line.get("location"),
                {"latitude": line.get("farmLatitude"), "longitude": line.get("farmLongitude")},
                {"latitude": line.get("latitude"), "longitude": line.get("longitude")},
            ])
        # Nearby routing is based on source-warehouse-to-customer distance, not
        # farm-to-customer distance. Legacy generic distance fields may represent
        # the farm leg and must not classify the warehouse delivery route.
        # Resolve the actual assigned source warehouse even when this API is
        # running under a destination warehouse account. Route distance must be
        # source-warehouse -> customer, never current-warehouse -> customer by accident.
        source_warehouse_doc = None
        source_ref = order.get("sourceWarehouseId") or order.get("warehouseId")
        warehouses_collection = MongoDB.get_collection("warehouses")
        if source_ref and ObjectId.is_valid(str(source_ref)):
            try:
                source_warehouse_doc = await warehouses_collection.find_one({"_id": ObjectId(str(source_ref))})
            except Exception:
                source_warehouse_doc = None
        # Legacy orders sometimes save the source warehouse name instead of its
        # Mongo ID. Resolve that reference against the warehouse settings rather
        # than silently losing its configured coordinates and district.
        if not source_warehouse_doc and source_ref:
            try:
                source_warehouse_doc = await warehouses_collection.find_one({
                    "$or": [
                        {"name": str(source_ref)}, {"warehouseName": str(source_ref)},
                        {"code": str(source_ref)},
                    ],
                    "deletedAt": None,
                })
            except Exception:
                source_warehouse_doc = None
        # If this is the source warehouse's own queue, its settings are authoritative
        # even when an old order has no usable warehouse ID.
        if not source_warehouse_doc and is_source_warehouse:
            source_warehouse_doc = warehouse
        source_warehouse_doc = source_warehouse_doc or {}
        source_warehouse_address_value = source_warehouse_doc.get("address")
        source_warehouse_address = source_warehouse_address_value if isinstance(source_warehouse_address_value, dict) else {}
        source_location = (
            order.get("sourceWarehouseLocation")
            or source_warehouse_doc.get("location")
            or source_warehouse_doc.get("coordinates")
            or source_warehouse_address.get("location")
            or source_warehouse_address.get("coordinates")
            or (source_warehouse_address_value if isinstance(source_warehouse_address_value, dict) else None)
            or (warehouse.get("location") if is_source_warehouse else None)
            or (warehouse.get("coordinates") if is_source_warehouse else None)
            or order.get("warehouseLocation")
        )
        source_point = _coords(source_location)
        delivery_address = order.get("deliveryAddress") or {}
        if not isinstance(delivery_address, dict):
            delivery_address = {}

        # Older order snapshots can omit location/district even though the
        # customer's saved address is present in MongoDB's addresses collection.
        # Hydrate from the referenced, customer-owned address before classifying
        # the route; never treat a missing snapshot field as missing DB data.
        saved_address = None
        delivery_address_id = order.get("deliveryAddressId")
        customer_id = order.get("customerId")
        if delivery_address_id and customer_id and ObjectId.is_valid(str(delivery_address_id)) and ObjectId.is_valid(str(customer_id)):
            try:
                saved_address = await address_repository.get_address_by_id(
                    str(delivery_address_id), str(customer_id)
                )
            except Exception:
                saved_address = None
        if saved_address:
            saved_location = saved_address.get("location")
            # Prefer an existing order snapshot value, but fill missing legacy
            # fields from the saved address record.
            delivery_address = {
                **saved_address,
                **delivery_address,
                "city": (
                    delivery_address.get("city") or saved_address.get("city")
                    or saved_address.get("town") or saved_address.get("municipality") or ""
                ),
                "district": (
                    delivery_address.get("district") or delivery_address.get("districtName")
                    or saved_address.get("district") or saved_address.get("districtName")
                    or saved_address.get("city") or saved_address.get("town")
                    or saved_address.get("municipality") or ""
                ),
                "state": delivery_address.get("state") or saved_address.get("state") or "",
                "zipCode": (
                    delivery_address.get("zipCode") or delivery_address.get("zip_code")
                    or saved_address.get("zipCode") or saved_address.get("zip_code") or ""
                ),
                "location": (
                    delivery_address.get("location") or saved_location
                ),
            }
        customer_candidates = [
            delivery_address.get("location"),
            delivery_address,
            order.get("customerLocation"), order.get("shippingAddress"),
        ]
        customer_point = next((point for value in customer_candidates if (point := _coords(value))), None)

        # Recompute from the actual source warehouse and customer coordinates when
        # available. Cached distances in legacy orders can represent the farm leg
        # (the screenshot showed an implausible 8706.4 km for a local route).
        calculated_distance_km = None
        if source_point and customer_point:
            lat1, lon1 = source_point
            lat2, lon2 = customer_point
            p1, p2 = math.radians(lat1), math.radians(lat2)
            dlat, dlon = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
            a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
            calculated_distance_km = 6371.0088 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a)))
        else:
            # Without both points, use only a plausible cached warehouse-to-customer
            # distance; invalid legacy values require location review instead.
            try:
                saved_distance = float(order.get("warehouseToCustomerDistanceKm"))
                if math.isfinite(saved_distance) and 0 <= saved_distance <= 1000:
                    calculated_distance_km = saved_distance
            except (TypeError, ValueError):
                calculated_distance_km = None

        # Farmer Fulfillment transfer routing uses a 15 km default unless an explicit order/warehouse threshold is configured.
        threshold_km = float(order.get("nearbyDeliveryThresholdKm") or warehouse.get("nearbyDeliveryThresholdKm") or 15.0)
        warehouse_address = warehouse.get("address") if isinstance(warehouse.get("address"), dict) else {}
        source_district = str(
            source_warehouse_doc.get("district")
            or source_warehouse_address.get("district")
            or source_warehouse_address.get("city")
            or source_warehouse_doc.get("city")
            or (warehouse.get("district") if is_source_warehouse or str(source_warehouse_doc.get("_id") or "") == warehouse_id else None)
            or warehouse_address.get("district")
            or warehouse_address.get("city")
            or order.get("sourceDistrict")
            or (farmer_profile or {}).get("district")
            or (farmer_profile or {}).get("farmDistrict")
            or order.get("farmerDistrict")
            or next((line.get("farmDistrict") for line in (order.get("items") or []) if line.get("farmDistrict")), "")
            or ""
        ).strip().casefold()
        shipping_address = order.get("shippingAddress") if isinstance(order.get("shippingAddress"), dict) else {}
        delivery_location = delivery_address.get("location") if isinstance(delivery_address, dict) else None
        customer_address_nested = delivery_address.get("address") if isinstance(delivery_address.get("address"), dict) else {}
        shipping_location = shipping_address.get("location") if isinstance(shipping_address.get("location"), dict) else {}
        # Orders created from the customer's saved address persist the
        # canonical address snapshot as deliveryAddress.city/state/zipCode.
        # Older routing code checked only district and nested address fields,
        # so valid saved customer cities were ignored and these orders were
        # incorrectly classified as needs_location despite having a route
        # distance. Accept common camelCase/snake_case address aliases.
        destination_district = str(
            (delivery_location.get("district") if isinstance(delivery_location, dict) else "")
            or (delivery_address.get("district") if isinstance(delivery_address, dict) else "")
            or (delivery_address.get("districtName") if isinstance(delivery_address, dict) else "")
            or (delivery_address.get("city") if isinstance(delivery_address, dict) else "")
            or (delivery_address.get("town") if isinstance(delivery_address, dict) else "")
            or (delivery_address.get("municipality") if isinstance(delivery_address, dict) else "")
            or customer_address_nested.get("district")
            or customer_address_nested.get("districtName")
            or customer_address_nested.get("city")
            or customer_address_nested.get("town")
            or shipping_address.get("district")
            or shipping_address.get("districtName")
            or shipping_address.get("city")
            or shipping_location.get("district")
            or shipping_location.get("city")
            or order.get("destinationDistrict")
            or order.get("customerDistrict")
            or ""
        ).strip().casefold()
        direct_delivery_mode_values = {
            str(order.get("logisticsMode") or "").strip().lower(),
            str(order.get("deliveryMode") or "").strip().lower(),
            str(order.get("fulfillmentMode") or "").strip().lower(),
            str(order.get("deliveryRoute") or "").strip().lower(),
            str(order.get("deliveryDecision") or "").strip().lower(),
            str(order.get("deliveryPartnerRoute") or "").strip().lower(),
        }
        # Legacy records incorrectly tagged for consolidation may still be
        # single-source direct-delivery orders. Once the persisted source data
        # proves there is only one source, use the measured route (15 km default)
        # instead of letting that stale mode hide Nearby eligibility.
        direct_delivery_configured = bool(
            "farmer_to_delivery_partner" in direct_delivery_mode_values
            or direct_delivery_mode_values.intersection({"direct", "direct_delivery", "warehouse_to_customer", "warehouse_to_customer_direct"})
            or (
                str(order.get("logisticsMode") or "").strip().lower()
                == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
                and not is_multi_warehouse_order
            )
        )
        allocation_warehouse_ids = {
            str(allocation.get("warehouseId") or allocation.get("sourceWarehouseId") or "")
            for allocation in (order.get("warehouseAllocations") or [])
            if isinstance(allocation, dict)
        } - {""}
        assigned_warehouse_ids = {
            str(warehouse_ref) for warehouse_ref in (order.get("warehouseIds") or []) if warehouse_ref
        }
        # A stale logisticsMode/consolidationId/warehouseCount must not
        # turn a single-source order into a multi-warehouse order. Require at
        # least two distinct source warehouses in the persisted source records.
        # Bulk/event intent alone describes the order purpose, not its sourcing.
        distinct_source_warehouse_ids = allocation_warehouse_ids or assigned_warehouse_ids
        is_multi_warehouse_order = len(distinct_source_warehouse_ids) > 1
        route_category = classify_farmer_fulfillment_route(
            calculated_distance_km,
            threshold_km,
            source_district,
            destination_district,
            direct_delivery_configured,
            is_multi_warehouse_order,
        )
        route_type = route_category

        # A route queue begins only after the source warehouse has physically
        # received the shipment. Pre-receipt and unassigned records remain visible
        # for operational follow-up but must not inflate route queue counts.
        def _received_qty(row):
            # Incoming Stock has legacy rows using several actual-quantity names.
            # Normalize them consistently with the receive endpoint and stage derivation.
            value = next(
                (row.get(key) for key in (
                    "quantityReceived", "receivedQuantity", "actualQuantityReceived",
                    "actualReceivedQuantity", "receivedQty", "usableQuantity",
                ) if row.get(key) is not None),
                None,
            )
            if value is None and str(row.get("status") or "").strip().lower() in ("received", "stored"):
                # Some legacy records only persisted status after a physical count.
                value = row.get("quantity") or row.get("expectedQuantity") or row.get("plannedQuantity") or 0
            return float(value or 0)

        def _expected_qty(row):
            return float(row.get("quantity") or row.get("expectedQuantity") or row.get("plannedQuantity") or row.get("declaredQuantity") or 0)

        # The Incoming Stock UI has used both quantity/quantityReceived and
        # expectedQuantity/receivedQuantity across legacy records. Normalize
        # those aliases here so a completed receipt is not silently excluded
        # from the route queues due to a schema-version mismatch.
        linked_packed_rows = packed_incoming_by_order.get(str(order["_id"]), [])
        transfer_receipt_rows = [
            row for row in incoming
            if str(row.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
        ]
        # Prefer all identified packed receipts so legacy rows without sourceMode
        # still participate in the full-quantity gate. Ignore unrelated inventory
        # rows when a dedicated packed receipt set is available.
        receipt_rows = linked_packed_rows or transfer_receipt_rows or incoming
        fully_received_lines = [
            row for row in receipt_rows
            if (
                str(row.get("status") or "").strip().lower() in ("received", "stored")
                and (
                    # A received status with no expected quantity is a valid
                    # legacy receipt; when quantities exist, require full count.
                    _expected_qty(row) <= 0
                    or _received_qty(row) + 1e-9 >= _expected_qty(row)
                )
            )
        ]
        physical_receipt_confirmed = (
            bool(receipt_rows) and len(fully_received_lines) == len(receipt_rows)
        ) or (
            not receipt_rows and order_stage in (
                "received_transfer", "quality_approved", "stored", "ready_for_dispatch",
                "destination_warehouse_transfer_pending", "destination_warehouse_in_transit",
                "destination_warehouse_arrived_pending_receipt", "destination_warehouse_received",
                "hub_handoff_pending", "hub_arrived_pending_receipt", "local_hub_ready",
                "consolidated", "consolidation_portions_received"
            )
        ) or (
            # A consolidation warehouse counts as physically received only after
            # every inbound leg has arrived and any local source portion is also
            # fully received. In-transit legs are actionable, but are not receipts.
            is_consolidation_warehouse
            and int(consolidation.get("totalLegs") or 0) > 0
            and int(consolidation.get("receivedLegs") or 0) >= int(consolidation.get("totalLegs") or 0)
            and (not receipt_rows or len(fully_received_lines) == len(receipt_rows))
        )

        destination_transfer = None
        if logistics_mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
            destination_transfer = await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find_one({
                "orderId": order["_id"],
                "legType": "warehouse_to_destination_warehouse",
                "deletedAt": None,
            })
        local_hub_transfer = await MongoDB.get_collection("farmer_fulfillment_hub_transfers").find_one({
            "orderId": order["_id"],
            "deletedAt": None,
        })

        result.append({
            "id": str(order["_id"]),
            "orderNumber": order.get("orderNumber"),
            "orderStatus": order.get("orderStatus"),
            "stage": order_stage,
            "logisticsMode": logistics_mode,
            "farmerFulfillmentRouteType": order.get("farmerFulfillmentRouteType"),
            "sourceDistrict": source_district or order.get("sourceDistrict") or order.get("warehouseDistrict") or order.get("farmerDistrict"),
            "destinationDistrict": destination_district or order.get("destinationDistrict") or order.get("customerDistrict"),
            "sourceWarehouseId": (warehouse_id if is_allocated_source_warehouse else source_warehouse_id) or None,
            "sourceWarehouseName": order.get("sourceWarehouseName") or (order.get("warehouseName") if is_source_warehouse and not is_allocated_source_warehouse else (warehouse.get("name") or warehouse.get("warehouseName") if is_allocated_source_warehouse else None)),
            "destinationWarehouseId": destination_warehouse_id or None,
            "destinationWarehouseName": order.get("destinationWarehouseName"),
            "destinationWarehouseDistrict": order.get("destinationWarehouseDistrict"),
            "destinationWarehouseRegionalFallback": bool(order.get("destinationWarehouseRegionalFallback")),
            "destinationWarehouseCapacityOverrideRequired": bool(order.get("destinationWarehouseCapacityOverrideRequired")),
            "destinationWarehouseAvailableCapacity": order.get("destinationWarehouseAvailableCapacity"),
            "destinationWarehouseRequiredCapacity": order.get("destinationWarehouseRequiredCapacity"),
            "currentWarehouseRole": "destination" if is_destination_warehouse else ("source" if is_source_warehouse else ("consolidation" if is_consolidation_warehouse else "assigned")) ,
            "deliveryPartnerId": str(order.get("deliveryPartnerId")) if order.get("deliveryPartnerId") else None,
            "deliveryDecisionStatus": order.get("deliveryDecisionStatus"),
            "deliveryJobId": str(order.get("deliveryJobId")) if order.get("deliveryJobId") else None,
            "routeDistanceKm": calculated_distance_km,
            "nearbyThresholdKm": threshold_km,
            "routeCategory": route_category,
            "directDeliveryConfigured": direct_delivery_configured,
            "distanceCalculationStatus": "calculated" if calculated_distance_km is not None else "missing_coordinates",
            "physicalReceiptConfirmed": physical_receipt_confirmed,
            "receivedLineCount": len(fully_received_lines),
            "incomingLineCount": len(receipt_rows),
            "routeDataComplete": route_category != "needs_location" or is_multi_warehouse_order,
            "farmerFulfillmentRouteType": route_type,
            "routeDecisionReason": order.get("routeDecisionReason"),
            "pickupSchedule": order.get("pickupSchedule") or {"timezone": "Asia/Kolkata", "start": "20:00", "end": "06:00"},
            "downstreamTransferSchedule": order.get("downstreamTransferSchedule") or {"timezone": "Asia/Kolkata", "start": "06:00", "end": "20:00"},
            "sourceWarehouseLocation": order.get("sourceWarehouseLocation") or source_location,
            "destinationWarehouseLocation": order.get("destinationWarehouseLocation"),
            "localHubLocation": order.get("nearbyFulfillmentLocation") or order.get("localHubLocation"),
            "isConsolidationWarehouse": is_consolidation_warehouse,
            "consolidation": consolidation,
            "transferStatus": order.get("transferStatus"),
            "destinationTransferStatus": (destination_transfer or {}).get("status"),
            "localHubTransferStatus": (local_hub_transfer or {}).get("status"),
            "localHubTransferAssigned": bool((local_hub_transfer or {}).get("assignedDeliveryPartnerId")),
            "sourceTransfer": {
                "legCount": len(source_legs),
                "inTransitLegs": sum(1 for x in source_legs if str(x.get("status") or "") == "in_transit"),
                "receivedLegs": sum(1 for x in source_legs if str(x.get("status") or "") == "received_at_consolidation"),
                "dispatched": bool(source_legs) and all(
                    str(x.get("status") or "") in ("in_transit", "received_at_consolidation")
                    for x in source_legs
                ),
            },
            "consolidationStatus": order.get("consolidationStatus"),
            "consolidationWarehouseId": str(order.get("consolidationWarehouseId")) if order.get("consolidationWarehouseId") else None,
            "consolidationWarehouseName": order.get("consolidationWarehouseName"),
            "localHubName": (order.get("nearbyFulfillmentLocation") or {}).get("name"),
            "warehouseId": str(warehouse["_id"]),
            "warehouseName": warehouse.get("name") or warehouse.get("warehouseName"),
            "farmerId": str(order["farmerId"]) if order.get("farmerId") else None,
            "farmerName": order.get("farmerName"),
            "deliveryAddress": order.get("deliveryAddress") or {},
            "items": [{
                "productId": str(x.get("productId")),
                "variantId": str(x.get("variantId")) if x.get("variantId") else None,
                "productName": x.get("productName") or "Product",
                "quantity": float(x.get("quantity") or 0),
                "unit": x.get("unit") or "kg",
            } for x in (order.get("items") or [])],
            "warehouseAllocations": [{
                "warehouseId": str(x.get("warehouseId")),
                "warehouseName": x.get("warehouseName") or "Warehouse",
                "productId": str(x.get("productId")),
                "variantId": str(x.get("variantId")) if x.get("variantId") else None,
                "productName": x.get("productName") or "Product",
                "quantity": float(x.get("quantity") or 0),
                "unit": x.get("unit") or "kg",
            } for x in (order.get("warehouseAllocations") or [])],
            "incoming": [{
                "id": str(x["_id"]),
                "status": x.get("status"),
                "productId": str(x.get("productId")),
                "variantId": str(x.get("variantId")) if x.get("variantId") else None,
                "productName": x.get("productName") or next((
                    item.get("productName") or item.get("name")
                    for item in (order.get("items") or [])
                    if str(item.get("productId")) == str(x.get("productId"))
                    and str(item.get("variantId") or "") == str(x.get("variantId") or "")
                ), "Product"),
                "unit": x.get("unit") or "kg",
                "expectedQuantity": float(x.get("quantity") or x.get("expectedQuantity") or x.get("plannedQuantity") or 0),
                "receivedQuantity": float(x.get("quantityReceived") or x.get("receivedQuantity") or x.get("actualQuantityReceived") or 0),
                "usableQuantity": float(x.get("usableQuantity") or x.get("acceptedQuantity") or 0),
                "qualityCheck": x.get("qualityCheck"),
                "sourceMode": x.get("sourceMode"),
                "arrivedWarehouseAt": x.get("arrivedWarehouseAt"),
                "packingRequired": bool(x.get("packingRequired", True)),
            } for x in incoming],
            "outgoing": [{
                "id": str(x["_id"]),
                "status": x.get("status"),
                "quantity": float(x.get("quantity") or 0),
                "deliveryPartnerRoute": x.get("deliveryPartnerRoute"),
                "dispatchDate": x.get("dispatchDate"),
            } for x in outgoing],
        })
    # Keep failed/unfinished warehouse assignment visible instead of treating
    # a persisted long-distance decision as if no order existed. These are
    # informational rows only; they do not get collection-team actions until a
    # real source warehouse and safe quantity allocation have been established.
    pending_unassigned = await order_repository.find_many({
        "$and": [
            {"deletedAt": None},
            ({} if include_completed else {"orderStatus": {"$nin": ["delivered", "completed", "cancelled", "refunded"]}}),
            {"$or": [
                {"fulfillmentMethod": {"$regex": "^(farmer|farm_direct)$", "$options": "i"}},
                {"fulfillment_route": {"$regex": "^(farmer|farm_direct)$", "$options": "i"}},
                {"logisticsMode": "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"},
            ]},
            {"$or": [
                {"deliveryDecision": {"$in": ["long_distance", "nearby"]}},
                {"deliveryPartnerRoute": {"$in": ["long_distance", "nearby"]}},
                {"logisticsMode": {"$in": [
                    "farmer_to_delivery_partner",
                    "farmer_to_warehouse_to_local_hub_to_delivery_partner",
                    "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
                    "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
                    "long_distance_pending",
                ]}},
            ]},
        ],
    }, skip=0, limit=200, sort=[("orderDate", -1), ("createdAt", -1)])
    result_order_ids = {str(item.get("id")) for item in result}
    for pending_order in pending_unassigned:
        pending_id = str(pending_order.get("_id") or "")
        if not pending_id or pending_id in result_order_ids:
            continue
        if pending_order.get("warehouseAllocations") or pending_order.get("warehouseIds") or pending_order.get("warehouseId"):
            continue
        if (
            pending_order.get("selfDelivery")
            or pending_order.get("deliveryPartnerId")
            or pending_order.get("partnerRequested")
        ):
            continue
        any_transfer_incoming = await incoming_stock_repository.find_many({
            "orderId": {"$in": [ObjectId(pending_id), pending_id]},
            "sourceMode": "farmer_fulfillment_transfer",
            "deletedAt": None,
        }, skip=0, limit=1)
        if any_transfer_incoming:
            continue
        lines = [{
            "productId": str(line.get("productId") or ""),
            "variantId": str(line.get("variantId")) if line.get("variantId") else None,
            "productName": line.get("productName") or line.get("name") or "Product",
            "quantity": float(line.get("quantity") or 0),
            "unit": line.get("unit") or "kg",
        } for line in (pending_order.get("items") or [])]
        result.append({
            "id": pending_id,
            "orderNumber": pending_order.get("orderNumber") or pending_id,
            "orderStatus": pending_order.get("orderStatus"),
            "stage": "warehouse_assignment_pending",
            "logisticsMode": str(pending_order.get("logisticsMode") or "long_distance_pending"),
            "isUnassigned": True,
            "isConsolidationWarehouse": False,
            "warehouseName": None,
            "warehouseId": None,
            "farmerId": str(pending_order.get("farmerId")) if pending_order.get("farmerId") else None,
            "farmerName": pending_order.get("farmerName"),
            "message": "The Farmer Order Map decision is saved, but no source warehouse has been assigned yet. Check warehouse active status, configured capacity, and farm/customer location data.",
            "items": lines,
            "incoming": [],
            "outgoing": [],
            "warehouseAllocations": [],
            "consolidation": {
                "isConsolidationWarehouse": False,
                "canReceive": False,
                "canComplete": False,
                "canHandoffLocalHub": False,
                "canConfirmHubReceipt": False,
                "hubTransferStatus": None,
                "totalLegs": 0,
                "inTransitLegs": 0,
                "receivedLegs": 0,
                "allSourcePortionsStored": False,
            },
        })
        result_order_ids.add(pending_id)

    return {"success": True, "data": {"transfers": result, "unlinkedPackedPackets": unlinked_packed_packets}}



@router.post("/me/farmer-fulfillment/{order_id}/recover-source-warehouse")
async def recover_packed_farmer_fulfillment_source_warehouse(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Resolve source warehouse assignment and ensure packed farm pickup records exist.

    This action never confirms receipt. If no incoming shipment exists, it creates
    scheduled packed-transfer lines and farm collection jobs; physical receipt
    must still be confirmed from Incoming Stock.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can resolve source warehouse assignment")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")

    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    if str(order.get("orderStatus") or order.get("status") or "").lower() in {"delivered", "completed", "cancelled", "refunded"}:
        raise HTTPException(status_code=409, detail="Completed or cancelled orders cannot be assigned")
    fulfillment_method = str(order.get("fulfillmentMethod") or order.get("fulfillment_route") or "").strip().lower()
    decision = str(order.get("deliveryDecision") or order.get("deliveryPartnerRoute") or "").strip().lower()
    mode = str(order.get("logisticsMode") or "").strip().lower()
    order_collections = await warehouse_collection_repository.get_by_order(order_id)
    incoming_link_clauses = [
        {"orderId": {"$in": [ObjectId(order_id), order_id]}},
    ]
    if order.get("orderNumber"):
        incoming_link_clauses.extend([
            {"orderNumber": order.get("orderNumber")},
            {"orderNo": order.get("orderNumber")},
        ])
    collection_ids = [
        value
        for collection in order_collections
        if (value := collection.get("_id")) is not None
    ]
    if collection_ids:
        incoming_link_clauses.append({"collectionId": {"$in": collection_ids + [str(value) for value in collection_ids]}})
    packed_collection_ids = {
        str(collection.get("_id"))
        for collection in order_collections
        if (
            str(collection.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
            or collection.get("packingRequired") is False
            or str(collection.get("collectionType") or "").strip().lower() == "packed_orders_transfer"
        )
    }
    incoming_rows = await incoming_stock_repository.find_many({
        "$and": [
            {"warehouseId": {"$in": [ObjectId(str(warehouse["_id"])), str(warehouse["_id"])]}},
            {"deletedAt": None},
            {"$or": incoming_link_clauses},
        ],
    }, skip=0, limit=1000)
    packed_rows = [row for row in incoming_rows if (
        str(row.get("sourceMode") or "").strip().lower() == "farmer_fulfillment_transfer"
        or row.get("packingRequired") is False
        or str(row.get("collectionType") or "").strip().lower() == "packed_orders_transfer"
        or str(row.get("fulfillmentType") or "").strip().lower() == "farmer_fulfillment"
        or str(row.get("shipmentType") or "").strip().lower() == "farmer_fulfillment"
        or bool(row.get("orderId") and row.get("pickupRouteId"))
        or str(row.get("collectionId") or "") in packed_collection_ids
    )]
    if fulfillment_method not in {"farmer", "farm_direct"} and decision not in {"nearby", "long_distance"} and mode not in {
        "farmer_to_delivery_partner", "farmer_to_warehouse_to_local_hub_to_delivery_partner",
        "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
        "long_distance_pending",
    } and not packed_rows:
        raise HTTPException(status_code=409, detail="This order is not marked for Farmer Fulfillment transfer")
    if not order.get("items"):
        raise HTTPException(status_code=409, detail="The packed order has no item lines to assign")

    warehouse_id = str(warehouse["_id"])
    warehouse_status = str(warehouse.get("status") or "").strip().lower()
    if warehouse.get("isActive") is False or (warehouse_status and warehouse_status not in {"active", "approved", "operational"}):
        raise HTTPException(status_code=409, detail="Your warehouse is not active. Activate it before assigning packed orders.")
    if not warehouse.get("location") and not warehouse.get("coordinates"):
        raise HTTPException(status_code=409, detail="Configure this warehouse's map location before assigning source shipments.")

    # Never reassign a shipment that already belongs to another warehouse.
    assigned_source = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
    if assigned_source and assigned_source != warehouse_id:
        raise HTTPException(status_code=409, detail=f"This order is already assigned to another source warehouse ({assigned_source}).")

    now = datetime.utcnow()
    if packed_rows:
        # Recovery of a legacy order is allowed only after its complete physical
        # receipt is recorded. A pending shipment is reconciled below instead.
        def receipt_complete(row: dict) -> bool:
            expected = float(row.get("quantity") or row.get("expectedQuantity") or 0)
            received = row.get("quantityReceived", row.get("receivedQuantity"))
            if received is None and str(row.get("status") or "").lower() in {"received", "stored"}:
                received = expected
            has_receipt_time = bool(row.get("arrivedWarehouseAt") or row.get("receivedAt") or row.get("received_at"))
            return str(row.get("status") or "").lower() in {"received", "stored"} and has_receipt_time and float(received or 0) + 1e-9 >= expected
        # Existing packed rows (including pending receipt rows) are authoritative.
        # Reuse them without duplication, then persist the missing order assignment.
    else:
        # Capacity is a hard requirement: a warehouse with missing/zero capacity
        # must not silently act as an unlimited fallback.
        total_capacity = float(warehouse.get("totalCapacity") or 0)
        used_capacity = float(warehouse.get("usedCapacity") or 0)
        required_capacity = sum(float(line.get("quantity") or 0) for line in order.get("items") or [])
        if required_capacity <= 0:
            raise HTTPException(status_code=409, detail="The order has no positive packed quantity.")
        if total_capacity <= 0:
            raise HTTPException(status_code=409, detail="Configure a positive total capacity for this warehouse before assigning orders.")
        if total_capacity - used_capacity + 1e-9 < required_capacity:
            raise HTTPException(status_code=409, detail=f"Insufficient warehouse capacity. Available: {max(0, total_capacity-used_capacity):g}; required: {required_capacity:g}.")

        # Use the saved farm/pickup snapshot first; fall back to the farmer profile
        # so a missing order snapshot doesn't invent a farm location.
        farm_location = (
            order.get("farmLocation") or order.get("originLocation")
            or order.get("pickupLocation") or order.get("farmerLocation")
        )
        farmer_id = str(order.get("farmerId") or "")
        farmer = None
        if not farm_location and farmer_id and ObjectId.is_valid(farmer_id):
            farmer = await farmer_repository.get_by_id(farmer_id)
            if farmer:
                farm_location = farmer.get("location") or farmer.get("farmLocation") or farmer.get("address")
        if not farm_location:
            raise HTTPException(status_code=409, detail="Farm pickup location is missing. Add the farmer's verified address or coordinates before creating a pickup job.")

        def has_coordinates(value: Any) -> bool:
            if not isinstance(value, dict):
                return False
            coords = value.get("coordinates")
            if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                try:
                    return -180 <= float(coords[0]) <= 180 and -90 <= float(coords[1]) <= 90
                except (TypeError, ValueError):
                    return False
            lat = value.get("latitude", value.get("lat"))
            lon = value.get("longitude", value.get("lng", value.get("lon")))
            try:
                return -90 <= float(lat) <= 90 and -180 <= float(lon) <= 180
            except (TypeError, ValueError):
                return False
        if not has_coordinates(farm_location):
            raise HTTPException(status_code=409, detail="Farm pickup coordinates are missing or invalid. Save a verified farm pin before assigning the warehouse.")

        # Create one scheduled Incoming Stock line per packed order item. This is
        # a pickup/receipt record only: no receipt timestamp, quantityReceived,
        # quality approval, storage or warehouse packing is fabricated.
        created_rows = []
        for line in order.get("items") or []:
            quantity = float(line.get("quantity") or 0)
            if quantity <= 0:
                continue
            incoming_doc = {
                "warehouseId": ObjectId(warehouse_id),
                "orderId": ObjectId(order_id),
                "orderNumber": order.get("orderNumber"),
                "farmerId": ObjectId(farmer_id) if ObjectId.is_valid(farmer_id) else None,
                "productId": ObjectId(str(line.get("productId"))) if ObjectId.is_valid(str(line.get("productId") or "")) else line.get("productId"),
                "variantId": ObjectId(str(line.get("variantId"))) if ObjectId.is_valid(str(line.get("variantId") or "")) else line.get("variantId"),
                "productName": line.get("productName") or line.get("name") or "Product",
                "quantity": quantity,
                "expectedQuantity": quantity,
                "unit": line.get("unit") or "kg",
                "sourceMode": "farmer_fulfillment_transfer",
                "collectionType": "packed_orders_transfer",
                "fulfillmentType": "farmer_fulfillment",
                "packingRequired": False,
                "warehousePackingRequired": False,
                "packingVerified": True,
                "readyForPickup": True,
                "pickupLocation": farm_location,
                "farmLocation": farm_location,
                "status": "scheduled",
                "quantityReceived": 0,
                "qualityCheck": "pending",
                "createdAt": now,
                "updatedAt": now,
                "deletedAt": None,
            }
            incoming_id = await incoming_stock_repository.create_incoming(incoming_doc)
            if not incoming_id:
                raise HTTPException(status_code=500, detail="Could not create the packed shipment's Incoming Stock record.")
            incoming_doc["_id"] = ObjectId(str(incoming_id))
            created_rows.append(incoming_doc)
            await ensure_collection_job(incoming_doc, collection_type="packed_orders_transfer", source_mode="farmer_fulfillment_transfer")

        if not created_rows:
            raise HTTPException(status_code=409, detail="No valid packed item quantities were available to create pickup records.")

    # Classify using source-warehouse -> customer distance and district.
    # Do not trust a stale Farmer Order Map decision when the warehouse changes.
    def _route_point(value: Any):
        if not isinstance(value, dict):
            return None
        coords = value.get("coordinates")
        if isinstance(coords, (list, tuple)) and len(coords) >= 2:
            try:
                lon, lat = float(coords[0]), float(coords[1])
                if -180 <= lon <= 180 and -90 <= lat <= 90:
                    return lat, lon
            except (TypeError, ValueError):
                return None
        lat = value.get("latitude", value.get("lat"))
        lon = value.get("longitude", value.get("lng", value.get("lon")))
        try:
            lat, lon = float(lat), float(lon)
            if -90 <= lat <= 90 and -180 <= lon <= 180:
                return lat, lon
        except (TypeError, ValueError):
            return None
        return None

    source_point = _route_point(warehouse.get("location") or warehouse.get("coordinates"))
    address = order.get("deliveryAddress") or {}
    shipping_address = order.get("shippingAddress") if isinstance(order.get("shippingAddress"), dict) else {}
    destination_point = (
        _route_point(address.get("location") if isinstance(address, dict) else None)
        or _route_point(address)
        or _route_point(order.get("customerLocation"))
        or _route_point(shipping_address)
    )
    threshold_km = float(order.get("nearbyDeliveryThresholdKm") or warehouse.get("nearbyDeliveryThresholdKm") or 15.0)
    distance_km = None
    if source_point and destination_point:
        import math
        lat1, lon1 = map(math.radians, source_point)
        lat2, lon2 = map(math.radians, destination_point)
        dlat, dlon = lat2 - lat1, lon2 - lon1
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        distance_km = 6371.0088 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    warehouse_address = warehouse.get("address") if isinstance(warehouse.get("address"), dict) else {}
    source_district_value = (
        warehouse.get("district")
        or warehouse_address.get("district")
        or order.get("sourceDistrict")
        or order.get("farmerDistrict")
        or ""
    )
    if not source_district_value:
        farmer_id_for_route = str(order.get("farmerId") or "")
        if farmer_id_for_route and ObjectId.is_valid(farmer_id_for_route):
            farmer_for_route = await farmer_repository.get_by_id(farmer_id_for_route)
            if not farmer_for_route:
                farmer_for_route = await farmer_repository.get_by_user_id(farmer_id_for_route)
            source_district_value = (farmer_for_route or {}).get("district") or (farmer_for_route or {}).get("farmDistrict") or ""
    source_district = str(source_district_value).strip().casefold()
    delivery_location = address.get("location") if isinstance(address, dict) else None
    destination_district = str(
        (delivery_location.get("district") if isinstance(delivery_location, dict) else "")
        or (address.get("district") if isinstance(address, dict) else "")
        or shipping_address.get("district")
        or order.get("destinationDistrict")
        or ""
    ).strip().casefold()
    direct_delivery_modes = {
        str(order.get("logisticsMode") or "").strip().lower(),
        str(order.get("deliveryMode") or "").strip().lower(),
        str(order.get("fulfillmentMode") or "").strip().lower(),
        str(order.get("deliveryRoute") or "").strip().lower(),
        decision,
    }
    direct_delivery_configured = (
        "farmer_to_delivery_partner" in direct_delivery_modes
        or bool(direct_delivery_modes.intersection({
            "direct", "direct_delivery", "warehouse_to_customer", "warehouse_to_customer_direct",
        }))
    )
    route_category = classify_farmer_fulfillment_route(
        distance_km,
        threshold_km,
        source_district,
        destination_district,
        direct_delivery_configured,
    )
    if route_category == "nearby":
        logistics_mode = "farmer_to_delivery_partner"
    elif route_category in ("same_district", "route_review"):
        logistics_mode = "farmer_to_warehouse_to_local_hub_to_delivery_partner"
    elif route_category == "inter_district":
        logistics_mode = "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner"
    else:
        # Assignment can be resolved, but dispatch stays blocked until route
        # data is completed; don't invent a route based on missing data.
        logistics_mode = "long_distance_pending"
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "warehouseId": ObjectId(warehouse_id),
        "sourceWarehouseId": ObjectId(warehouse_id),
        "sourceWarehouseName": warehouse.get("name") or warehouse.get("warehouseName"),
        "sourceWarehouseLocation": warehouse.get("location") or warehouse.get("coordinates"),
        "warehouseToCustomerDistanceKm": distance_km,
        "nearbyDeliveryThresholdKm": threshold_km,
        "sourceDistrict": source_district or order.get("sourceDistrict") or order.get("farmerDistrict"),
        "destinationDistrict": destination_district or order.get("destinationDistrict"),
        "farmerFulfillmentRouteType": route_category,
        "farmerFulfillmentRouteCategory": route_category,
        "logisticsMode": logistics_mode,
        "warehouseFulfillmentStage": "awaiting_warehouse_receipt",
        "updatedAt": now,
    })
    await order_repository.append_tracking_event(
        order_id, "farmer_fulfillment_source_warehouse_assigned",
        "Packed order assigned to source warehouse",
        "Source warehouse assignment and packed pickup/receipt records were reconciled. Physical receipt remains pending in Incoming Stock.",
        actor_id=str(current_user["_id"]), actor_role="warehouse",
        metadata={"warehouseId": warehouse_id, "incomingCount": len(packed_rows) if packed_rows else len(created_rows)},
    )
    return {
        "success": True,
        "data": {"orderId": order_id, "warehouseId": warehouse_id, "warehouseName": warehouse.get("name") or warehouse.get("warehouseName"), "incomingCount": len(packed_rows) if packed_rows else len(created_rows), "receiptPending": True},
        "message": "Source warehouse assigned and packed pickup records ensured. Complete physical receipt in Incoming Stock before routing.",
    }


@router.post("/me/farmer-fulfillment/{order_id}/dispatch-to-local-hub")
async def dispatch_single_farmer_fulfillment_to_local_hub(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Move one fully received/stored farmer-packed order to its assigned local hub.

    Farmer Fulfillment never uses the normal warehouse packing/outgoing pipeline.
    The sealed farmer package is transferred directly from this warehouse to the
    approved local hub, where the downstream delivery-partner job is created.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can dispatch farmer fulfillment")
    _enforce_warehouse_operating_window("downstream_transfer")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    logistics_mode = str(order.get("logisticsMode") or "").strip().lower()
    local_hub_mode = "farmer_to_warehouse_to_local_hub_to_delivery_partner"
    if logistics_mode not in (local_hub_mode, "farmer_to_delivery_partner"):
        raise HTTPException(status_code=400, detail="This order is not a single-warehouse Farmer Fulfillment order")
    if str(order.get("sourceWarehouseId") or order.get("warehouseId") or "") != str(warehouse["_id"]):
        raise HTTPException(status_code=403, detail="This order is assigned to another warehouse")
    if logistics_mode == "farmer_to_delivery_partner":
        address = order.get("deliveryAddress") or order.get("shippingAddress") or {}
        if not isinstance(address, dict):
            address = {}
        customer_location = address.get("location") or address.get("deliveryLocation") or order.get("customerLocation") or address
        warehouse_address = warehouse.get("address") if isinstance(warehouse.get("address"), dict) else {}
        customer_district = str(
            address.get("district")
            or (customer_location.get("district") if isinstance(customer_location, dict) else "")
            or ""
        ).strip().casefold()
        shipping_address = order.get("shippingAddress") if isinstance(order.get("shippingAddress"), dict) else {}
        customer_district = customer_district or str(shipping_address.get("district") or order.get("destinationDistrict") or "").strip().casefold()
        source_district = str(
            warehouse.get("district")
            or warehouse_address.get("district")
            or order.get("sourceDistrict")
            or order.get("farmerDistrict")
            or ""
        ).strip().casefold()
        distance = distance_km(warehouse.get("location") or warehouse.get("coordinates"), customer_location)
        threshold = float(order.get("nearbyDeliveryThresholdKm") or warehouse.get("nearbyDeliveryThresholdKm") or 15.0)
        route_category = classify_farmer_fulfillment_route(
            distance,
            threshold,
            source_district,
            customer_district,
            True,
        )
        if route_category != "same_district":
            raise HTTPException(
                status_code=409,
                detail="This order does not qualify for same-district hub fulfillment. Verify delivery details and use the route shown on the transfers page.",
            )
    incoming = await _get_farmer_fulfillment_incoming_rows(order, str(warehouse["_id"]))
    # Farmer Fulfillment shipments arrive already packed and sealed. Physical
    # receipt is required, but bulk-inventory storage is intentionally optional
    # and the storage endpoint rejects these sealed transfers. Support legacy
    # quantity/status field names, but never allow a partial receipt to dispatch.
    def _complete_sealed_receipt(row: dict) -> bool:
        receipt_status = str(row.get("status") or "").strip().lower()
        received = next(
            (row.get(key) for key in ("quantityReceived", "receivedQuantity", "actualReceivedQuantity", "actualQuantityReceived", "receivedQty") if row.get(key) is not None),
            None,
        )
        expected = float(row.get("quantity") or row.get("expectedQuantity") or row.get("plannedQuantity") or 0)
        if received is None:
            received = expected if receipt_status in ("received", "stored") else 0
        try:
            return receipt_status in ("received", "stored") and float(received or 0) + 1e-9 >= expected
        except (TypeError, ValueError):
            return False
    if not incoming or any(not _complete_sealed_receipt(x) for x in incoming):
        raise HTTPException(status_code=400, detail="Confirm physical arrival and complete quantity receipt before dispatching the sealed farmer-packed order")
    hub_id = order.get("nearbyFulfillmentLocationId")
    hubs = MongoDB.get_collection("fulfillment_hubs")
    # Use the same transfer manifest collection consumed by partner assignment,
    # partner route status, and local-hub receipt. A separate legacy hub_transfers
    # record left the assigned partner unable to find the manifest.
    hub_transfers = MongoDB.get_collection("farmer_fulfillment_hub_transfers")
    hub = await hubs.find_one({
        "_id": ObjectId(str(hub_id)) if hub_id and ObjectId.is_valid(str(hub_id)) else None,
        "isLocalFulfillmentHub": True,
        "isActive": True,
        "approvalStatus": "approved",
        "deletedAt": None,
    }) if hub_id and ObjectId.is_valid(str(hub_id)) else None
    if not hub:
        address = order.get("deliveryAddress") or order.get("shippingAddress") or {}
        if not isinstance(address, dict):
            address = {}
        customer_location = address.get("location") or address.get("deliveryLocation") or order.get("customerLocation") or address
        if not isinstance(customer_location, dict) or distance_km(customer_location, customer_location) is None:
            raise HTTPException(status_code=409, detail="Customer delivery coordinates are required to select an approved local hub")
        quantity_required = sum(float(item.get("quantity") or 0) for item in (order.get("items") or []))
        hub = await nearest_local_hub(customer_location, quantity_required)
        if not hub:
            raise HTTPException(status_code=409, detail="No active approved local hub with sufficient available capacity could be found near the customer")
        hub_id = hub["_id"]
    existing = await hub_transfers.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
    if existing:
        return {"success": True, "data": {"status": "already_transferred", "transferId": str(existing["_id"])}, "message": "This order is already in the local-hub transfer flow."}
    quantity = sum(float(
        x.get("usableQuantity")
        or x.get("quantityReceived")
        or x.get("receivedQuantity")
        or x.get("actualQuantityReceived")
        or x.get("receivedQty")
        or (
            x.get("quantity")
            or x.get("expectedQuantity")
            or x.get("plannedQuantity")
            if str(x.get("status") or "").strip().lower() in ("received", "stored")
            else 0
        )
        or 0
    ) for x in incoming)
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="No usable received quantity is available for hub transfer")
    available_hub_capacity = float(
        hub.get("availableCapacity")
        if hub.get("availableCapacity") is not None
        else hub.get("storageCapacity") or 0
    )
    if quantity > available_hub_capacity:
        raise HTTPException(status_code=400, detail="Local hub does not have enough available capacity")
    source = warehouse.get("location") or order.get("currentFulfillmentLocation") or order.get("originLocation")
    now = datetime.utcnow()
    transfer = {
        "orderId": ObjectId(order_id),
        "orderNumber": order.get("orderNumber") or order_id,
        "localHubId": ObjectId(str(hub_id)),
        "localHubName": hub.get("name") or hub.get("hubName") or "Local Fulfillment Hub",
        "hubId": ObjectId(str(hub_id)),
        "sourceWarehouseId": ObjectId(str(warehouse["_id"])),
        "sourceWarehouseName": warehouse.get("name"),
        "quantity": quantity,
        "sourceLocation": source,
        "destinationLocation": hub.get("location"),
        "status": "in_transit",
        "logisticsMode": "farmer_to_warehouse_to_local_hub_to_delivery_partner",
        "farmerFulfillment": True,
        "deletedAt": None,
        "createdAt": now,
        "updatedAt": now,
        "farmerId": order.get("farmerId"),
        "productIds": [i.get("productId") for i in order.get("items", [])],
        "batchIds": [i.get("batchId") for i in order.get("items", []) if i.get("batchId")],
    }
    result = await hub_transfers.insert_one(transfer)
    if hub.get("availableCapacity") is None:
        await hubs.update_one(
            {"_id": ObjectId(str(hub_id))},
            {"$set": {"availableCapacity": available_hub_capacity - quantity, "updatedAt": now}},
        )
    else:
        await hubs.update_one(
            {"_id": ObjectId(str(hub_id))},
            {"$inc": {"availableCapacity": -quantity}, "$set": {"updatedAt": now}},
        )
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "logisticsMode": local_hub_mode,
        "farmerFulfillmentRouteType": "same_district",
        "farmerFulfillmentRouteCategory": "same_district",
        "transferStatus": "hub_handoff_pending",
        "warehouseFulfillmentStage": "local_hub_transfer_pending",
        "nearbyFulfillmentLocationId": ObjectId(str(hub_id)),
        "nearbyFulfillmentLocation": {
            "id": str(hub_id),
            "name": hub.get("name") or hub.get("hubName") or "Local Fulfillment Hub",
            "address": hub.get("address") or "",
            "location": hub.get("location") or hub.get("coordinates") or {},
        },
        "updatedAt": now,
    })
    await order_repository.append_tracking_event(
        order_id,
        "farmer_fulfillment_dispatched_to_local_hub",
        "Farmer-packed order dispatched to local hub",
        "The sealed farmer-packed order has left the warehouse and is moving to the assigned local hub for one delivery-partner handoff.",
        actor_id=str(current_user["_id"]), actor_role="warehouse",
        metadata={"hubId": str(hub_id), "transferId": str(result.inserted_id), "quantity": quantity},
    )
    try:
        await NotificationService.send_order_workflow_update(
            await order_repository.get_by_id(order_id),
            stage="local_hub_transfer_pending",
            status="transfer_pending",
            title=f"Order #{order.get('orderNumber')}: sent to local hub",
            message="The farmer-packed order is on its way to the local hub. One delivery partner will handle the final delivery.",
            actor_role="warehouse", priority=NotificationPriority.HIGH,
        )
    except Exception:
        logger.exception("Failed to notify after Farmer Fulfillment hub dispatch")
    transfer["id"] = str(result.inserted_id)
    transfer.pop("_id", None)
    return {"success": True, "data": transfer, "message": "Farmer-packed order dispatched to the local hub."}


@router.get("/me/farmer-fulfillment-consolidations")
async def get_farmer_fulfillment_consolidations(current_user: dict = Depends(get_current_user)):
    """Show multi-warehouse farmer-packed orders awaiting consolidation/handoff."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access farmer fulfillment consolidation")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    warehouse_id = str(warehouse["_id"])
    warehouse_refs = [ObjectId(warehouse_id), warehouse_id]
    orders = await order_repository.find_many({
        "logisticsMode": "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
        "$or": [
            {"warehouseId": {"$in": warehouse_refs}},
            {"warehouseIds": {"$in": warehouse_refs}},
            {"warehouseAllocations.warehouseId": {"$in": warehouse_refs}},
            {"consolidationWarehouseId": {"$in": warehouse_refs}},
            {"destinationWarehouseId": {"$in": warehouse_refs}},
            {"destinationWarehouseIds": {"$in": warehouse_refs}},
        ],
        "deletedAt": None,
        "orderStatus": {"$nin": ["cancelled", "refunded", "delivered", "completed"]},
    }, skip=0, limit=200, sort=[("updatedAt", -1)])

    # The logisticsMode flag alone is not enough to qualify an order for
    # multi-warehouse consolidation: older routing code can leave that flag on
    # an order whose stock actually comes from one warehouse. Keep this queue
    # limited to orders with at least two distinct physical source warehouses.
    true_multi_source_orders = []
    for order in orders:
        allocations = order.get("warehouseAllocations") or []
        allocation_sources = {
            str(a.get("warehouseId") or "").strip()
            for a in allocations
            if str(a.get("warehouseId") or "").strip()
        }
        declared_sources = {
            str(x).strip()
            for x in (order.get("warehouseIds") or [])
            if str(x).strip()
        }
        item_sources = {
            str(item.get("sourceWarehouseId") or item.get("warehouseId") or "").strip()
            for item in (order.get("items") or [])
            if str(item.get("sourceWarehouseId") or item.get("warehouseId") or "").strip()
        }
        source_ids = allocation_sources or declared_sources or item_sources
        if len(source_ids) >= 2:
            true_multi_source_orders.append(order)

    consolidation_collection = MongoDB.get_collection("farmer_fulfillment_consolidations")
    result = []
    for order in true_multi_source_orders:
        cid = order.get("consolidationId")
        consolidation = await consolidation_collection.find_one({"_id": cid, "deletedAt": None}) if cid else None
        incoming = await incoming_stock_repository.find_many({
            "orderId": order["_id"],
            "sourceMode": "farmer_fulfillment_transfer",
            "deletedAt": None,
        }, skip=0, limit=1000)
        received_or_stored = [
            row for row in incoming
            if str(row.get("status") or "").strip().lower() in ("received", "stored")
            and float(row.get("quantityReceived") or row.get("receivedQuantity") or row.get("actualQuantityReceived") or row.get("quantity") or 0) + 1e-9
                >= float(row.get("quantity") or row.get("expectedQuantity") or row.get("plannedQuantity") or 0)
        ]
        expected_by_portion = {}
        for allocation in (order.get("warehouseAllocations") or []):
            key = (
                str(allocation.get("warehouseId") or ""),
                str(allocation.get("productId") or ""),
                str(allocation.get("variantId") or ""),
            )
            expected_by_portion[key] = expected_by_portion.get(key, 0.0) + float(allocation.get("quantity") or 0)
        received_by_portion = {}
        for row in received_or_stored:
            key = (
                str(row.get("warehouseId") or ""),
                str(row.get("productId") or ""),
                str(row.get("variantId") or ""),
            )
            quantity_received = row.get("quantityReceived")
            if quantity_received is None:
                quantity_received = row.get("receivedQuantity")
            if quantity_received is None:
                quantity_received = row.get("actualQuantityReceived")
            if quantity_received is None:
                quantity_received = row.get("quantity")
            received_by_portion[key] = received_by_portion.get(key, 0.0) + max(0.0, float(quantity_received or 0))
        all_warehouses_received = bool(expected_by_portion) and all(
            received_by_portion.get(key, 0.0) + 1e-9 >= required
            for key, required in expected_by_portion.items()
        )
        consolidation_legs = await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find({
            "orderId": order["_id"],
            "legType": "warehouse_to_consolidation",
            "deletedAt": None,
        }).to_list(length=1000)
        received_consolidation_legs = [x for x in consolidation_legs if str(x.get("status")) == "received_at_consolidation"]
        # Build one operational row per required product/source allocation so
        # staff can see what is missing instead of only seeing aggregate counts.
        product_portions = []
        for allocation in (order.get("warehouseAllocations") or []):
            source_id = str(allocation.get("warehouseId") or allocation.get("sourceWarehouseId") or "")
            product_id = str(allocation.get("productId") or "")
            variant_id = str(allocation.get("variantId") or "")
            expected_qty = float(allocation.get("quantity") or 0)
            matching_incoming = [
                row for row in incoming
                if str(row.get("warehouseId") or "") == source_id
                and str(row.get("productId") or "") == product_id
                and str(row.get("variantId") or "") == variant_id
            ]
            matching_legs = [
                leg for leg in consolidation_legs
                if str(leg.get("sourceWarehouseId") or "") == source_id
                and str(leg.get("productId") or "") == product_id
                and str(leg.get("variantId") or "") == variant_id
            ]
            received_qty = sum(float(
                row.get("quantityReceived") if row.get("quantityReceived") is not None
                else row.get("receivedQuantity") if row.get("receivedQuantity") is not None
                else row.get("actualQuantityReceived") if row.get("actualQuantityReceived") is not None
                else 0
            ) for row in matching_incoming if str(row.get("status") or "").lower() in ("received", "stored"))
            accepted_qty = sum(float(row.get("usableQuantity") or row.get("acceptedQuantity") or 0) for row in matching_incoming)
            source_leg = matching_legs[0] if matching_legs else {}
            incoming_statuses = [str(row.get("status") or "not_created").lower() for row in matching_incoming]
            if matching_legs and all(str(leg.get("status") or "") == "received_at_consolidation" for leg in matching_legs):
                portion_status = "received_at_consolidation"
            elif any(str(leg.get("status") or "") == "in_transit" for leg in matching_legs):
                portion_status = "in_transit"
            elif any(s == "stored" for s in incoming_statuses):
                portion_status = "stored_at_source"
            elif any(s == "received" for s in incoming_statuses):
                portion_status = "received_at_source"
            elif any(s in ("quality_check", "quality_check_pending") for s in incoming_statuses):
                portion_status = "quality_check"
            elif matching_incoming:
                portion_status = "ready_for_collection" if any(row.get("readyForPickup") for row in matching_incoming) else incoming_statuses[0]
            else:
                portion_status = "awaiting_farm_collection"
            item = next((x for x in (order.get("items") or []) if str(x.get("productId") or "") == product_id and str(x.get("variantId") or "") == variant_id), {})
            incoming_sample = matching_incoming[0] if matching_incoming else {}
            product_name = allocation.get("productName") or item.get("productName") or item.get("name") or incoming_sample.get("eventProductName") or "Product"
            source_warehouse = await warehouse_repository.get_by_id(source_id) if ObjectId.is_valid(source_id) else None
            product_portions.append({
                "sourceWarehouseId": source_id,
                "sourceWarehouseName": allocation.get("warehouseName") or (source_warehouse or {}).get("name") or (source_warehouse or {}).get("warehouseName") or "Source warehouse",
                "productId": product_id,
                "variantId": variant_id or None,
                "productName": product_name,
                "requiredQuantity": expected_qty,
                "unit": allocation.get("unit") or item.get("unit") or "kg",
                "receivedQuantity": received_qty,
                "acceptedQuantity": accepted_qty,
                "qualityStatus": incoming_sample.get("qualityCheck") or "pending",
                "collectionStatus": incoming_sample.get("collectionStatus") or incoming_sample.get("pickupStatus") or ("collection_job_created" if incoming_sample.get("readyForPickup") else "not_started"),
                "incomingStatus": incoming_sample.get("status") or "not_created",
                "transferLegId": str(source_leg.get("_id")) if source_leg.get("_id") else None,
                "transferStatus": str(source_leg.get("status") or "not_dispatched"),
                "portionStatus": portion_status,
                "shortageQuantity": max(0.0, expected_qty - received_qty),
                "incomingRecordIds": [str(row.get("_id")) for row in matching_incoming if row.get("_id")],
            })
        delivery_address = order.get("deliveryAddress") or order.get("shippingAddress") or {}
        result.append({
            "orderId": str(order["_id"]),
            "orderNumber": order.get("orderNumber"),
            "buyerName": order.get("buyerName") or order.get("customerName") or order.get("businessName") or "Customer",
            "buyerType": order.get("buyerType") or order.get("orderType") or ("event" if order.get("eventRequestId") else "customer"),
            "deliveryAddress": delivery_address,
            "requestedDeliveryDate": order.get("requestedDeliveryDate") or order.get("deliveryDay"),
            "requestedDeliveryTime": order.get("requestedDeliveryTime") or order.get("timeSlot"),
            "orderStatus": order.get("orderStatus") or order.get("status"),
            "deliveryJobId": str(order.get("deliveryJobId") or order.get("deliveryPartnerJobId") or "") or None,
            "deliveryPartnerId": str(order.get("deliveryPartnerId") or "") or None,
            "productPortions": product_portions,
            "warehouseIds": [str(x) for x in (order.get("warehouseIds") or [])],
            "warehouseCount": int(order.get("warehouseCount") or len(order.get("warehouseIds") or [])),
            "allocations": order.get("warehouseAllocations") or [],
            "consolidationId": str(cid) if cid else None,
            "consolidationWarehouseId": str(order.get("consolidationWarehouseId")) if order.get("consolidationWarehouseId") else None,
            "consolidationWarehouseName": order.get("consolidationWarehouseName"),
            "consolidationStatus": order.get("consolidationStatus") or (consolidation or {}).get("status"),
            "localHub": order.get("nearbyFulfillmentLocation"),
            "transferStatus": order.get("transferStatus"),
            "logisticsMode": order.get("logisticsMode"),
            "warehouseCount": int(order.get("warehouseCount") or 1),
            "sourceWarehouseId": str(warehouse["_id"]) if any(str(a.get("warehouseId")) == str(warehouse["_id"]) for a in (order.get("warehouseAllocations") or [])) else None,
            "incomingCount": len(incoming),
            "storedCount": len(received_or_stored),
            "allWarehousesReceived": all_warehouses_received,
            "allConsolidationLegsReceived": bool(consolidation_legs) and len(received_consolidation_legs) == len(consolidation_legs),
            "hasInTransitConsolidationLegs": any(str(leg.get("status") or "") == "in_transit" for leg in consolidation_legs),
            "consolidationLegs": [
                {
                    "id": str(leg.get("_id")),
                    "sourceWarehouseId": str(leg.get("sourceWarehouseId") or ""),
                    "sourceWarehouseName": leg.get("sourceWarehouseName") or "Source warehouse",
                    "destinationWarehouseId": str(leg.get("destinationWarehouseId") or ""),
                    "productId": str(leg.get("productId") or ""),
                    "quantity": float(leg.get("quantity") or 0),
                    "status": str(leg.get("status") or "pending"),
                    "dispatchedAt": leg.get("dispatchedAt").isoformat() if isinstance(leg.get("dispatchedAt"), datetime) else None,
                    "receivedAtConsolidation": leg.get("receivedAtConsolidation").isoformat() if isinstance(leg.get("receivedAtConsolidation"), datetime) else None,
                }
                for leg in consolidation_legs
            ],
            "totalConsolidationLegCount": len(consolidation_legs),
            "inTransitLegCount": sum(1 for leg in consolidation_legs if str(leg.get("status") or "") == "in_transit"),
            "receivedConsolidationLegCount": len(received_consolidation_legs),
            "canDispatchToConsolidation": any(str(a.get("warehouseId")) == str(warehouse["_id"]) for a in (order.get("warehouseAllocations") or [])),
            "isConsolidationWarehouse": str(order.get("consolidationWarehouseId") or "") == str(warehouse["_id"]),
            "deliveryPartnerJobId": order.get("deliveryPartnerJobId"),
        })
    # Event/business bulk orders are stored in bulk_requests + event_fulfillments,
    # not the standard orders collection. Include them in this same operational
    # screen so warehouse staff can track every farmer/product portion.
    bulk_requests = MongoDB.get_collection("bulk_requests")
    event_fulfillments_collection = MongoDB.get_collection("event_fulfillments")
    event_requests = await bulk_requests.find({
        "deletedAt": None,
        "$or": [
            {"eventWarehouseId": {"$in": warehouse_refs}},
            {"eventLocalHubId": {"$in": warehouse_refs}},
        ],
        "eventSourcingStatus": {"$nin": ["cancelled"]},
        "status": {"$nin": ["cancelled"]},
    }).sort("updatedAt", -1).limit(200).to_list(length=200)
    for request in event_requests:
        event_warehouse_id = str(request.get("eventWarehouseId") or "")
        local_hub_id = str(request.get("eventLocalHubId") or "")
        is_event_consolidation_warehouse = event_warehouse_id == warehouse_id
        is_event_local_hub = local_hub_id == warehouse_id
        fulfillments = await event_fulfillments_collection.find({
            "requestId": request["_id"], "deletedAt": None,
        }).to_list(length=500)
        if not fulfillments:
            continue
        incoming_rows = await incoming_stock_repository.find_many({
            "eventRequestId": request["_id"], "deletedAt": None,
        }, skip=0, limit=1000)
        incoming_by_fulfillment = {
            str(row.get("eventFulfillmentId")): row
            for row in incoming_rows if row.get("eventFulfillmentId")
        }
        portions = []
        stored_count = 0
        for fulfillment in fulfillments:
            fid = str(fulfillment.get("_id") or "")
            incoming_row = incoming_by_fulfillment.get(fid) or {}
            fulfillment_status = str(fulfillment.get("status") or "pending_farmer_confirmation")
            actual_received = incoming_row.get("quantityReceived")
            if actual_received is None:
                actual_received = incoming_row.get("receivedQuantity")
            if actual_received is None:
                actual_received = incoming_row.get("actualQuantityReceived")
            actual_received = float(actual_received or 0)
            required_qty = float(fulfillment.get("allocatedQuantityKg") or 0)
            quality_status = str(incoming_row.get("qualityCheck") or "pending")
            is_stored = fulfillment_status == "stored" and str(incoming_row.get("status") or "").lower() == "stored" and quality_status.lower() == "passed" and actual_received + 1e-9 >= required_qty
            if is_stored:
                stored_count += 1
            farmer = await farmer_repository.find_one({"userId": fulfillment.get("farmerId")}) if fulfillment.get("farmerId") else None
            portion_status = (
                "stored_at_consolidation" if is_stored else
                "warehouse_received" if fulfillment_status == "warehouse_received" else
                "quality_check" if str(incoming_row.get("status") or "").lower() in ("quality_check", "quality_check_pending") else
                "received_at_warehouse" if str(incoming_row.get("status") or "").lower() == "received" else
                "ready_for_collection" if fulfillment_status == "ready_for_collection" else
                fulfillment_status
            )
            portions.append({
                "sourceWarehouseId": str(fulfillment.get("farmerId") or ""),
                "sourceWarehouseName": fulfillment.get("farmName") or (farmer or {}).get("farmName") or "Farmer source",
                "farmerName": (farmer or {}).get("farmName") or "Farmer",
                "farmerId": str(fulfillment.get("farmerId") or ""),
                "productId": str(fulfillment.get("productId") or ""),
                "productName": fulfillment.get("productName") or "Product",
                "requiredQuantity": required_qty,
                "unit": "kg",
                "receivedQuantity": actual_received,
                "acceptedQuantity": float(incoming_row.get("usableQuantity") or incoming_row.get("acceptedQuantity") or 0),
                "qualityStatus": quality_status,
                "collectionStatus": fulfillment.get("collectionStatus") or "pending",
                "incomingStatus": incoming_row.get("status") or "not_created",
                "transferLegId": fid,
                "transferStatus": portion_status,
                "portionStatus": portion_status,
                "shortageQuantity": max(0.0, required_qty - actual_received),
                "incomingRecordIds": [str(incoming_row.get("_id"))] if incoming_row.get("_id") else [],
                "eventFulfillmentId": fid,
                "eventFulfillmentStatus": fulfillment_status,
            })
        all_stored = len(fulfillments) > 0 and stored_count == len(fulfillments)
        result.append({
            "orderId": str(request["_id"]),
            "requestId": str(request["_id"]),
            "orderNumber": request.get("requestNumber") or str(request["_id"]),
            "buyerName": request.get("buyerName") or "Customer / Business",
            "buyerType": request.get("buyerCategory") or request.get("buyerType") or request.get("requestType") or "event",
            "isEventOrder": True,
            "isConsolidationWarehouse": is_event_consolidation_warehouse,
            "isLocalHub": is_event_local_hub,
            "canDispatchToConsolidation": False,
            "warehouseCount": len(fulfillments),
            "productPortions": portions,
            "consolidationLegs": [],
            "totalConsolidationLegCount": len(fulfillments),
            "receivedConsolidationLegCount": stored_count,
            "allWarehousesReceived": all_stored,
            "allConsolidationLegsReceived": all_stored,
            "hasInTransitConsolidationLegs": False,
            "consolidationStatus": request.get("eventConsolidationStatus") or "pending_collection",
            "transferStatus": request.get("eventLocalHubStatus") or request.get("eventDeliveryStatus"),
            "localHubStatus": request.get("eventLocalHubStatus"),
            "localHubName": request.get("eventLocalHubName"),
            "localHubId": local_hub_id or None,
            "consolidationWarehouseId": event_warehouse_id or None,
            "consolidationWarehouseName": request.get("eventWarehouseName") or "Event consolidation warehouse",
            "isEventLocalHub": is_event_local_hub,
            "eventDeliveryJobId": str(request.get("eventDeliveryJobId") or "") or None,
            "deliveryJobId": str(request.get("eventDeliveryJobId") or "") or None,
            "deliveryPartnerId": str(request.get("deliveryPartnerId") or "") or None,
            "deliveryAddress": request.get("deliveryAddress") or {},
            "requestedDeliveryDate": request.get("requestedDeliveryDate"),
            "requestedDeliveryTime": request.get("requestedDeliveryTime"),
            "eventStatus": request.get("eventDeliveryStatus"),
            "eventRequestStatus": request.get("status"),
            "allEventPortionsStored": all_stored,
        })
    return {"success": True, "data": {"consolidations": result}}



@router.put("/me/farmer-fulfillment/{order_id}/assign-nearby-delivery-partner")
async def assign_nearby_farmer_fulfillment_delivery_partner(
    order_id: str,
    deliveryPartnerId: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """Assign one approved final-mile partner to a physically received Nearby order."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign the final delivery partner")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    warehouse_id = str(warehouse["_id"])
    source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
    if source_id != warehouse_id:
        raise HTTPException(status_code=403, detail="Only the assigned source warehouse can assign this order's final-mile partner")
    logistics_mode = str(order.get("logisticsMode") or "").strip().lower()
    direct_modes = {
        logistics_mode,
        str(order.get("deliveryMode") or "").strip().lower(),
        str(order.get("fulfillmentMode") or "").strip().lower(),
        str(order.get("deliveryRoute") or "").strip().lower(),
        str(order.get("deliveryDecision") or "").strip().lower(),
        str(order.get("deliveryPartnerRoute") or "").strip().lower(),
    }
    direct_delivery_configured = (
        "farmer_to_delivery_partner" in direct_modes
        or bool(direct_modes.intersection({"direct", "direct_delivery", "warehouse_to_customer", "warehouse_to_customer_direct"}))
    )
    # Permit recovery of a legacy single-source order that was mistakenly
    # stamped as multi-warehouse. The measured route below still enforces the
    # configured 15 km Nearby threshold, and receipt/partner validations remain.
    if not direct_delivery_configured and logistics_mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        allocations = order.get("warehouseAllocations") if isinstance(order.get("warehouseAllocations"), list) else []
        allocation_sources = {str(a.get("warehouseId") or a.get("sourceWarehouseId") or "") for a in allocations if isinstance(a, dict)}
        declared_sources = {str(x) for x in (order.get("warehouseIds") or []) if x}
        item_sources = {str(i.get("sourceWarehouseId") or i.get("warehouseId") or "") for i in (order.get("items") or []) if isinstance(i, dict) and (i.get("sourceWarehouseId") or i.get("warehouseId"))}
        distinct_sources = allocation_sources or declared_sources or item_sources
        direct_delivery_configured = len(distinct_sources) <= 1
    if not direct_delivery_configured:
        raise HTTPException(status_code=409, detail="This order is not configured for direct warehouse-to-customer delivery. Use the local-hub or destination-warehouse route instead.")
    if str(order.get("deliveryType") or "").strip().lower() == "pickup":
        raise HTTPException(status_code=409, detail="Customer-pickup orders cannot be assigned a delivery partner")
    if str(order.get("orderStatus") or order.get("status") or "").strip().lower() in ("cancelled", "canceled", "refunded", "delivered", "completed"):
        raise HTTPException(status_code=409, detail="A cancelled or completed order cannot be assigned for final delivery")
    if str(order.get("deliveryPartnerJobId") or "").strip():
        existing_assigned_partner = str(order.get("deliveryPartnerId") or "")
        if existing_assigned_partner and existing_assigned_partner != deliveryPartnerId:
            raise HTTPException(status_code=409, detail="A different final delivery partner is already assigned to this order")
    incoming = await _get_farmer_fulfillment_incoming_rows(order, warehouse_id)
    if not incoming:
        raise HTTPException(status_code=409, detail="Confirm physical receipt in Incoming Stock before assigning final delivery")
    def _received_quantity(row: dict) -> float:
        for key in ("quantityReceived", "receivedQuantity", "actualReceivedQuantity", "actualQuantityReceived", "receivedQty"):
            if row.get(key) is not None:
                try: return float(row.get(key) or 0)
                except (TypeError, ValueError): return 0.0
        return float(row.get("quantity") or row.get("expectedQuantity") or row.get("plannedQuantity") or 0) if str(row.get("status") or "").lower() in ("received", "stored") else 0.0
    for row in incoming:
        expected = float(row.get("quantity") or row.get("expectedQuantity") or row.get("plannedQuantity") or 0)
        if str(row.get("status") or "").lower() not in ("received", "stored") or _received_quantity(row) + 1e-9 < expected:
            raise HTTPException(status_code=409, detail="The complete shipment must be physically received before final delivery assignment")
    members = await warehouse_pickup_team_repository.get_approved_members(warehouse_id)
    member = next((m for m in members if str(m.get("deliveryPartnerId") or "") == deliveryPartnerId), None)
    if not member:
        raise HTTPException(status_code=400, detail="Select an approved delivery partner assigned to this warehouse")
    profile_id = str(member.get("deliveryPartnerId") or "")
    user_id = str(member.get("userId") or member.get("deliveryPartnerUserId") or "")
    if not ObjectId.is_valid(profile_id) or not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="The selected delivery partner profile is incomplete")
    if order.get("deliveryPartnerId") and str(order.get("deliveryPartnerId")) != profile_id:
        raise HTTPException(status_code=409, detail="A final delivery partner is already assigned to this order")
    # A partner assignment must create/update the delivery marketplace job as well
    # as the order field; otherwise the order can look assigned in the warehouse UI
    # but never appear in the partner's actionable queue.
    source = warehouse.get("location") or order.get("currentFulfillmentLocation") or order.get("originLocation") or {}
    source_coords = source.get("coordinates") if isinstance(source, dict) else None
    if not source_coords or len(source_coords) < 2:
        lat = source.get("lat", source.get("latitude")) if isinstance(source, dict) else None
        lng = source.get("lng", source.get("longitude")) if isinstance(source, dict) else None
        if lat is not None and lng is not None:
            source_coords = [float(lng), float(lat)]
    address = order.get("deliveryAddress") or order.get("shippingAddress") or {}
    if not isinstance(address, dict):
        address = {}
    destination = address.get("location") or address.get("deliveryLocation") or order.get("customerLocation") or {}
    destination_coords = destination.get("coordinates") if isinstance(destination, dict) else None
    if not destination_coords or len(destination_coords) < 2:
        lat = address.get("lat", address.get("latitude"))
        lng = address.get("lng", address.get("longitude"))
        if lat is not None and lng is not None:
            destination_coords = [float(lng), float(lat)]
    if not source_coords or len(source_coords) < 2 or not destination_coords or len(destination_coords) < 2:
        raise HTTPException(status_code=409, detail="Warehouse pickup and customer delivery coordinates are required before creating the final delivery job")
    pickup = {
        "type": "warehouse",
        "id": warehouse_id,
        "name": warehouse.get("name") or "Source Warehouse",
        "address": source.get("address") or warehouse.get("address") or "",
        "coordinates": [float(source_coords[0]), float(source_coords[1])],
    }
    patched_order = dict(order)
    patched_order["deliveryPickupLocation"] = pickup
    patched_order.pop("nearbyFulfillmentLocation", None)
    patched_order.pop("nearbyFulfillmentLocationId", None)
    route_distance_km = _haversine_km(float(source_coords[1]), float(source_coords[0]), float(destination_coords[1]), float(destination_coords[0]))
    threshold_km = float(order.get("nearbyDeliveryThresholdKm") or warehouse.get("nearbyDeliveryThresholdKm") or 15.0)
    warehouse_address = warehouse.get("address") if isinstance(warehouse.get("address"), dict) else {}
    source_district = str(
        warehouse.get("district")
        or warehouse_address.get("district")
        or order.get("sourceDistrict")
        or order.get("farmerDistrict")
        or ""
    ).strip().casefold()
    destination_district = str(
        address.get("district")
        or (destination.get("district") if isinstance(destination, dict) else "")
        or order.get("destinationDistrict")
        or ""
    ).strip().casefold()
    route_category = classify_farmer_fulfillment_route(
        route_distance_km,
        threshold_km,
        source_district,
        destination_district,
        True,
    )
    if route_category != "nearby":
        raise HTTPException(
            status_code=409,
            detail=f"This order is not eligible for Nearby delivery (distance {route_distance_km:.1f} km; threshold {threshold_km:g} km). Use the district and distance route shown on the transfers page.",
        )
    existing_job = await delivery_job_repository.get_by_order_id(order_id)
    if existing_job:
        job_id = str(existing_job["_id"])
        await delivery_job_repository.collection.update_one(
            {"_id": existing_job["_id"], "deletedAt": None},
            {"$set": {
                "jobType": "farmer_fulfillment_nearby_delivery",
                "deliveryPickupLocation": pickup,
                "pickupLocation": pickup,
                "eligiblePartnerIds": [ObjectId(profile_id)],
                "assignedPartnerId": ObjectId(profile_id),
                "assignedPartnerUserId": ObjectId(user_id),
                "status": "open",
                "updatedAt": datetime.utcnow(),
            }},
        )
    else:
        job_doc = build_job_document(patched_order, {
            "name": pickup["name"], "address": pickup["address"],
            "lat": float(source_coords[1]), "lng": float(source_coords[0]),
        }, route_distance_km, eligible_partner_ids=[profile_id])
        job_doc.update({
            "jobType": "farmer_fulfillment_nearby_delivery",
            "deliveryPickupLocation": pickup,
            "pickupLocation": pickup,
            "eligiblePartnerIds": [ObjectId(profile_id)],
            "assignedPartnerId": ObjectId(profile_id),
            "assignedPartnerUserId": ObjectId(user_id),
            "sourceWarehouseId": ObjectId(warehouse_id),
            "status": "open",
            "singleFinalDelivery": True,
        })
        job_id = await delivery_job_repository.create_job(job_doc)
        if not job_id:
            raise HTTPException(status_code=409, detail="Could not create a delivery-partner job for this Nearby order")
    if not await order_repository.assign_delivery_partner(order_id, profile_id):
        # The marketplace job is idempotent by order; retrying can safely reuse it.
        raise HTTPException(status_code=409, detail="The delivery partner could not be assigned; refresh and retry")
    now = datetime.utcnow()
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "deliveryPartnerId": ObjectId(profile_id),
        "deliveryPartnerUserId": ObjectId(user_id),
        "deliveryResponsibility": "delivery_partner",
        "deliveryAssignedAt": now,
        "deliveryAssignedBy": ObjectId(str(current_user["_id"])),
        "deliveryPartnerJobId": ObjectId(job_id),
        "deliveryPickupLocation": pickup,
        # Persist the corrected route so this recovered single-source order
        # no longer carries the stale multi-warehouse consolidation mode.
        "logisticsMode": "farmer_to_delivery_partner",
        "farmerFulfillmentRouteType": "nearby",
        "deliveryDecisionStatus": "partner_pending",
        "partnerAssignmentOpen": False,
        "updatedAt": now,
    })
    try:
        partner = await delivery_repository.get_by_id(profile_id)
        if partner:
            user = await UserService.get_user_by_id(str(partner.get("userId") or user_id))
            if user:
                await order_repository.update_order_field(order_id, "deliveryPartnerName", f"{user.get('firstName', '')} {user.get('lastName', '')}".strip())
        await NotificationService.send_custom_notification(user_id, f"Nearby Farmer Fulfillment order {order.get('orderNumber') or order_id} is assigned to you for final delivery.", title="Final Delivery Assigned", data={"type": "farmer_fulfillment_final_delivery", "jobId": job_id, "orderId": order_id})
    except Exception:
        logger.exception("Unable to complete final delivery partner notification/enrichment")
    await order_repository.append_tracking_event(order_id, "final_delivery_partner_assigned", "Final delivery partner assigned", "The fully received Nearby order has a delivery job at the source warehouse and is assigned to one approved final-mile delivery partner.", actor_id=str(current_user["_id"]), actor_role="warehouse", metadata={"deliveryPartnerId": profile_id, "deliveryJobId": job_id, "pickupLocation": pickup})
    try:
        refreshed_order = await order_repository.get_by_id(order_id)
        if refreshed_order:
            await NotificationService.send_order_workflow_update(
                refreshed_order,
                stage="nearby_final_delivery_assigned",
                title=f"Order #{order.get('orderNumber') or order_id}: final delivery assigned",
                message="A delivery partner has been assigned and the order is ready for final-mile pickup at the source warehouse.",
                actor_role="warehouse",
                priority=NotificationPriority.HIGH,
            )
    except Exception:
        logger.exception("Unable to notify order participants after Nearby final delivery assignment")
    return {"success": True, "data": {"orderId": order_id, "deliveryPartnerId": profile_id, "deliveryJobId": job_id, "pickupLocation": pickup}, "message": "Final delivery partner and delivery job assigned"}


@router.post("/me/farmer-fulfillment/{order_id}/assign-destination-warehouse")
async def assign_farmer_fulfillment_destination_warehouse(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Choose the active warehouse serving the customer district; capacity is not a routing gate for immediate handoff."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign a destination warehouse")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    source_warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not source_warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    logistics_mode = str(order.get("logisticsMode") or "").strip().lower()
    fulfillment_method = str(order.get("fulfillmentMethod") or order.get("fulfillment_route") or "").strip().lower()

    # A legacy/wrongly assigned logisticsMode must not force a normal single
    # farmer-packed customer order into event/bulk consolidation. Consolidation
    # is reserved for an order whose packet is genuinely sourced from multiple
    # warehouses/farmers. Count distinct source identities, not item-line count:
    # one farmer can supply several lines without being a multi-warehouse order.
    allocations = order.get("warehouseAllocations") if isinstance(order.get("warehouseAllocations"), list) else []
    items = order.get("items") if isinstance(order.get("items"), list) else []
    allocation_sources = {
        str(row.get("warehouseId") or row.get("sourceWarehouseId") or "")
        for row in allocations if isinstance(row, dict)
        and (row.get("warehouseId") or row.get("sourceWarehouseId"))
    }
    item_sources = {
        str(row.get("farmerId") or row.get("sourceFarmerId") or row.get("warehouseId") or row.get("sourceWarehouseId") or "")
        for row in items if isinstance(row, dict)
        and (row.get("farmerId") or row.get("sourceFarmerId") or row.get("warehouseId") or row.get("sourceWarehouseId"))
    }
    explicit_consolidation = bool(
        order.get("requiresConsolidation")
        or order.get("consolidationRequested")
        or order.get("isEventOrder")
        or order.get("isBusinessOrder")
        or order.get("isBulkOrder")
        or str(order.get("orderType") or order.get("orderCategory") or "").strip().lower()
        in {"event", "event_order", "bulk", "bulk_order", "business", "business_order", "multi_warehouse"}
    )
    genuinely_multi_source = len(allocation_sources) > 1 or len(item_sources) > 1
    if (
        logistics_mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner"
        and genuinely_multi_source
        and explicit_consolidation
    ):
        raise HTTPException(
            status_code=409,
            detail="This is a genuine multi-source event/business/bulk order. Use Multi-Warehouse Consolidation to receive all source portions before final delivery.",
        )
    if fulfillment_method not in ("farmer", "farm_direct") and logistics_mode not in (
        "farmer_to_delivery_partner",
        "farmer_to_warehouse_to_local_hub_to_delivery_partner",
        "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
    ):
        raise HTTPException(status_code=409, detail="This order is not configured for Farmer Fulfillment")

    source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
    if source_id != str(source_warehouse["_id"]):
        raise HTTPException(status_code=403, detail="Only the assigned source warehouse can choose the destination warehouse")
    existing_destination_id = str(order.get("destinationWarehouseId") or "")

    delivery_address = order.get("deliveryAddress") if isinstance(order.get("deliveryAddress"), dict) else {}
    shipping_address = order.get("shippingAddress") if isinstance(order.get("shippingAddress"), dict) else {}

    # Old orders may only store deliveryAddressId and omit the district from
    # the embedded snapshot. Resolve the address from the authenticated
    # customer's saved addresses before rejecting destination assignment.
    customer_id = str(order.get("customerId") or "")
    delivery_address_id = str(order.get("deliveryAddressId") or order.get("shippingAddressId") or "")
    saved_customer_address = None
    if customer_id and ObjectId.is_valid(customer_id):
        if delivery_address_id and ObjectId.is_valid(delivery_address_id):
            try:
                saved_customer_address = await address_repository.get_address_by_id(
                    delivery_address_id, customer_id
                )
            except Exception:
                saved_customer_address = None
        if not saved_customer_address and not (
            delivery_address.get("district") or delivery_address.get("districtName")
            or delivery_address.get("city") or delivery_address.get("town")
            or shipping_address.get("district") or shipping_address.get("districtName")
            or shipping_address.get("city") or shipping_address.get("town")
            or order.get("destinationDistrict") or order.get("customerDistrict")
        ):
            try:
                customer_addresses = await address_repository.get_user_addresses(customer_id)
            except Exception:
                customer_addresses = []
            # Only use a default address, or the sole saved address. Never
            # arbitrarily choose among multiple non-default addresses.
            saved_customer_address = next(
                (item for item in customer_addresses if item.get("isDefault") or item.get("is_default")),
                None,
            )
            if not saved_customer_address and len(customer_addresses) == 1:
                saved_customer_address = customer_addresses[0]

    if saved_customer_address:
        delivery_address = {
            **saved_customer_address,
            **delivery_address,
            "district": (
                delivery_address.get("district") or delivery_address.get("districtName")
                or delivery_address.get("district_name")
                or saved_customer_address.get("district") or saved_customer_address.get("districtName")
                or saved_customer_address.get("district_name")
                or saved_customer_address.get("city") or saved_customer_address.get("town")
                or saved_customer_address.get("municipality") or ""
            ),
            "city": (
                delivery_address.get("city") or saved_customer_address.get("city")
                or saved_customer_address.get("town") or saved_customer_address.get("municipality") or ""
            ),
            "state": delivery_address.get("state") or saved_customer_address.get("state") or "",
            "location": delivery_address.get("location") or saved_customer_address.get("location"),
        }

    customer_location = (
        delivery_address.get("location")
        or shipping_address.get("location")
        or order.get("customerLocation")
        or delivery_address
        or shipping_address
    )
    delivery_location = delivery_address.get("location") if isinstance(delivery_address.get("location"), dict) else {}
    shipping_location = shipping_address.get("location") if isinstance(shipping_address.get("location"), dict) else {}
    nested_delivery_address = delivery_address.get("address") if isinstance(delivery_address.get("address"), dict) else {}
    nested_shipping_address = shipping_address.get("address") if isinstance(shipping_address.get("address"), dict) else {}
    customer_district = str(
        delivery_address.get("district")
        or delivery_address.get("districtName")
        or delivery_address.get("district_name")
        or delivery_address.get("city")
        or delivery_address.get("town")
        or delivery_address.get("municipality")
        or delivery_location.get("district")
        or delivery_location.get("districtName")
        or delivery_location.get("district_name")
        or delivery_location.get("city")
        or nested_delivery_address.get("district")
        or nested_delivery_address.get("districtName")
        or nested_delivery_address.get("district_name")
        or nested_delivery_address.get("city")
        or nested_delivery_address.get("town")
        or shipping_address.get("district")
        or shipping_address.get("districtName")
        or shipping_address.get("district_name")
        or shipping_address.get("city")
        or shipping_address.get("town")
        or shipping_location.get("district")
        or shipping_location.get("districtName")
        or shipping_location.get("district_name")
        or shipping_location.get("city")
        or nested_shipping_address.get("district")
        or nested_shipping_address.get("districtName")
        or nested_shipping_address.get("district_name")
        or nested_shipping_address.get("city")
        or nested_shipping_address.get("town")
        or order.get("destinationDistrict")
        or order.get("customerDistrict")
        or order.get("deliveryCity")
        or ""
    ).strip().casefold()
    source_address_value = source_warehouse.get("address")
    source_address = source_address_value if isinstance(source_address_value, dict) else {}
    source_location_value = source_warehouse.get("location")
    source_location = source_location_value if isinstance(source_location_value, dict) else {}
    nested_source_address = source_address.get("address") if isinstance(source_address.get("address"), dict) else {}
    nested_source_location = source_location.get("address") if isinstance(source_location.get("address"), dict) else {}
    # Warehouse profiles created by older UI versions may save the physical
    # district under different address/location keys. Resolve the source from
    # its physical address first; do not use a destination warehouse's district
    # or the customer's district as a substitute.
    source_service_areas = source_warehouse.get("serviceAreas") or source_warehouse.get("service_areas") or []
    if isinstance(source_service_areas, str):
        source_service_areas = [source_service_areas]
    if not isinstance(source_service_areas, list):
        source_service_areas = []
    source_service_areas = [
        str(value).strip() for value in source_service_areas
        if isinstance(value, (str, int, float)) and str(value).strip()
    ]
    # A single configured service area is a safe legacy fallback only when the
    # warehouse has no physical district value at all. Multiple service areas
    # describe coverage, not the warehouse's actual district, so they are not
    # used to infer its origin.
    source_district = str(
        source_warehouse.get("district")
        or source_warehouse.get("districtName")
        or source_warehouse.get("district_name")
        or source_warehouse.get("city")
        or source_warehouse.get("cityName")
        or source_warehouse.get("city_name")
        or source_address.get("district")
        or source_address.get("districtName")
        or source_address.get("district_name")
        or source_address.get("city")
        or source_address.get("cityName")
        or source_address.get("city_name")
        or source_address.get("town")
        or source_address.get("municipality")
        or source_location.get("district")
        or source_location.get("districtName")
        or source_location.get("district_name")
        or source_location.get("city")
        or source_location.get("cityName")
        or source_location.get("city_name")
        or nested_source_address.get("district")
        or nested_source_address.get("districtName")
        or nested_source_address.get("district_name")
        or nested_source_address.get("city")
        or nested_source_address.get("cityName")
        or nested_source_address.get("city_name")
        or nested_source_location.get("district")
        or nested_source_location.get("districtName")
        or nested_source_location.get("district_name")
        or nested_source_location.get("city")
        or nested_source_location.get("cityName")
        or nested_source_location.get("city_name")
        or order.get("sourceDistrict")
        or order.get("sourceWarehouseDistrict")
        or order.get("warehouseDistrict")
        or order.get("farmerDistrict")
        or (source_service_areas[0] if len(source_service_areas) == 1 else "")
        or ""
    ).strip().casefold()
    farmer_id = str(order.get("farmerId") or "")
    if not source_district and farmer_id and ObjectId.is_valid(farmer_id):
        farmer_profile = await farmer_repository.get_by_id(farmer_id)
        if farmer_profile:
            farm_address_value = farmer_profile.get("farmAddress") or farmer_profile.get("address")
            farm_address = farm_address_value if isinstance(farm_address_value, dict) else {}
            farm_location_value = farmer_profile.get("farmLocation") or farmer_profile.get("location")
            farm_location = farm_location_value if isinstance(farm_location_value, dict) else {}
            source_district = str(
                farmer_profile.get("district")
                or farmer_profile.get("farmDistrict")
                or farmer_profile.get("districtName")
                or farmer_profile.get("city")
                or farmer_profile.get("farmCity")
                or farm_address.get("district")
                or farm_address.get("districtName")
                or farm_address.get("city")
                or farm_address.get("town")
                or farm_location.get("district")
                or farm_location.get("districtName")
                or farm_location.get("city")
                or farm_location.get("town")
                or ""
            ).strip().casefold()
    source_location = (
        source_warehouse.get("location")
        or source_warehouse.get("coordinates")
        or source_address.get("location")
        or source_address.get("coordinates")
        or source_address
    )
    route_distance = distance_km(source_location, customer_location) if isinstance(source_location, dict) and isinstance(customer_location, dict) else None
    nearby_threshold = float(order.get("nearbyDeliveryThresholdKm") or source_warehouse.get("nearbyDeliveryThresholdKm") or 15.0)
    delivery_modes = {
        str(order.get("logisticsMode") or "").strip().lower(),
        str(order.get("deliveryMode") or "").strip().lower(),
        str(order.get("fulfillmentMode") or "").strip().lower(),
        str(order.get("deliveryRoute") or "").strip().lower(),
    }
    direct_delivery_configured = (
        "farmer_to_delivery_partner" in delivery_modes
        or bool(delivery_modes.intersection({"direct", "direct_delivery", "warehouse_to_customer", "warehouse_to_customer_direct"}))
    )
    if not source_district or not customer_district:
        missing = []
        if not source_district:
            missing.append("source warehouse district (set the warehouse's physical district/city in its address or location)")
        if not customer_district:
            missing.append("customer delivery district")
        raise HTTPException(
            status_code=409,
            detail="Cannot assign an inter-district destination because " + " and ".join(missing) + " is missing. Save the missing district, then retry; creating a destination warehouse does not fill the source warehouse's district.",
        )
    if source_district == customer_district:
        raise HTTPException(status_code=409, detail="This order belongs in Same-District routing, not Inter-District routing")
    if route_distance is not None and route_distance <= nearby_threshold and direct_delivery_configured:
        raise HTTPException(status_code=409, detail=f"This order is within the {nearby_threshold:g} km Nearby threshold; use Nearby delivery instead")
    if existing_destination_id:
        if existing_destination_id == source_id:
            raise HTTPException(status_code=409, detail="Destination warehouse must be different from the source warehouse")
        if logistics_mode != "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
            await order_repository.update({"_id": ObjectId(order_id)}, {
                "logisticsMode": "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
                "updatedAt": datetime.utcnow(),
            })
        return {
            "success": True,
            "data": {
                "destinationWarehouseId": existing_destination_id,
                "destinationWarehouseName": order.get("destinationWarehouseName"),
                "destinationDistrict": order.get("destinationDistrict"),
                "destinationWarehouseDistrict": order.get("destinationWarehouseDistrict"),
                "destinationWarehouseRegionalFallback": bool(order.get("destinationWarehouseRegionalFallback")),
                "destinationWarehouseCapacityOverrideRequired": bool(order.get("destinationWarehouseCapacityOverrideRequired")),
                "alreadyAssigned": True,
            },
            "message": "A destination warehouse is already assigned.",
        }
    # Farmer-packed products are handed over for immediate onward delivery.
    # Choose the destination by customer district, not inventory/storage capacity.
    required_capacity = 0.0
    destination = await warehouse_for_district(
        customer_district,
        required_capacity=0.0,
        exclude_warehouse_id=source_id,
        allow_capacity_override=False,
    )
    if not destination:
        raise HTTPException(
            status_code=409,
            detail="No active destination warehouse other than the source warehouse is available. Add or activate the warehouse serving the customer district; a warehouse with a capacity shortfall can be assigned with explicit confirmation.",
        )
    destination_id = str(destination["_id"])
    destination_address = destination.get("address") if isinstance(destination.get("address"), dict) else {}
    destination_location = destination.get("location") if isinstance(destination.get("location"), dict) else {}
    destination_warehouse_district = str(
        destination.get("district")
        or destination.get("city")
        or destination_address.get("district")
        or destination_address.get("city")
        or destination_location.get("district")
        or destination_location.get("city")
        or ""
    ).strip()
    regional_fallback = bool(destination.get("_districtFallback"))
    # Capacity is intentionally not checked for immediate Farmer Fulfillment transfers.
    capacity_override_required = False
    available_capacity = destination.get("_availableCapacity")
    capacity_message = ""
    now = datetime.utcnow()
    destination_name = destination.get("name") or destination.get("warehouseName") or "Destination Warehouse"
    destination_location = destination.get("location") or destination.get("coordinates")
    resolved_destination_district = (
        destination.get("district") or destination_address.get("district")
        or customer_district
    )
    source_name = source_warehouse.get("name") or source_warehouse.get("warehouseName") or "Source Warehouse"
    source_location_value = source_warehouse.get("location") or source_warehouse.get("coordinates")
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "sourceWarehouseId": ObjectId(source_id),
        "warehouseId": ObjectId(source_id),
        "sourceWarehouseName": source_name,
        "sourceWarehouseLocation": source_location_value,
        "sourceDistrict": source_district,
        "destinationWarehouseId": ObjectId(destination_id),
        "destinationWarehouseName": destination_name,
        "destinationWarehouseLocation": destination_location,
        "destinationDistrict": customer_district,
        "destinationWarehouseDistrict": destination_warehouse_district or None,
        "destinationWarehouseRegionalFallback": regional_fallback,
        "destinationWarehouseCapacityOverrideRequired": capacity_override_required,
        "destinationWarehouseAvailableCapacity": available_capacity,
        "destinationWarehouseRequiredCapacity": required_capacity,
        "destinationWarehouseCapacityOverrideConfirmed": False,
        "destinationWarehouseAssignedAt": now,
        "destinationWarehouseAssignedBy": ObjectId(str(current_user["_id"])),
        "logisticsMode": "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
        "transferStatus": "destination_warehouse_assignment_confirmed",
        "warehouseFulfillmentStage": "destination_warehouse_assignment_confirmed",
        "updatedAt": now,
    })

    # Keep every operational record aligned with the authoritative order route.
    # Incoming stock represents the physical receipt at the source; its warehouse
    # must remain the source while its next destination is recorded separately.
    incoming_collection = MongoDB.get_collection("incoming_stock")
    await incoming_collection.update_many(
        {"orderId": {"$in": [ObjectId(order_id), order_id]}, "deletedAt": None},
        {"$set": {
            "sourceWarehouseId": ObjectId(source_id),
            "sourceWarehouseName": source_name,
            "destinationWarehouseId": ObjectId(destination_id),
            "destinationWarehouseName": destination_name,
            "destinationDistrict": resolved_destination_district,
            "updatedAt": now,
        }},
    )
    collection_jobs = MongoDB.get_collection("warehouse_collections")
    await collection_jobs.update_many(
        {"orderId": {"$in": [ObjectId(order_id), order_id]}, "deletedAt": None},
        {"$set": {
            "sourceWarehouseId": ObjectId(source_id),
            "sourceWarehouseName": source_name,
            "destinationWarehouseId": ObjectId(destination_id),
            "destinationWarehouseName": destination_name,
            "destinationDistrict": resolved_destination_district,
            "updatedAt": now,
        }},
    )
    # If a manifest already exists (e.g. after a retry), repair its route fields
    # rather than leaving a stale destination on the transfer record.
    legs_collection = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    await legs_collection.update_many(
        {"orderId": ObjectId(order_id), "legType": "warehouse_to_destination_warehouse", "deletedAt": None},
        {"$set": {
            "sourceWarehouseId": ObjectId(source_id),
            "sourceWarehouseName": source_name,
            "destinationWarehouseId": ObjectId(destination_id),
            "destinationWarehouseName": destination_name,
            "updatedAt": now,
        }},
    )
    await order_repository.append_tracking_event(
        order_id,
        "destination_warehouse_assigned",
        "Destination warehouse assigned",
        (
            f"{destination.get('name') or destination.get('warehouseName') or 'Destination Warehouse'} was selected from the customer delivery district"
            + (" as a regional fallback because no active warehouse serves that district." if regional_fallback else " for immediate handoff and onward delivery.")
        ),
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={
            "sourceWarehouseId": source_id,
            "destinationWarehouseId": destination_id,
            "customerDistrict": customer_district,
            "destinationWarehouseDistrict": destination_warehouse_district or None,
            "regionalFallback": regional_fallback,
            "capacityOverrideRequired": capacity_override_required,
            "availableCapacity": available_capacity,
            "requiredCapacity": required_capacity,
        },
    )
    return {
        "success": True,
        "data": {
            "destinationWarehouseId": destination_id,
            "destinationWarehouseName": destination.get("name") or destination.get("warehouseName") or "Destination Warehouse",
            "destinationDistrict": customer_district,
            "destinationWarehouseDistrict": destination_warehouse_district or None,
            "destinationWarehouseRegionalFallback": regional_fallback,
            "destinationWarehouseCapacityOverrideRequired": capacity_override_required,
            "destinationWarehouseAvailableCapacity": available_capacity,
            "destinationWarehouseRequiredCapacity": required_capacity,
            "alreadyAssigned": False,
        },
        "message": (
            "A regional destination warehouse was assigned from the customer delivery district for immediate handoff."
            if regional_fallback
            else "Destination warehouse assigned from the customer delivery district. Proceed with transfer-team assignment and dispatch."
        ),
    }


@router.post("/me/farmer-fulfillment/{order_id}/dispatch-to-destination")
async def dispatch_farmer_fulfillment_to_destination(
    order_id: str,
    capacityOverrideConfirmed: bool = Query(False),
    current_user: dict = Depends(get_current_user),
):
    """Dispatch a sealed farmer-packed order from source to destination warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can dispatch farmer fulfillment transfers")
    _enforce_warehouse_operating_window("downstream_transfer")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    if str(order.get("logisticsMode") or "") != "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Inter-district farmer fulfillment order not found")
    source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
    destination_id = str(order.get("destinationWarehouseId") or "")
    warehouse_id = str(warehouse["_id"])
    if not destination_id or source_id == destination_id:
        raise HTTPException(status_code=400, detail="A different destination warehouse must be assigned before dispatch")
    if warehouse_id != source_id:
        raise HTTPException(status_code=403, detail="Only the assigned source warehouse can dispatch this order")
    # No capacity confirmation is required for immediate Farmer Fulfillment handoff.
    legs = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    leg = await legs.find_one({
        "orderId": ObjectId(order_id),
        "legType": "warehouse_to_destination_warehouse",
        "sourceWarehouseId": ObjectId(source_id),
        "destinationWarehouseId": ObjectId(destination_id),
        "deletedAt": None,
    })
    if leg and str(leg.get("status") or "") in ("awaiting_team_assignment", "assigned", "in_transit", "arrived_at_destination", "received_at_destination"):
        return {"success": True, "data": {"orderId": order_id, "status": leg["status"]}, "message": "This destination transfer already has a manifest."}
    now = datetime.utcnow()
    if leg:
        await legs.update_one({"_id": leg["_id"]}, {"$set": {
            "status": "awaiting_team_assignment", "dispatchedAt": now,
            "dispatchedBy": ObjectId(str(current_user["_id"])), "updatedAt": now,
        }})
    else:
        await legs.insert_one({
            "orderId": ObjectId(order_id),
            "orderNumber": order.get("orderNumber"),
            "legType": "warehouse_to_destination_warehouse",
            "sourceWarehouseId": ObjectId(source_id),
            "sourceWarehouseName": order.get("sourceWarehouseName") or order.get("warehouseName") or warehouse.get("name"),
            "destinationWarehouseId": ObjectId(destination_id),
            "destinationWarehouseName": order.get("destinationWarehouseName"),
            "quantity": sum(float(
                row.get("quantityReceived")
                or row.get("receivedQuantity")
                or row.get("actualQuantityReceived")
                or row.get("receivedQty")
                or row.get("quantity")
                or row.get("expectedQuantity")
                or 0
            ) for row in incoming),
            "status": "awaiting_team_assignment",
            "dispatchedAt": now,
            "dispatchedBy": ObjectId(str(current_user["_id"])),
            "createdAt": now, "updatedAt": now, "deletedAt": None,
        })
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "transferStatus": "destination_warehouse_transfer_pending",
        "warehouseFulfillmentStage": "destination_warehouse_transfer_pending",
        "updatedAt": now,
    })
    await order_repository.append_tracking_event(
        order_id, "warehouse_transfer_dispatched", "Order dispatched to destination warehouse",
        "The sealed farmer-packed customer order has left the source warehouse for the assigned destination warehouse.",
        actor_id=str(current_user["_id"]), actor_role="warehouse",
        metadata={"sourceWarehouseId": source_id, "destinationWarehouseId": destination_id},
    )
    return {"success": True, "data": {"orderId": order_id, "status": "awaiting_team_assignment", "destinationWarehouseId": destination_id}, "message": "Transfer manifest created. Assign an approved pickup team before the partner can start the route."}


@router.put("/me/farmer-fulfillment/{order_id}/assign-destination-pickup-team")
async def assign_farmer_fulfillment_destination_pickup_team(
    order_id: str,
    deliveryPartnerId: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """Assign an approved source-warehouse pickup team to the inter-district leg."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign transfer teams")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
    if str(warehouse["_id"]) != source_id:
        raise HTTPException(status_code=403, detail="Only the source warehouse can assign the destination transfer team")
    if str(order.get("logisticsMode") or "") != "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=400, detail="This order does not use an inter-district transfer")
    members = await warehouse_pickup_team_repository.get_approved_members(source_id)
    member = next((m for m in members if str(m.get("deliveryPartnerId") or "") == deliveryPartnerId), None)
    if not member:
        raise HTTPException(status_code=400, detail="Select an approved pickup team assigned to the source warehouse")
    profile_id = str(member.get("deliveryPartnerId") or "")
    user_id = str(member.get("userId") or member.get("deliveryPartnerUserId") or "")
    if not ObjectId.is_valid(profile_id) or not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="The selected team is missing a valid partner profile or user account")
    legs = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    leg = await legs.find_one({"orderId": ObjectId(order_id), "legType": "warehouse_to_destination_warehouse", "sourceWarehouseId": ObjectId(source_id), "deletedAt": None})
    if not leg:
        raise HTTPException(status_code=409, detail="Dispatch the sealed order to create the transfer manifest first")
    if str(leg.get("status") or "") not in ("awaiting_team_assignment", "assigned"):
        raise HTTPException(status_code=409, detail="The transfer has already started or arrived")
    required_capacity = float(leg.get("quantity") or 0)
    team_capacity = float(member.get("capacity") or member.get("vehicleCapacity") or 0)
    if required_capacity <= 0:
        raise HTTPException(status_code=400, detail="Transfer quantity is missing; cannot validate vehicle capacity")
    if team_capacity < required_capacity:
        raise HTTPException(status_code=400, detail=f"Selected vehicle capacity ({team_capacity:g} kg) is below the shipment quantity ({required_capacity:g} kg)")
    if leg.get("assignedDeliveryPartnerId") and str(leg.get("assignedDeliveryPartnerId")) != profile_id:
        raise HTTPException(status_code=409, detail="A team is already assigned to this transfer")
    now = datetime.utcnow()
    assignment_result = await legs.update_one({"_id": leg["_id"], "status": {"$in": ["awaiting_team_assignment", "assigned"]}}, {"$set": {
        "status": "assigned", "assignedDeliveryPartnerId": ObjectId(profile_id),
        "assignedPartnerUserId": ObjectId(user_id), "assignedBy": ObjectId(str(current_user["_id"])),
        "assignedAt": now, "updatedAt": now,
    }})
    if not assignment_result.modified_count and str(leg.get("status") or "") != "assigned":
        raise HTTPException(status_code=409, detail="Transfer assignment changed. Refresh and try again.")
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "transferStatus": "destination_warehouse_in_transit",
        "warehouseFulfillmentStage": "destination_warehouse_transfer_pending",
        "updatedAt": now,
    })
    try:
        await NotificationService.send_custom_notification(user_id, f"Inter-district transfer for order {order.get('orderNumber') or order_id} is assigned to you. Start the route and confirm arrival at the destination warehouse.", title="Warehouse Transfer Assigned", data={"type": "farmer_fulfillment_warehouse_transfer", "orderId": order_id})
    except Exception:
        logger.exception("Unable to notify partner about inter-district transfer")
    return {"success": True, "data": {"orderId": order_id, "status": "assigned", "deliveryPartnerId": profile_id}, "message": "Approved pickup team assigned to destination transfer"}


@router.post("/me/farmer-fulfillment/{order_id}/receive-at-destination")
async def receive_farmer_fulfillment_at_destination(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Record physical receipt of a sealed order at its destination warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can receive farmer fulfillment transfers")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    if str(order.get("logisticsMode") or "") != "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Inter-district farmer fulfillment order not found")
    destination_id = str(order.get("destinationWarehouseId") or "")
    warehouse_id = str(warehouse["_id"])
    if not destination_id or warehouse_id != destination_id:
        raise HTTPException(status_code=403, detail="Only the assigned destination warehouse can confirm receipt")
    legs = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    leg = await legs.find_one({
        "orderId": ObjectId(order_id),
        "legType": "warehouse_to_destination_warehouse",
        "destinationWarehouseId": ObjectId(warehouse_id),
        "deletedAt": None,
    })
    if not leg:
        raise HTTPException(status_code=404, detail="No source-to-destination transfer manifest exists")
    if str(leg.get("status") or "") == "received_at_destination":
        return {"success": True, "data": {"orderId": order_id, "status": "received_at_destination"}, "message": "Destination warehouse receipt was already confirmed."}
    if str(leg.get("status") or "") != "arrived_at_destination":
        raise HTTPException(status_code=400, detail="The assigned transfer partner must record arrival before warehouse receipt")
    now = datetime.utcnow()
    await legs.update_one({"_id": leg["_id"], "status": "arrived_at_destination"}, {"$set": {
        "status": "received_at_destination", "receivedAtDestination": now,
        "receivedByDestination": ObjectId(str(current_user["_id"])), "updatedAt": now,
    }})
    source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
    destination_name = warehouse.get("name") or warehouse.get("warehouseName") or order.get("destinationWarehouseName") or "Destination Warehouse"
    destination_location = warehouse.get("location") or warehouse.get("coordinates")
    await order_repository.update({"_id": ObjectId(order_id)}, {
        # Preserve the original source references for audit while recording the
        # current physical custodian separately.
        "sourceWarehouseId": ObjectId(source_id) if ObjectId.is_valid(source_id) else source_id,
        "sourceWarehouseName": order.get("sourceWarehouseName") or order.get("warehouseName"),
        "destinationWarehouseId": ObjectId(warehouse_id),
        "destinationWarehouseName": destination_name,
        "destinationWarehouseLocation": destination_location,
        "currentWarehouseId": ObjectId(warehouse_id),
        "currentWarehouseName": destination_name,
        "currentWarehouseRole": "destination",
        "destinationWarehouseReceivedAt": now,
        "destinationWarehouseReceivedBy": ObjectId(str(current_user["_id"])),
        "transferStatus": "destination_warehouse_received",
        "warehouseFulfillmentStage": "destination_warehouse_received",
        "updatedAt": now,
    })
    # Mirror the confirmed handover on operational rows so Incoming Stock and
    # the transfers page agree on where the sealed packet currently resides.
    for collection_name in ("incoming_stock", "warehouse_collections"):
        operational_collection = MongoDB.get_collection(collection_name)
        await operational_collection.update_many(
            {"orderId": {"$in": [ObjectId(order_id), order_id]}, "deletedAt": None},
            {"$set": {
                "sourceWarehouseId": ObjectId(source_id) if ObjectId.is_valid(source_id) else source_id,
                "destinationWarehouseId": ObjectId(warehouse_id),
                "destinationWarehouseName": destination_name,
                "currentWarehouseId": ObjectId(warehouse_id),
                "currentWarehouseName": destination_name,
                "currentWarehouseRole": "destination",
                "destinationWarehouseReceivedAt": now,
                "updatedAt": now,
            }},
        )
    await order_repository.append_tracking_event(
        order_id, "destination_warehouse_received", "Order received at destination warehouse",
        "The destination warehouse confirmed physical receipt of the sealed farmer-packed order.",
        actor_id=str(current_user["_id"]), actor_role="warehouse",
        metadata={"destinationWarehouseId": warehouse_id, "sourceWarehouseId": str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")},
    )
    try:
        refreshed_order = await order_repository.get_by_id(order_id)
        if refreshed_order:
            await NotificationService.send_order_workflow_update(
                refreshed_order,
                stage="destination_warehouse_received",
                status="transfer_received",
                title=f"Order #{order.get('orderNumber') or order_id}: destination warehouse received",
                message="The destination warehouse confirmed physical receipt. Continue with the local-hub transfer workflow.",
                actor_role="warehouse",
                priority=NotificationPriority.HIGH,
            )
    except Exception:
        logger.exception("Failed to notify order participants after destination warehouse receipt")
    return {"success": True, "data": {"orderId": order_id, "status": "received_at_destination"}, "message": "Destination warehouse receipt recorded."}


@router.post("/me/farmer-fulfillment/{order_id}/dispatch-to-consolidation")
async def dispatch_farmer_fulfillment_to_consolidation(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Dispatch one received/stored farmer-packed portion from its source warehouse to the consolidation warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can dispatch farmer fulfillment transfers")
    _enforce_warehouse_operating_window("downstream_transfer")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    if str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Multi-warehouse farmer fulfillment order not found")
    wid = str(warehouse["_id"])
    allocations = [a for a in (order.get("warehouseAllocations") or []) if str(a.get("warehouseId")) == wid]
    if not allocations:
        raise HTTPException(status_code=403, detail="This order has no allocation at your warehouse")
    legs = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    # A source warehouse may dispatch only after its own incoming records have
    # been physically received, quality-approved and stored.
    source_incoming = await incoming_stock_repository.find_many({
        "orderId": ObjectId(order_id),
        "warehouseId": ObjectId(wid),
        "sourceMode": "farmer_fulfillment_transfer",
        "deletedAt": None,
    }, skip=0, limit=1000)
    if not source_incoming:
        raise HTTPException(status_code=400, detail="Record the physical receipt of this farmer-packed portion in Incoming Stock before dispatching it to consolidation")
    # Packed Farmer Fulfillment shipments must remain sealed and are explicitly
    # excluded from bulk inventory storage. A confirmed physical receipt is
    # sufficient; requiring status='stored' would make this workflow impossible
    # because the Incoming Stock API correctly blocks storing packed orders.
    not_physically_received = [
        row for row in source_incoming
        if str(row.get("status") or "").strip().lower() not in ("received", "stored")
        or not row.get("arrivedWarehouseAt")
    ]
    if not_physically_received:
        raise HTTPException(status_code=400, detail="Complete Farm Collection arrival and confirm physical receipt for every packed portion before consolidation dispatch")

    required_by_product = {}
    for allocation in allocations:
        key = (str(allocation.get("productId") or ""), str(allocation.get("variantId") or ""))
        required_by_product[key] = required_by_product.get(key, 0.0) + float(allocation.get("quantity") or 0)
    received_by_product = {}
    for row in source_incoming:
        key = (str(row.get("productId") or ""), str(row.get("variantId") or ""))
        quantity_received = row.get("quantityReceived")
        if quantity_received is None:
            quantity_received = row.get("receivedQuantity")
        if quantity_received is None:
            quantity_received = row.get("actualQuantityReceived")
        received_by_product[key] = received_by_product.get(key, 0.0) + float(quantity_received or 0)
    shortages = [
        {"productId": key[0], "variantId": key[1] or None, "required": quantity, "received": received_by_product.get(key, 0.0)}
        for key, quantity in required_by_product.items()
        if received_by_product.get(key, 0.0) + 1e-9 < quantity
    ]
    if shortages:
        raise HTTPException(status_code=409, detail={"message": "Received quantity is below the source allocation; resolve the discrepancy before dispatch", "shortages": shortages})
    source_legs = await legs.find({
        "orderId": ObjectId(order_id),
        "sourceWarehouseId": ObjectId(wid),
        "legType": "warehouse_to_consolidation",
        "deletedAt": None,
    }).to_list(length=1000)

    # Bootstrap the consolidation manifest from the persisted allocations when
    # an order was routed to multi-warehouse fulfillment but no transfer legs
    # were created by the earlier routing step. This is idempotent: once a leg
    # exists for this source allocation, retries reuse it rather than duplicate it.
    # Validate the destination before creating any consolidation documents.
    # Without this guard ObjectId("None") could raise and leave the order half-initialized.
    consolidation_warehouse_id = str(order.get("consolidationWarehouseId") or "")
    if not ObjectId.is_valid(consolidation_warehouse_id):
        raise HTTPException(status_code=400, detail="Assign a valid consolidation destination warehouse before dispatch")
    destination_warehouse = await warehouse_repository.get_by_id(consolidation_warehouse_id)
    if not destination_warehouse:
        raise HTTPException(status_code=404, detail="The assigned consolidation destination warehouse was not found")

    consolidation_id = order.get("consolidationId")
    if isinstance(consolidation_id, str) and ObjectId.is_valid(consolidation_id):
        consolidation_id = ObjectId(consolidation_id)
    consolidation_collection = MongoDB.get_collection("farmer_fulfillment_consolidations")
    consolidation = (
        await consolidation_collection.find_one({"_id": consolidation_id, "deletedAt": None})
        if consolidation_id else None
    )
    if not consolidation:
        consolidation = await consolidation_collection.find_one({
            "orderId": ObjectId(order_id),
            "deletedAt": None,
        })
    if not consolidation:
        now = datetime.utcnow()
        inserted = await consolidation_collection.insert_one({
            "orderId": ObjectId(order_id),
            "orderNumber": order.get("orderNumber"),
            "status": str(order.get("consolidationStatus") or "collecting"),
            "consolidationWarehouseId": ObjectId(consolidation_warehouse_id),
            "warehouseIds": [ObjectId(str(x)) for x in (order.get("warehouseIds") or []) if ObjectId.is_valid(str(x))],
            "warehouseCount": int(order.get("warehouseCount") or len(order.get("warehouseIds") or [])),
            "createdAt": now,
            "updatedAt": now,
            "deletedAt": None,
        })
        consolidation_id = inserted.inserted_id
        consolidation = await consolidation_collection.find_one({"_id": consolidation_id})
    else:
        consolidation_id = consolidation.get("_id")

    # Destination validity was checked before writing the consolidation record above.
    # Build the complete expected manifest for every source allocation at
    # once. If we only created the first warehouse's legs, the destination
    # could incorrectly think consolidation is complete before other farms
    # have dispatched. Existing legs are retained so retries are safe.
    all_allocations = order.get("warehouseAllocations") or []
    existing_all_legs = await legs.find({
        "orderId": ObjectId(order_id),
        "legType": "warehouse_to_consolidation",
        "deletedAt": None,
    }).to_list(length=2000)
    existing_keys = {
        (
            str(x.get("sourceWarehouseId") or ""),
            str(x.get("productId") or ""),
            str(x.get("variantId") or ""),
        )
        for x in existing_all_legs
    }
    now = datetime.utcnow()
    for allocation in all_allocations:
        allocation_source_id = str(allocation.get("warehouseId") or "")
        quantity = float(allocation.get("quantity") or 0)
        if not ObjectId.is_valid(allocation_source_id) or quantity <= 0:
            raise HTTPException(status_code=400, detail="Every source allocation needs a valid warehouse and positive quantity")
        product_id = str(allocation.get("productId") or "")
        variant_id = str(allocation.get("variantId") or "")
        key = (allocation_source_id, product_id, variant_id)
        if key in existing_keys:
            continue
        source_warehouse = await warehouse_repository.get_by_id(allocation_source_id)
        leg_doc = {
            "orderId": ObjectId(order_id),
            "orderNumber": order.get("orderNumber"),
            "legType": "warehouse_to_consolidation",
            "sourceWarehouseId": ObjectId(allocation_source_id),
            "sourceWarehouseName": (source_warehouse or {}).get("name") or (source_warehouse or {}).get("warehouseName") or allocation.get("warehouseName"),
            "destinationWarehouseId": ObjectId(str(order["consolidationWarehouseId"])),
            "destinationWarehouseName": order.get("consolidationWarehouseName"),
            "productId": ObjectId(product_id) if ObjectId.is_valid(product_id) else allocation.get("productId"),
            "variantId": allocation.get("variantId"),
            "quantity": quantity,
            "status": "pending",
            "createdAt": now,
            "updatedAt": now,
            "deletedAt": None,
        }
        inserted_leg = await legs.insert_one(leg_doc)
        leg_doc["_id"] = inserted_leg.inserted_id
        existing_all_legs.append(leg_doc)
        existing_keys.add(key)
    source_legs = [
        x for x in existing_all_legs
        if str(x.get("sourceWarehouseId") or "") == wid
    ]

    await order_repository.update({"_id": ObjectId(order_id)}, {
        "consolidationId": consolidation_id,
        "consolidationStatus": order.get("consolidationStatus") or "collecting",
        "updatedAt": datetime.utcnow(),
    })

    invalid = [x for x in source_legs if str(x.get("status")) not in ("pending", "stored", "received_at_source")]
    if invalid:
        if all(str(x.get("status")) in ("in_transit", "received_at_consolidation") for x in source_legs):
            return {"success": True, "data": {"status": "already_dispatched"}, "message": "This warehouse portion has already been dispatched to consolidation."}
        raise HTTPException(status_code=400, detail="This warehouse portion is not ready for consolidation dispatch")

    now = datetime.utcnow()
    await legs.update_many(
        {"_id": {"$in": [x["_id"] for x in source_legs]}},
        {"$set": {
            "status": "in_transit",
            "dispatchedAt": now,
            "dispatchedBy": ObjectId(str(current_user["_id"])),
            "updatedAt": now,
        }},
    )

    consolidation_id = order.get("consolidationWarehouseId")
    consolidation_manager_id = None
    if consolidation_id:
        consolidation = await warehouse_repository.get_by_id(str(consolidation_id))
        if consolidation and consolidation.get("managerId"):
            consolidation_manager_id = str(consolidation["managerId"])

    await order_repository.append_tracking_event(
        order_id,
        "warehouse_portion_dispatched_to_consolidation",
        "Warehouse portion dispatched to consolidation",
        f"{warehouse.get('name') or 'Warehouse'} dispatched its farmer-packed portion to the consolidation warehouse.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"sourceWarehouseId": wid, "consolidationWarehouseId": str(consolidation_id) if consolidation_id else None},
    )

    refreshed = await order_repository.get_by_id(order_id)
    if refreshed:
        recipients = [str(order.get("farmerId")) if order.get("farmerId") else None, consolidation_manager_id]
        await NotificationService.send_order_workflow_update(
            refreshed,
            stage="warehouse_portion_in_transit",
            title=f"Order #{order.get('orderNumber')}: warehouse portion dispatched",
            message=f"{warehouse.get('name') or 'A warehouse'} dispatched its portion to the consolidation warehouse.",
            actor_role="warehouse",
            priority=NotificationPriority.HIGH,
        )
        for recipient in [x for x in recipients if x and x != str(current_user["_id"])]:
            try:
                await NotificationService.create_in_app_notification(
                    recipient,
                    NotificationType.WAREHOUSE if recipient == consolidation_manager_id else NotificationType.FARMER,
                    f"Order #{order.get('orderNumber')}: portion dispatched to consolidation",
                    f"{warehouse.get('name') or 'Warehouse'} has dispatched its portion to the consolidation warehouse.",
                    {"orderId": order_id, "sourceWarehouseId": wid, "consolidationWarehouseId": str(consolidation_id) if consolidation_id else None},
                    NotificationPriority.HIGH,
                    mandatory=True,
                )
            except Exception:
                logger.exception("Failed to notify consolidation/source dispatch")

    return {
        "success": True,
        "data": {
            "orderId": order_id,
            "sourceWarehouseId": wid,
            "status": "in_transit",
            "legCount": len(source_legs),
        },
        "message": "Warehouse portion dispatched to consolidation.",
    }


@router.post("/me/farmer-fulfillment/{order_id}/receive-at-consolidation")
async def receive_farmer_fulfillment_at_consolidation(
    order_id: str,
    legIds: List[str] = Query(..., min_length=1),
    current_user: dict = Depends(get_current_user),
):
    """Receive all in-transit portions belonging to the consolidation warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can receive consolidation transfers")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    if str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Multi-warehouse farmer fulfillment order not found")
    consolidation_id = str(order.get("consolidationWarehouseId") or "")
    if str(warehouse["_id"]) != consolidation_id:
        raise HTTPException(status_code=403, detail="Only the assigned consolidation warehouse can receive these portions")

    legs = MongoDB.get_collection("farmer_fulfillment_transfer_legs")
    rows = await legs.find({
        "orderId": ObjectId(order_id),
        "destinationWarehouseId": ObjectId(str(warehouse["_id"])),
        "legType": "warehouse_to_consolidation",
        "deletedAt": None,
    }).to_list(length=1000)
    if not rows:
        raise HTTPException(status_code=404, detail="No consolidation transfer legs found")
    requested_ids = []
    for leg_id in legIds:
        if not ObjectId.is_valid(str(leg_id)):
            raise HTTPException(status_code=400, detail=f"Invalid transfer leg ID: {leg_id}")
        requested_ids.append(ObjectId(str(leg_id)))
    selected = [row for row in rows if row["_id"] in requested_ids]
    if len(selected) != len(set(str(x) for x in requested_ids)):
        raise HTTPException(status_code=404, detail="One or more selected portions do not belong to this order and destination warehouse")
    pending = [x for x in selected if str(x.get("status")) == "in_transit"]
    already_received = [x for x in selected if str(x.get("status")) == "received_at_consolidation"]
    invalid = [x for x in selected if str(x.get("status")) not in ("in_transit", "received_at_consolidation")]
    if invalid:
        raise HTTPException(status_code=409, detail="Only portions dispatched and currently in transit can be received")
    if not pending:
        return {"success": True, "data": {"status": "received", "legCount": len(already_received)}, "message": "Selected portions were already received."}

    now = datetime.utcnow()
    await legs.update_many(
        {"_id": {"$in": [x["_id"] for x in pending]}, "status": "in_transit"},
        {"$set": {
            "status": "received_at_consolidation",
            "receivedAtConsolidation": now,
            "receivedByConsolidation": ObjectId(str(current_user["_id"])),
            "updatedAt": now,
        }},
    )

    await order_repository.append_tracking_event(
        order_id,
        "consolidation_portions_received",
        "Warehouse portions received at consolidation",
        "The consolidation warehouse received the dispatched farmer-packed portions.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"receivedLegCount": len(pending), "consolidationWarehouseId": str(warehouse["_id"])},
    )
    refreshed = await order_repository.get_by_id(order_id)
    if refreshed:
        await NotificationService.send_order_workflow_update(
            refreshed,
            stage="consolidation_portions_received",
            title=f"Order #{order.get('orderNumber')}: consolidation receipt updated",
            message="The consolidation warehouse received the dispatched farmer-packed portions. Complete consolidation when every portion has arrived.",
            actor_role="warehouse",
            priority=NotificationPriority.HIGH,
        )

    return {
        "success": True,
        "data": {
            "orderId": order_id,
            "status": "received",
            "receivedLegCount": len(pending) + len(already_received),
            "totalLegCount": len(rows),
        },
        "message": "Farmer-packed portions received at the consolidation warehouse.",
    }


@router.post("/me/farmer-fulfillment/{order_id}/complete-consolidation")
async def complete_farmer_fulfillment_consolidation(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Complete consolidation only after every source warehouse has dispatched and the consolidation warehouse has received its portion."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can complete farmer fulfillment consolidation")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("logisticsMode") or "") != "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        raise HTTPException(status_code=404, detail="Multi-warehouse farmer fulfillment order not found")

    consolidation_warehouse_id = str(order.get("consolidationWarehouseId") or "")
    if str(warehouse["_id"]) != consolidation_warehouse_id:
        raise HTTPException(status_code=403, detail="Only the consolidation warehouse can complete this consolidation")

    incoming = await incoming_stock_repository.find_many({
        "orderId": ObjectId(order_id),
        "sourceMode": "farmer_fulfillment_transfer",
        "deletedAt": None,
    }, skip=0, limit=1000)

    expected = {}
    for allocation in order.get("warehouseAllocations") or []:
        key = (str(allocation.get("warehouseId")), str(allocation.get("productId")), str(allocation.get("variantId") or ""))
        expected[key] = expected.get(key, 0.0) + float(allocation.get("quantity") or 0)

    received = {}
    not_stored = []
    for row in incoming:
        key = (str(row.get("warehouseId")), str(row.get("productId")), str(row.get("variantId") or ""))
        # Farmer Fulfillment receipts are already-packed customer order portions.
        # A verified physical receipt is sufficient; do not require bulk inventory storage.
        is_packed_farmer_transfer = str(row.get("sourceMode") or "") == "farmer_fulfillment_transfer"
        acceptable_receipt_statuses = ("received", "stored") if is_packed_farmer_transfer else ("stored",)
        if str(row.get("status")) not in acceptable_receipt_statuses:
            not_stored.append(row)
            continue
        qty = row.get("quantityReceived") if is_packed_farmer_transfer else row.get("usableQuantity")
        if qty is None:
            qty = row.get("usableQuantity")
        if qty is None:
            qty = row.get("quantity")
        received[key] = received.get(key, 0.0) + max(0.0, float(qty or 0))

    missing = [
        {"warehouseId": key[0], "productId": key[1], "variantId": key[2] or None, "required": required, "stored": received.get(key, 0.0)}
        for key, required in expected.items()
        if received.get(key, 0.0) + 1e-9 < required
    ]

    legs = await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find({
        "orderId": ObjectId(order_id),
        "legType": "warehouse_to_consolidation",
        "deletedAt": None,
    }).to_list(length=1000)
    not_received_at_consolidation = [
        x for x in legs if str(x.get("status")) != "received_at_consolidation"
    ]

    if not expected or missing or not_stored or not_received_at_consolidation:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Every farmer-packed portion must be physically received with the required quantity, dispatched, and received at the consolidation warehouse before consolidation. Normal bulk inventory storage is not required for Farmer Fulfillment.",
                "missingPortions": missing,
                "unstoredReceipts": len(not_stored),
                "pendingConsolidationLegs": len(not_received_at_consolidation),
            },
        )

    consolidation_id = order.get("consolidationId")
    consolidation_collection = MongoDB.get_collection("farmer_fulfillment_consolidations")
    consolidation = await consolidation_collection.find_one({"_id": consolidation_id, "deletedAt": None}) if consolidation_id else None
    if not consolidation:
        raise HTTPException(status_code=400, detail="Consolidation record is missing")

    now = datetime.utcnow()
    await consolidation_collection.update_one(
        {"_id": consolidation["_id"]},
        {"$set": {"status": "consolidated", "consolidatedAt": now, "updatedAt": now}},
    )
    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "consolidationStatus": "consolidated",
            "transferStatus": "consolidated",
            "warehouseFulfillmentStage": "consolidated",
            "updatedAt": now,
        },
    )
    await order_repository.append_tracking_event(
        order_id,
        "farmer_fulfillment_consolidated",
        "Farmer-packed order consolidated",
        "All warehouse portions have arrived at the consolidation warehouse and the original customer order is complete.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"consolidationId": str(consolidation["_id"]), "warehouseCount": len(order.get("warehouseIds") or [])},
    )
    refreshed = await order_repository.get_by_id(order_id)
    if refreshed:
        await NotificationService.send_order_workflow_update(
            refreshed,
            stage="consolidated",
            title=f"Order #{order.get('orderNumber')}: consolidation complete",
            message="All warehouse portions have been received and consolidated. The complete order is ready for the local-hub handoff.",
            actor_role="warehouse",
            priority=NotificationPriority.HIGH,
        )
    return {
        "success": True,
        "data": {"orderId": order_id, "consolidationId": str(consolidation["_id"]), "status": "consolidated", "localHub": order.get("nearbyFulfillmentLocation")},
        "message": "All warehouse portions are consolidated into the complete customer order.",
    }


@router.post("/me/farmer-fulfillment/{order_id}/handoff-local-hub")
async def handoff_farmer_fulfillment_to_local_hub(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Move the completed consolidated order to its one local hub and open one delivery job."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can hand off farmer fulfillment")
    _enforce_warehouse_operating_window("downstream_transfer")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    order = await order_repository.get_by_id(order_id)
    mode = str((order or {}).get("logisticsMode") or "")
    allowed_modes = (
        "farmer_to_delivery_partner",
        "farmer_to_warehouse_to_local_hub_to_delivery_partner",
        "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
        "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
    )
    if not order or mode not in allowed_modes:
        raise HTTPException(status_code=404, detail="Farmer fulfillment order for local-hub transfer not found")
    warehouse_id = str(warehouse["_id"])
    if mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        if str(order.get("consolidationStatus")) != "consolidated":
            raise HTTPException(status_code=400, detail="Complete consolidation after all warehouse portions have arrived")
        if str(order.get("consolidationWarehouseId") or "") != warehouse_id:
            raise HTTPException(status_code=403, detail="Only the consolidation warehouse can hand the complete order to the local hub")
    elif mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
        if str(order.get("destinationWarehouseId") or "") != warehouse_id:
            raise HTTPException(status_code=403, detail="Only the destination warehouse can hand this order to the local hub")
        destination_leg = await MongoDB.get_collection("farmer_fulfillment_transfer_legs").find_one({
            "orderId": ObjectId(order_id), "legType": "warehouse_to_destination_warehouse",
            "destinationWarehouseId": ObjectId(warehouse_id), "status": "received_at_destination", "deletedAt": None,
        })
        if not destination_leg:
            raise HTTPException(status_code=400, detail="Confirm destination warehouse receipt before transferring to the local hub")
    else:
        source_id = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "")
        if source_id != warehouse_id:
            raise HTTPException(status_code=403, detail="Only the assigned warehouse can transfer this order to the local hub")
        # Nearby orders must use direct final-mile assignment. This local-hub
        # action is only valid when verified distance exceeds the threshold and
        # source/customer districts match.
        delivery_address = order.get("deliveryAddress") or order.get("shippingAddress") or {}
        if not isinstance(delivery_address, dict):
            delivery_address = {}
        customer_location = delivery_address.get("location") or order.get("customerLocation") or delivery_address
        source_location = warehouse.get("location") or warehouse.get("coordinates") or order.get("sourceWarehouseLocation")
        route_distance_km = distance_km(source_location, customer_location) if isinstance(customer_location, dict) and isinstance(source_location, dict) else None
        threshold_km = float(order.get("nearbyDeliveryThresholdKm") or warehouse.get("nearbyDeliveryThresholdKm") or 15.0)
        farmer_profile = None
        farmer_id = str(order.get("farmerId") or "")
        if farmer_id and ObjectId.is_valid(farmer_id):
            farmer_profile = await farmer_repository.get_by_id(farmer_id)
        source_district = str(
            order.get("sourceDistrict") or order.get("farmerDistrict")
            or warehouse.get("district")
            or ((warehouse.get("address") or {}).get("district") if isinstance(warehouse.get("address"), dict) else "")
            or (farmer_profile or {}).get("district") or (farmer_profile or {}).get("farmDistrict") or ""
        ).strip().casefold()
        destination_district = str(delivery_address.get("district") or order.get("destinationDistrict") or "").strip().casefold()
        if not source_district or not destination_district or route_distance_km is None:
            raise HTTPException(status_code=409, detail="Verified source/customer districts and coordinates are required before creating a Same-District local-hub transfer")
        if source_district != destination_district:
            raise HTTPException(status_code=409, detail="Customer is in a different district. Use Inter-District warehouse fulfillment.")
        if route_distance_km <= threshold_km:
            raise HTTPException(status_code=409, detail=f"This order is within the {threshold_km:g} km Nearby threshold. Use direct delivery only if the order is configured for it.")
        if mode != "farmer_to_warehouse_to_local_hub_to_delivery_partner":
            await order_repository.update({"_id": ObjectId(order_id)}, {
                "logisticsMode": "farmer_to_warehouse_to_local_hub_to_delivery_partner",
                "updatedAt": datetime.utcnow(),
            })
            mode = "farmer_to_warehouse_to_local_hub_to_delivery_partner"
        incoming_rows = await incoming_stock_repository.find_many({
            "orderId": ObjectId(order_id),
            "warehouseId": {"$in": [ObjectId(warehouse_id), warehouse_id]},
            "sourceMode": "farmer_fulfillment_transfer", "deletedAt": None,
        }, skip=0, limit=1000)
        if not incoming_rows or any(str(row.get("status") or "") not in ("received", "stored") for row in incoming_rows):
            raise HTTPException(status_code=400, detail="Receive the packed order at the warehouse before transferring it to the local hub")
    if str(order.get("transferStatus") or "") in ("hub_handoff_pending", "local_hub_ready"):
        existing_hub_transfer = await MongoDB.get_collection("farmer_fulfillment_hub_transfers").find_one({"orderId": ObjectId(order_id), "deletedAt": None})
        if existing_hub_transfer and str(existing_hub_transfer.get("status") or "") in ("in_transit", "received"):
            raise HTTPException(status_code=409, detail="A local-hub transfer already exists for this order")

    hub = order.get("nearbyFulfillmentLocation") or {}
    hub_id = order.get("nearbyFulfillmentLocationId") or order.get("localHubId")
    hub_collection = MongoDB.get_collection("fulfillment_hubs")
    hub_doc = None
    if hub_id and ObjectId.is_valid(str(hub_id)):
        hub_doc = await hub_collection.find_one({
            "_id": ObjectId(str(hub_id)), "deletedAt": None,
            "isActive": True, "approvalStatus": "approved",
        })
    if not hub_doc:
        delivery_address = order.get("deliveryAddress") or order.get("shippingAddress") or {}
        if not isinstance(delivery_address, dict):
            delivery_address = {}
        customer_location = delivery_address.get("location") or order.get("customerLocation") or delivery_address
        if not isinstance(customer_location, dict) or distance_km(customer_location, customer_location) is None:
            raise HTTPException(status_code=409, detail="Customer delivery coordinates are required to select an approved local hub")
        total_quantity = sum(float(item.get("quantity") or 0) for item in (order.get("items") or []))
        hub_doc = await nearest_local_hub(customer_location, total_quantity)
        if not hub_doc:
            raise HTTPException(status_code=409, detail="No active approved local hub with sufficient available capacity could be found near the customer")
        hub_id = hub_doc["_id"]
        hub = {
            "id": str(hub_doc["_id"]),
            "name": hub_doc.get("name") or hub_doc.get("hubName") or "Local Fulfillment Hub",
            "address": hub_doc.get("address") or "",
            "location": hub_doc.get("location") or hub_doc.get("coordinates") or {},
        }
        await order_repository.update({"_id": ObjectId(order_id)}, {
            "nearbyFulfillmentLocationId": ObjectId(str(hub_id)),
            "nearbyFulfillmentLocation": hub,
            "localHubId": ObjectId(str(hub_id)),
            "localHubName": hub["name"],
            "updatedAt": datetime.utcnow(),
        })
    else:
        hub_id = hub_doc["_id"]

    transfer_collection = MongoDB.get_collection("farmer_fulfillment_hub_transfers")
    existing_transfer = await transfer_collection.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
    if not existing_transfer:
        existing_transfer = {
            "orderId": ObjectId(order_id),
            "orderNumber": order.get("orderNumber"),
            "consolidationId": order.get("consolidationId"),
            "transferType": "consolidated_order_to_hub" if mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" else "farmer_order_to_hub",
            "sourceWarehouseId": ObjectId(str(warehouse["_id"])),
            "sourceWarehouseName": warehouse.get("name") or warehouse.get("warehouseName") or "Source Warehouse",
            "destinationWarehouseId": (
                ObjectId(str(order.get("destinationWarehouseId")))
                if mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner"
                and ObjectId.is_valid(str(order.get("destinationWarehouseId") or ""))
                else None
            ),
            "destinationWarehouseName": order.get("destinationWarehouseName") if mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner" else None,
            "currentWarehouseId": ObjectId(str(warehouse["_id"])),
            "currentWarehouseName": warehouse.get("name") or warehouse.get("warehouseName") or "Current Warehouse",
            "localHubId": ObjectId(str(hub_id)),
            "localHubName": hub_doc.get("name") or hub_doc.get("hubName") or "Local Fulfillment Hub",
            "quantity": sum(float(item.get("quantity") or 0) for item in (order.get("items") or [])),
            "status": "in_transit",
            "createdAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow(),
            "deletedAt": None,
        }
        inserted = await transfer_collection.insert_one(existing_transfer)
        existing_transfer["_id"] = inserted.inserted_id
    else:
        await transfer_collection.update_one(
            {"_id": existing_transfer["_id"]},
            {"$set": {
                "status": "in_transit",
                "sourceWarehouseId": ObjectId(str(warehouse["_id"])),
                "sourceWarehouseName": warehouse.get("name") or warehouse.get("warehouseName") or "Source Warehouse",
                "destinationWarehouseId": (
                    ObjectId(str(order.get("destinationWarehouseId")))
                    if mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner"
                    and ObjectId.is_valid(str(order.get("destinationWarehouseId") or ""))
                    else None
                ),
                "destinationWarehouseName": order.get("destinationWarehouseName") if mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner" else None,
                "currentWarehouseId": ObjectId(str(warehouse["_id"])),
                "currentWarehouseName": warehouse.get("name") or warehouse.get("warehouseName") or "Current Warehouse",
                "localHubId": ObjectId(str(hub_id)),
                "updatedAt": datetime.utcnow(),
            }},
        )

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "transferStatus": "hub_handoff_pending",
            **({"consolidationStatus": "hub_handoff_pending"} if mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" else {}),
            "deliveryPickupLocation": {
                "type": "local_hub",
                "id": str(hub_doc["_id"]),
                "name": hub_doc.get("name") or hub_doc.get("hubName") or "Local Fulfillment Hub",
                "address": hub_doc.get("address") or "",
                "coordinates": (hub_doc.get("location") or {}).get("coordinates") or (hub_doc.get("coordinates") or {}).get("coordinates") or [],
            },
            "updatedAt": datetime.utcnow(),
        },
    )

    # The physical hub transfer is one manifest for the complete order. The
    # delivery marketplace job is intentionally created only after the local
    # hub confirms receipt, so the partner never gets sent to an unreceived load.
    return {"success": True, "data": {"orderId": order_id, "status": "in_transit", "localHub": order.get("nearbyFulfillmentLocation")}, "message": "Complete order transferred to the local hub. Waiting for hub receipt."}


@router.post("/me/farmer-fulfillment/{order_id}/receive-local-hub")
async def receive_farmer_fulfillment_at_local_hub(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Confirm the complete order arrived at the local hub, then open exactly one final job."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can receive farmer fulfillment at the local hub")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    order = await order_repository.get_by_id(order_id)
    mode = str((order or {}).get("logisticsMode") or "")
    allowed_modes = (
        "farmer_to_warehouse_to_local_hub_to_delivery_partner",
        "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner",
        "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner",
    )
    if not order or mode not in allowed_modes:
        raise HTTPException(status_code=404, detail="Farmer fulfillment order for local-hub receipt not found")
    warehouse_id = str(warehouse["_id"])
    if str(order.get("transferStatus") or "") not in ("hub_arrived_pending_receipt", "local_hub_ready"):
        raise HTTPException(status_code=400, detail="The pickup partner must record arrival at the local hub before receipt can be confirmed")
    if mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        if str(order.get("consolidationWarehouseId") or "") != warehouse_id:
            raise HTTPException(status_code=403, detail="Only the consolidation warehouse can confirm local-hub receipt")
    elif mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
        if str(order.get("destinationWarehouseId") or "") != warehouse_id:
            raise HTTPException(status_code=403, detail="Only the destination warehouse can confirm local-hub receipt")
    elif str(order.get("sourceWarehouseId") or order.get("warehouseId") or "") != warehouse_id:
        raise HTTPException(status_code=403, detail="Only the assigned warehouse can confirm local-hub receipt")

    hub_id = order.get("nearbyFulfillmentLocationId")
    if not hub_id:
        raise HTTPException(status_code=400, detail="Local hub is not assigned")
    hub_doc = await MongoDB.get_collection("fulfillment_hubs").find_one({
        "_id": ObjectId(str(hub_id)),
        "deletedAt": None,
        "isActive": True,
        "approvalStatus": "approved",
    })
    if not hub_doc:
        raise HTTPException(status_code=400, detail="Local hub is unavailable")

    transfer_collection = MongoDB.get_collection("farmer_fulfillment_hub_transfers")
    transfer = await transfer_collection.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
    if not transfer:
        raise HTTPException(status_code=400, detail="Local hub transfer manifest does not exist")
    if str(transfer.get("status")) != "arrived_at_hub":
        if str(transfer.get("status")) == "received":
            job = await _create_single_farmer_fulfillment_delivery_job(order_id, hub_doc, current_user)
            return {"success": True, "data": job, "message": "Local hub receipt was already confirmed; one final delivery job is reused."}
        raise HTTPException(status_code=400, detail="The transfer partner must record physical arrival at the local hub before receipt")

    now = datetime.utcnow()
    await transfer_collection.update_one(
        {"_id": transfer["_id"], "status": "arrived_at_hub"},
        {"$set": {"status": "received", "receivedAt": now, "receivedBy": ObjectId(str(current_user["_id"])), "updatedAt": now}},
    )
    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "transferStatus": "local_hub_ready",
            **({"consolidationStatus": "local_hub_ready"} if mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" else {}),
            "localHubReceivedAt": now,
            "updatedAt": now,
        },
    )
    await order_repository.append_tracking_event(
        order_id,
        "local_hub_received",
        "Complete order received at local hub",
        "The consolidated customer order has been physically received at the local hub and is ready for one final delivery partner.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"localHubId": str(hub_doc["_id"])},
    )
    refreshed = await order_repository.get_by_id(order_id)
    if refreshed:
        await NotificationService.send_order_workflow_update(
            refreshed,
            stage="local_hub_ready",
            title=f"Order #{order.get('orderNumber')}: local hub received",
            message="The complete consolidated order is at the local hub. One final delivery partner job is being opened.",
            actor_role="warehouse",
            priority=NotificationPriority.HIGH,
        )
    job = await _create_single_farmer_fulfillment_delivery_job(order_id, hub_doc, current_user)
    return {"success": True, "data": job, "message": "Local hub received the complete order. One final delivery partner job is now open."}


async def _create_single_farmer_fulfillment_delivery_job(order_id: str, hub_doc: dict, current_user: dict) -> dict:
    order = await order_repository.get_by_id(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    existing = await delivery_job_repository.get_by_order_id(order_id)
    # One final delivery job per customer order, even if a prior job is
    # completed or cancelled. Never create a duplicate during receipt retries.
    if existing:
        return {"jobId": str(existing["_id"]), "status": existing.get("status"), "existing": True}

    address = order.get("deliveryAddress") or {}
    destination = address.get("location") or address.get("deliveryLocation") or {}
    coords = destination.get("coordinates") if isinstance(destination, dict) else None
    if not coords:
        lat = address.get("lat", address.get("latitude"))
        lng = address.get("lng", address.get("longitude"))
        if lat is not None and lng is not None:
            coords = [float(lng), float(lat)]
    if not coords or len(coords) < 2:
        raise HTTPException(status_code=400, detail="Customer delivery coordinates are required before final delivery assignment")

    hub_location = hub_doc.get("location") or hub_doc.get("coordinates") or {}
    hub_coords = hub_location.get("coordinates") if isinstance(hub_location, dict) else None
    if not hub_coords or len(hub_coords) < 2:
        raise HTTPException(status_code=400, detail="Local hub coordinates are required before final delivery assignment")

    farm = {
        "name": hub_doc.get("name") or hub_doc.get("hubName") or "Local Fulfillment Hub",
        "address": hub_doc.get("address") or "",
        "lat": float(hub_coords[1]),
        "lng": float(hub_coords[0]),
    }
    hub_pickup = {
        "type": "local_hub",
        "id": str(hub_doc["_id"]),
        "name": farm["name"],
        "address": farm["address"],
        "coordinates": [float(hub_coords[0]), float(hub_coords[1])],
    }
    patched_order = dict(order)
    patched_order["deliveryPickupLocation"] = hub_pickup
    patched_order["nearbyFulfillmentLocation"] = hub_pickup
    patched_order["nearbyFulfillmentLocationId"] = hub_doc["_id"]
    distance = _haversine_km(float(hub_coords[1]), float(hub_coords[0]), float(coords[1]), float(coords[0]))
    eligible = await eligible_partners_for_job(float(hub_coords[1]), float(hub_coords[0]), job_weight_kg(order))
    job_doc = build_job_document(patched_order, farm, distance, eligible_partner_ids=[p["id"] for p in eligible])
    job_doc["jobType"] = "farmer_fulfillment_consolidated_delivery"
    job_doc["consolidationId"] = order.get("consolidationId")
    job_doc["localHubId"] = hub_doc["_id"]
    job_doc["localHubName"] = farm["name"]
    job_doc["singleFinalDelivery"] = True
    try:
        job_id = await delivery_job_repository.create_job(job_doc)
    except Exception as exc:
        # The delivery_jobs collection has a unique sparse orderId index. If
        # two warehouse/hub workers race at the final handoff, the loser must
        # reuse the already-created job instead of opening a second delivery.
        existing = await delivery_job_repository.get_by_order_id(order_id)
        if existing:
            return {"jobId": str(existing["_id"]), "status": existing.get("status", "open"), "existing": True}
        logger.exception("Failed to create final delivery job for order %s", order_id)
        raise HTTPException(status_code=409, detail="Final delivery job could not be created safely") from exc
    if not job_id:
        raise HTTPException(status_code=500, detail="Failed to create final delivery job")

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "transferStatus": "local_hub_ready",
            "consolidationStatus": "local_hub_ready",
            "deliveryPartnerJobId": ObjectId(job_id),
            "partnerAssignmentOpen": True,
            "deliveryPickupLocation": hub_pickup,
            "deliveryDecisionStatus": "partner_pending",
            "updatedAt": datetime.utcnow(),
        },
    )
    for partner in eligible:
        try:
            if partner.get("userId"):
                await NotificationService.send_custom_notification(
                    str(partner["userId"]),
                    f"Complete farmer fulfillment order {order.get('orderNumber', '')} is ready at {farm['name']}.",
                    title="New Final Delivery Job",
                    data={"type": "farmer_fulfillment_final_delivery", "jobId": job_id, "orderId": order_id},
                )
        except Exception:
            logger.exception("Failed to notify partner for consolidated farmer fulfillment")
    return {"jobId": job_id, "status": "open", "eligiblePartners": len(eligible), "localHub": hub_pickup}

@router.get("/me/customer-orders")
async def get_warehouse_customer_orders(
    stage: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """List customer orders whose fulfillment source is this warehouse."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access customer orders")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    query: Dict[str, Any] = {
        "warehouseId": ObjectId(str(warehouse["_id"])),
        "fulfillmentMethod": "warehouse",
        "deletedAt": None,
        "orderStatus": {"$nin": ["delivered", "completed", "cancelled", "refunded"]},
    }
    if stage:
        query["warehouseFulfillmentStage"] = stage

    orders = await order_repository.find_many(
        query, skip=0, limit=200,
        sort=[("orderDate", -1), ("createdAt", -1), ("updatedAt", -1), ("_id", -1)],
    )
    result = []
    for order in orders:
        customer = None
        if order.get("customerId"):
            try:
                customer = await UserService.get_user_by_id(str(order["customerId"]))
            except Exception:
                customer = None
        result.append({
            "id": str(order["_id"]),
            "orderNumber": order.get("orderNumber") or str(order["_id"])[-8:],
            "orderStatus": order.get("orderStatus"),
            "warehouseFulfillmentStage": order.get("warehouseFulfillmentStage") or "awaiting_farmer_confirmation",
            "fulfillmentMethod": order.get("fulfillmentMethod"),
            "totalAmount": order.get("totalAmount", 0),
            "paymentStatus": order.get("paymentStatus"),
            "shortageResolutionRequired": bool(order.get("shortageResolutionRequired")),
            "packingComplete": bool(order.get("packingComplete")),
            "packingVerified": bool(order.get("packingVerified")),
            "deliveryPartnerRoute": order.get("deliveryPartnerRoute"),
            "deliveryAddress": order.get("deliveryAddress") or {},
            "customer": {
                "name": (
                    f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip()
                    if customer else "Customer"
                ),
                "phone": customer.get("phone") if customer else None,
            },
            "items": [
                {
                    "productId": str(item.get("productId")),
                    "variantId": str(item.get("variantId")) if item.get("variantId") else None,
                    "productName": item.get("productName") or "Product",
                    "quantity": float(item.get("quantity", 0) or 0),
                    "unit": item.get("unit") or "kg",
                    "unitPrice": float(item.get("unitPrice", 0) or 0),
                }
                for item in (order.get("items") or [])
            ],
            "createdAt": order.get("createdAt"),
            "updatedAt": order.get("updatedAt"),
        })
    return {"success": True, "data": {"orders": result}}


@router.post("/me/customer-orders/{order_id}/allocate")
async def allocate_warehouse_customer_order(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Move a stored warehouse order into the packing queue.

    Allocation is deliberately idempotent: inventory was reserved by the
    authoritative order/inventory workflow; this endpoint never reserves the
    same stock a second time.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can allocate warehouse orders")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("warehouseId")) != str(warehouse["_id"]) or str(order.get("fulfillmentMethod") or "") != "warehouse":
        raise HTTPException(status_code=404, detail="Warehouse customer order not found")
    if str(order.get("orderStatus") or "").lower() in ("cancelled", "refunded", "delivered", "completed"):
        raise HTTPException(status_code=400, detail="This order is already closed")

    stage = str(order.get("warehouseFulfillmentStage") or "")
    if stage in ("ready_for_dispatch", "delivery_decision", "dispatched"):
        return {"success": True, "data": {"orderId": order_id, "stage": stage}, "message": "Order is already past allocation"}

    task = await WarehouseService.ensure_order_packing_task(order_id, str(warehouse["_id"]))
    if not task:
        raise HTTPException(status_code=400, detail="The order has no warehouse-packable inventory yet")

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "warehouseFulfillmentStage": "ready_for_packing",
            "warehouseAllocatedAt": datetime.utcnow(),
            "warehouseAllocatedBy": ObjectId(str(current_user["_id"])),
            "updatedAt": datetime.utcnow(),
        },
    )
    await order_repository.append_tracking_event(
        order_id,
        "warehouse_stock_allocated",
        "Warehouse stock allocated",
        "Reserved warehouse stock has been allocated to the customer order and the order is ready for packing.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={"packingTaskId": str(task.get("_id")) if task.get("_id") else None},
    )
    return {
        "success": True,
        "data": {
            "orderId": order_id,
            "orderNumber": order.get("orderNumber"),
            "stage": "ready_for_packing",
            "packingTaskId": str(task.get("_id")) if task.get("_id") else None,
        },
        "message": "Stock allocated. Customer order is ready for packing.",
    }


@router.get("/me/consolidation")
async def get_warehouse_consolidation(
    current_user: dict = Depends(get_current_user),
):
    """Read-only consolidation readiness for multi-farm event fulfillments."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can view consolidation")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    try:
        from app.api.v1.bulk_orders import event_fulfillment_repo
        rows = await event_fulfillment_repo.find_many({
            "warehouseId": ObjectId(str(warehouse["_id"])),
            "deletedAt": None,
        }, skip=0, limit=1000, sort=[("updatedAt", -1)])
    except Exception:
        rows = []

    grouped: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        request_id = str(row.get("requestId") or row.get("eventRequestId") or row.get("_id"))
        group = grouped.setdefault(request_id, {
            "requestId": request_id,
            "items": [],
            "totalItems": 0,
            "storedItems": 0,
            "complete": False,
            "status": "collecting",
        })
        status_value = str(row.get("status") or "")
        group["items"].append({
            "id": str(row["_id"]),
            "productName": row.get("productName") or row.get("cropName") or "Product",
            "allocatedQuantity": float(row.get("allocatedQuantityKg") or row.get("quantityKg") or 0),
            "status": status_value,
        })
        group["totalItems"] += 1
        if status_value in ("stored", "consolidated", "ready_for_delivery", "delivered"):
            group["storedItems"] += 1

    for group in grouped.values():
        group["complete"] = group["totalItems"] > 0 and group["storedItems"] == group["totalItems"]
        group["status"] = "consolidation_ready" if group["complete"] else (
            "partially_received" if group["storedItems"] else "collecting"
        )

    return {"success": True, "data": {"groups": list(grouped.values())}}

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
    # Normalize nested MongoDB ObjectIds before FastAPI/Pydantic serializes
    # the response. Converting only the top-level _id leaves related IDs nested
    # in product/batch/warehouse fields and causes HTTP 500 responses.
    safe_stock = []
    for item in stock:
        safe_item = _make_json_safe(item)
        if isinstance(safe_item, dict) and safe_item.get("_id") is not None:
            safe_item["id"] = str(safe_item.pop("_id"))
        safe_stock.append(safe_item)
    return {
        "success": True,
        "data": {
            "stock": safe_stock,
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

@router.get("/recommended")
async def get_recommended_warehouse(
    lat: float = Query(...),
    lng: float = Query(...),
    quantity: float = Query(0, ge=0),
    storageType: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") not in ("farmer", "admin"):
        raise HTTPException(status_code=403, detail="Only farmers and admins can request warehouse recommendations")
    warehouse = await WarehouseService.find_best_warehouse(
        {"type": "Point", "coordinates": [lng, lat]},
        required_capacity=quantity,
        storage_type=storageType,
    )
    if not warehouse:
        raise HTTPException(status_code=404, detail="No suitable warehouse is available near this location")
    return {"success": True, "data": {
        "id": str(warehouse["_id"]),
        "name": warehouse.get("name"),
        "address": warehouse.get("address") or {},
        "distanceKm": warehouse.get("selectionDistanceKm"),
        "availableCapacity": warehouse.get("availableCapacity"),
        "totalCapacity": warehouse.get("totalCapacity", 0),
        "usedCapacity": warehouse.get("usedCapacity", 0),
        "serviceAreas": warehouse.get("serviceAreas") or [],
        "supportedStorageTypes": warehouse.get("supportedStorageTypes") or [],
        "selectionReason": warehouse.get("selectionReason"),
    }}

class PickupTeamApplicationRequest(BaseModel):
    vehicleType: str = Field(..., min_length=1)
    vehicleNumber: str = Field(..., min_length=1)
    vehicleModel: Optional[str] = None
    vehicleYear: Optional[int] = None
    capacity: Optional[float] = Field(None, ge=0)
    fuelType: Optional[str] = None
    licenseDetails: Optional[Dict[str, Any]] = None
    verificationDetails: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None


class PickupRouteCreateRequest(BaseModel):
    collectionIds: List[str] = Field(default_factory=list)
    maxWeightKg: float = Field(0, ge=0)
    assignmentMode: str = Field("offer", pattern="^(offer|auto_assign|assign_team)$")
    deliveryPartnerId: Optional[str] = None
    # Optional exact farm-stop sequence. When omitted, use smart automatic routing.
    manualStopOrder: Optional[List[str]] = None


class PickupRouteAssignRequest(BaseModel):
    deliveryPartnerId: str = Field(..., min_length=1)


@router.get("/me/pickup-team/applications")
async def get_pickup_team_applications(
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can manage pickup teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    apps = await warehouse_pickup_team_repository.get_applications(str(warehouse["_id"]), status_filter)
    for item in apps:
        item["id"] = str(item["_id"])
        item["deliveryPartnerId"] = str(item["deliveryPartnerId"])
        try:
            user = await UserService.get_user_by_id(str(item.get("userId") or item["deliveryPartnerId"]))
            if user:
                item["name"] = (f"{user.get('firstName','')} {user.get('lastName','')}").strip() or user.get("name") or "Delivery Partner"
                item["phone"] = user.get("phone")
        except Exception:
            item["name"] = "Delivery Partner"
    return {"success": True, "data": {"applications": apps}}


@router.put("/me/pickup-team/applications/{application_id}")
async def review_pickup_team_application(
    application_id: str,
    decision: str = Query(..., pattern="^(approve|reject)$"),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can review pickup team applications")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    apps = await warehouse_pickup_team_repository.get_applications(str(warehouse["_id"]), "pending")
    app = next((x for x in apps if str(x["_id"]) == application_id), None)
    if not app:
        raise HTTPException(status_code=404, detail="Pickup team application not found")
    now = datetime.utcnow()
    update = {
        "status": "approved" if decision == "approve" else "rejected",
        "reviewedAt": now,
        "reviewedBy": ObjectId(str(current_user["_id"])),
    }
    if decision == "approve":
        update["approvedAt"] = now
    await warehouse_pickup_team_repository.update_application(application_id, update)
    return {"success": True, "message": "Pickup team member approved" if decision == "approve" else "Application rejected"}


@router.get("/me/pickup-team/members")
async def get_pickup_team_members(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access pickup team")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    members = await warehouse_pickup_team_repository.get_approved_members(str(warehouse["_id"]))
    result = []
    for x in members:
        item = {**x, "id": str(x["_id"]), "deliveryPartnerId": str(x["deliveryPartnerId"])}
        try:
            user = await UserService.get_user_by_id(str(x.get("userId") or x["deliveryPartnerId"]))
            if user:
                item["name"] = (f"{user.get('firstName','')} {user.get('lastName','')}").strip() or user.get("name") or "Delivery Partner"
                item["phone"] = user.get("phone")
        except Exception:
            item["name"] = "Delivery Partner"
        result.append(item)
    return {"success": True, "data": {"members": result}}


@router.post("/me/pickup-routes")
async def create_pickup_routes(
    data: PickupRouteCreateRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can create pickup routes")
    _enforce_warehouse_operating_window("farm_pickup")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    warehouse_id = str(warehouse["_id"])
    jobs = await warehouse_collection_repository.get_by_warehouse(warehouse_id, "all")
    # Legacy team_assigned jobs without a route can be recovered into the new
    # route-based workflow. Route-linked jobs are never planned a second time.
    jobs = [
        job for job in jobs
        if str(job.get("status") or "") in {"ready_for_pickup", "team_assigned"}
        and not job.get("pickupRouteId")
    ]
    if data.collectionIds:
        requested_ids = set(data.collectionIds)
        selected_jobs = [job for job in jobs if str(job.get("_id")) in requested_ids]
        if len(selected_jobs) != len(requested_ids):
            raise HTTPException(
                status_code=409,
                detail="Some selected jobs are no longer available for planning or already belong to a route. Refresh the queue and try again.",
            )
        jobs = selected_jobs
    if not jobs:
        raise HTTPException(status_code=400, detail="No unplanned ready-for-pickup farms are available")

    members = await warehouse_pickup_team_repository.get_approved_members(warehouse_id)
    selected_membership = None
    if data.assignmentMode == "assign_team":
        if not data.deliveryPartnerId:
            raise HTTPException(status_code=422, detail="Select an approved pickup team")
        selected_membership = await warehouse_pickup_team_repository.get_membership(
            warehouse_id, data.deliveryPartnerId
        )
        if not selected_membership:
            raise HTTPException(status_code=400, detail="This pickup team is not approved for this warehouse")
        try:
            team_capacity = float(selected_membership.get("capacity") or 0)
        except (TypeError, ValueError):
            team_capacity = 0
        if team_capacity <= 0:
            raise HTTPException(status_code=400, detail="Selected pickup team has no registered carrying capacity")
        route_capacity = data.maxWeightKg or team_capacity
        if route_capacity > team_capacity:
            route_capacity = team_capacity
    elif data.assignmentMode == "auto_assign":
        if not members:
            raise HTTPException(status_code=400, detail="Approve at least one pickup team before using automatic assignment")
        capacities = []
        for member in members:
            try:
                value = float(member.get("capacity") or 0)
                if value > 0:
                    capacities.append(value)
            except (TypeError, ValueError):
                pass
        if not capacities:
            raise HTTPException(status_code=400, detail="Approved pickup teams need registered vehicle capacities")
        route_capacity = min(data.maxWeightKg, max(capacities)) if data.maxWeightKg > 0 else max(capacities)
    else:
        capacities = []
        for member in members:
            try:
                value = float(member.get("capacity") or 0)
                if value > 0:
                    capacities.append(value)
            except (TypeError, ValueError):
                pass
        route_capacity = min(data.maxWeightKg, max(capacities)) if data.maxWeightKg > 0 and capacities else data.maxWeightKg
        if route_capacity <= 0 and capacities:
            route_capacity = max(capacities)

    if route_capacity > 0:
        overweight = [
            job for job in jobs
            if float(job.get("quantity") or 0) > route_capacity
        ]
        if overweight:
            raise HTTPException(
                status_code=400,
                detail=f"{len(overweight)} selected job(s) exceed the {route_capacity:g} kg vehicle capacity. Choose a larger vehicle or split the pickup.",
            )

    try:
        route_groups = await build_smart_routes(
            warehouse,
            jobs,
            None,
            route_capacity,
            manual_stop_order=data.manualStopOrder,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not route_groups:
        raise HTTPException(status_code=400, detail="Unable to create routes for the selected collection jobs")

    assignments = []
    if data.assignmentMode == "assign_team":
        assignments = [selected_membership for _ in route_groups]
    elif data.assignmentMode == "auto_assign":
        # Capacity is per pickup run, not a lifetime or historical balance.
        # Keep a team unavailable only when it already has an active route for
        # today's farm-pickup shift. Yesterday's route must not consume today's
        # capacity or prevent the team from being selected again.
        route_date = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
        existing_routes = await warehouse_pickup_route_repository.get_by_warehouse(warehouse_id)
        busy_partner_ids = [
            str(route.get("deliveryPartnerId"))
            for route in existing_routes
            if route.get("deliveryPartnerId")
            and str(route.get("routeDate") or "") == route_date
            and route.get("status") in {"assigned", "in_progress", "en_route", "collecting"}
        ]
        try:
            from app.services.warehouse_pickup_route_service import select_route_team_assignments
            assignments = select_route_team_assignments(route_groups, members, busy_partner_ids)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    created = []
    route_date = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
    for index, group in enumerate(route_groups):
        route_id = await warehouse_pickup_route_repository.create_route({
            "warehouseId": warehouse["_id"],
            "routeDate": route_date,
            "status": "offered",
            "deliveryPartnerId": None,
            "assignmentMode": data.assignmentMode,
            "routeNumber": f"PR-{datetime.utcnow().strftime('%Y%m%d')}-{index+1:02d}",
            "stops": group["stops"],
            "totalStops": group["totalStops"],
            "totalOrders": group.get("totalOrders") or sum(int(stop.get("orderCount") or 0) for stop in group.get("stops") or []),
            "totalQuantity": group["totalQuantity"],
            "createdBy": ObjectId(str(current_user["_id"])),
        })
        if not route_id:
            logger.error("Failed to save pickup route for warehouse %s", warehouse_id)
            continue

        route_doc = await warehouse_pickup_route_repository.get_by_id(route_id)
        # Reserve each job while a partner offer is open, too. It stays in
        # Ready for Pickup until a partner accepts, but cannot be planned twice.
        for stop in group.get("stops") or []:
            for collection_id in (stop.get("collectionIds") or [stop.get("collectionId")]):
                if not collection_id or not ObjectId.is_valid(str(collection_id)):
                    continue
                await warehouse_collection_repository.update_job(
                    str(collection_id),
                    {
                        "pickupRouteId": ObjectId(route_id),
                        "pickupRouteStatus": "offered",
                        "status": "ready_for_pickup",
                        "collectionTeamId": None,
                        "teamAssignedAt": None,
                    },
                )

        if data.assignmentMode in {"assign_team", "auto_assign"}:
            membership = dict(assignments[index])
            membership["deliveryPartnerUserId"] = str(
                membership.get("userId") or membership.get("deliveryPartnerUserId") or ""
            )
            route_doc["assignedBy"] = ObjectId(str(current_user["_id"]))
            assigned = await assign_route(route_doc, membership)
            if assigned:
                route_doc = assigned
        else:
            if members:
                # Approved pickup partners receive an exclusive first-accept offer.
                await warehouse_pickup_route_repository.update_route(
                    route_id, {"assignmentMode": "pickup_partner"}
                )
                for member in members:
                    try:
                        user_id = str(member.get("userId") or "")
                        if user_id:
                            await NotificationService.send_custom_notification(
                                user_id,
                                f"Pickup route {route_doc.get('routeNumber', route_id)} is available. Accept it to claim this route.",
                                title="New Warehouse Pickup Route",
                                data={"type": "warehouse_pickup_offer", "routeId": route_id},
                            )
                    except Exception:
                        logger.exception("Failed to notify pickup partner about route offer")
            else:
                # Without approved pickup partners, publish the route to the
                # delivery marketplace using its normal eligibility/capacity checks.
                await warehouse_pickup_route_repository.update_route(
                    route_id, {"assignmentMode": "delivery_marketplace"}
                )
                warehouse_point = (warehouse.get("location") or {}).get("coordinates") or [0, 0]
                first_stop_point = ((group.get("stops") or [{}])[0].get("pickupLocation") or {}).get("coordinates") or warehouse_point
                eligible = await eligible_partners_for_job(
                    float(first_stop_point[1]) if len(first_stop_point) > 1 else 0.0,
                    float(first_stop_point[0]) if first_stop_point else 0.0,
                    float(group.get("totalQuantity") or 0),
                    job_type="warehouse_pickup",
                )
                job_doc = build_warehouse_pickup_job(route_doc, warehouse, [partner["id"] for partner in eligible])
                job_id = await delivery_job_repository.create_job(job_doc)
                if job_id:
                    for partner in eligible:
                        try:
                            if partner.get("userId"):
                                await NotificationService.send_custom_notification(
                                    str(partner["userId"]),
                                    f"Warehouse pickup job {route_doc.get('routeNumber', route_id)} is available: {group.get('totalStops', 0)} farms, {group.get('totalQuantity', 0)} kg.",
                                    data={"type": "warehouse_pickup_job", "jobId": job_id, "routeId": route_id},
                                )
                        except Exception:
                            logger.exception("Failed to notify delivery partner about warehouse pickup job")

        created.append(serialize_route(await warehouse_pickup_route_repository.get_by_id(route_id)))

    if not created:
        raise HTTPException(status_code=500, detail="No pickup routes could be saved")
    message = {
        "offer": "Pickup routes created and offered to eligible partners",
        "auto_assign": "Pickup routes planned and assigned to approved teams",
        "assign_team": "Pickup routes planned and assigned to the selected team",
    }[data.assignmentMode]
    return {"success": True, "data": {"routes": created}, "message": f"{message} ({len(created)} route(s))"}


@router.get("/me/pickup-routes")
async def get_pickup_routes(
    date: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can view pickup routes")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    # The warehouse Pickup Routes page is the assignment history and monitoring
    # view, not a today-only list. When no date is explicitly requested, return
    # routes from every date, including completed/returned routes, so yesterday's
    # assignment and its full stop/order details remain available.
    routes = await warehouse_pickup_route_repository.get_by_warehouse(str(warehouse["_id"]), date)
    display_routes = []
    for route in routes:
        display_routes.append(await enrich_pickup_route_display(route))
    return {"success": True, "data": {"routes": display_routes}}


@router.put("/me/pickup-routes/{route_id}/assign")
async def assign_pickup_route(
    route_id: str,
    data: PickupRouteAssignRequest,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign pickup routes")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    route = await warehouse_pickup_route_repository.get_by_id(route_id)
    if not warehouse or not route or str(route.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Pickup route not found")
    membership = await warehouse_pickup_team_repository.get_membership(str(warehouse["_id"]), data.deliveryPartnerId)
    if not membership:
        raise HTTPException(status_code=400, detail="This delivery partner is not an approved pickup team member")
    membership["deliveryPartnerUserId"] = str(membership.get("userId") or membership.get("deliveryPartnerUserId"))
    route["assignedBy"] = ObjectId(str(current_user["_id"]))
    updated = await assign_route(route, membership)
    return {"success": True, "data": await enrich_pickup_route_display(updated), "message": "Pickup route assigned to approved team member"}


@router.put("/me/collections/{collection_id}/assign")
async def assign_collection_team(collection_id: str, current_user: dict = Depends(get_current_user)):
    """Retire per-card assignment; all assignments must create a managed pickup route."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign collection teams")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    job = await warehouse_collection_repository.get_by_id(collection_id)
    if not warehouse or not job or str(job.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Collection job not found")
    raise HTTPException(
        status_code=409,
        detail="Individual team assignment is disabled. Use Farm Collection Bulk Actions to plan a route and assign an approved pickup team.",
    )


@router.put("/me/collections/{collection_id}/status")
async def update_collection_status(collection_id: str, collection_status: str = Query(..., alias="status", pattern="^(en_route|arrived_at_farm|collected|departed_farm|arrived_warehouse)$"), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can update collection jobs")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    job = await warehouse_collection_repository.get_by_id(collection_id)
    if not warehouse or not job or str(job.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Collection job not found")
    if job.get("pickupRouteId") or job.get("collectionTeamId"):
        raise HTTPException(
            status_code=409,
            detail="This pickup is assigned to a pickup team and cannot be updated by warehouse staff. The delivery partner manages progress from Pickup Routes.",
        )
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
            updated_order = await order_repository.get_by_id(str(job["orderId"]))
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order, stage="warehouse_arrived",
                    title=f"Order #{updated_order.get('orderNumber') or job['orderId']}: shipment arrived at warehouse",
                    message="The shipment has arrived at the warehouse. Receiving and quality check are now required.",
                    actor_role="warehouse",
                )
    elif job.get("orderId"):
        stage_map = {"en_route": "collection_en_route", "arrived_at_farm": "collection_arrived", "collected": "collected", "departed_farm": "collection_departed"}
        order_update = {
            "warehouseCollectionStatus": collection_status,
            "warehouseFulfillmentStage": stage_map[collection_status],
            "updatedAt": datetime.utcnow(),
        }
        if (
            str(job.get("collectionType") or "") == "packed_orders_transfer"
            and collection_status in ("collected", "departed_farm")
        ):
            # This is the first physical dispatch point for a long-distance
            # farmer-packed order; choosing a route alone must not mark it sent.
            order_update.update({
                "fulfillmentStage": "dispatched",
                "deliveryDispatchStatus": "in_transit_to_warehouse",
                "deliveryDispatchAt": datetime.utcnow(),
            })
        await order_repository.update({"_id": ObjectId(str(job["orderId"]))}, order_update)
        await order_repository.append_tracking_event(str(job["orderId"]), f"collection_{collection_status}", {"en_route":"Collection team en route","arrived_at_farm":"Collection team arrived at farm","collected":"Product collected from farm","departed_farm":"Collection team departed farm"}[collection_status], "Warehouse collection progress updated.", actor_id=str(current_user["_id"]), actor_role="warehouse")
        updated_order = await order_repository.get_by_id(str(job["orderId"]))
        if updated_order:
            await NotificationService.send_order_workflow_update(
                updated_order, stage=stage_map[collection_status],
                title=f"Order #{updated_order.get('orderNumber') or job['orderId']}: collection updated",
                message={"en_route":"Collection team is on the way to the farm.","arrived_at_farm":"Collection team has arrived at the farm.","collected":"The product has been collected from the farm.","departed_farm":"The collection team has departed the farm."}[collection_status],
                actor_role="warehouse",
            )
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
    # Recovery/synchronization: older pickup completions may have updated the
    # route status without materializing its incoming-stock rows. Reconcile
    # completed routes before querying the page so warehouse receiving is not blank.
    try:
        routes = await warehouse_pickup_route_repository.get_by_warehouse(str(warehouse["_id"]))
        for route in routes:
            if str(route.get("status") or "") in ("completed", "returned_to_warehouse"):
                await WarehouseService.create_pickup_route_incoming(str(route.get("_id")))
    except Exception:
        logger.exception("Failed to reconcile completed pickup routes into incoming stock")

    skip = (page - 1) * limit
    incoming, total = await WarehouseService.get_incoming_stock(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    def make_json_safe(value: Any) -> Any:
        # MongoDB documents can contain ObjectIds nested inside metadata,
        # references, and embedded objects. Convert them before returning JSON.
        if isinstance(value, ObjectId):
            return str(value)
        if isinstance(value, dict):
            return {str(key): make_json_safe(child) for key, child in value.items()}
        if isinstance(value, list):
            return [make_json_safe(child) for child in value]
        if isinstance(value, tuple):
            return [make_json_safe(child) for child in value]
        return value

    safe_incoming = []
    for item in incoming:
        safe_item = make_json_safe(item)
        safe_item["id"] = str(item.get("_id", item.get("id", "")))

        # Keep Incoming Stock aligned with Farm Collection's physical-arrival state.
        # Older records may still say scheduled even after the collection reached the warehouse.
        collection_id = str(item.get("collectionId") or "")
        if collection_id and ObjectId.is_valid(collection_id):
            try:
                collection_job = await warehouse_collection_repository.get_by_id(collection_id)
                if collection_job and str(collection_job.get("status") or "") == "arrived_warehouse":
                    safe_item["arrivedWarehouseAt"] = (
                        safe_item.get("arrivedWarehouseAt")
                        or collection_job.get("arrivedWarehouseAt")
                        or collection_job.get("updatedAt")
                        or collection_job.get("updated_at")
                    )
                    safe_item["warehouseArrivalConfirmed"] = True
                    safe_item["collectionStatus"] = "arrived_warehouse"
                    if str(safe_item.get("status") or "") == "scheduled":
                        safe_item["status"] = "in_transit"
                    if collection_job.get("sourceMode"):
                        safe_item["sourceMode"] = collection_job.get("sourceMode")
                    if collection_job.get("packingRequired") is not None:
                        safe_item["packingRequired"] = collection_job.get("packingRequired")
            except Exception:
                logger.exception("Could not sync incoming shipment arrival from collection %s", collection_id)

        # Resolve Mongo IDs into human-readable names for the warehouse receiving UI.
        farmer_id = str(item.get("farmerId") or "")
        if farmer_id and ObjectId.is_valid(farmer_id):
            try:
                farmer = await farmer_repository.get_by_id(farmer_id)
                if not farmer:
                    farmer = await farmer_repository.get_by_user_id(farmer_id)
                farmer_user = None
                if not farmer:
                    try:
                        farmer_user = await UserService.get_user_by_id(farmer_id)
                        if farmer_user:
                            farmer = await farmer_repository.get_by_user_id(farmer_id)
                    except Exception:
                        farmer_user = None
                if farmer:
                    safe_item["farmName"] = (
                        farmer.get("farmName") or farmer.get("businessName")
                        or farmer.get("name") or farmer.get("farm_name")
                    )
                    user_id = str(farmer.get("userId") or "")
                    if user_id and ObjectId.is_valid(user_id):
                        farmer_user = await UserService.get_user_by_id(user_id)
                        if farmer_user:
                            full_name = " ".join(filter(None, [
                                farmer_user.get("firstName"), farmer_user.get("lastName")
                            ])).strip()
                            safe_item["farmerName"] = full_name or safe_item.get("farmerName")
                            safe_item["farmerPhone"] = farmer_user.get("phone")
                    safe_item["farmAddress"] = (
                        farmer.get("farmAddress") or farmer.get("address")
                        or farmer.get("location", {}).get("address")
                        if isinstance(farmer.get("location"), dict)
                        else farmer.get("farmAddress") or farmer.get("address")
                    )
            except Exception:
                logger.exception("Could not resolve farmer display details for incoming shipment %s", safe_item["id"])

        product_id = str(item.get("productId") or "")
        if product_id and ObjectId.is_valid(product_id):
            try:
                product = await product_repository.get_by_id(product_id)
                if product:
                    safe_item["productName"] = product.get("name") or product.get("productName") or "Product name unavailable"
                else:
                    safe_item["productName"] = safe_item.get("productName") or "Product name unavailable"
            except Exception:
                logger.exception("Could not resolve product name for incoming shipment %s", safe_item["id"])

        order_id = str(item.get("orderId") or "")
        if order_id and ObjectId.is_valid(order_id):
            try:
                order = await order_repository.get_by_id(order_id)
                if order:
                    # Reflect the farmer's saved fulfillment choice in the
                    # Incoming Stock tabs, even for legacy rows whose sourceMode
                    # was missing or incorrectly defaulted during pickup sync.
                    chosen_method = str(order.get("fulfillmentMethod") or safe_item.get("fulfillmentMethod") or "").strip().lower()
                    if chosen_method in {"farmer", "warehouse"}:
                        safe_item["fulfillmentMethod"] = chosen_method
                        safe_item["sourceMode"] = "farmer_fulfillment_transfer" if chosen_method == "farmer" else "warehouse_fulfillment_bulk"
                        safe_item["packingRequired"] = chosen_method == "warehouse"
                    safe_item["orderNumber"] = order.get("orderNumber") or f"Order #{order_id[-6:].upper()}"
                    # Include canonical payment details from the customer order so
                    # incoming-stock labels never guess or default every order to online.
                    for payment_key in ("paymentMethod", "payment_method", "paymentMode", "paymentType", "paymentStatus", "payment_status", "totalAmount", "grandTotal", "payableAmount", "total", "cashOnDelivery"):
                        if order.get(payment_key) is not None:
                            safe_item[payment_key] = make_json_safe(order.get(payment_key))
                    if isinstance(order.get("payment"), dict):
                        safe_item["payment"] = make_json_safe(order["payment"])
                    # Packing labels must use the canonical customer order address, not only the incoming-stock snapshot.
                    delivery_address = order.get("deliveryAddress") or order.get("shippingAddress") or order.get("address")
                    if not delivery_address and order.get("deliveryAddressId") and order.get("customerId"):
                        try:
                            saved_addresses = await UserService.get_addresses(str(order.get("customerId")))
                            delivery_address = next((address for address in (saved_addresses or []) if str(address.get("_id") or address.get("id") or "") == str(order.get("deliveryAddressId"))), None)
                        except Exception:
                            logger.exception("Could not hydrate saved delivery address for order %s", order_id)
                    if delivery_address:
                        safe_item["deliveryAddress"] = make_json_safe(delivery_address)
                    safe_item["customerId"] = str(order.get("customerId") or safe_item.get("customerId") or "")
                    customer_doc = None
                    customer_ref = str(order.get("customerId") or "")
                    if customer_ref and ObjectId.is_valid(customer_ref):
                        try:
                            customer_doc = await UserService.get_user_by_id(customer_ref)
                        except Exception:
                            logger.exception("Could not hydrate customer details for order %s", order_id)
                    if customer_doc:
                        safe_item["customerName"] = " ".join(filter(None, [customer_doc.get("firstName"), customer_doc.get("lastName")])).strip() or customer_doc.get("name") or safe_item.get("customerName") or "Customer details unavailable"
                        safe_item["customerPhone"] = customer_doc.get("phone") or customer_doc.get("phoneNumber") or safe_item.get("customerPhone")
                    safe_item["customerName"] = safe_item.get("customerName") or " ".join(filter(None, [
                        (order.get("customer") or {}).get("firstName") if isinstance(order.get("customer"), dict) else None,
                        (order.get("customer") or {}).get("lastName") if isinstance(order.get("customer"), dict) else None,
                    ])).strip() or "Customer details unavailable"
            except Exception:
                logger.exception("Could not resolve order details for incoming shipment %s", safe_item["id"])
        safe_item["farmName"] = safe_item.get("farmName") or safe_item.get("farmerName") or "Farm details unavailable"
        safe_item["farmerName"] = safe_item.get("farmerName") or safe_item["farmName"]
        safe_item["productName"] = safe_item.get("productName") or "Product name unavailable"
        safe_item["orderNumber"] = safe_item.get("orderNumber") or "Order reference unavailable"
        safe_incoming.append(safe_item)
    return {
        "success": True,
        "data": {
            "incoming": safe_incoming,
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

@router.put("/me/incoming/{incoming_id}/receive-bulk-reference")
async def receive_bulk_stock_reference(
    incoming_id: str,
    declared_total: float = Query(..., ge=0, alias="declaredTotal"),
    measured_total: float = Query(..., gt=0, alias="measuredTotal"),
    quality_check: str = Query(..., pattern="^(pending|passed|failed)$"),
    notes: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Receive a farm bulk lot once while marking its order rows as packing references.

    Per-order quantities are not weighed during this operation. The measured bulk
    weight and overall QC are stored as lot-level metadata on each linked row.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can receive stock")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    incoming = await incoming_stock_repository.get_by_id(incoming_id)
    if not incoming or str(incoming.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Incoming stock record was not found in this warehouse")
    if str(incoming.get("sourceMode") or "") == "farmer_fulfillment_transfer":
        raise HTTPException(status_code=409, detail="Farmer Fulfillment orders must use individual Receive Order")
    if str(incoming.get("status") or "").lower() in ("received", "stored", "rejected"):
        return {"success": True, "data": {"id": incoming_id, "status": incoming.get("status"), "alreadyReceived": True}}
    now = datetime.utcnow()
    status_value = "rejected" if quality_check == "failed" else ("quality_check" if quality_check == "pending" else "received")
    lot_note = (notes or "").strip()
    lot_note = (lot_note + " | " if lot_note else "") + f"Bulk lot receipt: declared total {declared_total} kg; measured total {measured_total} kg; overall quality {quality_check}. Per-order quantity is a packing reference and is allocated during Order Packing."
    await incoming_stock_repository.update(
        {"_id": incoming["_id"]},
        {
            "status": status_value,
            "qualityCheck": quality_check,
            "bulkShipmentDeclaredTotal": declared_total,
            "bulkShipmentMeasuredTotal": measured_total,
            "bulkShipmentReceivedAt": now,
            "receivedAt": now,
            "receivedDate": now,
            "qualityNotes": lot_note,
            "notes": lot_note,
            "updatedAt": now,
        },
    )
    updated = await incoming_stock_repository.get_by_id(incoming_id)
    return {"success": True, "data": {"id": incoming_id, "status": status_value, "bulkShipmentMeasuredTotal": measured_total, "record": updated}}

@router.put("/me/incoming/{incoming_id}/receive")
async def receive_incoming_stock(
    incoming_id: str,
    quantity: float = Query(..., gt=0),
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
    # A packed Farmer Fulfillment transfer may be received only after its
    # farm-collection workflow confirms physical arrival at this warehouse.
    incoming_record = await incoming_stock_repository.get_by_id(incoming_id)
    if (
        incoming_record
        and str(incoming_record.get("warehouseId")) == str(warehouse["_id"])
        and str(incoming_record.get("sourceMode") or "") == "farmer_fulfillment_transfer"
        and not incoming_record.get("arrivedWarehouseAt")
    ):
        raise HTTPException(
            status_code=409,
            detail="This farmer-packed shipment has not arrived at the warehouse yet. Complete Farm Collection → Arrived Warehouse first.",
        )

    # Physical receipt is separate from quality approval. Bulk stock stays pending until
    # the quality endpoint approves it; packed Farmer Fulfillment bypasses bulk QC.
    is_farmer_fulfillment = str((incoming_record or {}).get("sourceMode") or "") == "farmer_fulfillment_transfer"
    # Honor the selected inspection result. The UI deliberately sends "pending"
    # when the measured quantity differs from the declared quantity.
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

    # Persist an immutable receipt snapshot on the incoming shipment so staff can
    # reopen/reprint it later without calling the receive endpoint again.
    try:
        latest_incoming = await incoming_stock_repository.get_by_id(incoming_id) or incoming
        existing_receipt = latest_incoming.get("receipt") if isinstance(latest_incoming.get("receipt"), dict) else {}
        order_record = None
        order_id_value = latest_incoming.get("orderId")
        if order_id_value:
            order_record = await order_repository.get_by_id(str(order_id_value))
        farm_name = (
            latest_incoming.get("farmName")
            or latest_incoming.get("farmerName")
            or latest_incoming.get("pickupLocation", {}).get("farmName")
            or latest_incoming.get("pickupLocation", {}).get("name")
            or "Farm details unavailable"
        )
        customer = (order_record or {}).get("customer") or {}
        if not isinstance(customer, dict):
            customer = {}
        customer_name = (
            latest_incoming.get("customerName")
            or customer.get("name")
            or " ".join(filter(None, [customer.get("firstName"), customer.get("lastName")])).strip()
            or "Customer details unavailable"
        )
        delivery_address = (
            latest_incoming.get("deliveryAddress")
            or latest_incoming.get("shippingAddress")
            or (order_record or {}).get("deliveryAddress")
            or (order_record or {}).get("shippingAddress")
            or (order_record or {}).get("address")
        )
        if isinstance(delivery_address, str):
            delivery_address = {"formattedAddress": delivery_address}
        elif not isinstance(delivery_address, dict):
            delivery_address = {}
        address_fields = {
            "district": delivery_address.get("district") or delivery_address.get("districtName"),
            "city": delivery_address.get("city") or delivery_address.get("town") or delivery_address.get("cityName"),
            "state": delivery_address.get("state") or delivery_address.get("stateName") or delivery_address.get("province"),
            "pinCode": delivery_address.get("pinCode") or delivery_address.get("pincode") or delivery_address.get("postalCode") or delivery_address.get("zipCode") or delivery_address.get("zip"),
        }
        warehouse_name = warehouse.get("name") or warehouse.get("warehouseName") or "Warehouse details unavailable"
        received_at = latest_incoming.get("receivedAt") or datetime.utcnow()
        receipt_number = existing_receipt.get("receiptNumber") or latest_incoming.get("receiptNumber") or (
            f"AGR-RCPT-{received_at.strftime('%Y%m%d%H%M%S')}-{incoming_id[-6:].upper()}"
        )
        receipt = {
            "receiptNumber": receipt_number,
            "receivedAt": received_at,
            "shipmentId": str(latest_incoming.get("_id") or incoming_id),
            "orderId": str(order_id_value) if order_id_value else None,
            "orderNumber": (order_record or {}).get("orderNumber") or latest_incoming.get("orderNumber"),
            "farmName": farm_name,
            "farmId": str(latest_incoming.get("farmId") or latest_incoming.get("farmerId") or "") or None,
            "warehouseId": str(warehouse.get("_id") or ""),
            "warehouseName": warehouse_name,
            "productName": latest_incoming.get("productName") or ((latest_incoming.get("product") or {}).get("name") if isinstance(latest_incoming.get("product"), dict) else None),
            "declaredQuantity": float(latest_incoming.get("quantity") or 0),
            "receivedQuantity": float(latest_incoming.get("quantityReceived") if latest_incoming.get("quantityReceived") is not None else quantity),
            "usableQuantity": float(latest_incoming.get("usableQuantity") if latest_incoming.get("usableQuantity") is not None else (usable_quantity if usable_quantity is not None else quantity)),
            "rejectedQuantity": float(latest_incoming.get("quantityRejected") or 0),
            "unit": latest_incoming.get("unit") or "kg",
            "qualityResult": str(latest_incoming.get("qualityCheck") or quality_check),
            "qualityNotes": notes or latest_incoming.get("qualityNotes") or latest_incoming.get("notes"),
            "customerName": customer_name,
            "customerPhone": latest_incoming.get("customerPhone") or customer.get("phone") or (order_record or {}).get("customerPhone") or (order_record or {}).get("phone"),
            # Preserve the structured address and its normalized locality fields for
            # future reports/integrations, even though the printed slip stays concise.
            "deliveryAddress": delivery_address,
            **address_fields,
            "orderItems": (order_record or {}).get("items") or latest_incoming.get("orderItems") or [],
            "customerSnapshot": customer,
            "orderSnapshot": order_record or {},
            "shipmentSnapshot": {
                "status": latest_incoming.get("status"),
                "sourceMode": latest_incoming.get("sourceMode"),
                "fulfillmentMethod": latest_incoming.get("fulfillmentMethod"),
                "batchNumber": latest_incoming.get("batchNumber"),
                "expectedDate": latest_incoming.get("expectedDate"),
                "createdAt": latest_incoming.get("createdAt"),
                "updatedAt": latest_incoming.get("updatedAt"),
                "notes": latest_incoming.get("notes"),
                "qualityNotes": latest_incoming.get("qualityNotes"),
                "pickupLocation": latest_incoming.get("pickupLocation"),
                "productId": str(latest_incoming.get("productId") or "") or None,
                "variantId": str(latest_incoming.get("variantId") or "") or None,
            },
            "recordedBy": str(current_user.get("_id") or ""),
        }
        await incoming_stock_repository.update(
            {"_id": latest_incoming.get("_id")},
            {"receipt": receipt, "receiptNumber": receipt_number},
        )
        incoming = await incoming_stock_repository.get_by_id(incoming_id) or incoming
    except Exception:
        logger.exception("Failed to persist receipt snapshot for incoming shipment %s", incoming_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stock was received but the receipt record could not be saved. Contact support before retrying receipt.",
        )

    # Notify farmer/customer when warehouse receiving changes the authoritative order workflow.
    try:
        order_id = incoming.get("orderId")
        if order_id:
            updated_order = await order_repository.get_by_id(str(order_id))
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage=updated_order.get("warehouseFulfillmentStage") or "received",
                    title=f"Order #{updated_order.get('orderNumber') or order_id}: warehouse receiving updated",
                    message=(
                        "The warehouse received the shipment and it passed quality check." if quality_check == "passed"
                        else "The warehouse received the shipment, but the quality check requires attention."
                    ),
                    actor_role="warehouse",
                    priority=NotificationPriority.HIGH if quality_check == "passed" else NotificationPriority.URGENT,
                )
    except Exception:
        logger.exception("Failed to notify workflow roles after warehouse receiving")

    def receipt_json_safe(value: Any) -> Any:
        if isinstance(value, ObjectId):
            return str(value)
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, dict):
            return {str(key): receipt_json_safe(child) for key, child in value.items()}
        if isinstance(value, (list, tuple)):
            return [receipt_json_safe(child) for child in value]
        return value

    return {
        "success": True,
        "data": receipt_json_safe(incoming),
        "message": (
            "Farmer Fulfillment shipment received. Continue to transfers or consolidation."
            if is_farmer_fulfillment
            else "Physical receipt recorded. Complete quality inspection before storage."
        )
    }

@router.put("/me/incoming/{incoming_id}/quality")
async def update_incoming_quality(
    incoming_id: str,
    data: WarehouseIncomingQualityRequest,
    current_user: dict = Depends(get_current_user),
):
    """Complete the warehouse quality gate after physical receipt.

    Receiving and quality are separate audited actions. A shipment must be
    physically received first, then approved/rejected here, and only an
    approved shipment may be stored into inventory.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can perform receiving quality checks")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    incoming = await incoming_stock_repository.get_by_id(incoming_id)
    if not incoming or str(incoming.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Incoming shipment not found")
    if str(incoming.get("sourceMode") or "") == "farmer_fulfillment_transfer":
        raise HTTPException(status_code=409, detail="Farmer Fulfillment orders are already packed. Skip warehouse quality inspection and continue to Farmer Fulfillment Transfers / Consolidation.")
    if str(incoming.get("status") or "") != "received":
        raise HTTPException(status_code=400, detail="Receive the physical shipment before quality inspection")
    if data.usableQuantity is not None and float(data.usableQuantity) > float(incoming.get("quantityReceived") or incoming.get("quantity") or 0):
        raise HTTPException(status_code=400, detail="Usable quantity cannot exceed received quantity")

    update: Dict[str, Any] = {
        "qualityCheck": data.qualityCheck,
        "qualityNotes": data.notes,
        "updatedAt": datetime.utcnow(),
    }
    if data.usableQuantity is not None:
        update["usableQuantity"] = float(data.usableQuantity)
    if data.qualityCheck == "failed":
        update["status"] = "rejected"
        update["qualityRejectedAt"] = datetime.utcnow()
    elif data.qualityCheck == "passed":
        update["qualityPassedAt"] = datetime.utcnow()
    # Keep the permanent receipt snapshot aligned with the latest quality decision
    # while retaining its original receipt number and receipt timestamp.
    existing_receipt = incoming.get("receipt") if isinstance(incoming.get("receipt"), dict) else {}
    receipt_update = dict(existing_receipt)
    receipt_update.update({
        "qualityResult": data.qualityCheck,
        "qualityNotes": data.notes,
        "usableQuantity": float(data.usableQuantity) if data.usableQuantity is not None else float(incoming.get("usableQuantity") or incoming.get("quantityReceived") or incoming.get("quantity") or 0),
        "rejectedQuantity": max(0.0, float(incoming.get("quantityReceived") or incoming.get("quantity") or 0) - (float(data.usableQuantity) if data.usableQuantity is not None else float(incoming.get("usableQuantity") or incoming.get("quantityReceived") or incoming.get("quantity") or 0))),
        "qualityRecheckedAt": datetime.utcnow(),
        "qualityRecheckedBy": str(current_user.get("_id") or ""),
    })
    update["receipt"] = receipt_update
    updated = await incoming_stock_repository.update({"_id": ObjectId(incoming_id)}, update)
    if not updated:
        raise HTTPException(status_code=400, detail="Unable to update incoming quality result")

    order_id = incoming.get("orderId")
    if order_id:
        order = await order_repository.get_by_id(str(order_id))
        if order:
            source_mode = str(incoming.get("sourceMode") or "")
            stage = "quality_rejected" if data.qualityCheck == "failed" else (
                "quality_approved" if source_mode == "farmer_fulfillment_transfer" else "received"
            )
            await order_repository.update(
                {"_id": ObjectId(str(order_id))},
                {"warehouseFulfillmentStage": stage, "updatedAt": datetime.utcnow()},
            )
            await order_repository.append_tracking_event(
                str(order_id),
                "warehouse_quality_" + data.qualityCheck,
                "Warehouse quality check " + ("passed" if data.qualityCheck == "passed" else "failed"),
                (
                    "Shipment passed warehouse quality inspection and can now be stored."
                    if data.qualityCheck == "passed"
                    else "Shipment failed warehouse quality inspection and is on hold/rejected pending resolution."
                ),
                actor_id=str(current_user["_id"]),
                actor_role="warehouse",
                metadata={"incomingStockId": incoming_id, "usableQuantity": update.get("usableQuantity")},
            )
            try:
                await NotificationService.send_order_workflow_update(
                    order,
                    stage=stage,
                    title=f"Order #{order.get('orderNumber') or order_id}: warehouse quality updated",
                    message=(
                        "Warehouse quality inspection passed. The shipment can now be stored."
                        if data.qualityCheck == "passed"
                        else "Warehouse quality inspection failed. The shipment is on hold/rejected."
                    ),
                )
            except Exception:
                logger.exception("Failed to notify after incoming quality update")

    return {"success": True, "data": await incoming_stock_repository.get_by_id(incoming_id)}

@router.put("/me/incoming/{incoming_id}/store")
async def store_incoming_stock(
    incoming_id: str,
    data: Optional[WarehouseIncomingStoreRequest] = None,
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can store incoming stock")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    existing_incoming = await incoming_stock_repository.get_by_id(incoming_id)
    if existing_incoming and str(existing_incoming.get("warehouseId")) == str(warehouse["_id"]) and str(existing_incoming.get("sourceMode") or "") == "farmer_fulfillment_transfer":
        raise HTTPException(status_code=409, detail="Farmer Fulfillment orders are already packed. Storage is optional; continue to Farmer Fulfillment Transfers / Consolidation instead of adding this order to bulk inventory.")
    if existing_incoming and existing_incoming.get("eventFulfillmentId"):
        if str(existing_incoming.get("qualityCheck") or "").lower() != "passed":
            raise HTTPException(status_code=409, detail="Event portion storage requires a passed quality check")
        event_fulfillments = MongoDB.get_collection("event_fulfillments")
        event_oid = existing_incoming.get("eventFulfillmentId")
        event_oid = event_oid if isinstance(event_oid, ObjectId) else ObjectId(str(event_oid))
        event_portion = await event_fulfillments.find_one({"_id": event_oid, "deletedAt": None})
        if not event_portion:
            raise HTTPException(status_code=409, detail="The Incoming Stock record references a missing event fulfillment portion")
        actual_received_before_store = existing_incoming.get("quantityReceived")
        if actual_received_before_store is None:
            actual_received_before_store = existing_incoming.get("receivedQuantity")
        if actual_received_before_store is None:
            actual_received_before_store = existing_incoming.get("actualQuantityReceived")
        if float(actual_received_before_store or 0) + 1e-9 < float(event_portion.get("allocatedQuantityKg") or 0):
            raise HTTPException(status_code=409, detail="Received quantity is below the allocated event portion; resolve the shortage before storing")
    if existing_incoming and data:
        received_quantity = float(
            existing_incoming.get("quantityReceived")
            if existing_incoming.get("quantityReceived") is not None
            else existing_incoming.get("quantity") or 0
        )
        usable_quantity = data.usableQuantity
        if usable_quantity is not None and usable_quantity > received_quantity + 1e-9:
            raise HTTPException(status_code=400, detail="Usable quantity cannot exceed the quantity physically received")
        store_updates: Dict[str, Any] = {"updatedAt": datetime.utcnow()}
        if usable_quantity is not None:
            store_updates["usableQuantity"] = float(usable_quantity)
            store_updates["quantityRejected"] = max(0.0, received_quantity - float(usable_quantity))
        if data.storageLocation:
            store_updates["storageLocation"] = data.storageLocation.strip()
        if data.storageType:
            store_updates["storageType"] = data.storageType
        if len(store_updates) > 1:
            await incoming_stock_repository.update({"_id": existing_incoming["_id"]}, store_updates)

    incoming = await WarehouseService.store_incoming(
        incoming_id,
        str(warehouse["_id"]),
        storage_location=(data.storageLocation.strip() if data and data.storageLocation else None),
    )
    if not incoming:
        raise HTTPException(status_code=400, detail="Incoming stock must be received and quality approved before storage")

    # Keep the separate Bulk/Event fulfillment record in sync with the physical
    # Incoming Stock commit. Without this link the event order never advances
    # to consolidated even after every product portion is stored.
    event_fulfillment_id = incoming.get("eventFulfillmentId")
    if event_fulfillment_id:
        if str(incoming.get("qualityCheck") or "").lower() != "passed":
            raise HTTPException(status_code=409, detail="Event portion storage requires a passed quality check")
        actual_received = incoming.get("quantityReceived")
        if actual_received is None:
            actual_received = incoming.get("receivedQuantity")
        if actual_received is None:
            actual_received = incoming.get("actualQuantityReceived")
        event_fulfillments = MongoDB.get_collection("event_fulfillments")
        event_oid = event_fulfillment_id if isinstance(event_fulfillment_id, ObjectId) else ObjectId(str(event_fulfillment_id))
        event_portion = await event_fulfillments.find_one({"_id": event_oid, "deletedAt": None})
        if not event_portion:
            raise HTTPException(status_code=409, detail="The Incoming Stock record references a missing event fulfillment portion")
        required = float(event_portion.get("allocatedQuantityKg") or 0)
        if float(actual_received or 0) + 1e-9 < required:
            raise HTTPException(status_code=409, detail="Received quantity is below the allocated event portion; resolve the shortage before storing")
        if str(event_portion.get("status") or "") != "stored":
            if not event_portion.get("inventoryFinalizedAt"):
                from app.repositories.inventory_repository import inventory_repository
                confirmed = await inventory_repository.atomic_confirm(str(event_portion.get("productId")), required)
                if not confirmed:
                    raise HTTPException(status_code=409, detail="Reserved event stock could not be finalized; verify inventory before completing storage")
            now = datetime.utcnow()
            await event_fulfillments.update_one({"_id": event_oid, "deletedAt": None}, {"$set": {
                "status": "stored", "warehouseStatus": "stored", "storedAt": now,
                "inventoryFinalizedAt": now, "inventoryFinalizationStatus": "confirmed",
                "updatedAt": now,
            }})
            request_id = event_portion.get("requestId")
            if request_id:
                bulk_requests = MongoDB.get_collection("bulk_requests")
                siblings = await event_fulfillments.find({"requestId": request_id, "deletedAt": None}).to_list(length=500)
                all_stored = bool(siblings) and all(str(s.get("status") or "") == "stored" for s in siblings)
                await bulk_requests.update_one({"_id": request_id, "deletedAt": None}, {"$set": {
                    "eventDeliveryStatus": "awaiting_local_hub_dispatch" if all_stored else "warehouse_receiving",
                    "eventConsolidationStatus": "consolidated" if all_stored else "warehouse_receiving",
                    "updatedAt": now,
                }})
    try:
        order_id = incoming.get("orderId")
        if order_id:
            updated_order = await order_repository.get_by_id(str(order_id))
            if updated_order:
                await NotificationService.send_order_workflow_update(
                    updated_order,
                    stage=updated_order.get("warehouseFulfillmentStage") or "stored",
                    title=f"Order #{updated_order.get('orderNumber') or order_id}: stock stored",
                    message="The warehouse has stored the received product. Order allocation and packing can proceed.",
                    actor_role="warehouse",
                )
    except Exception:
        logger.exception("Failed to notify workflow roles after warehouse storage")
    return {"success": True, "data": incoming, "message": "Stock stored successfully"}


@router.get("/me/packing-tasks", response_model=dict)
async def get_packing_tasks(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can access packing tasks")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse: raise HTTPException(status_code=404, detail="Warehouse not found")
    # Reconcile legacy bulk receipts whose UI still says "In Transit" even
    # though a persisted receipt proves physical arrival and the quality gate passed.
    # Never infer receipt from notes alone: require receipt timestamp/snapshot plus QC.
    try:
        candidate_rows = await incoming_stock_repository.find_many({
            "warehouseId": {"$in": [warehouse["_id"], str(warehouse["_id"])]},
            "status": {"$in": ["in_transit", "in transit", "received", "stored"]},
            "deletedAt": None,
        }, skip=0, limit=1000)
        for row in candidate_rows:
            if str(row.get("status") or "").strip().lower() not in ("in_transit", "in transit"):
                continue
            if str(row.get("sourceMode") or "").strip().lower() in ("farmer_fulfillment", "farmer_fulfillment_transfer"):
                continue
            receipt = row.get("receipt") if isinstance(row.get("receipt"), dict) else {}
            physically_received = bool(
                row.get("receivedAt") or row.get("receivedDate")
                or row.get("bulkShipmentReceivedAt") or receipt.get("receivedAt")
            )
            quality = str(
                row.get("qualityCheck") or row.get("quality_check")
                or receipt.get("qualityResult") or ""
            ).strip().lower()
            if physically_received and quality == "passed":
                await incoming_stock_repository.update({"_id": row["_id"]}, {
                    "status": "received",
                    "qualityCheck": "passed",
                    "updatedAt": datetime.utcnow(),
                })
        stored_rows = await incoming_stock_repository.find_many({
            "warehouseId": {"$in": [warehouse["_id"], str(warehouse["_id"])]},
            "status": {"$in": ["received", "stored"]},
            "deletedAt": None,
        }, skip=0, limit=1000)
        order_ids = {
            str(row.get("orderId"))
            for row in stored_rows
            if row.get("orderId")
            and str(row.get("sourceMode") or "").strip().lower() not in ("farmer_fulfillment", "farmer_fulfillment_transfer")
            and str(row.get("fulfillmentType") or "").strip().lower() not in ("farmer_fulfillment", "farmer_fulfillment_transfer", "farmer packed")
            and row.get("packingRequired") is not False
        }
        for order_id in order_ids:
            if not ObjectId.is_valid(order_id):
                continue
            order = await order_repository.get_by_id(order_id)
            if not order:
                continue
            # The eligible incoming-stock row is authoritative for legacy warehouse
            # fulfillment records; older customer orders may lack fulfillmentMethod.
            await WarehouseService.ensure_order_packing_task(order_id, str(warehouse["_id"]))
    except Exception:
        logger.exception("Failed to reconcile stored warehouse orders into packing tasks")

    tasks = await warehouse_packing_repository.get_by_warehouse(str(warehouse["_id"]), status)
    tasks = _make_json_safe(tasks)
    for task in tasks:
        task["id"] = str(task["_id"])
        for key in ("warehouseId","orderId","farmerId","productId","variantId","batchId"):
            if task.get(key) is not None: task[key] = str(task[key])
        if task.get("orderId"):
            order = await order_repository.get_by_id(str(task["orderId"]))
            if order:
                task["orderNumber"] = order.get("orderNumber")
                task["deliveryAddress"] = order.get("deliveryAddress") or {}
                for payment_key in (
                    "paymentMethod", "payment_method", "paymentMode", "paymentType",
                    "paymentStatus", "payment_status", "totalAmount", "grandTotal",
                    "payableAmount", "finalPayableAmount", "total", "cashOnDelivery",
                ):
                    if order.get(payment_key) is not None:
                        task[payment_key] = _make_json_safe(order[payment_key])
                if isinstance(order.get("payment"), dict):
                    task["payment"] = _make_json_safe(order["payment"])
                # Expose source-farm details for the packing UI. Legacy packing
                # tasks may have no farmName, but the linked order/product/profile
                # often still has the farmer reference and farm address.
                order_items = order.get("items") or []
                first_order_item = order_items[0] if order_items else {}
                product_ref = str(task.get("productId") or first_order_item.get("productId") or "")
                product_doc = None
                if product_ref and ObjectId.is_valid(product_ref):
                    product_doc = await MongoDB.get_collection("products").find_one({"_id": ObjectId(product_ref), "deletedAt": None})
                farmer_refs = [
                    task.get("farmerId"), order.get("farmerId"), order.get("farmer_id"),
                    first_order_item.get("farmerId"), first_order_item.get("farmer_id"),
                    (product_doc or {}).get("farmerId"), (product_doc or {}).get("farmer_id"),
                    (product_doc or {}).get("ownerId"), (product_doc or {}).get("sellerId"),
                ]
                farmer_profile = None
                resolved_farmer_ref = ""
                for farmer_ref in farmer_refs:
                    if not farmer_ref:
                        continue
                    farmer_key = str(farmer_ref)
                    if not ObjectId.is_valid(farmer_key):
                        continue
                    farmer_profile = await farmer_repository.get_by_user_id(farmer_key)
                    if not farmer_profile:
                        farmer_profile = await farmer_repository.get_by_id(farmer_key)
                    if farmer_profile:
                        resolved_farmer_ref = farmer_key
                        break
                farmer_profile = farmer_profile or {}
                farmer_user_id = str(farmer_profile.get("userId") or resolved_farmer_ref or "")
                farmer_user = await UserService.get_user_by_id(farmer_user_id) if farmer_user_id and ObjectId.is_valid(farmer_user_id) else None
                farmer_name = (
                    farmer_profile.get("farmName") or farmer_profile.get("ownerName")
                    or farmer_profile.get("fullName") or farmer_profile.get("name")
                    or (product_doc or {}).get("farmName") or (product_doc or {}).get("farmerName")
                    or order.get("farmerName")
                )
                if not farmer_name and farmer_user:
                    farmer_name = " ".join(filter(None, [farmer_user.get("firstName"), farmer_user.get("lastName")]))
                    farmer_name = farmer_name or farmer_user.get("name") or farmer_user.get("displayName")
                farm_address = (
                    farmer_profile.get("farmAddress") or farmer_profile.get("address")
                    or farmer_profile.get("location") or order.get("farmAddress")
                    or order.get("pickupAddress") or (product_doc or {}).get("farmAddress")
                    or (product_doc or {}).get("farmLocation") or {}
                )
                if isinstance(farm_address, dict):
                    farm_address = ", ".join(str(farm_address.get(k)).strip() for k in (
                        "addressLine1", "addressLine2", "street", "village", "city", "district", "state", "pincode", "formattedAddress", "address"
                    ) if farm_address.get(k) and str(farm_address.get(k)).strip())
                task["farmerId"] = resolved_farmer_ref or str(task.get("farmerId") or order.get("farmerId") or "")
                task["farmId"] = str(farmer_profile.get("_id") or resolved_farmer_ref or task["farmerId"] or "")
                task["farmName"] = str(farmer_name or "").strip()
                task["farmerName"] = str(farmer_name or "").strip()
                task["farmAddress"] = str(farm_address or "").strip()
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
    return _make_json_safe({"success": True, "data": {"tasks": tasks}})

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
    await warehouse_packing_repository.update_task(task_id, {"packingTeamId": data.packingTeamId, "status": "assigned", "packingTeamAssignedAt": datetime.utcnow()})
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
    await warehouse_packing_repository.update_task(task_id, {"status":"packing", "packingStartedAt": datetime.utcnow()})
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
        # Inventory availability is only a planning estimate. If a legacy client
        # omits actual quantities, default to the ordered quantities; do not
        # create a shortage from the bulk-stock ledger before physical packing.
        for line in packing_items:
            key = (str(line.get("productId")), str(line.get("variantId") or ""))
            requested[key] = float(line.get("quantityRequired") or 0)

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
    # A final shortage is a completed packing result that must wait for the
    # customer decision; it must not remain an active packing task or dispatch.
    packed_status = "packed" if all_packed else "customer_approval_pending"

    await warehouse_packing_repository.update_task(
        task_id,
        {
            "packedQuantity": packed_total,
            "packingItems": packing_items,
            "packageId": data.packageId or f"PKG-{str(task['_id'])[-8:]}",
            "packingNotes": data.notes,
            "packingCompletedAt": datetime.utcnow(),
            "packedAt": datetime.utcnow(),
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
        # Finish Order is the single physical quantity check and packing
        # verification action. When every actual quantity matches the final
        # order quantities, create/reuse outgoing rows and mark the order ready
        # for dispatch immediately; no second verification click is required.
        order_id = str(task["orderId"])
        for line in packing_items:
            existing = await outgoing_stock_repository.get_by_order_id(
                order_id, str(line["productId"]), str(line.get("variantId") or ""),
                warehouse_id=str(warehouse["_id"]),
            )
            if not existing:
                created = await WarehouseService.create_outgoing(OutgoingStockCreate(
                    warehouseId=str(warehouse["_id"]),
                    productId=str(line["productId"]),
                    variantId=str(line.get("variantId")) if line.get("variantId") else None,
                    orderId=order_id,
                    quantity=int(float(line.get("packedQuantity") or 0)),
                    batchNumber=line.get("batchNumber"),
                ))
                if not created:
                    # Do not leave a failed Finish Order attempt marked "packed".
                    # That made the next attempt fail with "Task is not packable".
                    # Revert the task to a resumable packing stage and report the
                    # actual inventory/warehouse mismatch without claiming dispatch succeeded.
                    await warehouse_packing_repository.update_task(task_id, {
                        "status": "packing",
                        "verified": False,
                        "packingAttemptComplete": False,
                        "packingItems": packing_items,
                        "packedQuantity": packed_total,
                    })
                    order_warehouse_id = str(order.get("warehouseId") or "")
                    task_warehouse_id = str(warehouse.get("_id") or "")
                    if str(order.get("fulfillmentMethod") or "").lower() != "warehouse" and str(order.get("logisticsMode") or "") != "farmer_to_warehouse_to_local_hub_to_delivery_partner":
                        reason = "The customer order is not marked for warehouse fulfillment."
                    elif order_warehouse_id and order_warehouse_id != task_warehouse_id:
                        reason = "The order is assigned to a different warehouse than this packing task."
                    else:
                        reason = "Available warehouse stock for this product/variant is missing or insufficient. Confirm Incoming Stock has been received, quality-approved, and stored in warehouse inventory before finishing packing."
                    raise HTTPException(
                        status_code=400,
                        detail=f"Could not create dispatch record for {line.get('productName') or line.get('productId')}. {reason} The packing task has been kept resumable; correct the warehouse/order data and click Finish Order again.",
                    )
        await warehouse_packing_repository.update_task(task_id, {
            "status": "ready_for_dispatch",
            "verified": True,
            "verifiedAt": datetime.utcnow(),
            "packingItems": [{**line, "verified": True} for line in packing_items],
        })
        await order_repository.update(
            {"_id": ObjectId(order_id)},
            {
                "warehouseFulfillmentStage": "ready_for_dispatch",
                "packingComplete": True,
                "packingVerified": True,
                "packingTaskId": task["_id"],
                "shortageResolutionRequired": False,
                "shortageResolved": True,
                "updatedAt": datetime.utcnow(),
            },
        )
        event = ("packing_completed_verified", "Packing completed and checked",
                 "Actual packed quantities were checked during Finish Order. All quantities match the final order; dispatch records are ready.")
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
                "productName": line.get("productName") or "Product",
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
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can verify packing")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    task = await warehouse_packing_repository.get_by_id(task_id)
    if not warehouse or not task or str(task.get("warehouseId")) != str(warehouse["_id"]):
        raise HTTPException(status_code=404, detail="Packing task not found")

    if not data.verified:
        await warehouse_packing_repository.update_task(task_id, {
            "verified": False,
            "verificationNotes": data.notes,
            "status": "packed",
        })
        return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

    packing_items = task.get("packingItems") or []
    if not packing_items:
        raise HTTPException(status_code=400, detail="Packing checklist is missing. Re-sync the warehouse packing task before verification.")
    if float(task.get("packedQuantity") or 0) + 1e-9 < float(task.get("quantityRequired") or 0):
        raise HTTPException(status_code=400, detail="Complete the required quantity before verification")
    incomplete = [
        item for item in packing_items
        if float(item.get("packedQuantity") or 0) + 1e-9 < float(item.get("quantityRequired") or 0)
    ]
    if incomplete:
        names = ", ".join(str(item.get("productName") or item.get("productId") or "Product") for item in incomplete)
        raise HTTPException(status_code=400, detail=f"Every customer order item must be completely packed before verification: {names}")

    order_id = str(task.get("orderId") or "")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Packing task has no valid customer order")

    # Ensure every order line has an outgoing record before marking the task
    # verified/ready for dispatch. Existing rows are reused, so retries are safe.
    for line in packing_items:
        existing = await outgoing_stock_repository.get_by_order_id(
            order_id, str(line["productId"]), str(line.get("variantId") or ""),
            warehouse_id=str(warehouse["_id"]),
        )
        if not existing:
            created = await WarehouseService.create_outgoing(OutgoingStockCreate(
                warehouseId=str(warehouse["_id"]),
                productId=str(line["productId"]),
                variantId=str(line.get("variantId")) if line.get("variantId") else None,
                orderId=order_id,
                quantity=int(line.get("packedQuantity") or 0),
                batchNumber=line.get("batchNumber"),
            ))
            if not created:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not create dispatch record for {line.get('productName') or line.get('productId')}",
                )

    await warehouse_packing_repository.update_task(task_id, {
        "verified": True,
        "verifiedAt": datetime.utcnow(),
        "verificationNotes": data.notes,
        "status": "ready_for_dispatch",
        "packingItems": [{**item, "verified": True} for item in packing_items],
    })
    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "warehouseFulfillmentStage": "ready_for_dispatch",
            "packingComplete": True,
            "packingVerified": True,
            "packingTaskId": task["_id"],
            "updatedAt": datetime.utcnow(),
        },
    )
    await order_repository.append_tracking_event(
        order_id,
        "packing_verified",
        "Packing verified",
        "Every product in the customer order was packed and verified. The complete package is ready for dispatch.",
        actor_id=str(current_user["_id"]),
        actor_role="warehouse",
        metadata={
            "packageId": task.get("packageId"),
            "quantity": task.get("packedQuantity", 0),
            "itemCount": len(packing_items),
        },
    )
    return {"success": True, "data": await warehouse_packing_repository.get_by_id(task_id)}

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

    # Farmer Fulfillment is already packed by the farmer. Its warehouse
    # records are transfer/receiving legs only and must never enter the normal
    # warehouse packing/outgoing delivery pipeline.
    if str(order.get("fulfillmentMethod") or "") == "farmer":
        raise HTTPException(
            status_code=409,
            detail="Farmer Fulfillment uses the Farmer Fulfillment transfer/consolidation workflow; warehouse packing and outgoing routing are not allowed.",
        )

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

    await order_repository.update(
        {"_id": ObjectId(str(order_id))},
        {
            "warehouseFulfillmentStage": "dispatched",
            "orderStatus": "ready_for_delivery",
            "dispatchedAt": datetime.utcnow(),
            "deliveryDispatchStatus": "dispatched",
            "deliveryDispatchAt": datetime.utcnow(),
            "updatedAt": datetime.utcnow(),
        },
    )

    refreshed_dispatch_order = await order_repository.get_by_id(str(order_id))
    if refreshed_dispatch_order:
        try:
            await NotificationService.send_order_workflow_update(
                refreshed_dispatch_order,
                status="ready_for_delivery",
                stage="dispatched",
                title=f"Order #{order.get('orderNumber')}: warehouse dispatch complete",
                message="The complete warehouse-fulfilled order has left the warehouse and is ready for the downstream delivery handoff.",
                actor_role="warehouse",
                priority=NotificationPriority.HIGH,
            )
        except Exception:
            logger.exception("Failed to notify after warehouse dispatch")

    # Long-distance Warehouse Fulfillment must complete the physical
    # warehouse -> local-hub transfer before any delivery partner sees a job.
    # The existing hub receive/dispatch workflow becomes the downstream gate.
    if data.route == "long_distance" and str(order.get("fulfillmentMethod") or "") == "warehouse":
        await order_repository.update(
            {"_id": ObjectId(str(order_id))},
            {
                "deliveryDecisionStatus": "hub_handoff_pending",
                "partnerAssignmentOpen": False,
                "updatedAt": datetime.utcnow(),
            },
        )
        await order_repository.append_tracking_event(
            str(order_id),
            "warehouse_dispatch_waiting_for_hub",
            "Warehouse shipment dispatched; local-hub receipt required",
            "The warehouse shipment is dispatched. Delivery partner assignment opens only after the local hub receives the shipment.",
            actor_id=str(current_user["_id"]),
            actor_role="warehouse",
            metadata={"route": "long_distance"},
        )
        return {
            "success": True,
            "data": {**result, "deliveryJob": None},
            "message": "Warehouse shipment dispatched. Waiting for local-hub receipt before delivery-partner assignment.",
        }

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



@router.post("/me/farmer-fulfillment/{order_id}/return-to-farmer")
async def return_farmer_fulfillment_to_farmer(
    order_id: str,
    payload: WarehouseFarmerReturnRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create an auditable warehouse -> farmer return/rejection handoff.

    This is used when a packed Farmer Fulfillment portion cannot continue
    because of quantity/quality/damage/transfer exceptions. It never creates
    a warehouse packing task.
    """
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can return a farmer fulfillment shipment")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")

    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("fulfillmentMethod") or "") != "farmer":
        raise HTTPException(status_code=404, detail="Farmer fulfillment order not found")

    warehouse_id = str(warehouse["_id"])
    assigned_ids = {str(x) for x in (order.get("warehouseIds") or [])}
    if str(order.get("warehouseId") or ""):
        assigned_ids.add(str(order.get("warehouseId")))
    if warehouse_id not in assigned_ids:
        raise HTTPException(status_code=403, detail="This order is not assigned to your warehouse")

    if str(order.get("orderStatus") or "").lower() in {"delivered", "completed", "cancelled", "refunded"}:
        raise HTTPException(status_code=400, detail="Order is no longer eligible for a warehouse-to-farmer return")

    now = datetime.utcnow()
    transfers = MongoDB.get_collection("warehouse_farmer_transfers")
    existing = await transfers.find_one({
        "orderId": ObjectId(order_id),
        "warehouseId": ObjectId(warehouse_id),
        "direction": "warehouse_to_farmer",
        "status": {"$in": ["pending_farmer_acceptance", "accepted"]},
        "deletedAt": None,
    })
    if existing:
        return {"success": True, "data": {"transferId": str(existing["_id"]), "status": existing["status"], "existing": True}}

    allocations = [
        x for x in (order.get("warehouseAllocations") or [])
        if str(x.get("warehouseId")) == warehouse_id
    ]
    if not allocations and str(order.get("warehouseId") or "") == warehouse_id:
        allocations = [{
            "warehouseId": warehouse_id,
            "productId": x.get("productId"),
            "variantId": x.get("variantId"),
            "productName": x.get("productName") or "Product",
            "quantity": x.get("quantity"),
            "unit": x.get("unit") or "kg",
        } for x in (order.get("items") or [])]

    if not allocations:
        raise HTTPException(status_code=400, detail="No assigned shipment portion exists for this warehouse")

    items = []
    remaining = payload.quantity
    for allocation in allocations:
        qty = float(allocation.get("quantity") or 0)
        if remaining is not None:
            if remaining <= 0:
                break
            take = min(qty, remaining)
            remaining -= take
        else:
            take = qty
        if take > 0:
            items.append({
                "productId": allocation.get("productId"),
                "variantId": allocation.get("variantId"),
                "productName": allocation.get("productName") or "Product",
                "quantity": round(float(take), 3),
                "unit": allocation.get("unit") or "kg",
            })
    if not items:
        raise HTTPException(status_code=400, detail="Return quantity does not match the assigned warehouse portion")

    doc = {
        "orderId": ObjectId(order_id),
        "orderNumber": order.get("orderNumber"),
        "farmerId": ObjectId(str(order["farmerId"])),
        "warehouseId": ObjectId(warehouse_id),
        "direction": "warehouse_to_farmer",
        "status": "pending_farmer_acceptance",
        "reason": payload.reason,
        "notes": payload.notes,
        "items": items,
        "createdBy": ObjectId(str(current_user["_id"])),
        "createdAt": now,
        "updatedAt": now,
        "deletedAt": None,
    }
    result = await transfers.insert_one(doc)
    transfer_id = result.inserted_id

    await order_repository.update(
        {"_id": ObjectId(order_id)},
        {
            "warehouseReturnStatus": "pending_farmer_acceptance",
            "warehouseReturnTransferId": transfer_id,
            "warehouseReturnReason": payload.reason,
            "warehouseReturnRequestedAt": now,
            "warehouseReturnWarehouseId": ObjectId(warehouse_id),
            "transferStatus": "warehouse_to_farmer_pending",
            "updatedAt": now,
        },
    )

    farmer_id = str(order["farmerId"])
    try:
        await NotificationService.create_in_app_notification(
            farmer_id,
            NotificationType.WAREHOUSE,
            "Warehouse return request",
            f"Warehouse {warehouse.get('name') or 'your assigned warehouse'} requested a return for order {order.get('orderNumber', order_id)}: {payload.reason}",
            data={
                "type": "warehouse_to_farmer_return",
                "transferId": str(transfer_id),
                "orderId": order_id,
                "warehouseId": warehouse_id,
            },
            priority=NotificationPriority.URGENT,
            mandatory=True,
        )
    except Exception:
        logger.exception("Failed to notify farmer about warehouse return request")

    return {
        "success": True,
        "data": {"transferId": str(transfer_id), "status": "pending_farmer_acceptance"},
        "message": "Warehouse-to-farmer return request created and sent to the farmer.",
    }


@router.put("/me/farmer-fulfillment/returns/{transfer_id}/dispatch")
async def dispatch_farmer_return(transfer_id: str, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can dispatch farmer returns")
    if not ObjectId.is_valid(transfer_id):
        raise HTTPException(status_code=400, detail="Invalid return transfer ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    transfers = MongoDB.get_collection("warehouse_farmer_transfers")
    transfer = await transfers.find_one({
        "_id": ObjectId(transfer_id),
        "warehouseId": ObjectId(str(warehouse["_id"])),
        "direction": "warehouse_to_farmer",
        "deletedAt": None,
    })
    if not transfer:
        raise HTTPException(status_code=404, detail="Return transfer not found")
    if transfer.get("status") != "accepted":
        raise HTTPException(status_code=400, detail="Farmer must accept the return before dispatch")

    now = datetime.utcnow()
    await transfers.update_one({"_id": transfer["_id"]}, {"$set": {
        "status": "in_transit_to_farmer",
        "dispatchedAt": now,
        "updatedAt": now,
    }})
    await order_repository.update({"_id": transfer["orderId"]}, {
        "transferStatus": "warehouse_to_farmer_in_transit",
        "warehouseReturnStatus": "in_transit_to_farmer",
        "updatedAt": now,
    })
    try:
        await order_repository.append_tracking_event(
            str(transfer["orderId"]), "warehouse_return_dispatched",
            "Warehouse return dispatched to farmer",
            "The warehouse has dispatched the returned farmer-fulfillment shipment.",
            actor_id=str(current_user["_id"]), actor_role="warehouse",
            metadata={"transferId": transfer_id},
        )
    except Exception:
        logger.exception("Failed to append farmer return dispatch event")
    return {"success": True, "data": {"transferId": transfer_id, "status": "in_transit_to_farmer"}}


@router.get("/me/farmer-fulfillment/{order_id}/return-status")
async def get_farmer_fulfillment_return_status(
    order_id: str,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can view warehouse-to-farmer returns")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    transfer = await MongoDB.get_collection("warehouse_farmer_transfers").find_one({
        "orderId": ObjectId(order_id),
        "warehouseId": ObjectId(str(warehouse["_id"])),
        "direction": "warehouse_to_farmer",
        "deletedAt": None,
    }, sort=[("createdAt", -1)])
    if not transfer:
        return {"success": True, "data": None}
    transfer["id"] = str(transfer["_id"])
    transfer["_id"] = str(transfer["_id"])
    for key in ("orderId", "farmerId", "warehouseId", "createdBy"):
        if transfer.get(key) is not None:
            transfer[key] = str(transfer[key])
    return {"success": True, "data": transfer}


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
    # Reconcile finished warehouse packing tasks before listing outgoing shipments.
    # Older/partially failed Finish Order requests can leave a task marked "packed"
    # without an outgoing row. Recover those rows idempotently when actual quantities
    # are complete; never dispatch a shortage or a farmer-fulfillment order here.
    ready_tasks = await warehouse_packing_repository.get_by_warehouse(
        str(warehouse["_id"]), status="all", limit=500
    )
    for task in ready_tasks:
        task_status = str(task.get("status") or "").strip().lower()
        if task_status not in {"packed", "verified", "ready_for_dispatch", "dispatched"}:
            continue
        order_id = str(task.get("orderId") or "")
        if not ObjectId.is_valid(order_id):
            continue
        order = await order_repository.get_by_id(order_id)
        fulfillment_method = str(
            (order or {}).get("fulfillmentMethod")
            or (order or {}).get("fulfillment_method")
            or ""
        ).strip().lower().replace("-", "_").replace(" ", "_")
        if not order or fulfillment_method not in {"warehouse", "warehouse_fulfillment"}:
            # Farmer Fulfillment uses its dedicated transfer workflow.
            continue
        if str(order.get("warehouseId") or "") != str(warehouse["_id"]):
            continue
        if bool(order.get("shortageResolutionRequired")) or str(
            order.get("warehouseFulfillmentStage") or ""
        ).lower() == "shortage_pending":
            continue
        task_lines = task.get("packingItems") or []
        if not task_lines or any(
            float(line.get("packedQuantity") or 0) + 1e-9 < float(line.get("quantityRequired") or 0)
            or float(line.get("quantityShort") or 0) > 1e-9
            for line in task_lines
        ):
            continue

        # The persisted physical packing result is authoritative. Do not call
        # create_outgoing() here because it reserves stock again and can reject
        # a valid packed order whose stock was already consumed at receiving.
        all_rows_created = True
        for line in task_lines:
            product_id = str(line.get("productId") or "")
            if not ObjectId.is_valid(product_id):
                all_rows_created = False
                continue
            variant_id = str(line.get("variantId") or "")
            existing = await outgoing_stock_repository.get_by_order_id(
                order_id, product_id, variant_id,
                warehouse_id=str(warehouse["_id"]),
            )
            if existing:
                continue
            quantity = float(line.get("packedQuantity") or line.get("quantityRequired") or 0)
            if quantity <= 0:
                continue
            created_id = await outgoing_stock_repository.create_outgoing({
                "warehouseId": ObjectId(str(warehouse["_id"])),
                "productId": ObjectId(product_id),
                "variantId": ObjectId(variant_id) if ObjectId.is_valid(variant_id) else None,
                "orderId": ObjectId(order_id),
                "quantity": quantity,
                "batchNumber": line.get("batchNumber"),
                "packingTaskId": task.get("_id"),
                "packageId": task.get("packageId"),
                "source": "finished_packing_reconciliation",
            })
            if not created_id:
                all_rows_created = False

        if all_rows_created and task_status != "dispatched":
            await warehouse_packing_repository.update_task(str(task["_id"]), {
                "status": "ready_for_dispatch",
                "verified": True,
                "verifiedAt": task.get("verifiedAt") or datetime.utcnow(),
                "packingItems": [{**line, "verified": True} for line in task_lines],
            })
            await order_repository.update(
                {"_id": ObjectId(order_id)},
                {
                    "warehouseFulfillmentStage": "ready_for_dispatch",
                    "packingComplete": True,
                    "packingVerified": True,
                    "packingTaskId": task["_id"],
                    "updatedAt": datetime.utcnow(),
                },
            )

    skip = (page - 1) * limit
    outgoing, total = await WarehouseService.get_outgoing_stock(
        str(warehouse["_id"]),
        status,
        skip,
        limit
    )
    # Only explicitly warehouse-fulfilled orders with a verified packing task
    # may appear here. Farmer fulfillment belongs to its separate transfer page.
    eligible_outgoing = []
    for item in outgoing:
        order_id = str(item.get("orderId") or "")
        if not ObjectId.is_valid(order_id):
            continue
        order = await order_repository.get_by_id(order_id)
        fulfillment_method = str((order or {}).get("fulfillmentMethod") or (order or {}).get("fulfillment_method") or "").strip().lower()
        if not order or fulfillment_method not in {"warehouse", "warehouse_fulfillment", "warehouse-fulfillment"}:
            continue
        if bool(order.get("shortageResolutionRequired")) or str(order.get("warehouseFulfillmentStage") or "").lower() == "shortage_pending":
            continue
        task_id = str(item.get("packingTaskId") or "")
        task = await warehouse_packing_repository.get_by_id(task_id) if ObjectId.is_valid(task_id) else None
        if not task:
            tasks = await warehouse_packing_repository.get_by_order_all(order_id)
            task = next((t for t in tasks if str(t.get("warehouseId") or "") == str(warehouse["_id"])), None)
        task_status = str((task or {}).get("status") or "").strip().lower()
        if not task or str(task.get("warehouseId") or "") != str(warehouse["_id"]) or task_status not in {"ready_for_dispatch", "dispatched"}:
            continue
        task_lines = task.get("packingItems") or []
        if not task_lines or any(
            float(line.get("packedQuantity") or 0) + 1e-9 < float(line.get("quantityRequired") or 0)
            or float(line.get("quantityShort") or 0) > 1e-9
            for line in task_lines
        ):
            continue
        item["packingStatus"] = task_status
        item["packingVerified"] = task_status in {"ready_for_dispatch", "dispatched"} or bool(task.get("verified"))
        eligible_outgoing.append(item)
    outgoing = eligible_outgoing

    # Reconcile legacy outgoing rows against existing local-hub transfer records.
    # Older dispatches may have a transfer marked dispatched while their outgoing
    # stock row still says ready_for_pickup/ready_for_dispatch.
    transfer_collection = MongoDB.get_collection("warehouse_order_transfers")
    dispatched_transfer_states = {
        "dispatched", "in_transit", "arrived_at_destination", "received", "ready_for_delivery"
    }
    for item in outgoing:
        order_id = str(item.get("orderId") or "")
        if not ObjectId.is_valid(order_id):
            continue
        transfer = await transfer_collection.find_one({
            "orderId": {"$in": [ObjectId(order_id), order_id]},
            "sourceWarehouseId": {"$in": [warehouse["_id"], str(warehouse["_id"])]},
            "deletedAt": None,
            "status": {"$in": list(dispatched_transfer_states)},
        }, sort=[("updatedAt", -1)])
        if not transfer:
            continue
        destination_id = transfer.get("destinationWarehouseId")
        destination_id_text = str(destination_id or "")
        destination_hub = await MongoDB.get_collection("warehouses").find_one({
            "_id": ObjectId(destination_id_text) if ObjectId.is_valid(destination_id_text) else destination_id,
            "facilityType": "local_hub",
            "deletedAt": None,
        })
        if not destination_hub:
            continue
        dispatched_at = transfer.get("dispatchedAt") or transfer.get("updatedAt") or transfer.get("createdAt")
        item.update({
            "status": "dispatched",
            "transferStatus": "dispatched_to_local_hub",
            "destinationWarehouseId": destination_id_text,
            "localHubId": destination_id_text,
            "localHubName": destination_hub.get("name") or destination_hub.get("warehouseName") or destination_hub.get("hubName") or "Local hub",
            "dispatchDate": dispatched_at.isoformat() if hasattr(dispatched_at, "isoformat") else dispatched_at,
        })
        outgoing_id = item.get("id") or item.get("_id")
        if outgoing_id:
            try:
                await outgoing_stock_repository.update({"_id": ObjectId(str(outgoing_id))}, {
                    "status": "dispatched",
                    "transferStatus": "dispatched_to_local_hub",
                    "destinationWarehouseId": destination_hub["_id"],
                    "destinationFacilityType": "local_hub",
                    "localHubId": destination_hub["_id"],
                    "localHubName": item["localHubName"],
                    "localHubTransferId": transfer.get("_id"),
                    "dispatchedAt": dispatched_at or datetime.utcnow(),
                    "updatedAt": datetime.utcnow(),
                })
            except Exception as exc:
                logger.warning("Could not reconcile outgoing status for order %s: %s", order_id, exc)

    # Enrich ordinary warehouse dispatch rows with the same distance/district
    # classification used by Farmer Fulfillment Transfers. Resolve saved-address
    # snapshots for legacy orders before deciding location data is missing.
    warehouse_location = warehouse.get("location") or warehouse.get("coordinates") or (warehouse.get("address", {}).get("location") if isinstance(warehouse.get("address"), dict) else None) or {}
    warehouse_address = warehouse.get("address") if isinstance(warehouse.get("address"), dict) else {}
    warehouse_location_data = warehouse.get("location") if isinstance(warehouse.get("location"), dict) else {}
    source_district = str(
        warehouse.get("district") or warehouse.get("districtName") or warehouse_address.get("district")
        or warehouse_address.get("districtName") or warehouse_location_data.get("district")
        or warehouse_address.get("city") or warehouse_address.get("town") or ""
    ).strip()

    def _first_location(*values):
        for value in values:
            if isinstance(value, (list, tuple)) and len(value) >= 2:
                try:
                    # GeoJSON coordinate arrays use [longitude, latitude].
                    candidate = {"coordinates": list(value)}
                    if distance_km(candidate, candidate) is not None:
                        return candidate
                except (TypeError, ValueError):
                    pass
                continue
            if not isinstance(value, dict):
                continue
            # Accept GeoJSON, lat/lng, nested location objects, and common
            # legacy forms where coordinates are stored directly on address.
            if distance_km(value, value) is not None:
                return value
            for key in ("location", "coordinates", "geo", "geoLocation", "geo_location", "position", "addressLocation"):
                nested = value.get(key)
                if isinstance(nested, (list, tuple)) and len(nested) >= 2:
                    nested = {"coordinates": list(nested)}
                if isinstance(nested, dict) and distance_km(nested, nested) is not None:
                    return nested
        return None

    for item in outgoing:
        order_id_for_route = str(item.get("orderId") or "")
        order_for_route = await order_repository.get_by_id(order_id_for_route) if ObjectId.is_valid(order_id_for_route) else None
        if not order_for_route:
            item.update({"routeCategory": "needs_location", "routeDataComplete": False, "routeDecisionReason": "Order details are unavailable"})
            continue
        # Farmer-packed transfers must never be routed from this queue.
        if str(order_for_route.get("fulfillmentMethod") or "").strip().lower() == "farmer":
            item.update({"routeCategory": "farmer_fulfillment_transfer", "routeDataComplete": False, "routeDecisionReason": "Continue in Farmer Fulfillment Transfers"})
            continue

        address_value = order_for_route.get("deliveryAddress") or order_for_route.get("shippingAddress") or {}
        address = address_value if isinstance(address_value, dict) else {}
        shipping = order_for_route.get("shippingAddress") if isinstance(order_for_route.get("shippingAddress"), dict) else {}
        saved_address = None
        customer_id = str(order_for_route.get("customerId") or "")
        address_id = str(order_for_route.get("deliveryAddressId") or order_for_route.get("shippingAddressId") or "")
        if customer_id and ObjectId.is_valid(customer_id):
            if address_id and ObjectId.is_valid(address_id):
                try:
                    saved_address = await address_repository.get_address_by_id(address_id, customer_id)
                except Exception:
                    saved_address = None
            # The order snapshot may contain a city/district but still omit
            # coordinates. Resolve a saved address whenever the explicit ID did
            # not resolve; do not skip lookup just because partial text exists.
            if not saved_address:
                try:
                    saved_addresses = await address_repository.get_user_addresses(customer_id)
                except Exception:
                    saved_addresses = []
                saved_address = next((a for a in saved_addresses if a.get("isDefault") or a.get("is_default")), None)
                if not saved_address and len(saved_addresses) == 1:
                    saved_address = saved_addresses[0]

        # Keep the checkout snapshot as highest priority, then fill gaps from
        # saved address records and legacy top-level delivery fields.
        destination_location = _first_location(
            address.get("location"), address.get("coordinates"), address.get("geoLocation"), address.get("geo_location"), address.get("position"), address,
            shipping.get("location"), shipping.get("coordinates"), shipping.get("geoLocation"), shipping.get("geo_location"), shipping,
            saved_address.get("location") if saved_address else None,
            saved_address.get("coordinates") if saved_address else None,
            order_for_route.get("customerLocation"), order_for_route.get("deliveryLocation"),
        )
        destination_district = str(
            address.get("district") or address.get("districtName") or address.get("district_name")
            or shipping.get("district") or shipping.get("districtName") or shipping.get("district_name")
            or (saved_address or {}).get("district") or (saved_address or {}).get("districtName")
            or (saved_address or {}).get("district_name")
            or order_for_route.get("deliveryDistrict") or order_for_route.get("destinationDistrict")
            or order_for_route.get("customerDistrict") or order_for_route.get("district")
            or address.get("city") or address.get("town") or address.get("municipality")
            or shipping.get("city") or shipping.get("town")
            or (saved_address or {}).get("city") or (saved_address or {}).get("town")
            or (saved_address or {}).get("municipality") or ""
        ).strip()
        threshold = float(order_for_route.get("nearbyDeliveryThresholdKm") or warehouse.get("nearbyDeliveryThresholdKm") or 15.0)
        calculated_distance = distance_km(warehouse_location, destination_location) if warehouse_location and destination_location else None
        allocations = order_for_route.get("warehouseAllocations") or order_for_route.get("sourceWarehouseAllocations") or []
        source_ids = {str(x.get("warehouseId") or x.get("sourceWarehouseId")) for x in allocations if isinstance(x, dict) and (x.get("warehouseId") or x.get("sourceWarehouseId"))}
        direct_configured = bool(
            order_for_route.get("directDeliveryConfigured")
            or order_for_route.get("directWarehouseToCustomerConfigured")
            or order_for_route.get("deliveryMode") in ("direct", "direct_delivery", "warehouse_to_customer")
            or order_for_route.get("logisticsMode") in ("warehouse_to_customer", "warehouse_to_customer_direct", "direct_delivery")
        )
        category = classify_farmer_fulfillment_route(
            calculated_distance, threshold, source_district, destination_district,
            direct_configured, len(source_ids) > 1,
        )
        route_data_complete = category in ("nearby", "same_district", "inter_district", "multi_warehouse")
        reason = (
            "Customer delivery coordinates or district could not be resolved from the order snapshot or saved address"
            if category == "needs_location"
            else "Nearby delivery is within the threshold, but direct warehouse-to-customer delivery is not configured"
            if category == "route_review"
            else None
        )
        item.update({
            "routeCategory": category,
            "routeDataComplete": route_data_complete,
            "routeDistanceKm": calculated_distance,
            "nearbyThresholdKm": threshold,
            "sourceDistrict": source_district or None,
            "destinationDistrict": destination_district or None,
            "directDeliveryConfigured": direct_configured,
            "routeDecisionReason": reason,
        })
    for item in outgoing:
        item["id"] = str(item["_id"])
    # MongoDB documents contain ObjectId values in _id/orderId/productId and
    # optional references. Convert every nested value before FastAPI serializes
    # the response; otherwise this endpoint can raise a 500, which browsers
    # misleadingly report as a CORS failure because the error response is lost.
    outgoing = [_make_json_safe(item) for item in outgoing]
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
    enriched_cases = []
    for case in cases:
        order_id = str(case.get("orderId") or "")
        product_id = str(case.get("productId") or "")
        order = await order_repository.get_by_id(order_id) if ObjectId.is_valid(order_id) else None
        product = await product_repository.get_by_id(product_id) if ObjectId.is_valid(product_id) else None
        required = float(case.get("requiredQuantity") or 0)
        available = float(case.get("availableQuantity") or 0)
        case["id"] = str(case["_id"])
        case["orderNumber"] = (order or {}).get("orderNumber") or order_id[-8:]
        case["productName"] = (
            case.get("productName")
            or (product or {}).get("name")
            or next(
                (str(item.get("productName") or item.get("name") or "")
                 for item in ((order or {}).get("items") or [])
                 if str(item.get("productId")) == product_id
                 and str(item.get("variantId") or "") == str(case.get("variantId") or "")),
                ""
            )
            or "Product"
        )
        case["requiredQuantity"] = required
        case["availableQuantity"] = available
        case["shortageQuantity"] = max(0.0, required - available)
        case.setdefault("unit", "kg")
        for key in ("orderId", "warehouseId", "productId", "variantId", "substituteProductId", "substituteVariantId", "customerApprovedBy"):
            if case.get(key) is not None:
                case[key] = str(case[key])
        case.pop("_id", None)
        enriched_cases.append(case)
    return {"success": True, "data": {"shortages": enriched_cases}}


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


@router.put("/me/farmer-fulfillment/{order_id}/assign-local-hub-pickup-team")
async def assign_farmer_fulfillment_local_hub_pickup_team(
    order_id: str,
    deliveryPartnerId: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """Assign an approved warehouse pickup team to carry a sealed order to its local hub."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can assign local-hub pickup teams")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Invalid order ID")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    order = await order_repository.get_by_id(order_id)
    if not warehouse or not order:
        raise HTTPException(status_code=404, detail="Order or warehouse not found")
    warehouse_id = str(warehouse["_id"])
    mode = str(order.get("logisticsMode") or "")
    if mode == "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner":
        authorized = str(order.get("consolidationWarehouseId") or "") == warehouse_id
        ready = str(order.get("consolidationStatus") or "") == "hub_handoff_pending"
    elif mode == "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner":
        authorized = str(order.get("destinationWarehouseId") or "") == warehouse_id
        ready = str(order.get("transferStatus") or "") == "hub_handoff_pending"
    else:
        authorized = str(order.get("sourceWarehouseId") or order.get("warehouseId") or "") == warehouse_id
        ready = str(order.get("transferStatus") or "") == "hub_handoff_pending"
    if not authorized:
        raise HTTPException(status_code=403, detail="This order is not assigned to your warehouse for local-hub transfer")
    if not ready:
        raise HTTPException(status_code=409, detail="Send the sealed order to the local-hub transfer stage before assigning a pickup team")
    members = await warehouse_pickup_team_repository.get_approved_members(warehouse_id)
    membership = next((m for m in members if str(m.get("deliveryPartnerId") or m.get("userId") or "") == deliveryPartnerId), None)
    if not membership:
        raise HTTPException(status_code=400, detail="Select an approved pickup team assigned to this warehouse")
    profile_id = str(membership.get("deliveryPartnerId") or "")
    partner_user_id = str(membership.get("userId") or membership.get("deliveryPartnerUserId") or "")
    if not ObjectId.is_valid(profile_id) or not ObjectId.is_valid(partner_user_id):
        raise HTTPException(status_code=400, detail="The selected pickup team is missing a valid partner profile or user account")
    transfer_collection = MongoDB.get_collection("farmer_fulfillment_hub_transfers")
    transfer = await transfer_collection.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
    if not transfer:
        raise HTTPException(status_code=409, detail="Create the local-hub transfer first, then assign the pickup team")
    if str(transfer.get("status") or "") == "received":
        raise HTTPException(status_code=409, detail="The local hub has already received this order")
    if str(transfer.get("status") or "") not in ("in_transit", "assigned"):
        raise HTTPException(status_code=409, detail=f"Transfer cannot be assigned from status {transfer.get('status')}")
    required_capacity = float(transfer.get("quantity") or 0)
    team_capacity = float(membership.get("capacity") or membership.get("vehicleCapacity") or 0)
    if required_capacity <= 0:
        raise HTTPException(status_code=400, detail="Transfer quantity is missing; cannot validate vehicle capacity")
    if team_capacity < required_capacity:
        raise HTTPException(status_code=400, detail=f"Selected vehicle capacity ({team_capacity:g} kg) is below the shipment quantity ({required_capacity:g} kg)")
    if transfer.get("assignedDeliveryPartnerId") and str(transfer.get("assignedDeliveryPartnerId")) != profile_id:
        raise HTTPException(status_code=409, detail="A pickup team is already assigned to this transfer")
    now = datetime.utcnow()
    await transfer_collection.update_one(
        {"_id": transfer["_id"], "status": "in_transit"},
        {"$set": {
            "status": "assigned",
            "assignedDeliveryPartnerId": ObjectId(profile_id),
            "assignedPartnerUserId": ObjectId(partner_user_id),
            "assignedBy": ObjectId(str(current_user["_id"])),
            "assignedAt": now,
            "updatedAt": now,
        }},
    )
    refreshed = await transfer_collection.find_one({"_id": transfer["_id"]})
    if not refreshed or str(refreshed.get("assignedDeliveryPartnerId") or "") != profile_id:
        raise HTTPException(status_code=409, detail="Transfer assignment changed. Refresh and try again.")
    try:
        await NotificationService.send_custom_notification(
            partner_user_id,
            f"Local-hub transfer for order {order.get('orderNumber') or order_id} is assigned to you. Start the transfer and confirm arrival at the hub.",
            title="Local-Hub Pickup Assigned",
            data={"type": "farmer_fulfillment_hub_transfer", "transferId": str(transfer["_id"]), "orderId": order_id},
        )
    except Exception:
        logger.exception("Unable to notify pickup partner about local-hub transfer")
    return {"success": True, "data": {
        "transferId": str(transfer["_id"]), "orderId": order_id,
        "status": refreshed.get("status"), "deliveryPartnerId": profile_id,
        "deliveryPartnerName": membership.get("name") or membership.get("fullName") or "Pickup Team",
    }, "message": "Pickup team assigned to local-hub transfer"}


@router.post("/me/outgoing/{outgoing_id}/inter-district-dispatch")
async def dispatch_ordinary_inter_district_order(
    outgoing_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Assign a real destination warehouse and approved transfer team before dispatching a warehouse order."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can dispatch warehouse transfers")
    if not ObjectId.is_valid(outgoing_id):
        raise HTTPException(status_code=400, detail="Invalid outgoing shipment ID")

    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    warehouse_id = str(warehouse["_id"])
    outgoing = await outgoing_stock_repository.get_by_id(outgoing_id)
    if not outgoing or str(outgoing.get("warehouseId")) != warehouse_id:
        raise HTTPException(status_code=404, detail="Outgoing shipment not found")
    order_id = str(outgoing.get("orderId") or "")
    if not ObjectId.is_valid(order_id):
        raise HTTPException(status_code=400, detail="Outgoing shipment is not linked to a valid customer order")
    order = await order_repository.get_by_id(order_id)
    if not order or str(order.get("warehouseId") or "") != warehouse_id:
        raise HTTPException(status_code=404, detail="Customer order is not assigned to this source warehouse")
    if str(order.get("fulfillmentMethod") or "").strip().lower() not in {"warehouse", "warehouse_fulfillment", "warehouse-fulfillment"}:
        raise HTTPException(status_code=409, detail="This order is not an ordinary warehouse-fulfilled order")

    address_value = order.get("deliveryAddress") or order.get("shippingAddress") or {}
    address = address_value if isinstance(address_value, dict) else {}
    shipping = order.get("shippingAddress") if isinstance(order.get("shippingAddress"), dict) else {}
    destination_district = str(
        address.get("district") or address.get("districtName") or address.get("district_name")
        or shipping.get("district") or shipping.get("districtName") or shipping.get("district_name")
        or order.get("deliveryDistrict") or order.get("destinationDistrict")
        or order.get("customerDistrict") or ""
    ).strip()
    if not destination_district:
        raise HTTPException(status_code=409, detail="Customer delivery district is missing. Complete the delivery address before dispatch.")

    all_outgoing = await outgoing_stock_repository.find_many({
        "orderId": ObjectId(order_id), "warehouseId": ObjectId(warehouse_id), "deletedAt": None
    }, skip=0, limit=1000)
    if not all_outgoing:
        raise HTTPException(status_code=409, detail="No outgoing shipment lines exist for this order.")
    if any(float(row.get("quantity") or 0) <= 0 for row in all_outgoing):
        raise HTTPException(status_code=409, detail="One or more shipment lines have an invalid quantity.")
    if any(str(row.get("status") or "pending") not in {"pending", "packed", "dispatched"} for row in all_outgoing):
        raise HTTPException(status_code=409, detail="Every shipment line must be packed and ready for dispatch.")

    required_capacity = sum(float(row.get("quantity") or 0) for row in all_outgoing)
    destination = await warehouse_for_district(
        destination_district,
        required_capacity=required_capacity,
        exclude_warehouse_id=warehouse_id,
    )
    if not destination or destination.get("_districtFallback"):
        raise HTTPException(
            status_code=409,
            detail=f"No eligible active warehouse explicitly serving {destination_district} was found with sufficient capacity. Check its district/service area and available capacity.",
        )
    destination_id = str(destination.get("_id") or "")
    if not ObjectId.is_valid(destination_id) or destination_id == warehouse_id:
        raise HTTPException(status_code=409, detail="A valid destination warehouse in the delivery district could not be resolved.")

    teams = await warehouse_pickup_team_repository.get_approved_members(warehouse_id)
    eligible_team = None
    for member in teams:
        partner_id = str(member.get("deliveryPartnerId") or "")
        user_id = str(member.get("userId") or member.get("deliveryPartnerUserId") or "")
        capacity = float(member.get("capacity") or member.get("vehicleCapacity") or 0)
        if ObjectId.is_valid(partner_id) and ObjectId.is_valid(user_id) and capacity >= required_capacity:
            eligible_team = member
            break
    if not eligible_team:
        raise HTTPException(
            status_code=409,
            detail=f"Destination warehouse {destination.get('name') or destination.get('warehouseName') or destination_id} was found, but no approved source-warehouse transfer team has valid accounts and enough capacity for {required_capacity:g} units. Approve/configure a suitable team, then retry.",
        )

    now = datetime.utcnow()
    transfers = MongoDB.get_collection("warehouse_order_transfers")
    existing = await transfers.find_one({"orderId": ObjectId(order_id), "deletedAt": None})
    if existing and str(existing.get("status") or "") in {"in_transit", "received", "assigned"}:
        if str(existing.get("destinationWarehouseId") or "") != destination_id:
            raise HTTPException(status_code=409, detail="A transfer for this order already exists with a different destination. Resolve the existing transfer before retrying.")
        transfer = existing
    else:
        transfer_doc = {
            "orderId": ObjectId(order_id),
            "orderNumber": order.get("orderNumber"),
            "sourceWarehouseId": ObjectId(warehouse_id),
            "destinationWarehouseId": ObjectId(destination_id),
            "destinationDistrict": destination_district,
            "transferTeamId": ObjectId(str(eligible_team.get("deliveryPartnerId"))),
            "transferTeamUserId": ObjectId(str(eligible_team.get("userId") or eligible_team.get("deliveryPartnerUserId"))),
            "transferTeamName": eligible_team.get("name") or eligible_team.get("fullName") or "Warehouse Transfer Team",
            "quantity": required_capacity,
            "status": "assigned",
            "createdBy": ObjectId(str(current_user["_id"])),
            "assignedAt": now,
            "createdAt": now,
            "updatedAt": now,
            "deletedAt": None,
        }
        transfer_id = await transfers.insert_one(transfer_doc)
        transfer = {**transfer_doc, "_id": transfer_id.inserted_id}

    # Persist the route on every line before invoking the existing order-level dispatch guard.
    for row in all_outgoing:
        if str(row.get("status") or "") != "dispatched":
            await outgoing_stock_repository.update({"_id": row["_id"]}, {
                "deliveryPartnerRoute": "long_distance",
                "deliveryRouteRadiusKm": 15,
                "deliveryRouteSelectedAt": now,
                "updatedAt": now,
            })
    await order_repository.update({"_id": ObjectId(order_id)}, {
        "destinationWarehouseId": ObjectId(destination_id),
        "destinationDistrict": destination_district,
        "warehouseTransferId": transfer["_id"],
        "warehouseTransferTeamId": ObjectId(str(eligible_team.get("deliveryPartnerId"))),
        "warehouseFulfillmentStage": "delivery_decision",
        "deliveryPartnerRoute": "long_distance",
        "updatedAt": now,
    })

    refreshed_rows = await outgoing_stock_repository.find_many({
        "orderId": ObjectId(order_id), "warehouseId": ObjectId(warehouse_id), "deletedAt": None
    }, skip=0, limit=1000)
    for row in refreshed_rows:
        if str(row.get("status") or "pending") == "dispatched":
            continue
        updated = await WarehouseService.update_outgoing_status(
            str(row["_id"]), "dispatched", warehouse_id,
            {"notes": f"Inter-district transfer assigned to {destination.get('name') or destination.get('warehouseName') or destination_id}; transfer team assigned."},
        )
        if not updated:
            raise HTTPException(status_code=409, detail="Destination and team were assigned, but warehouse dispatch could not be completed. Refresh the order and inspect its packing/route status before retrying.")
    await transfers.update_one({"_id": transfer["_id"]}, {"$set": {"status": "in_transit", "dispatchedAt": now, "updatedAt": now}})
    await order_repository.append_tracking_event(
        order_id, "warehouse_inter_district_dispatched",
        "Inter-district warehouse transfer dispatched",
        f"Shipment dispatched from source warehouse to {destination.get('name') or destination.get('warehouseName') or destination_id} in {destination_district}.",
        actor_id=str(current_user["_id"]), actor_role="warehouse",
        metadata={"transferId": str(transfer["_id"]), "destinationWarehouseId": destination_id, "destinationDistrict": destination_district, "transferTeamId": str(eligible_team.get("deliveryPartnerId"))},
    )
    return {"success": True, "data": {
        "orderId": order_id,
        "transferId": str(transfer["_id"]),
        "sourceWarehouseId": warehouse_id,
        "destinationWarehouseId": destination_id,
        "destinationWarehouseName": destination.get("name") or destination.get("warehouseName") or "Destination Warehouse",
        "destinationDistrict": destination_district,
        "transferTeamId": str(eligible_team.get("deliveryPartnerId")),
        "transferTeamName": eligible_team.get("name") or eligible_team.get("fullName") or "Warehouse Transfer Team",
        "status": "in_transit",
    }, "message": "Destination warehouse and approved transfer team assigned; inter-district shipment dispatched."}


@router.get("/me/transfers/order-search")
async def search_warehouse_transfer_order(
    q: str = Query(..., min_length=2, max_length=120),
    current_user: dict = Depends(get_current_user),
):
    """Search the warehouse's complete order history, not only the first outgoing page."""
    if current_user.get("role") != "warehouse":
        raise HTTPException(status_code=403, detail="Only warehouse managers can search warehouse orders")
    warehouse = await WarehouseService.get_warehouse_by_manager(str(current_user["_id"]))
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    warehouse_id = str(warehouse["_id"])
    warehouse_refs = [ObjectId(warehouse_id), warehouse_id]
    query = q.strip()
    order_filter = {
        "$and": [
            {"$or": [{"warehouseId": {"$in": warehouse_refs}}, {"sourceWarehouseId": {"$in": warehouse_refs}}]},
            {"$or": [
                {"orderNumber": {"$regex": query, "$options": "i"}},
                {"orderNo": {"$regex": query, "$options": "i"}},
                {"_id": ObjectId(query) if ObjectId.is_valid(query) else {"$exists": False}},
            ]},
        ]
    }
    orders = await order_repository.find_many(order_filter, skip=0, limit=25, sort=[("createdAt", -1)])
    # Include exact outgoing references where order metadata is legacy/incomplete.
    results = []
    for order in orders:
        if str(order.get("fulfillmentMethod") or order.get("fulfillment_method") or "").strip().lower() not in {"warehouse", "warehouse_fulfillment", "warehouse-fulfillment"}:
            continue
        order_id = str(order.get("_id") or "")
        outgoing_rows = await outgoing_stock_repository.find_many({
            "orderId": {"$in": [ObjectId(order_id), order_id]},
            "warehouseId": {"$in": warehouse_refs},
            "deletedAt": None,
        }, skip=0, limit=100)
        result = dict(order)
        result["id"] = order_id
        result["orderId"] = order_id
        result["orderNumber"] = order.get("orderNumber") or order.get("orderNo") or order_id
        result["status"] = order.get("warehouseFulfillmentStage") or order.get("deliveryState") or order.get("orderStatus") or order.get("status") or "pending"
        result["warehouseFulfillmentStage"] = order.get("warehouseFulfillmentStage") or result["status"]
        result["productName"] = ", ".join(str(x.get("productName") or x.get("name") or x.get("productId") or "Product") for x in (order.get("items") or []) if isinstance(x, dict)) or "Warehouse fulfillment order"
        result["quantity"] = sum(float(x.get("quantity") or 0) for x in (order.get("items") or []) if isinstance(x, dict))
        result["outgoingLines"] = [{"id": str(x.get("_id") or ""), "status": x.get("status"), "quantity": x.get("quantity"), "productId": str(x.get("productId") or "")} for x in outgoing_rows]
        results.append(_make_json_safe(result))
    return {"success": True, "data": {"orders": results, "count": len(results), "searchQuery": query}}
