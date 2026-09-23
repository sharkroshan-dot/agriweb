from typing import Optional, Dict, Any, List
from bson import ObjectId
from datetime import datetime, timedelta
import json
import stripe
import razorpay
from app.core.config import settings
from app.repositories.payment_repository import payment_repository
from app.repositories.wallet_repository import wallet_repository, wallet_transaction_repository
from app.repositories.order_repository import order_repository
from app.repositories.withdrawal_repository import withdrawal_repository
from app.repositories.user_repository import user_repository
from app.schemas.payment import (
    PaymentIntentCreate, PaymentConfirm, RefundRequest,
    WalletAddFunds, WalletWithdraw, PaymentStatus
)
from app.schemas.order import DeliveryType
from app.services.notification_service import NotificationService
import logging

logger = logging.getLogger(__name__)

# Initialize payment gateways
stripe.api_key = settings.STRIPE_SECRET_KEY
razorpay_client = razorpay.Client(
    auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)
)

class PaymentService:
    """Payment service with business logic."""
    
    @staticmethod
    async def create_payment_intent(
        order_id: str,
        amount: float,
        payment_method: str
    ) -> Dict[str, Any]:
        """Create a payment intent."""
        # Get order
        order = await order_repository.get_by_id(order_id)
        if not order:
            return {"error": "Order not found"}
        
        # Get customer
        from app.services.user_service import UserService
        customer = await UserService.get_user_by_id(str(order["customerId"]))
        if not customer:
            return {"error": "Customer not found"}
        
        # Create payment record
        payment_data = {
            "orderId": ObjectId(order_id),
            "userId": order["customerId"],
            "amount": amount,
            "currency": "INR",
            "paymentMethod": payment_method,
            "status": PaymentStatus.PENDING
        }
        payment_id = await payment_repository.create_payment(payment_data)
        
        # Create payment intent based on method.
        # Card, UPI, netbanking and wallets are all collected by the Razorpay
        # Checkout, so every online method resolves to a Razorpay order.
        if payment_method in ["card", "upi", "netbanking", "razorpay"]:
            # In development mode without Razorpay keys, simulate the order.
            if settings.DEBUG and not (settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET):
                return await PaymentService._simulate_intent(
                    payment_id, amount, f"Order {order.get('orderNumber', '')}", customer
                )
            # Use Razorpay
            try:
                razorpay_order = razorpay_client.order.create({
                    "amount": int(amount * 100),  # paise
                    "currency": "INR",
                    "receipt": f"receipt_{payment_id}",
                    "notes": {
                        "order_id": order_id,
                        "payment_id": payment_id
                    }
                })

                # Update payment with gateway info
                await payment_repository.update_transaction_id(
                    payment_id,
                    razorpay_order["id"]
                )

                return {
                    "payment_id": payment_id,
                    "key_id": settings.RAZORPAY_KEY_ID,
                    "order_id": razorpay_order["id"],
                    "amount": razorpay_order["amount"],
                    "currency": razorpay_order["currency"],
                    "name": settings.PROJECT_NAME,
                    "description": f"Order {order.get('orderNumber', '')}",
                    "prefill": {
                        "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip() or "Customer",
                        "email": customer.get("email") or "",
                        "contact": customer.get("phone") or ""
                    },
                    "theme": {"color": "#059669"}
                }
            except Exception as e:
                # In development mode a misconfigured or invalid Razorpay key
                # (e.g. "Authentication failed") must not block checkout. Fall
                # back to a simulated order so the flow can still be tested.
                if settings.DEBUG:
                    logger.warning(
                        "Razorpay order creation failed (%s); using simulated order", str(e)
                    )
                    return await PaymentService._simulate_intent(
                        payment_id, amount, f"Order {order.get('orderNumber', '')}", customer
                    )
                logger.error(f"Razorpay payment intent error: {str(e)}")
                return {"error": str(e)}

        elif payment_method == "wallet":
            # Use wallet
            wallet = await wallet_repository.get_by_user_id(str(order["customerId"]))
            if not wallet:
                return {"error": "Wallet not found"}

            if wallet.get("balance", 0) < amount:
                return {"error": "Insufficient wallet balance"}

            # Deduct from wallet
            success = await PaymentService.process_wallet_payment(
                str(order["customerId"]),
                order_id,
                amount,
                f"Payment for order {order.get('orderNumber', '')}"
            )

            if success:
                # Mark payment as successful
                await payment_repository.update_payment_status(
                    payment_id,
                    PaymentStatus.SUCCESS
                )

                return {
                    "payment_id": payment_id,
                    "status": "success",
                    "message": "Payment processed from wallet"
                }
            else:
                return {"error": "Wallet payment failed"}

        elif payment_method == "cash":
            # Cash on delivery: no money is collected now. The delivery partner
            # collects the cash at the doorstep; the farmer is paid after the
            # order is delivered (see process_delivery_payment).
            await payment_repository.update_payment_status(
                payment_id,
                PaymentStatus.PENDING
            )

            return {
                "payment_id": payment_id,
                "status": "pending",
                "message": "Cash on delivery selected",
                "payment_method": "cash",
                "type": "cash_on_delivery"
            }

        return {"error": "Invalid payment method"}
    
    @staticmethod
    async def _simulate_intent(
        payment_id: str,
        amount: float,
        description: str,
        customer: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Return a simulated Razorpay order for development mode.

        Used when no Razorpay keys are configured or the gateway rejects them
        (e.g. "Authentication failed" from an invalid test key), so the
        checkout / wallet top-up flow can still be exercised end-to-end without
        a live account. The front end sees ``simulated: True`` and confirms the
        payment locally instead of opening the real Checkout.
        """
        simulated_order_id = f"order_sim_{payment_id}"
        await payment_repository.update_transaction_id(payment_id, simulated_order_id)
        prefill = {}
        if customer:
            prefill = {
                "name": f"{customer.get('firstName', '')} {customer.get('lastName', '')}".strip() or "Customer",
                "email": customer.get("email") or "",
                "contact": customer.get("phone") or "",
            }
        return {
            "payment_id": payment_id,
            "key_id": "rzp_test_xxxxxxxx",
            "order_id": simulated_order_id,
            "amount": int(amount * 100),
            "currency": "INR",
            "name": settings.PROJECT_NAME,
            "description": description,
            "prefill": prefill,
            "theme": {"color": "#059669"},
            "simulated": True,
        }
    
    @staticmethod
    async def _finalize_successful_payment(payment: Dict[str, Any], gateway_response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Mark a payment as successful, update the order, split revenue and notify."""
        from app.services.ledger_service import ledger_service

        payment_id = str(payment["_id"])
        success = await payment_repository.update_payment_status(
            payment_id,
            PaymentStatus.SUCCESS,
            gateway_response
        )
        if not success:
            return None

        # Update order payment status
        if payment.get("orderId"):
            await order_repository.update(
                {"_id": payment["orderId"]},
                {"paymentStatus": "paid", "orderStatus": "confirmed"}
            )

        # Financial ledger: customer payment received.
        await ledger_service.record(
            amount=payment.get("amount", 0),
            direction="credit",
            entry_type="payment_received",
            user_id=str(payment["userId"]) if payment.get("userId") else None,
            order_id=str(payment["orderId"]) if payment.get("orderId") else None,
            payment_id=payment_id,
            reference=payment.get("transactionId"),
            metadata={"gateway": gateway_response},
        )

        # Create payment split
        await PaymentService.create_payment_splits(payment_id)

        # Send notification
        if payment.get("userId") and payment.get("orderId"):
            await NotificationService.send_payment_success(
                str(payment["userId"]),
                str(payment["orderId"])
            )

        # Get updated payment
        return await payment_repository.get_by_id(payment_id)

    @staticmethod
    async def verify_razorpay_payment(
        payment_id: str,
        razorpay_order_id: str,
        razorpay_payment_id: str,
        razorpay_signature: str
    ) -> Optional[Dict[str, Any]]:
        """Verify the Razorpay payment signature and confirm the payment."""
        payment = await payment_repository.get_by_id(payment_id)
        if not payment:
            return None

        # Simulated orders in development mode are accepted without a signature.
        if settings.DEBUG and razorpay_order_id.startswith("order_sim_"):
            return await PaymentService._finalize_successful_payment(
                payment,
                {
                    "razorpay_order_id": razorpay_order_id,
                    "razorpay_payment_id": razorpay_payment_id,
                    "razorpay_signature": razorpay_signature,
                    "simulated": True
                }
            )

        # Verify the signature server-side using the Razorpay SDK.
        try:
            razorpay_client.utility.verify_payment_signature({
                "razorpay_order_id": razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_signature": razorpay_signature
            })
        except Exception as e:
            logger.error(f"Razorpay signature verification failed: {str(e)}")
            return None

        return await PaymentService._finalize_successful_payment(
            payment,
            {
                "razorpay_order_id": razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_signature": razorpay_signature
            }
        )

    @staticmethod
    async def confirm_payment(
        payment_intent_id: str,
        gateway_response: Dict[str, Any],
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Confirm payment.

        Requires server-side gateway verification:
        - Simulated intents are accepted ONLY in DEBUG mode.
        - Stripe intents (``pi_...``) are verified against the Stripe API
          (retrieve + status == succeeded) before the payment is finalized.
        - Razorpay intents must go through ``verify_razorpay_payment`` which
          checks the signature; the plain ``confirm`` path refuses them.
        - When ``user_id`` is supplied the payment must belong to that user.
        """
        # Handle simulated payments - development mode ONLY.
        if payment_intent_id.startswith("pi_simulated_"):
            if not settings.DEBUG:
                logger.warning("Simulated payment confirm blocked in non-debug mode")
                return None
            payment_id = payment_intent_id.replace("pi_simulated_", "")
            payment = await payment_repository.get_by_id(payment_id)
            if not payment:
                return None
            if user_id and str(payment.get("userId")) != str(user_id):
                return None
            return await PaymentService._finalize_successful_payment(payment, gateway_response)

        # Get payment
        payment = await payment_repository.get_by_transaction_id(payment_intent_id)
        if not payment:
            return None
        if user_id and str(payment.get("userId")) != str(user_id):
            return None

        # Stripe: verify the intent really succeeded via the API before trusting it.
        if payment_intent_id.startswith("pi_"):
            if not settings.STRIPE_SECRET_KEY:
                logger.error("STRIPE_SECRET_KEY not configured; cannot verify payment intent")
                return None
            try:
                intent = stripe.PaymentIntent.retrieve(payment_intent_id)
            except Exception as e:
                logger.error(f"Stripe intent retrieve failed: {str(e)}")
                return None
            if not intent or intent.get("status") != "succeeded":
                logger.warning(
                    "Payment intent %s not succeeded (status=%s) - refusing to confirm",
                    payment_intent_id,
                    intent.get("status") if intent else "unknown",
                )
                return None
            gateway_response = {**(gateway_response or {}), "verified_via": "stripe_api"}

        # Razorpay intents must be signature-verified; refuse the plain confirm path.
        if payment_intent_id.startswith("order_") or payment_intent_id.startswith("pay_"):
            logger.warning("Refusing to confirm %s without a valid Razorpay signature", payment_intent_id)
            return None

        return await PaymentService._finalize_successful_payment(payment, gateway_response)
    
    @staticmethod
    async def process_wallet_payment(
        user_id: str,
        order_id: str,
        amount: float,
        description: str
    ) -> bool:
        """Process wallet payment."""
        # Get wallet
        wallet = await wallet_repository.get_by_user_id(user_id)
        if not wallet:
            return False
        
        # Check balance
        if wallet.get("balance", 0) < amount:
            return False
        
        # Deduct from wallet
        success = await wallet_repository.update_balance(
            str(wallet["_id"]),
            amount,
            "debit"
        )
        
        if success:
            # Create transaction record
            transaction_data = {
                "walletId": wallet["_id"],
                "userId": ObjectId(user_id),
                "amount": amount,
                "type": "debit",
                "description": description,
                "referenceId": ObjectId(order_id),
                "referenceType": "order",
                "balanceAfter": wallet.get("balance", 0) - amount
            }
            await wallet_transaction_repository.create_transaction(transaction_data)
            
            return True
        
        return False
    
    @staticmethod
    async def process_refund(order_id: str, amount: Optional[float] = None) -> Optional[str]:
        """Process refund for an order.

        Args:
            order_id: The order to refund.
            amount: Optional refund amount. When provided and less than the full
                paid amount, the payment is marked ``partially_refunded``. When
                omitted, the full paid amount is refunded.

        Returns the provider refund transaction id on success (or ``None`` on
        failure), so callers can persist it on their refund record.

        The payment provider (Razorpay/Stripe) remains the system of record for
        the money movement; this method records the outcome on our payment
        document and the financial ledger.
        """
        # Get payment
        payment = await payment_repository.get_by_order_id(order_id)
        if not payment:
            # No payment document yet — e.g. a COD/pickup order refunded before
            # its cash payment was recorded at delivery. Create the cash payment
            # record so the ledger stays consistent, then fall through to the
            # cash branch which credits the customer's wallet as the payout.
            order = await order_repository.get_by_id(order_id)
            if not order:
                return None
            payment_id = await payment_repository.create_payment({
                "orderId": order["_id"],
                "userId": order.get("customerId"),
                "amount": order.get("totalAmount", 0),
                "currency": "INR",
                "paymentMethod": "cash",
                "status": "success",
                "type": "cash_on_delivery",
            })
            if not payment_id:
                return None
            payment = await payment_repository.get_by_id(payment_id)
            if not payment:
                return None

        # Check if already refunded
        if payment.get("status") == PaymentStatus.REFUNDED:
            return payment.get("refundId")

        paid_amount = round(float(payment.get("amount", 0)), 2)
        refund_amount = round(float(amount) if amount is not None else paid_amount, 2)
        refund_amount = round(min(refund_amount, paid_amount), 2)
        is_partial = refund_amount < paid_amount

        payment_method = payment.get("paymentMethod")
        gateway_transaction_id = payment.get("transactionId")

        await PaymentService._record_refund_ledger(payment, order_id, refund_amount)

        def _new_payment_status():
            return PaymentStatus.PARTIALLY_REFUNDED if is_partial else PaymentStatus.REFUNDED

        def _order_payment_status():
            return "partially_refunded" if is_partial else "refunded"

        # Process refund based on payment method
        if payment_method in ["card", "upi", "netbanking", "razorpay"]:
            # Simulated orders in development mode are refunded without the gateway.
            if settings.DEBUG and (gateway_transaction_id or "").startswith(("order_sim_", "pi_simulated_")):
                simulated_refund_id = f"simulated_refund_{datetime.utcnow().timestamp()}"
                await payment_repository.mark_refunded(
                    str(payment["_id"]),
                    refund_amount,
                    simulated_refund_id,
                    status=_new_payment_status(),
                )
                await order_repository.update(
                    {"_id": ObjectId(order_id)},
                    {"paymentStatus": _order_payment_status()}
                )
                await NotificationService.send_refund_confirmation(
                    str(payment["userId"]),
                    order_id,
                    refund_amount
                )
                return simulated_refund_id

            # Razorpay refund
            try:
                refund = razorpay_client.payment.refund(gateway_transaction_id, {
                    "amount": int(refund_amount * 100),
                    "speed": "normal"
                })

                # Mark as refunded
                await payment_repository.mark_refunded(
                    str(payment["_id"]),
                    refund_amount,
                    refund["id"],
                    status=_new_payment_status(),
                )

                # Update order
                await order_repository.update(
                    {"_id": ObjectId(order_id)},
                    {"paymentStatus": _order_payment_status()}
                )

                # Notify user
                await NotificationService.send_refund_confirmation(
                    str(payment["userId"]),
                    order_id,
                    refund_amount
                )

                return refund["id"]
            except Exception as e:
                logger.error(f"Razorpay refund error: {str(e)}")
                return None

        elif payment_method == "wallet":
            # Refund to wallet
            wallet = await wallet_repository.get_by_user_id(str(payment["userId"]))
            if not wallet:
                return None

            # Add to wallet
            success = await wallet_repository.update_balance(
                str(wallet["_id"]),
                refund_amount,
                "credit"
            )

            if success:
                wallet_refund_id = f"refund_{datetime.utcnow().timestamp()}"
                # Create transaction record
                transaction_data = {
                    "walletId": wallet["_id"],
                    "userId": payment["userId"],
                    "amount": refund_amount,
                    "type": "credit",
                    "description": f"Refund for order {order_id}",
                    "referenceId": ObjectId(order_id),
                    "referenceType": "refund",
                    "balanceAfter": wallet.get("balance", 0) + refund_amount
                }
                await wallet_transaction_repository.create_transaction(transaction_data)

                # Mark as refunded
                await payment_repository.mark_refunded(
                    str(payment["_id"]),
                    refund_amount,
                    wallet_refund_id,
                    status=_new_payment_status(),
                )

                # Update order
                await order_repository.update(
                    {"_id": ObjectId(order_id)},
                    {"paymentStatus": _order_payment_status()}
                )

                # Notify user
                await NotificationService.send_refund_confirmation(
                    str(payment["userId"]),
                    order_id,
                    refund_amount
                )

                return wallet_refund_id

            return None

        elif payment_method == "cash":
            # Cash on delivery - there is no online payment to reverse. The
            # customer paid the delivery partner in cash, so the platform owes
            # them money: credit the customer's wallet (the fallback payout
            # method) and record the payable-style ledger entry. The payment
            # itself is marked refunded so it never pays the farmer.
            if refund_amount > 0:
                wallet_credited = await PaymentService._credit_wallet(
                    str(payment["userId"]),
                    refund_amount,
                    f"Refund for COD order {order_id}",
                    order_id,
                    "refund",
                )
                if not wallet_credited:
                    logger.error(f"Cash refund wallet credit failed for order {order_id}")
                    return None

            cash_refund_id = f"cash_refund_{datetime.utcnow().timestamp()}"
            await payment_repository.mark_refunded(
                str(payment["_id"]),
                refund_amount,
                cash_refund_id,
                status=_new_payment_status(),
            )

            await order_repository.update(
                {"_id": ObjectId(order_id)},
                {"paymentStatus": _order_payment_status()}
            )

            return cash_refund_id

        return None

    @staticmethod
    def _bank_account_hash(bank_account: Any) -> str:
        """Stable hash of a bank account / UPI descriptor for comparisons."""
        import json
        import hashlib
        try:
            payload = json.dumps(bank_account, sort_keys=True, default=str)
        except Exception:
            payload = str(bank_account)
        return hashlib.sha256(payload.encode()).hexdigest()

    @staticmethod
    async def _bank_change_cooldown_blocked(user_id: str, bank_account: Any) -> Optional[str]:
        """Return an error message when the user withdraws to a different bank
        account than the one used in their most recent withdrawal within the
        configured cooldown window, else None."""
        try:
            recent = await withdrawal_repository.get_by_user_id(user_id, limit=5)
        except Exception as e:
            logger.error(f"Cooldown lookup failed: {e}")
            return None

        from datetime import timedelta
        window = getattr(settings, "WITHDRAWAL_BANK_COOLDOWN_HOURS", 48)
        new_hash = PaymentService._bank_account_hash(bank_account)

        for w in recent:
            previous = w.get("bankAccount")
            if not previous:
                continue
            if PaymentService._bank_account_hash(previous) == new_hash:
                break  # same account - no cooldown applies
            created_at = w.get("createdAt")
            if created_at and (datetime.utcnow() - created_at) < timedelta(hours=window):
                return (
                    "Withdrawal blocked: your bank account changed within the last "
                    f"{window} hours. Please wait for the cooldown to end before "
                    "withdrawing to a new account."
                )
        return None

    @staticmethod
    async def _record_refund_ledger(payment: Dict[str, Any], order_id: str, amount: float) -> None:
        """Record a refund entry in the financial ledger."""
        from app.services.ledger_service import ledger_service
        await ledger_service.record(
            amount=amount,
            direction="debit",
            entry_type="refund",
            user_id=str(payment["userId"]) if payment.get("userId") else None,
            order_id=order_id,
            payment_id=str(payment["_id"]) if payment.get("_id") else None,
            reference=payment.get("transactionId"),
        )

    @staticmethod
    async def _credit_wallet(
        user_id: str,
        amount: float,
        description: str,
        reference_id: str,
        reference_type: str
    ) -> bool:
        """Credit a user's wallet and record a transaction (creates wallet if missing)."""
        wallet = await wallet_repository.get_by_user_id(user_id)
        if not wallet:
            wallet_id = await wallet_repository.create_wallet({"userId": ObjectId(user_id)})
            wallet = await wallet_repository.get_by_id(wallet_id)
        if not wallet:
            return False
        ok = await wallet_repository.update_balance(str(wallet["_id"]), amount, "credit")
        if not ok:
            return False
        wallet_after = await wallet_repository.get_by_id(str(wallet["_id"]))
        await wallet_transaction_repository.create_transaction({
            "walletId": wallet["_id"],
            "userId": wallet["userId"],
            "amount": amount,
            "type": "credit",
            "description": description,
            "referenceId": ObjectId(reference_id),
            "referenceType": reference_type,
            "balanceAfter": float(wallet_after.get("balance", 0)) if wallet_after else 0,
        })
        return True

    @staticmethod
    async def _farmer_split_status(split: Dict[str, Any]) -> Optional[str]:
        """Get the payment split status for the farmer party."""
        for s in (split.get("splits") or []):
            if s.get("party") == "farmer":
                return s.get("status")
        return None

    @staticmethod
    async def create_payment_splits(payment_id: str) -> bool:
        """Create payment splits for farmer, delivery, platform and credit the farmer's wallet."""
        payment = await payment_repository.get_by_id(payment_id)
        if not payment:
            return False
        
        order = await order_repository.get_by_id(str(payment["orderId"]))
        if not order:
            return False
        
        amount = payment.get("amount", 0)
        is_cash = (
            payment.get("paymentMethod") == "cash"
            or payment.get("type") == "cash_on_delivery"
        )
        is_pickup = order.get("deliveryType") == DeliveryType.PICKUP.value
        earnings_description = (
            f"Cash on pickup earnings for order {order.get('orderNumber', '')}"
            if is_cash and is_pickup
            else f"Cash on delivery earnings for order {order.get('orderNumber', '')}"
            if is_cash
            else f"Sale earnings for order {order.get('orderNumber', '')}"
        )
        farmer_user_id = str(order.get("farmerId")) if order.get("farmerId") else None

        if is_pickup:
            # Farm pickup. The customer paid only the product value; the platform
            # keeps its commission (order.platformCommission) and the farmer the
            # remainder. No delivery partner is involved.
            commission = round(float(order.get("platformCommission") or 0), 2)
            if commission <= 0:
                commission = round(amount * settings.PICKUP_COMMISSION_RATE, 2)
            farmer_share = round(max(amount - commission, 0), 2)
            delivery_share = 0.0
            platform_share = round(commission, 2)
        else:
            # Home delivery model: farmer/delivery/platform percentages of the
            # amount collected.
            farmer_share = round(amount * settings.COD_FARMER_COMMISSION_RATE, 2)  # % to farmer
            delivery_share = round(amount * settings.COD_PARTNER_COMMISSION_RATE, 2)  # % to delivery
            platform_share = round(amount * (1 - settings.COD_FARMER_COMMISSION_RATE - settings.COD_PARTNER_COMMISSION_RATE), 2)  # remainder to platform

            # Optional delivery-fee split: when the admin has configured
            # partnerDeliveryEarningRate, the partner's earning is derived from
            # the actual delivery fee (rate x deliveryCharge) and the platform
            # keeps the logistics remainder. Opt-in; unchanged by default.
            if order.get("deliveryPartnerId"):
                delivery_charge = float(order.get("deliveryCharge") or 0)
                if delivery_charge > 0:
                    from app.services.delivery_fee_service import get_partner_earning_rate
                    rate = await get_partner_earning_rate()
                    if rate is not None:
                        partner_earning = round(delivery_charge * rate, 2)
                        delivery_share = min(partner_earning, max(amount - farmer_share, 0))
                        platform_share = round(amount - farmer_share - delivery_share, 2)
        
        splits = [
            {
                "party": "farmer",
                "partyId": farmer_user_id,
                "amount": farmer_share,
                "percentage": int(round(farmer_share / amount * 100)) if amount else 0
            }
        ]
        if delivery_share > 0 and order.get("deliveryPartnerId"):
            splits.append({
                "party": "delivery",
                "partyId": str(order.get("deliveryPartnerId")),
                "amount": delivery_share,
                "percentage": int(settings.COD_PARTNER_COMMISSION_RATE * 100)
            })
        splits.append({
            "party": "platform",
            "partyId": None,
            "amount": platform_share,
            "percentage": int(round(platform_share / amount * 100)) if amount else 0
        })
        
        from app.repositories.payment_split_repository import payment_split_repository
        from app.repositories.pickup_commission_repository import pickup_commission_repository

        # Financial ledger: record the derived splits as advisory entries.
        from app.services.ledger_service import ledger_service
        for split in splits:
            party = split.get("party")
            if party == "farmer" and split.get("partyId") and float(split.get("amount") or 0) > 0:
                await ledger_service.record(
                    amount=split["amount"],
                    direction="credit",
                    entry_type="farmer_settlement",
                    user_id=str(split["partyId"]),
                    order_id=str(order["_id"]) if order.get("_id") else None,
                    payment_id=payment_id,
                    reference=f"payment_split:{payment_id}",
                )
            elif party == "delivery" and split.get("partyId") and float(split.get("amount") or 0) > 0:
                await ledger_service.record(
                    amount=split["amount"],
                    direction="credit",
                    entry_type="partner_earning",
                    user_id=str(split["partyId"]),
                    order_id=str(order["_id"]) if order.get("_id") else None,
                    payment_id=payment_id,
                    reference=f"payment_split:{payment_id}",
                )
            elif party == "platform" and float(split.get("amount") or 0) > 0:
                await ledger_service.record(
                    amount=split["amount"],
                    direction="debit",
                    entry_type="platform_commission",
                    order_id=str(order["_id"]) if order.get("_id") else None,
                    payment_id=payment_id,
                    reference=f"payment_split:{payment_id}",
                )

        existing = await payment_split_repository.get_by_payment_id(payment_id)
        if existing:
            # Idempotent: credit only if the farmer's share hasn't been paid out yet.
            if farmer_user_id and farmer_share > 0 and await PaymentService._farmer_split_status(existing) != "paid" and not (is_pickup and is_cash):
                credited = await PaymentService._credit_wallet_with_commission_recovery(
                    farmer_user_id, farmer_share, earnings_description,
                    str(existing["_id"]), "payment_split"
                )
                if credited:
                    await payment_split_repository.update_split_status(str(existing["_id"]), "farmer", "paid")
            # For cash-on-delivery the payment is only now fully received.
            if is_cash:
                await payment_repository.update_payment_status(payment_id, PaymentStatus.SUCCESS)
                if is_pickup:
                    # Cash was handed to the farmer at the farm. Record the
                    # commission the farmer owes the platform (Option A).
                    await PaymentService._record_pickup_commission(existing, order)
                else:
                    await PaymentService._record_cash_settlement(payment, order)
            return True
        
        # Create payment split record
        split_data = {
            "paymentId": ObjectId(payment_id),
            "orderId": order["_id"],
            "splits": splits,
            "status": "pending",
            "createdAt": datetime.utcnow()
        }
        
        split_id = await payment_split_repository.create(split_data)
        if not split_id:
            return False
        
        # Credit the farmer's wallet immediately with their share of the sale.
        # For pickup cash-on-pickup the farmer already holds the cash, so no
        # wallet credit happens — the commission debt is recorded instead.
        if farmer_user_id and farmer_share > 0 and not (is_pickup and is_cash):
            credited = await PaymentService._credit_wallet_with_commission_recovery(
                farmer_user_id, farmer_share, earnings_description,
                split_id, "payment_split"
            )
            if credited:
                await payment_split_repository.update_split_status(split_id, "farmer", "paid")

        # Cash on delivery: finalise the payment and record the cash the
        # delivery partner collected so it is settled back to the platform.
        if is_cash:
            await payment_repository.update_payment_status(payment_id, PaymentStatus.SUCCESS)
            if is_pickup:
                await PaymentService._record_pickup_commission({
                    "_id": ObjectId(split_id),
                    **split_data,
                }, order)
            else:
                await PaymentService._record_cash_settlement(payment, order)
        
        logger.info(f"Payment splits created for payment {payment_id}")
        return True
    
    @staticmethod
    async def _record_cash_settlement(payment: Dict[str, Any], order: Dict[str, Any]) -> None:
        """Record the cash a delivery partner collected on a COD order.

        The delivery partner physically holds the cash collected at the doorstep.
        They keep their delivery fee; the balance (farmer + platform share) must
        be remitted to the platform. Idempotent per order.
        """
        from app.repositories.cash_settlement_repository import cash_settlement_repository
        existing = await cash_settlement_repository.get_by_order_id(str(order["_id"]))
        if existing:
            return

        delivery_user_id = (
            str(order.get("deliveryPartnerId"))
            if order.get("deliveryPartnerId")
            else None
        )
        amount = round(float(payment.get("amount", 0)), 2)
        delivery_fee = round(float(order.get("deliveryCharge", 0) or 0), 2)
        farmer_share = round(amount * settings.COD_FARMER_COMMISSION_RATE, 2)
        platform_share = round(max(amount - farmer_share - delivery_fee, 0), 2)
        amount_to_remit = round(max(amount - delivery_fee, 0), 2)
        due_at = datetime.utcnow() + timedelta(hours=settings.COD_SETTLEMENT_DUE_HOURS)

        await cash_settlement_repository.create({
            "orderId": order["_id"],
            "orderNumber": order.get("orderNumber"),
            "deliveryPartnerId": ObjectId(delivery_user_id) if delivery_user_id else None,
            "amount": amount,
            "deliveryFee": delivery_fee,
            "farmerShare": farmer_share,
            "platformShare": platform_share,
            "amountToRemit": amount_to_remit,
            "status": "pending_remit",
            "cashCollectedAt": datetime.utcnow(),
            "dueAt": due_at,
        })
        logger.info(f"COD cash settlement recorded for order {order.get('orderNumber', '')}")

        from app.services.ledger_service import ledger_service
        await ledger_service.record(
            amount=amount_to_remit,
            direction="debit",
            entry_type="cod_collected",
            user_id=delivery_user_id,
            order_id=str(order["_id"]) if order.get("_id") else None,
            payment_id=str(payment["_id"]) if payment.get("_id") else None,
            reference=f"cod_settlement:{str(order['_id'])}",
            metadata={"deliveryFee": delivery_fee, "farmerShare": farmer_share, "platformShare": platform_share},
        )

    @staticmethod
    async def _record_pickup_commission(
        split: Dict[str, Any],
        order: Dict[str, Any],
    ) -> None:
        """Record the commission a farmer owes for a farm-pickup COD order.

        The customer pays cash directly to the farmer at the farm, so the
        farmer physically holds the full order amount. Instead of the platform
        collecting its share then, the commission (order.platformCommission) is
        tracked as an outstanding debt and recovered from the farmer's next
        online sale settlement (Option A). Idempotent per order.
        """
        from app.repositories.pickup_commission_repository import pickup_commission_repository
        existing = await pickup_commission_repository.get_by_order_id(str(order["_id"]))
        if existing:
            return

        commission = round(float(order.get("platformCommission") or 0), 2)
        if commission <= 0:
            return

        farmer_user_id = str(order.get("farmerId")) if order.get("farmerId") else None
        await pickup_commission_repository.create({
            "orderId": order["_id"],
            "orderNumber": order.get("orderNumber"),
            "farmerId": farmer_user_id,
            "amount": commission,
            "status": "outstanding",
            "sourceSplitId": str(split.get("_id")) if split.get("_id") else None,
        })
        logger.info(
            f"Pickup COD commission recorded for order {order.get('orderNumber', '')} ({commission})"
        )

    @staticmethod
    async def _record_pickup_cod_settlement(order_id: str) -> None:
        """Finalise a cash-on-pickup order's payment and record its commission.

        Called when a pickup order is confirmed ``picked_up``. If no payment
        document exists yet (cash was never collected through the gateway),
        create one so payment splits can be built; then route through
        ``create_payment_splits`` which records the farmer's outstanding
        commission debt (Option A).
        """
        order = await order_repository.get_by_id(order_id)
        if not order:
            return
        try:
            from app.repositories.pickup_commission_repository import pickup_commission_repository
            existing = await pickup_commission_repository.get_by_order_id(order_id)
            if existing:
                return
        except Exception:
            pass
        payment = await payment_repository.get_by_order_id(order_id)
        if payment:
            await PaymentService.create_payment_splits(str(payment.get("_id")))
            return
        cash_payment = {
            "orderId": order["_id"],
            "userId": order.get("customerId"),
            "amount": order.get("totalAmount", 0),
            "currency": "INR",
            "paymentMethod": "cash",
            "status": "success",
            "type": "cash_on_delivery",
        }
        payment_id = await payment_repository.create_payment(cash_payment)
        if not payment_id:
            return
        await PaymentService.create_payment_splits(payment_id)

    @staticmethod
    async def _credit_wallet_with_commission_recovery(
        user_id: str,
        amount: float,
        description: str,
        reference_id: str,
        reference_type: str,
    ) -> bool:
        """Credit a wallet, first recovering any outstanding pickup-COD commissions.

        Under Option A, cash-on-pickup commissions the farmer owes the platform
        are deducted from the farmer's future online sale settlement. This
        credits ``amount`` minus whatever outstanding commissions the farmer
        still owes, and marks those commissions as settled.
        """
        from app.repositories.pickup_commission_repository import pickup_commission_repository
        outstanding = await pickup_commission_repository.get_outstanding_by_farmer(user_id)

        net_amount = amount
        recovered = 0.0
        if outstanding:
            remaining_to_off = amount
            for commission in outstanding:
                if remaining_to_off <= 0:
                    break
                owed = round(float(commission.get("amount", 0)), 2)
                if owed <= 0:
                    continue
                if owed <= remaining_to_off:
                    # Only a fully-covered commission is marked settled so a
                    # partial recovery never disappears from the ledger.
                    remaining_to_off = round(remaining_to_off - owed, 2)
                    recovered = round(recovered + owed, 2)
                    await pickup_commission_repository.mark_settled(
                        str(commission["_id"]),
                        reference_id,
                        note=f"Recovered from {reference_type} {reference_id}",
                    )
            net_amount = round(remaining_to_off, 2)

        if net_amount <= 0:
            return False

        if recovered > 0:
            description = f"{description} (incl. ₹{recovered:,.2f} pickup-commission recovered)"

        return await PaymentService._credit_wallet(
            user_id, net_amount, description, reference_id, reference_type
        )

    @staticmethod
    async def process_delivery_payment(order_id: str) -> bool:
        """Process delivery payment split after successful delivery."""
        order = await order_repository.get_by_id(order_id)
        if not order:
            return False
        
        payment = await payment_repository.get_by_order_id(order_id)
        if payment:
            return await PaymentService.create_payment_splits(str(payment.get("_id")))
        
        # No payment doc yet — maybe the payment was recorded in order history.
        if order.get("paymentId"):
            return await PaymentService.create_payment_splits(str(order.get("paymentId")))
        
        # Cash on delivery: record the cash payment and credit the farmer's wallet.
        cash_payment = {
            "orderId": order["_id"],
            "userId": order.get("customerId"),
            "amount": order.get("totalAmount", 0),
            "currency": "INR",
            "paymentMethod": "cash",
            "status": "success",
            "type": "cash_on_delivery",
        }
        payment_id = await payment_repository.create_payment(cash_payment)
        if not payment_id:
            return False
        return await PaymentService.create_payment_splits(payment_id)
    
    @staticmethod
    async def add_wallet_funds(
        user_id: str,
        data: WalletAddFunds
    ) -> Dict[str, Any]:
        """Add funds to wallet."""
        # Get or create wallet
        wallet = await wallet_repository.get_by_user_id(user_id)
        if not wallet:
            wallet_id = await wallet_repository.create_wallet({
                "userId": ObjectId(user_id)
            })
            wallet = await wallet_repository.get_by_id(wallet_id)
        
        # Create payment intent for wallet top-up
        payment_data = {
            "orderId": None,
            "userId": ObjectId(user_id),
            "amount": data.amount,
            "currency": "INR",
            "paymentMethod": data.paymentMethod,
            "status": PaymentStatus.PENDING,
            "type": "wallet_topup"
        }
        payment_id = await payment_repository.create_payment(payment_data)
        
        # Process payment based on method
        if data.paymentMethod in ["card", "upi", "netbanking", "razorpay"]:
            # Simulated top-up in development mode without Razorpay keys.
            if settings.DEBUG and not (settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET):
                return await PaymentService._simulate_intent(payment_id, data.amount, "Wallet top-up")

            # Create a Razorpay order for the wallet top-up.
            try:
                razorpay_order = razorpay_client.order.create({
                    "amount": int(data.amount * 100),
                    "currency": "INR",
                    "receipt": f"wallet_{payment_id}",
                    "notes": {
                        "wallet_id": str(wallet["_id"]),
                        "user_id": user_id,
                        "type": "wallet_topup"
                    }
                })

                await payment_repository.update_transaction_id(
                    payment_id,
                    razorpay_order["id"]
                )

                return {
                    "payment_id": payment_id,
                    "key_id": settings.RAZORPAY_KEY_ID,
                    "order_id": razorpay_order["id"],
                    "amount": razorpay_order["amount"],
                    "currency": razorpay_order["currency"],
                    "name": settings.PROJECT_NAME,
                    "description": "Wallet top-up",
                    "prefill": {},
                    "theme": {"color": "#059669"}
                }
            except Exception as e:
                # Development mode fallback: invalid/missing keys must not block
                # wallet top-ups either.
                if settings.DEBUG:
                    logger.warning(
                        "Razorpay wallet top-up failed (%s); using simulated order", str(e)
                    )
                    return await PaymentService._simulate_intent(payment_id, data.amount, "Wallet top-up")
                logger.error(f"Wallet top-up error: {str(e)}")
                return {"error": str(e)}

        return {"error": "Unsupported payment method"}
    
    @staticmethod
    async def confirm_wallet_topup(
        payment_id: str,
        gateway_response: Dict[str, Any]
    ) -> bool:
        """Confirm wallet top-up.

        Requires the Razorpay signature in production (checked via
        ``verify_wallet_topup``). Simulated top-ups are accepted ONLY in DEBUG
        mode. This method itself never credits without proof when not in DEBUG.
        """
        payment = await payment_repository.get_by_id(payment_id)
        if not payment:
            return False

        transaction_id = str(payment.get("transactionId") or "")

        # Simulated top-ups - development mode ONLY.
        if transaction_id.startswith("order_sim_"):
            if not settings.DEBUG:
                logger.warning("Simulated wallet top-up blocked in non-debug mode")
                return False
            return await PaymentService._credit_wallet_topup(payment, gateway_response)

        # Production: the caller must supply a verified signature, which is
        # checked by verify_wallet_topup before this is invoked. If the payload
        # did not carry verified metadata we refuse to credit.
        if not (gateway_response or {}).get("verified"):
            logger.warning("Refusing to credit unverified wallet top-up %s", payment_id)
            return False

        return await PaymentService._credit_wallet_topup(payment, gateway_response)

    @staticmethod
    async def verify_wallet_topup(
        payment_id: str,
        razorpay_order_id: str,
        razorpay_payment_id: str,
        razorpay_signature: str,
        user_id: Optional[str] = None,
    ) -> bool:
        """Verify a wallet top-up signature and credit the wallet."""
        payment = await payment_repository.get_by_id(payment_id)
        if not payment:
            return False
        if user_id and str(payment.get("userId")) != str(user_id):
            return False

        transaction_id = str(payment.get("transactionId") or "")

        # Simulated top-ups - development mode ONLY.
        if transaction_id.startswith("order_sim_"):
            if not settings.DEBUG:
                return False
            return await PaymentService._credit_wallet_topup(payment, {"simulated": True})

        # Verify the signature server-side using the Razorpay SDK.
        try:
            razorpay_client.utility.verify_payment_signature({
                "razorpay_order_id": razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_signature": razorpay_signature,
            })
        except Exception as e:
            logger.error(f"Wallet top-up signature verification failed: {str(e)}")
            return False

        return await PaymentService._credit_wallet_topup(
            payment,
            {
                "razorpay_order_id": razorpay_order_id,
                "razorpay_payment_id": razorpay_payment_id,
                "razorpay_signature": razorpay_signature,
                "verified": True,
            },
        )

    @staticmethod
    async def _credit_wallet_topup(
        payment: Dict[str, Any],
        gateway_response: Dict[str, Any]
    ) -> bool:
        """Credit a confirmed wallet top-up to the user's wallet."""
        # Update payment status
        await payment_repository.update_payment_status(
            str(payment["_id"]),
            PaymentStatus.SUCCESS,
            gateway_response
        )

        # Add funds to the user's wallet
        wallet = await wallet_repository.get_by_user_id(str(payment["userId"]))
        if not wallet:
            return False

        amount = payment.get("amount", 0)
        wallet_id = str(wallet["_id"])

        # Update wallet balance
        success = await wallet_repository.update_balance(
            wallet_id,
            amount,
            "credit"
        )

        if success:
            # Create transaction record
            wallet = await wallet_repository.get_by_id(wallet_id)
            transaction_data = {
                "walletId": ObjectId(wallet_id),
                "userId": payment["userId"],
                "amount": amount,
                "type": "credit",
                "description": "Wallet top-up",
                "referenceId": ObjectId(payment["_id"]),
                "referenceType": "payment",
                "balanceAfter": wallet.get("balance", 0)
            }
            await wallet_transaction_repository.create_transaction(transaction_data)

            from app.services.ledger_service import ledger_service
            await ledger_service.record(
                amount=amount,
                direction="credit",
                entry_type="wallet_topup",
                user_id=str(payment["userId"]) if payment.get("userId") else None,
                payment_id=str(payment["_id"]) if payment.get("_id") else None,
                reference=payment.get("transactionId"),
            )

            # Send notification
            await NotificationService.send_wallet_credit(
                str(payment["userId"]),
                amount,
                wallet.get("balance", 0)
            )

            return True

        return False
    
    @staticmethod
    async def _payouts_enabled() -> bool:
        """Real RazorpayX payouts are used only when explicitly enabled with keys."""
        return bool(
            settings.RAZORPAY_PAYOUTS_ENABLED
            and settings.RAZORPAY_KEY_ID
            and settings.RAZORPAY_KEY_SECRET
        )

    @staticmethod
    async def _get_or_create_razorpay_contact(user: Dict[str, Any]) -> str:
        """Return a RazorpayX contact id for the user, creating one if needed."""
        contact_id = user.get("razorpayContactId")
        if contact_id:
            return contact_id

        first = user.get("firstName") or ""
        last = user.get("lastName") or ""
        name = f"{first} {last}".strip() or "Farmer"
        phone = str(user.get("phone") or "").strip()
        if phone and not phone.startswith("+"):
            phone = f"+{phone}"
        email = user.get("email")

        contact_data = {
            "name": name[:50],
            "type": "customer",
            "reference_id": f"agri_user_{str(user['_id'])}",
        }
        if email:
            contact_data["email"] = email
        if phone:
            contact_data["contact"] = phone

        try:
            contact = razorpay_client.post("/v1/contacts", contact_data)
            contact_id = contact.get("id")
        except Exception as e:
            # Idempotency: a reference_id already registered returns an error.
            # Fall back to looking it up so we don't block a legitimate retry.
            try:
                existing = razorpay_client.get(
                    "/v1/contacts", {"reference_id": f"agri_user_{str(user['_id'])}"}
                )
                items = existing.get("items") or []
                contact_id = items[0].get("id") if items else None
            except Exception:
                contact_id = None
            if not contact_id:
                raise e

        if contact_id:
            await user_repository.update_user(
                str(user["_id"]), {"razorpayContactId": contact_id}
            )
        return contact_id

    @staticmethod
    async def _build_fund_account_payload(
        bank_account: Dict[str, Any],
        strict: bool = True,
    ):
        """Normalise a bankAccount payload into a RazorpayX fund account + mode.

        Supports bank transfers (accountNumber + ifsc) and UPI (upiId). Returns
        (account_type, fund_details, payout_mode) or raises ValueError.

        When ``strict`` is False (development/simulation mode) the IFSC format
        is not enforced so the withdrawal flow can be exercised with test data;
        strict validation always applies to real RazorpayX payouts.
        """
        bank = bank_account or {}
        upi_id = (bank.get("upiId") or bank.get("upi_id") or "").strip()
        account_number = str(bank.get("accountNumber") or bank.get("account_number") or "").strip()
        ifsc = str(bank.get("ifsc") or "").strip().upper()
        holder = (bank.get("accountHolder") or bank.get("name") or bank.get("account_holder") or "").strip()

        if upi_id:
            if "@" not in upi_id:
                raise ValueError("Invalid UPI ID")
            return "vpa", {"address": upi_id}, "UPI"

        if not account_number or not ifsc:
            raise ValueError("Provide either UPI ID or bank account number with IFSC code")
        if not holder:
            raise ValueError("Account holder name is required for bank transfer")
        if strict:
            # Valid IFSC: 4 letters + '0' + 6 alphanumerics, e.g. HDFC0001234.
            import re
            if not re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", ifsc):
                raise ValueError("Invalid IFSC code. Use the format e.g. HDFC0001234")
        return (
            "bank_account",
            {
                "name": holder[:60],
                "ifsc": ifsc,
                "account_number": account_number[:35],
            },
            (settings.RAZORPAY_PAYOUT_MODE or "IMPS").upper(),
        )

    @staticmethod
    async def _get_or_create_razorpay_fund_account(
        user_id: str,
        contact_id: str,
        bank_account: Dict[str, Any],
    ) -> str:
        """Return a RazorpayX fund account id for the given bank details."""
        account_type, fund_details, _mode = await PaymentService._build_fund_account_payload(bank_account)
        reference_id = f"agri_fund_{user_id}"

        # Reuse an existing fund account when the stored fingerprint still matches.
        user = await user_repository.get_by_id(user_id)
        fingerprint = f"{account_type}:{json.dumps(fund_details, sort_keys=True)}"
        if (
            user
            and user.get("razorpayFundAccountId")
            and user.get("razorpayFundFingerprint") == fingerprint
        ):
            return user["razorpayFundAccountId"]

        try:
            fund_account = razorpay_client.post("/v1/fund_accounts", {
                "contact_id": contact_id,
                "account_type": account_type,
                **({account_type: fund_details} if account_type == "vpa" else {"bank_account": fund_details}),
                "reference_id": reference_id,
            })
            fund_account_id = fund_account.get("id")
        except Exception as e:
            raise e

        if fund_account_id and user:
            await user_repository.update_user(user_id, {
                "razorpayFundAccountId": fund_account_id,
                "razorpayFundFingerprint": fingerprint,
            })
        return fund_account_id

    @staticmethod
    async def _create_razorpay_payout(
        withdrawal_id: str,
        user_id: str,
        amount: float,
        contact_id: str,
        fund_account_id: str,
        mode: str,
    ) -> Dict[str, Any]:
        """Create a RazorpayX payout and return the payout entity."""
        payout_data = {
            "fund_account_id": fund_account_id,
            "amount": int(round(amount * 100)),
            "currency": "INR",
            "mode": mode,
            "purpose": "payout",
            "queue_if_low_balance": True,
            "reference_id": f"agri_payout_{withdrawal_id}",
            "narration": settings.RAZORPAY_PAYOUT_NARRATION,
            "notes": {
                "withdrawal_id": withdrawal_id,
                "user_id": user_id,
                "kind": "farmer",
            },
        }
        if settings.RAZORPAY_PAYOUT_ACCOUNT_ID:
            payout_data["account_number"] = settings.RAZORPAY_PAYOUT_ACCOUNT_ID
        payout = razorpay_client.post("/v1/payouts", payout_data)
        return payout

    @staticmethod
    async def withdraw_wallet_funds(
        user_id: str,
        data: WalletWithdraw
    ) -> Dict[str, Any]:
        """Withdraw funds from wallet via a RazorpayX payout."""
        amount = round(float(data.amount), 2)
        # Get wallet
        wallet = await wallet_repository.get_by_user_id(user_id)
        if not wallet:
            return {"error": "Wallet not found"}

        # Validate bank / UPI details up front. In development/simulation mode
        # (payouts not enabled) only require the fields to be present so the
        # flow can be exercised with test data; real payouts validate strictly.
        try:
            await PaymentService._build_fund_account_payload(
                data.bankAccount,
                strict=await PaymentService._payouts_enabled(),
            )
        except ValueError as e:
            return {"error": str(e)}

        # Check balance
        if wallet.get("balance", 0) < amount:
            return {"error": "Insufficient balance"}

        # Check minimum withdrawal
        if amount < 100:
            return {"error": "Minimum withdrawal amount is ₹100"}

        # Anti-fraud: block withdrawal to a new bank account if a different
        # account was used recently (bank-change cooldown).
        blocked = await PaymentService._bank_change_cooldown_blocked(user_id, data.bankAccount)
        if blocked:
            return {"error": blocked}

        # Create withdrawal request.
        withdrawal_data = {
            "walletId": wallet["_id"],
            "userId": ObjectId(user_id),
            "amount": amount,
            "bankAccount": data.bankAccount,
            "status": "processing",
            "createdAt": datetime.utcnow()
        }
        withdrawal_id = await withdrawal_repository.create(withdrawal_data)
        if not withdrawal_id:
            return {"error": "Failed to create withdrawal request"}

        from app.services.ledger_service import ledger_service
        await ledger_service.record(
            amount=amount,
            direction="debit",
            entry_type="withdrawal",
            user_id=user_id,
            reference=withdrawal_id,
            metadata={"bankAccountHash": PaymentService._bank_account_hash(data.bankAccount)},
        )

        # Reserve the funds so the same balance cannot be withdrawn twice.
        await wallet_repository.update_balance(
            str(wallet["_id"]), amount, "debit"
        )
        wallet_after = await wallet_repository.get_by_id(str(wallet["_id"]))
        await wallet_transaction_repository.create_transaction({
            "walletId": wallet["_id"],
            "userId": wallet["userId"],
            "amount": amount,
            "type": "debit",
            "description": "Withdrawal to bank",
            "referenceId": ObjectId(withdrawal_id),
            "referenceType": "withdrawal",
            "balanceAfter": float(wallet_after.get("balance", 0)) if wallet_after else 0,
        })

        async def _release_funds(reason: str) -> None:
            """Refund reserved funds to the wallet when the payout fails."""
            await wallet_repository.update_balance(
                str(wallet["_id"]), amount, "credit"
            )
            wallet_now = await wallet_repository.get_by_id(str(wallet["_id"]))
            await wallet_transaction_repository.create_transaction({
                "walletId": wallet["_id"],
                "userId": wallet["userId"],
                "amount": amount,
                "type": "credit",
                "description": f"Withdrawal failed - {reason}",
                "referenceId": ObjectId(withdrawal_id),
                "referenceType": "withdrawal",
                "balanceAfter": float(wallet_now.get("balance", 0)) if wallet_now else 0,
            })

        if not await PaymentService._payouts_enabled():
            # Development mode: simulate a successful transfer.
            await withdrawal_repository.update_status(withdrawal_id, "completed", {
                "razorpayPayoutId": f"payout_sim_{withdrawal_id}",
                "processedAt": datetime.utcnow(),
                "simulated": True,
            })
            wallet_after = await wallet_repository.get_by_id(str(wallet["_id"]))
            await NotificationService.send_wallet_debit(
                user_id, amount, wallet_after.get("balance", 0) if wallet_after else 0
            )
            return {
                "success": True,
                "withdrawalId": withdrawal_id,
                "amount": amount,
                "status": "completed",
                "simulated": True,
                "message": "Withdrawal completed (simulated). Funds transferred to your account.",
            }

        # Real RazorpayX payout.
        try:
            user = await user_repository.get_by_id(user_id)
            if not user:
                raise ValueError("User not found")
            contact_id = await PaymentService._get_or_create_razorpay_contact(user)
            fund_account_id = await PaymentService._get_or_create_razorpay_fund_account(
                user_id, contact_id, data.bankAccount
            )
            _account_type, _fund_details, mode = await PaymentService._build_fund_account_payload(data.bankAccount)
            payout = await PaymentService._create_razorpay_payout(
                withdrawal_id, user_id, amount,
                contact_id, fund_account_id, mode,
            )
        except Exception as e:
            logger.error(f"Razorpay payout error for withdrawal {withdrawal_id}: {str(e)}")
            await withdrawal_repository.update_status(withdrawal_id, "failed", {
                "error": str(e),
                "failedAt": datetime.utcnow(),
            })
            await _release_funds(str(e)[:200])
            return {"error": f"Payout failed: {str(e)}"}

        # Payout created successfully. Use the actual RazorpayX status to decide
        # whether the transfer is already processed or still queued (finalised
        # later by the payout webhook).
        payout_status = str(payout.get("status") or "processed").lower()
        if payout_status == "processed":
            status = "completed"
            extra = {
                "razorpayPayoutId": payout.get("id"),
                "razorpayContactId": payout.get("contact_id"),
                "razorpayFundAccountId": payout.get("fund_account_id"),
                "razorpayStatus": payout.get("status"),
                "processedAt": datetime.utcnow(),
            }
            message = (
                f"Withdrawal of Rs {amount} successful. Funds have been "
                f"transferred to your account via {mode}."
            )
        else:
            status = "processing"
            extra = {
                "razorpayPayoutId": payout.get("id"),
                "razorpayContactId": payout.get("contact_id"),
                "razorpayFundAccountId": payout.get("fund_account_id"),
                "razorpayStatus": payout.get("status"),
            }
            message = (
                f"Withdrawal of Rs {amount} initiated. Funds will reach your "
                f"account via {mode} once Razorpay processes the payout."
            )

        await withdrawal_repository.update_status(withdrawal_id, status, extra)
        wallet_after = await wallet_repository.get_by_id(str(wallet["_id"]))
        await NotificationService.send_wallet_debit(
            user_id, amount, wallet_after.get("balance", 0) if wallet_after else 0
        )
        return {
            "success": True,
            "withdrawalId": withdrawal_id,
            "amount": amount,
            "status": status,
            "razorpayPayoutId": payout.get("id"),
            "message": message,
        }
    
    @staticmethod
    async def get_wallet_info(user_id: str) -> Dict[str, Any]:
        """Get wallet information."""
        wallet = await wallet_repository.get_by_user_id(user_id)
        if not wallet:
            return {"balance": 0, "currency": "INR", "transactions": []}
        
        # Get recent transactions
        transactions = await wallet_transaction_repository.get_by_wallet_id(
            str(wallet["_id"]),
            limit=20
        )
        
        return {
            "balance": wallet.get("balance", 0),
            "currency": wallet.get("currency", "INR"),
            "isActive": wallet.get("isActive", True),
            "transactions": transactions
        }
    
    @staticmethod
    async def handle_webhook(payload: Dict[str, Any]) -> bool:
        """Handle payment webhook for Stripe and Razorpay events."""
        event = payload.get("event")
        data = payload.get("data") or payload.get("payload")

        # ----- Stripe events -----
        if event == "payment_intent.succeeded":
            payment_intent_id = data.get("id")
            payment = await payment_repository.get_by_transaction_id(payment_intent_id)
            if payment:
                await PaymentService.confirm_payment(payment_intent_id, data)
                return True

        elif event == "payment_intent.payment_failed":
            payment_intent_id = data.get("id")
            payment = await payment_repository.get_by_transaction_id(payment_intent_id)
            if payment:
                await payment_repository.update_payment_status(
                    str(payment["_id"]),
                    PaymentStatus.FAILED,
                    data
                )
                await NotificationService.send_payment_failed(
                    str(payment["userId"]),
                    str(payment["orderId"])
                )
                return True

        # ----- Razorpay events -----
        # Razorpay wraps the event payload as:
        #   {"event": "payment.captured", "payload": {"payment": {"entity": {...}}}, ...}
        if event in ("payment.captured", "order.paid", "payment.authorized"):
            entity = None
            if isinstance(data, dict):
                entity = (data.get("payment") or {}).get("entity") or data.get("entity")
            if not entity:
                return False
            razorpay_order_id = entity.get("order_id")
            razorpay_payment_id = entity.get("id")
            payment = await payment_repository.get_by_transaction_id(razorpay_order_id)
            if payment:
                await PaymentService._finalize_successful_payment(
                    payment,
                    {
                        "razorpay_order_id": razorpay_order_id,
                        "razorpay_payment_id": razorpay_payment_id,
                        "source": "webhook"
                    }
                )
                return True

        elif event == "payment.failed":
            entity = None
            if isinstance(data, dict):
                entity = (data.get("payment") or {}).get("entity") or data.get("entity")
            if entity:
                razorpay_order_id = entity.get("order_id")
                payment = await payment_repository.get_by_transaction_id(razorpay_order_id)
                if payment:
                    await payment_repository.update_payment_status(
                        str(payment["_id"]),
                        PaymentStatus.FAILED,
                        entity
                    )
                    await NotificationService.send_payment_failed(
                        str(payment["userId"]),
                        str(payment["orderId"])
                    )
                    return True

        # ----- RazorpayX payout events -----
        # {"event": "payout.processed", "payload": {"payout": {"entity": {...}}}}
        if event in ("payout.processed", "payout.failed", "payout.reversed", "payout.cancelled"):
            entity = None
            if isinstance(data, dict):
                entity = (data.get("payout") or {}).get("entity") or data.get("entity")
            if not entity:
                return False
            payout_id = entity.get("id")
            withdrawal = await withdrawal_repository.get_by_razorpay_payout_id(payout_id)
            if not withdrawal:
                logger.warning(f"Payout webhook {event} for unknown payout {payout_id}")
                return False

            withdrawal_id = str(withdrawal["_id"])
            if event == "payout.processed":
                await withdrawal_repository.update_status(withdrawal_id, "completed", {
                    "razorpayStatus": entity.get("status"),
                    "processedAt": datetime.utcnow(),
                    "razorpayWebhookAt": datetime.utcnow(),
                })
            else:
                # Payout failed/reversed/cancelled: release reserved funds back to the wallet.
                amount = float(withdrawal.get("amount", 0))
                await withdrawal_repository.update_status(withdrawal_id, "failed", {
                    "razorpayStatus": entity.get("status"),
                    "error": f"Razorpay payout {event}",
                    "failedAt": datetime.utcnow(),
                })
                user_id = str(withdrawal.get("userId"))
                wallet = await wallet_repository.get_by_user_id(user_id)
                if wallet and amount > 0:
                    await wallet_repository.update_balance(str(wallet["_id"]), amount, "credit")
                    wallet_after = await wallet_repository.get_by_id(str(wallet["_id"]))
                    await wallet_transaction_repository.create_transaction({
                        "walletId": wallet["_id"],
                        "userId": wallet["userId"],
                        "amount": amount,
                        "type": "credit",
                        "description": f"Withdrawal {event.replace('.', ' ')} - funds returned",
                        "referenceId": withdrawal["_id"],
                        "referenceType": "withdrawal",
                        "balanceAfter": float(wallet_after.get("balance", 0)) if wallet_after else 0,
                    })
                    await NotificationService.send_wallet_credit(
                        user_id, amount,
                        float(wallet_after.get("balance", 0)) if wallet_after else 0
                    )
            return True

        return False

# Singleton instance
payment_service = PaymentService()
