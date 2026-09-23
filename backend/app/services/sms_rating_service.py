import logging
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional
from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.repositories.order_repository import order_repository
from app.repositories.user_repository import user_repository
from app.repositories.product_repository import product_repository
from app.repositories.delivery_repository import delivery_repository
from app.schemas.product import ProductReviewCreate
from app.services.product_service import ProductService
from app.services.notification_service import NotificationService
from app.templates.sms_templates import SMSTemplates

logger = logging.getLogger(__name__)


class SMSRatingService:
    """Email-to-SMS based product ratings after delivery.

    When an order is delivered the customer receives an SMS (via the
    email-to-SMS gateway) with a one-tap rating link. The link opens a
    simple mobile rating page - no login, no app navigation required.
    """

    @staticmethod
    async def start_rating_session(order: Dict[str, Any]) -> None:
        """Create a rating link for the delivered order and text it to the customer.

        The single link collects product reviews and, when a delivery partner
        was assigned to the order, a delivery partner rating as well.
        """
        try:
            if order.get("smsRating", {}).get("active"):
                return
            product_ids = SMSRatingService._order_product_ids(order)
            delivery_partner = await SMSRatingService._delivery_partner_info(order)
            if not product_ids and not delivery_partner:
                return
            token = secrets.token_urlsafe(24)
            session = {
                "active": True,
                "ratingToken": token,
                "pending": product_ids,
                "total": len(product_ids),
                "createdAt": datetime.utcnow()
            }
            if delivery_partner:
                session["deliveryPartner"] = delivery_partner
                session["deliveryDone"] = False
            await order_repository.set_rating_session(str(order["_id"]), session)

            user = await user_repository.get_by_id(str(order.get("customerId")))
            if not user:
                return
            order_number = order.get("orderNumber", "")
            rating_link = f"{settings.PUBLIC_BASE_URL}{settings.API_V1_STR}/notifications/rate/{token}"
            phone = user.get("phone")
            email = user.get("email")
            has_delivery = bool(delivery_partner)

            if phone:
                sms_sent = await NotificationService.send_sms(
                    phone,
                    SMSTemplates.get_order_delivered_rating_link_template(order_number, rating_link, has_delivery=has_delivery)
                )
                if not sms_sent:
                    logger.warning(f"Rating SMS NOT sent to {phone} for order {order_number}")
            else:
                logger.info(f"No phone on user {user.get('_id')}; skipping rating SMS")

            if email:
                subject = f"Order #{order_number} Delivered - Rate Your Order"
                body = SMSRatingService.render_email_body(order_number, rating_link, delivery_partner)
                await NotificationService.send_email(
                    email,
                    subject,
                    body,
                    plain_text=SMSTemplates.get_order_delivered_rating_link_template(order_number, rating_link, has_delivery=has_delivery)
                )
            else:
                logger.info(f"No email on user {user.get('_id')}; skipping rating email")
        except Exception as e:
            logger.error(f"Error starting SMS rating session: {str(e)}")

    @staticmethod
    def render_email_body(
        order_number: str,
        rating_link: str,
        delivery_partner: Optional[Dict[str, Any]] = None
    ) -> str:
        """Render the HTML body of the delivery + rating email."""
        rating_text = (
            f"Please rate your delivery partner {delivery_partner['name']} and the products you received."
            if delivery_partner
            else "Please rate the products you received."
        )
        return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0faf3;font-family:-apple-system,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#2b7a3e;border-radius:12px 12px 0 0;padding:22px 24px;color:#fff;text-align:center;">
      <h1 style="margin:0;font-size:20px;">Order #{order_number} Delivered!</h1>
      <p style="margin:6px 0 0;opacity:.85;font-size:13px;">Thank you for shopping with AgriConnect.</p>
    </div>
    <div style="background:#fff;border-radius:0 0 12px 12px;padding:24px;box-shadow:0 1px 6px rgba(0,0,0,.08);">
      <p style="margin:0 0 8px;font-size:15px;color:#1f2937;">Enjoy your fresh produce!</p>
      <p style="margin:0 0 20px;font-size:15px;color:#1f2937;">
        {rating_text}
      </p>
      <a href="{rating_link}" style="display:inline-block;background:#2b7a3e;color:#fff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 24px;border-radius:8px;">Rate Your Order</a>
      <p style="margin:20px 0 0;font-size:12px;color:#6b7280;">
        Or copy this link: <a href="{rating_link}" style="color:#2b7a3e;">{rating_link}</a>
      </p>
    </div>
  </div>
</body>
</html>"""

    @staticmethod
    async def get_rating_context(token: str) -> Optional[Dict[str, Any]]:
        """Return the pending products (and delivery partner) to rate for a link."""
        order = await order_repository.get_by_rating_token(token)
        if not order:
            return None
        session = order.get("smsRating", {})
        products = []
        for pid in session.get("pending", []):
            product = await product_repository.find_one({"_id": ObjectId(pid), "deletedAt": None})
            products.append({
                "id": str(pid),
                "name": (product or {}).get("name", "Product"),
                "unit": (product or {}).get("unit", ""),
            })

        delivery_partner = session.get("deliveryPartner")
        if delivery_partner:
            try:
                from app.repositories.delivery_rating_repository import delivery_rating_repository
                existing = await delivery_rating_repository.get_by_order(str(order["_id"]))
                if existing or session.get("deliveryDone"):
                    delivery_partner = None
            except Exception as e:
                logger.error(f"Error checking delivery rating status: {e}")

        return {
            "token": token,
            "orderNumber": order.get("orderNumber", ""),
            "products": products,
            "deliveryPartner": delivery_partner,
        }

    @staticmethod
    async def submit_ratings(
        token: str,
        ratings: Dict[str, int],
        delivery_rating: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Create reviews and/or a delivery rating, then finish or keep the session.

        The session stays active until every pending product and (if present)
        the delivery partner have been rated, so a customer can come back and
        finish the rest later.
        """
        order = await order_repository.get_by_rating_token(token)
        if not order:
            return {"success": False, "message": "invalid link"}
        session = order.get("smsRating", {})
        created = 0
        skipped = 0

        remaining = []
        for pid in session.get("pending", []):
            rating = ratings.get(str(pid))
            if rating is None or not isinstance(rating, int) or not (1 <= rating <= 5):
                remaining.append(pid)
                continue
            try:
                review = await ProductService.create_review(
                    str(order["customerId"]),
                    pid,
                    ProductReviewCreate(rating=rating, comment="Rated via SMS link", orderId=str(order["_id"]))
                )
                if review:
                    created += 1
                else:
                    skipped += 1
                    remaining.append(pid)
            except Exception as e:
                logger.error(f"Error creating review for {pid}: {e}")
                remaining.append(pid)

        has_delivery = bool(session.get("deliveryPartner"))
        delivery_done = bool(session.get("deliveryDone"))
        if has_delivery and not delivery_done:
            try:
                from app.repositories.delivery_rating_repository import delivery_rating_repository
                existing = await delivery_rating_repository.get_by_order(str(order["_id"]))
                if existing:
                    delivery_done = True
            except Exception as e:
                logger.error(f"Error checking existing delivery rating: {e}")
        if delivery_rating and has_delivery and not delivery_done:
            delivery_done = await SMSRatingService._submit_delivery_rating(order, delivery_rating)

        # Nothing was submitted this time - leave the session untouched.
        if created == 0 and not delivery_done:
            return {
                "success": False,
                "created": 0,
                "skipped": skipped,
                "message": "None of your ratings were saved. Please try again.",
            }

        updates = {"pending": remaining}
        if has_delivery:
            updates["deliveryDone"] = delivery_done

        delivery_complete = (not has_delivery) or delivery_done
        done = (not remaining) and delivery_complete

        if done:
            await order_repository.clear_rating_session(str(order["_id"]))
        else:
            await order_repository.update_rating_session(str(order["_id"]), updates)

        return {
            "success": True,
            "created": created,
            "skipped": skipped,
            "deliveryRated": delivery_done,
            "done": done,
        }

    @staticmethod
    async def _submit_delivery_rating(order: Dict[str, Any], delivery_rating: Dict[str, Any]) -> bool:
        """Create a delivery partner rating for the delivered order via the token."""
        try:
            from app.schemas.delivery_rating import DeliveryRatingCreate
            from app.services.delivery_rating_service import DeliveryRatingService

            overall = delivery_rating.get("overallRating")
            if not isinstance(overall, int) or not (1 <= overall <= 5):
                return False
            data = DeliveryRatingCreate(
                orderId=str(order["_id"]),
                overallRating=overall,
                onTimeRating=delivery_rating.get("onTimeRating") or overall,
                professionalismRating=delivery_rating.get("professionalismRating") or overall,
                handlingRating=delivery_rating.get("handlingRating") or overall,
                communicationRating=delivery_rating.get("communicationRating") or overall,
                feedback=delivery_rating.get("feedback"),
            )
            await DeliveryRatingService.submit_rating(
                str(order["customerId"]),
                str(order["_id"]),
                data
            )
            return True
        except HTTPException as e:
            if e.status_code == status.HTTP_409_CONFLICT:
                return True
            logger.error(f"Error submitting delivery rating via SMS link: {e.detail}")
            return False
        except Exception as e:
            logger.error(f"Error submitting delivery rating via SMS link: {e}")
            return False

    @staticmethod
    def render_page(context: Dict[str, Any]) -> str:
        """Render a simple mobile-friendly rating page (products + delivery partner)."""
        token = context["token"]
        order_number = context["orderNumber"]
        products = context.get("products", [])
        cards = ""
        for p in products:
            stars = "".join(
                f'<button type="button" class="star" data-val="{s}">★</button>'
                for s in range(1, 6)
            )
            unit = f' <span class="unit">{p["unit"]}</span>' if p.get("unit") else ""
            cards += (
                f'<div class="card">'
                f'<div class="pname">{p["name"]}{unit}</div>'
                f'<div class="stars" data-pid="{p["id"]}">{stars}</div>'
                f'</div>'
            )
        products_html = ""
        if products:
            products_html = (
                f'<h2 class="sec-title">Rate your products</h2>'
                f'<div id="cards">{cards}</div>'
            )

        delivery_html = ""
        delivery = context.get("deliveryPartner")
        if delivery:
            d_stars = "".join(
                f'<button type="button" class="star" data-dval="{s}">★</button>'
                for s in range(1, 6)
            )
            delivery_html = (
                f'<div class="card" id="deliveryCard">'
                f'<div class="pname">Rate your delivery partner</div>'
                f'<div class="pname sub">{delivery.get("name", "Delivery Partner")}</div>'
                f'<div class="stars" id="deliveryStars">{d_stars}</div>'
                f'<textarea id="deliveryFeedback" class="feedback" '
                f'placeholder="How was your delivery experience? (optional)" rows="3"></textarea>'
                f'</div>'
            )

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rate Your Order</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #f0faf3; color: #1f2937; }}
  .wrap {{ max-width: 480px; margin: 0 auto; padding: 24px 16px 40px; }}
  .head {{ background: #2b7a3e; color: #fff; border-radius: 12px; padding: 18px 20px; text-align: center; margin-bottom: 16px; }}
  .head h1 {{ font-size: 20px; margin-bottom: 4px; }}
  .head p {{ font-size: 13px; opacity: .85; }}
  .sec-title {{ font-size: 15px; font-weight: 600; color: #2b7a3e; margin: 0 0 10px; }}
  .card {{ background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }}
  .pname {{ font-size: 16px; font-weight: 600; margin-bottom: 10px; }}
  .pname.sub {{ font-size: 13px; font-weight: 400; color: #6b7280; margin-bottom: 10px; }}
  .unit {{ font-weight: 400; color: #6b7280; font-size: 13px; }}
  .stars {{ display: flex; gap: 6px; }}
  .star {{ font-size: 30px; line-height: 1; background: none; border: none; color: #d1d5db; cursor: pointer; padding: 0 2px; }}
  .star.active {{ color: #f59e0b; }}
  .feedback {{ width: 100%; margin-top: 12px; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; font-family: inherit; resize: vertical; }}
  button.submit {{ width: 100%; margin-top: 6px; background: #2b7a3e; color: #fff; font-size: 17px; font-weight: 600; border: none; border-radius: 10px; padding: 14px; cursor: pointer; }}
  button.submit:disabled {{ background: #9ca3af; }}
  .msg {{ margin-top: 14px; text-align: center; font-size: 15px; }}
  .msg.ok {{ color: #2b7a3e; font-weight: 600; }}
  .msg.err {{ color: #dc2626; }}
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <h1>Rate Your Order</h1>
    <p>Order #{order_number} &bull; Tap the stars to rate</p>
  </div>
  {products_html}
  {delivery_html}
  <button class="submit" id="submit" onclick="submitRatings()">Submit Ratings</button>
  <div class="msg" id="msg"></div>
</div>
<script>
  var ratings = {{}};
  var deliveryOverall = 0;
  document.querySelectorAll('.stars').forEach(function(row) {{
    var pid = row.getAttribute('data-pid');
    row.querySelectorAll('.star').forEach(function(btn) {{
      btn.addEventListener('click', function() {{
        var val = parseInt(btn.getAttribute('data-val'));
        ratings[pid] = val;
        row.querySelectorAll('.star').forEach(function(s) {{
          s.classList.toggle('active', parseInt(s.getAttribute('data-val')) <= val);
        }});
      }});
    }});
  }});
  var dRow = document.getElementById('deliveryStars');
  if (dRow) {{
    dRow.querySelectorAll('.star').forEach(function(btn) {{
      btn.addEventListener('click', function() {{
        deliveryOverall = parseInt(btn.getAttribute('data-dval'));
        dRow.querySelectorAll('.star').forEach(function(s) {{
          s.classList.toggle('active', parseInt(s.getAttribute('data-dval')) <= deliveryOverall);
        }});
      }});
    }});
  }}
  async function submitRatings() {{
    var msg = document.getElementById('msg');
    var btn = document.getElementById('submit');
    var hasProduct = Object.keys(ratings).length > 0;
    if (!hasProduct && !deliveryOverall) {{
      msg.className = 'msg err'; msg.textContent = 'Please rate at least one item.';
      return;
    }}
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Submitting...';
    try {{
      var body = {{ ratings: ratings }};
      if (deliveryOverall) {{
        body.deliveryPartner = {{
          overallRating: deliveryOverall,
          feedback: document.getElementById('deliveryFeedback').value.trim() || undefined
        }};
      }}
      var res = await fetch(window.location.href, {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify(body)
      }});
      var errMsg = 'This rating link is invalid or already used.';
      try {{ var data = await res.json(); if (data && data.detail) errMsg = data.detail; }} catch (e) {{}}
      if (res.ok) {{
        if (data && data.done) {{
          msg.className = 'msg ok';
          msg.textContent = 'Thanks for rating! Your feedback helps other shoppers.';
          var cards = document.getElementById('cards');
          if (cards) cards.style.display = 'none';
          btn.style.display = 'none';
          var dc = document.getElementById('deliveryCard');
          if (dc) dc.style.display = 'none';
        }} else {{
          msg.className = 'msg ok';
          msg.textContent = 'Thanks! Please rate the remaining items below.';
          window.location.reload();
        }}
      }} else {{
        msg.className = 'msg err';
        msg.textContent = errMsg;
        btn.disabled = false;
      }}
    }} catch (e) {{
      msg.className = 'msg err';
      msg.textContent = 'Something went wrong. Please try again.';
      btn.disabled = false;
    }}
  }}
</script>
</body>
</html>"""

    @staticmethod
    def render_invalid_page() -> str:
        """Render a simple message for invalid/expired rating links."""
        return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rating</title>
<style>
  body {{ font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #f0faf3; color: #1f2937; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }}
  .box {{ background: #fff; border-radius: 12px; padding: 32px 24px; text-align: center; max-width: 340px; box-shadow: 0 1px 6px rgba(0,0,0,.08); }}
  .box h1 {{ font-size: 18px; margin-bottom: 8px; }}
  .box p {{ font-size: 14px; color: #6b7280; }}
</style>
</head>
<body>
<div class="box">
  <h1>This rating link is no longer valid</h1>
  <p>It may have already been submitted or expired.</p>
</div>
</body>
</html>"""

    @staticmethod
    def render_done_page() -> str:
        """Render a thank-you message when nothing is left to rate."""
        return """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thank You</title>
<style>
  body {{ font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; background: #f0faf3; color: #1f2937; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }}
  .box {{ background: #fff; border-radius: 12px; padding: 32px 24px; text-align: center; max-width: 340px; box-shadow: 0 1px 6px rgba(0,0,0,.08); }}
  .box h1 {{ font-size: 18px; margin-bottom: 8px; color: #2b7a3e; }}
  .box p {{ font-size: 14px; color: #6b7280; }}
</style>
</head>
<body>
<div class="box">
  <h1>Thank you!</h1>
  <p>You have already rated everything for this order. Your feedback helps other shoppers.</p>
</div>
</body>
</html>"""

    @staticmethod
    async def _delivery_partner_info(order: Dict[str, Any]) -> Optional[Dict[str, str]]:
        """Return the assigned delivery partner's id + display name, if any."""
        partner_id = order.get("deliveryPartnerId")
        if not partner_id:
            return None
        partner_id_str = str(partner_id)
        name = "Delivery Partner"
        try:
            profile = await delivery_repository.get_by_id(partner_id_str)
            if profile:
                user = await user_repository.get_by_id(str(profile.get("userId")))
                if user:
                    name = f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or name
        except Exception as e:
            logger.error(f"Error loading delivery partner info for {partner_id_str}: {e}")
        return {"id": partner_id_str, "name": name}

    @staticmethod
    def _order_product_ids(order: Dict[str, Any]) -> List[str]:
        seen = set()
        result = []
        for item in order.get("items", []):
            pid = item.get("productId")
            if pid:
                pid_str = str(pid)
                if pid_str not in seen:
                    seen.add(pid_str)
                    result.append(pid_str)
        return result


sms_rating_service = SMSRatingService()
