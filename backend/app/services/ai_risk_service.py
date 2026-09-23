from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from bson import ObjectId
import logging

from app.ai.models.delivery_risk import delivery_risk_model
from app.ai.models.fraud_detection import fraud_detection_model
from app.ai.models.anomaly_detection import anomaly_detection_model
from app.repositories.order_repository import order_repository
from app.repositories.user_repository import user_repository
from app.repositories.product_repository import product_repository
from app.repositories.payment_repository import payment_repository
from app.repositories.delivery_repository import delivery_repository
from app.repositories.delivery_assignment_repository import delivery_assignment_repository

logger = logging.getLogger(__name__)


class AIRiskService:
    """AI risk & insight service.

    Implements the AgriConnect "AI never decides alone" principle: everything
    here produces a prediction / recommendation that the UI presents and the
    user confirms. No automatic bans, no automatic price changes, no automatic
    cancellations.
    """

    # ------------------------------------------------------------------ #
    # Delivery risk
    # ------------------------------------------------------------------ #

    @staticmethod
    async def predict_delivery_risk(
        order_id: str,
        partner_id: Optional[str] = None,
        distance_km: Optional[float] = None,
        time_window_minutes: Optional[int] = None,
        delivery_slot: Optional[str] = None,
    ) -> Dict[str, Any]:
        order = await order_repository.get_by_id(order_id)
        if not order:
            return {"error": "Order not found"}

        items = order.get("items", []) or []
        qty = sum(float(i.get("quantity", 0) or 0) for i in items)

        partner_features: Dict[str, Any] = {}
        partner_doc = None
        if partner_id:
            partner_doc = await delivery_repository.get_by_id(partner_id)
            if not partner_doc:
                partner_doc = await delivery_repository.get_by_user_id(partner_id)
        if partner_doc:
            stats = await delivery_repository.get_partner_stats(partner_id)
            active_load = await delivery_assignment_repository.count_active_for_partner(
                str(partner_doc["_id"])
            )
            partner_features = {
                "partner_on_time_rate": (stats.get("onTimeDelivery") or 0) / 100.0,
                "partner_rating": partner_doc.get("rating", 0) or 0,
                "partner_active_load": active_load,
                "previous_delays": int(
                    stats.get("cancelledDeliveries") or stats.get("pendingDeliveries") or 0
                ),
                "vehicle_capacity": partner_doc.get("capacity") or 0,
            }

        is_cod = str(order.get("paymentMethod", "") or "").lower() == "cash"
        if distance_km is None:
            distance_km = 0.0

        if time_window_minutes is None:
            time_window_minutes = 120

        features = {
            "distance_km": distance_km,
            "time_window_minutes": time_window_minutes,
            "is_cod": is_cod,
            "quantity_kg": qty,
            "delivery_slot": delivery_slot or order.get("deliveryTimeSlot", ""),
            "rural_roads": 0,
            **partner_features,
        }

        result = delivery_risk_model.predict(features)
        return {
            "orderId": order_id,
            "orderNumber": order.get("orderNumber", ""),
            "riskScore": result["risk_score"],
            "riskLevel": result["risk_level"],
            "expectedDeliveryMinutes": result["expected_delivery_minutes"],
            "recommendation": result["recommendation"],
            "factors": result["factors"],
            "confidence": result["confidence"],
            "timestamp": datetime.utcnow(),
        }

    @staticmethod
    async def analyze_farmer_deliveries(farmer_id: str) -> Dict[str, Any]:
        """Summarize delivery risk across a farmer's active orders."""
        orders = await order_repository.find_many({
            "farmerId": ObjectId(farmer_id),
            "orderStatus": {"$in": ["pending", "confirmed", "processing", "ready_for_delivery", "dispatched", "in_transit"]},
            "deletedAt": None,
        })
        orders = orders or []

        low = medium = high = 0
        risky_orders: List[Dict[str, Any]] = []
        for order in orders:
            partner_id = str(order.get("deliveryPartnerId")) if order.get("deliveryPartnerId") else None
            res = await AIRiskService.predict_delivery_risk(
                str(order["_id"]), partner_id=partner_id
            )
            if res.get("error"):
                continue
            score = res["riskScore"]
            if score <= 30:
                low += 1
            elif score <= 70:
                medium += 1
            else:
                high += 1
                risky_orders.append({
                    "orderId": str(order["_id"]),
                    "orderNumber": order.get("orderNumber", ""),
                    "customerName": order.get("customerName", "Customer"),
                    "totalAmount": order.get("totalAmount", 0),
                    "riskScore": score,
                    "riskLevel": res["riskLevel"],
                    "recommendation": res["recommendation"],
                })

        risky_orders.sort(key=lambda x: x["riskScore"], reverse=True)
        return {
            "totalOrders": len(orders),
            "lowRisk": low,
            "mediumRisk": medium,
            "highRisk": high,
            "riskyOrders": risky_orders[:10],
        }

    # ------------------------------------------------------------------ #
    # Fraud detection
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _customer_history_features(customer_id: str, order: Dict[str, Any]) -> Dict[str, Any]:
        orders = await order_repository.get_by_customer(customer_id, limit=100)
        orders = orders or []

        total_orders = len(orders)
        cod_cancelled = 0
        cod_total = 0
        recent_cancellations = 0
        refunds = 0
        total_value = 0.0
        coupon_orders = 0
        failed = 0
        now = datetime.utcnow()

        for o in orders:
            method = str(o.get("paymentMethod", "") or "").lower()
            is_cod = method == "cash"
            status = str(o.get("orderStatus", "") or "").lower()
            if is_cod:
                cod_total += 1
                if status in ("cancelled", "failed"):
                    cod_cancelled += 1
            if status == "cancelled":
                recent_cancellations += 1
            if o.get("couponId") or o.get("couponCode"):
                coupon_orders += 1
            total_value += float(o.get("totalAmount", 0) or 0)

            created = o.get("createdAt")
            if created:
                if now - created <= timedelta(days=90):
                    refunds += int(o.get("refundRequested", False) or 0)

        avg_value = total_value / total_orders if total_orders else 0
        cod_cancel_rate = cod_cancelled / cod_total if cod_total else 0

        payments = await payment_repository.get_by_user_id(customer_id, limit=50)
        payments = payments or []
        for p in payments:
            status = str(p.get("status", "") or "").lower()
            if status in ("failed", "cancelled"):
                failed += 1

        customer = await user_repository.get_by_id(customer_id)
        age_days = 365
        if customer and customer.get("createdAt"):
            age_days = max(1, (now - customer["createdAt"]).days)

        return {
            "cod_cancellation_rate": cod_cancel_rate,
            "order_value": float(order.get("totalAmount", 0) or 0),
            "customer_avg_order": round(avg_value, 2),
            "refund_frequency": refunds,
            "account_age_days": age_days,
            "failed_payments": failed,
            "coupon_used": bool(order.get("couponId") or order.get("couponCode")),
            "coupon_orders": coupon_orders,
            "is_cod": str(order.get("paymentMethod", "") or "").lower() == "cash",
            "recent_cancellations": recent_cancellations,
            "payment_method_changes": 0,
        }

    @staticmethod
    async def check_order_fraud(order_id: str) -> Dict[str, Any]:
        order = await order_repository.get_by_id(order_id)
        if not order:
            return {"error": "Order not found"}

        customer_id = str(order.get("customerId") or "")
        customer_name = order.get("customerName", "")
        if customer_id:
            features = await AIRiskService._customer_history_features(customer_id, order)
        else:
            features = {
                "order_value": float(order.get("totalAmount", 0) or 0),
                "is_cod": str(order.get("paymentMethod", "") or "").lower() == "cash",
            }

        result = fraud_detection_model.predict(features)
        if customer_id:
            customer = await user_repository.get_by_id(customer_id)
            customer_name = customer_name or (customer.get("name") or customer.get("firstName") or "Customer")

        return {
            "orderId": order_id,
            "orderNumber": order.get("orderNumber", ""),
            "customerId": customer_id,
            "customerName": customer_name,
            "riskScore": result["risk_score"],
            "riskLevel": result["risk_level"],
            "flags": result["flags"],
            "recommendation": result["recommendation"],
            "factors": result["factors"],
            "confidence": result["confidence"],
            "timestamp": datetime.utcnow(),
        }

    @staticmethod
    async def get_fraud_alerts(
        customer_id: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Fraud alerts for recent orders that need manual review."""
        filter: Dict[str, Any] = {"deletedAt": None}
        if customer_id:
            filter["customerId"] = ObjectId(customer_id)
        orders = await order_repository.find_many(
            filter, limit=200, sort=[("orderDate", -1)]
        )
        orders = orders or []

        alerts: List[Dict[str, Any]] = []
        for order in orders:
            res = await AIRiskService.check_order_fraud(str(order["_id"]))
            if res.get("error"):
                continue
            if res["riskLevel"] in ("MEDIUM", "HIGH"):
                alerts.append({
                    "orderId": res["orderId"],
                    "orderNumber": res["orderNumber"],
                    "customerId": res["customerId"],
                    "customerName": res["customerName"],
                    "riskScore": res["riskScore"],
                    "riskLevel": res["riskLevel"],
                    "flags": res["flags"],
                    "recommendation": res["recommendation"],
                    "totalAmount": float(order.get("totalAmount", 0) or 0),
                    "paymentMethod": order.get("paymentMethod", ""),
                    "orderDate": order.get("orderDate") or order.get("createdAt"),
                })
            if len(alerts) >= limit:
                break
        alerts.sort(key=lambda x: x["riskScore"], reverse=True)
        return alerts

    # ------------------------------------------------------------------ #
    # Anomaly detection
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _farmer_sales_anomalies(limit: int = 10) -> List[Dict[str, Any]]:
        """Flag farmers whose recent daily sales are unusually high/low."""
        from app.repositories.farmer_repository import farmer_repository

        farmers = await farmer_repository.find_many({"deletedAt": None}, limit=50)
        farmers = farmers or []
        alerts: List[Dict[str, Any]] = []

        for farmer in farmers:
            farmer_id = str(farmer["_id"])
            name = farmer.get("farmName") or farmer.get("name") or farmer.get("businessName") or "Farmer"
            orders = await order_repository.find_many({
                "farmerId": ObjectId(farmer_id),
                "orderStatus": "delivered",
                "deletedAt": None,
            })
            orders = orders or []
            if len(orders) < 5:
                continue

            daily = {}
            for o in orders:
                day_ts = o.get("deliveredAt") or o.get("orderDate")
                if not day_ts:
                    continue
                day = day_ts.strftime("%Y-%m-%d")
                daily[day] = daily.get(day, 0) + float(o.get("totalAmount", 0) or 0)

            days = sorted(daily.keys())
            if len(days) < 4:
                continue
            values = [daily[d] for d in days[:-1]]
            today_val = daily[days[-1]]

            res = anomaly_detection_model.detect(
                values, today_val, threshold=3.0, entity=farmer_id, metric="daily_sales"
            )
            if res["is_anomaly"]:
                alerts.append({
                    "entityId": farmer_id,
                    "entityName": name,
                    "entityType": "farmer_sales",
                    "metric": "daily_sales",
                    "current": res["current"],
                    "median": res["median"],
                    "zScore": res["z_score"],
                    "isAnomaly": True,
                    "reason": res["reason"],
                    "detectedAt": datetime.utcnow(),
                })
            if len(alerts) >= limit:
                break
        return alerts

    @staticmethod
    async def _partner_cod_anomalies(limit: int = 10) -> List[Dict[str, Any]]:
        """Flag delivery partners with unusually high COD collections."""
        partners = await delivery_repository.find_many(
            {"deletedAt": None}, limit=50
        )
        partners = partners or []
        alerts: List[Dict[str, Any]] = []

        for partner in partners:
            partner_id = str(partner["_id"])
            name = partner.get("name", "Partner")
            stats = await delivery_repository.get_partner_stats(partner_id)
            if stats.get("completedDeliveries", 0) < 5:
                continue

            orders = await order_repository.get_by_delivery_partner(partner_id, limit=200)
            orders = orders or []
            daily = {}
            for o in orders:
                if str(o.get("paymentMethod", "") or "").lower() != "cash":
                    continue
                if o.get("orderStatus") != "delivered":
                    continue
                day_ts = o.get("deliveredAt") or o.get("orderDate")
                if not day_ts:
                    continue
                day = day_ts.strftime("%Y-%m-%d")
                daily[day] = daily.get(day, 0) + float(o.get("totalAmount", 0) or 0)

            days = sorted(daily.keys())
            if len(days) < 4:
                continue
            values = [daily[d] for d in days[:-1]]
            today_val = daily[days[-1]]

            res = anomaly_detection_model.detect(
                values, today_val, threshold=3.0, entity=partner_id, metric="cod_collection"
            )
            if res["is_anomaly"]:
                alerts.append({
                    "entityId": partner_id,
                    "entityName": name,
                    "entityType": "partner_cod",
                    "metric": "cod_collection",
                    "current": res["current"],
                    "median": res["median"],
                    "zScore": res["z_score"],
                    "isAnomaly": True,
                    "reason": res["reason"],
                    "detectedAt": datetime.utcnow(),
                })
            if len(alerts) >= limit:
                break
        return alerts

    @staticmethod
    async def get_security_center() -> Dict[str, Any]:
        """Admin Security Center: fraud alerts + anomaly alerts."""
        fraud_alerts = await AIRiskService.get_fraud_alerts(limit=15)
        anomalies = await AIRiskService._farmer_sales_anomalies(limit=10)
        anomalies += await AIRiskService._partner_cod_anomalies(limit=10)

        return {
            "fraudAlerts": fraud_alerts,
            "anomalies": anomalies,
            "fraudAlertCount": len(fraud_alerts),
            "anomalyCount": len(anomalies),
            "timestamp": datetime.utcnow(),
        }

    # ------------------------------------------------------------------ #
    # Farmer dashboard insights
    # ------------------------------------------------------------------ #

    @staticmethod
    async def get_farmer_insights(farmer_id: str) -> Dict[str, Any]:
        """Combined AI insights for the farmer dashboard:
        demand forecast, delivery risk, pricing recommendation, community grouping.
        """
        products = await product_repository.find_many({
            "farmerId": ObjectId(farmer_id),
            "isActive": True,
            "deletedAt": None,
        }, limit=20)
        products = products or []

        demand_insights: List[Dict[str, Any]] = []
        pricing_insights: List[Dict[str, Any]] = []
        for product in products[:6]:
            pid = str(product["_id"])
            name = product.get("name", "")

            # Demand: next 7 days from delivered order history.
            orders = await order_repository.find_many({
                "items.productId": ObjectId(pid),
                "orderStatus": "delivered",
                "deletedAt": None,
            })
            demand_data = []
            for o in orders or []:
                for item in o.get("items", []):
                    if str(item.get("productId")) == pid:
                        demand_data.append({
                            "date": o.get("orderDate"),
                            "demand": float(item.get("quantity", 0) or 0),
                        })
            expected_kg = 0.0
            level = "LOW"
            recommendation = ""
            if len(demand_data) >= 4:
                avg_daily = sum(d["demand"] for d in demand_data) / len(demand_data)
                expected_kg = round(avg_daily * 7, 1)
                level = "HIGH" if avg_daily >= 15 else ("MEDIUM" if avg_daily >= 8 else "LOW")
                recommendation = (
                    "Increase inventory by ~20-30%"
                    if level == "HIGH"
                    else ("Maintain current stock" if level == "MEDIUM" else "Reduce stock levels")
                )
            demand_insights.append({
                "productId": pid,
                "productName": name,
                "expectedKg": expected_kg,
                "level": level,
                "recommendation": recommendation,
            })

            # Pricing: current vs nearby farmer average for the same product name.
            current = float(product.get("price", 0) or 0)
            nearby = await product_repository.find_many({
                "name": name,
                "isActive": True,
                "deletedAt": None,
                "farmerId": {"$ne": ObjectId(farmer_id)},
            }, limit=20)
            nearby_prices = [
                float(p.get("price", 0) or 0)
                for p in (nearby or [])
                if float(p.get("price", 0) or 0) > 0
            ]
            if nearby_prices and current > 0:
                avg_nearby = sum(nearby_prices) / len(nearby_prices)
                rec_min = round(max(current, avg_nearby - 1), 0)
                rec_max = round(max(avg_nearby, current) + 1, 0)
                demand_label = "HIGH" if level == "HIGH" else ("MEDIUM" if level == "MEDIUM" else "LOW")
                reasons = [
                    "Nearby farmers average ₹{:.0f}".format(avg_nearby),
                    "{} local demand".format(demand_label),
                ]
                pricing_insights.append({
                    "productId": pid,
                    "productName": name,
                    "currentPrice": current,
                    "recommendedMin": rec_min,
                    "recommendedMax": rec_max,
                    "demand": demand_label,
                    "reasons": reasons,
                })

        delivery = await AIRiskService.analyze_farmer_deliveries(farmer_id)

        # Community grouping: cluster active orders near the farm by area name.
        active_orders = await order_repository.find_many({
            "farmerId": ObjectId(farmer_id),
            "orderStatus": {"$in": ["ready_for_delivery", "confirmed", "processing"]},
            "deliveryPartnerId": None,
            "deletedAt": None,
        })
        active_orders = active_orders or []
        by_area: Dict[str, List[Dict[str, Any]]] = {}
        for o in active_orders:
            addr = o.get("deliveryAddress", {}) or {}
            area = addr.get("area") or addr.get("city") or "Other"
            qty = sum(float(i.get("quantity", 0) or 0) for i in (o.get("items", []) or []))
            by_area.setdefault(area, []).append({"id": str(o["_id"]), "qty": qty})

        best_area = max(by_area.items(), key=lambda kv: len(kv[1])) if by_area else (None, [])
        community = {
            "orderIds": [x["id"] for x in best_area[1]] if best_area[0] else [],
            "customerCount": len(best_area[1]) if best_area[0] else 0,
            "totalWeight": round(sum(x["qty"] for x in best_area[1]), 1) if best_area[0] else 0,
            "totalDistance": 0.0,
            "groupCount": len(by_area) if by_area else 0,
            "savingsKm": 0.0,
        }

        return {
            "demand": demand_insights,
            "delivery": delivery,
            "pricing": pricing_insights,
            "community": community,
            "timestamp": datetime.utcnow(),
        }


ai_risk_service = AIRiskService()