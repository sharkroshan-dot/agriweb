"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, PackageCheck, Clock, AlertTriangle, RefreshCw, Truck, Loader2 } from "lucide-react";
import { api } from "../../../../lib/api/client";
import { Card, CardContent } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Badge } from "../../../../components/ui/badge";
import toast from "react-hot-toast";

function dateLabel(value?: string) {
  if (!value) return "Not scheduled";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Not scheduled" : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function FarmerB2bPreparationPage() {
  const qc = useQueryClient();
  const [availableQty, setAvailableQty] = useState<Record<string, string>>({});
  const [packedQty, setPackedQty] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const query = useQuery({
    queryKey: ["farmerB2bPreparation"],
    queryFn: () => api.get("/b2b/contracts/me"),
    refetchInterval: 30000,
  });

  const contracts = useMemo(() => {
    const list = query.data?.data?.contracts || query.data?.data || [];
    return (Array.isArray(list) ? list : [])
      .map((c: any) => ({ ...c, id: String(c.id || c._id || "") }))
      .filter((c: any) => c.id && c.status === "active")
      .sort((a: any, b: any) => {
        const at = new Date(a.nextDeliveryAt || a.pickupDate || a.startDate || 0).getTime();
        const bt = new Date(b.nextDeliveryAt || b.pickupDate || b.startDate || 0).getTime();
        return at - bt;
      });
  }, [query.data]);

  const ordersQuery = useQuery({
    queryKey: ["farmerB2bPreparationOrders"],
    queryFn: () => api.get("/b2b/orders"),
    refetchInterval: 30000,
  });
  const [orderPackedQty, setOrderPackedQty] = useState<Record<string, string>>({});
  const orderPreparationMutation = useMutation({
    mutationFn: ({ id, status, packedQuantityKg, qualityCheck, qualityNotes }: { id: string; status: string; packedQuantityKg?: number; qualityCheck?: string; qualityNotes?: string }) =>
      api.put(`/b2b/orders/${encodeURIComponent(id)}/status`, { status, packedQuantityKg, qualityCheck, qualityNotes }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["farmerB2bPreparationOrders"] }),
        qc.invalidateQueries({ queryKey: ["b2b", "orders"] }),
      ]);
      toast.success("B2B order preparation updated.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not update B2B order preparation"),
  });
  const oneTimeOrders = useMemo(() => {
    const list = ordersQuery.data?.data?.orders || [];
    return (Array.isArray(list) ? list : [])
      .map((o: any) => ({ ...o, id: String(o.id || o._id || "") }))
      .filter((o: any) => o.id && !o.contractId && ["confirmed", "preparing", "quality_check"].includes(o.status))
      .sort((a: any, b: any) => new Date(a.deliveryDeadline || a.requiredDate || a.createdAt || 0).getTime() - new Date(b.deliveryDeadline || b.requiredDate || b.createdAt || 0).getTime());
  }, [ordersQuery.data]);

  const stockMutation = useMutation({
    mutationFn: ({ id, available, packed, ready, note, scheduledDate }: { id: string; available: number; packed: number; ready: boolean; note: string; scheduledDate?: string }) =>
      api.post(`/b2b/contracts/${encodeURIComponent(id)}/delivery-confirmation`, {
        availableQuantityKg: available,
        packedQuantityKg: packed,
        readyForPickup: ready,
        scheduledDate,
        notes: note || undefined,
      }),
    onSuccess: async (res: any) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["farmerB2bPreparation"] }),
        qc.invalidateQueries({ queryKey: ["farmerContracts"] }),
      ]);
      const status = res?.data?.data?.status || res?.data?.status;
      toast.success(status === "shortage" ? "Shortage reported. The business can review the delivery." : "Stock preparation saved.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not save stock preparation"),
  });

  const getDeliveryContext = (c: any) => {
    // Business-approved/rescheduled occurrences can differ from the regular
    // recurring cursor. Always act on the exact occurrence waiting for farmer
    // confirmation rather than blindly submitting nextDeliveryAt.
    const scheduledDate = String(c.pendingFarmerDeliveryDate || c.nextDeliveryAt || "").slice(0, 10) || undefined;
    const occurrence = (Array.isArray(c.deliveryHistory) ? c.deliveryHistory : [])
      .find((item: any) => String(item.scheduledDate || "").slice(0, 10) === scheduledDate);
    const contractRequired = Number(c.quantityPerDeliveryKg ?? c.quantityPerMonthKg ?? 0);
    const approvedQuantity = Number(occurrence?.approvedQuantityKg || 0);
    const isApprovedPartial = approvedQuantity > 0
      && ["partial_approved", "replacement_assigned"].includes(String(occurrence?.status || "").toLowerCase());
    return {
      scheduledDate,
      occurrence,
      contractRequired,
      approvedQuantity,
      isApprovedPartial,
      targetQuantity: isApprovedPartial ? approvedQuantity : contractRequired,
    };
  };

  const prepare = (c: any, ready: boolean) => {
    const availableRaw = availableQty[c.id] ?? "";
    const packedRaw = packedQty[c.id] ?? "";
    if (!availableRaw.trim() || !packedRaw.trim()) {
      toast.error("Enter both available and packed quantities.");
      return;
    }
    const available = Number(availableRaw);
    const packed = Number(packedRaw);
    const { targetQuantity, scheduledDate, isApprovedPartial } = getDeliveryContext(c);
    if (!Number.isFinite(available) || !Number.isFinite(packed) || available < 0 || packed < 0) {
      toast.error("Quantities must be valid non-negative numbers.");
      return;
    }
    if (packed > available) {
      toast.error("Packed quantity cannot exceed available quantity.");
      return;
    }
    if (ready && (packed <= 0 || packed < targetQuantity)) {
      toast.error(
        isApprovedPartial
          ? `The business approved ${targetQuantity} kg. Pack at least ${targetQuantity} kg before confirming ready for pickup.`
          : `Pack the full required quantity (${targetQuantity} kg) before confirming ready for pickup.`,
      );
      return;
    }
    if (ready && available < targetQuantity) {
      toast.error(`Available stock must cover the pickup quantity (${targetQuantity} kg).`);
      return;
    }
    if (!ready && !notes[c.id]?.trim()) {
      toast.error("Explain the shortage so the business can decide how to proceed.");
      return;
    }
    // Keep calendar dates as YYYY-MM-DD; don't shift them through UTC conversion.
    stockMutation.mutate({ id: c.id, available, packed, ready, note: notes[c.id] || "", scheduledDate });
  };

  const requiredTotal = contracts.reduce((sum: number, c: any) => sum + Number(c.quantityPerDeliveryKg ?? c.quantityPerMonthKg ?? 0), 0);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">B2B Supply Preparation</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Prepare and confirm stock for upcoming business deliveries from here. This is a separate page under B2B &amp; Bulk, not a dashboard widget. Saved quantities are submitted to AgriConnect.</p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Upcoming active supplies</p><p className="mt-1 text-2xl font-bold">{contracts.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Required quantity per listed delivery</p><p className="mt-1 text-2xl font-bold">{requiredTotal.toLocaleString("en-IN")} kg</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Preparation rule</p><p className="mt-1 text-sm font-semibold text-emerald-700">Pack the full quantity, or the business-approved partial quantity</p></CardContent></Card>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">One-time B2B order preparation</h2>
          <p className="text-sm text-slate-500">Accepted one-time orders appear here as well as recurring contract deliveries. Actual packed quantity is saved on the original B2B order.</p>
        </div>
        {ordersQuery.isLoading ? <Card><CardContent className="p-4 text-sm text-slate-500">Loading one-time B2B orders…</CardContent></Card> :
          ordersQuery.isError ? <Card><CardContent className="p-4 text-sm text-red-700">Could not load one-time B2B orders. Refresh or check the B2B orders API.</CardContent></Card> :
          oneTimeOrders.length === 0 ? <Card><CardContent className="p-4 text-sm text-slate-500">No one-time B2B orders currently need preparation.</CardContent></Card> :
          <div className="space-y-3">{oneTimeOrders.map((o: any) => {
            const packed = orderPackedQty[o.id] ?? String(o.packedQuantityKg ?? "");
            const required = Number(o.quantityKg || 0);
            return <Card key={o.id}><CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h3 className="font-semibold">{o.orderNumber || `B2B-${o.id.slice(-6)}`} · {o.productName || "Produce"}</h3>
                  <p className="text-sm text-slate-600">Required: {required} kg · Business: {o.businessInfo?.businessName || o.businessName || "Business buyer"}</p>
                  <p className="text-sm text-slate-600">Delivery: {dateLabel(o.deliveryDeadline || o.requiredDate || o.scheduledDeliveryDate)} · Prepare by: {dateLabel(o.farmerPrepareBy)}</p>
                </div><Badge variant="outline">{String(o.status).replace(/_/g, " ")}</Badge>
              </div>
              {o.status === "confirmed" ? <Button disabled={orderPreparationMutation.isPending} onClick={() => orderPreparationMutation.mutate({ id: o.id, status: "preparing" })}>Start preparation</Button> :
                o.status === "preparing" ? <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px] flex-1 space-y-1"><label className="text-sm font-medium">Actual packed quantity (kg)</label>
                    <Input type="number" min="0" max={required} step="0.1" value={packed} onChange={e => setOrderPackedQty(old => ({ ...old, [o.id]: e.target.value }))} placeholder={`Required: ${required} kg`} />
                  </div>
                  <Button disabled={orderPreparationMutation.isPending || !packed.trim() || !Number.isFinite(Number(packed)) || Number(packed) <= 0 || Number(packed) > required} onClick={() => {
                    if (Number(packed) < required) {
                      toast.error("This order has a shortage. Report it to the business before moving the order to quality check.");
                      return;
                    }
                    orderPreparationMutation.mutate({ id: o.id, status: "quality_check", packedQuantityKg: Number(packed) });
                  }}>Save packed quantity &amp; submit for quality check</Button>
                </div> :
                <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                  <p className="text-sm text-slate-700">Packed: {Number(o.packedQuantityKg || 0)} kg · Required: {required} kg. Complete the farmer quality check before sending this order to the warehouse pickup queue.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={orderPreparationMutation.isPending || Number(o.packedQuantityKg || 0) < required} onClick={() => orderPreparationMutation.mutate({ id: o.id, status: "quality_check", qualityCheck: "passed", qualityNotes: "Farmer quality check passed" })}>Pass quality check</Button>
                    <Button variant="outline" disabled={orderPreparationMutation.isPending} onClick={() => orderPreparationMutation.mutate({ id: o.id, status: "quality_check", qualityCheck: "failed", qualityNotes: "Farmer quality check failed; reinspection required" })}>Mark quality failed</Button>
                    {o.qualityCheck === "passed" && <Button disabled={orderPreparationMutation.isPending} onClick={() => orderPreparationMutation.mutate({ id: o.id, status: "ready_for_pickup" })}>Confirm ready for farm pickup</Button>}
                  </div>
                  {o.qualityCheck === "failed" && <p className="text-sm text-amber-800">Quality failed. Resolve the issue and pass inspection before confirming pickup readiness.</p>}
                </div>}
              {o.status === "preparing" && <p className="text-xs text-slate-500">A shortage cannot be marked as full supply. Report shortages through the business order/contract workflow before pickup.</p>}
            </CardContent></Card>;
          })}</div>}
      </section>

      {query.isLoading ? (
        <Card><CardContent className="flex items-center justify-center gap-2 p-12 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Loading your B2B supply schedule…</CardContent></Card>
      ) : query.isError ? (
        <Card><CardContent className="p-6 text-sm text-red-700">Could not load your B2B supply schedule. Check your login and backend API, then refresh.</CardContent></Card>
      ) : contracts.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center p-12 text-center"><PackageCheck className="h-10 w-10 text-slate-300" /><h2 className="mt-3 font-semibold">No active B2B supply deliveries</h2><p className="mt-1 max-w-lg text-sm text-slate-500">Active supply contracts will appear here when a business has scheduled deliveries. Manage agreements in Business Contracts.</p></CardContent></Card>
      ) : (
        <div className="space-y-4">
          {contracts.map((c: any) => {
            const delivery = getDeliveryContext(c);
            const required = delivery.contractRequired;
            const targetQuantity = delivery.targetQuantity;
            const available = availableQty[c.id] ?? "";
            const packed = packedQty[c.id] ?? "";
            const shortage = available !== "" && packed !== "" && Number(packed) < targetQuantity;
            return (
              <Card key={c.id} className="overflow-hidden">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{c.contractNumber || `B2B contract ${c.id.slice(-6)}`}</h2><Badge variant="outline">{c.cropName || "Produce"}</Badge><Badge variant={c.latestDeliveryStatus === "ready_for_pickup" ? "success" : "secondary"}>{String(c.latestDeliveryStatus || "preparation_required").replace(/_/g, " ")}</Badge></div>
                      <p className="mt-1 text-sm text-slate-600">Business: {c.businessName || "Business buyer"} · Contract quantity: <strong>{required} kg</strong>{delivery.isApprovedPartial && <> · Approved pickup quantity: <strong className="text-emerald-700">{targetQuantity} kg</strong></>}</p>
                    </div>
                    <div className="min-w-[220px] space-y-1 text-sm text-slate-600">
                      <p><CalendarClock className="mr-1 inline h-4 w-4" /><strong>Delivery:</strong> {dateLabel(delivery.scheduledDate)}</p>
                      <p><Clock className="mr-1 inline h-4 w-4" /><strong>Prepare by:</strong> {dateLabel(c.farmerPrepareBy)}</p>
                      <p><Truck className="mr-1 inline h-4 w-4" /><strong>Pickup:</strong> {dateLabel(c.plannedPickupAt || c.pickupDate || c.pickupDeadline)}</p>
                      {(c.pickupWindowStart || c.pickupWindowEnd) && <p><strong>Pickup window:</strong> {c.pickupWindowStart || "—"}–{c.pickupWindowEnd || "—"}</p>}
                    </div>
                  </div>

                  <div className="grid gap-4 rounded-xl border bg-slate-50 p-4 sm:grid-cols-2">
                    <div className="space-y-1"><label className="text-sm font-medium">{c.cropName || "Produce"} — Available (kg)</label><Input type="number" min="0" step="0.1" value={available} onChange={(e) => setAvailableQty(old => ({ ...old, [c.id]: e.target.value }))} placeholder="Enter available stock" /></div>
                    <div className="space-y-1"><label className="text-sm font-medium">{c.cropName || "Produce"} — Packed (kg)</label><Input type="number" min="0" step="0.1" value={packed} onChange={(e) => setPackedQty(old => ({ ...old, [c.id]: e.target.value }))} placeholder={`Required: ${required} kg`} /></div>
                  </div>
                  {shortage && <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{delivery.isApprovedPartial
                    ? `The business approved ${targetQuantity} kg for this pickup. Pack at least that amount to confirm readiness. The remaining ${Math.max(0, required - targetQuantity).toLocaleString("en-IN")} kg stays tracked separately.`
                    : `Short by ${Math.max(0, required - Number(packed)).toLocaleString("en-IN")} kg. You cannot mark this delivery ready until the full required quantity is packed. Report a shortage below if you cannot fulfil it.`}</span></div>}
                  <div className="space-y-1"><label className="text-sm font-medium">Preparation note / shortage reason</label><Input value={notes[c.id] || ""} onChange={(e) => setNotes(old => ({ ...old, [c.id]: e.target.value }))} placeholder="Optional note, or explain why the required quantity is unavailable" /></div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={stockMutation.isPending} onClick={() => prepare(c, true)}><PackageCheck className="mr-2 h-4 w-4" />{stockMutation.isPending ? "Saving…" : delivery.isApprovedPartial ? `Confirm ${targetQuantity} kg packed & ready for pickup` : "Confirm packed & ready for pickup"}</Button>
                    <Button variant="outline" disabled={stockMutation.isPending} onClick={() => prepare(c, false)}><AlertTriangle className="mr-2 h-4 w-4" />Report shortage</Button>
                  </div>
                  <p className="text-xs text-slate-500">The quantities and readiness are sent to the backend. This page does not create a mock preview or pretend an unsaved change was saved.</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
