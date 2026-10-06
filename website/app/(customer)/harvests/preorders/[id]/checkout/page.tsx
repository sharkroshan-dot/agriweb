"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, CheckCircle2, Loader2, MapPin, ShieldCheck, Sprout } from "lucide-react";
import { api } from "../../../../../lib/api/client";
import { formatPrice, formatDate } from "../../../../../lib/utils";
import { Button } from "../../../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../../components/ui/card";
import toast from "react-hot-toast";

declare global {
  interface Window {
    Razorpay?: any;
  }
}

type PreOrder = {
  id: string;
  cropName: string;
  quantityKg: number;
  allocatedQuantityKg?: number;
  plannedUnitPricePerKg?: number;
  unitPricePerKg?: number;
  finalUnitPricePerKg?: number;
  finalTotal?: number;
  priceChange?: number;
  status: string;
  productId?: string;
  deliveryAddressId?: string;
  deliveryAddress?: {
    address?: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  plan?: {
    expectedHarvestDate?: string;
    farmerInfo?: { farmName?: string; name?: string };
  };
};

export default function PreOrderCheckoutPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const preorderId = params?.id;

  const [preorder, setPreorder] = useState<PreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [paymentStage, setPaymentStage] = useState("idle");

  useEffect(() => {
    if (!preorderId) return;
    let cancelled = false;
    api.get("/harvests/my/preorders")
      .then((res: any) => {
        if (cancelled) return;
        const list = res?.data?.preorders || res?.preorders || [];
        const found = list.find((item: any) => String(item.id || item._id) === String(preorderId));
        if (!found) throw new Error("Pre-order not found");
        setPreorder(found);
      })
      .catch((err: any) => {
        if (!cancelled) {
          toast.error(err?.message || "Unable to load pre-order");
          router.push("/harvests");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [preorderId, router]);

  const quantity = Number(preorder?.allocatedQuantityKg || preorder?.quantityKg || 0);
  const plannedRate = Number(preorder?.plannedUnitPricePerKg || preorder?.unitPricePerKg || 0);
  const finalRate = Number(preorder?.finalUnitPricePerKg || plannedRate);
  const finalTotal = Number(preorder?.finalTotal || quantity * finalRate);
  const priceDifference = finalRate - plannedRate;

  const loadRazorpay = async () => {
    if (window.Razorpay) return true;
    return await new Promise<boolean>((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const payNow = async () => {
    if (!preorder || preorder.status !== "ready_for_confirmation") {
      toast.error("This pre-order is not ready for payment.");
      return;
    }
    if (!preorder.productId || !preorder.deliveryAddressId) {
      toast.error("The harvested product or delivery address is missing.");
      return;
    }

    setPlacing(true);
    setPaymentStage("creating");
    try {
      const key = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `preorder-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const orderRes = await api.post("/orders/", {
        preorderId: preorder.id,
        items: [{
          productId: preorder.productId,
          quantity,
          unitPrice: finalRate,
        }],
        deliveryAddressId: preorder.deliveryAddressId,
        paymentMethod: "razorpay",
        deliveryType: "delivery",
        deliverySpeed: "standard",
        idempotencyKey: key,
        requestedDeliveryDate: preorder.plan?.expectedHarvestDate
          ? new Date(preorder.plan.expectedHarvestDate).toISOString()
          : undefined,
        deliveryTimeSlot: "next_available",
      });

      const order = orderRes?.data || orderRes;
      if (!order?.id && !order?._id) throw new Error("Failed to create the pre-order order");

      setPaymentStage("processing");
      const intentRes = await api.post("/payments/create-intent", {
        order_id: order.id || order._id,
        payment_method: "razorpay",
      });
      const intent = intentRes?.data || intentRes;
      if (!intent?.order_id) throw new Error(intent?.error || "Payment initiation failed");

      const ready = await loadRazorpay();
      if (!ready || !window.Razorpay) throw new Error("Payment gateway unavailable");

      const orderId = order.id || order._id;
      await new Promise<void>((resolve) => {
        const rzp = new window.Razorpay({
          key: intent.key_id,
          amount: intent.amount,
          currency: intent.currency || "INR",
          name: intent.name || "AgriConnect",
          description: `Pre-order: ${preorder.cropName}`,
          order_id: intent.order_id,
          prefill: intent.prefill || {},
          theme: intent.theme || { color: "#059669" },
          handler: async (response: any) => {
            try {
              await api.post("/payments/verify", {
                payment_id: intent.payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });
              toast.success("Pre-order payment successful!");
              resolve();
              router.push(`/orders/${orderId}`);
            } catch (err: any) {
              toast.error(err?.message || "Payment verification failed");
              resolve();
            }
          },
          modal: {
            ondismiss: () => {
              toast("Payment cancelled. Your order remains unpaid and can be retried.", { icon: "🛒" });
              resolve();
            },
          },
        });
        rzp.open();
      });
    } catch (err: any) {
      toast.error(err?.message || "Could not complete pre-order checkout");
    } finally {
      setPlacing(false);
      setPaymentStage("idle");
    }
  };

  if (loading) {
    return <div className="page-container flex min-h-[40vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }

  if (!preorder) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-sm font-medium text-emerald-600">Harvest Pre-Order</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-950">Confirm your harvested produce</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your quantity was reserved from the actual harvest. Confirm the final farmer price before payment.
        </p>
      </div>

      {preorder.status !== "ready_for_confirmation" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-5">
            <p className="font-semibold text-amber-900">This pre-order is not ready for payment</p>
            <p className="mt-1 text-sm text-amber-800">Current status: {preorder.status.replaceAll("_", " ")}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sprout className="h-5 w-5 text-emerald-600" />
            {preorder.cropName}
          </CardTitle>
          <CardDescription>
            {preorder.plan?.farmerInfo?.farmName || preorder.plan?.farmerInfo?.name || "Local Farmer"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Reserved quantity</p>
              <p className="mt-1 text-xl font-bold">{quantity:g} kg</p>
              <p className="mt-1 text-xs text-emerald-700">Allocated from actual harvest</p>
            </div>
            <div className="rounded-xl border bg-slate-50 p-4">
              <p className="text-xs text-slate-500">Final selling rate</p>
              <p className="mt-1 text-xl font-bold">{formatPrice(finalRate)} / kg</p>
              <p className="mt-1 text-xs text-slate-500">Verified harvest price</p>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-semibold text-emerald-900">Final price confirmation</p>
                <p className="mt-1 text-sm text-emerald-800">
                  Planned price: {formatPrice(plannedRate)}/kg
                  {" · "}
                  Final price: {formatPrice(finalRate)}/kg
                </p>
                {priceDifference !== 0 && (
                  <p className="mt-2 text-sm font-semibold text-emerald-900">
                    {priceDifference > 0 ? "Final price increased" : "Final price decreased"} by {formatPrice(Math.abs(priceDifference))}/kg.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="flex justify-between text-sm text-slate-600">
              <span>{quantity:g} kg × {formatPrice(finalRate)}/kg</span>
              <span>{formatPrice(finalTotal)}</span>
            </div>
            <div className="flex justify-between border-t pt-3 text-lg font-bold text-slate-950">
              <span>Pay now</span>
              <span>{formatPrice(finalTotal)}</span>
            </div>
          </div>

          {preorder.deliveryAddress && (
            <div className="rounded-xl border p-4">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div className="text-sm">
                  <p className="font-semibold">Delivery address</p>
                  <p className="mt-1 text-slate-600">
                    {preorder.deliveryAddress.address || preorder.deliveryAddress.addressLine1}
                  </p>
                  <p className="text-slate-600">
                    {preorder.deliveryAddress.city}, {preorder.deliveryAddress.state} - {preorder.deliveryAddress.zipCode}
                  </p>
                </div>
              </div>
            </div>
          )}

          {preorder.plan?.expectedHarvestDate && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CalendarDays className="h-4 w-4" />
              Harvest date: {formatDate(preorder.plan.expectedHarvestDate)}
            </p>
          )}

          <div className="flex items-center gap-2 rounded-lg border bg-slate-50 p-3 text-xs text-slate-600">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            Payment is taken only after harvest quantity allocation and quality approval.
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={payNow}
            disabled={placing || preorder.status !== "ready_for_confirmation"}
          >
            {placing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{paymentStage === "creating" ? "Preparing payment…" : "Opening secure payment…"}</>
            ) : (
              <>Confirm final price & pay {formatPrice(finalTotal)}</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
