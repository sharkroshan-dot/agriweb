"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Truck, Warehouse, RefreshCw, CheckCircle2, MapPin, ClipboardCheck } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/api/client";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";

const label = (value: string) => String(value || "unknown").replace(/_/g, " ");
const stages = [
  { label: "Ready for pickup", statuses: ["ready_for_pickup"] },
  { label: "Collected from farm", statuses: ["picked_up"] },
  { label: "Warehouse received", statuses: ["warehouse_received"] },
  { label: "Transfer in transit", statuses: ["transfer_in_transit"] },
  { label: "Destination received", statuses: ["destination_warehouse_received"] },
  { label: "Delivery in transit", statuses: ["in_transit"] },
  { label: "Delivered to business", statuses: ["delivered", "completed"] },
];

export default function B2BFulfillmentPage() {
  const qc = useQueryClient();
  const [forms, setForms] = useState<Record<string, any>>({});
  const query = useQuery({ queryKey: ["b2b", "warehouse-fulfillment"], queryFn: () => api.get("/b2b/warehouse/fulfillment"), refetchInterval: 10000 });
  const teamsQuery = useQuery({ queryKey: ["b2b", "approved-pickup-teams"], queryFn: () => api.get("/warehouse/me/pickup-team/members"), refetchInterval: 30000 });
  const orders = (query.data?.data?.orders || query.data?.orders || []).map((o: any) => ({ ...o, id: String(o.id || o._id || "") }));
  const members = teamsQuery.data?.data?.members || teamsQuery.data?.members || [];
  const teams = members.filter((t: any) => Number(t.capacity || t.vehicleCapacity || 0) > 0);
  const mutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.put(`/b2b/warehouse/fulfillment/${id}`, payload),
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

  return <div className="space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">B2B Pickup &amp; Fulfillment</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">The dedicated control center for business orders: farm pickup, warehouse receipt, transfer, delivery and business handoff. All actions update the original B2B order.</p></div>
      <Button variant="outline" onClick={() => { query.refetch(); teamsQuery.refetch(); }}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stages.map(s => <Card key={s.label}><CardContent className="p-4"><p className="text-sm text-slate-500">{s.label}</p><p className="mt-1 text-2xl font-bold">{orders.filter((o: any) => s.statuses.includes(o.status)).length}</p></CardContent></Card>)}</div>
    {query.isLoading ? <p className="py-12 text-center text-slate-500">Loading B2B orders…</p> : query.isError ? <Card><CardContent className="p-6 text-sm text-red-700">Could not load B2B orders. Check the API response and warehouse permissions, then refresh.</CardContent></Card> : !orders.length ? <Card><CardContent className="p-10 text-center text-slate-500">No B2B orders are currently in the pickup or fulfillment workflow.</CardContent></Card> : <div className="space-y-4">{orders.map((o: any) => {
      const f = form(o.id);
      const teamId = String(f.pickupTeam || o.pickupTeam || "");
      const team = teams.find((t: any) => String(t.id || t._id || t.deliveryPartnerId) === teamId);
      const vehicle = team ? [team.vehicleNumber, team.vehicleRegistrationNumber, team.registrationNumber, team.vehicleType].filter(Boolean).join(" · ") : (o.pickupVehicle || "");
      const orderName = o.orderNumber || `B2B-${o.id.slice(-6)}`;
      return <Card key={o.id || orderName}><CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{orderName}</h2><Badge>{label(o.status)}</Badge></div>
          <p className="mt-1 text-sm text-slate-700">{o.productName || "B2B produce"} · {o.quantityKg ?? o.packedQuantityKg ?? "—"} kg · {o.businessInfo?.businessName || o.businessName || "Business buyer"}</p>
          <p className="mt-1 text-sm text-slate-500"><MapPin className="mr-1 inline h-4 w-4"/>{o.deliveryAddress || o.deliveryCity || o.deliveryLocation?.formattedAddress || "Business delivery address not available"}</p>
          <p className="text-xs text-slate-500">Farm: {o.farmerInfo?.farmName || o.farmName || o.farmerName || "Farmer"} · Order ID: {o.id}</p>
        </div><p className="font-semibold text-emerald-700">₹{Number(o.totalAmount || 0).toFixed(2)}</p></div>

        {o.status === "ready_for_pickup" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4">
          <h3 className="font-medium"><Truck className="mr-2 inline h-4 w-4"/>Farm pickup assignment</h3>
          <p className="text-sm text-slate-600">Select a registered approved pickup team. Vehicle details come from the team record; do not type team IDs or vehicle numbers.</p>
          {teams.length ? <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="mb-1 block text-sm font-medium">Approved pickup team</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.pickupTeam || "")} onChange={e => setForm(o.id, { pickupTeam: e.target.value })}><option value="">Select registered team</option>{teams.map((t: any) => <option key={String(t.id || t._id || t.deliveryPartnerId)} value={String(t.id || t._id || t.deliveryPartnerId)}>{t.name || t.fullName || "Pickup team"}{t.vehicleType ? ` · ${t.vehicleType}` : ""}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</option>)}</select></div>
            <div><label className="mb-1 block text-sm font-medium">Registered vehicle</label><div className="flex min-h-10 items-center rounded-md border bg-white px-3 text-sm">{vehicle || "Select a team to view its vehicle"}</div></div>
          </div> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{teamsQuery.isError ? "Could not load the approved pickup-team roster." : "No approved pickup team with registered vehicle capacity is available. Configure one in Pickup Partners."}</p>}
          <Button disabled={mutation.isPending || !f.pickupTeam || !team || !vehicle || Boolean(o.pickupTeam)} onClick={() => act(o.id, { action: "assign_pickup", pickupTeam: String(team.id || team._id || team.deliveryPartnerId), vehicle, pickupTeamName: team.name || team.fullName || "Pickup team" })}>Confirm Pickup Assignment</Button>
          {o.pickupTeam && <p className="text-sm text-emerald-800">Assigned to {o.pickupTeamName || team?.name || o.pickupTeam} · {o.pickupVehicle || vehicle}. Collection must be confirmed by the assigned pickup team.</p>}
        </section>}

        {o.status === "ready_for_pickup" && o.pickupTeam && <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-medium"><Truck className="mr-2 inline h-4 w-4"/>Assigned pickup handoff</h3><p className="text-sm text-slate-700">The assigned pickup team records the collection here. This changes the same B2B order to Picked Up so the warehouse receipt step becomes available.</p><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Pickup notes / collection proof (optional)"/><Button disabled={mutation.isPending} onClick={() => act(o.id, { action: "confirm_pickup", notes: f.notes })}>Confirm Farm Collection</Button></section>}

        {o.status === "picked_up" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium"><PackageCheck className="mr-2 inline h-4 w-4"/>Warehouse receipt</h3><p className="text-sm text-slate-600">Record the physical quantity and quality result. Failed quality must block dispatch.</p><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium">Actual received quantity (kg)</label><Input type="number" min="0.01" step="0.01" value={f.receivedQuantityKg ?? String(o.packedQuantityKg || o.quantityKg || "")} onChange={e => setForm(o.id, { receivedQuantityKg: e.target.value })}/></div><div><label className="mb-1 block text-sm font-medium">Quality inspection</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={f.qualityCheck || "passed"} onChange={e => setForm(o.id, { qualityCheck: e.target.value })}><option value="passed">Passed</option><option value="failed">Failed</option></select></div></div><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Receipt and inspection notes (optional)"/><Button disabled={mutation.isPending || !(Number(f.receivedQuantityKg ?? o.packedQuantityKg ?? o.quantityKg) > 0)} onClick={() => act(o.id, { action: "receive_stock", receivedQuantityKg: Number(f.receivedQuantityKg ?? o.packedQuantityKg ?? o.quantityKg), qualityCheck: f.qualityCheck || "passed", notes: f.notes })}><ClipboardCheck className="mr-2 h-4 w-4"/>Confirm Warehouse Receipt</Button></section>}

        {o.status === "warehouse_received" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium"><Warehouse className="mr-2 inline h-4 w-4"/>Next fulfillment stage</h3>{o.warehouseQualityCheck !== "passed" ? <p className="text-sm text-red-700">Dispatch blocked until source warehouse quality is passed.</p> : o.sourceWarehouseId && o.destinationWarehouseId && String(o.sourceWarehouseId) !== String(o.destinationWarehouseId) ? <><p className="text-sm text-slate-600">Dispatch this packed order to its configured destination warehouse.</p><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Transfer notes (optional)"/><Button disabled={mutation.isPending} onClick={() => act(o.id, { action: "dispatch_to_destination", notes: f.notes })}>Dispatch to Destination Warehouse</Button></> : <><p className="text-sm text-slate-600">No separate destination warehouse is configured. Continue to final-mile delivery.</p><div><label className="mb-1 block text-sm font-medium">Assign delivery team</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.deliveryPartner || o.finalDeliveryPartner || "")} onChange={e => setForm(o.id, { deliveryPartner: e.target.value })}><option value="">Select a registered team</option>{teams.map((t: any) => <option key={String(t.deliveryPartnerId || t.id || t._id)} value={String(t.deliveryPartnerId || t.id || t._id)}>{t.name || t.fullName || "Delivery team"}{t.vehicleType ? ` · ${t.vehicleType}` : ""}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</option>)}</select></div><Button disabled={mutation.isPending || !f.deliveryPartner || !teams.some((t: any) => String(t.deliveryPartnerId || t.id || t._id) === String(f.deliveryPartner))} onClick={() => act(o.id, { action: "dispatch_to_buyer", deliveryPartner: f.deliveryPartner, notes: f.notes })}>Assign Delivery Team &amp; Dispatch</Button></>}</section>}

        {o.status === "transfer_in_transit" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium"><Warehouse className="mr-2 inline h-4 w-4"/>Destination warehouse receipt</h3><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-sm font-medium">Actual received quantity (kg)</label><Input type="number" min="0.01" step="0.01" value={f.receivedQuantityKg ?? String(o.receivedQuantityKg || o.quantityKg || "")} onChange={e => setForm(o.id, { receivedQuantityKg: e.target.value })}/></div><div><label className="mb-1 block text-sm font-medium">Quality inspection</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={f.qualityCheck || "passed"} onChange={e => setForm(o.id, { qualityCheck: e.target.value })}><option value="passed">Passed</option><option value="failed">Failed</option></select></div></div><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Destination receipt notes (optional)"/><Button disabled={mutation.isPending || !(Number(f.receivedQuantityKg ?? o.receivedQuantityKg ?? o.quantityKg) > 0)} onClick={() => act(o.id, { action: "receive_at_destination", receivedQuantityKg: Number(f.receivedQuantityKg ?? o.receivedQuantityKg ?? o.quantityKg), qualityCheck: f.qualityCheck || "passed", notes: f.notes })}>Confirm Destination Receipt</Button></section>}

        {o.status === "destination_warehouse_received" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium">Final delivery to business</h3>{o.destinationQualityCheck !== "passed" ? <p className="text-sm text-red-700">Final delivery blocked until destination quality is passed.</p> : <><div><label className="mb-1 block text-sm font-medium">Assign delivery team</label><select className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={String(f.deliveryPartner || o.finalDeliveryPartner || "")} onChange={e => setForm(o.id, { deliveryPartner: e.target.value })}><option value="">Select a registered team</option>{teams.map((t: any) => <option key={String(t.deliveryPartnerId || t.id || t._id)} value={String(t.deliveryPartnerId || t.id || t._id)}>{t.name || t.fullName || "Delivery team"}{t.vehicleType ? ` · ${t.vehicleType}` : ""}{t.vehicleNumber ? ` · ${t.vehicleNumber}` : ""}</option>)}</select></div><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Delivery notes (optional)"/><Button disabled={mutation.isPending || !f.deliveryPartner || !teams.some((t: any) => String(t.deliveryPartnerId || t.id || t._id) === String(f.deliveryPartner))} onClick={() => act(o.id, { action: "dispatch_to_buyer", deliveryPartner: f.deliveryPartner, notes: f.notes })}>Assign Final Delivery Team &amp; Dispatch</Button></>}</section>}

        {o.status === "in_transit" && <section className="space-y-3 rounded-xl border bg-slate-50 p-4"><h3 className="font-medium"><Truck className="mr-2 inline h-4 w-4"/>Delivery to business</h3><p className="text-sm text-slate-600">Assigned delivery partner: {o.finalDeliveryPartner || "Not recorded"}</p><Input value={f.notes || ""} onChange={e => setForm(o.id, { notes: e.target.value })} placeholder="Proof of delivery / handoff notes"/><Button disabled={mutation.isPending} onClick={() => act(o.id, { action: "confirm_delivery", notes: f.notes })}><CheckCircle2 className="mr-2 h-4 w-4"/>Confirm Delivered to Business</Button></section>}

        {["delivered", "completed"].includes(o.status) && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Business delivery recorded. Final status: {label(o.status)}.</p>}
      </CardContent></Card>;
    })}</div>}
  </div>;
}
