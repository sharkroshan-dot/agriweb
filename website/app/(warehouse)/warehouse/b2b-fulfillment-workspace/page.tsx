"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Truck, Warehouse, RefreshCw, CheckCircle2, MapPin, ClipboardCheck, Search, CalendarDays, Users, Package, Route, CheckCircle, ArrowRight, Filter, ChevronRight, Store } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../lib/api/client";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { WarehousePageHeader } from "../../../components/warehouse/warehouse-page-header";
import { PageToolbar } from "../../../components/common/page-primitives";

const label = (value: string) => String(value || "unknown").replace(/_/g, " ");
export default function B2BFulfillmentPage() {
  const qc = useQueryClient();
  const [forms, setForms] = useState<Record<string, any>>({});
  const [destinationOrderId, setDestinationOrderId] = useState<string>("");
  const [view, setView] = useState<"active" | "completed">("active");
  const [routingMode, setRoutingMode] = useState<Record<string, "automatic" | "manual">>({});
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [farmFilter, setFarmFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const query = useQuery({ queryKey: ["b2b", "warehouse-fulfillment"], queryFn: () => api.get("/b2b/warehouse/fulfillment"), refetchInterval: 10000 });
  const teamsQuery = useQuery({ queryKey: ["b2b", "approved-pickup-teams"], queryFn: () => api.get("/warehouse/me/pickup-team/members"), refetchInterval: 30000 });
  const orders = (query.data?.data?.orders || query.data?.orders || []).map((o: any) => ({ ...o, id: String(o.id || o._id || "") }));
  const completedQuery = useQuery({
    queryKey: ["b2b", "warehouse-fulfillment-completed"],
    queryFn: () => api.get("/b2b/warehouse/fulfillment/completed"),
    enabled: view === "completed",
    refetchInterval: view === "completed" ? 30000 : false,
  });
  const completedOrders = (completedQuery.data?.data?.orders || completedQuery.data?.orders || []).map((o: any) => ({ ...o, id: String(o.id || o._id || "") }));
  const cooperativeOrderIds = orders.filter((o: any) => Boolean(o.cooperativeId)).map((o: any) => o.id).sort();
  const cooperativeContributionsQuery = useQuery({
    queryKey: ["b2b", "cooperative-contributions", cooperativeOrderIds.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(cooperativeOrderIds.map(async (id: string) => {
        const response = await api.get(`/b2b/warehouse/fulfillment/${encodeURIComponent(id)}/cooperative-contributions`);
        return [id, response?.data?.data?.contributions || response?.data?.contributions || []] as const;
      }));
      return Object.fromEntries(entries);
    },
    enabled: cooperativeOrderIds.length > 0 && view === "active",
    refetchInterval: 15000,
    retry: 1,
  });
  const cooperativeContributionRows = cooperativeContributionsQuery.data || {};
  const cooperativeContributionMutation = useMutation({
    mutationFn: ({ orderId, contributionId, payload }: { orderId: string; contributionId: string; payload: any }) =>
      api.patch(`/b2b/warehouse/fulfillment/${encodeURIComponent(orderId)}/cooperative-contributions/${encodeURIComponent(contributionId)}`, payload),
    onSuccess: async () => {
      toast.success("Farmer-wise received quantity and quality saved");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["b2b", "cooperative-contributions"] }),
        qc.invalidateQueries({ queryKey: ["b2b", "warehouse-fulfillment"] }),
      ]);
    },
    onError: (e: any) => toast.error(e?.message || "Could not save farmer-wise receipt"),
  });
  const displayedOrders = view === "completed" ? completedOrders : orders;
  const destinationQuery = useQuery({ queryKey: ["b2b", "destination-warehouses", destinationOrderId], queryFn: () => api.get(`/b2b/warehouse/fulfillment/destination-warehouses?orderId=${encodeURIComponent(destinationOrderId)}`), enabled: Boolean(destinationOrderId), retry: false });
  const destinationWarehouses = destinationQuery.data?.data?.warehouses || [];
  const routableOrders = orders.filter((o: any) => o.status === "warehouse_received" && o.warehouseQualityCheck === "passed");
  const recommendationQuery = useQuery({
    queryKey: ["b2b", "route-recommendations", routableOrders.map((o: any) => o.id).sort().join(",")],
    queryFn: async () => {
      const entries = await Promise.all(routableOrders.map(async (o: any) => {
        const response = await api.post(`/b2b/warehouse/fulfillment/${encodeURIComponent(o.id)}/route-recommendation`, { orderId: o.id });
        return [o.id, response?.data?.data ?? response?.data ?? {}] as const;
      }));
      return Object.fromEntries(entries);
    },
    enabled: routableOrders.length > 0,
    refetchInterval: 30000,
  });
  const routeRecommendations = recommendationQuery.data || {};
  useEffect(() => {
    if (!recommendationQuery.data) return;
    setForms((previous) => {
      const next = { ...previous };
      for (const [orderId, recommendation] of Object.entries(recommendationQuery.data as Record<string, any>)) {
        if (!recommendation?.available) continue;
        const existing = next[orderId] || {};
        if (!existing.fulfillmentRoute) {
          next[orderId] = {
            ...existing,
            fulfillmentRoute: recommendation.fulfillmentRoute,
            destinationWarehouseId: recommendation.destinationWarehouseId || "",
          };
        }
      }
      return next;
    });
  }, [recommendationQuery.data]);
  const members = teamsQuery.data?.data?.members || teamsQuery.data?.members || [];
  const teams = members.filter((t: any) => Number(t.capacityKg || t.vehicleCapacityKg || t.capacity || t.vehicleCapacity || t.maxCapacityKg || 0) > 0);
  const mutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.put(`/b2b/warehouse/fulfillment/${encodeURIComponent(id)}`, { ...payload }),
    onSuccess: async () => {
      toast.success("B2B order workflow updated");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["b2b", "warehouse-fulfillment"] }),
        qc.invalidateQueries({ queryKey: ["b2b", "farmer", "orders"] }),
        qc.invalidateQueries({ queryKey: ["warehouseCollectionsPage"] }),
        qc.invalidateQueries({ queryKey: ["warehousePickupAreaPlanning"] }),
      ]);
    },
    onError: (e: any) => toast.error(e?.message || "Could not update B2B fulfillment"),
  });
  const form = (id: string) => forms[id] || {};
  const setForm = (id: string, patch: any) => setForms((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  const act = (id: string, payload: any) => mutation.mutate({ id, payload });
  const farmNameOf = (o: any) => o.farmerInfo?.farmName || o.farmName || o.farmerName || "Farmer";
  const productNameOf = (o: any) => o.productName || o.items?.[0]?.productName || "B2B produce";
  const areaNameOf = (o: any) => o.farmerInfo?.farmLocation || o.farmLocation || o.farmerInfo?.city || o.farmCity || o.farmerInfo?.district || o.farmDistrict || "Area not recorded";
  const businessNameOf = (o: any) => o.businessInfo?.businessName || o.businessName || "Business buyer";
  const stageOf = (o: any) => {
    const status = String(o.status || "").toLowerCase();
    if (["delivered", "completed"].includes(status)) return "delivered";
    if (status === "in_transit") return "delivery_transit";
    if (status === "transfer_in_transit") return "transfer_transit";
    if (status === "destination_warehouse_received") return Number(o.b2bFarmerCount || 1) > 1 && !o.consolidationCompletedAt ? "consolidation" : "ready_delivery";
    if (status === "warehouse_received") return o.warehouseQualityCheck === "passed" ? (o.fulfillmentRoute ? "routing" : "routing_required") : "warehouse_received";
    if (["picked_up", "warehouse_arrived", "arrived_warehouse", "departed_farm", "collected"].includes(status) || ["warehouse_arrived", "arrived_warehouse", "departed_farm", "collected"].includes(String(o.warehouseFulfillmentStage || o.warehouseCollectionStatus || "").toLowerCase())) return "collected";
    if (status === "ready_for_pickup" && o.pickupTeam) return "pickup_assigned";
    return "ready_pickup";
  };
  const stageCounts = {
    ready_pickup: orders.filter((o: any) => stageOf(o) === "ready_pickup").length,
    pickup_assigned: orders.filter((o: any) => stageOf(o) === "pickup_assigned").length,
    collected: orders.filter((o: any) => stageOf(o) === "collected").length,
    warehouse_received: orders.filter((o: any) => stageOf(o) === "warehouse_received").length,
    routing: orders.filter((o: any) => ["routing", "routing_required"].includes(stageOf(o))).length,
    transfer_transit: orders.filter((o: any) => stageOf(o) === "transfer_transit").length,
    ready_delivery: orders.filter((o: any) => ["ready_delivery", "consolidation"].includes(stageOf(o))).length,
    delivery_transit: orders.filter((o: any) => stageOf(o) === "delivery_transit").length,
    delivered: orders.filter((o: any) => stageOf(o) === "delivered").length,
  };
  const filteredOrders = displayedOrders.filter((o: any) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch = !q || [o.orderNumber, o.id, o.rfqNumber, farmNameOf(o), productNameOf(o), businessNameOf(o)].some((v: any) => String(v || "").toLowerCase().includes(q));
    const matchesFarm = farmFilter === "all" || farmNameOf(o) === farmFilter;
    const matchesProduct = productFilter === "all" || productNameOf(o) === productFilter;
    const matchesArea = areaFilter === "all" || areaNameOf(o) === areaFilter;
    const matchesDelivery = deliveryFilter === "all" || String(o.fulfillmentRoute || o.deliveryType || "to_warehouse") === deliveryFilter;
    const matchesStage = stageFilter === "all" || stageOf(o) === stageFilter;
    return matchesSearch && matchesFarm && matchesProduct && matchesArea && matchesDelivery && matchesStage;
  });
  const selectedOrder = filteredOrders.find((o: any) => o.id === selectedOrderId) || filteredOrders[0] || null;
  const uniqueValues = (field: (o: any) => string) => Array.from(new Set(displayedOrders.map(field).filter((v: string) => v && v !== "Area not recorded"))).sort();

  return <div className="warehouse-b2b-page space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2 text-sm"><span className="font-medium text-emerald-900">New B2B workspace · Separate from your existing page</span><a href="/warehouse/b2b-fulfillment" className="font-semibold text-emerald-800 underline underline-offset-4">Open original B2B page</a></div>
    <WarehousePageHeader
      title="B2B Pickup & Fulfillment Workspace"
      description="A separate operational workspace for district-based B2B pickup, warehouse receipt, quality, routing, transfers and business delivery. Existing workflow rules are preserved."
      eyebrow="B2B operations · New workspace"
      meta={<Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">District routing enforced</Badge>}
      actions={<div className="flex flex-wrap gap-2"><a href="/warehouse/b2b-fulfillment" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Original page</a><Button variant="outline" onClick={() => { query.refetch(); teamsQuery.refetch(); }}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button></div>}
    />
    <PageToolbar variant="bare" aria-label="B2B fulfillment views">
      <div className="flex flex-wrap gap-2">
        <Button variant={view === "active" ? "default" : "outline"} onClick={() => setView("active")}>Active fulfillment ({orders.length})</Button>
        <Button variant={view === "completed" ? "default" : "outline"} onClick={() => setView("completed")}>Completed orders ({completedOrders.length})</Button>
      </div>
    </PageToolbar>
    {view === "completed" && <p className="text-sm text-slate-600">Read-only archive of B2B orders that have reached the configured terminal workflow stage. Archived orders have no pickup, receipt, routing, transfer, or dispatch actions.</p>}
    <section className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/80 via-white to-sky-50/60 p-4 shadow-sm"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold text-slate-900">B2B fulfillment journey</h2><p className="text-xs text-slate-500">Operational stages · Local Hub is not part of B2B fulfillment</p></div><Badge variant="outline" className="bg-white">District-based workflow</Badge></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{[{n:"01",t:"Farm pickup",d:"Assign and collect"},{n:"02",t:"Warehouse receipt",d:"Record received stock"},{n:"03",t:"Quality check",d:"Pass or fail inspection"},{n:"04",t:"Routing & consolidation",d:"Select district route"},{n:"05",t:"Inter-warehouse transfer",d:"When long distance"},{n:"06",t:"Final delivery",d:"Deliver to business"}].map((stage:any,i:number)=><div key={stage.n} className="relative rounded-xl border border-slate-200 bg-white/90 p-3"><div className="mb-2 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{stage.n}</span>{i<5&&<span className="hidden h-px flex-1 bg-emerald-200 xl:block"/>}</div><p className="text-xs font-semibold text-slate-900">{stage.t}</p><p className="mt-1 text-[11px] leading-snug text-slate-500">{stage.d}</p></div>)}</div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-5">{[
      { label: "Ready for Farm Pickup", key: "readyForFarmPickup" },
      { label: "Pickup Assigned", key: "pickupAssigned" },
      { label: "Collected from Farm", key: "collectedFromFarm" },
      { label: "Warehouse Received", key: "warehouseReceived" },
      { label: "Routing Required", key: "routingRequired" },
      { label: "Awaiting Consolidation", key: "awaitingConsolidation" },
      { label: "Warehouse Transfer in Transit", key: "warehouseTransferInTransit" },
      { label: "Ready for Direct Delivery", key: "readyForDirectDelivery" },
      { label: "Direct Delivery in Transit", key: "directDeliveryInTransit" },
      { label: "Delivered to Business", key: "deliveredToBusiness" },
    ].map((s: any) => <Card key={s.key} className="wh-dashboard-kpi rounded-2xl border-slate-200 shadow-sm transition-shadow hover:shadow-md"><CardContent className="min-h-[104px] p-4"><p className="text-xs font-medium leading-snug text-slate-500">{s.label}</p><p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{Number(query.data?.data?.summary?.[s.key] ?? 0)}</p></CardContent></Card>)}</div>
    {view === "completed" && <p className="text-sm text-slate-600">Read-only archive of completed B2B orders. Archived orders have no pickup, receipt, routing, transfer, or dispatch actions.</p>}
    <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {[{n:"01",t:"Farm Pickup",d:"Assign & collect",icon:Truck},{n:"02",t:"Warehouse Receipt",d:"Receive stock",icon:Warehouse},{n:"03",t:"Quality Check",d:"Pass or fail",icon:ClipboardCheck},{n:"04",t:"Consolidation",d:"Combine portions",icon:Package},{n:"05",t:"Transfer (Inter-WH)",d:"District transfer",icon:Route},{n:"06",t:"Final Delivery",d:"Deliver to buyer",icon:Store}].map((s:any,i:number)=><div key={s.n} className="flex min-w-0 items-center gap-2 rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-white px-3 py-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-700"><s.icon className="h-4 w-4"/></span><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-900">{s.t}</p><p className="truncate text-[11px] text-slate-500">{s.d}</p></div>{i<5&&<ChevronRight className="ml-auto hidden h-4 w-4 shrink-0 text-emerald-600 2xl:block"/>}</div>)}
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
      {[
        {label:"Ready for Farm Pickup",key:"readyForFarmPickup",fallback:stageCounts.ready_pickup,color:"emerald"},
        {label:"Pickup Assigned",key:"pickupAssigned",fallback:stageCounts.pickup_assigned,color:"sky"},
        {label:"Collected from Farm",key:"collectedFromFarm",fallback:stageCounts.collected,color:"violet"},
        {label:"Warehouse Received",key:"warehouseReceived",fallback:stageCounts.warehouse_received,color:"blue"},
        {label:"Routing Required",key:"routingRequired",fallback:stageCounts.routing,color:"orange"},
        {label:"In Transit (WH Transfer)",key:"warehouseTransferInTransit",fallback:stageCounts.transfer_transit,color:"violet"},
        {label:"Ready for Direct Delivery",key:"readyForDirectDelivery",fallback:stageCounts.ready_delivery,color:"emerald"},
        {label:"In Transit (Delivery)",key:"directDeliveryInTransit",fallback:stageCounts.delivery_transit,color:"sky"},
        {label:"Delivered to Business",key:"deliveredToBusiness",fallback:stageCounts.delivered,color:"green"},
      ].map((s:any)=><button key={s.key} type="button" onClick={()=>{setView("active");setStageFilter(({readyForFarmPickup:"ready_pickup",pickupAssigned:"pickup_assigned",collectedFromFarm:"collected",warehouseReceived:"warehouse_received",routingRequired:"routing",warehouseTransferInTransit:"transfer_transit",readyForDirectDelivery:"ready_delivery",directDeliveryInTransit:"delivery_transit",deliveredToBusiness:"delivered"} as any)[s.key]);}} className="min-h-[104px] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><p className="min-h-8 text-[11px] font-semibold leading-tight text-slate-600">{s.label}</p><p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{Number(query.data?.data?.summary?.[s.key] ?? s.fallback)}</p><p className="mt-1 text-[10px] text-slate-500">View orders <ArrowRight className="ml-1 inline h-3 w-3"/></p></button>)}
    </div>
    <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
      {[
        {key:"ready_pickup",label:"Ready for Pickup",count:stageCounts.ready_pickup+stageCounts.pickup_assigned},
        {key:"pickup_assigned",label:"Assigned",count:stageCounts.pickup_assigned},
        {key:"collected",label:"Collected",count:stageCounts.collected},
        {key:"warehouse_received",label:"Received",count:stageCounts.warehouse_received},
        {key:"routing",label:"Routing",count:stageCounts.routing},
        {key:"transfer_transit",label:"In Transit",count:stageCounts.transfer_transit},
        {key:"ready_delivery",label:"Ready for Delivery",count:stageCounts.ready_delivery},
        {key:"delivery_transit",label:"Delivery In Transit",count:stageCounts.delivery_transit},
        {key:"delivered",label:"Delivered",count:stageCounts.delivered},
      ].map((tab:any)=><button type="button" key={tab.key} onClick={()=>setStageFilter(stageFilter===tab.key?"all":tab.key)} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${stageFilter===tab.key?"border-emerald-700 bg-emerald-700 text-white shadow-sm":"border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"}`}>{tab.label} <span className={stageFilter===tab.key?"text-emerald-100":"text-slate-400"}>({tab.count})</span></button>)}
      <button type="button" onClick={()=>setStageFilter("all")} className="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100">All stages</button>
    </div>
    ${loadingError}
    {!((view === "active" ? query.isLoading : completedQuery.isLoading) || (view === "active" ? query.isError : completedQuery.isError)) && displayedOrders.length>0 && <div className="grid min-w-0 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_340px]">
      <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2"><Filter className="h-4 w-4 text-emerald-700"/><h2 className="font-semibold text-slate-900">Filter Orders</h2></div>
        <label className="mb-1 block text-xs font-semibold text-slate-700">RFQ / Order No.</label>
        <div className="relative mb-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><Input value={searchText} onChange={e=>setSearchText(e.target.value)} placeholder="Search order, RFQ..." className="pl-9"/></div>
        <label className="mb-1 block text-xs font-semibold text-slate-700">Farm</label><select value={farmFilter} onChange={e=>setFarmFilter(e.target.value)} className="mb-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="all">All Farms</option>{uniqueValues(farmNameOf).map(v=><option key={v} value={v}>{v}</option>)}</select>
        <label className="mb-1 block text-xs font-semibold text-slate-700">Product</label><select value={productFilter} onChange={e=>setProductFilter(e.target.value)} className="mb-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="all">All Products</option>{uniqueValues(productNameOf).map(v=><option key={v} value={v}>{v}</option>)}</select>
        <label className="mb-1 block text-xs font-semibold text-slate-700">Pickup Area</label><select value={areaFilter} onChange={e=>setAreaFilter(e.target.value)} className="mb-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="all">All Areas</option>{uniqueValues(areaNameOf).map(v=><option key={v} value={v}>{v}</option>)}</select>
        <label className="mb-1 block text-xs font-semibold text-slate-700">Delivery Type</label><select value={deliveryFilter} onChange={e=>setDeliveryFilter(e.target.value)} className="mb-4 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="all">All Types</option><option value="nearby_single_farmer">Direct Delivery</option><option value="nearby_multi_farmer">Consolidation</option><option value="long_distance">To Warehouse</option><option value="to_warehouse">To Warehouse (not routed)</option></select>
        <div className="grid grid-cols-2 gap-2"><Button variant="outline" className="w-full" onClick={()=>{setSearchText("");setFarmFilter("all");setProductFilter("all");setAreaFilter("all");setDeliveryFilter("all");setStageFilter("all");}}>Reset</Button><Button className="w-full" onClick={()=>{setSelectedOrderId(filteredOrders[0]?.id || "");}}>Apply</Button></div>
      </aside>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-4"><div><h2 className="text-base font-bold text-slate-900">{stageFilter==="all"?"B2B Orders":label(stageFilter)+" Orders"}</h2><p className="text-xs text-slate-500">Select an order to view details and available workflow actions</p></div><p className="text-xs font-semibold text-slate-600">{filteredOrders.length} orders · {new Set(filteredOrders.map((o:any)=>farmNameOf(o))).size} farms</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Order / RFQ</th><th className="px-3 py-3">Farm</th><th className="px-3 py-3">Products & Qty</th><th className="px-3 py-3">Pickup Area</th><th className="px-3 py-3">Delivery Type</th><th className="px-3 py-3">Expected Pickup</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredOrders.map((o:any)=>{const orderName=o.orderNumber||`B2B-${o.id.slice(-6)}`;const isSelected=selectedOrder?.id===o.id;return <tr key={o.id} onClick={()=>setSelectedOrderId(o.id)} className={`cursor-pointer transition hover:bg-emerald-50/60 ${isSelected?"bg-emerald-50/80":""}`}><td className="px-3 py-3"><p className="font-bold text-slate-900">{orderName}</p><p className="mt-0.5 text-[10px] text-slate-500">{o.rfqNumber||o.rfqId||"RFQ reference unavailable"}</p></td><td className="px-3 py-3"><p className="font-semibold text-slate-800">{farmNameOf(o)}</p><p className="text-[10px] text-slate-500">{areaNameOf(o)}</p></td><td className="px-3 py-3"><p className="font-semibold text-slate-800">{productNameOf(o)}</p><p className="text-[10px] text-slate-500">{o.quantityKg??"—"} kg</p></td><td className="px-3 py-3">{areaNameOf(o)}</td><td className="px-3 py-3"><Badge variant="outline">{label(o.fulfillmentRoute||o.deliveryType||(o.status==="warehouse_received"?"routing_required":"to_warehouse"))}</Badge></td><td className="px-3 py-3"><p className="font-medium text-slate-700">{o.pickupDate?new Date(o.pickupDate).toLocaleDateString("en-IN"):(o.deliveryDeadline||o.requiredDate?new Date(o.deliveryDeadline||o.requiredDate).toLocaleDateString("en-IN"):"Not scheduled")}</p><p className="text-[10px] text-slate-500">{o.pickupWindowStart||o.deliveryTimeSlot||"Time not set"}</p></td><td className="px-3 py-3"><Badge>{label(o.status)}</Badge></td></tr>})}</tbody></table></div>
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Showing {filteredOrders.length} of {displayedOrders.length} orders</div>
      </section>
      <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        {selectedOrder ? <><div className="mb-3 flex items-start justify-between gap-2 border-b border-slate-100 pb-3"><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Selected B2B order</p><h2 className="mt-1 break-all text-lg font-bold text-slate-900">{selectedOrder.orderNumber||`B2B-${selectedOrder.id.slice(-6)}`}</h2><p className="text-xs text-slate-500">{selectedOrder.rfqNumber||selectedOrder.rfqId||"RFQ reference unavailable"}</p></div><Badge>{label(selectedOrder.status)}</Badge></div><div className="mb-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Farm</p><p className="mt-1 break-words font-semibold text-slate-900">{farmNameOf(selectedOrder)}</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Pickup area</p><p className="mt-1 break-words font-semibold text-slate-900">{areaNameOf(selectedOrder)}</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Product & Qty</p><p className="mt-1 break-words font-semibold text-slate-900">{productNameOf(selectedOrder)} · {selectedOrder.quantityKg??"—"} kg</p></div><div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Delivery type</p><p className="mt-1 break-words font-semibold text-slate-900">{label(selectedOrder.fulfillmentRoute||selectedOrder.deliveryType||"to_warehouse")}</p></div><div className="col-span-2 rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Business buyer</p><p className="mt-1 break-words font-semibold text-slate-900">{businessNameOf(selectedOrder)}</p></div></div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700"><CalendarDays className="h-4 w-4 text-emerald-700"/>Expected pickup: {selectedOrder.pickupDate?new Date(selectedOrder.pickupDate).toLocaleDateString("en-IN"):"Not scheduled"}</div></> : <p className="py-8 text-center text-sm text-slate-500">Select an order to view its details.</p>}
        <div className="max-h-[70vh] overflow-y-auto border-t border-slate-100 pt-3">${detail}</div>
      </aside>
    </div>}

  </div>;
}
