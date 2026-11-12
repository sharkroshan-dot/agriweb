"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Clock3, Filter, Leaf, MapPin, Package, RefreshCw, Route, Search, Truck, Warehouse } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { api } from "../../../lib/api/client";

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

function normalizeFarmer(item: any) {
  const stage = farmerStage(item);
  return {
    ...item,
    id: String(item.id || item.orderId || item.orderNumber),
    orderId: String(item.orderId || item.id || ""),
    orderNumber: item.orderNumber || item.orderId || item.id || "Farmer order",
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
    orderNumber: item.orderNumber || item.orderId || "Warehouse order",
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
  const [selectedId, setSelectedId] = useState<string>("");
  const [expandedDestinations, setExpandedDestinations] = useState<string[]>([]);
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

  const selected = filtered.find((row: any) => row.source + ":" + row.id === selectedId) || filtered[0] || null;
  const stageCounts = useMemo(() => Object.fromEntries((Object.keys(stageMeta) as Stage[]).map((stage) => [stage, orders.filter((row: any) => row.stage === stage).length])) as Record<Stage, number>, [orders]);
  const routeCounts = useMemo(() => Object.fromEntries(ROUTES.map((route) => [route.key, orders.filter((row: any) => row.route === route.key).length])) as Record<RouteKey, number>, [orders]);
  const destinationGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    filtered.forEach((row: any) => {
      const key = row.destinationGroup || "Destination not assigned";
      groups.set(key, [...(groups.get(key) || []), row]);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);
  const refresh = async () => {
    await Promise.all([farmerQuery.refetch(), outgoingQuery.refetch(), consolidationQuery.refetch()]);
  };
  const isLoading = farmerQuery.isLoading || outgoingQuery.isLoading;
  const hasError = farmerQuery.isError && outgoingQuery.isError;
  const toggleDestination = (name: string) => setExpandedDestinations((current) => current.includes(name) ? current.filter((x) => x !== name) : [...current, name]);

  return (
    <div className="mx-auto w-full max-w-[1700px] space-y-5 pb-8">
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Truck className="h-6 w-6"/></div>
          <div><h1 className="text-2xl font-bold tracking-tight text-slate-950">Fulfillment & Dispatch</h1><p className="mt-1 text-sm text-slate-600">One workspace for Farmer and Warehouse orders, grouped by their next action and destination.</p><p className="mt-2 text-xs text-slate-500">Receive → Quality Check → Route Classification → Transfer (if required) → Dispatch → Delivery</p></div>
        </div>
        <Button variant="outline" onClick={refresh} disabled={farmerQuery.isFetching || outgoingQuery.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${farmerQuery.isFetching || outgoingQuery.isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Card><CardContent className="p-4"><p className="text-xs text-slate-500">All Orders</p><p className="mt-1 text-2xl font-bold">{orders.length}</p><p className="text-xs text-slate-500">Across both sources</p></CardContent></Card>
        <Card className="border-emerald-200 bg-emerald-50/50"><CardContent className="p-4"><p className="text-xs text-emerald-800">Farmer Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x: any) => x.source === "farmer").length}</p><p className="text-xs text-emerald-700">Farmer-packed</p></CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/50"><CardContent className="p-4"><p className="text-xs text-blue-800">Warehouse Orders</p><p className="mt-1 text-2xl font-bold">{orders.filter((x: any) => x.source === "warehouse").length}</p><p className="text-xs text-blue-700">Warehouse-packed</p></CardContent></Card>
        {(Object.keys(stageMeta) as Stage[]).slice(0, 4).map((stage) => <Card key={stage}><CardContent className="p-4"><p className="text-xs text-slate-500">{stageMeta[stage].label}</p><p className="mt-1 text-2xl font-bold">{stageCounts[stage]}</p><p className="text-xs text-slate-500">{stageMeta[stage].short}</p></CardContent></Card>)}
      </div>

      <Card className="border-emerald-100"><CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-900">Route Classification</h2><p className="text-xs text-slate-500">Orders from both fulfillment sources are classified together. Source labels and order histories remain separate.</p></div><Badge variant="outline">{orders.length} orders</Badge></div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {ROUTES.map((route) => <button key={route.key} type="button" onClick={() => setActiveRoute(activeRoute === route.key ? "all" : route.key)} className={`rounded-xl border p-3 text-left transition-colors ${activeRoute === route.key ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-100" : "border-slate-200 bg-white hover:border-emerald-200"}`}>
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-800">{route.label}</span><Badge variant="secondary">{routeCounts[route.key]}</Badge></div><p className="mt-1 text-xs text-slate-500">{route.description}</p>
          </button>)}
        </div>
      </CardContent></Card>

      <div className="flex flex-col gap-3 rounded-xl border bg-white p-3 shadow-sm lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={activeStage === "all" ? "default" : "outline"} onClick={() => setActiveStage("all")}>All ({orders.length})</Button>
          {(Object.keys(stageMeta) as Stage[]).map((stage) => <Button key={stage} size="sm" variant={activeStage === stage ? "default" : "outline"} onClick={() => setActiveStage(activeStage === stage ? "all" : stage)}>{stageMeta[stage].label} ({stageCounts[stage]})</Button>)}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 lg:justify-end"><div className="relative w-full max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, customer, product or destination..." className="pl-9"/></div><Button variant="outline" size="sm" onClick={() => {setActiveStage("all");setActiveRoute("all");setSearch("");}}>Clear filters</Button></div>
      </div>

      {hasError && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-800">Could not load either fulfillment queue. Refresh the page or check warehouse access.</CardContent></Card>}
      {isLoading ? <Card><CardContent className="p-10 text-center text-sm text-slate-500">Loading fulfillment orders…</CardContent></Card> : filtered.length === 0 ? <Card><CardContent className="p-12 text-center"><Package className="mx-auto h-10 w-10 text-slate-300"/><h3 className="mt-3 font-semibold text-slate-800">No orders in this view</h3><p className="mt-1 text-sm text-slate-500">Try another stage or route filter.</p></CardContent></Card> : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">Orders grouped by destination</h2><Badge variant="outline">{filtered.length} shown</Badge></div>
            {destinationGroups.map(([destination, rows]) => <Card key={destination} className="overflow-hidden">
              <button type="button" onClick={() => toggleDestination(destination)} className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100">
                <div className="flex min-w-0 items-center gap-2"><Warehouse className="h-5 w-5 shrink-0 text-emerald-700"/><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{destination}</p><p className="text-xs text-slate-500">{rows.length} order(s) · Farmer {rows.filter((x: any) => x.source === "farmer").length} · Warehouse {rows.filter((x: any) => x.source === "warehouse").length}</p></div></div>
                {expandedDestinations.includes(destination) ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/>}
              </button>
              {(!expandedDestinations.length || expandedDestinations.includes(destination)) && <CardContent className="space-y-2 p-3">
                {rows.map((row: any) => {
                  const key = row.source + ":" + row.id;
                  const active = selected?.source + ":" + selected?.id === key;
                  return <button key={key} type="button" onClick={() => setSelectedId(key)} className={`w-full rounded-xl border p-3 text-left transition-colors ${active ? "border-emerald-400 bg-emerald-50/60 ring-1 ring-emerald-100" : "border-slate-200 hover:border-emerald-200"}`}>
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">#{row.orderNumber}</p><p className="mt-1 truncate text-xs text-slate-600">{row.customerName}</p><p className="mt-1 truncate text-xs text-slate-500">{row.itemSummary} · {row.quantitySummary}</p></div><div className="flex shrink-0 flex-col items-end gap-1"><Badge className={row.source === "farmer" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-blue-100 text-blue-800 hover:bg-blue-100"}>{row.source === "farmer" ? <><Leaf className="mr-1 h-3 w-3"/>Farmer</> : <><Warehouse className="mr-1 h-3 w-3"/>Warehouse</>}</Badge><Badge variant="outline">{stageMeta[row.stage as Stage].label}</Badge></div></div>
                  </button>;
                })}
              </CardContent>}
            </Card>)}
          </div>

          <div className="xl:sticky xl:top-20">
            {selected ? <Card className="overflow-hidden">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3 border-b pb-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-900">#{selected.orderNumber}</h2><Badge className={selected.source === "farmer" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}>{selected.source === "farmer" ? "Farmer Fulfillment" : "Warehouse Fulfillment"}</Badge></div><p className="mt-1 text-sm text-slate-600">{selected.customerName}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5"/>{selected.district}</p></div><Badge variant="outline">{stageMeta[selected.stage as Stage].label}</Badge></div>
                <div className="grid grid-cols-3 gap-2">{(["to_receive","to_route","in_transfer"] as Stage[]).map((stage) => <div key={stage} className={`rounded-lg p-2 text-center text-xs ${selected.stage === stage ? "bg-emerald-100 text-emerald-900" : "bg-slate-50 text-slate-500"}`}>{stageMeta[stage].label}</div>)}</div>
                <div className="grid grid-cols-2 gap-2"><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Current status</p><p className="mt-1 break-words text-sm font-semibold">{String(selected.currentStatus).replace(/_/g, " ")}</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">Destination group</p><p className="mt-1 break-words text-sm font-semibold">{selected.destinationGroup}</p></div></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Route classification</p><p className="mt-1 font-semibold">{ROUTES.find((x) => x.key === selected.route)?.label}</p><p className="mt-1 text-xs text-slate-500">{ROUTES.find((x) => x.key === selected.route)?.description}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Products / quantity</p><p className="mt-1 text-sm font-semibold">{selected.itemSummary} · {selected.quantitySummary}</p></div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4"/>Operational actions continue in the existing source workflow. This unified page does not bypass pickup, receipt, quality, packing, transfer or dispatch validations.</div>
                <div className="flex flex-wrap gap-2">
                  {selected.source === "farmer" ? <Button asChild className="flex-1"><Link href="/warehouse/farmer-fulfillment">Open Farmer Fulfillment workflow <ArrowRight className="ml-2 h-4 w-4"/></Link></Button> : <Button asChild className="flex-1"><Link href="/outgoing">Open Outgoing / Dispatch workflow <ArrowRight className="ml-2 h-4 w-4"/></Link></Button>}
                  {selected.source === "farmer" && <Button asChild variant="outline"><Link href="/warehouse/consolidation">Consolidation</Link></Button>}
                  {selected.source === "warehouse" && <Button asChild variant="outline"><Link href="/packing">Order Packing</Link></Button>}
                </div>
              </CardContent>
            </Card> : <Card><CardContent className="p-10 text-center text-sm text-slate-500">Select an order to view its details.</CardContent></Card>}
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">This is a unified monitoring and navigation workspace. Existing Farmer Fulfillment and Outgoing / Dispatch pages remain available and continue to own their current operational actions and validations.</p>
    </div>
  );
}
