"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Truck, Warehouse, RefreshCw, CheckCircle2, MapPin, ClipboardCheck } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/api/client";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { WarehousePageHeader } from "../../components/warehouse/warehouse-page-header";
import { PageToolbar } from "../../components/common/page-primitives";

const label = (value: string) => String(value || "unknown").replace(/_/g, " ");
export default function B2BFulfillmentPage() {
  const qc = useQueryClient();
  const [forms, setForms] = useState<Record<string, any>>({});
  const [destinationOrderId, setDestinationOrderId] = useState<string>("");
  const [view, setView] = useState<"active" | "completed">("active");
  const [routingMode, setRoutingMode] = useState<Record<string, "automatic" | "manual">>({});
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
      ]);
    },
    onError: (e: any) => toast.error(e?.message || "Could not update B2B fulfillment"),
  });
  const form = (id: string) => forms[id] || {};
  const setForm = (id: string, patch: any) => setForms((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  const act = (id: string, payload: any) => mutation.mutate({ id, payload });

  return <div className="warehouse-b2b-page space-y-6">
    <WarehousePageHeader
      title="B2B Pickup & Fulfillment"
      description="Manage district-based business order receipt, transfer, delivery, and business handoff. B2B orders do not use the Local Hub stage."
      eyebrow="B2B operations"
      meta={<Badge variant="outline">District routing enforced</Badge>}
      actions={<Button variant="outline" onClick={() => { query.refetch(); teamsQuery.refetch(); }}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>}
    />
    <PageToolbar variant="bare" aria-label="B2B fulfillment views">
      <div className="flex flex-wrap gap-2">
        <Button variant={view === "active" ? "default" : "outline"} onClick={() => setView("active")}>Active fulfillment ({orders.length})</Button>
        <Button variant={view === "completed" ? "default" : "outline"} onClick={() => setView("completed")}>Completed orders ({completedOrders.length})</Button>
      </div>
    </PageToolbar>
    {view === "completed" && <p className="text-sm text-slate-600">Read-only archive of B2B orders that have reached the configured terminal workflow stage. Archived orders have no pickup, receipt, routing, transfer, or dispatch actions.</p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
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
    ].map((s: any) => <Card key={s.key} className="wh-dashboard-kpi"><CardContent className="p-4"><p className="text-sm text-slate-500">{s.label}</p><p className="mt-1 text-2xl font-bold">{Number(query.data?.data?.summary?.[s.key] ?? 0)}</p></CardContent></Card>)}</div>
    {(view === "active" ? query.isLoading : completedQuery.isLoading) ? <p className="py-12 text-center text-slate-500">Loading B2B orders…</p> : (view === "active" ? query.isError : completedQuery.isError) ? <Card><CardContent className="p-6 text-sm text-red-700">Could not load {view === "completed" ? "completed" : "active"} B2B orders. Check the API response and warehouse permissions, then refresh.</CardContent></Card> : !displayedOrders.length ? <Card><CardContent className="p-10 text-center text-slate-500">{view === "completed" ? "No completed B2B orders are archived for this warehouse yet." : "No B2B orders are currently in the pickup or fulfillment workflow."}</CardContent></Card> : <div className="space-y-4">{displayedOrders.map((o: any) => {
      const f = form(o.id);
      const teamId = String(f.pickupTeam || o.pickupTeam || "");
      const team = teams.find((t: any) => String(t.deliveryPartnerId || t.userId || t.id || t._id) === teamId);
      const vehicle = team ? [team.vehicleNumber, team.vehicleRegistrationNumber, team.registrationNumber, team.vehicleType].filter(Boolean).join(" · ") : (o.pickupVehicle || "");
      const orderName = o.orderNumber || `B2B-${o.id.slice(-6)}`;
      return <Card key={o.id || orderName}><CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{orderName}</h2><Badge>{label(o.status)}</Badge></div>
          <p className="mt-1 text-sm text-slate-700">{o.productName || "B2B produce"} · Ordered {o.quantityKg ?? "—"} kg · Packed {o.packedQuantityKg ?? "—"} kg · Received {o.receivedQuantityKg ?? o.destinationReceivedQuantityKg ?? "—"} kg</p>
          <div className="mt-2 grid gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 sm:grid-cols-2">
            <p><strong>Business delivery:</strong> {o.deliveryDeadline || o.requiredDate || o.scheduledDeliveryDate ? new Date(o.deliveryDeadline || o.requiredDate || o.scheduledDeliveryDate).toLocaleDateString("en-IN") : "Confirm delivery date"} · {o.deliveryTimeSlot || "Morning slot not specified"}</p>
            <p><strong>Farmer preparation:</strong> {o.farmerPrepareBy ? new Date(o.farmerPrepareBy).toLocaleString("en-IN") : "Set by delivery schedule"}</p>
            <p><strong>Pickup date:</strong> {o.pickupDate ? new Date(o.pickupDate).toLocaleDateString("en-IN") : "Awaiting pickup plan"}</p>
            <p><strong>Pickup window:</strong> {o.pickupWindowStart || "18:00"}–{o.pickupWindowEnd || "23:59"} (route cutoff may require earlier collection)</p>
            {o.transferDispatchDate && <p className="sm:col-span-2"><strong>Long-distance transfer target:</strong> {new Date(o.transferDispatchDate).toLocaleDateString("en-IN")} — one day before delivery, subject to route cutoff and transit feasibility.</p>}
          </div><p className="mt-1 text-sm text-slate-700">Business: {o.businessInfo?.businessName || o.businessName || "Business buyer"} · Farmer: {o.farmerInfo?.farmName || o.farmName || o.farmerName || "Farmer"}</p>
          <p className="mt-1 text-sm text-slate-500"><MapPin className="mr-1 inline h-4 w-4"/>{o.deliveryAddress || o.deliveryCity || o.deliveryLocation?.formattedAddress || "Business delivery address not available"}</p>
          <p className="text-xs text-slate-500">Farm location: {o.farmerInfo?.farmLocation || o.farmLocation || o.farmerInfo?.city || o.farmCity || "Location unavailable"} · Original order ID: {o.id}</p><p className="text-xs text-slate-500">Actual source warehouse: {routeRecommendations[o.id]?.sourceWarehouseName || o.sourceWarehouseName || o.sourceWarehouseId || "Not recorded"} · Destination warehouse: {o.destinationWarehouseName || o.destinationWarehouseId || (o.fulfillmentRoute === "long_distance" ? "Awaiting destination assignment" : routeRecommendations[o.id]?.available && routeRecommendations[o.id]?.fulfillmentRoute === "long_distance" ? routeRecommendations[o.id]?.destinationWarehouseName || "Awaiting confirmation" : routeRecommendations[o.id]?.available ? "Direct from source warehouse" : "Not selected")} · Route: {label(o.fulfillmentRoute || routeRecommendations[o.id]?.fulfillmentRoute || "routing_required")}</p>
          {o.status === "transfer_in_transit" && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><p className="font-semibold">{o.warehouseTransferSide === "source_outgoing" ? "Outgoing transfer · Source warehouse" : o.warehouseTransferSide === "destination_incoming" ? "Incoming transfer · Destination warehouse" : "Warehouse-to-warehouse transfer in transit"}</p><p className="mt-1">From: {o.sourceWarehouseName || o.sourceWarehouseId || "Source warehouse not recorded"}</p><p>To: {o.destinationWarehouseName || o.destinationWarehouseId || "Destination warehouse not recorded"}</p><p className="mt-1 text-xs">Original B2B order ID: {o.id} · Transfer dispatched: {o.transferDispatchedAt ? new Date(o.transferDispatchedAt).toLocaleString() : "Timestamp unavailable"}</p>{o.warehouseTransferSide === "destination_incoming" && <p className="mt-2 font-medium">This order is awaiting physical receipt and quality inspection at this destination warehouse.</p>}{o.warehouseTransferSide === "source_outgoing" && <p className="mt-2 font-medium">This order is outgoing from this source warehouse and awaiting destination receipt.</p>}</div>}
        </div><p className="font-semibold text-emerald-700">₹{Number(o.totalAmount || 0).toFixed(2)}</p></div>

        {view === "completed" ? <section className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <h3 className="font-semibold"><CheckCircle2 className="mr-2 inline h-4 w-4"/>Completed workflow — read only</h3>
          <p>This order is archived and cannot be processed again from this page.</p>
          {o.destinationReceivedAt && <p>Destination warehouse receipt: {new Date(o.destinationReceivedAt).toLocaleString("en-IN")} · Quality: {label(o.destinationQualityCheck || "unknown")} · Received: {o.destinationReceivedQuantityKg ?? "—"} kg</p>}
          {o.deliveredAt && <p>Business delivery recorded: {new Date(o.deliveredAt).toLocaleString("en-IN")}</p>}
          {o.completedAt && <p>Completion recorded: {new Date(o.completedAt).toLocaleString("en-IN")}</p>}
        </section> : <>
        {o.status === "ready_for_pickup" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4">
          <h3 className="font-medium"><Truck className="mr-2 inline h-4 w-4"/>Farm pickup assignment</h3>
          <p className="text-sm text-slate-600">Select a registered approved pickup team. Vehicle details come from the team record; do not type team IDs or vehicle numbers.</p>
          {teams.length ? <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="mb-1 block text-sm font-medium">Approved pickup team</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.pickupTeam || "")} onChange={e => setForm(o.id, { pickupTeam: e.target.value })}><option value="">Select registered team</option>{teams.map((t: any) => <option key={String(t.deliveryPartnerId || t.userId || t.id || t._id)} value={String(t.deliveryPartnerId || t.userId || t.id || t._id)}>{t.name || t.fullName || "Pickup team"}{t.vehicleType ? ` · ${t.vehicleType}` : ""}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</option>)}</select></div>
            <div><label className="mb-1 block text-sm font-medium">Registered vehicle</label><div className="flex min-h-10 items-center rounded-md border bg-white px-3 text-sm">{vehicle || "Select a team to view its vehicle"}</div></div>
          </div> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{teamsQuery.isError ? "Could not load the approved pickup-team roster." : "No approved pickup team with registered vehicle capacity is available. Configure one in Pickup Partners."}</p>}
          <Button disabled={mutation.isPending || !f.pickupTeam || !team || !vehicle || Boolean(o.pickupTeam)} onClick={() => act(o.id, { action: "assign_pickup", pickupTeam: String(team.deliveryPartnerId || team.userId || team.user_id || team.id || team._id), vehicle, pickupTeamName: team.name || team.fullName || "Pickup team" })}>Confirm Pickup Assignment</Button>
          {o.pickupTeam && <p className="text-sm text-emerald-800">Assigned to {o.pickupTeamName || team?.name || o.pickupTeam} · {o.pickupVehicle || vehicle}. Collection must be confirmed by the assigned pickup team.</p>}
        </section>}



        {(!o.warehouseReceivedAt && !o.destinationReceivedAt && !o.receivedAtWarehouseId && !["warehouse_received", "transfer_in_transit", "destination_warehouse_received", "in_transit", "delivered", "completed"].includes(String(o.status || "").toLowerCase()) && (o.status === "picked_up" || ["warehouse_arrived", "arrived_warehouse", "departed_farm", "collected"].includes(String(o.warehouseFulfillmentStage || o.warehouseCollectionStatus || "").toLowerCase()))) && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium"><PackageCheck className="mr-2 inline h-4 w-4"/>Warehouse receipt</h3><p className="text-sm text-slate-600">The pickup partner has collected this B2B order. Confirm the actual quantity received at this warehouse and the quality result here. This action updates the original B2B order; no separate Incoming Stock page is required for this workflow.</p><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium">Actual received quantity (kg)</label><Input type="number" min="0.01" step="0.01" value={f.receivedQuantityKg ?? String(o.packedQuantityKg || o.quantityKg || "")} onChange={e => setForm(o.id, { receivedQuantityKg: e.target.value })}/></div><div><label className="mb-1 block text-sm font-medium">Quality inspection</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={f.qualityCheck || "passed"} onChange={e => setForm(o.id, { qualityCheck: e.target.value })}><option value="passed">Passed</option><option value="failed">Failed</option></select></div></div><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Receipt and inspection notes (optional)"/><Button disabled={mutation.isPending || !(Number(f.receivedQuantityKg ?? o.packedQuantityKg ?? o.quantityKg) > 0)} onClick={() => act(o.id, { action: "receive_stock", receivedQuantityKg: Number(f.receivedQuantityKg ?? o.packedQuantityKg ?? o.quantityKg), qualityCheck: f.qualityCheck || "passed", notes: f.notes })}><ClipboardCheck className="mr-2 h-4 w-4"/>Confirm Warehouse Receipt</Button></section>}

        {o.status === "warehouse_received" && (
          <section className="space-y-3 rounded-xl border bg-slate-50 p-4">
            <h3 className="font-medium"><Warehouse className="mr-2 inline h-4 w-4" />Fulfillment routing</h3>
            {o.warehouseQualityCheck !== "passed" ? (
              <p className="text-sm text-red-700">Routing and dispatch are blocked until source warehouse quality is passed.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant={(routingMode[o.id] || "automatic") === "automatic" ? "default" : "outline"} onClick={() => setRoutingMode(prev => ({ ...prev, [o.id]: "automatic" }))}>Automatic routing</Button>
                  <Button variant={routingMode[o.id] === "manual" ? "default" : "outline"} onClick={() => setRoutingMode(prev => ({ ...prev, [o.id]: "manual" }))}>Choose route manually</Button>
                </div>
                {(routingMode[o.id] || "automatic") === "automatic" ? (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">Automatic routing compares the source warehouse district with the business delivery district. The 15 km threshold is not used for B2B orders.</p>
                    {recommendationQuery.isLoading ? <p className="rounded-lg border bg-white p-3 text-sm">Calculating route…</p> :
                     recommendationQuery.isError ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{(recommendationQuery.error as any)?.message || "Automatic route lookup failed."}</p><Button variant="outline" onClick={() => recommendationQuery.refetch()}>Retry</Button></div> :
                     !routeRecommendations[o.id]?.available ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{routeRecommendations[o.id]?.reason || "Delivery address or warehouse coordinates are missing."}</p><Button variant="outline" disabled={recommendationQuery.isFetching} onClick={() => recommendationQuery.refetch()}>Retry Automatic Route</Button></div> :
                     <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><p className="font-medium">Recommended: {label(routeRecommendations[o.id].fulfillmentRoute)}</p><p>Actual source warehouse: {routeRecommendations[o.id].sourceWarehouseName || o.sourceWarehouseName || o.sourceWarehouseId || "Source warehouse not recorded"}</p><p>Destination: {routeRecommendations[o.id].fulfillmentRoute === "long_distance" ? routeRecommendations[o.id].destinationWarehouseName || "No designated warehouse for business district" : "Source district warehouse"}</p><p>Routing basis: District</p><p>Source district: {routeRecommendations[o.id].sourceDistrict || "Not configured"}</p><p>Business district: {routeRecommendations[o.id].businessDistrict || "Not configured"}</p>{routeRecommendations[o.id].destinationAvailableCapacityKg != null && <p>Destination available capacity: {routeRecommendations[o.id].destinationAvailableCapacityKg} kg</p>}<p>{routeRecommendations[o.id].reason}</p>
                      {routeRecommendations[o.id].schedulePlan && <div className={`mt-2 rounded-md border p-2 ${routeRecommendations[o.id].schedulePlan.status === "urgent" ? "border-red-400 bg-red-50 text-red-950" : routeRecommendations[o.id].schedulePlan.status === "needs_review" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-blue-200 bg-blue-50 text-blue-950"}`}>
                        <p className="font-semibold">Delivery timing status: {routeRecommendations[o.id].schedulePlan.status === "urgent" ? "URGENT" : routeRecommendations[o.id].schedulePlan.status === "feasible" ? "ON TIME" : String(routeRecommendations[o.id].schedulePlan.status).replaceAll("_", " ").toUpperCase()}</p>
                        {routeRecommendations[o.id].schedulePlan.currentTime && <p>Current time: {new Date(routeRecommendations[o.id].schedulePlan.currentTime + (routeRecommendations[o.id].schedulePlan.currentTime.endsWith("Z") ? "" : "Z")).toLocaleString()}</p>}
                        {routeRecommendations[o.id].schedulePlan.estimatedTransitHours != null && <p>Estimated transfer time: {routeRecommendations[o.id].schedulePlan.estimatedTransitHours} hours ({routeRecommendations[o.id].schedulePlan.transitEstimateBasis === "configured" ? "configured warehouse value" : "distance-based estimate"})</p>}
                        {routeRecommendations[o.id].schedulePlan.estimatedArrivalAt && <p>Estimated arrival at destination warehouse: {new Date(routeRecommendations[o.id].schedulePlan.estimatedArrivalAt + (routeRecommendations[o.id].schedulePlan.estimatedArrivalAt.endsWith("Z") ? "" : "Z")).toLocaleString()}</p>}
                        {routeRecommendations[o.id].schedulePlan.deliveryDeadline && <p>Business delivery deadline: {new Date(routeRecommendations[o.id].schedulePlan.deliveryDeadline + (routeRecommendations[o.id].schedulePlan.deliveryDeadline.endsWith("Z") ? "" : "Z")).toLocaleString()}</p>}
                        {routeRecommendations[o.id].schedulePlan.arrivalComparison && <p className="font-semibold">Estimated destination arrival is {routeRecommendations[o.id].schedulePlan.arrivalComparison === "after_deadline" ? "AFTER the business deadline" : "BEFORE the business deadline"}.</p>}
                        {routeRecommendations[o.id].schedulePlan.transferDistanceKm != null && <p>Warehouse-to-warehouse distance: {routeRecommendations[o.id].schedulePlan.transferDistanceKm} km</p>}
                        {routeRecommendations[o.id].schedulePlan.recommendedDispatchDate && <p>Target dispatch date: {routeRecommendations[o.id].schedulePlan.recommendedDispatchDate}</p>}
                        <p>{routeRecommendations[o.id].schedulePlan.reason}</p>
                      </div>}
                    </div>}
                     <Button disabled={mutation.isPending || !routeRecommendations[o.id]?.available} onClick={() => act(o.id, { action: "set_fulfillment_route", fulfillmentRoute: routeRecommendations[o.id]?.fulfillmentRoute, destinationWarehouseId: routeRecommendations[o.id]?.destinationWarehouseId, estimatedTransferHours: f.estimatedTransferHours ? Number(f.estimatedTransferHours) : (routeRecommendations[o.id]?.schedulePlan?.estimatedTransitHours != null ? Number(routeRecommendations[o.id].schedulePlan.estimatedTransitHours) : undefined), transferDispatchCutoff: f.transferDispatchCutoff ? new Date(f.transferDispatchCutoff).toISOString() : undefined, notes: "Automatic district-based route confirmed for B2B business order." })}>Confirm District Route</Button>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-lg border bg-white p-3">
                    <p className="text-sm text-slate-600">Choose the route manually if needed. Server-side validation uses district matching, warehouse status and available capacity; distance does not determine B2B routing.</p>
                    <div><label className="mb-1 block text-sm font-medium">Fulfillment route</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.fulfillmentRoute || "")} onChange={e => setForm(o.id, { fulfillmentRoute: e.target.value, destinationWarehouseId: "" })}><option value="">Choose route</option><option value="nearby_single_farmer">Nearby — single farmer</option><option value="nearby_multi_farmer">Nearby — multiple farmers (consolidation)</option><option value="long_distance">Long distance — destination warehouse transfer</option></select></div>
                    {f.fulfillmentRoute === "long_distance" && <div className="space-y-2"><Button variant="outline" disabled={destinationQuery.isFetching} onClick={() => setDestinationOrderId(o.id)}>Load eligible destination warehouses</Button>{destinationOrderId === o.id && (destinationQuery.isLoading ? <p className="text-sm">Checking capacity…</p> : destinationQuery.isError ? <p className="text-sm text-red-700">{(destinationQuery.error as any)?.message || "Could not load destinations."}</p> : <select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.destinationWarehouseId || "")} onChange={e => setForm(o.id, { destinationWarehouseId: e.target.value })}><option value="">Select destination</option>{destinationWarehouses.map((w: any) => <option key={String(w.id)} value={String(w.id)}>{w.name} · {w.district || w.districtName || "District not recorded"} · {w.availableCapacityKg} kg free</option>)}</select>)}</div>}
                    <Button disabled={mutation.isPending || !f.fulfillmentRoute || (f.fulfillmentRoute === "long_distance" && (!f.destinationWarehouseId || !destinationWarehouses.some((w: any) => String(w.id) === String(f.destinationWarehouseId))))} onClick={() => act(o.id, { action: "set_fulfillment_route", fulfillmentRoute: f.fulfillmentRoute, destinationWarehouseId: f.fulfillmentRoute === "long_distance" ? f.destinationWarehouseId : undefined, notes: "Manually selected fulfillment route." })}>Save Manual Route</Button>
                  </div>
                )}
                {o.fulfillmentRoute === "long_distance" && o.destinationWarehouseId && <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-medium"><Truck className="mr-2 inline h-4 w-4"/>Inter-warehouse transfer dispatch</h3><p className="text-sm text-slate-700">Select a registered pickup/transfer team and its registered vehicle. Dispatch stays blocked until both are selected.</p><div><label className="mb-1 block text-sm font-medium">Registered transfer team</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.transferTeam || "")} onChange={e => { const selected = teams.find((t: any) => String(t.deliveryPartnerId || t.userId || t.id || t._id) === e.target.value); setForm(o.id, { transferTeam: e.target.value, transferTeamName: selected?.name || selected?.fullName || "", transferVehicle: selected ? [selected.vehicleNumber, selected.vehicleRegistrationNumber, selected.registrationNumber, selected.vehicleType].filter(Boolean).join(" · ") : "" }); }}><option value="">Select registered transfer team</option>{teams.map((t: any) => <option key={String(t.deliveryPartnerId || t.userId || t.id || t._id)} value={String(t.deliveryPartnerId || t.userId || t.id || t._id)}>{t.name || t.fullName || "Transfer team"}{t.vehicleType ? ` · ${t.vehicleType}` : ""}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</option>)}</select></div><div><label className="mb-1 block text-sm font-medium">Registered vehicle</label><div className="flex min-h-10 items-center rounded-md border bg-white px-3 text-sm">{f.transferVehicle || "Select a team to load its registered vehicle"}</div></div>{routeRecommendations[o.id]?.schedulePlan?.status === "urgent" && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Urgent recovery: estimated arrival at the destination warehouse is after the business delivery deadline. Dispatch may proceed, but the destination warehouse must prioritize receipt, processing and final delivery. {routeRecommendations[o.id].schedulePlan.reason}</p>}{routeRecommendations[o.id]?.schedulePlan && routeRecommendations[o.id].schedulePlan.status === "needs_review" && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Dispatch needs a valid delivery deadline and transfer-time estimate: {routeRecommendations[o.id].schedulePlan.reason}</p>}
                <Button disabled={mutation.isPending || !f.transferTeam || !f.transferVehicle || !["feasible", "urgent"].includes(routeRecommendations[o.id]?.schedulePlan?.status) || !teams.some((t: any) => String(t.deliveryPartnerId || t.userId || t.id || t._id) === String(f.transferTeam))} onClick={() => act(o.id, { action: "dispatch_to_destination", transferTeam: f.transferTeam, transferTeamName: f.transferTeamName, transferVehicle: f.transferVehicle, notes: f.notes || "Inter-warehouse transfer dispatched with assigned registered team." })}>Dispatch to Destination Warehouse</Button></section>}
                {o.fulfillmentRoute === "nearby_single_farmer" && <div className="space-y-3 rounded-lg border bg-white p-3"><p className="text-sm font-medium">Ready for direct delivery from source warehouse</p><label className="block text-sm font-medium">Registered delivery team</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.deliveryPartner || o.finalDeliveryPartner || "")} onChange={e => setForm(o.id, { deliveryPartner: e.target.value })}><option value="">Select registered team</option>{teams.map((t: any) => <option key={String(t.deliveryPartnerId || t.id || t._id)} value={String(t.deliveryPartnerId || t.id || t._id)}>{t.name || t.fullName || "Delivery team"}{t.vehicleType ? ` · ${t.vehicleType}` : ""}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</option>)}</select><Button disabled={mutation.isPending || !f.deliveryPartner || !teams.some((t: any) => [t.deliveryPartnerId, t.userId, t.user_id, t.id, t._id].filter((v: any) => v !== undefined && v !== null && v !== "").some((v: any) => String(v) === String(f.deliveryPartner)))} onClick={() => act(o.id, { action: "dispatch_to_buyer", deliveryPartner: f.deliveryPartner, notes: f.notes })}>Assign Delivery Team &amp; Dispatch</Button></div>}
                {o.fulfillmentRoute === "nearby_multi_farmer" && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Consolidation is required. Delivery remains blocked until every required farmer portion is received, inspected and consolidation is completed.<div className="mt-2"><Button variant="outline" disabled={mutation.isPending} onClick={() => act(o.id, { action: "complete_consolidation", notes: f.notes })}>Verify Portions &amp; Complete Consolidation</Button></div></div>}
              </>
            )}
          </section>
        )}

        {o.status === "transfer_in_transit" && o.transferPartnerStatus === "arrived_at_destination" && o.warehouseTransferSide === "destination_incoming" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium"><Warehouse className="mr-2 inline h-4 w-4"/>Destination warehouse receipt</h3>{String(o.sourceWarehouseId || "") === String(o.destinationWarehouseId || "") || !o.sourceWarehouseId || !o.destinationWarehouseId ? <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"><p className="font-semibold">Invalid warehouse transfer — receipt blocked</p><p className="mt-1">Source and destination must be different, registered warehouses. This order currently shows source: {o.sourceWarehouseName || o.sourceWarehouseId || "missing"}; destination: {o.destinationWarehouseName || o.destinationWarehouseId || "missing"}. Do not confirm receipt until the actual dispatched destination is verified and the transfer record is corrected.</p></div> : <><div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"><p className="font-medium">Receiving at: {o.destinationWarehouseName || o.destinationWarehouseId}</p><p>Dispatched from: {o.sourceWarehouseName || o.sourceWarehouseId}</p></div><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium">Actual received quantity (kg)</label><Input type="number" min="0.01" step="0.01" value={f.receivedQuantityKg ?? String(o.receivedQuantityKg || o.quantityKg || "")} onChange={e => setForm(o.id, { receivedQuantityKg: e.target.value })}/></div><div><label className="mb-1 block text-sm font-medium">Quality inspection</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={f.qualityCheck || "passed"} onChange={e => setForm(o.id, { qualityCheck: e.target.value })}><option value="passed">Passed</option><option value="failed">Failed</option></select></div></div><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Destination receipt notes (optional)"/><Button disabled={mutation.isPending || !(Number(f.receivedQuantityKg ?? o.receivedQuantityKg ?? o.quantityKg) > 0)} onClick={() => act(o.id, { action: "receive_at_destination", receivedQuantityKg: Number(f.receivedQuantityKg ?? o.receivedQuantityKg ?? o.quantityKg), qualityCheck: f.qualityCheck || "passed", notes: f.notes })}>Confirm Destination Receipt</Button></>}</section>}

        {o.status === "destination_warehouse_received" && o.warehouseTransferSide !== "source_outgoing" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium">Destination warehouse received</h3><p className="text-sm text-slate-600">Destination receipt is recorded. For a multi-farmer B2B order, all portions must arrive at this district warehouse and pass quality inspection before consolidation and final delivery.</p>{o.fulfillmentRoute === "long_distance" && Number(o.b2bFarmerCount || 1) > 1 && !o.consolidationCompletedAt && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Multi-farmer consolidation check</p><p className="mt-1">Use this action when the B2B RFQ contains multiple farmer portions. The backend verifies every portion has reached the same destination district warehouse and passed quality inspection; single-farmer orders will be rejected by the server if consolidation is not required.</p><Button className="mt-2" variant="outline" disabled={mutation.isPending} onClick={() => act(o.id, { action: "complete_consolidation", notes: "Verify all B2B farmer portions at destination district warehouse." })}>Verify Portions &amp; Complete Consolidation</Button></div>}{o.destinationQualityCheck !== "passed" ? <p className="text-sm text-red-700">Final delivery blocked until destination quality is passed.</p> : <><div><label className="mb-1 block text-sm font-medium">Assign delivery team</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.deliveryPartner || o.finalDeliveryPartner || "")} onChange={e => setForm(o.id, { deliveryPartner: e.target.value })}><option value="">Select a registered team</option>{teams.map((t: any) => <option key={String(t.deliveryPartnerId || t.id || t._id)} value={String(t.deliveryPartnerId || t.id || t._id)}>{t.name || t.fullName || "Delivery team"}{t.vehicleType ? ` · ${t.vehicleType}` : ""}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</option>)}</select></div><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Delivery notes (optional)"/><Button disabled={mutation.isPending || !(f.deliveryPartner || o.finalDeliveryPartner) || !teams.some((t: any) => String(t.deliveryPartnerId || t.userId || t.id || t._id) === String(f.deliveryPartner || o.finalDeliveryPartner)) || Boolean(Number(o.b2bFarmerCount || 1) > 1 && !o.consolidationCompletedAt)} onClick={() => act(o.id, { action: "dispatch_to_buyer", deliveryPartner: f.deliveryPartner || o.finalDeliveryPartner, notes: f.notes })}>Assign Final Delivery Team &amp; Dispatch</Button></>}</section>}

        {o.status === "in_transit" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium"><Truck className="mr-2 inline h-4 w-4"/>Delivery to business</h3><p className="text-sm text-slate-600">Assigned delivery partner: {o.finalDeliveryPartnerName || o.finalDeliveryPartner || "Not recorded"}</p><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Required proof of delivery / handoff notes"/><Button disabled={mutation.isPending || !String(f.notes || "").trim()} onClick={() => act(o.id, { action: "confirm_delivery", notes: f.notes })}><CheckCircle2 className="mr-2 h-4 w-4"/>Confirm Delivered to Business</Button></section>}

        {["at_risk", "needs_review"].includes(routeRecommendations[o.id]?.schedulePlan?.status) && !["delivered", "completed", "cancelled"].includes(o.status) && <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-semibold text-amber-950">Delivery deadline recovery</h3><p className="text-sm text-amber-900">This order needs an operational decision before dispatch. Confirm a new feasible business delivery date and morning time slot with the buyer, then record the agreed change here. Saving notifies the business buyer.</p><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium">New delivery date</label><Input type="date" min={new Date().toISOString().slice(0, 10)} value={f.newDeliveryDeadline || ""} onChange={e => setForm(o.id, { newDeliveryDeadline: e.target.value })}/></div><div><label className="mb-1 block text-sm font-medium">New morning time slot</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={f.newDeliveryTimeSlot || ""} onChange={e => setForm(o.id, { newDeliveryTimeSlot: e.target.value })}><option value="">Select agreed slot</option><option value="06:00-08:00">6:00–8:00 AM</option><option value="07:00-09:00">7:00–9:00 AM</option><option value="08:00-10:00">8:00–10:00 AM</option><option value="09:00-11:00">9:00–11:00 AM</option></select></div></div><div><label className="mb-1 block text-sm font-medium">Reason agreed with business</label><Input value={f.rescheduleReason || ""} onChange={e => setForm(o.id, { rescheduleReason: e.target.value })} placeholder="Explain the cutoff, transfer, or capacity issue"/></div><Button disabled={mutation.isPending || !f.newDeliveryDeadline || !f.newDeliveryTimeSlot || !String(f.rescheduleReason || "").trim()} onClick={() => act(o.id, { action: "reschedule_delivery", newDeliveryDeadline: f.newDeliveryDeadline, newDeliveryTimeSlot: f.newDeliveryTimeSlot, rescheduleReason: f.rescheduleReason })}>Save agreed schedule &amp; notify business</Button></section>}
         {["delivered", "completed"].includes(o.status) && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Business delivery recorded. Final status: {label(o.status)}.</p>}
        </>}
      </CardContent></Card>;
    })}</div>}
  </div>;
}
