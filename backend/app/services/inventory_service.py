from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
import asyncio
import logging

from app.repositories.inventory_repository import inventory_repository
from app.repositories.reservation_repository import reservation_repository
from app.repositories.product_repository import product_repository
from app.repositories.order_repository import order_repository
from app.schemas.inventory import ReservationStatus, StockResponse

logger = logging.getLogger(__name__)

RESERVATION_TTL_MINUTES = 15

active_stock_connections: dict[str, list] = {}


async def broadcast_stock_update(product_id: str, stock: StockResponse):
    """Broadcast stock update to all connected WebSocket clients for a product."""
    if product_id not in active_stock_connections:
        return
    message = {
        "type": "stock_update",
        "data": stock.dict(),
    }
    dead_connections = []
    for ws in active_stock_connections[product_id]:
        try:
            await ws.send_json(message)
        except Exception:
            dead_connections.append(ws)
    for ws in dead_connections:
        active_stock_connections[product_id].remove(ws)
    if not active_stock_connections[product_id]:
        del active_stock_connections[product_id]


class InventoryService:

    @staticmethod
    async def get_available_stock(product_id: str) -> int:
        """Get currently available stock for a product."""
        summary = await inventory_repository.get_stock_summary(product_id)
        if not summary:
            product = await product_repository.get_by_id(product_id)
            if product:
                return product.get("quantity", 0)
            return 0
        return summary.get("available_stock", 0)

    @staticmethod
    async def get_stock(product_id: str) -> Optional[StockResponse]:
        """Get full stock details for a product."""
        summary = await inventory_repository.get_stock_summary(product_id)
        if summary:
            return StockResponse(**summary)
        product = await product_repository.get_by_id(product_id)
        if product:
            available = product.get("quantity", 0)
            return StockResponse(
                product_id=product_id,
                total_stock=available,
                reserved_stock=0,
                sold_stock=0,
                available_stock=available,
                unit=product.get("unit", "kg"),
                is_out_of_stock=available <= 0,
            )
        return None

    @staticmethod
    async def reserve_product(
        customer_id: str, product_id: str, quantity: int
    ) -> Optional[Dict[str, Any]]:
        """Atomically reserve stock for a customer."""
        product = await product_repository.get_by_id(product_id)
        if not product:
            return None

        farmer_id = str(product["farmerId"])

        inventory = await inventory_repository.get_by_product_id(product_id)
        if inventory:
            available = (
                inventory.get("total_stock", 0)
                - inventory.get("reserved_stock", 0)
                - inventory.get("sold_stock", 0)
            )
            if available < quantity:
                return None
        else:
            total = product.get("quantity", 0)
            if total < quantity:
                return None
            inv_id = await inventory_repository.ensure_inventory_exists(
                product_id, farmer_id, total, product.get("unit", "kg")
            )
            if not inv_id:
                return None

        success = await inventory_repository.atomic_reserve(product_id, quantity)
        if not success:
            return None

        expires_at = datetime.utcnow() + timedelta(minutes=RESERVATION_TTL_MINUTES)
        reservation_data = {
            "product_id": ObjectId(product_id),
            "customer_id": ObjectId(customer_id),
            "quantity": quantity,
            "status": ReservationStatus.ACTIVE.value,
            "expires_at": expires_at,
            "farmer_id": ObjectId(farmer_id),
        }
        reservation_id = await reservation_repository.create_reservation(reservation_data)
        if not reservation_id:
            await inventory_repository.atomic_release(product_id, quantity)
            return None

        stock = await InventoryService.get_stock(product_id)
        if stock:
            await broadcast_stock_update(product_id, stock)

        return {
            "reservation_id": reservation_id,
            "product_id": product_id,
            "quantity": quantity,
            "status": ReservationStatus.ACTIVE.value,
            "expires_at": expires_at.isoformat(),
            "available_stock": stock.available_stock if stock else 0,
        }

    @staticmethod
    async def confirm_reservation(
        reservation_id: str, order_id: str
    ) -> Optional[Dict[str, Any]]:
        """Confirm a reservation and move stock from reserved to sold."""
        reservation = await reservation_repository.get_by_id(reservation_id)
        if not reservation:
            return None
        if reservation.get("status") != ReservationStatus.ACTIVE.value:
            return None
        if reservation.get("expires_at") and reservation["expires_at"] < datetime.utcnow():
            await reservation_repository.mark_expired(reservation_id)
            await inventory_repository.atomic_release(
                str(reservation["product_id"]), reservation["quantity"]
            )
            return None

        product_id = str(reservation["product_id"])
        quantity = reservation["quantity"]

        success = await inventory_repository.atomic_confirm(product_id, quantity)
        if not success:
            return None

        await reservation_repository.confirm(reservation_id, order_id)

        stock = await InventoryService.get_stock(product_id)
        if stock:
            await broadcast_stock_update(product_id, stock)

        return {
            "reservation_id": reservation_id,
            "status": ReservationStatus.CONFIRMED.value,
            "sold_stock": stock.sold_stock if stock else 0,
            "available_stock": stock.available_stock if stock else 0,
        }

    @staticmethod
    async def cancel_reservation(reservation_id: str) -> Optional[Dict[str, Any]]:
        """Cancel a reservation and release reserved stock."""
        reservation = await reservation_repository.get_by_id(reservation_id)
        if not reservation:
            return None
        if reservation.get("status") != ReservationStatus.ACTIVE.value:
            return None

        product_id = str(reservation["product_id"])
        quantity = reservation["quantity"]

        success = await inventory_repository.atomic_release(product_id, quantity)
        if not success:
            return None

        await reservation_repository.cancel(reservation_id)

        stock = await InventoryService.get_stock(product_id)
        if stock:
            await broadcast_stock_update(product_id, stock)

        return {
            "reservation_id": reservation_id,
            "status": ReservationStatus.CANCELLED.value,
            "released_quantity": quantity,
            "available_stock": stock.available_stock if stock else 0,
        }

    @staticmethod
    async def expire_reservations():
        """Background job to expire active reservations past their TTL."""
        expired = await reservation_repository.get_expired_reservations()
        released_per_product: dict[str, int] = {}
        for reservation in expired:
            product_id = str(reservation["product_id"])
            quantity = reservation["quantity"]
            res_id = str(reservation["_id"])

            release_ok = await inventory_repository.atomic_release(product_id, quantity)
            if release_ok:
                await reservation_repository.mark_expired(res_id)
                released_per_product[product_id] = (
                    released_per_product.get(product_id, 0) + quantity
                )

        for product_id, qty in released_per_product.items():
            stock = await InventoryService.get_stock(product_id)
            if stock:
                await broadcast_stock_update(product_id, stock)

        if expired:
            logger.info(f"Expired {len(expired)} reservations, released {sum(released_per_product.values())} units")
        return expired

    @staticmethod
    async def get_farmer_stock_summary(farmer_id: str) -> Dict[str, Any]:
        """Get stock summary for a farmer's regular products (basket-only excluded)."""
        products = await product_repository.get_by_farmer(
            farmer_id, skip=0, limit=1000, include_inactive=False, include_basket_only=False
        )
        inventory_list = await inventory_repository.get_by_farmer(farmer_id)

        stock_by_product: Dict[str, Dict[str, Any]] = {}
        for inv in inventory_list:
            stock_by_product[str(inv["product_id"])] = {
                "total": inv.get("total_stock", 0),
                "reserved": inv.get("reserved_stock", 0),
                "sold": inv.get("sold_stock", 0),
                "unit": inv.get("unit", "kg"),
            }

        total_stock = 0
        total_reserved = 0
        total_sold = 0
        summary_products = []

        for product in products:
            pid = str(product["_id"])
            stock = stock_by_product.get(pid, {})
            total = stock.get("total", 0)
            reserved = stock.get("reserved", 0)
            sold = stock.get("sold", 0)
            available = total - reserved - sold
            unit = stock.get("unit") or product.get("unit", "kg")

            total_stock += total
            total_reserved += reserved
            total_sold += sold

            summary_products.append({
                "product_id": pid,
                "product_name": product.get("name", "Unknown"),
                "product_slug": product.get("slug"),
                "images": product.get("images", []),
                "price": product.get("price"),
                "unit": unit,
                "total_stock": total,
                "reserved_stock": reserved,
                "sold_stock": sold,
                "available_stock": max(0, available),
                "is_out_of_stock": available <= 0,
            })

        summary_products.sort(key=lambda p: p["available_stock"])

        return {
            "total_products": len(summary_products),
            "total_stock": total_stock,
            "total_available": max(0, total_stock - total_reserved - total_sold),
            "total_reserved": total_reserved,
            "total_sold": total_sold,
            "products": summary_products,
        }

    @staticmethod
    async def get_customer_reservations(customer_id: str) -> List[Dict[str, Any]]:
        """Get all reservations for a customer with product details."""
        reservations = await reservation_repository.get_customer_reservations(customer_id)

        result = []
        for res in reservations:
            product = await product_repository.get_by_id(str(res["product_id"]))
            result.append({
                "reservation_id": str(res["_id"]),
                "product_id": str(res["product_id"]),
                "product_name": product.get("name", "Unknown") if product else "Unknown",
                "quantity": res.get("quantity", 0),
                "status": res.get("status", ""),
                "expires_at": res.get("expires_at").isoformat() if res.get("expires_at") else None,
                "confirmed_at": res.get("confirmed_at").isoformat() if res.get("confirmed_at") else None,
                "order_id": str(res["order_id"]) if res.get("order_id") else None,
            })

        return result

    @staticmethod
    async def get_admin_inventory_analytics() -> Dict[str, Any]:
        """Get inventory analytics for admin dashboard."""
        summary = await inventory_repository.get_all_summary()

        pipeline_low_stock = [
            {"$match": {"deleted_at": None}},
            {
                "$project": {
                    "available": {
                        "$subtract": [
                            "$total_stock",
                            {"$add": ["$reserved_stock", "$sold_stock"]},
                        ]
                    },
                }
            },
            {"$match": {"available": {"$lt": 10, "$gt": 0}}},
            {"$count": "count"},
        ]
        low_stock_results = await inventory_repository.aggregate(pipeline_low_stock)
        low_stock_count = low_stock_results[0]["count"] if low_stock_results else 0

        pipeline_oos = [
            {"$match": {"deleted_at": None}},
            {
                "$project": {
                    "available": {
                        "$subtract": [
                            "$total_stock",
                            {"$add": ["$reserved_stock", "$sold_stock"]},
                        ]
                    },
                }
            },
            {"$match": {"available": {"$lte": 0}}},
            {"$count": "count"},
        ]
        oos_results = await inventory_repository.aggregate(pipeline_oos)
        oos_count = oos_results[0]["count"] if oos_results else 0

        pipeline_top_reserved = [
            {"$match": {"status": "active", "deleted_at": None}},
            {"$group": {"_id": "$product_id", "total_reserved": {"$sum": "$quantity"}}},
            {"$sort": {"total_reserved": -1}},
            {"$limit": 10},
            {
                "$lookup": {
                    "from": "products",
                    "localField": "_id",
                    "foreignField": "_id",
                    "as": "product",
                }
            },
            {"$unwind": {"path": "$product", "preserveNullAndEmptyArrays": True}},
            {
                "$project": {
                    "product_id": {"$toString": "$_id"},
                    "product_name": {"$ifNull": ["$product.name", "Unknown"]},
                    "total_reserved": 1,
                }
            },
        ]
        top_reserved = await reservation_repository.aggregate(pipeline_top_reserved)

        return {
            "total_products": summary.get("total_products", 0),
            "total_stock": summary.get("total_stock", 0),
            "total_available": summary.get("total_available", 0),
            "total_reserved": summary.get("total_reserved", 0),
            "total_sold": summary.get("total_sold", 0),
            "total_revenue": 0.0,
            "low_stock_products": low_stock_count,
            "out_of_stock_products": oos_count,
            "avg_reservation_time_minutes": RESERVATION_TTL_MINUTES,
            "reservation_completion_rate": 0.0,
            "top_reserved_products": top_reserved,
        }


inventory_service = InventoryService()
