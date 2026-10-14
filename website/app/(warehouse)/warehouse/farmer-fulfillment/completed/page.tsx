"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ArrowLeft, RefreshCw, PackageCheck, Truck, Warehouse, Clock3, MapPin } from "lucide-react";
import { PrefetchLink as Link } from "../../../../components/shared/prefetch-link";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { api } from "../../../../lib/api/client";

const routeGroups = [
  { key: "nearby", title: "Nearby Delivery" },
  { key: "same_district", title: "Same-District Warehouse Fulfillment" },
  { key: "inter_district", title: "Inter-District Warehouse Fulfillment" },
  { key: "route_review", title: "Route Review Required" },
  { key: "needs_location", title: "Needs Location Data" },
  { key: "other", title: "Other / Legacy Route" },
];

const statusFor = (order: any) => {
  const status = String(order.transferStatus || "").toLowerCase();
  const stage = String(order.stage || "").toLowerCase();
  const orderStatus = String(order.orderStatus || "").toLowerCase();
  if (["delivered", "completed"].includes(orderStatus) || ["delivered", "completed"].includes(status)) return { label: "Delivered / Completed", tone: "success", step: 6 };
  if (["local_hub_ready", "hub_received", "hub_arrived"].includes(status) || stage === "local_hub_ready") return { label: "Reached Local Hub · Delivery Job Ready", tone: "success", step: 5 };
  if (status === "hub_arrived_pending_receipt") return { label: "Arrived at Local Hub · Receipt Pending", tone: "warning", step: 4 };
  if (["hub_handoff_pending", "in_transit_to_hub"].includes(status) || stage === "hub_handoff_pending") return { label: "In Transit to Local Hub", tone: "info", step: 3 };
  if (["destination_warehouse_received", "received_at_destination"].includes(status)) return { label: "Destination Warehouse Received", tone: "success", step: 4 };
  if (status === "destination_warehouse_arrived_pending_receipt") return { label: "Arrived at Destination Warehouse · Receipt Pending", tone: "warning", step: 3 };
  if (["destination_warehouse_in_transit", "destination_warehouse_transfer_pending"].includes(status)) return { label: status === "destination_warehouse_in_transit" ? "In Transit to Destination Warehouse" : "Destination Transfer Planned / Awaiting Dispatch", tone: "info", step: 2 };
  if (order.deliveryPartnerId) return { label: "Final Delivery Partner Assigned", tone: "info", step: 5 };
  if (order.physicalReceiptConfirmed) return { label: "Received at Source Warehouse · Ready for Route", tone: "info", step: 1 };
  return { label: String(order.stage || order.orderStatus || "Transfer in progress").replace(/_/g, " "), tone: "secondary", step: 0 };
};

const progressSteps = ["Source receipt", "Transfer dispatched", "Destination receipt", "Local hub transfer", "Hub receipt", "Customer delivery"];

const routeFor = (order: any) => {
  const raw = String(order.routeCategory || order.farmerFulfillmentRouteType || "").toLowerCase();
  if (["nearby", "same_district", "inter_district", "route_review", "needs_location"].includes(raw)) return raw;
  const source = String(order.sourceDistrict || "").trim().toLowerCase();
  const destination = String(order.destinationDistrict || "").trim().toLowerCase();
  const distance = Number(order.routeDistanceKm);
  if (source && destination && source !== destination) return "inter_district";
  if (source && destination && source === destination && Number.isFinite(distance)) return distance > Number(order.nearbyThresholdKm ?? 15) ? "same_district" : (order.directDeliveryConfigured ? "nearby" : "route_review");
  return "other";
};

export default function CompletedFarmerFulfillmentPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["warehouseFarmerFulfillmentCompleted"],
    queryFn: () => api.get("/warehouse/me/farmer-fulfillment-transfers?include_completed=true"),
    refetchInterval: 30000,
  });
  const payload = data?.data?.transfers ?? data?.transfers;
  const orders: any[] = Array.isArray(payload) ? payload : [];
  const groups = routeGroups.map(group => ({
    ...group,
    orders: orders.filter(order => routeFor(order) === group.key),
  }));
  const total = groups.reduce((sum, group) => sum + group.orders.length, 0);

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-emerald-700">Farmer Fulfillment</p>
        <h1 className="text-3xl font-bold">Completed Fulfillment Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Read-only history grouped by the route section used for each order.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild><Link href="/warehouse/farmer-fulfillment"><ArrowLeft className="mr-2 h-4 w-4"/>Active Transfers</Link></Button>
        <Button variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
      </div>
    </div>

    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      {groups.map(group => <Card key={group.key}><CardContent className="p-4"><p className="text-xs leading-5 text-muted-foreground">{group.title}</p><p className="mt-1 text-2xl font-bold tabular-nums">{isLoading ? "—" : group.orders.length}</p></CardContent></Card>)}
    </div>

    {isLoading ? <div className="h-40 animate-pulse rounded-xl bg-muted"/> :
      isError || data?.success === false ? <Card className="border-red-200"><CardContent className="p-6"><p className="font-semibold">Unable to load completed orders</p><p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Check the backend connection and try again."}</p><Button className="mt-3" variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card> :
      total === 0 ? <Card className="border-dashed"><CardContent className="p-10 text-center"><CheckCircle2 className="mx-auto h-9 w-9 text-muted-foreground"/><p className="mt-3 font-semibold">No completed farmer fulfillment orders</p><p className="mt-1 text-sm text-muted-foreground">Orders will appear here after the backend records them as delivered or completed.</p></CardContent></Card> :
      <div className="space-y-6">
        {groups.filter(group => group.orders.length > 0).map(group => <section key={group.key} className="space-y-3">
          <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{group.title}</h2><Badge variant="secondary">{group.orders.length} orders</Badge></div>
          <div className="grid gap-3 xl:grid-cols-2">
            {group.orders.map((order: any) => {
              const lines = Array.isArray(order.incoming) && order.incoming.length ? order.incoming : (Array.isArray(order.items) ? order.items : []);
              return <Card key={order.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><CardTitle className="text-base">#{order.orderNumber || order.id}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{order.farmerName || "Farmer"} · {lines.length} line(s)</p></div>
                    {(() => { const progress = statusFor(order); return <Badge variant={progress.tone === "success" ? "success" : progress.tone === "warning" ? "outline" : "secondary"}>{progress.label}</Badge>; })()}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {order.sourceWarehouseName && <Badge variant="outline">Source: {order.sourceWarehouseName}</Badge>}
                    {order.destinationWarehouseName && <Badge variant="outline">Destination: {order.destinationWarehouseName}</Badge>}
                    {order.sourceDistrict && <Badge variant="secondary">From: {order.sourceDistrict}</Badge>}
                    {order.destinationDistrict && <Badge variant="secondary">To: {order.destinationDistrict}</Badge>}
                    {order.routeDistanceKm != null && <Badge variant="outline">{Number(order.routeDistanceKm).toFixed(1)} km</Badge>}
                  </div>
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock3 className="h-4 w-4"/>{statusFor(order).label}</div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {progressSteps.map((step: string, index: number) => {
                        const progress = statusFor(order).step;
                        const done = index < progress;
                        const current = index === progress;
                        return <div key={step} className="min-w-0">
                          <div className={`mb-1 h-1.5 rounded-full ${done ? "bg-emerald-500" : current ? "bg-blue-500" : "bg-slate-200"}`}/>
                          <p className={`text-[10px] leading-4 ${current ? "font-semibold text-slate-900" : "text-muted-foreground"}`}>{step}</p>
                        </div>;
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">{lines.map((line: any, index: number) => <Badge key={String(line.id || line.productId || line.productName || index)} variant="secondary">{line.productName || "Product"}: {line.receivedQuantity ?? line.expectedQuantity ?? line.quantity ?? 0} {line.unit || "kg"}</Badge>)}</div>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground"><PackageCheck className="h-4 w-4"/>Progress is based on recorded order and transfer statuses. Physical receipt is shown only after the receiving team confirms it.</p>
                </CardContent>
              </Card>;
            })}
          </div>
        </section>)}
      </div>
    }
  </div>;
}
