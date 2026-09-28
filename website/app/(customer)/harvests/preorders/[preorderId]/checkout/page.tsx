"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "../../../../../lib/api/client";
import { Loader2, MapPin, CreditCard, CheckCircle2, ArrowLeft, ShieldCheck } from "lucide-react";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

export default function PreorderCheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const preorderId = String(params.preorderId || "");

  const [preorder, setPreorder] = useState<any>(null);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [addressId, setAddressId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deliveryFee, setDeliveryFee] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [poRes, addrRes] = await Promise.all([
          api.get("/harvests/my/preorders"),
          api.get("/users/me/addresses"),
        ]);
        const list = poRes?.data?.preorders || [];
        const po = list.find((x: any) => String(x.id || x._id) === preorderId);
        const addrList = Array.isArray(addrRes) ? addrRes : (addrRes?.data || []);
        setPreorder(po || null);
        setAddresses(addrList);
        const def = addrList.find((a: any) => a.is_default) || addrList[0];
        if (def) setAddressId(String(def.id || def._id));
        if (!po) setError("Pre-order not found.");
      } catch (e: any) {
        setError(e?.message || "Unable to load your pre-order.");
      } finally {
        setLoading(false);
      }
    };
    if (preorderId) void load();
  }, [preorderId]);

  const qty = Number(preorder?.quantityKg || 0);
  const agreedPrice = Number(preorder?.unitPricePerKg || 0);
  const subtotal = Number(preorder?.total || qty * agreedPrice || 0);

  const selectedAddress = useMemo(
    () => addresses.find((a: any) => String(a.id || a._id) === addressId),
    [addresses, addressId]
  );

  useEffect(() => {
    if (!addressId || !preorder?.productId || !qty) {
      setDeliveryFee(0);
      return;
    }
    let cancelled = false;
    api.post("/delivery/fee-estimate", {
      items: [{ productId: String(preorder.productId), quantity: qty }],
      deliveryAddressId: addressId,
      method: "farmer",
      orderAmount: subtotal,
    }).then((res: any) => {
      if (!cancelled) setDeliveryFee(Number(res?.data?.fee ?? res?.fee ?? 0) || 0);
    }).catch(() => {
      if (!cancelled) setDeliveryFee(0);
    });
    return () => { cancelled = true; };
  }, [addressId, preorder?.productId, qty, subtotal]);

  const totalPayable = subtotal + deliveryFee + Math.max(0, subtotal * 0.05);

  const loadRazorpay = async () => {
    if (typeof window !== "undefined" && window.Razorpay) return true;
    await new Promise<void>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => resolve();
      document.body.appendChild(script);
    });
    return !!window.Razorpay;
  };

  const finishOrder = (orderId: string, message: string) => {
    setSuccess(message);
    setTimeout(() => router.push("/orders/" + orderId), 500);
  };

  const placeOrder = async () => {
    setError("");
    if (!preorder?.productId) {
      setError("This harvest is not available for checkout yet.");
      return;
    }
    if (!addressId) {
      setError("Please select a delivery address.");
      return;
    }

    setPlacing(true);
    try {
      const response = await api.post("/orders/", {
        preorderId,
        items: [{
          productId: String(preorder.productId),
          quantity: qty,
          unitPrice: agreedPrice,
        }],
        deliveryAddressId: addressId,
        paymentMethod,
        deliveryType: "delivery",
        deliveryMethod: "farmer",
        requestedDeliveryDate: undefined,
        specialInstructions: "Harvest pre-order delivery",
        idempotencyKey: crypto.randomUUID(),
      });
      const order = response?.data || response;
      const orderId = String(order.id || order._id);

      if (paymentMethod === "cash") {
        finishOrder(orderId, "Pre-order converted to a cash-on-delivery order.");
        return;
      }

      const intentRes = await api.post("/payments/create-intent", {
        order_id: orderId,
        payment_method: paymentMethod,
      });
      const intent = intentRes?.data || intentRes;

      if (paymentMethod === "wallet") {
        if (intent?.status !== "success") {
          throw new Error(intent?.error || "Wallet payment failed.");
        }
        finishOrder(orderId, "Pre-order payment completed successfully.");
        return;
      }

      if (!intent?.order_id || !(await loadRazorpay())) {
        throw new Error("Payment gateway could not be opened. Your order remains pending.");
      }
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("Payment gateway unavailable.");

      const rzp = new Razorpay({
        key: intent.key_id,
        amount: intent.amount,
        currency: intent.currency || "INR",
        name: "AgriConnect",
        description: preorder.cropName + " pre-order",
        order_id: intent.order_id,
        prefill: intent.prefill || {},
        theme: { color: "#059669" },
        handler: async (payment: any) => {
          try {
            await api.post("/payments/verify", {
              payment_id: intent.payment_id,
              razorpay_order_id: payment.razorpay_order_id,
              razorpay_payment_id: payment.razorpay_payment_id,
              razorpay_signature: payment.razorpay_signature,
            });
            finishOrder(orderId, "Payment verified. Your pre-order is now a confirmed order.");
          } catch (e: any) {
            setError(e?.message || "Payment verification failed. You can retry from your order.");
          } finally {
            setPlacing(false);
          }
        },
        modal: {
          ondismiss: () => {
            setError("Payment was cancelled. Your order is still pending and can be retried.");
            setPlacing(false);
          },
        },
      });
      rzp.open();
      return;
    } catch (e: any) {
      setError(e?.message || "Unable to create the pre-order order.");
    } finally {
      if (paymentMethod === "cash" || paymentMethod === "wallet") setPlacing(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-slate-600 hover:text-emerald-700">
        <ArrowLeft className="h-4 w-4" /> Back to pre-orders
      </button>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="h-5 w-5" />{success}</div>}

      {!preorder ? (
        <div className="rounded-2xl border bg-white p-8 text-center">
          <h1 className="text-xl font-semibold">Pre-order unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">This pre-order may have expired, been cancelled, or already been converted to an order.</p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold">Confirm Your Harvest Pre-order</h1>
            <p className="mt-1 text-sm text-slate-500">Your agreed pre-order price is protected during checkout.</p>
          </div>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold">{preorder.cropName}</p>
                <p className="mt-1 text-sm text-slate-500">{qty} kg × ₹{agreedPrice.toFixed(2)}/kg</p>
              </div>
              <p className="text-xl font-bold text-emerald-700">₹{totalPayable.toFixed(2)}</p>
            </div>
            <div className="mt-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <div className="flex justify-between"><span>Pre-order value</span><span>₹{subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Delivery</span><span>{deliveryFee ? `₹${deliveryFee.toFixed(2)}` : "Calculating…"}</span></div>
              <div className="flex justify-between"><span>Platform fee</span><span>₹{(subtotal * 0.05).toFixed(2)}</span></div>
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Total payable</span><span>₹{totalPayable.toFixed(2)}</span></div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              Pre-order price locked at ₹{agreedPrice.toFixed(2)}/kg
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-semibold"><MapPin className="h-5 w-5 text-emerald-600" /> Delivery address</h2>
            <div className="mt-3 space-y-2">
              {addresses.map((a: any) => {
                const id = String(a.id || a._id);
                return (
                  <label key={id} className={`block cursor-pointer rounded-xl border p-3 ${addressId === id ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}>
                    <input type="radio" className="mr-2" checked={addressId === id} onChange={() => setAddressId(id)} />
                    <span className="text-sm font-medium">{a.address_line1 || a.addressLine1 || a.address || "Address"}</span>
                    <span className="block pl-5 text-xs text-slate-500">{a.city}, {a.state} - {a.zip_code || a.zipCode || a.pincode}</span>
                  </label>
                );
              })}
              {!selectedAddress && <p className="text-sm text-slate-500">Add a delivery address from your account before checkout.</p>}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-semibold"><CreditCard className="h-5 w-5 text-emerald-600" /> Payment</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[
                ["upi", "UPI / Razorpay"],
                ["card", "Card"],
                ["cash", "Cash on Delivery"],
              ].map(([value, label]) => (
                <label key={value} className={`cursor-pointer rounded-xl border p-3 text-sm ${paymentMethod === value ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}>
                  <input type="radio" className="mr-2" checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <button
            onClick={placeOrder}
            disabled={placing || !addressId || !!success}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {placing ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            {paymentMethod === "cash" ? "Confirm Pre-order with COD" : `Confirm Pre-order & Pay ₹${totalPayable.toFixed(2)}`}
          </button>
        </>
      )}
    </div>
  );
}
