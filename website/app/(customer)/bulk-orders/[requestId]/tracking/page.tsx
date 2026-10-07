"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Loader2, MapPin, Package, Truck, Users } from "lucide-react";
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
  ["warehouse_receiving", "Warehouse Receiving", "All collected products are being received and quality-checked at the warehouse."],
  ["consolidation", "Consolidation", "All received products are being stored and consolidated together."],
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
  const current = tracking.currentStage === "cancelled" ? -1 : stageIndex(tracking.currentStage);
  const isWeekly = tracking.purchaseMode === "family_weekly";
  const fulfillments = tracking.fulfillments || [];
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
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Bulk Order Tracking</h1>
          <p className="mt-1 text-sm text-slate-500">{request.requestNumber} · {request.purpose}</p>
        </div>
        <Badge variant={tracking.currentStage === "delivered" ? "success" : tracking.currentStage === "cancelled" ? "destructive" : "warning"}>
          {tracking.currentStage.replace(/_/g, " ")}
        </Badge>
      </div>

      <Card className="border-emerald-100">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">Order Type</p><p className="mt-1 font-semibold">{isWeekly ? "Weekly Family Bulk" : "Event Bulk"}</p></div>
          <div><p className="text-xs text-slate-500">Delivery</p><p className="mt-1 font-semibold">{request.requestedDeliveryDate}{request.requestedDeliveryTime ? ` · ${request.requestedDeliveryTime}` : ""}</p></div>
          <div><p className="text-xs text-slate-500">Destination</p><p className="mt-1 flex items-center gap-1 font-semibold"><MapPin className="h-4 w-4 text-emerald-600" />{request.deliveryCity || request.deliveryAddress?.city || "Location"}</p></div>
        </CardContent>
      </Card>

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

      {fulfillments.length > 0 ? (
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center gap-2"><Users className="h-5 w-5 text-emerald-600" /><h2 className="font-semibold">Farmer Fulfillment</h2></div>
            <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="font-semibold">{collected} / {totalFulfillments}</span> farmer fulfillment{totalFulfillments === 1 ? "" : "s"} collected</div>
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
                  <div><p className="font-semibold">{job.orderNumber || request.requestNumber}</p><p className="text-sm text-slate-500">{job.pickupName || "Pickup"} → {job.deliveryCity || "Destination"}</p></div>
                  <Badge variant="success">{String(job.status || "").replace(/_/g, " ")}</Badge>
                </div>
                {job.deliveryAddress ? <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Package className="h-4 w-4" />{job.deliveryAddress}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
