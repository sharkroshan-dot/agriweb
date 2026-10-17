"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw, Clock3, AlertCircle, Send, MapPin, Warehouse, Route, Truck, PackageCheck, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

type RouteKey = "nearby" | "same_district" | "inter_district" | "multi_warehouse" | "route_review" | "needs_location" | "farmer_fulfillment_transfer";
const ROUTES: { key: RouteKey; title: string; subtitle: string; next: string }[] = [
  { key: "nearby", title: "Nearby Delivery", subtitle: "Within 15 km and direct delivery explicitly configured", next: "Warehouse → Delivery Partner → Customer" },
  { key: "same_district", title: "Same-District Warehouse Fulfillment", subtitle: "Beyond 15 km, source and customer in the same district", next: "Warehouse → Local Hub → Delivery Partner → Customer" },
  { key: "inter_district", title: "Inter-District Warehouse Fulfillment", subtitle: "Different source and destination districts", next: "Source Warehouse → Destination Warehouse → Local Hub → Delivery Partner → Customer" },
  { key: "multi_warehouse", title: "Multi-Warehouse Consolidation", subtitle: "Orders that require multiple source warehouses", next: "Source Warehouses → Consolidation → Local Hub → Delivery Partner → Customer" },
  { key: "route_review", title: "Route Review Required", subtitle: "Direct delivery is not configured or the route needs review", next: "Resolve route configuration before dispatch" },
  { key: "needs_location", title: "Needs Location Data", subtitle: "Missing coordinates or district details", next: "Complete location data before dispatch" },
  { key: "farmer_fulfillment_transfer", title: "Farmer Fulfillment Transfers", subtitle: "Farmer-packed orders belong to the dedicated transfer workflow", next: "Continue in Farmer Fulfillment Transfers" },
];
const categoryOf = (item: any): RouteKey => {
  const category = String(item?.routeCategory || item?.farmerFulfillmentRouteType || item?.warehouseRouteCategory || "needs_location");
  return (ROUTES.some((r) => r.key === category) ? category : "needs_location") as RouteKey;
};
const routeReady = (item: any) => ["nearby", "same_district", "inter_district", "multi_warehouse"].includes(categoryOf(item)) && item?.routeDataComplete !== false && item?.routeDistanceKm != null;
const statusLabel = (status: string) => status === "pending" ? "Ready for Dispatch" : status === "packed" ? "Packed" : status === "dispatched" ? "Dispatched" : status || "Unknown";

export default function WarehouseOutgoingPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeSection, setActiveSection] = useState<RouteKey>("nearby");
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["warehouseOutgoing", statusFilter],
    queryFn: () => api.get("/warehouse/me/outgoing", { params: { status: statusFilter !== "all" ? statusFilter : undefined, limit: 100 } }),
    refetchInterval: 20000,
  });
  const allOutgoing = data?.data?.outgoing || [];
  const outgoing = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allOutgoing.filter((item: any) => !q || [item.orderId, item.productId, item.productName, item.batchNumber, item.deliveryPartnerId, item.sourceDistrict, item.destinationDistrict].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [allOutgoing, searchTerm]);
  const grouped = useMemo(() => Object.fromEntries(ROUTES.map((r) => [r.key, outgoing.filter((item: any) => categoryOf(item) === r.key)])) as Record<RouteKey, any[]>, [outgoing]);
  const readyCount = outgoing.filter((item: any) => ["pending", "packed"].includes(String(item.status)) && routeReady(item)).length;

  const processSection = async (section: RouteKey) => {
    const rows = grouped[section] || [];
    if (!rows.length) { toast("There are no orders in this section to process."); return; }
    if (section === "farmer_fulfillment_transfer") { window.location.href = "/farmer-fulfillment"; return; }
    if (section === "route_review" || section === "needs_location") { toast.error("These orders require route/location correction before dispatch. No orders were dispatched."); return; }
    if (section === "multi_warehouse") { window.location.href = "/warehouse/consolidation"; return; }
    const eligible = rows.filter((item: any) => ["pending", "packed"].includes(String(item.status)) && routeReady(item));
    if (!eligible.length) { toast.error("No eligible ready-to-dispatch orders in this section."); return; }
    let succeeded = 0; const failed: string[] = [];
    for (const item of eligible) {
      try {
        if (!item.orderId) throw new Error("Missing customer order");
        const response = await api.get("/warehouse/me/orders/" + item.orderId + "/fulfillment-check");
        const audit = response?.data || response;
        if (!audit?.readyForDispatch) throw new Error("Packing not verified");
        if (section === "inter_district") {
          await api.post("/warehouse/me/outgoing/" + item.id + "/inter-district-dispatch");
          succeeded += 1;
          continue;
        }
        const route = section === "nearby" ? "nearby" : "long_distance";
        await api.post("/warehouse/me/outgoing/" + item.id + "/delivery-route", { route, radius: item.nearbyThresholdKm ?? 15 });
        await api.put("/warehouse/me/outgoing/" + item.id + "/status", undefined, { params: { status: "dispatched" } });
        await api.post("/warehouse/me/outgoing/" + item.id + "/delivery-route", { route, radius: item.nearbyThresholdKm ?? 15 });
        succeeded += 1;
      } catch (e: any) { failed.push(String(item.orderNumber || item.orderId || item.id) + (e?.message ? ": " + e.message : "")); }
    }
    if (succeeded) toast.success("Processed " + succeeded + " order(s) in " + (ROUTES.find((r) => r.key === section)?.title || section) + ".");
    if (failed.length) toast.error(failed.length + " order(s) could not be processed. " + failed.slice(0, 2).join("; "));
    await refetch();
  };
  const processDispatch = async (item: any) => {
    const category = categoryOf(item);
    try {
      if (!routeReady(item)) throw new Error("Route review required. Add complete location and district data before dispatch.");
      if (!item.orderId) throw new Error("This shipment is not linked to a customer order.");
      const auditResponse = await api.get(`/warehouse/me/orders/${item.orderId}/fulfillment-check`);
      const audit = auditResponse?.data || auditResponse;
      if (!audit?.readyForDispatch) throw new Error("Packing verification is incomplete. Verify packed quantities before dispatch.");

      if (category === "nearby" || category === "same_district") {
        // Existing warehouse routing supports direct delivery or a controlled
        // local-hub handoff. The long-distance route keeps partner assignment
        // gated until the hub confirms receipt.
        const route = category === "nearby" ? "nearby" : "long_distance";
        await api.post(`/warehouse/me/outgoing/${item.id}/delivery-route`, { route, radius: item.nearbyThresholdKm ?? 15 });
        await api.put(`/warehouse/me/outgoing/${item.id}/status`, undefined, { params: { status: "dispatched" } });
        await api.post(`/warehouse/me/outgoing/${item.id}/delivery-route`, { route, radius: item.nearbyThresholdKm ?? 15 });
        toast.success(category === "nearby"
          ? "Shipment dispatched to the direct-delivery workflow."
          : "Shipment dispatched into the local-hub handoff workflow. Confirm hub receipt before final-mile assignment.");
        await refetch();
        return;
      }
      if (category === "inter_district") {
        const result = await api.post(`/warehouse/me/outgoing/${item.id}/inter-district-dispatch`);
        const transfer = result?.data?.data || result?.data || {};
        toast.success(`Dispatched to ${transfer.destinationWarehouseName || "destination warehouse"} in ${transfer.destinationDistrict || item.destinationDistrict}. Transfer team: ${transfer.transferTeamName || "assigned"}. Confirm physical receipt at the destination warehouse to continue to the local hub.`);
        await refetch();
        return;
      }
      if (category === "multi_warehouse") {
        window.location.href = "/warehouse/consolidation";
        return;
      }
      throw new Error("This shipment must be resolved in Route Review before dispatch.");
    } catch (e: any) { toast.error(e?.message || "Could not process shipment"); }
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div><h1 className="text-3xl font-bold">Outgoing / Dispatch</h1><p className="mt-1 text-sm text-muted-foreground">Packing verified → automatic 15 km route decision → transfer and delivery handoff.</p></div>
      <Button variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}/>Refresh Orders</Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Total Shipments</span><PackageCheck className="h-5 w-5 text-muted-foreground"/></div><p className="mt-2 text-2xl font-bold">{outgoing.length}</p></CardContent></Card>
      <Card><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Ready for Dispatch</span><Send className="h-5 w-5 text-muted-foreground"/></div><p className="mt-2 text-2xl font-bold">{outgoing.filter((x: any) => ["pending","packed"].includes(String(x.status))).length}</p></CardContent></Card>
      <Card><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Route Review</span><AlertCircle className="h-5 w-5 text-amber-600"/></div><p className="mt-2 text-2xl font-bold">{grouped.route_review.length + grouped.needs_location.length}</p></CardContent></Card>
      <Card><CardContent className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Dispatched</span><CheckCircle2 className="h-5 w-5 text-emerald-600"/></div><p className="mt-2 text-2xl font-bold">{outgoing.filter((x: any) => x.status === "dispatched").length}</p></CardContent></Card>
    </div>

    <Card className="border-slate-200"><CardContent className="flex gap-3 p-4"><Route className="mt-0.5 h-5 w-5 shrink-0 text-slate-600"/><div className="text-sm"><p className="font-semibold">Automatic route classification</p><p className="mt-1 text-muted-foreground">The backend classifies shipments using source location, customer destination, district, configured direct-delivery eligibility, and a 15 km default threshold. Orders with missing route data remain in review. Farmer Fulfillment orders stay in their separate transfer workflow to prevent duplicate dispatch.</p></div></CardContent></Card>

    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input className="pl-9" placeholder="Search order, product, district, partner…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/></div><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Filter status"/></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="pending">Ready for Dispatch</SelectItem><SelectItem value="packed">Packed</SelectItem><SelectItem value="dispatched">Dispatched</SelectItem></SelectContent></Select></div>

    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {ROUTES.map((route) => <button key={route.key} type="button" onClick={() => setActiveSection(route.key)} className={`rounded-lg border p-4 text-left transition-colors ${activeSection === route.key ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "hover:bg-muted/50"}`}>
        <div className="flex items-start justify-between gap-2"><span className="font-semibold">{route.title}</span><Badge variant={activeSection === route.key ? "default" : "outline"}>{grouped[route.key].length}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{route.subtitle}</p>
      </button>)}
    </div>

    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-lg bg-muted p-2"><Warehouse className="h-5 w-5"/></div><div><h2 className="text-xl font-semibold">{ROUTES.find((r) => r.key === activeSection)?.title}</h2><p className="mt-1 text-sm text-muted-foreground">{ROUTES.find((r) => r.key === activeSection)?.next}</p><p className="mt-1 text-xs text-muted-foreground">{grouped[activeSection].length} order(s) · {grouped[activeSection].filter((item: any) => ["pending","packed"].includes(String(item.status))).length} awaiting dispatch</p></div></div><Button onClick={() => processSection(activeSection)} disabled={isLoading || grouped[activeSection].length === 0} className="shrink-0"><Send className="mr-2 h-4 w-4"/>{activeSection === "route_review" || activeSection === "needs_location" ? "Review Section Orders" : activeSection === "farmer_fulfillment_transfer" ? "Open Transfer Workflow" : activeSection === "multi_warehouse" ? "Process Consolidation Orders" : "Process All " + (ROUTES.find((r) => r.key === activeSection)?.title || "Orders")}</Button></div>

    {isLoading ? <div className="space-y-3">{[1,2,3].map((n) => <div key={n} className="h-28 animate-pulse rounded-lg bg-muted"/>)}</div> : grouped[activeSection].length === 0 ? <Card><CardContent className="p-10 text-center"><MapPin className="mx-auto h-10 w-10 text-muted-foreground"/><h3 className="mt-3 font-semibold">No shipments in this section</h3><p className="mt-1 text-sm text-muted-foreground">Shipments appear here after the relevant packing, location, and routing prerequisites are satisfied.</p></CardContent></Card> : <div className="space-y-3">{grouped[activeSection].map((item: any) => <Card key={item.id}><CardContent className="space-y-4 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.orderNumber || item.orderId || "Dispatch order"}</h3><Badge className={item.status === "dispatched" ? "bg-emerald-100 text-emerald-800" : item.status === "packed" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}>{statusLabel(item.status)}</Badge><Badge variant="outline">{ROUTES.find((r) => r.key === activeSection)?.title}</Badge></div>
        <p className="mt-2 text-sm text-muted-foreground">{item.productName || item.productId || "Order package"} · {item.quantity ?? 0} units</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Routing distance</p><p className="mt-1 font-medium">{item.routeDistanceKm == null ? "Not calculated" : `${Number(item.routeDistanceKm).toFixed(1)} km`}</p><p className="text-xs text-muted-foreground">Threshold: {item.nearbyThresholdKm ?? 15} km</p></div>
          <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Source district</p><p className="mt-1 font-medium">{item.sourceDistrict || "Missing"}</p></div>
          <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Delivery district</p><p className="mt-1 font-medium">{item.destinationDistrict || "Missing"}</p></div>
          <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Delivery partner</p><p className="mt-1 font-medium">{item.deliveryPartnerId || "Not assigned"}</p></div>
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4"/>{item.dispatchDate ? new Date(item.dispatchDate).toLocaleString() : "Not dispatched yet"}</p>
        {!routeReady(item) && <div className="mt-3 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertCircle className="h-4 w-4 shrink-0"/><span>{item.routeDecisionReason || "Route data is incomplete. Add valid source/customer coordinates and district data before dispatch."} Dispatch is blocked.</span></div>}
      </div>
      <div className="flex min-w-[220px] flex-col gap-2 lg:items-end">
        {activeSection === "nearby" && ["pending","packed"].includes(String(item.status)) && <Button disabled={!routeReady(item)} onClick={() => processDispatch(item)}><Send className="mr-2 h-4 w-4"/>Verify & Dispatch to Partner</Button>}
        {activeSection === "same_district" && <div className="rounded-md border p-3 text-sm"><p className="font-semibold">Local hub transfer</p><p className="mt-1 text-xs text-muted-foreground">Dispatch the sealed shipment to the hub, confirm physical receipt, then assign final-mile delivery.</p><Button className="mt-3 w-full" disabled={!routeReady(item) || !["pending","packed"].includes(String(item.status))} onClick={() => processDispatch(item)}><Send className="mr-2 h-4 w-4"/>Start Local Hub Transfer</Button></div>}
        {activeSection === "inter_district" && <div className="rounded-md border p-3 text-sm"><p className="font-semibold">Destination warehouse transfer</p><p className="mt-1 text-xs text-muted-foreground">Assign a destination warehouse and transfer team, then confirm receipt and continue to the local hub.</p><Button className="mt-3 w-full" variant="outline" disabled={!routeReady(item)} onClick={() => processDispatch(item)}><Warehouse className="mr-2 h-4 w-4"/>Process Destination Transfer</Button></div>}
        {activeSection === "multi_warehouse" && <div className="rounded-md border p-3 text-sm"><p className="font-semibold">Consolidation required</p><p className="mt-1 text-xs text-muted-foreground">Receive all source portions before the local-hub handoff.</p><Button className="mt-3 w-full" variant="outline" onClick={() => { window.location.href = "/warehouse/consolidation"; }}><Warehouse className="mr-2 h-4 w-4"/>Open Consolidation</Button></div>}
        {activeSection === "farmer_fulfillment_transfer" && <Button variant="outline" onClick={() => { window.location.href = "/farmer-fulfillment"; }}>Open Farmer Fulfillment Transfers</Button>}
        {item.status === "dispatched" && <Badge className="bg-emerald-100 text-emerald-800"><Truck className="mr-1 h-3 w-3"/>Dispatched</Badge>}
      </div></div>
    </CardContent></Card>)}</div>}
  </div>;
}
