"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileSignature,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarRange,
  IndianRupee,
  Users,
  Check,
  PackageCheck,
  AlertTriangle,
  RefreshCw,
  ClipboardCheck,
} from "lucide-react";
import { api } from "../../../../lib/api/client";
import { formatPrice } from "../../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Badge } from "../../../../components/ui/badge";
import toast from "react-hot-toast";

interface Contract {
  id: string;
  contractNumber: string;
  businessName: string;
  cropName: string;
  quantityPerMonthKg?: number;
  quantityPerDeliveryKg?: number;
  pricePerKg: number;
  durationMonths: number;
  frequency?: string;
  recurrenceInterval?: number;
  startDate: string;
  endDate?: string;
  nextDeliveryAt?: string;
  pendingRescheduledDeliveryDate?: string;
  pendingFarmerDeliveryDate?: string;
  deliveryHistory?: Array<{
    scheduledDate: string;
    requestedQuantityKg?: number;
    approvedQuantityKg?: number;
    availableQuantityKg?: number;
    packedQuantityKg?: number;
    status?: string;
    resolution?: string;
    isRescheduledOccurrence?: boolean;
  }>;
  status: "active" | "pending" | "paused" | "completed" | "cancelled";
  latestDeliveryStatus?: string;
  farmerPrepareBy?: string;
  pickupDate?: string;
  pickupDeadline?: string;
  plannedPickupAt?: string;
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
}

export default function FarmerB2bContractsPage() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [availableQty, setAvailableQty] = useState<Record<string, string>>({});
  const [packedQty, setPackedQty] = useState<Record<string, string>>({});
  const [stockNotes, setStockNotes] = useState<Record<string, string>>({});
  const [orderPackedQty, setOrderPackedQty] = useState<Record<string, string>>({});

  const { data: contractsData, isLoading, isError: contractsError } = useQuery({
    queryKey: ["farmerContracts"],
    queryFn: () => api.get("/b2b/contracts/me"),
    retry: 1,
  });

  const apiContracts = useMemo(() => {
    const list = contractsData?.data?.contracts || contractsData?.data || [];
    return Array.isArray(list) ? list : [];
  }, [contractsData]);

  const ordersQuery = useQuery({
    queryKey: ["farmerB2bPreparationOrders"],
    queryFn: () => api.get("/b2b/orders"),
    refetchInterval: 30000,
    retry: 1,
  });

  const orderPreparationMutation = useMutation({
    mutationFn: ({ id, status, packedQuantityKg, qualityCheck, qualityNotes }: {
      id: string;
      status: string;
      packedQuantityKg?: number;
      qualityCheck?: string;
      qualityNotes?: string;
    }) => api.put(`/b2b/orders/${encodeURIComponent(id)}/status`, {
      status,
      packedQuantityKg,
      qualityCheck,
      qualityNotes,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["farmerB2bPreparationOrders"] }),
        queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] }),
        queryClient.invalidateQueries({ queryKey: ["farmerContracts"] }),
      ]);
      toast.success("B2B order preparation updated.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not update B2B order preparation"),
  });

  const oneTimeOrders = useMemo(() => {
    const root = ordersQuery.data?.data ?? ordersQuery.data;
    const payload = root?.data?.orders ?? root?.orders ?? [];
    return (Array.isArray(payload) ? payload : [])
      .map((order: any) => ({ ...order, id: String(order.id || order._id || "") }))
      // Regular recurring occurrences are managed in the contract section below.
      // Include separately assigned replacement supplies because they are their
      // own B2B orders even though they reference a recurring contract.
      .filter((order: any) =>
        order.id
        && (!order.contractId || order.isReplacementSupply === true)
        && ["confirmed", "preparing", "quality_check"].includes(String(order.status || "").toLowerCase())
      )
      .sort((a: any, b: any) =>
        new Date(a.deliveryDeadline || a.requiredDate || a.scheduledDeliveryDate || a.createdAt || 0).getTime()
        - new Date(b.deliveryDeadline || b.requiredDate || b.scheduledDeliveryDate || b.createdAt || 0).getTime()
      );
  }, [ordersQuery.data]);

  const confirmMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.put(`/b2b/contracts/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerContracts"] });
      setConfirming(null);
      toast.success("Contract updated!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update contract"),
  });

  const stockMutation = useMutation({
    mutationFn: ({ id, quantity, packed, ready, notes, scheduledDate }: { id: string; quantity: number; packed: number; ready: boolean; notes?: string; scheduledDate: string }) =>
      api.post(`/b2b/contracts/${id}/delivery-confirmation`, { availableQuantityKg: quantity, packedQuantityKg: packed, readyForPickup: ready, notes, scheduledDate }),
    onSuccess: async (res: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["farmerContracts"] }),
        queryClient.invalidateQueries({ queryKey: ["farmerB2bPreparationOrders"] }),
      ]);
      const status = res?.data?.data?.status || res?.data?.status;
      toast.success(status === "shortage" ? "Shortage reported. The business must choose a solution." : "Stock confirmed for the next delivery.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not confirm delivery stock"),
  });

  const contracts: Contract[] = apiContracts.map((c: any) => ({ ...c, id: c._id || c.id }));
  const targetScheduleDate = (c: Contract) => {
    const regularDate = c.nextDeliveryAt ? String(c.nextDeliveryAt).slice(0, 10) : "";
    const rescheduledDate = c.pendingFarmerDeliveryDate || c.pendingRescheduledDeliveryDate || "";
    // A rescheduled occurrence must not hide an earlier regular occurrence
    // in a recurring daily/weekly contract. Confirm the earliest actionable
    // date first, then the next occurrence becomes the target after refresh.
    if (regularDate && rescheduledDate) return regularDate <= rescheduledDate ? regularDate : rescheduledDate;
    return rescheduledDate || regularDate;
  };
  const confirmationForTargetDate = (c: Contract) =>
    c.deliveryHistory?.find((delivery) => delivery.scheduledDate === targetScheduleDate(c));
  const requiredQuantity = (c: Contract) => {
    const confirmation = confirmationForTargetDate(c);
    const resolution = String(confirmation?.resolution || "").toLowerCase();
    const status = String(confirmation?.status || "").toLowerCase();
    const approvedQuantity = Number(confirmation?.approvedQuantityKg || 0);
    // The business API persists resolution="partial" with status
    // "partial_approved". Keep the approved amount as the pickup target for
    // both legacy and current status shapes.
    const isBusinessApprovedPartial =
      approvedQuantity > 0
      && (
        ["partial", "replacement_supplier"].includes(resolution)
        || ["partial_approved", "replacement_assigned"].includes(status)
      );
    if (isBusinessApprovedPartial) return approvedQuantity;
    return Number(confirmation?.requestedQuantityKg ?? c.quantityPerDeliveryKg ?? c.quantityPerMonthKg ?? 0);
  };
  const plannedPickupDeadline = (c: Contract) => {
    const explicit = c.pickupDeadline || c.plannedPickupAt || c.pickupDate;
    if (explicit) return new Date(explicit);
    const scheduleDate = targetScheduleDate(c);
    if (!scheduleDate) return null;
    const deadline = new Date(scheduleDate + "T00:00:00");
    if (Number.isNaN(deadline.getTime())) return null;
    deadline.setDate(deadline.getDate() - 1);
    deadline.setHours(18, 0, 0, 0);
    return deadline;
  };
  const validateStock = (c: Contract, ready: boolean) => {
    const scheduledDate = targetScheduleDate(c);
    if (!scheduledDate) {
      toast.error("No scheduled delivery date is available for this contract.");
      return;
    }
    const targetQuantity = requiredQuantity(c);
    const availableRaw = availableQty[c.id] ?? "";
    const packedRaw = packedQty[c.id] ?? "";
    if (availableRaw.trim() === "" || packedRaw.trim() === "") {
      toast.error(`Enter available and packed quantity for ${c.cropName}.`);
      return;
    }
    const available = Number(availableRaw);
    const packed = Number(packedRaw);
    if (!Number.isFinite(available) || !Number.isFinite(packed) || available < 0 || packed < 0) {
      toast.error("Quantities must be valid non-negative numbers.");
      return;
    }
    if (packed > available) {
      toast.error("Packed quantity cannot exceed available quantity.");
      return;
    }
    if (ready && packed < targetQuantity) {
      toast.error(`Cannot mark ready: pack the approved required ${targetQuantity} kg or report the shortage.`);
      return;
    }
    if (ready && available < targetQuantity) {
      toast.error(`Available stock must cover the approved ${targetQuantity} kg before marking ready.`);
      return;
    }
    if (ready && packed <= 0) {
      toast.error("Packed quantity must be greater than zero to mark ready.");
      return;
    }
    if (!ready && available >= targetQuantity && packed >= targetQuantity) {
      toast.error("The approved quantity is available and packed. Use Ready for pickup instead.");
      return;
    }
    if (!ready && !stockNotes[c.id]?.trim()) {
      toast.error("Add a note explaining the shortage so the business can decide how to proceed.");
      return;
    }
    stockMutation.mutate({ id: c.id, quantity: available, packed, ready, notes: stockNotes[c.id], scheduledDate });
  };
  const activeCount = contracts.filter((c) => c.status === "active").length;
  const monthlyKg = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0), 0);
  const monthlyValue = contracts.filter((c) => c.status === "active").reduce((s, c) => s + Number(c.quantityPerMonthKg ?? c.quantityPerDeliveryKg ?? 0) * Number(c.pricePerKg ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">B2B Supply Workspace</h1>
          <p className="mt-1 max-w-3xl text-gray-500">
            Manage recurring contracts, confirm each delivery's stock, report shortages, and prepare one-time or replacement B2B orders from one place.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => {
          await Promise.all([queryClient.invalidateQueries({ queryKey: ["farmerContracts"] }), queryClient.invalidateQueries({ queryKey: ["farmerB2bPreparationOrders"] })]);
          toast.success("Supply workspace refreshed.");
        }}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh all
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href="#contracts" className="rounded-full border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Recurring contracts</a>
        <a href="#preparation" className="rounded-full border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Order preparation</a>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Active contracts</p>
            <p className="text-2xl font-bold text-emerald-700">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Committed supply / month</p>
            <p className="text-2xl font-bold text-blue-700">{monthlyKg} kg</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-gray-500">Predictable income / month</p>
            <p className="text-2xl font-bold text-amber-700">{formatPrice(monthlyValue)}</p>
          </CardContent>
        </Card>
      </div>

      <section id="preparation" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Order preparation &amp; quality check</h2>
            <p className="text-sm text-slate-500">Prepare one-time B2B orders and separately assigned replacement orders. Recurring contract deliveries are managed in the contract section below.</p>
          </div>
          <Badge variant="outline">{ordersQuery.isLoading ? "Loading orders…" : `${oneTimeOrders.length} need action`}</Badge>
        </div>

        {ordersQuery.isLoading ? (
          <Card><CardContent className="p-4 text-sm text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading B2B orders needing preparation…</CardContent></Card>
        ) : ordersQuery.isError ? (
          <Card><CardContent className="p-4 text-sm text-red-700">Could not load B2B orders. Use Refresh all or check the B2B orders API.</CardContent></Card>
        ) : oneTimeOrders.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-slate-500">No one-time or replacement B2B orders currently need preparation.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {oneTimeOrders.map((order: any) => {
              const packed = orderPackedQty[order.id] ?? String(order.packedQuantityKg ?? "");
              const required = Number(order.quantityKg || 0);
              const isReplacement = order.isReplacementSupply === true;
              return (
                <Card key={order.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{order.orderNumber || `B2B-${order.id.slice(-6)}`} · {order.productName || "Produce"}</h3>
                          {isReplacement && <Badge variant="outline">Replacement supply</Badge>}
                        </div>
                        <p className="text-sm text-slate-600">Required: {required} kg · Business: {order.businessInfo?.businessName || order.businessName || "Business buyer"}</p>
                        <p className="text-sm text-slate-600">Delivery: {order.deliveryDeadline || order.requiredDate || order.scheduledDeliveryDate ? new Date(order.deliveryDeadline || order.requiredDate || order.scheduledDeliveryDate).toLocaleString("en-IN") : "Not scheduled"} · Prepare by: {order.farmerPrepareBy ? new Date(order.farmerPrepareBy).toLocaleString("en-IN") : "Not scheduled"}</p>
                      </div>
                      <Badge variant="outline">{String(order.status).replace(/_/g, " ")}</Badge>
                    </div>

                    {order.status === "confirmed" ? (
                      <Button disabled={orderPreparationMutation.isPending} onClick={() => orderPreparationMutation.mutate({ id: order.id, status: "preparing" })}>
                        <ClipboardCheck className="mr-2 h-4 w-4" />Start preparation
                      </Button>
                    ) : order.status === "preparing" ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="min-w-[220px] flex-1 space-y-1">
                            <label className="text-sm font-medium">Actual packed quantity (kg)</label>
                            <Input type="number" min="0" max={required} step="0.1" value={packed} onChange={(e) => setOrderPackedQty((old) => ({ ...old, [order.id]: e.target.value }))} placeholder={`Required: ${required} kg`} />
                          </div>
                          <Button
                            disabled={orderPreparationMutation.isPending || !packed.trim() || !Number.isFinite(Number(packed)) || Number(packed) <= 0 || Number(packed) !== required}
                            onClick={() => {
                              if (Number(packed) < required) {
                                toast.error("This order has a shortage. Report it to the business before sending it for quality check.");
                                return;
                              }
                              if (Number(packed) > required) {
                                toast.error(`Packed quantity cannot exceed the order quantity (${required} kg).`);
                                return;
                              }
                              orderPreparationMutation.mutate({ id: order.id, status: "quality_check", packedQuantityKg: Number(packed) });
                            }}
                          >
                            Save packed quantity &amp; submit for quality check
                          </Button>
                        </div>
                        <p className="text-xs text-slate-500">A short quantity cannot be marked as a full supply. Contact the business to resolve the shortage before dispatch.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                        <p className="text-sm text-slate-700">Packed: {Number(order.packedQuantityKg || 0)} kg · Required: {required} kg. Complete the farmer quality check before the warehouse pickup queue can process it.</p>
                        <div className="flex flex-wrap gap-2">
                          <Button disabled={orderPreparationMutation.isPending || Number(order.packedQuantityKg || 0) < required} onClick={() => orderPreparationMutation.mutate({ id: order.id, status: "quality_check", qualityCheck: "passed", qualityNotes: "Farmer quality check passed" })}>
                            <CheckCircle2 className="mr-2 h-4 w-4" />Pass quality check
                          </Button>
                          <Button variant="outline" disabled={orderPreparationMutation.isPending} onClick={() => orderPreparationMutation.mutate({ id: order.id, status: "quality_check", qualityCheck: "failed", qualityNotes: "Farmer quality check failed; reinspection required" })}>
                            <AlertTriangle className="mr-2 h-4 w-4" />Mark quality failed
                          </Button>
                          {order.qualityCheck === "passed" && (
                            <Button disabled={orderPreparationMutation.isPending} onClick={() => orderPreparationMutation.mutate({ id: order.id, status: "ready_for_pickup" })}>
                              <PackageCheck className="mr-2 h-4 w-4" />Confirm ready for farm pickup
                            </Button>
                          )}
                        </div>
                        {order.qualityCheck === "failed" && <p className="text-sm text-amber-800">Quality failed. Resolve the issue and pass inspection before confirming pickup readiness.</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section id="contracts" className="scroll-mt-24 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Recurring supply contracts</h2>
          <p className="text-sm text-slate-500">Accept agreements, prepare the next scheduled delivery, and respond to any business-approved shortage resolution.</p>
        </div>
      {contractsError ? (
        <Card><CardContent className="p-5 text-sm text-red-700">Could not load supply contracts. Use Refresh all or try again.</CardContent></Card>
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : contracts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <FileSignature className="h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-slate-500">No contracts yet. Businesses will send you supply agreements to confirm.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => {
            const targetQuantity = requiredQuantity(c);
            const availableRaw = availableQty[c.id] ?? "";
            const packedRaw = packedQty[c.id] ?? "";
            const available = Number(availableRaw);
            const packed = Number(packedRaw);
            const hasEnteredQuantities = availableRaw.trim() !== "" && packedRaw.trim() !== "";
            const validQuantities =
              hasEnteredQuantities
              && Number.isFinite(available)
              && Number.isFinite(packed)
              && available >= 0
              && packed >= 0
              && packed <= available
              && targetQuantity > 0;
            const isShortOnRequiredQuantity =
              validQuantities && (available < targetQuantity || packed < targetQuantity);
            const isReadyForPickup =
              validQuantities
              && available >= targetQuantity
              && packed >= targetQuantity
              && packed > 0;
            const confirmation = confirmationForTargetDate(c);
            const hasApprovedPartial =
              Number(confirmation?.approvedQuantityKg || 0) > 0
              && (
                ["partial", "replacement_supplier"].includes(String(confirmation?.resolution || "").toLowerCase())
                || ["partial_approved", "replacement_assigned"].includes(String(confirmation?.status || "").toLowerCase())
              );
            return (
            <Card key={c.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                    <FileSignature className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-semibold">{c.contractNumber}</p>
                      <Badge variant="outline">{c.cropName}</Badge>
                      {c.status === "active" && <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Active</Badge>}
                      {c.status === "pending" && <Badge variant="warning"><Clock className="mr-1 h-3 w-3" /> Needs your confirmation</Badge>}
                      {c.status === "paused" && <Badge variant="warning">Paused</Badge>}
                      {c.status === "completed" && <Badge variant="secondary">Completed</Badge>}
                      {c.status === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-gray-500">{c.businessName}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><IndianRupee className="h-4 w-4 text-emerald-600" /> {c.pricePerKg}/kg</span>
                  <span className="flex items-center gap-1"><Users className="h-4 w-4 text-blue-600" /> {Number(c.quantityPerDeliveryKg ?? c.quantityPerMonthKg ?? 0)} kg / delivery</span>
                  <span className="flex items-center gap-1"><CalendarRange className="h-4 w-4 text-amber-600" /> {c.frequency || "monthly"}{Number(c.recurrenceInterval || 1) > 1 ? ` · every ${c.recurrenceInterval}` : ""}</span>
                  {c.nextDeliveryAt && <span className="text-xs text-slate-500">Next delivery: {new Date(c.nextDeliveryAt).toLocaleDateString("en-IN")}</span>}
                </div>
                {c.status === "active" && (
                  <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <PackageCheck className="h-4 w-4" /> Confirm stock for next delivery
                    </p>
                    <p className="mb-2 text-xs text-slate-600">
                      Product: <strong>{c.cropName}</strong> · {hasApprovedPartial ? "Business-approved pickup quantity" : "Required for this delivery"}: <strong>{targetQuantity} kg</strong>.
                      {hasApprovedPartial && <span> Original scheduled quantity: {Number(confirmation?.requestedQuantityKg ?? c.quantityPerDeliveryKg ?? 0)} kg.</span>}
                      Delivery date: {targetScheduleDate(c) ? new Date(targetScheduleDate(c) + "T00:00:00").toLocaleDateString("en-IN") : "date pending"}.
                      {c.pendingRescheduledDeliveryDate ? " (rescheduled occurrence — confirm stock for this date)" : ""}
                    </p>
                    <div className="mb-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-slate-700">
                      <p><strong>Prepare and pack by:</strong> {c.farmerPrepareBy ? new Date(c.farmerPrepareBy).toLocaleString("en-IN") : "See delivery schedule"}</p>
                      <p><strong>Planned pickup deadline:</strong> {plannedPickupDeadline(c) ? plannedPickupDeadline(c)!.toLocaleString("en-IN") : "Pending delivery schedule"}</p>
                      {!c.pickupDeadline && !c.plannedPickupAt && !c.pickupDate && c.nextDeliveryAt && <p className="mt-1 text-amber-700">Planning estimate: previous day at 6:00 PM. The assigned pickup task deadline takes priority if it differs.</p>}
                      <p><strong>Pickup window:</strong> {c.pickupWindowStart && c.pickupWindowEnd ? `${new Date(c.pickupWindowStart).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}–${new Date(c.pickupWindowEnd).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Use the deadline on the assigned pickup task"}</p>
                      <p className="mt-1">Only mark ready when the required quantity shown above is available and packed. If the business approved partial supply, use that approved quantity. If you cannot supply the required amount, report the actual quantities and wait for the business to decide.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="number" min="0" step="0.1" inputMode="decimal"
                        className="w-36 rounded-md border bg-white px-3 py-2 text-sm"
                        placeholder="Available kg"
                        value={availableQty[c.id] ?? ""}
                        onChange={(e) => setAvailableQty((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <input
                        type="number" min="0" step="0.1" inputMode="decimal"
                        className="w-36 rounded-md border bg-white px-3 py-2 text-sm"
                        placeholder="Packed kg"
                        value={packedQty[c.id] ?? ""}
                        onChange={(e) => setPackedQty((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <input
                        className="min-w-40 flex-1 rounded-md border bg-white px-3 py-2 text-sm"
                        placeholder="Shortage reason (required when short)"
                        value={stockNotes[c.id] ?? ""}
                        onChange={(e) => setStockNotes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={stockMutation.isPending || !isShortOnRequiredQuantity}
                        onClick={() => validateStock(c, false)}
                      >
                        {stockMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-1 h-4 w-4" />}
                        Report shortage / stock
                      </Button>
                      <Button
                        size="sm"
                        disabled={stockMutation.isPending || !isReadyForPickup}
                        onClick={() => validateStock(c, true)}
                      >
                        {stockMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1 h-4 w-4" />}
                        Ready for pickup
                      </Button>
                    </div>
                    {c.latestDeliveryStatus === "shortage" && (
                      <p className="mt-2 flex items-center gap-1 text-sm text-amber-700"><AlertTriangle className="h-4 w-4" /> Shortage reported. Wait for the business to approve a solution.</p>
                    )}
                  </div>
                )}
                {c.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={confirmMutation.isPending}
                      onClick={() => confirmMutation.mutate({ id: c.id, status: "active" })}
                    >
                      {confirmMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => confirmMutation.mutate({ id: c.id, status: "cancelled" })}>
                      <XCircle className="mr-1.5 h-4 w-4" /> Decline
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
      </section>
    </div>
  );
}
