"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "../../../../components/ui/button";
import { CheckCircle2, Clock3, Loader2, MapPin, Package, Truck, Users, CreditCard } from "lucide-react";
import { api } from "../../../../lib/api/client";
import { Card, CardContent } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";

const STAGES = [
  ["order_created", "Order Confirmed", "Your bulk request has been created."],
  ["sourcing", "Smart Sourcing", "AgriConnect is finding suitable farmer stock."],
  ["farmer_confirmation", "Farmers Confirmed", "Selected farmers are preparing your items."],
  ["stock_reserved", "Stock Reserved", "The required live inventory is reserved."],
  ["packing", "Packing", "Farmers are packing the allocated quantities."],
  ["collection", "Collection", "Products are being collected from farms."],
  ["warehouse_receiving", "Source Warehouse Receiving", "Farm portions are being physically received, quantity-reconciled, and quality-checked at their assigned source warehouses."],
  ["consolidation_transfer", "Transfer to Consolidation", "Stored and quality-approved portions are being transferred from source warehouses to the designated consolidation warehouse."],
  ["consolidation", "Consolidation", "The consolidation warehouse is confirming every portion and reconciling quantities before the final delivery route is selected."],
  ["local_hub_receipt", "Local Hub Receipt", "The consolidated order is on the way to the assigned local hub and must be physically received there."],
  ["ready_for_delivery", "Ready for Delivery", "The complete bulk order is ready."],
  ["delivery_partner", "Delivery Partner Assigned", "A delivery job has been assigned."],
  ["out_for_delivery", "Out for Delivery", "Your order is on the way."],
  ["delivered", "Delivered", "Your bulk order has been delivered."],
] as const;

const INDEX: Record<string, number> = Object.fromEntries(STAGES.map((s, i) => [s[0], i]));

function stageIndex(stage: string) {
  return INDEX[stage] ?? 0;
}

export default function BulkOrderTrackingPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const queryClient = useQueryClient();
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const refreshTracking = () => queryClient.invalidateQueries({ queryKey: ["bulk", "tracking", requestId] });

  const payOnlineNow = async () => {
    setPaymentBusy(true);
    setPaymentError("");
    try {
      const intentResponse = await api.post(`/bulk-orders/requests/${requestId}/payment/create-intent`, {});
      const intent = intentResponse?.data;
      if (!intent?.razorpayOrderId || !intent?.keyId || !intent?.paymentId) {
        throw new Error("The payment service did not return a valid checkout session.");
      }
      const RazorpayCtor = (window as any).Razorpay;
      if (!RazorpayCtor) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector('script[data-razorpay-checkout="true"]') as HTMLScriptElement | null;
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Could not load online payment checkout.")), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.async = true;
          script.dataset.razorpayCheckout = "true";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Could not load online payment checkout."));
          document.body.appendChild(script);
        });
      }
      const Checkout = (window as any).Razorpay;
      if (!Checkout) throw new Error("Online checkout is unavailable. Please try again.");
      const checkout = new Checkout({
        key: intent.keyId,
        amount: intent.amount,
        currency: intent.currency || "INR",
        name: "AgriConnect",
        description: `Bulk/Event order ${request.requestNumber || ""}`,
        order_id: intent.razorpayOrderId,
        prefill: { name: request.buyerName || "" },
        notes: { requestId, paymentId: intent.paymentId },
        handler: async (response: any) => {
          try {
            await api.post(`/bulk-orders/requests/${requestId}/payment/verify`, {
              paymentId: intent.paymentId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            toast.success("Payment verified. Your existing event order is now marked paid.");
            await refreshTracking();
          } catch (error: any) {
            const message = error?.message || "Payment verification could not be completed. Do not pay again until the transaction is checked.";
            setPaymentError(message);
            toast.error(message);
          } finally {
            setPaymentBusy(false);
          }
        },
        modal: { ondismiss: () => setPaymentBusy(false) },
        theme: { color: "#059669" },
      });
      checkout.on("payment.failed", (response: any) => {
        setPaymentError(response?.error?.description || "Payment failed. Your existing order has not been marked paid.");
        setPaymentBusy(false);
      });
      checkout.open();
    } catch (error: any) {
      const message = error?.message || "Could not start online payment.";
      setPaymentError(message);
      toast.error(message);
      setPaymentBusy(false);
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["bulk", "tracking", requestId],
    queryFn: () => api.get(`/bulk-orders/event-orders/${requestId}/tracking`),
    enabled: Boolean(requestId),
    refetchInterval: 10000,
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  if (error || !data?.data) return <Card><CardContent className="py-12 text-center text-sm text-slate-500">Tracking information is not available yet.</CardContent></Card>;

  const tracking = data.data;
  const request = tracking.request;
  const changeCodToOnline = Boolean(request?.paymentMethod === "cod" || request?.paymentMethod === "cash_on_delivery") &&
    String(request?.paymentStatus || "").toLowerCase() === "cod_pending";
  const current = tracking.currentStage === "cancelled" ? -1 : stageIndex(tracking.currentStage);
  const isWeekly = tracking.purchaseMode === "family_weekly";
  const fulfillments = tracking.fulfillments || [];
  const productSummary = tracking.productSummary || [];
  const jobs = tracking.deliveryJobs || [];
  const collected = fulfillments.filter((f: any) => ["collected", "warehouse_received", "stored"].includes(f.status)).length;
  const totalFulfillments = fulfillments.length;

  const stageVisible = (key: string) => {
    if (isWeekly && ["consolidation"].includes(key) && totalFulfillments <= 1) return false;
    return true;
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/bulk-orders" className="text-sm font-medium text-emerald-700 hover:underline">← Bulk Orders</Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{isWeekly ? "Weekly Family Basket Tracking" : tracking.request?.buyerCategory === "business" ? "Business Bulk Order Tracking" : tracking.request?.buyerCategory === "institution" ? "Institutional Bulk Order Tracking" : tracking.request?.buyerCategory === "individual" ? "Individual Bulk Order Tracking" : "Event Order Tracking"}</h1>
          <p className="mt-1 text-sm text-slate-500">{request.requestNumber} · {request.organizationName ? request.organizationName + " · " : ""}{request.purpose}</p>
        </div>
        <Badge variant={tracking.currentStage === "delivered" ? "success" : tracking.currentStage === "cancelled" ? "destructive" : "warning"}>
          {tracking.currentStage.replace(/_/g, " ")}
        </Badge>
      </div>

      <Card className="border-emerald-100">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">Buyer / Order Type</p><p className="mt-1 font-semibold">{isWeekly ? "Weekly Family Basket" : request.buyerCategory === "business" ? "Business Bulk Order" : request.buyerCategory === "institution" ? "Institutional Bulk Order" : request.buyerCategory === "individual" ? "Individual Bulk Order" : "Event Order"}</p><p className="text-xs text-slate-500">{request.organizationType || request.buyerCategory || "event organizer"}</p></div>
          <div><p className="text-xs text-slate-500">Delivery</p><p className="mt-1 font-semibold">{request.requestedDeliveryDate}{request.requestedDeliveryTime ? ` · ${request.requestedDeliveryTime}` : ""}</p></div>
          <div><p className="text-xs text-slate-500">Destination</p><p className="mt-1 flex items-center gap-1 font-semibold"><MapPin className="h-4 w-4 text-emerald-600" />{request.deliveryCity || request.deliveryAddress?.city || "Location"}</p></div>
        </CardContent>
      </Card>

      <Card className={changeCodToOnline ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">Payment</h2>
            <p className="mt-1 text-sm text-slate-600">Status: <span className="font-semibold">{String(request.paymentStatus || "payment not recorded").replace(/_/g, " ")}</span>{request.paymentMethod ? ` · Method: ${String(request.paymentMethod).replace(/_/g, " ")}` : ""}</p>
            {request.paidAmount ? <p className="mt-1 text-sm text-slate-600">Paid: ₹{Number(request.paidAmount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p> : null}
            {changeCodToOnline ? <p className="mt-1 text-sm text-amber-900">You can pay the full confirmed amount online for this same order. Your request and fulfillment records will remain unchanged.</p> : null}
            {paymentError ? <p role="alert" className="mt-2 text-sm text-red-700">{paymentError}</p> : null}
          </div>
          {changeCodToOnline ? <Button onClick={payOnlineNow} disabled={paymentBusy}><CreditCard className="mr-2 h-4 w-4" />{paymentBusy ? "Opening payment..." : "Pay Online Now"}</Button> : null}
        </CardContent>
      </Card>

      {request.eventDeliveryStatus === "replacement_required" && (
        <Card className="border-amber-300 bg-amber-50/60"><CardContent className="p-5"><h2 className="font-semibold text-amber-950">Quantity or quality discrepancy under review</h2><p className="mt-1 text-sm text-amber-900">The warehouse has recorded a discrepancy in one of the event portions. Final delivery remains blocked while the missing or rejected quantity is resolved. The order will continue once the required quantity is verified.</p></CardContent></Card>
      )}
      {tracking.deliveryVerificationCode && tracking.currentStage !== "delivered" && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div><h2 className="font-semibold text-amber-950">Final delivery verification code</h2><p className="mt-1 max-w-2xl text-sm text-amber-900">Share this code with the delivery partner only after the complete event order physically arrives at your delivery address. The partner must also upload a delivery photo.</p></div>
            <div className="rounded-xl border border-amber-300 bg-white px-5 py-3 text-center"><p className="text-xs text-amber-800">Customer OTP</p><p className="text-2xl font-bold tracking-[0.25em] text-amber-950">{tracking.deliveryVerificationCode}</p></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5 sm:p-7">
          <h2 className="mb-6 text-lg font-semibold">Order Journey</h2>
          <div className="space-y-1">
            {STAGES.filter(([key]) => stageVisible(key)).map(([key, label, description], index) => {
              const actualIndex = stageIndex(key);
              const done = tracking.currentStage === "delivered" || (current >= actualIndex && key !== "delivered");
              const active = tracking.currentStage === key;
              return (
                <div key={key} className="relative flex gap-4">
                  <div className="flex w-8 shrink-0 flex-col items-center">
                    <div className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border ${done ? "border-emerald-600 bg-emerald-600 text-white" : active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-400"}`}>
                      {done ? <CheckCircle2 className="h-4 w-4" /> : active ? <Clock3 className="h-4 w-4" /> : <span className="text-xs">{index + 1}</span>}
                    </div>
                    {index < STAGES.filter(([k]) => stageVisible(k)).length - 1 ? <div className={`h-10 w-px ${done ? "bg-emerald-300" : "bg-slate-200"}`} /> : null}
                  </div>
                  <div className="pb-5">
                    <p className={`font-semibold ${done || active ? "text-slate-900" : "text-slate-400"}`}>{label}</p>
                    <p className="text-sm text-slate-500">{description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div><h2 className="text-lg font-semibold">All Products in This Order</h2><p className="text-sm text-slate-500">Requested quantity, source allocation, and fulfillment status for each product.</p></div>
            <Badge variant="outline">{productSummary.length || request.items?.length || 0} products</Badge>
          </div>
          <div className="space-y-3">
            {(productSummary.length ? productSummary : (request.items || []).map((item: any) => ({
              productName: item.name, category: item.category, qualityGrade: item.qualityGrade,
              requestedQuantityKg: item.quantityKg, allocatedQuantityKg: 0,
              remainingQuantityKg: item.quantityKg, sourceCount: 0, sourceStatuses: [], status: "not_sourced",
            }))).map((product: any, index: number) => (
              <div key={String(product.productName) + "-" + index} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold text-slate-900">{product.productName || "Product"}</p>
                    <p className="mt-1 text-sm text-slate-500">{product.category || "General"}{product.qualityGrade ? " · " + product.qualityGrade + " quality" : ""}</p></div>
                  <Badge variant={product.status === "complete" ? "success" : product.status === "not_sourced" ? "destructive" : "secondary"}>{String(product.status || "pending").replace(/_/g, " ")}</Badge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Requested</p><p className="font-semibold">{Number(product.requestedQuantityKg || 0).toLocaleString()} kg</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Allocated to farmers</p><p className="font-semibold">{Number(product.allocatedQuantityKg || 0).toLocaleString()} kg</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Still to source</p><p className="font-semibold">{Number(product.remainingQuantityKg ?? Math.max(0, Number(product.requestedQuantityKg || 0) - Number(product.allocatedQuantityKg || 0))).toLocaleString()} kg</p></div>
                  <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Source portions</p><p className="font-semibold">{product.sourceCount || 0}</p></div>
                </div>
                {(product.sourceStatuses || []).length > 0 ? <div className="mt-3 space-y-2">
                  {(product.sourceStatuses || []).map((source: any) => <div key={source.fulfillmentId || source.farmerId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
                    <div><p className="font-medium">{source.farmName || "Assigned farmer"}</p><p className="text-xs text-slate-500">{Number(source.allocatedQuantityKg || 0).toLocaleString()} kg · Collection: {String(source.collectionStatus || "not started").replace(/_/g, " ")} · Warehouse: {String(source.warehouseStatus || "not received").replace(/_/g, " ")} · Quality: {String(source.qualityStatus || "pending").replace(/_/g, " ")}</p></div>
                    <Badge variant="outline">{String(source.status || "pending").replace(/_/g, " ")}</Badge>
                  </div>)}
                </div> : <p className="mt-3 text-sm text-amber-700">No farmer/source portion allocated yet.</p>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {fulfillments.length > 0 ? (
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5 text-emerald-600" /><h2 className="font-semibold">Farmer Fulfillment</h2></div>
            <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="font-semibold">{collected} / {totalFulfillments}</span> farmer fulfillment{totalFulfillments === 1 ? "" : "s"} collected</div>
            {request.familySize ? <p className="mb-3 text-xs text-slate-500">Family size: {request.familySize}</p> : null}
            <div className="space-y-2">
              {fulfillments.map((f: any) => (
                <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                  <div><p className="font-medium">{f.farmName || "Farmer"}</p><p className="text-xs text-slate-500">{f.productName} · {f.allocatedQuantityKg} kg</p></div>
                  <Badge variant={["collected", "warehouse_received", "stored"].includes(f.status) ? "success" : f.status === "cancelled" ? "destructive" : "secondary"}>{String(f.status || "").replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {jobs.length > 0 ? (
        <Card className="border-blue-100">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2"><Truck className="h-5 w-5 text-blue-600" /><h2 className="font-semibold">Delivery</h2></div>
            {jobs.map((job: any) => (
              <div key={job.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><p className="font-semibold">{job.jobType === "event_hub_transfer" ? "Consolidation → Local Hub Transfer" : "Final Customer Delivery"}</p><p className="text-sm text-slate-500">{job.pickupName || "Pickup"} → {job.deliveryCity || "Destination"}</p><p className="text-xs text-slate-500">{job.orderNumber || request.requestNumber}</p></div>
                  <Badge variant={job.status === "delivered" ? "success" : "outline"}>{String(job.eventProgressStatus || job.status || "pending").replace(/_/g, " ")}</Badge>
                </div>
                {job.deliveryAddress ? <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Package className="h-4 w-4" />{typeof job.deliveryAddress === "string" ? job.deliveryAddress : job.deliveryAddress?.addressLine1 || job.deliveryAddress?.formattedAddress || job.deliveryAddress?.city || "Delivery address available"}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
