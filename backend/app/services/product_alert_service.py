from typing import Optional, Dict, Any, List
from app.repositories.product_alert_repository import product_alert_repository
from app.repositories.product_repository import product_repository
from app.services.notification_service import NotificationService
from app.schemas.notification import NotificationType
import logging

logger = logging.getLogger(__name__)

VALID_ALERT_TYPES = {"back_in_stock", "price_drop"}


class ProductAlertService:
    """Service for back-in-stock and price-drop alerts."""

    @staticmethod
    async def subscribe(
        user_id: str,
        product_id: str,
        alert_type: str,
        target_price: Optional[float] = None
    ) -> Optional[Dict[str, Any]]:
        """Subscribe the user to an alert for a product."""
        if alert_type not in VALID_ALERT_TYPES:
            return None

        product = await product_repository.get_by_id(product_id)
        if not product:
            return None

        price = product.get("price") or 0
        alert_id = await product_alert_repository.subscribe(
            user_id,
            product_id,
            alert_type,
            target_price=target_price,
            price_at_subscribe=price,
        )
        if not alert_id:
            return None

        return {
            "id": alert_id,
            "productId": product_id,
            "alertType": alert_type,
            "targetPrice": target_price,
            "priceAtSubscribe": price,
            "isActive": True,
        }

    @staticmethod
    async def unsubscribe(user_id: str, alert_id: str) -> bool:
        """Unsubscribe the user from an alert."""
        return await product_alert_repository.unsubscribe(alert_id, user_id)

    @staticmethod
    async def get_alerts(user_id: str) -> List[Dict[str, Any]]:
        """Get a user's active alerts, joined with product info."""
        alerts = await product_alert_repository.get_by_user(user_id)
        result = []
        for alert in alerts:
            product_id = str(alert["productId"])
            product = await product_repository.get_by_id(product_id)
            item = {
                "id": str(alert["_id"]),
                "productId": product_id,
                "alertType": alert["alertType"],
                "targetPrice": alert.get("targetPrice"),
                "priceAtSubscribe": alert.get("priceAtSubscribe"),
                "createdAt": alert.get("createdAt"),
            }
            if product:
                item["productName"] = product.get("name", "Product")
                item["productImage"] = (product.get("images") or [None])[0]
                item["price"] = product.get("price", 0)
                item["quantity"] = product.get("quantity", 0)
                item["inStock"] = (product.get("quantity", 0) or 0) > 0
            result.append(item)
        return result

    @staticmethod
    async def check_and_notify(
        product_id: str,
        *,
        quantity: Optional[int] = None,
        price: Optional[float] = None
    ) -> None:
        """Fire any active alerts that now match the product's current state."""
        try:
            product = await product_repository.get_by_id(product_id)
            if not product:
                return

            alerts = await product_alert_repository.get_active_by_product(product_id)
            if not alerts:
                return

            quantity = quantity if quantity is not None else (product.get("quantity", 0) or 0)
            price = price if price is not None else (product.get("price", 0) or 0)
            product_name = product.get("name", "This product")

            for alert in alerts:
                alert_type = alert.get("alertType")
                if alert_type == "back_in_stock" and quantity > 0:
                    await ProductAlertService._fire(
                        alert, "back_in_stock", product_name, price
                    )
                elif alert_type == "price_drop":
                    target = alert.get("targetPrice")
                    base = alert.get("priceAtSubscribe")
                    if target is not None and price <= target:
                        await ProductAlertService._fire(
                            alert, "price_drop", product_name, price
                        )
                    elif target is None and base is not None and price < base:
                        await ProductAlertService._fire(
                            alert, "price_drop", product_name, price
                        )
        except Exception as e:
            logger.error(f"ProductAlertService.check_and_notify error for {product_id}: {e}")

    @staticmethod
    async def _fire(alert: Dict[str, Any], alert_type: str, product_name: str, price: float) -> None:
        """Create in-app notification + SMS for a matched alert, then deactivate it."""
        try:
            user_id = str(alert["userId"])
            product_id = str(alert["productId"])
            data = {"productId": product_id, "alertType": alert_type}

            if alert_type == "back_in_stock":
                title = "Back in stock"
                message = f"Great news! {product_name} is back in stock. Order it before it sells out."
            else:
                title = "Price dropped"
                message = f"Good news! The price of {product_name} has dropped to ₹{price:g}. Check it out now."

            await NotificationService.create_in_app_notification(
                user_id=user_id,
                type=NotificationType.CUSTOMER,
                title=title,
                message=message,
                data=data,
            )

            from app.services.user_service import UserService
            user = await UserService.get_user_by_id(user_id)
            phone = (user or {}).get("phone") or (user or {}).get("phoneNumber")
            if phone:
                await NotificationService.send_sms(phone, f"{title}: {message}")

            await product_alert_repository.deactivate(str(alert["_id"]))
        except Exception as e:
            logger.error(f"ProductAlertService._fire error: {e}")


# Singleton instance
product_alert_service = ProductAlertService()
