"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Clock3, Filter, Leaf, MapPin, Package, RefreshCw, Route, Search, Truck, Warehouse } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";

type Source = "farmer" | "warehouse";
type Stage = "to_receive" | "to_route" | "in_transfer" | "to_dispatch" | "delivered" | "review";
type RouteKey = "nearby" | "same_district" | "inter_district" | "multi_warehouse" | "needs_location" | "route_review";

const ROUTES: { key: RouteKey; label: string; description: string }[] = [
  { key: "nearby", label: "Nearby Direct Delivery", description: "Within the configured nearby threshold; no warehouse transfer." },
  { key: "same_district", label: "Same-District Route", description: "Same-district route through the designated local hub or warehouse, as required." },
  { key: "inter_district", label: "Inter-District Transfer", description: "Transfer to the destination district warehouse before final delivery." },
  { key: "multi_warehouse", label: "Multi-Warehouse Consolidation", description: "Order portions from multiple source warehouses must be consolidated." },
  { key: "route_review", label: "Route Review Required", description: "Route or operational prerequisites need staff review." },
  { key: "needs_location", label: "Needs Location Data", description: "Customer or warehouse location data is missing or incomplete." },
];

const norm = (value: any) => String(value ?? "").trim().toLowerCase().replace(/[\\s_-]+/g, "_");
const routeOf = (item: any): RouteKey => {
  const value = norm(item.routeCategory || item.farmerFulfillmentRouteType || item.warehouseRouteCategory);
  if (["nearby", "direct", "nearby_delivery"].includes(value)) return "nearby";
  if (["same_district", "local_hub", "same_district_warehouse"].includes(value)) return "same_district";
  if (["inter_district", "destination_warehouse", "warehouse_transfer"].includes(value)) return "inter_district";
  if (["multi_warehouse", "consolidation"].includes(value)) return "multi_warehouse";
  if (["needs_location", "location_missing"].includes(value) || item.routeDataComplete === false) return "needs_location";
  if (value === "route_review" || !value) return "route_review";
  return "route_review";
};

function farmerStage(item: any): Stage {
  const status = norm(item.status || item.fulfillmentStatus || item.currentStage);
  if (item.physicalReceiptConfirmed && item.routeDataComplete && ["destination_warehouse_in_transit", "consolidation_in_transit", "source_portion_in_transit", "hub_handoff_pending", "in_transit"].includes(status)) return "in_transfer";
  if (["destination_warehouse_in_transit", "consolidation_in_transit", "source_portion_in_transit", "hub_handoff_pending", "in_transit"].includes(status)) return "in_transfer";
  if (["dispatched", "local_hub_ready", "delivered", "completed"].includes(status)) return status === "delivered" || status === "completed" ? "delivered" : "to_dispatch";
  if (item.physicalReceiptConfirmed && item.routeDataComplete && item.currentWarehouseRole !== "assigned") return "to_route";
  if (item.routeCategory === "needs_location") return "review";
  return "to_receive";
}

function warehouseStage(item: any): Stage {
  const status = norm(item.status);
  if (["dispatched", "in_transit"].includes(status)) return "in_transfer";
  if (["delivered", "completed"].includes(status)) return "delivered";
  if (item.routeDataComplete === false || !item.routeCategory || ["needs_location", "route_review"].includes(norm(item.routeCategory))) return "review";
  if (["pending", "packed", "ready_for_dispatch"].includes(status)) return "to_route";
  return "to_dispatch";
}

const stageMeta: Record<Stage, { label: string; short: string }> = {
  to_receive: { label: "To Receive", short: "Awaiting physical receipt" },
  to_route: { label: "To Route", short: "Ready for route classification" },
  in_transfer: { label: "In Transfer", short: "Warehouse / delivery handoff underway" },
  to_dispatch: { label: "To Dispatch", short: "Ready for dispatch action" },
  delivered: { label: "Delivered", short: "Delivery completed" },
  review: { label: "Needs Review", short: "Resolve route or location issue" },
};

function warehouseName(item: any) {
  return item.destinationWarehouseName || item.destinationWarehouse?.name || item.assignedDestinationWarehouseName || item.consolidationWarehouseName || item.destinationDistrict || item.deliveryDistrict || item.customerDistrict || "Destination not assigned";
}

function readableOrderNumber(item: any, source: Source) {
  const candidates = [
    item.orderNumber,
    item.order?.orderNumber,
    item.sourceOrder?.orderNumber,
    item.source_order?.order_number,
    item.orderDetails?.orderNumber,
    item.order_number,
    item.referenceNumber,
    item.order?.order_number,
    item.sourceOrder?.order_number,
  ];
  const value = candidates.find((candidate) =>
    typeof candidate === "string" &&
    candidate.trim() &&
    !/^[a-f0-9]{24}$/i.test(candidate.trim()) &&
    !/^[a-f0-9-]{24,}$/i.test(candidate.trim())
  );
  if (value) return String(value).trim();

  // Keep database IDs for API operations, but never expose them as customer-
  // facing order references. Create a short, stable operational reference.
  const rawId = String(item.orderId || item.id || item._id || item.order?._id || item.order?.id || "");
  const suffix = rawId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  return suffix ? `${source === "farmer" ? "FARM" : "WH"}-${suffix}` : source === "farmer" ? "Farmer fulfillment order" : "Warehouse fulfillment order";
}

function normalizeFarmer(item: any) {
  const stage = farmerStage(item);
  return {
    ...item,
    id: String(item.id || item.orderId || item.orderNumber),
    orderId: String(item.orderId || item.id || ""),
    orderNumber: readableOrderNumber(item, "farmer"),
    source: "farmer" as Source,
    stage,
    route: routeOf(item),
    destinationGroup: warehouseName(item),
    customerName: item.customerName || item.customer?.name || item.businessName || "Customer details unavailable",
    district: item.destinationDistrict || item.deliveryDistrict || item.customerDistrict || item.customer?.district || "Location unavailable",
    itemSummary: item.productName || item.items?.map((x: any) => x.productName || x.name).filter(Boolean).join(", ") || "Order items",
    quantitySummary: item.totalQuantity != null ? String(item.totalQuantity) : item.quantity != null ? String(item.quantity) : "—",
    currentStatus: item.status || item.fulfillmentStatus || item.currentStage || "Awaiting receipt",
  };
}

function normalizeWarehouse(item: any) {
  const stage = warehouseStage(item);
  return {
    ...item,
    id: String(item.id || item.orderId || item.orderNumber),
    orderId: String(item.orderId || ""),
    orderNumber: readableOrderNumber(item, "warehouse"),
    source: "warehouse" as Source,
    stage,
    route: routeOf(item),
    destinationGroup: warehouseName(item),
    customerName: item.customerName || item.customer?.name || "Customer details unavailable",
    district: item.destinationDistrict || item.deliveryDistrict || item.customerDistrict || "Location unavailable",
    itemSummary: item.productName || item.items?.map((x: any) => x.productName || x.name).filter(Boolean).join(", ") || "Order items",
    quantitySummary: item.totalQuantity != null ? String(item.totalQuantity) : item.quantity != null ? String(item.quantity) : "—",
    currentStatus: item.status || "Ready for route review",
  };
}

export default function FulfillmentDispatchPage() {
  const [search, setSearch] = useState("");
  const [activeStage, setActiveStage] = useState<Stage | "all">("all");
  const [activeRoute, setActiveRoute] = useState<RouteKey | "all">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const farmerQuery = useQuery({
    queryKey: ["unifiedFarmerFulfillmentTransfers"],
    queryFn: () => api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval: 20000,
  });
  const outgoingQuery = useQuery({
    queryKey: ["unifiedWarehouseOutgoing"],
    queryFn: () => api.get("/warehouse/me/outgoing", { params: { limit: 100 } }),
    refetchInterval: 20000,
  });
  const consolidationQuery = useQuery({
    queryKey: ["unifiedFarmerConsolidations"],
    queryFn: () => api.get("/warehouse/me/farmer-fulfillment-consolidations"),
    refetchInterval: 30000,
  });

  const farmerRows = farmerQuery.data?.data?.transfers || farmerQuery.data?.transfers || [];
  const warehouseRows = outgoingQuery.data?.data?.outgoing || outgoingQuery.data?.outgoing || [];
  const orders = useMemo(() => {
    const farmer = farmerRows.map(normalizeFarmer);
    const warehouse = warehouseRows.map(normalizeWarehouse);
    const seen = new Set<string>();
    return [...farmer, ...warehouse].filter((row: any) => {
      const key = row.source + ":" + (row.id || row.orderNumber);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [farmerRows, warehouseRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((row: any) => {
      if (activeStage !== "all" && row.stage !== activeStage) return false;
      if (activeRoute !== "all" && row.route !== activeRoute) return false;
      if (!q) return true;
      return [row.orderNumber, row.orderId, row.customerName, row.district, row.destinationGroup, row.itemSummary, row.currentStatus].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [orders, search, activeStage, activeRoute]);

  const selectedRows = filtered.filter((row: any) => selectedIds.includes(row.source + ":" + row.id));
  const stageCounts = useMemo(() => Object.fromEntries((Object.keys(stageMeta) as Stage[]).map((stage) => [stage, orders.filter((row: any) => row.stage === stage).length])) as Record<Stage, number>, [orders]);
  const routeCounts = useMemo(() => Object.fromEntries(ROUTES.map((route) => [route.key, orders.filter((row: any) => row.route === route.key).length])) as Record<RouteKey, number>, [orders]);
  const operationGroups = useMemo(() => {
    const rows = selectedRows.length ? selectedRows : activeRoute === "all" ? [] : filtered;
    const grouped = new Map<RouteKey, any[]>();
    rows.forEach((row: any) => grouped.set(row.route, [...(grouped.get(row.route) || []), row]));
    return [...grouped.entries()];
  }, [selectedRows, activeRoute, filtered]);
  const toggleOrder = (key: string, checked: boolean) => setSelectedIds((current) => checked ? [...new Set([...current, key])] : current.filter((id) => id !== key));
  const toggleAllVisible = (checked: boolean) => setSelectedIds((current) => checked ? [...new Set([...current, ...filtered.map((row: any) => row.source + ":" + row.id)])] : current.filter((id) => !filtered.some((row: any) => row.source + ":" + row.id === id)));
  const routeOperations: Record<RouteKey, { title: string; intro: string; steps: string[]; farmerHref: string; warehouseHref: string; farmerAction: string; warehouseAction: string; actionHint: string; extraHref?: string; extraLabel?: string }> = {
    nearby: { title: "Nearby Direct Delivery", intro: "Direct customer delivery. No inter-warehouse transfer or local-hub handoff is required.", steps: ["Confirm the verified warehouse-to-customer distance is within the nearby limit", "Choose an eligible delivery partner and vehicle", "Assign the delivery job and start the trip", "Track the delivery and confirm customer handover"], farmerHref: "/warehouse/farmer-fulfillment", warehouseHref: "/outgoing", farmerAction: "Continue Farmer Direct Delivery", warehouseAction: "Assign Delivery Partner", actionHint: "Use the direct-delivery workflow. Do not create a warehouse transfer." },
    same_district: { title: "Same-District Delivery", intro: "Deliver within the same district using the configured local hub when the route requires it.", steps: ["Verify the destination district and assigned local hub", "Plan the source warehouse to local-hub route", "Assign a pickup / transfer team and confirm hub handover", "Assign the final-mile delivery partner and confirm delivery"], farmerHref: "/warehouse/farmer-fulfillment", warehouseHref: "/outgoing", farmerAction: "Continue Same-District Farmer Process", warehouseAction: "Plan Local-Hub Transfer", actionHint: "Complete the local-hub handoff before final-mile delivery whenever this route requires a hub." },
    inter_district: { title: "Inter-District Warehouse Transfer", intro: "Transfer the order to the destination-district warehouse before arranging final delivery.", steps: ["Verify the destination district and its assigned warehouse", "Assign a transfer team and dispatch from the source warehouse", "Track the transfer and confirm receipt at the destination warehouse", "Assign the final delivery partner after destination receipt"], farmerHref: "/warehouse/farmer-fulfillment", warehouseHref: "/outgoing", farmerAction: "Continue Farmer Warehouse Transfer", warehouseAction: "Assign Inter-District Transfer", actionHint: "Final delivery must remain unavailable until the destination warehouse confirms receipt." },
    multi_warehouse: { title: "Multi-Warehouse Consolidation", intro: "Collect all portions from their source warehouses and reconcile them at the consolidation warehouse.", steps: ["Review each source warehouse portion and quantity", "Assign / track transfers for every portion", "Confirm all portions are received and reconcile quantities", "Complete consolidation, then continue to hub or final delivery"], farmerHref: "/warehouse/farmer-fulfillment", warehouseHref: "/outgoing", farmerAction: "Continue Farmer Consolidation Process", warehouseAction: "Open Consolidation Workspace", actionHint: "Do not dispatch the complete customer order until every required portion is received and consolidated.", extraHref: "/warehouse/consolidation", extraLabel: "Open Consolidation Workspace" },
    needs_location: { title: "Needs Location Data", intro: "This route cannot be processed until the customer or warehouse location is corrected.", steps: ["Review the customer delivery address", "Verify source and destination warehouse locations", "Correct missing district / address / GPS information", "Refresh route classification before assigning transfer or delivery"], farmerHref: "/warehouse/farmer-fulfillment", warehouseHref: "/outgoing", farmerAction: "Review Farmer Order Location", warehouseAction: "Review Warehouse Order Location", actionHint: "Transfer and delivery actions are blocked until the required location data is complete." },
    route_review: { title: "Route Review Required", intro: "Operational route prerequisites need review before this order can be transferred or delivered.", steps: ["Review the route classification and verified distance", "Confirm the correct destination warehouse or local hub", "Resolve route configuration or assignment issues", "Refresh the order and continue with its newly approved route"], farmerHref: "/warehouse/farmer-fulfillment", warehouseHref: "/outgoing", farmerAction: "Review Farmer Fulfillment Route", warehouseAction: "Review Warehouse Delivery Route", actionHint: "Do not dispatch an order while route review is pending." },
  };
  const refresh = async () => {
    await Promise.all([farmerQuery.refetch(), outgoingQuery.refetch(), consolidationQuery.refetch()]);
  };
  const isLoading = farmerQuery.isLoading || outgoingQuery.isLoading;
  const hasError = farmerQuery.isError && outgoingQuery.isError;

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4 pb-8">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Truck className="h-6 w-6"/></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Fulfillment &amp; Dispatch</h1>
            <p className="mt-1 text-sm text-slate-600">Manage warehouse transfers and customer deliveries by route group.</p>
            <p className="mt-1 text-xs text-slate-500">Select a route group, choose orders, then follow the route-specific workflow.</p>
          </div>
        </div>
        <Button variant="outline" onClick={refresh} disabled={farmerQuery.isFetching || outgoingQuery.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${farmerQuery.isFetching || outgoingQuery.isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card><CardContent className="p-3"><p className="text-xs text-slate-500">All Orders</p><p className="mt-1 text-2xl font-bold">{orders.length}</p></CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50/50"><CardContent className="p-3"><p className="text-xs text-emerald-800">Ready for Transfer / Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts.to_route}</p></CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/50"><CardContent className="p-3"><p className="text-xs text-blue-800">Transfer in Progress</p><p className="mt-1 text-2xl font-bold">{stageCounts.in_transfer}</p></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/50"><CardContent className="p-3"><p className="text-xs text-amber-800">Ready for Final Delivery</p><p className="mt-1 text-2xl font-bold">{stageCounts.to_dispatch}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-slate-500">Delivered</p><p className="mt-1 text-2xl font-bold">{stageCounts.delivered}</p></CardContent></Card>
        <Card className="border-red-200 bg-red-50/50"><CardContent className="p-3"><p className="text-xs text-red-800">Needs Attention</p><p className="mt-1 text-2xl font-bold">{stageCounts.review}</p></CardContent></Card>
      </div>

      {hasError && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-800">Could not load fulfillment orders. Refresh the page or check warehouse access.</CardContent></Card>}
      {isLoading ? <Card><CardContent className="p-10 text-center text-sm text-slate-500">Loading fulfillment orders…</CardContent></Card> : (
        <div className="grid w-full min-w-0 grid-cols-[minmax(220px,0.82fr)_minmax(0,1.85fr)_minmax(280px,0.98fr)] items-stretch gap-3 2xl:gap-4 max-[767px]:grid-cols-1">
          <Card className="min-w-0 w-full overflow-hidden min-h-[650px]">
            <CardContent className="h-full space-y-3 overflow-y-auto p-4">
              <div><div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold text-slate-900">Route Groups</h2><Badge variant="outline">{orders.length} orders</Badge></div><p className="mt-1 text-xs text-slate-500">Choose a route to see its orders and process.</p></div>
              <button type="button" onClick={() => {setActiveRoute("all");setSelectedIds([]);}} className={`w-full rounded-xl border p-3 text-left transition-colors ${activeRoute === "all" ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100" : "border-slate-200 hover:border-emerald-200"}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-800">All Route Groups</span><Badge variant="secondary">{orders.length}</Badge></div><p className="mt-1 text-xs text-slate-500">View every transfer and delivery order.</p>
              </button>
              {ROUTES.map((route) => <button key={route.key} type="button" onClick={() => {setActiveRoute(route.key);setSelectedIds([]);}} className={`w-full rounded-xl border p-3 text-left transition-colors ${activeRoute === route.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100" : "border-slate-200 bg-white hover:border-emerald-200"}`}>
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-800">{route.label}</span><Badge variant="secondary">{routeCounts[route.key]}</Badge></div><p className="mt-1 text-xs text-slate-500">{route.description}</p>
              </button>)}
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-slate-900">Orders ({filtered.length})</h2>{activeRoute !== "all" && <Badge variant="outline">{ROUTES.find((x) => x.key === activeRoute)?.label}</Badge>}</div><p className="mt-1 text-xs text-slate-500">Select one or more orders to load the matching route operations.</p></div>
                <div className="flex min-w-0 items-center gap-2"><div className="relative min-w-0 flex-1 sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, customer, product..." className="pl-9"/></div><Button variant="outline" size="sm" onClick={() => {setSearch("");setSelectedIds([]);}}>Clear</Button></div>
              </div>
              {filtered.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center"><Package className="mx-auto h-9 w-9 text-slate-300"/><p className="mt-2 font-semibold text-slate-700">No orders in this route group</p><p className="mt-1 text-xs text-slate-500">Choose another route group or clear the search.</p></div> : (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                      <th className="w-10 px-3 py-3"><input aria-label="Select all visible orders" type="checkbox" checked={filtered.length > 0 && filtered.every((row: any) => selectedIds.includes(row.source + ":" + row.id))} onChange={(e) => toggleAllVisible(e.target.checked)} className="h-4 w-4 accent-emerald-600"/></th>
                      <th className="px-3 py-3">Order ID</th><th className="px-3 py-3">Customer / Buyer</th><th className="px-3 py-3">Products</th><th className="px-3 py-3">Quantity</th><th className="px-3 py-3">Route Type</th><th className="px-3 py-3">Status</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map((row: any) => {
                        const key = row.source + ":" + row.id;
                        const checked = selectedIds.includes(key);
                        return <tr key={key} className={checked ? "bg-emerald-50/70" : "bg-white hover:bg-slate-50"}>
                          <td className="px-3 py-3"><input aria-label={`Select order ${row.orderNumber}`} type="checkbox" checked={checked} onChange={(e) => toggleOrder(key, e.target.checked)} className="h-4 w-4 accent-emerald-600"/></td>
                          <td className="whitespace-nowrap px-3 py-3 font-semibold text-emerald-900">{row.orderNumber}</td>
                          <td className="px-3 py-3">{row.customerName}</td><td className="px-3 py-3">{row.itemSummary}</td><td className="whitespace-nowrap px-3 py-3">{row.quantitySummary}</td>
                          <td className="px-3 py-3 align-middle">
                            <span className={`inline-flex max-w-[132px] items-center rounded-lg border px-2.5 py-1 text-[11px] font-semibold leading-4 whitespace-normal ${row.route === "nearby" || row.route === "same_district" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : row.route === "inter_district" || row.route === "multi_warehouse" ? "border-violet-200 bg-violet-50 text-violet-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                              {({ nearby: "Nearby Delivery", same_district: "Same-District", inter_district: "Inter-District Transfer", multi_warehouse: "Multi-Warehouse", needs_location: "Location Needed", route_review: "Route Review" } as Record<RouteKey, string>)[row.route]}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-middle">
                            <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] font-semibold leading-4 whitespace-nowrap ${row.stage === "in_transfer" ? "border-blue-200 bg-blue-50 text-blue-800" : row.stage === "delivered" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : row.stage === "review" ? "border-amber-200 bg-amber-50 text-amber-800" : row.stage === "to_dispatch" ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                              {stageMeta[row.stage as Stage].label}
                            </span>
                          </td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-slate-500"><span>{selectedRows.length} order(s) selected</span><span>Showing {filtered.length} order(s)</span></div>
            </CardContent>
          </Card>

          <Card className="min-w-0 w-full overflow-hidden min-h-[650px]">
            <CardContent className="h-full space-y-4 p-4">
              <div className="flex items-center justify-between gap-2"><div><h2 className="text-lg font-bold text-slate-900">Operations</h2><p className="mt-1 text-xs text-slate-500">Actions change according to the selected route group.</p></div><Badge variant="outline">{selectedRows.length || (activeRoute === "all" ? "—" : filtered.length)} {selectedRows.length ? "selected" : "orders"}</Badge></div>
              {operationGroups.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center"><Truck className="mx-auto h-10 w-10 text-slate-300"/><p className="mt-2 font-semibold text-slate-800">Choose a route group</p><p className="mt-1 text-xs text-slate-500">Select a route on the left, then select its orders in the middle. The matching workflow will appear here.</p></div> : operationGroups.map(([routeKey, rows]) => {
                const config = routeOperations[routeKey];
                const sources = [...new Set(rows.map((row: any) => row.source))] as Source[];
                return <div key={routeKey} className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <div><h3 className="font-semibold text-slate-900">{config.title}</h3><p className="mt-1 text-xs text-slate-500">{rows.length} selected order(s) · {config.intro}</p></div>
                  <div className="space-y-2">{config.steps.map((step, index) => <div key={step} className="flex items-start gap-2 text-xs text-slate-700"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-800">{index + 1}</span><span>{step}</span></div>)}</div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Orders in this process</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {rows.slice(0, 6).map((row: any) => <Badge key={row.source + ":" + row.id} variant="outline">{row.orderNumber}</Badge>)}
                      {rows.length > 6 && <Badge variant="secondary">+{rows.length - 6} more</Badge>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                    <p className="text-xs font-semibold text-emerald-900">Route-specific instruction</p>
                    <p className="mt-1 text-xs leading-5 text-emerald-900/80">{config.actionHint}</p>
                  </div>
                  <div className="space-y-2 border-t pt-3">
                    {sources.includes("farmer") && <Button asChild className="w-full"><Link href={config.farmerHref}>{config.farmerAction} <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>}
                    {sources.includes("warehouse") && <Button asChild variant={sources.includes("farmer") ? "outline" : "default"} className="w-full"><Link href={config.warehouseHref}>{config.warehouseAction} <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>}
                    {routeKey === "multi_warehouse" && config.extraHref && <Button asChild variant="outline" className="w-full"><Link href={config.extraHref}>{config.extraLabel} <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>}
                    {(routeKey === "needs_location" || routeKey === "route_review") && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Processing is intentionally blocked for this route group until its prerequisites are resolved.</div>}
                  </div>
                  <p className="text-[11px] text-slate-500">Each route group opens its dedicated existing workflow. Existing API validation, transfer receipt checks and delivery status transitions remain in control.</p>
                </div>;
              })}
              {selectedRows.length > 0 && <Button variant="ghost" size="sm" className="w-full" onClick={() => setSelectedIds([])}>Clear selected orders</Button>}
            </CardContent>
          </Card>
        </div>
      )}
      <p className="text-xs text-slate-500">Route-specific processes are opened in their existing Farmer Fulfillment, Outgoing / Dispatch and Consolidation workspaces so current API validations and status transitions remain intact.</p>
    </div>
  );
}
