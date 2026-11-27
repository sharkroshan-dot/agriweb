"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, Clock3, Filter, Info, Leaf, MapPin, MousePointer2, Package, RefreshCw, Route, Search, Truck, Warehouse } from "lucide-react";
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
  const [workflowFrame, setWorkflowFrame] = useState<{ href: string; title: string } | null>(null);
  const [activeSource, setActiveSource] = useState<Source | "all">("all");
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
      if (activeSource !== "all" && row.source !== activeSource) return false;
      if (activeStage !== "all" && row.stage !== activeStage) return false;
      if (activeRoute !== "all" && row.route !== activeRoute) return false;
      if (!q) return true;
      return [row.orderNumber, row.orderId, row.customerName, row.district, row.destinationGroup, row.itemSummary, row.currentStatus].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [orders, search, activeStage, activeRoute, activeSource]);

  const selectedRows = filtered.filter((row: any) => selectedIds.includes(row.source + ":" + row.id));
  const stageCounts = useMemo(() => Object.fromEntries((Object.keys(stageMeta) as Stage[]).map((stage) => [stage, orders.filter((row: any) => row.stage === stage).length])) as Record<Stage, number>, [orders]);
  const farmerOrderCount = orders.filter((row: any) => row.source === "farmer").length;
  const warehouseOrderCount = orders.filter((row: any) => row.source === "warehouse").length;
  const farmerShare = orders.length ? Math.round((farmerOrderCount / orders.length) * 100) : 0;
  const warehouseShare = orders.length ? Math.round((warehouseOrderCount / orders.length) * 100) : 0;
  const routeCounts = useMemo(() => Object.fromEntries(ROUTES.map((route) => [route.key, orders.filter((row: any) => row.route === route.key).length])) as Record<RouteKey, number>, [orders]);
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
  const selectedRouteKeys = [...new Set(selectedRows.map((row: any) => row.route))] as RouteKey[];
  const selectedSources = [...new Set(selectedRows.map((row: any) => row.source))] as Source[];
  const selectedRouteKey = selectedRouteKeys.length === 1 ? selectedRouteKeys[0] : null;
  const selectedSource = selectedSources.length === 1 ? selectedSources[0] : null;
  const selectedRouteConfig = selectedRouteKey ? routeOperations[selectedRouteKey] : null;
  const selectedDestinations = [...new Set(selectedRows.map((row: any) => row.destinationGroup).filter((value: string) => value && value !== "Destination not assigned"))];
  const quantityParts = selectedRows.map((row: any) => String(row.quantitySummary || "").trim().match(/^([\d,.]+)\s*(.*)$/));
  const quantityUnits = [...new Set(quantityParts.filter(Boolean).map((part: any) => String(part[2] || "").trim()).filter(Boolean))];
  const totalQuantity = quantityParts.length && quantityParts.every(Boolean) && quantityUnits.length <= 1
    ? `${quantityParts.reduce((sum: number, part: any) => sum + Number(String(part[1]).replace(/,/g, "")), 0).toLocaleString()} ${quantityUnits[0] || ""}`.trim()
    : "See individual orders";
  const selectedStages = [...new Set(selectedRows.map((row: any) => row.stage))] as Stage[];
  const selectedStatus = selectedStages.length === 1 ? stageMeta[selectedStages[0]].label : selectedStages.length ? "Mixed statuses" : "No selection";
  const nextOperation = !selectedRows.length ? "Select orders to see the next operation" : selectedStages.length !== 1 ? "Selected orders have different workflow stages" : selectedStages[0] === "to_receive" ? "Confirm physical warehouse receipt" : selectedStages[0] === "in_transfer" ? "Track transfer and confirm destination receipt" : selectedStages[0] === "to_dispatch" ? "Assign delivery partner and dispatch" : selectedStages[0] === "delivered" ? "Delivery completed" : selectedStages[0] === "review" ? "Resolve route prerequisites" : selectedRouteKey === "nearby" ? "Assign delivery partner" : selectedRouteKey === "same_district" ? "Continue same-district delivery" : selectedRouteKey === "inter_district" ? "Dispatch to destination warehouse" : selectedRouteKey === "multi_warehouse" ? "Complete warehouse consolidation" : "Review route details";
  const blockedSelection = selectedRows.some((row: any) => row.route === "needs_location" || row.route === "route_review");
  const completedSelection = selectedRows.some((row: any) => row.stage === "delivered");
  const canProcessSelection = selectedRows.length > 0 && selectedRouteKeys.length === 1 && selectedSources.length === 1 && selectedStages.length === 1 && !blockedSelection && !completedSelection;
  const processSelectedOrders = () => {
    if (!canProcessSelection || !selectedRouteKey || !selectedSource || !selectedRouteConfig) return;
    const href = selectedSource === "farmer" ? selectedRouteConfig.farmerHref : selectedRouteConfig.warehouseHref;
    setWorkflowFrame({ href, title: (selectedSource === "farmer" ? "Farmer Fulfillment" : "Warehouse Outgoing / Dispatch") + " · " + selectedRouteConfig.title });
  };
  const refresh = async () => {
    await Promise.all([farmerQuery.refetch(), outgoingQuery.refetch(), consolidationQuery.refetch()]);
  };
  const isLoading = farmerQuery.isLoading || outgoingQuery.isLoading;
  const hasError = farmerQuery.isError && outgoingQuery.isError;

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4 pb-8">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Truck className="h-7 w-7"/></div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">Fulfillment &amp; Dispatch</h1>
              <p className="mt-1 text-sm text-slate-600">Manage farmer fulfillment, warehouse transfers and customer deliveries.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={refresh} disabled={farmerQuery.isFetching || outgoingQuery.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${farmerQuery.isFetching || outgoingQuery.isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
            <Button onClick={() => setWorkflowFrame({href:"/warehouse/consolidation",title:"Consolidation Workspace"})}>Consolidation workspace <ArrowRight className="ml-2 h-4 w-4"/></Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setActiveSource("farmer")} variant={activeSource === "farmer" ? "default" : "outline"} className="min-w-[230px]"><Leaf className="mr-2 h-4 w-4"/>Farmer Fulfillment Workflow</Button>
          <Button onClick={() => setActiveSource("warehouse")} variant={activeSource === "warehouse" ? "default" : "outline"} className="min-w-[260px]"><Warehouse className="mr-2 h-4 w-4"/>Warehouse Outgoing / Dispatch Workflow</Button>
          <Button variant="outline" className="sm:ml-auto" onClick={() => setWorkflowFrame({href:"/warehouse/farmer-fulfillment",title:"Workflow Guide"})}><CheckCircle2 className="mr-2 h-4 w-4"/>Workflow Guide</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
        <Card className="border-slate-200 bg-white shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-emerald-50 p-2.5 text-emerald-700"><Package className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-600">All Orders</p><p className="mt-1 text-2xl font-bold leading-none text-slate-950">{orders.length}</p><p className="mt-1 text-[11px] text-slate-500">Both sources</p></div></CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50/70 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Leaf className="h-5 w-5"/></div><div><p className="text-xs font-medium text-emerald-900">Farmer Orders</p><p className="mt-1 text-2xl font-bold leading-none text-slate-950">{farmerOrderCount}</p><p className="mt-1 text-[11px] text-emerald-800">Farmer-packed · {farmerShare}%</p></div></CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/70 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><Warehouse className="h-5 w-5"/></div><div><p className="text-xs font-medium text-blue-900">Warehouse Orders</p><p className="mt-1 text-2xl font-bold leading-none text-slate-950">{warehouseOrderCount}</p><p className="mt-1 text-[11px] text-blue-800">Warehouse-packed · {warehouseShare}%</p></div></CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50/40 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-emerald-100 p-2.5 text-emerald-700"><Package className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-600">Ready for Transfer / Delivery</p><p className="mt-1 text-2xl font-bold leading-none">{stageCounts.to_route}</p></div></CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/50 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-blue-100 p-2.5 text-blue-700"><ArrowLeftRight className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-600">Transfer in Progress</p><p className="mt-1 text-2xl font-bold leading-none">{stageCounts.in_transfer}</p></div></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/60 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-amber-100 p-2.5 text-amber-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-600">Ready for Final Delivery</p><p className="mt-1 text-2xl font-bold leading-none">{stageCounts.to_dispatch}</p></div></CardContent></Card>
        <Card className="border-violet-200 bg-violet-50/60 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-violet-100 p-2.5 text-violet-700"><Truck className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-600">Out for Delivery</p><p className="mt-1 text-2xl font-bold leading-none">{orders.filter((row:any)=>["out_for_delivery","dispatched_to_customer","delivery_in_progress"].includes(norm(row.status || row.fulfillmentStatus))).length}</p></div></CardContent></Card>
        <Card className="border-green-200 bg-green-50/60 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-green-100 p-2.5 text-green-700"><CheckCircle2 className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-600">Delivered</p><p className="mt-1 text-2xl font-bold leading-none">{stageCounts.delivered}</p></div></CardContent></Card>
        <Card className="border-red-200 bg-red-50/60 shadow-sm"><CardContent className="flex min-h-[104px] items-center gap-3 p-3"><div className="rounded-full bg-red-100 p-2.5 text-red-700"><AlertTriangle className="h-5 w-5"/></div><div><p className="text-xs font-medium text-red-800">Needs Attention</p><p className="mt-1 text-2xl font-bold leading-none">{stageCounts.review}</p></div></CardContent></Card>
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
                      <th className="px-3 py-3">Order ID</th><th className="px-3 py-3">Order Type</th><th className="px-3 py-3">Customer / Buyer</th><th className="px-3 py-3">Products</th><th className="px-3 py-3">Quantity</th><th className="px-3 py-3">Route Type</th><th className="px-3 py-3">Status</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {filtered.map((row: any) => {
                        const key = row.source + ":" + row.id;
                        const checked = selectedIds.includes(key);
                        return <tr key={key} className={checked ? "bg-emerald-50/70" : "bg-white hover:bg-slate-50"}>
                          <td className="px-3 py-3"><input aria-label={`Select order ${row.orderNumber}`} type="checkbox" checked={checked} onChange={(e) => toggleOrder(key, e.target.checked)} className="h-4 w-4 accent-emerald-600"/></td>
                          <td className="whitespace-nowrap px-3 py-3 font-semibold text-emerald-900">{row.orderNumber}</td>
                          <td className="px-3 py-3"><Badge className={row.source === "farmer" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}>{row.source === "farmer" ? "Farmer" : "Warehouse"}</Badge></td>
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

          <Card className="min-w-0 w-full overflow-hidden self-start border-emerald-200 shadow-sm">
            <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-emerald-800 to-emerald-700 px-4 py-5 text-white">
              <div className="flex min-w-0 items-center gap-3"><div className="rounded-xl bg-white/15 p-2.5"><Truck className="h-6 w-6"/></div><div className="min-w-0"><h2 className="text-xl font-bold leading-tight">Operations</h2><p className="mt-1 text-xs text-emerald-50">{selectedRows.length ? "Review and process selected orders" : "Process selected orders for dispatch"}</p></div></div>
              {selectedRows.length ? <div className="flex items-center gap-2"><Badge className="border-white/20 bg-white text-emerald-900">{selectedRows.length} Selected</Badge><Button type="button" size="sm" variant="outline" onClick={() => setSelectedIds([])} className="shrink-0 border-white/50 bg-white text-emerald-900 hover:bg-emerald-50"><RefreshCw className="mr-1.5 h-3.5 w-3.5"/>Clear</Button></div> : <Badge className="shrink-0 border-white/20 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-900">0 Selected</Badge>}
            </div>
            <CardContent className="space-y-4 p-4">
              {selectedRows.length > 0 && <div className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/80 p-3.5"><div className="rounded-lg bg-white p-2 text-emerald-700"><Truck className="h-5 w-5"/></div><div><p className="text-sm font-bold text-slate-900">Next Operation</p><p className="mt-1 text-sm leading-5 text-slate-700">{nextOperation}</p>{selectedRouteConfig && <p className="mt-1 text-xs leading-5 text-slate-500">{selectedRouteConfig.intro}</p>}</div></div>}
              {!selectedRows.length ? (
                <div className="flex min-h-[590px] flex-col justify-center gap-8 px-1 py-7">
                  <div className="mx-auto w-full max-w-sm text-center">
                    <div className="relative mx-auto mb-5 flex h-40 w-40 items-center justify-center rounded-full bg-emerald-50">
                      <div className="flex h-28 w-24 items-center justify-center rounded-2xl border-[3px] border-emerald-700 bg-white shadow-sm">
                        <ClipboardCheck className="h-16 w-16 text-emerald-700" strokeWidth={1.6}/>
                      </div>
                      <div className="absolute bottom-7 right-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-emerald-50 bg-emerald-600 text-white shadow-md"><MousePointer2 className="h-6 w-6" fill="currentColor"/></div>
                    </div>
                    <h3 className="text-2xl font-bold tracking-tight text-slate-900">No Orders Selected</h3>
                    <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-slate-600">Select one or more orders from the list to view available operations and process dispatch.</p>
                  </div>
                  <section className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-emerald-200 bg-white">
                    <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-3.5"><Info className="h-5 w-5 text-emerald-700"/><h3 className="text-sm font-bold text-emerald-900">Available Operations (after selection)</h3></div>
                    <div className="space-y-3.5 px-4 py-4">
                      {["Assign delivery partner","Plan and confirm route","Dispatch selected orders","Transfer to destination warehouse (if required)"].map((item) => <div key={item} className="flex items-center gap-3 text-sm text-slate-700"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-4 w-4"/></span><span>{item}</span></div>)}
                    </div>
                  </section>
                </div>
              ) : (
                <>
                  <section className="space-y-2.5"><div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">Selected Orders</h3><Badge variant="secondary">{selectedRows.length}</Badge></div>
                    <div className="max-h-[260px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                      {selectedRows.map((row: any) => <div key={row.source + ":" + row.id} className="flex items-start gap-3 p-3"><div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600"><Package className="h-4 w-4"/></div><div className="min-w-0 flex-1"><p className="break-all text-sm font-semibold text-slate-900">{row.orderNumber}</p><p className="mt-0.5 text-xs text-slate-600">{row.source === "farmer" ? "Farmer" : "Warehouse"} · {row.itemSummary} · {row.quantitySummary}</p><p className="mt-1 text-[11px] text-slate-500">{row.customerName}</p></div><Badge className="shrink-0 border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800">{stageMeta[row.stage as Stage].label}</Badge></div>)}
                    </div>
                  </section>
                  <section className="overflow-hidden rounded-xl border border-slate-200"><div className="flex items-center gap-2 bg-slate-50 px-3.5 py-3"><Route className="h-4 w-4 text-slate-600"/><h3 className="text-sm font-bold text-slate-900">Route &amp; Dispatch Details</h3></div>
                    <dl className="divide-y divide-slate-100 px-3.5">
                      <div className="grid grid-cols-[105px_minmax(0,1fr)] gap-3 py-3 text-xs"><dt className="text-slate-500">Route Type</dt><dd className="font-semibold text-slate-800">{selectedRouteKey ? selectedRouteConfig?.title : "Multiple route types"}</dd></div>
                      <div className="grid grid-cols-[105px_minmax(0,1fr)] gap-3 py-3 text-xs"><dt className="text-slate-500">Destination</dt><dd className="break-words font-semibold text-slate-800">{selectedDestinations.length === 1 ? selectedDestinations[0] : selectedDestinations.length ? "Multiple destinations" : "Not assigned"}</dd></div>
                      <div className="grid grid-cols-[105px_minmax(0,1fr)] gap-3 py-3 text-xs"><dt className="text-slate-500">Total Quantity</dt><dd className="font-semibold text-slate-800">{totalQuantity} <span className="font-normal text-slate-500">({selectedRows.length} orders)</span></dd></div>
                      <div className="grid grid-cols-[105px_minmax(0,1fr)] gap-3 py-3 text-xs"><dt className="text-slate-500">Current Status</dt><dd className="font-semibold text-slate-800">{selectedStatus}</dd></div>
                      <div className="grid grid-cols-[105px_minmax(0,1fr)] gap-3 py-3 text-xs"><dt className="text-slate-500">Next Stage</dt><dd className="font-semibold text-slate-800">{nextOperation}</dd></div>
                    </dl>
                  </section>
                  {(selectedRouteKeys.length > 1 || selectedSources.length > 1 || selectedStages.length > 1) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">Select orders with the same route, source and workflow stage to continue them together.</div>}
                  {blockedSelection && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">Processing is blocked because at least one selected order needs location or route review.</div>}
                  {completedSelection && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">Delivered orders cannot be processed again. Remove completed orders to continue.</div>}
                  <Button type="button" className="h-12 w-full bg-emerald-700 text-sm font-semibold shadow-sm hover:bg-emerald-800" disabled={!canProcessSelection} onClick={processSelectedOrders}><Truck className="mr-2 h-4 w-4"/>Process Selected Orders ({selectedRows.length})<ArrowRight className="ml-2 h-4 w-4"/></Button>
                  <p className="text-center text-[11px] leading-4 text-slate-500">Opens the existing route-specific workflow with its backend validations.</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {workflowFrame && <Card className="overflow-hidden border-emerald-200 shadow-sm">
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-semibold text-slate-900">{workflowFrame.title}</h2><p className="text-xs text-slate-500">Complete the existing workflow here without leaving Fulfillment &amp; Dispatch. Original validations and API actions are retained.</p></div>
            <Button size="sm" variant="outline" onClick={() => setWorkflowFrame(null)}>Close workflow</Button>
          </div>
          <iframe key={workflowFrame.href} src={workflowFrame.href} title={workflowFrame.title} className="h-[900px] w-full rounded-lg border border-slate-200 bg-white" />
        </CardContent>
      </Card>}
      <p className="text-xs text-slate-500">Farmer Fulfillment and Warehouse Outgoing / Dispatch processes can be completed within this workspace using their existing operational screens and backend validations.</p>
    </div>
  );
}
