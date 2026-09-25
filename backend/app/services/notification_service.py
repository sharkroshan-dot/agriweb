import asyncio
import logging
import re
from typing import Any, Dict, Optional, List
from bson import ObjectId
from datetime import datetime
from app.repositories.notification_repository import notification_repository
from app.repositories.device_token_repository import device_token_repository
from app.repositories.notification_preferences_repository import notification_preferences_repository
from app.schemas.notification import (
    NotificationType,
    NotificationPriority,
    NotificationChannel,
    NotificationStatus
)
from app.core.config import settings
from app.services.farmer_settings_service import farmer_settings_service
from app.utils.helpers import normalize_phone_number
import json
import os

# Indian carrier email-to-SMS gateway domains (manual, free - no SMS API key needed).
# Delivery is best-effort: works for numbers still on the mapped carrier.
# airtelap.com is the most reliable in practice; keep it as the default via
# SMS_EMAIL_GATEWAY_DOMAIN and only override for clearly known prefixes.
INDIAN_EMAIL_TO_SMS_GATEWAYS = {
    "airtel": "airtelap.com",
    "jio": "ims.jio.com",
    "vi": "vapisms.com",
    "bsnl": "bsnl.in",
}

# Best-effort prefix map for Indian mobile numbers (first digits of the 10-digit number).
# Only high-confidence series are mapped; everything else uses the configured
# SMS_EMAIL_GATEWAY_DOMAIN (airtelap.com). MNP (porting) can move a number to
# another carrier, so this is only a heuristic.
_INDIAN_PREFIX_CARRIER = {
    **{str(n): "jio" for n in range(70, 80)},
    "98": "airtel",
    "99": "airtel",
}

try:
    import aiohttp
except ImportError:
    aiohttp = None

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication

try:
    from twilio.rest import Client
except ImportError:
    Client = None

logger = logging.getLogger(__name__)


def _json_safe(obj: Any) -> Any:
    """Recursively convert ObjectId (and datetimes) to JSON-serializable values."""
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, ObjectId):
        return str(obj)
    return obj


class NotificationService:
    """Notification service for all communication channels."""

    @staticmethod
    async def create_in_app_notification(
        user_id: str,
        type: NotificationType,
        title: str,
        message: str,
        data: Optional[Dict[str, Any]] = None,
        priority: NotificationPriority = NotificationPriority.MEDIUM
    ) -> Optional[Dict[str, Any]]:
        enabled = await notification_preferences_repository.get_enabled_types(user_id)
        if type.value not in enabled:
            return None

        notification_data = {
            "userId": ObjectId(user_id),
            "type": type.value,
            "title": title,
            "message": message,
            "data": data,
            "priority": priority.value,
            "channels": [NotificationChannel.IN_APP.value]
        }

        notification_id = await notification_repository.create_notification(notification_data)
        if notification_id:
            return await notification_repository.get_by_id(notification_id)
        return None

    @staticmethod
    async def get_user_notifications(
        user_id: str,
        is_read: Optional[bool] = None,
        type: Optional[NotificationType] = None,
        skip: int = 0,
        limit: int = 50
    ) -> Dict[str, Any]:
        notifications = await notification_repository.get_by_user_id(
            user_id, is_read, type, skip, limit
        )
        total = await notification_repository.count({
            "userId": ObjectId(user_id),
            "deletedAt": None
        })
        unread_count = await notification_repository.get_unread_count(user_id)

        for notif in notifications:
            notif["id"] = str(notif["_id"])

        notifications = [_json_safe(notif) for notif in notifications]

        return {
            "notifications": notifications,
            "unreadCount": unread_count,
            "total": total,
            "pagination": {
                "skip": skip,
                "limit": limit,
                "remaining": max(0, total - skip - limit)
            }
        }

    @staticmethod
    async def mark_notification_read(notification_id: str) -> bool:
        return await notification_repository.mark_as_read(notification_id)

    @staticmethod
    async def mark_all_notifications_read(user_id: str) -> bool:
        return await notification_repository.mark_all_as_read(user_id)

    @staticmethod
    async def get_unread_count(user_id: str) -> int:
        return await notification_repository.get_unread_count(user_id)

    @staticmethod
    async def send_push_notification(
        user_id: str,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        image: Optional[str] = None,
        sound: Optional[str] = None,
        badge: Optional[int] = None
    ) -> bool:
        tokens = await device_token_repository.get_by_user_id(user_id)
        if not tokens:
            return False

        success = False
        for token in tokens:
            platform = token.get("platform")
            device_token = token.get("deviceToken")
            if platform == "ios":
                success = await NotificationService.send_ios_push(
                    device_token, title, body, data, image, sound, badge
                )
            elif platform == "android":
                success = await NotificationService.send_android_push(
                    device_token, title, body, data, image, sound
                )
            elif platform == "web":
                success = await NotificationService.send_web_push(
                    device_token, title, body, data, image
                )
        return success

    @staticmethod
    async def send_ios_push(
        device_token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        image: Optional[str] = None,
        sound: Optional[str] = None,
        badge: Optional[int] = None
    ) -> bool:
        logger.info(f"iOS Push: {title} - {body} to {device_token}")
        return True

    @staticmethod
    async def send_android_push(
        device_token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        image: Optional[str] = None,
        sound: Optional[str] = None
    ) -> bool:
        if aiohttp is None or not settings.FIREBASE_SERVER_KEY:
            logger.warning("Android push not configured")
            return False

        try:
            fcm_url = "https://fcm.googleapis.com/fcm/send"
            payload = {
                "to": device_token,
                "notification": {
                    "title": title,
                    "body": body,
                    "sound": sound or "default",
                    "icon": "ic_notification"
                },
                "data": data or {}
            }
            if image:
                payload["notification"]["image"] = image

            headers = {
                "Authorization": f"key={settings.FIREBASE_SERVER_KEY}",
                "Content-Type": "application/json"
            }

            async with aiohttp.ClientSession() as session:
                async with session.post(fcm_url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        logger.info(f"Android push sent to {device_token}")
                        return True
                    logger.error(f"FCM error: {await response.text()}")
                    return False
        except Exception as e:
            logger.error(f"Error sending Android push: {str(e)}")
            return False

    @staticmethod
    async def send_web_push(
        device_token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, Any]] = None,
        image: Optional[str] = None
    ) -> bool:
        logger.info(f"Web Push: {title} - {body} to {device_token}")
        return True

    @staticmethod
    async def send_email(
        to: str,
        subject: str,
        body: str,
        template: Optional[str] = None,
        template_data: Optional[Dict[str, Any]] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        plain_text: Optional[str] = None
    ) -> bool:
        try:
            msg = MIMEMultipart("alternative")
            msg["From"] = f"AgriConnect AI <{settings.SMTP_USER}>"
            msg["To"] = to
            msg["Subject"] = subject
            msg["Reply-To"] = settings.SMTP_USER
            msg["Precedence"] = "bulk"
            msg["X-Auto-Response-Suppress"] = "OOF, AutoReply"
            msg.attach(MIMEText(plain_text or subject, "plain"))
            msg.attach(MIMEText(body, "html"))
            if attachments:
                for attachment in attachments:
                    part = MIMEApplication(
                        attachment["content"],
                        Name=attachment["filename"]
                    )
                    part["Content-Disposition"] = f'attachment; filename="{attachment["filename"]}"'
                    msg.attach(part)
            loop = asyncio.get_event_loop()
            def _send():
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
                    server.starttls()
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                    server.send_message(msg)
            await loop.run_in_executor(None, _send)
            logger.info(f"Email sent to {to}: {subject}")
            return True
        except Exception as e:
            logger.error(f"Error sending email: {str(e)}")
            return False

    @staticmethod
    async def send_order_confirmation_email(
        to: str,
        order_number: str,
        customer_name: str,
        order_details: Dict[str, Any]
    ) -> bool:
        subject = f"Order Confirmation - {order_number}"
        body = f"""
        <h1>Order Confirmation</h1>
        <p>Dear {customer_name},</p>
        <p>Your order #{order_number} has been confirmed.</p>
        <p><strong>Order Details:</strong></p>
        <ul>
            {''.join([f"<li>{item['quantity']}x {item['productName']} - ₹{item['totalPrice']}</li>" for item in order_details.get('items', [])])}
        </ul>
        <p><strong>Total: ₹{order_details.get('totalAmount', 0)}</strong></p>
        <p>Thank you for shopping with AgriConnect!</p>
        """
        return await NotificationService.send_email(to, subject, body)

    @staticmethod
    async def send_password_reset_email(
        to: str,
        name: str,
        reset_token: str
    ) -> bool:
        subject = "Password Reset Request"
        reset_link = f"{settings.WEBSITE_URL}/reset-password?token={reset_token}"
        body = f"""
        <h1>Password Reset Request</h1>
        <p>Dear {name},</p>
        <p>We received a request to reset your password.</p>
        <p><a href=\"{reset_link}\">Click here to reset your password</a></p>
        <p>This link will expire in 24 hours.</p>
        <p>If you didn't request this, please ignore this email.</p>
        """
        return await NotificationService.send_email(to, subject, body)

    @staticmethod
    async def send_otp_email(to: str, otp: str) -> bool:
        if not to:
            logger.info("No email address provided for OTP delivery")
            return True

        subject = "Your AgriConnect verification code"
        plain_text = f"Your AgriConnect verification code is: {otp}. Valid for 5 minutes."
        body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:30px 10px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06)">
<tr><td style="background:#2b7a3e;padding:24px 32px;text-align:center">
<h1 style="margin:0;color:#ffffff;font-size:22px">AgriConnect AI</h1>
</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 8px;color:#555;font-size:14px">Your verification code</p>
<div style="background:#f0faf3;border:2px dashed #2b7a3e;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
<span style="font-size:36px;font-weight:bold;color:#2b7a3e;letter-spacing:8px">{otp}</span>
</div>
<p style="margin:0 0 4px;color:#888;font-size:13px">This code is valid for <strong>5 minutes</strong>.</p>
<p style="margin:0;color:#888;font-size:13px">If you didn't request this, please ignore this email.</p>
</td></tr>
<tr><td style="background:#fafafa;padding:16px 32px;text-align:center;border-top:1px solid #eee">
<p style="margin:0;color:#aaa;font-size:11px">AgriConnect AI &bull; Smart Farming, Better Harvest</p>
</td></tr>
</table></td></tr></table>
</body>
</html>"""
        sent = await NotificationService.send_email(to, subject, body, plain_text=plain_text)
        if not sent and settings.DEBUG:
            logger.warning(f"Email delivery to {to} failed. Development fallback OTP: {otp}")
        return sent

    @staticmethod
    def _local_digits(normalized_phone: str) -> str:
        """Return the 10-digit local number (strip country code and '+')."""
        digits = re.sub(r"\D", "", normalized_phone or "")
        if digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        return digits

    @staticmethod
    def _carrier_gateway_domain(normalized_phone: str) -> str:
        """Pick the email-to-SMS gateway domain for the number's carrier.

        Falls back to SMS_EMAIL_GATEWAY_DOMAIN when the carrier is unknown
        or no mapping exists for it.
        """
        local = NotificationService._local_digits(normalized_phone)
        prefix = local[:2]
        carrier = _INDIAN_PREFIX_CARRIER.get(prefix)
        domain = INDIAN_EMAIL_TO_SMS_GATEWAYS.get(carrier or "") if carrier else None
        return domain or settings.SMS_EMAIL_GATEWAY_DOMAIN

    @staticmethod
    def _email_to_sms_address(normalized_phone: str) -> str:
        """Build a carrier email-to-SMS address from an E.164 phone number.

        Indian carrier gateways (airtelap.com, ims.jio.com, etc.) require the
        plain 10-digit local number - no country code, no '+'.
        """
        return f"{NotificationService._local_digits(normalized_phone)}@{NotificationService._carrier_gateway_domain(normalized_phone)}"

    @staticmethod
    async def _send_msg91(normalized_to: str, message: str) -> bool:
        """Send an SMS via MSG91 (returns True on accepted delivery)."""
        payload = {
            "sender": settings.MSG91_SENDER_ID,
            "route": settings.MSG91_ROUTE,
            "mobiles": normalized_to.lstrip("+"),
            "message": message,
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://control.msg91.com/api/v5/send",
                params={"country": settings.MSG91_COUNTRY},
                json=payload,
                headers={"authkey": settings.MSG91_AUTH_KEY},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                text = await response.text()
                try:
                    response_data = json.loads(text)
                except (json.JSONDecodeError, ValueError):
                    response_data = text
                if response.status == 200 and isinstance(response_data, dict) and response_data.get("type") == "success":
                    logger.info(f"SMS sent to {normalized_to} via MSG91: {response_data.get('message')}")
                    return True
                logger.error(f"Error sending SMS via MSG91: {response_data}")
                return False

    @staticmethod
    async def send_whatsapp(to: str, message: str) -> bool:
        """Send a message via the Meta WhatsApp Cloud API (free tier).

        Prefers an approved template when WHATSAPP_TEMPLATE_NAME is configured
        (required for business-initiated messages outside the 24h window),
        otherwise sends a plain text message.
        """
        if aiohttp is None:
            return False
        token = settings.WHATSAPP_ACCESS_TOKEN
        phone_id = settings.WHATSAPP_PHONE_NUMBER_ID
        if not (token and phone_id):
            return False
        normalized_to = normalize_phone_number(to)
        wa_number = normalized_to.lstrip("+")
        url = f"https://graph.facebook.com/{settings.WHATSAPP_GRAPH_VERSION}/{phone_id}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        if settings.WHATSAPP_TEMPLATE_NAME:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": wa_number,
                "type": "template",
                "template": {
                    "name": settings.WHATSAPP_TEMPLATE_NAME,
                    "language": {"code": settings.WHATSAPP_TEMPLATE_LANGUAGE},
                    "components": [
                        {"type": "body", "parameters": [{"type": "text", "text": message}]}
                    ],
                },
            }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": wa_number,
                "type": "text",
                "text": {"preview_url": False, "body": message},
            }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as response:
                    text = await response.text()
                    try:
                        response_data = json.loads(text)
                    except (json.JSONDecodeError, ValueError):
                        response_data = text
                    if response.status in (200, 201):
                        logger.info(f"WhatsApp message sent to {normalized_to}: {response_data.get('messages', [{}])[0].get('id')}")
                        return True
                    logger.warning(f"WhatsApp send failed for {normalized_to}: {response.status} {response_data}")
        except Exception as e:
            logger.error(f"WhatsApp send error for {normalized_to}: {str(e)}")
        return False

    @staticmethod
    async def send_sms(to: str, message: str) -> bool:
        normalized_to = normalize_phone_number(to)
        whatsapp_configured = bool(settings.WHATSAPP_ACCESS_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID)
        msg91_configured = bool(settings.MSG91_AUTH_KEY and settings.MSG91_SENDER_ID)
        twilio_configured = all([settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_PHONE_NUMBER])
        vonage_configured = all([settings.VONAGE_API_KEY, settings.VONAGE_API_SECRET, settings.VONAGE_FROM])
        smtp_gateway_configured = bool(settings.SMS_EMAIL_GATEWAY_DOMAIN)
        is_development = settings.ENVIRONMENT.lower() in {"development", "dev", "test"} and settings.DEBUG
        any_provider_configured = whatsapp_configured or msg91_configured or twilio_configured or vonage_configured or smtp_gateway_configured
        failures: List[str] = []

        # WhatsApp first - free tier (1,000 service conversations/month). Falls
        # through to SMS when the number isn't on WhatsApp or the message can't
        # be sent as a template outside the 24h window.
        if whatsapp_configured:
            if await NotificationService.send_whatsapp(normalized_to, message):
                return True
            failures.append("WhatsApp")

        # MSG91 second - the preferred SMS provider for Indian numbers
        if msg91_configured:
            try:
                sent = await NotificationService._send_msg91(normalized_to, message)
                if sent:
                    return True
            except Exception as e:
                failures.append(f"MSG91: {e}")
                logger.error(f"Error sending SMS via MSG91: {str(e)}")

        # Real SMS providers (verifiable delivery status), then the free email-to-SMS gateway
        if Client is not None and twilio_configured:
            try:
                client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
                message_response = client.messages.create(
                    body=message,
                    from_=settings.TWILIO_PHONE_NUMBER,
                    to=normalized_to
                )
                logger.info(f"SMS sent to {normalized_to}: {message_response.sid}")
                return True
            except Exception as e:
                failures.append(f"Twilio: {e}")
                logger.error(f"Error sending SMS via Twilio: {str(e)}")

        if vonage_configured and aiohttp is not None:
            payload = {
                "api_key": settings.VONAGE_API_KEY,
                "api_secret": settings.VONAGE_API_SECRET,
                "to": normalized_to,
                "from": settings.VONAGE_FROM,
                "text": message,
            }
            for attempt in range(2):
                retryable = False
                try:
                    async with aiohttp.ClientSession() as session:
                        async with session.post("https://rest.nexmo.com/sms/json", data=payload, timeout=aiohttp.ClientTimeout(total=15)) as response:
                            response_data = await response.json()
                            messages = response_data.get("messages", [])
                            if response.status == 200 and messages and messages[0].get("status") == "0":
                                logger.info(f"SMS sent to {normalized_to} via Vonage: {messages[0].get('message-id')}")
                                return True
                            retryable = response.status >= 500
                            failures.append(f"Vonage: {response_data}")
                            logger.error(f"Error sending SMS via Vonage: {response_data}")
                except Exception as e:
                    retryable = True
                    failures.append(f"Vonage: {e}")
                    logger.error(f"Error sending SMS via Vonage (attempt {attempt + 1}): {str(e)}")
                if not retryable:
                    break
                if attempt == 0:
                    await asyncio.sleep(1.5)

        # Email-to-SMS gateway (manual, free) - fallback
        if smtp_gateway_configured:
            try:
                gateway_addr = NotificationService._email_to_sms_address(normalized_to)
                sent = await NotificationService.send_email(gateway_addr, "AgriConnect", message)
                if sent:
                    logger.warning(
                        f"SMS emailed to {gateway_addr} via email-to-SMS gateway "
                        f"(carrier gateways are mostly discontinued; SMS may not be delivered)"
                    )
                    return True
                failures.append(f"Email-to-SMS gateway: no delivery accepted for {gateway_addr}")
                logger.warning(f"Email-to-SMS gateway failed for {gateway_addr}")
            except Exception as e:
                failures.append(f"Email-to-SMS gateway: {e}")
                logger.error(f"Email-to-SMS gateway error: {str(e)}")

        # Only simulate delivery when NO SMS provider is configured at all. If a
        # provider was configured but every attempt failed, report the failure
        # instead of silently pretending the SMS was delivered.
        if not any_provider_configured and is_development:
            logger.warning("No SMS provider configured; simulating SMS delivery in development")
            logger.info("SMS to %s: %s", normalized_to, message)
            return True

        logger.warning(
            "SMS NOT sent to %s. Configured providers failed: %s",
            normalized_to,
            "; ".join(failures) if failures else "no provider configured",
        )
        return False

    @staticmethod
    async def send_otp(phone: str, otp: str) -> bool:
        message = f"Your AgriConnect OTP is: {otp}. Valid for 5 minutes."
        return await NotificationService.send_sms(phone, message)

    @staticmethod
    async def send_order_confirmation(user_id: str, order_id: str) -> bool:
        from app.services.order_service import OrderService
        from app.services.user_service import UserService

        order = await OrderService.get_order(order_id, user_id, "customer")
        if not order:
            return False

        await NotificationService.create_in_app_notification(
            user_id,
            NotificationType.ORDER,
            "Order Confirmed",
            f"Your order #{order.get('orderNumber')} has been confirmed",
            {"orderId": order_id, "orderNumber": order.get('orderNumber')},
            NotificationPriority.HIGH
        )

        await NotificationService.send_push_notification(
            user_id,
            "Order Confirmed! 🎉",
            f"Your order #{order.get('orderNumber')} has been confirmed",
            {"type": "order", "orderId": order_id}
        )

        user = await UserService.get_user_by_id(user_id)
        if user and user.get("email"):
            await NotificationService.send_order_confirmation_email(
                user.get("email"),
                order.get('orderNumber'),
                user.get('firstName', "Customer"),
                order
            )
        return True

    @staticmethod
    async def send_order_delivered(user_id: str, order_id: str) -> bool:
        from app.services.order_service import OrderService
        order = await OrderService.get_order(order_id, user_id, "customer")
        if not order:
            return False
        rating_url = f"/orders/{order_id}#rate"
        await NotificationService.create_in_app_notification(
            user_id,
            NotificationType.ORDER,
            "Order Delivered! 📦",
            f"Your order #{order.get('orderNumber')} has been delivered. Please rate your products so others can shop with confidence!",
            {
                "orderId": order_id,
                "orderNumber": order.get('orderNumber'),
                "action": "rate",
                "url": rating_url
            },
            NotificationPriority.HIGH
        )
        await NotificationService.send_push_notification(
            user_id,
            "Order Delivered! 🎉",
            f"Your order #{order.get('orderNumber')} has been delivered. Enjoy your fresh produce! Please rate your products.",
            {"type": "order", "orderId": order_id, "action": "rate", "url": rating_url}
        )
        try:
            from app.services.sms_rating_service import SMSRatingService
            await SMSRatingService.start_rating_session(order)
        except Exception as e:
            logger.warning(f"Failed to start SMS rating session: {e}")
        return True

    @staticmethod
    async def send_payment_success(user_id: str, order_id: str) -> bool:
        await NotificationService.create_in_app_notification(
            user_id,
            NotificationType.PAYMENT,
            "Payment Successful 💳",
            f"Payment for order {order_id} was successful",
            {"orderId": order_id, "type": "payment"},
            NotificationPriority.HIGH
        )
        await NotificationService.send_push_notification(
            user_id,
            "Payment Successful ✅",
            f"Your payment for order {order_id} was successful",
            {"type": "payment", "orderId": order_id}
        )
        return True

    @staticmethod
    async def send_payment_failed(user_id: str, order_id: str) -> bool:
        await NotificationService.create_in_app_notification(
            user_id,
            NotificationType.PAYMENT,
            "Payment Failed ❌",
            f"Payment for order {order_id} failed. Please try again.",
            {"orderId": order_id, "type": "payment"},
            NotificationPriority.URGENT
        )
        await NotificationService.send_push_notification(
            user_id,
            "Payment Failed ❌",
            f"Your payment for order {order_id} failed. Please update payment method.",
            {"type": "payment", "orderId": order_id}
        )
        return True

    @staticmethod
    async def send_delivery_assignment(partner_id: str, order_id: str) -> bool:
        await NotificationService.create_in_app_notification(
            partner_id,
            NotificationType.DELIVERY,
            "New Delivery Assignment 🚚",
            "A new delivery has been assigned to you",
            {"orderId": order_id, "type": "delivery"},
            NotificationPriority.HIGH
        )
        await NotificationService.send_push_notification(
            partner_id,
            "New Delivery! 🚚",
            "You have a new delivery assignment. Check your app for details.",
            {"type": "delivery", "orderId": order_id}
        )
        return True

    @staticmethod
    async def send_delivery_completed(partner_id: str, order_id: str) -> bool:
        await NotificationService.create_in_app_notification(
            partner_id,
            NotificationType.DELIVERY,
            "Delivery Completed ✅",
            f"Delivery for order {order_id} has been completed",
            {"orderId": order_id, "type": "delivery"},
            NotificationPriority.MEDIUM
        )
        return True

    @staticmethod
    async def send_order_delivered_to_farmer(
        farmer_id: str,
        order: Dict[str, Any],
        pod_url: Optional[str] = None
    ) -> bool:
        """Notify the farmer that their product was delivered, with the POD photo."""
        order_id = str(order.get("_id") or order.get("id") or "")
        order_number = order.get("orderNumber") or order_id
        if not farmer_id or not order_id:
            return False
        await NotificationService.create_in_app_notification(
            farmer_id,
            NotificationType.DELIVERY,
            "Product Delivered ✅",
            f"Your product for order #{order_number} was delivered successfully. Proof of delivery attached.",
            {
                "orderId": order_id,
                "orderNumber": order_number,
                "type": "delivery",
                "podUrl": pod_url,
            },
            NotificationPriority.HIGH
        )
        push_image = pod_url
        if push_image and not push_image.startswith("http"):
            push_image = f"{settings.PUBLIC_BASE_URL}{push_image}"
        await NotificationService.send_push_notification(
            farmer_id,
            "Product Delivered! 🎉",
            f"Your product for order #{order_number} was delivered successfully. View the proof of delivery.",
            {"type": "delivery", "orderId": order_id, "podUrl": push_image},
            image=push_image
        )
        return True

    @staticmethod
    async def send_order_completed(farmer_id: str, order_id: str) -> bool:
        """Notify the farmer that an order was delivered (no-POD direct flow)."""
        order = None
        try:
            from app.repositories.order_repository import order_repository
            order = await order_repository.get_by_id(order_id)
        except Exception as e:
            logger.warning(f"Failed to load order for completed notification: {e}")
        if not farmer_id or not order_id:
            return False
        order_number = (order or {}).get("orderNumber") or order_id
        await NotificationService.create_in_app_notification(
            farmer_id,
            NotificationType.DELIVERY,
            "Delivery Completed ✅",
            f"Your order #{order_number} was delivered successfully.",
            {"orderId": order_id, "orderNumber": order_number, "type": "delivery"},
            NotificationPriority.HIGH
        )
        return True

    @staticmethod
    async def send_order_ready(customer_id: str, order_id: str) -> bool:
        await NotificationService.create_in_app_notification(
            customer_id,
            NotificationType.ORDER,
            "Your Order is Ready! 🎉",
            f"Your order {order_id} is ready for delivery",
            {"orderId": order_id, "type": "order"},
            NotificationPriority.HIGH
        )
        await NotificationService.send_push_notification(
            customer_id,
            "Order Ready! 🎉",
            "Your order is ready and will be delivered soon!",
            {"type": "order", "orderId": order_id}
        )
        return True

    @staticmethod
    async def send_order_cancelled(customer_id: str, order_id: str, reason: str) -> bool:
        await NotificationService.create_in_app_notification(
            customer_id,
            NotificationType.ORDER,
            "Order Cancelled ❌",
            f"Your order {order_id} has been cancelled. Reason: {reason}",
            {"orderId": order_id, "reason": reason, "type": "order"},
            NotificationPriority.HIGH
        )
        await NotificationService.send_push_notification(
            customer_id,
            "Order Cancelled ❌",
            f"Your order {order_id} has been cancelled.",
            {"type": "order", "orderId": order_id}
        )
        return True

    @staticmethod
    async def send_wallet_credit(user_id: str, amount: float, new_balance: float) -> bool:
        await NotificationService.create_in_app_notification(
            user_id,
            NotificationType.PAYMENT,
            "Wallet Credited 💰",
            f"₹{amount} has been added to your wallet. New balance: ₹{new_balance}",
            {"amount": amount, "newBalance": new_balance, "type": "wallet"},
            NotificationPriority.MEDIUM
        )
        await NotificationService.send_push_notification(
            user_id,
            "Wallet Credited! 💰",
            f"₹{amount} has been added to your wallet",
            {"type": "wallet", "amount": amount}
        )
        return True

    @staticmethod
    async def send_wallet_debit(user_id: str, amount: float, new_balance: float) -> bool:
        await NotificationService.create_in_app_notification(
            user_id,
            NotificationType.PAYMENT,
            "Withdrawal Initiated 💸",
            f"₹{amount} has been sent to your bank account. Remaining balance: ₹{new_balance}",
            {"amount": amount, "newBalance": new_balance, "type": "wallet"},
            NotificationPriority.MEDIUM
        )
        await NotificationService.send_push_notification(
            user_id,
            "Withdrawal Initiated 💸",
            f"₹{amount} is on its way to your bank account",
            {"type": "wallet", "amount": amount}
        )
        return True

    @staticmethod
    async def send_refund_confirmation(user_id: str, order_id: str, amount: float) -> bool:
        await NotificationService.create_in_app_notification(
            user_id,
            NotificationType.PAYMENT,
            "Refund Processed 💰",
            f"Refund of ₹{amount} for order {order_id} has been processed",
            {"orderId": order_id, "amount": amount, "type": "refund"},
            NotificationPriority.HIGH
        )
        await NotificationService.send_push_notification(
            user_id,
            "Refund Processed 💰",
            f"Refund of ₹{amount} has been processed for your order",
            {"type": "refund", "orderId": order_id}
        )
        return True

    @staticmethod
    async def send_new_order_notification(farmer_id: str, order_id: str) -> bool:
        if not await farmer_settings_service.alert_enabled(farmer_id, "newOrderAlert"):
            return False
        await NotificationService.create_in_app_notification(
            farmer_id,
            NotificationType.ORDER,
            "New Order Received! 📦",
            "You have received a new order",
            {"orderId": order_id, "type": "order"},
            NotificationPriority.HIGH
        )
        await NotificationService.send_push_notification(
            farmer_id,
            "New Order! 📦",
            "You have received a new order. Check your dashboard.",
            {"type": "order", "orderId": order_id}
        )
        return True

    @staticmethod
    async def send_incoming_stock_notification(warehouse_manager_id: str, incoming_id: str) -> bool:
        await NotificationService.create_in_app_notification(
            warehouse_manager_id,
            NotificationType.WAREHOUSE,
            "New Stock Incoming 📦",
            "New stock is scheduled to arrive",
            {"incomingId": incoming_id, "type": "warehouse"},
            NotificationPriority.MEDIUM
        )
        await NotificationService.send_push_notification(
            warehouse_manager_id,
            "Stock Incoming 📦",
            "New stock is scheduled to arrive at your warehouse",
            {"type": "warehouse", "incomingId": incoming_id}
        )
        return True

    @staticmethod
    async def send_custom_notification(
        user_id: str,
        message: str,
        title: str = "Update",
        data: Optional[Dict[str, Any]] = None
    ) -> None:
        """Send a custom notification to a user."""
        try:
            await NotificationService.create_in_app_notification(
                user_id=user_id,
                type=NotificationType.SYSTEM,
                title=title,
                message=message,
                data=data or {},
                priority=NotificationPriority.MEDIUM
            )
        except Exception as e:
            logger.error(f"Failed to send custom notification: {str(e)}")


notification_service = NotificationService()
