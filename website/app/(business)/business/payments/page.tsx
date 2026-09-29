"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Loader2, Wallet, CheckCircle2, Clock, Landmark } from "lucide-react";
import { api } from "../../../lib/api/client";
import { useEffect, useState } from "react";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";

const statusVariant: Record<string, any> = {
  paid: "success",
  advance: "warning",
  pending: "secondary",
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || (window as any).Razorpay) return;
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => { script.remove(); };
  }, []);

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

  const payB2B = async (order: any) => {
    setPayingId(order.orderId);
    try {
      const res = await api.post(\`/b2b/orders/\${order.orderId}/payment-intent\`, { payment_method: "razorpay" });
      const intent = res?.data?.data || res?.data || res;
      if (intent?.simulated) {
        await api.post("/payments/verify", {
          payment_id: intent.payment_id,
          razorpay_order_id: intent.order_id,
          razorpay_payment_id: \`sim_payment_\${intent.payment_id}\`,
          razorpay_signature: "simulated_signature",
        });
        queryClient.invalidateQueries({ queryKey: ["b2b", "payments"] });
        return;
      }
      if (!(window as any).Razorpay) throw new Error("Payment gateway is still loading. Please try again.");
      await new Promise<void>((resolve) => {
        const rzp = new (window as any).Razorpay({
          key: intent.key_id,
          amount: intent.amount,
          currency: intent.currency || "INR",
          name: intent.name || "AgriConnect",
          description: intent.description || \`B2B Order \${order.orderNumber}\`,
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
              queryClient.invalidateQueries({ queryKey: ["b2b", "payments"] });
            } finally { resolve(); }
          },
          modal: { ondismiss: () => resolve() },
        });
        rzp.open();
      });
    } catch (err: any) {
      alert(err?.message || "B2B payment failed");
    } finally {
      setPayingId(null);
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
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-600">{formatPrice(p.totalAmount)}</p>
                    {p.paymentStatus !== "paid" ? (
                      <button
                        type="button"
                        onClick={() => payB2B(p)}
                        disabled={payingId === p.orderId}
                        className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {payingId === p.orderId ? "Processing…" : "Pay now"}
                      </button>
                    ) : null}
                    <p className="text-xs text-gray-400">
                      {p.advanceAmount ? `advance ${formatPrice(p.advanceAmount)} · ` : ""}
                      {p.startedAt ? new Date(p.startedAt).toLocaleDateString() : ""}
                    </p>
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
