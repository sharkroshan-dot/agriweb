"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CreditCard, Loader2, Wallet, CheckCircle2, Clock, Landmark } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import toast from "react-hot-toast";

const statusVariant: Record<string, any> = {
  paid: "success",
  advance: "warning",
  pending: "secondary",
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["b2b", "payments"],
    queryFn: () => api.get("/b2b/payments"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const summary = data?.data ?? {};
  const payments = summary.payments ?? [];

  const payBalance = async (payment: any) => {
    if (payingOrderId) return;
    setPayingOrderId(payment.orderId);
    try {
      const intentResponse = await api.post(`/b2b/orders/${payment.orderId}/payment-intent`, {});
      const intent = intentResponse?.data?.data ?? intentResponse?.data ?? intentResponse;
      if (!intent?.key_id || !intent?.order_id) throw new Error("Payment gateway did not return a valid checkout order.");

      if (!(window as any).Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector('script[data-b2b-razorpay="true"]') as HTMLScriptElement | null;
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Could not load Razorpay checkout.")), { once: true });
            if ((window as any).Razorpay) resolve();
            return;
          }
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.dataset.b2bRazorpay = "true";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Could not load Razorpay checkout."));
          document.body.appendChild(script);
        });
      }

      const RazorpayCtor = (window as any).Razorpay;
      if (!RazorpayCtor) throw new Error("Razorpay checkout is unavailable.");
      const checkout = new RazorpayCtor({
        key: intent.key_id,
        order_id: intent.order_id,
        amount: intent.amount,
        currency: intent.currency || "INR",
        name: "AgriConnect Business Procurement",
        description: intent.description || `Balance for ${payment.orderNumber}`,
        handler: async (response: any) => {
          try {
            await api.post(`/b2b/orders/${payment.orderId}/payment-confirm`, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            toast.success("Payment verified successfully.");
            await queryClient.invalidateQueries({ queryKey: ["b2b", "payments"] });
            await queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
            await queryClient.invalidateQueries({ queryKey: ["b2b", "invoices"] });
          } catch (err: any) {
            toast.error(err?.message || "Payment could not be verified. Contact support before retrying.");
          } finally {
            setPayingOrderId(null);
          }
        },
        modal: { ondismiss: () => setPayingOrderId(null) },
        theme: { color: "#059669" },
      });
      checkout.open();
    } catch (err: any) {
      toast.error(err?.message || "Could not start payment.");
      setPayingOrderId(null);
    }
  };

  const statCards = [
    { label: "Spent This Month", value: formatPrice(summary.totalMonth ?? 0), icon: Wallet, color: "text-emerald-600" },
    { label: "Paid", value: formatPrice(summary.paid ?? 0), icon: CheckCircle2, color: "text-blue-600" },
    { label: "Pending", value: formatPrice(summary.pending ?? 0), icon: Clock, color: "text-amber-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CreditCard className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">Payments</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-6">
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <s.icon className={`h-4 w-4 ${s.color}`} /> {s.label}
              </p>
              <p className="mt-1 text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="border-b p-4">
            <p className="text-base font-semibold">Payment History</p>
            <p className="text-sm text-gray-500">All B2B orders and their settlement status.</p>
          </div>
          {payments.length === 0 ? (
            <p className="py-14 text-center text-sm text-gray-400">
              <Landmark className="mx-auto mb-2 h-8 w-8 text-gray-300" />
              No orders yet. Accept a farmer quote to create a B2B order.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {payments.map((p: any) => (
                <div key={p.orderId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{p.orderNumber}</p>
                      <Badge variant={statusVariant[p.paymentStatus] || "secondary"}>
                        {p.paymentStatus}
                      </Badge>
                      {p.paymentMode ? <Badge variant="outline" className="capitalize">{p.paymentMode}</Badge> : null}
                    </div>
                    <p className="text-sm text-gray-500">
                      {p.productName} · {p.quantityKg} kg · {p.farmName || "Farm"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Paid {formatPrice(p.paidAmount ?? 0)} · Balance due {formatPrice(p.balanceDue ?? p.totalAmount)}
                      {p.deliveryCharge ? ` · Delivery ${formatPrice(p.deliveryCharge)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-lg font-bold text-emerald-600">{formatPrice(p.totalAmount)}</p>
                      <p className="text-xs text-gray-400">{p.startedAt ? new Date(p.startedAt).toLocaleDateString() : ""}</p>
                    </div>
                    {(p.balanceDue ?? p.totalAmount) > 0 && (
                      <Button size="sm" disabled={Boolean(payingOrderId)} onClick={() => payBalance(p)}>
                        {payingOrderId === p.orderId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CreditCard className="mr-1.5 h-4 w-4" />}
                        Pay Balance
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
