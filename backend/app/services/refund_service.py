from typing import Optional, Dict, Any, List, Tuple
from bson import ObjectId
from datetime import datetime
from app.repositories.refund_repository import refund_repository
from app.repositories.order_repository import order_repository
from app.repositories.payment_repository import payment_repository
from app.schemas.refund import (
    RefundStatus, RefundType, RefundReason, RefundResolution,
    RefundRequestCreate, AffectedItemRequest,
)
from app.schemas.order import OrderStatus, PaymentStatus
from app.services.payment_service import PaymentService
from app.services.notification_service import NotificationService
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cancellation / refund policy
#
# These rules map an order's current state to what the customer is entitled to.
# The policy is intentionally explicit and server-side; the frontend may display
# it but never decides it. Overridable via .env for each deployment.
# ---------------------------------------------------------------------------

# Order statuses at which a customer may cancel directly (auto-eligible refund).
AUTO_CANCEL_STATUSES = {
    OrderStatus.PENDING.value,
    OrderStatus.CONFIRMED.value,
    OrderStatus.PROCESSING.value,
    OrderStatus.READY_FOR_PICKUP.value,
}

# Statuses where cancellation requires manual support review (refund request).
REVIEW_CANCEL_STATUSES = {
    OrderStatus.READY_FOR_DELIVERY.value,
    OrderStatus.DISPATCHED.value,
    OrderStatus.IN_TRANSIT.value,
}

# Statuses where a delivered/fulfilled order can only be handled through a
# "Report a Problem" refund/return request, never a plain cancellation.
PROBLEM_REFUND_STATUSES = {
    OrderStatus.DELIVERED.value,
    OrderStatus.PICKED_UP.value,
}

# Non-refundable once the order is ready/out for delivery (used by the calc).
NON_REFUNDABLE_STATUSES = {
    OrderStatus.READY_FOR_DELIVERY.value,
    OrderStatus.DISPATCHED.value,
    OrderStatus.IN_TRANSIT.value,
}


class RefundNotEligibleError(Exception):
    pass


class RefundNotFoundError(Exception):
    pass


class RefundAlreadyProcessedError(Exception):
    pass


class RefundService:
    """Authoritative refund engine.

    The customer can *request* an amount, but every refund amount is computed
    here from the order line items, the discount allocation, the payment method
    and the published policy. The frontend never decides a refund value.
    """

    # ------------------------------------------------------------------
    # Eligibility
    # ------------------------------------------------------------------
    @staticmethod
    async def eligibility_for_order(order: Dict[str, Any], refund_type: str) -> Dict[str, Any]:
        """Return the eligibility decision for an order given a refund type."""
        order_status = order.get("orderStatus")
        is_bulk = bool(order.get("isBulkOrder"))

        # Delivered / picked-up orders -> refund/return request only.
        if order_status in PROBLEM_REFUND_STATUSES:
            if refund_type in (
                RefundType.CANCELLATION.value,
                RefundType.FULL.value,
                RefundType.BULK.value,
            ):
                # Cancellation of a delivered order is not allowed; the customer
                # must use the problem-reporting path.
                return {
                    "eligible": False,
                    "autoApprove": False,
                    "requiresReview": True,
                    "reason": "Order is already fulfilled. Use 'Report a Problem' for a refund or replacement request.",
                    "status": RefundStatus.UNDER_REVIEW.value,
                }
            return {
                "eligible": True,
                "autoApprove": False,
                "requiresReview": True,
                "reason": "Post-delivery refund requests are reviewed by support.",
                "status": RefundStatus.UNDER_REVIEW.value,
            }

        # Delivery failure: the order never reached the customer, so the refund
        # is auto-approved for fulfilment statuses and the order is cancelled.
        if refund_type == RefundType.DELIVERY_FAILED.value:
            if order_status in (
                OrderStatus.READY_FOR_DELIVERY.value,
                OrderStatus.DISPATCHED.value,
                OrderStatus.IN_TRANSIT.value,
            ):
                return {
                    "eligible": True,
                    "autoApprove": True,
                    "requiresReview": False,
                    "reason": "Delivery failed - full refund is auto-approved.",
                    "status": RefundStatus.APPROVED.value,
                }
            return {
                "eligible": False,
                "autoApprove": False,
                "requiresReview": False,
                "reason": "Order is not in a state where a delivery failure refund applies.",
                "status": None,
            }

        # Cancellation path.
        if refund_type in (
            RefundType.CANCELLATION.value,
            RefundType.FULL.value,
            RefundType.BULK.value,
        ):
            if order_status in AUTO_CANCEL_STATUSES:
                # Bulk / event orders always go through seller review even in
                # early states: the farmer may have already sourced produce.
                if is_bulk and refund_type == RefundType.BULK.value:
                    return {
                        "eligible": True,
                        "autoApprove": False,
                        "requiresReview": True,
                        "reason": "Bulk orders require seller review before refund.",
                        "status": RefundStatus.UNDER_REVIEW.value,
                    }
                return {
                    "eligible": True,
                    "autoApprove": True,
                    "requiresReview": False,
                    "reason": "Order is in a cancellable state; refund is auto-approved.",
                    "status": RefundStatus.APPROVED.value,
                }
            if order_status in REVIEW_CANCEL_STATUSES:
                return {
                    "eligible": True,
                    "autoApprove": False,
                    "requiresReview": True,
                    "reason": "Order is out for delivery; cancellation requires support review.",
                    "status": RefundStatus.UNDER_REVIEW.value,
                }
            if order_status == OrderStatus.CANCELLED.value:
                return {
                    "eligible": False,
                    "autoApprove": False,
                    "requiresReview": False,
                    "reason": "Order is already cancelled.",
                    "status": None,
                }
            return {
                "eligible": False,
                "autoApprove": False,
                "requiresReview": False,
                "reason": "Order cannot be cancelled at this stage.",
                "status": None,
            }

        # Problem-reporting path (damaged / missing / wrong / quality / etc).
        if order_status in PROBLEM_REFUND_STATUSES:
            return {
                "eligible": True,
                "autoApprove": False,
                "requiresReview": True,
                "reason": "Refund requests after delivery are reviewed by support.",
                "status": RefundStatus.UNDER_REVIEW.value,
            }

        # Not delivered but reporting a problem on it.
        return {
            "eligible": True,
            "autoApprove": False,
            "requiresReview": True,
            "reason": "Request received and pending review.",
            "status": RefundStatus.UNDER_REVIEW.value,
        }

    # ------------------------------------------------------------------
    # Calculation engine
    # ------------------------------------------------------------------
    @staticmethod
    async def calculate_refund(
        order: Dict[str, Any],
        refund_type: str,
        affected_items: List[Dict[str, Any]],
        resolution: str,
        requested_amount: Optional[float],
    ) -> Dict[str, Any]:
        """Compute the eligible refund amount.

        Formula:
            eligible product amount (per affected line)
            - allocated discount for those lines
            + eligible delivery refund
            - non-refundable fees
            = refund amount

        Returns the breakdown so the UI can show *why* the customer gets the
        amount they do.
        """
        subtotal = round(float(order.get("subtotal") or 0), 2)
        discount = round(float(order.get("discount") or 0), 2)
        delivery_charge = round(float(order.get("deliveryCharge") or 0), 2)
        platform_fee = round(float(order.get("platformFee") or 0), 2)
        total_amount = round(float(order.get("totalAmount") or 0), 2)
        order_status = order.get("orderStatus")
        items = order.get("items") or []

        # ---- Build lookup of order lines.
        line_map = {}
        for item in items:
            pid = str(item.get("productId"))
            variant_id = str(item.get("variantId")) if item.get("variantId") is not None else None
            key = (pid, variant_id)
            line_map[key] = item
            # Keep a product-only fallback for legacy orders without variants.
            if variant_id is None:
                line_map[(pid, None)] = item

        # ---- 1. Eligible product amount.
        product_refund = 0.0
        resolved_items: List[Dict[str, Any]] = []

        if affected_items:
            for ai in affected_items:
                pid = str(ai.get("productId"))
                variant_id = str(ai.get("variantId")) if ai.get("variantId") is not None else None
                qty = int(ai.get("quantity") or 0)
                line = line_map.get((pid, variant_id)) or line_map.get((pid, None))
                if not line or qty <= 0:
                    continue
                unit_price = round(float(line.get("unitPrice") or line.get("originalUnitPrice") or 0), 2)
                line_qty = int(line.get("quantity") or 0)
                if qty > line_qty:
                    qty = line_qty
                line_refund = round(unit_price * qty, 2)
                product_refund = round(product_refund + line_refund, 2)
                resolved_items.append({
                    "productId": pid,
                    "variantId": line.get("variantId"),
                    "productName": line.get("productName", "Product"),
                    "quantity": qty,
                    "unitPrice": unit_price,
                    "requestedAmount": round(line_refund, 2),
                    "approvedAmount": round(line_refund, 2),
                })
        else:
            # Full-order refund (cancellation) - all lines eligible.
            for line in items:
                pid = str(line.get("productId"))
                unit_price = round(float(line.get("unitPrice") or line.get("originalUnitPrice") or 0), 2)
                qty = int(line.get("quantity") or 0)
                line_refund = round(unit_price * qty, 2)
                product_refund = round(product_refund + line_refund, 2)
                resolved_items.append({
                    "productId": pid,
                    "productName": line.get("productName", "Product"),
                    "quantity": qty,
                    "unitPrice": unit_price,
                    "requestedAmount": round(line_refund, 2),
                    "approvedAmount": round(line_refund, 2),
                })

        # ---- 2. Allocate the coupon/order discount proportionally.
        allocated_discount = 0.0
        if discount > 0 and subtotal > 0:
            allocated_discount = round(product_refund * (discount / subtotal), 2)
        product_refund = round(product_refund - allocated_discount, 2)

        # ---- 3. Delivery refund.
        delivery_refund = 0.0
        if delivery_charge > 0:
            if order_status in NON_REFUNDABLE_STATUSES:
                if refund_type == RefundType.DELIVERY_FAILED.value:
                    # Delivery never happened - the customer did not consume the
                    # service, so the delivery fee is returned too.
                    delivery_refund = delivery_charge
                else:
                    # Order already prepared/dispatched - delivery fee not returned.
                    delivery_refund = 0.0
            elif affected_items:
                # Partial problem: delivery fee is kept for partial refunds.
                delivery_refund = 0.0
            else:
                # Full early cancellation - delivery fee returned.
                delivery_refund = delivery_charge

        # ---- 4. Platform fee.
        # The platform fee is part of the amount the customer actually paid
        # (order.totalAmount = subtotal + delivery + platform fee - discount),
        # so it is returned on full refunds/cancellations. It is kept for
        # partial product-level problem refunds, where the fulfilment service
        # was still consumed.
        platform_refund = 0.0
        if not affected_items:
            platform_refund = platform_fee

        # ---- 5. Final amount.
        refund_amount = round(max(product_refund + delivery_refund + platform_refund, 0.0), 2)

        # Partial problem resolution: refund cannot exceed the paid amount.
        refund_amount = round(min(refund_amount, total_amount), 2)

        # The customer's *requested* amount is never trusted blindly - it is
        # used as a cap only when it is *less* than the computed entitlement.
        if requested_amount is not None and 0 < requested_amount < refund_amount:
            refund_amount = round(float(requested_amount), 2)

        return {
            "requestedAmount": round(float(requested_amount) if requested_amount is not None else 0, 2),
            "approvedAmount": refund_amount,
            "eligibleProductAmount": round(product_refund + allocated_discount, 2),
            "allocatedDiscount": allocated_discount,
            "deliveryRefund": delivery_refund,
            "platformRefund": platform_refund,
            "nonRefundableFees": 0.0,
            "totalAmount": total_amount,
            "affectedItems": resolved_items,
        }

    # ------------------------------------------------------------------
    # Eligibility preview (used by the UI to decide which buttons to show)
    # ------------------------------------------------------------------
    @staticmethod
    async def get_eligibility(
        order: Dict[str, Any],
        refund_type: str = RefundType.CANCELLATION.value,
        affected_items: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Return the eligibility decision plus an estimated refund.

        This is a read-only preview for the customer UI. It never creates or
        mutates anything and it never trusts a client-supplied amount; the
        estimate is always computed by the authoritative calculation engine.
        """
        decision = await RefundService.eligibility_for_order(order, refund_type)

        if not decision.get("eligible"):
            return {
                **decision,
                "refundType": refund_type,
                "estimatedRefund": 0.0,
                "breakdown": None,
            }

        resolution = "full_refund"
        if affected_items:
            resolution = "partial_refund"
        elif order.get("isBulkOrder") and refund_type == RefundType.BULK.value:
            resolution = "full_refund"

        calculation = await RefundService.calculate_refund(
            order,
            refund_type,
            affected_items or [],
            resolution,
            None,
        )

        return {
            **decision,
            "refundType": refund_type,
            "estimatedRefund": calculation["approvedAmount"],
            "breakdown": calculation,
        }

    # ------------------------------------------------------------------
    # Request creation
    # ------------------------------------------------------------------
    @staticmethod
    async def create_refund_request(
        customer_id: str,
        order_id: str,
        data: RefundRequestCreate,
        order: Optional[Dict[str, Any]] = None,
        actor_role: str = "customer",
    ) -> Dict[str, Any]:
        """Create a refund request for an order (customer-facing).

        ``actor_role`` is "customer" normally. Admin/support/delivery-initiated
        refunds (e.g. delivery failure) may pass their role to bypass the
        customer-ownership check.
        """
        if order is None:
            order = await order_repository.get_by_id(order_id)
        if not order:
            raise RefundNotFoundError("Order not found")
        if actor_role == "customer" and str(order.get("customerId")) != customer_id:
            raise RefundNotEligibleError("You do not own this order")

        # One active refund per order to prevent duplicate requests stacking.
        existing = await refund_repository.get_by_order_id(order_id)
        active = [r for r in existing if r.get("status") not in (
            RefundStatus.REFUNDED.value,
            RefundStatus.REJECTED.value,
        )]
        if active:
            raise RefundAlreadyProcessedError(
                "An active refund request already exists for this order"
            )

        refund_type = data.refundType.value
        resolution = data.resolution.value

        # Replacement fulfilment is not yet backed by a replacement-order
        # workflow. Never let a replacement request silently become a cash
        # refund; keep the contract explicit until that workflow exists.
        if resolution == RefundResolution.REPLACEMENT.value:
            raise RefundNotEligibleError(
                "Replacement resolution is not currently supported. Please request a refund."
            )

        # Determine eligibility + intended starting status.
        eligibility = await RefundService.eligibility_for_order(order, refund_type)
        if not eligibility.get("eligible"):
            raise RefundNotEligibleError(eligibility.get("reason", "Not eligible for a refund"))

        # Resolve affected items into a dict-list for the calculator.
        affected_items = []
        for ai in data.affectedItems or []:
            affected_items.append({
                "productId": ai.productId,
                "variantId": getattr(ai, "variantId", None),
                "quantity": ai.quantity,
                "requestedAmount": ai.requestedAmount or 0,
            })

        calculation = await RefundService.calculate_refund(
            order,
            refund_type,
            affected_items,
            resolution,
            data.requestedAmount,
        )

        if affected_items and not calculation.get("affectedItems"):
            raise RefundNotEligibleError(
                "No valid affected order items were found for this refund request."
            )
        if float(calculation.get("approvedAmount") or 0) <= 0:
            raise RefundNotEligibleError("No refundable amount is available for this request.")

        payment = await payment_repository.get_by_order_id(order_id)
        payment_method = (
            payment.get("paymentMethod", order.get("paymentMethod", "cash"))
            if payment
            else order.get("paymentMethod", "cash")
        )
        payment_id = str(payment["_id"]) if payment else None

        status = eligibility.get("status") or RefundStatus.REQUESTED.value

        refund_data = {
            "refundId": refund_repository.generate_refund_number(),
            "orderId": order["_id"],
            "customerId": ObjectId(customer_id),
            "paymentId": ObjectId(payment_id) if payment_id else None,
            "type": refund_type,
            "reason": data.reason.value,
            "resolution": resolution,
            "description": data.description,
            "evidence": data.evidence or [],
            "affectedItems": calculation["affectedItems"],
            "paymentMethod": payment_method,
            "requestedAmount": calculation["requestedAmount"],
            "approvedAmount": calculation["approvedAmount"],
            "status": status,
            "rejectionReason": None,
            "refundTransactionId": None,
            "timeline": [{
                "status": status,
                "note": eligibility.get("reason", "Request received"),
                "actorId": customer_id,
                "actorRole": "customer",
                "timestamp": datetime.utcnow(),
            }],
            "requestedAt": datetime.utcnow(),
            "approvedAt": datetime.utcnow() if status == RefundStatus.APPROVED.value else None,
            "processedAt": None,
            "completedAt": None,
        }

        refund_id = await refund_repository.create_refund(refund_data)
        if not refund_id:
            raise Exception("Failed to persist refund request")

        refund = await refund_repository.get_by_id(refund_id)

        # Notify the customer that the request was received.
        try:
            await NotificationService.send_custom_notification(
                customer_id,
                f"Your refund request {refund.get('refundId', '')} has been received "
                f"(₹{calculation['approvedAmount']:,.2f}).",
                title="Refund Request Received 🔔",
                data={"refundId": refund.get("refundId"), "type": "refund"},
            )
        except Exception as e:
            logger.warning(f"Failed to send refund request notification: {e}")

        # Auto-approved cancellations can be processed immediately.
        if status == RefundStatus.APPROVED.value:
            try:
                await RefundService.process_refund(refund_id, actor_id=customer_id, actor_role="system")
            except Exception as e:
                logger.warning(f"Auto-process refund failed for {refund_id}: {e}")

        return await RefundService.serialize(refund)

    # ------------------------------------------------------------------
    # Approval / rejection
    # ------------------------------------------------------------------
    @staticmethod
    async def approve_refund(refund_id: str, actor_id: str, actor_role: str, note: Optional[str] = None) -> Dict[str, Any]:
        refund = await refund_repository.get_by_id(refund_id)
        if not refund:
            raise RefundNotFoundError("Refund not found")
        if refund.get("status") in (RefundStatus.REFUNDED.value, RefundStatus.REJECTED.value):
            raise RefundAlreadyProcessedError("Refund is already finalized")

        ok = await refund_repository.update_status(
            refund_id,
            RefundStatus.APPROVED.value,
            actor_id=actor_id,
            actor_role=actor_role,
            note=note or "Refund approved",
            extra={"approvedAt": datetime.utcnow()},
        )
        if not ok:
            raise Exception("Failed to approve refund")

        # Cancellation-type refunds that were submitted for review while the
        # order was still being fulfilled (ready_for_delivery / dispatched /
        # in_transit) only cancel the order now, at approval time. Early
        # auto-approved cancellations are already cancelled by the cancel
        # endpoint, so this is a no-op for them.
        try:
            if refund.get("type") in (
                RefundType.CANCELLATION.value,
                RefundType.FULL.value,
                RefundType.BULK.value,
                RefundType.DELIVERY_FAILED.value,
            ):
                order = await order_repository.get_by_id(str(refund.get("orderId")))
                order_status = order.get("orderStatus") if order else None
                if order and order_status != OrderStatus.CANCELLED.value:
                    from app.services.order_service import OrderService
                    from app.schemas.order import OrderStatusUpdate
                    await OrderService.update_order_status(
                        str(order["_id"]),
                        actor_id,
                        "admin",
                        OrderStatusUpdate(
                            status="cancelled",
                            note=f"Order cancelled after refund #{refund.get('refundId')} was approved",
                        ),
                    )
        except Exception as e:
            logger.warning(f"Failed to cancel order on refund approval {refund_id}: {e}")

        try:
            await NotificationService.send_custom_notification(
                str(refund.get("customerId")),
                f"Your refund of ₹{refund.get('approvedAmount', 0):,.2f} has been approved.",
                title="Refund Approved ✅",
                data={"refundId": refund.get("refundId"), "orderId": str(refund.get("orderId")), "type": "refund"},
            )
        except Exception as e:
            logger.warning(f"Failed to notify refund approval: {e}")

        # Approval is a support step, not the payout - the caller invokes
        # process_refund separately (or the approval triggers it directly).
        return await RefundService.process_refund(refund_id, actor_id=actor_id, actor_role=actor_role)

    @staticmethod
    async def reject_refund(refund_id: str, actor_id: str, actor_role: str, reason: str) -> Dict[str, Any]:
        refund = await refund_repository.get_by_id(refund_id)
        if not refund:
            raise RefundNotFoundError("Refund not found")
        if refund.get("status") in (RefundStatus.REFUNDED.value, RefundStatus.REJECTED.value):
            raise RefundAlreadyProcessedError("Refund is already finalized")

        ok = await refund_repository.update_status(
            refund_id,
            RefundStatus.REJECTED.value,
            actor_id=actor_id,
            actor_role=actor_role,
            note=reason,
            extra={"rejectionReason": reason},
        )
        if not ok:
            raise Exception("Failed to reject refund")

        try:
            await NotificationService.send_custom_notification(
                str(refund.get("customerId")),
                f"Your refund request {refund.get('refundId', '')} was rejected. Reason: {reason}",
                title="Refund Rejected ❌",
                data={"refundId": refund.get("refundId"), "orderId": str(refund.get("orderId")), "type": "refund"},
            )
        except Exception as e:
            logger.warning(f"Failed to notify refund rejection: {e}")

        return await RefundService.serialize(
            await refund_repository.get_by_id(refund_id)
        )

    # ------------------------------------------------------------------
    # Payment processing (gateway / wallet / COD)
    # ------------------------------------------------------------------
    @staticmethod
    async def process_refund(refund_id: str, actor_id: str, actor_role: str) -> Dict[str, Any]:
        """Execute the payout for an approved refund.

        - ONLINE (card/upi/netbanking/razorpay) → gateway refund via PaymentService.
        - WALLET → credit the customer's wallet.
        - CASH (COD/pickup cash) → create a payable; credited to a verified
          payout method (currently falls back to wallet credit which the
          customer owns).
        """
        refund = await refund_repository.get_by_id(refund_id)
        if not refund:
            raise RefundNotFoundError("Refund not found")
        if refund.get("status") == RefundStatus.REFUNDED.value:
            return await RefundService.serialize(refund)
        if refund.get("status") == RefundStatus.REFUND_PROCESSING.value:
            # A retry may arrive after the payout provider succeeded but before
            # our final status write. Do not start another provider refund.
            existing_tx = refund.get("refundTransactionId")
            if existing_tx:
                return await RefundService.serialize(refund)
        if refund.get("status") != RefundStatus.APPROVED.value:
            raise RefundNotEligibleError("Only approved refunds can be processed")

        amount = round(float(refund.get("approvedAmount") or 0), 2)
        if amount <= 0:
            raise RefundNotEligibleError("Refund amount is zero; nothing to process")

        order_id = str(refund.get("orderId"))
        payment_method = (refund.get("paymentMethod") or "cash").lower()
        customer_id = str(refund.get("customerId"))

        claimed = await refund_repository.claim_for_processing(
            refund_id,
            actor_id=actor_id,
            actor_role=actor_role,
        )
        if not claimed:
            # Another worker/request already claimed this refund. Re-read it so
            # a retry cannot initiate a second provider payout.
            latest = await refund_repository.get_by_id(refund_id)
            if latest and latest.get("status") == RefundStatus.REFUNDED.value:
                return await RefundService.serialize(latest)
            raise RefundNotEligibleError("Refund is already being processed")

        provider_refund_id = await PaymentService.process_refund(order_id, amount=amount)

        if not provider_refund_id:
            # Simulated / debug gateway failures shouldn't leave the customer
            # stuck forever; mark for retry rather than finalising.
            await refund_repository.update_status(
                refund_id,
                RefundStatus.APPROVED.value,
                actor_id=actor_id,
                actor_role=actor_role,
                note="Refund payout failed, scheduled for retry",
            )
            raise RefundNotEligibleError("Refund processing failed at the payment provider")

        await refund_repository.update_status(
            refund_id,
            RefundStatus.REFUNDED.value,
            actor_id=actor_id,
            actor_role=actor_role,
            note="Refund completed",
            extra={
                "completedAt": datetime.utcnow(),
                "processedAt": datetime.utcnow(),
                "refundTransactionId": provider_refund_id,
            },
        )

        # Record the financial adjustment for farmer settlement + platform
        # commission so the ledger reflects the reversal.
        await RefundService._record_settlement_reversal(refund)

        # Notify the farmer that the order they supplied was refunded and their
        # pending settlement was reversed.
        try:
            order_for_farmer = await order_repository.get_by_id(order_id)
            farmer_id = str(order_for_farmer.get("farmerId")) if order_for_farmer and order_for_farmer.get("farmerId") else None
            if farmer_id:
                order_number = order_for_farmer.get("orderNumber") or str(order_for_farmer.get("_id", ""))
                await NotificationService.send_custom_notification(
                    farmer_id,
                    f"Order {order_number} was refunded (₹{amount:,.2f}). "
                    f"Your settlement for this order has been reversed.",
                    title="Order Refunded",
                    data={"refundId": refund.get("refundId"), "orderId": order_id, "type": "refund"},
                )
        except Exception as e:
            logger.warning(f"Failed to notify farmer of refund {refund_id}: {e}")

        try:
            await NotificationService.send_refund_confirmation(customer_id, order_id, amount)
        except Exception as e:
            logger.warning(f"Failed to send refund confirmation: {e}")

        return await RefundService.serialize(await refund_repository.get_by_id(refund_id))

    @staticmethod
    async def _record_settlement_reversal(refund: Dict[str, Any]) -> None:
        """Reverse farmer settlement / platform commission in the ledger.

        When a paid order is refunded the platform records reversal entries for
        the farmer settlement and platform commission it recognised at payment
        time. The provider remains the system of record; the ledger is the
        platform's reconciliation trail.
        """
        from app.services.ledger_service import ledger_service
        order_id = str(refund.get("orderId"))
        payment_id = str(refund.get("paymentId")) if refund.get("paymentId") else None
        amount = round(float(refund.get("approvedAmount") or 0), 2)

        order = await order_repository.get_by_id(order_id)
        if not order:
            return

        # Reverse only the portion of settlement represented by this refund.
        # A partial product refund must not debit the farmer for the entire
        # order value or reverse the entire platform commission.
        farmer_id = str(order.get("farmerId")) if order.get("farmerId") else None
        total_amount = round(float(order.get("totalAmount") or 0), 2)
        ratio = min(max(amount / total_amount, 0.0), 1.0) if total_amount > 0 else 0.0
        commission = round(
            float(order.get("platformCommission") or order.get("platformFee") or 0) * ratio,
            2,
        )
        farmer_settlement = round(max(amount - commission, 0.0), 2)

        if farmer_id and farmer_settlement > 0:
            await ledger_service.record(
                amount=farmer_settlement,
                direction="debit",
                entry_type="refund",
                user_id=farmer_id,
                order_id=order_id,
                payment_id=payment_id,
                reference=f"refund:{refund.get('refundId')}",
                metadata={
                    "kind": "farmer_settlement_reversal",
                    "refundId": refund.get("refundId"),
                    "proportional": True,
                },
            )
        if commission > 0:
            await ledger_service.record(
                amount=commission,
                direction="credit",
                entry_type="platform_commission",
                order_id=order_id,
                payment_id=payment_id,
                reference=f"refund:{refund.get('refundId')}",
                metadata={
                    "kind": "platform_commission_reversal",
                    "refundId": refund.get("refundId"),
                    "proportional": True,
                },
            )

    # ------------------------------------------------------------------
    # Serialization / helpers
    # ------------------------------------------------------------------
    @staticmethod
    async def serialize(refund: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not refund:
            return None
        data = dict(refund)
        data["id"] = str(data["_id"])
        for key in ("orderId", "customerId", "paymentId"):
            if data.get(key) is not None:
                data[key] = str(data[key])
        for item in data.get("affectedItems", []):
            if item.get("productId"):
                item["productId"] = str(item["productId"])
        # Attach order number for display.
        try:
            order = await order_repository.get_by_id(str(data["orderId"]))
            if order:
                data["orderNumber"] = order.get("orderNumber", "")
        except Exception:
            pass
        data.pop("_id", None)
        return data

    @staticmethod
    async def get_refund(refund_id: str, user_id: str, role: str) -> Optional[Dict[str, Any]]:
        refund = await refund_repository.get_by_id(refund_id)
        if not refund:
            return None
        if role == "customer" and str(refund.get("customerId")) != user_id:
            return None
        if role in ("farmer", "delivery"):
            # Only the customer and admin/support may view refund internals.
            return None
        return await RefundService.serialize(refund)

    @staticmethod
    async def get_refunds_for_user(user_id: str, role: str, page: int = 1, limit: int = 20) -> Dict[str, Any]:
        skip = (page - 1) * limit
        if role == "customer":
            refunds = await refund_repository.get_by_customer(user_id, skip, limit)
            total = await refund_repository.count_filtered(customer_id=user_id)
        elif role == "admin":
            refunds = await refund_repository.get_all(skip, limit)
            total = await refund_repository.count_filtered()
        else:
            return {"refunds": [], "total": 0}

        result = []
        for r in refunds:
            serialized = await RefundService.serialize(r)
            if serialized:
                result.append(serialized)

        return {
            "refunds": result,
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": (total + limit - 1) // limit if total else 0,
        }


refund_service = RefundService()