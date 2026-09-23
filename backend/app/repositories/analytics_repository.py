from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
from app.repositories.base_repository import BaseRepository
from app.repositories.product_repository import product_repository
from app.repositories.category_repository import category_repository
from app.repositories.inventory_repository import inventory_repository
from app.repositories.wallet_repository import wallet_repository
from app.repositories.payment_split_repository import payment_split_repository
from app.repositories.product_review_repository import product_review_repository
import logging

logger = logging.getLogger(__name__)

harvest_plan_repo = BaseRepository("harvest_plans")
harvest_preorder_repo = BaseRepository("harvest_preorders")
harvest_notify_repo = BaseRepository("harvest_notifications")


def _build_revenue_trend(orders, from_date, to_date, period="week"):
    """Continuous revenue/orders series with zero-filled buckets over the whole period."""
    daily = {}
    for o in orders or []:
        od = o.get("orderDate")
        if not isinstance(od, datetime):
            continue
        if period == "year":
            key = od.strftime("%b")
        elif period == "month":
            key = od.strftime("%d %b")
        else:
            key = od.strftime("%a %d")
        bucket = daily.setdefault(key, {"name": key, "revenue": 0, "orders": 0})
        bucket["revenue"] += o.get("totalAmount", 0) or 0
        bucket["orders"] += 1

    result = []
    if not from_date or not to_date:
        return result

    if period == "year":
        cur = datetime(from_date.year, from_date.month, 1)
        while cur <= to_date:
            name = cur.strftime("%b")
            result.append(daily.get(name, {"name": name, "revenue": 0, "orders": 0}))
            if cur.month == 12:
                cur = datetime(cur.year + 1, 1, 1)
            else:
                cur = datetime(cur.year, cur.month + 1, 1)
    else:
        cur = datetime(from_date.year, from_date.month, from_date.day)
        end = datetime(to_date.year, to_date.month, to_date.day)
        while cur <= end:
            name = cur.strftime("%a %d") if period != "month" else cur.strftime("%d %b")
            result.append(daily.get(name, {"name": name, "revenue": 0, "orders": 0}))
            cur += timedelta(days=1)
    return result

class AnalyticsRepository(BaseRepository):
    """Analytics repository for order and metrics aggregation."""

    def __init__(self):
        super().__init__("orders")

    def _build_date_filter(
        self,
        from_date: Optional[datetime],
        to_date: Optional[datetime]
    ) -> Dict[str, Any]:
        filter: Dict[str, Any] = {"deletedAt": None}
        date_filter: Dict[str, Any] = {}

        if from_date:
            date_filter["$gte"] = from_date
        if to_date:
            date_filter["$lte"] = to_date
        if date_filter:
            filter["orderDate"] = date_filter

        return filter

    async def get_overview_metrics(
        self,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        pipeline = [
            {"$match": self._build_date_filter(from_date, to_date)},
            {
                "$group": {
                    "_id": None,
                    "totalOrders": {"$sum": 1},
                    "totalRevenue": {"$sum": {"$ifNull": ["$totalAmount", 0]}},
                    "averageOrderValue": {"$avg": {"$ifNull": ["$totalAmount", 0]}},
                    "deliveredOrders": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$orderStatus", "delivered"]},
                                1,
                                0
                            ]
                        }
                    },
                    "cancelledOrders": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$orderStatus", "cancelled"]},
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]
        result = await self.aggregate(pipeline)
        if not result:
            return {
                "totalOrders": 0,
                "totalRevenue": 0.0,
                "averageOrderValue": 0.0,
                "deliveredOrders": 0,
                "cancelledOrders": 0
            }
        return result[0]

    async def get_order_status_counts(
        self,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, int]:
        pipeline = [
            {"$match": self._build_date_filter(from_date, to_date)},
            {
                "$group": {
                    "_id": "$orderStatus",
                    "count": {"$sum": 1}
                }
            }
        ]
        result = await self.aggregate(pipeline)
        return {item["_id"]: item["count"] for item in result if item.get("_id")}

    async def get_top_products(
        self,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        pipeline = [
            {"$match": self._build_date_filter(from_date, to_date)},
            {"$unwind": "$items"},
            {
                "$group": {
                    "_id": "$items.productId",
                    "name": {"$first": "$items.productName"},
                    "quantity": {"$sum": {"$ifNull": ["$items.quantity", 0]}},
                    "revenue": {
                        "$sum": {
                            "$multiply": [
                                {"$ifNull": ["$items.quantity", 0]},
                                {"$ifNull": ["$items.unitPrice", 0]}
                            ]
                        }
                    }
                }
            },
            {"$sort": {"revenue": -1}},
            {"$limit": limit}
        ]
        result = await self.aggregate(pipeline)
        return [
            {
                "id": str(item["_id"]),
                "name": item.get("name") or "Unknown Product",
                "revenue": item.get("revenue", 0.0),
                "quantity": item.get("quantity", 0)
            }
            for item in result
        ]

    async def get_top_farmers(
        self,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        pipeline = [
            {"$match": self._build_date_filter(from_date, to_date)},
            {
                "$group": {
                    "_id": "$farmerId",
                    "name": {"$first": "$farmerName"},
                    "orderCount": {"$sum": 1},
                    "revenue": {"$sum": {"$ifNull": ["$totalAmount", 0]}}
                }
            },
            {"$sort": {"revenue": -1}},
            {"$limit": limit}
        ]
        result = await self.aggregate(pipeline)
        return [
            {
                "id": str(item["_id"]),
                "name": item.get("name") or "Unknown Farmer",
                "orderCount": item.get("orderCount", 0),
                "revenue": item.get("revenue", 0.0)
            }
            for item in result
        ]

    async def get_sales_trends(
        self,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        interval: str = "day"
    ) -> List[Dict[str, Any]]:
        date_format = "%Y-%m-%d" if interval == "day" else "%Y-%m"
        pipeline = [
            {"$match": self._build_date_filter(from_date, to_date)},
            {
                "$group": {
                    "_id": {
                        "$dateToString": {
                            "format": date_format,
                            "date": "$orderDate"
                        }
                    },
                    "orderCount": {"$sum": 1},
                    "revenue": {"$sum": {"$ifNull": ["$totalAmount", 0]}}
                }
            },
            {"$sort": {"_id": 1}}
        ]
        result = await self.aggregate(pipeline)
        return [
            {
                "period": item["_id"],
                "orderCount": item.get("orderCount", 0),
                "revenue": item.get("revenue", 0.0)
            }
            for item in result
        ]

    async def get_farmer_metrics(
        self,
        farmer_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        try:
            farmer_obj = ObjectId(farmer_id)
        except Exception:
            return {}

        filter = self._build_date_filter(from_date, to_date)
        filter["farmerId"] = farmer_obj

        summary_pipeline = [
            {
                "$match": filter
            },
            {
                "$group": {
                    "_id": None,
                    "totalOrders": {"$sum": 1},
                    "totalRevenue": {"$sum": {"$ifNull": ["$totalAmount", 0]}},
                    "averageOrderValue": {"$avg": {"$ifNull": ["$totalAmount", 0]}},
                    "deliveredOrders": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$orderStatus", "delivered"]},
                                1,
                                0
                            ]
                        }
                    },
                    "cancelledOrders": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$orderStatus", "cancelled"]},
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]
        summary = await self.aggregate(summary_pipeline)
        metrics = summary[0] if summary else {}
        metrics.setdefault("totalOrders", 0)
        metrics.setdefault("totalRevenue", 0.0)
        metrics.setdefault("averageOrderValue", 0.0)
        metrics.setdefault("deliveredOrders", 0)
        metrics.setdefault("cancelledOrders", 0)
        metrics["farmerId"] = farmer_id

        top_products = await self.get_top_products_by_farmer(farmer_id, from_date, to_date)
        for p in top_products:
            p["orderCount"] = p.get("orders", 0)
        metrics["topProducts"] = top_products
        metrics["categoryDistribution"] = await self.get_farmer_category_distribution(farmer_id, from_date, to_date)
        metrics["orderStatusCounts"] = await self.get_farmer_order_status_counts(farmer_id, from_date, to_date)
        metrics["orderStats"] = self._map_order_stats(metrics["orderStatusCounts"])
        orders_trend = await self.find_many(filter, limit=10000)
        trend = _build_revenue_trend(orders_trend, from_date, to_date, "week")
        for point in trend:
            point["label"] = point.get("name", "")
            point["amount"] = point.get("revenue", 0)
        metrics["revenueTrend"] = trend
        metrics["productStock"] = await self.get_farmer_product_stock(farmer_id, from_date, to_date)

        money = await self.get_farmer_money_summary(farmer_id)
        metrics["walletBalance"] = money["walletBalance"]
        metrics["pendingEarnings"] = money["pendingEarnings"]

        rating = await self.get_farmer_rating_summary(farmer_id)
        metrics["avgRating"] = rating["avgRating"]
        metrics["reviewCount"] = rating["reviewCount"]

        metrics["harvestActivity"] = await self.get_farmer_harvest_activity(farmer_id)
        metrics["harvestPlans"] = metrics["harvestActivity"].get("harvestPlans", 0)
        metrics["upcomingHarvests"] = metrics["harvestActivity"].get("upcomingHarvests", 0)
        metrics["preOrders"] = metrics["harvestActivity"].get("preOrders", 0)
        metrics["notifyMe"] = metrics["harvestActivity"].get("notifyMe", 0)

        metrics["insights"] = self._build_farmer_insights(metrics)
        return metrics

    @staticmethod
    def _map_order_stats(status_counts: Dict[str, int]) -> Dict[str, int]:
        """Collapse raw statuses into farmer-friendly buckets (pending/confirmed/shipped/delivered/cancelled)."""
        shipped = [
            "ready_for_delivery", "ready_for_pickup", "dispatched", "in_transit", "shipped"
        ]
        stats = {"pending": 0, "confirmed": 0, "shipped": 0, "delivered": 0, "cancelled": 0}
        for status, count in (status_counts or {}).items():
            key = status
            if status in ("pending",):
                key = "pending"
            elif status in ("confirmed", "processing"):
                key = "confirmed"
            elif status in shipped:
                key = "shipped"
            elif status in ("delivered", "completed"):
                key = "delivered"
            elif status == "cancelled":
                key = "cancelled"
            else:
                continue
            stats[key] = stats.get(key, 0) + count
        return stats

    async def get_farmer_money_summary(self, farmer_id: str) -> Dict[str, Any]:
        """Wallet balance and pending (not yet paid out) farmer earnings."""
        try:
            wallet = await wallet_repository.get_by_user_id(farmer_id)
            wallet_balance = round(float(wallet.get("balance", 0)), 2) if wallet else 0.0
        except Exception as e:
            logger.error(f"Error fetching farmer wallet for analytics: {str(e)}")
            wallet_balance = 0.0
        try:
            pending = round(await payment_split_repository.get_farmer_pending(farmer_id), 2)
        except Exception as e:
            logger.error(f"Error fetching farmer pending earnings for analytics: {str(e)}")
            pending = 0.0
        return {
            "walletBalance": wallet_balance,
            "pendingEarnings": pending,
        }

    async def get_farmer_rating_summary(self, farmer_id: str) -> Dict[str, Any]:
        """Average customer rating and review count across the farmer's products."""
        try:
            products = await product_repository.find_many(
                {"farmerId": ObjectId(farmer_id), "deletedAt": None},
                limit=500,
            )
        except Exception as e:
            logger.error(f"Error fetching farmer products for rating analytics: {str(e)}")
            products = []
        product_ids = [ObjectId(p["_id"]) for p in (products or [])]
        if not product_ids:
            return {"avgRating": 0.0, "reviewCount": 0}
        pipeline = [
            {"$match": {"productId": {"$in": product_ids}, "deletedAt": None}},
            {"$group": {"_id": None, "count": {"$sum": 1}, "total": {"$sum": {"$ifNull": ["$rating", 0]}}}},
        ]
        result = await product_review_repository.aggregate(pipeline)
        if not result:
            return {"avgRating": 0.0, "reviewCount": 0}
        count = int(result[0].get("count", 0))
        total = float(result[0].get("total", 0))
        return {
            "avgRating": round(total / count, 2) if count else 0.0,
            "reviewCount": count,
        }

    async def get_farmer_harvest_activity(self, farmer_id: str) -> Dict[str, Any]:
        """Harvest plans, upcoming harvests, pre-orders and notify-me demand."""
        try:
            fid = ObjectId(farmer_id)
            plan_filter = {"farmerId": fid, "deletedAt": None}
            total_plans = await harvest_plan_repo.count(plan_filter)
            upcoming = await harvest_plan_repo.count({
                **plan_filter,
                "status": {"$in": ["planned", "preorder"]},
                "harvestDate": {"$gte": datetime.utcnow()},
            })
            preorders = await harvest_preorder_repo.count({
                "farmerId": fid, "deletedAt": None,
            })
            plan_ids = [
                p["_id"]
                for p in await harvest_plan_repo.find_many(plan_filter, limit=500)
            ]
            notify = 0
            if plan_ids:
                notify = await harvest_notify_repo.count({
                    "harvestPlanId": {"$in": plan_ids},
                    "deletedAt": None,
                })
        except Exception as e:
            logger.error(f"Error fetching farmer harvest activity for analytics: {str(e)}")
            total_plans = upcoming = preorders = notify = 0
        return {
            "harvestPlans": total_plans,
            "upcomingHarvests": upcoming,
            "preOrders": preorders,
            "notifyMe": notify,
        }

    @staticmethod
    def _build_farmer_insights(metrics: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Plain-language, farmer-friendly tips generated from the analytics report."""
        insights: List[Dict[str, Any]] = []
        top_products = metrics.get("topProducts") or []
        total_revenue = float(metrics.get("totalRevenue") or 0)

        if total_revenue > 0 and top_products:
            top = top_products[0]
            share = round((float(top.get("revenue") or 0) / total_revenue) * 100) if total_revenue else 0
            insights.append({
                "type": "top_product",
                "emoji": "🏆",
                "title": "Your star product",
                "message": f"{top.get('name')} earned you {share}% of your income this period ({share}% of Rs {int(total_revenue)}).",
            })

        low_stock = [p for p in (metrics.get("productStock") or []) if p.get("remaining", 0) <= 5]
        if low_stock:
            names = ", ".join(p.get("name", "product") for p in low_stock[:3])
            insights.append({
                "type": "restock",
                "emoji": "📦",
                "title": "Restock soon",
                "message": f"You're almost out of {names}. List more before demand picks up.",
            })

        pending = float(metrics.get("pendingEarnings") or 0)
        if pending > 0:
            insights.append({
                "type": "earnings",
                "emoji": "💰",
                "title": "Money coming in",
                "message": f"Rs {int(pending)} is waiting to be paid out to you.",
            })

        rating = float(metrics.get("avgRating") or 0)
        review_count = int(metrics.get("reviewCount") or 0)
        if review_count > 0:
            if rating >= 4.5:
                insights.append({
                    "type": "rating",
                    "emoji": "⭐",
                    "title": "Customers love your produce",
                    "message": f"Your average rating is {rating}/5 from {review_count} reviews. Keep it up!",
                })
            elif rating >= 3.5:
                insights.append({
                    "type": "rating",
                    "emoji": "⭐",
                    "title": "Good rating, room to grow",
                    "message": f"Your average rating is {rating}/5 from {review_count} reviews. Freshness and packaging can push it higher.",
                })
            else:
                insights.append({
                    "type": "rating",
                    "emoji": "⚠️",
                    "title": "Ratings could improve",
                    "message": f"Your average rating is {rating}/5 from {review_count} reviews. Check feedback and improve quality.",
                })

        cancelled = int(metrics.get("cancelledOrders") or 0)
        total_orders = int(metrics.get("totalOrders") or 0)
        if total_orders > 0 and cancelled > 0:
            rate = round(cancelled / total_orders * 100)
            if rate >= 15:
                insights.append({
                    "type": "cancellations",
                    "emoji": "🚫",
                    "title": "Reduce cancellations",
                    "message": f"{cancelled} of your {total_orders} orders were cancelled ({rate}%). Keep stock updated to avoid this.",
                })

        upcoming = int(metrics.get("upcomingHarvests") or 0)
        preorders = int(metrics.get("preOrders") or 0)
        if upcoming > 0:
            insights.append({
                "type": "harvest",
                "emoji": "🌱",
                "title": "Upcoming harvest",
                "message": f"You have {upcoming} harvest plan(s) coming up with {preorders} pre-orders already booked.",
            })

        if not insights:
            insights.append({
                "type": "empty",
                "emoji": "🌾",
                "title": "You're all set",
                "message": "Once you get orders, you'll see simple tips here to help your farm grow.",
            })
        return insights[:5]

    async def get_farmer_product_stock(
        self,
        farmer_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        try:
            farmer_obj = ObjectId(farmer_id)
        except Exception:
            return []

        match: Dict[str, Any] = {"deletedAt": None, "farmerId": farmer_obj}
        if from_date or to_date:
            date_filter: Dict[str, Any] = {}
            if from_date:
                date_filter["$gte"] = from_date
            if to_date:
                date_filter["$lte"] = to_date
            match["orderDate"] = date_filter

        pipeline = [
            {"$match": match},
            {"$unwind": "$items"},
            {
                "$group": {
                    "_id": "$items.productId",
                    "unitsSold": {"$sum": {"$ifNull": ["$items.quantity", 0]}}
                }
            }
        ]
        sold = await self.aggregate(pipeline)
        sold_map = {str(item["_id"]): item.get("unitsSold", 0) for item in sold}

        stock_map: Dict[str, Dict[str, Any]] = {}
        try:
            inventory_list = await inventory_repository.get_by_farmer_with_pipeline(farmer_id)
            for inv in inventory_list:
                pid = str(inv.get("product_id"))
                total = inv.get("total_stock", 0)
                reserved = inv.get("reserved_stock", 0)
                sold_stock = inv.get("sold_stock", 0)
                product_doc = inv.get("product") or {}
                stock_map[pid] = {
                    "remaining": max(0, total - reserved - sold_stock),
                    "totalStock": total,
                    "reserved": reserved,
                    "image": product_doc.get("imageUrl") or ((product_doc.get("images") or [None])[0]),
                }
        except Exception as e:
            logger.error(f"Error fetching farmer inventory for stock analytics: {str(e)}")

        product_ids = list(set(list(sold_map.keys()) + list(stock_map.keys())))
        names: Dict[str, tuple] = {}
        if product_ids:
            try:
                products = await product_repository.find_many(
                    {"_id": {"$in": [ObjectId(pid) for pid in product_ids]}, "deletedAt": None},
                    limit=len(product_ids) or 1
                )
                for doc in products:
                    img = doc.get("imageUrl") or ((doc.get("images") or [None])[0])
                    live_qty = doc.get("quantity")
                    names[str(doc["_id"])] = (doc.get("name") or "Unknown Product", img, live_qty, doc.get("unit") or "kg")
            except Exception as e:
                logger.error(f"Error fetching products for stock analytics: {str(e)}")

        result = []
        for pid in sorted(product_ids, key=lambda p: -sold_map.get(p, 0)):
            name, img, live_qty, unit = names.get(pid, ("Unknown Product", None, None, "kg"))
            st = stock_map.get(pid, {})
            remaining = live_qty if live_qty is not None else st.get("remaining", 0)
            result.append({
                "id": pid,
                "name": name,
                "image": img or st.get("image"),
                "unitsSold": sold_map.get(pid, 0),
                "remaining": remaining,
                "unit": unit,
                "totalStock": st.get("totalStock", 0),
                "reserved": st.get("reserved", 0),
            })
        return result

    async def get_farmer_category_distribution(
        self,
        farmer_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        limit: int = 8
    ) -> List[Dict[str, Any]]:
        try:
            farmer_obj = ObjectId(farmer_id)
        except Exception:
            return []

        match: Dict[str, Any] = {"deletedAt": None, "farmerId": farmer_obj}
        if from_date or to_date:
            date_filter: Dict[str, Any] = {}
            if from_date:
                date_filter["$gte"] = from_date
            if to_date:
                date_filter["$lte"] = to_date
            match["orderDate"] = date_filter

        pipeline = [
            {"$match": match},
            {"$unwind": "$items"},
            {
                "$group": {
                    "_id": "$items.productId",
                    "revenue": {
                        "$sum": {
                            "$multiply": [
                                {"$ifNull": ["$items.quantity", 0]},
                                {"$ifNull": ["$items.unitPrice", 0]}
                            ]
                        }
                    }
                }
            }
        ]
        result = await self.aggregate(pipeline)
        if not result:
            return []

        product_rev = {str(item["_id"]): item.get("revenue", 0.0) for item in result}
        product_ids = list(product_rev.keys())

        prod_to_cat: Dict[str, Any] = {}
        try:
            products = await product_repository.find_many(
                {"_id": {"$in": [ObjectId(pid) for pid in product_ids]}, "deletedAt": None},
                limit=len(product_ids) or 1
            )
            for doc in products:
                cid = doc.get("categoryId")
                if cid:
                    prod_to_cat[str(doc["_id"])] = cid
        except Exception as e:
            logger.error(f"Error fetching products for category distribution: {str(e)}")

        cat_ids = set(prod_to_cat.values())
        cat_names: Dict[str, str] = {}
        if cat_ids:
            try:
                categories = await category_repository.find_many(
                    {"_id": {"$in": [ObjectId(cid) for cid in cat_ids]}, "deletedAt": None},
                    limit=len(cat_ids)
                )
                for doc in categories:
                    cat_names[str(doc["_id"])] = doc.get("name") or "Unknown"
            except Exception as e:
                logger.error(f"Error fetching categories: {str(e)}")

        agg: Dict[str, float] = {}
        for pid, rev in product_rev.items():
            cid = prod_to_cat.get(pid)
            name = cat_names.get(str(cid), "Uncategorized") if cid else "Uncategorized"
            agg[name] = agg.get(name, 0.0) + rev

        return [
            {"name": name, "value": round(rev, 2)}
            for name, rev in sorted(agg.items(), key=lambda x: -x[1])
        ][:limit]

    async def get_farmer_order_status_counts(
        self,
        farmer_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, int]:
        try:
            farmer_obj = ObjectId(farmer_id)
        except Exception:
            return {}

        filter = self._build_date_filter(from_date, to_date)
        filter["farmerId"] = farmer_obj
        pipeline = [
            {"$match": filter},
            {"$group": {"_id": "$orderStatus", "count": {"$sum": 1}}}
        ]
        result = await self.aggregate(pipeline)
        return {item["_id"]: item["count"] for item in result if item.get("_id")}

    async def get_top_products_by_farmer(
        self,
        farmer_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        try:
            farmer_obj = ObjectId(farmer_id)
        except Exception:
            return []

        async def _agg(date_filter: Dict[str, Any]) -> List[Dict[str, Any]]:
            match: Dict[str, Any] = {"deletedAt": None, "farmerId": farmer_obj}
            if date_filter:
                match.update(date_filter)
            pipeline = [
                {"$match": match},
                {"$unwind": "$items"},
                {
                    "$group": {
                        "_id": "$items.productId",
                        "name": {"$first": "$items.productName"},
                        "quantity": {"$sum": {"$ifNull": ["$items.quantity", 0]}},
                        "orderIds": {"$addToSet": "$_id"},
                        "revenue": {
                            "$sum": {
                                "$multiply": [
                                    {"$ifNull": ["$items.quantity", 0]},
                                    {"$ifNull": ["$items.unitPrice", 0]}
                                ]
                            }
                        }
                    }
                },
                {"$sort": {"revenue": -1}},
                {"$limit": limit}
            ]
            return await self.aggregate(pipeline)

        result = await _agg(self._build_date_filter(from_date, to_date))
        products = [
            {
                "id": str(item["_id"]),
                "name": item.get("name") or "Unknown Product",
                "revenue": round(item.get("revenue", 0.0), 2),
                "quantity": item.get("quantity", 0),
                "unitsSold": item.get("quantity", 0),
                "orders": len(item.get("orderIds", []))
            }
            for item in result
        ]

        prev_revenue: Dict[str, float] = {}
        if from_date and to_date:
            span = to_date - from_date
            prev_results = await _agg({
                "orderDate": {"$gte": from_date - span, "$lt": from_date}
            })
            prev_revenue = {
                str(item["_id"]): item.get("revenue", 0.0)
                for item in prev_results
            }

        images: Dict[str, Any] = {}
        product_ids = [p["id"] for p in products if p["id"]]
        if product_ids:
            try:
                docs = await product_repository.find_many(
                    {"_id": {"$in": [ObjectId(pid) for pid in product_ids]}, "deletedAt": None}
                )
                for doc in docs:
                    img = doc.get("imageUrl")
                    if not img:
                        images_list = doc.get("images") or []
                        img = images_list[0] if images_list else None
                    images[str(doc["_id"])] = img
            except Exception as e:
                logger.error(f"Error fetching product images: {str(e)}")

        for p in products:
            p["image"] = images.get(p["id"])
            curr = p["revenue"]
            prev = prev_revenue.get(p["id"], 0.0)
            if prev > 0:
                p["growth"] = round((curr - prev) / prev * 100, 1)
            else:
                p["growth"] = 100.0 if curr > 0 else 0.0

        return products

    async def get_warehouse_metrics(
        self,
        warehouse_id: str,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        try:
            warehouse_obj = ObjectId(warehouse_id)
        except Exception:
            return {}

        filter = self._build_date_filter(from_date, to_date)
        filter["warehouseId"] = warehouse_obj

        pipeline = [
            {"$match": filter},
            {
                "$group": {
                    "_id": None,
                    "totalOrders": {"$sum": 1},
                    "totalRevenue": {"$sum": {"$ifNull": ["$totalAmount", 0]}},
                    "averageOrderValue": {"$avg": {"$ifNull": ["$totalAmount", 0]}},
                    "pendingOrders": {
                        "$sum": {
                            "$cond": [
                                {"$in": ["$orderStatus", ["pending", "confirmed", "processing", "ready_for_delivery", "dispatched", "in_transit"]]},
                                1,
                                0
                            ]
                        }
                    },
                    "deliveredOrders": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$orderStatus", "delivered"]},
                                1,
                                0
                            ]
                        }
                    },
                    "cancelledOrders": {
                        "$sum": {
                            "$cond": [
                                {"$eq": ["$orderStatus", "cancelled"]},
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]
        result = await self.aggregate(pipeline)
        if not result:
            return {
                "warehouseId": warehouse_id,
                "totalOrders": 0,
                "totalRevenue": 0.0,
                "averageOrderValue": 0.0,
                "pendingOrders": 0,
                "deliveredOrders": 0,
                "cancelledOrders": 0
            }
        metrics = result[0]
        metrics["warehouseId"] = warehouse_id
        return metrics

analytics_repository = AnalyticsRepository()
