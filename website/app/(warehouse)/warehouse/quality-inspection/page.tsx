"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, Clock3, MapPin, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import toast from "react-hot-toast";

type Inspection = {
  id: string;
  priority?: "critical" | "urgent" | "normal";
  inspectionStatus?: string;
  inspectionDueAt?: string;
  batch?: {
    id: string;
    lotNumber?: string;
    cropName?: string;
    quantityKg?: number;
    harvestDate?: string;
    storageType?: string;
    expiresAt?: string;
    qualityStatus?: string;
  };
};

export default function WarehouseQualityInspectionPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [grade, setGrade] = useState("A");
  const [freshness, setFreshness] = useState("");
  const [damagedPct, setDamagedPct] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [selectedIncoming, setSelectedIncoming] = useState<any>(null);
  const [incomingQuality, setIncomingQuality] = useState<"passed" | "failed">("passed");
  const [incomingUsableQuantity, setIncomingUsableQuantity] = useState("");
  const [incomingQualityNotes, setIncomingQualityNotes] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["warehouseQualityQueue"],
    queryFn: () => api.get("/quality/inspections/queue"),
    refetchInterval: 30000,
  });

  const incomingQuery = useQuery({
    queryKey: ["warehouseIncomingQualityQueue"],
    queryFn: () => api.get("/warehouse/me/incoming", { params: { limit: 100 } }),
    refetchInterval: 15000,
  });

  // Farmer Fulfillment orders are already packed at the farm. Cross-check the
  // dedicated transfer queue so legacy incoming records missing sourceMode or
  // packingRequired are not incorrectly shown as warehouse quality rechecks.
  const farmerTransfersQuery = useQuery({
    queryKey: ["warehouseFarmerFulfillmentTransfersForQualityFilter"],
    queryFn: () => api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval: 30000,
  });

  const incomingQualityQueue: any[] = useMemo(() => {
    // The API client may expose either the axios response or its unwrapped data.
    // Accept both response shapes so the recheck list doesn't silently appear empty.
    const response = incomingQuery.data;
    const root = response?.data ?? response;
    const payload = root?.data?.incoming ?? root?.incoming ?? root?.data?.items ?? root?.items ?? root?.data?.results ?? root?.results ?? [];
    const rows = Array.isArray(payload) ? payload : [];
    const transferResponse = farmerTransfersQuery.data?.data ?? farmerTransfersQuery.data;
    const transferRoot = transferResponse?.data ?? transferResponse;
    const transferRows = transferRoot?.orders ?? transferRoot?.transfers ?? transferRoot?.items ?? [];
    const farmerOrderIds = new Set<string>();
    const farmerOrderNumbers = new Set<string>();
    for (const row of Array.isArray(transferRows) ? transferRows : []) {
      const orderId = String(row.orderId || row.id || row._id || "").trim();
      const orderNumber = String(row.orderNumber || row.orderNo || "").trim();
      if (orderId) farmerOrderIds.add(orderId);
      if (orderNumber) farmerOrderNumbers.add(orderNumber);
    }
    return rows.filter((item: any) => {
      const status = String(item.status || "").trim().toLowerCase();
      const quality = String(item.qualityCheck || item.quality_check || item.qualityStatus || "").trim().toLowerCase();
      const mode = String(item.sourceMode || item.fulfillmentType || item.shipmentType || "").trim().toLowerCase();
      const fulfillment = String(item.fulfillmentMethod || item.fulfillment_method || item.order?.fulfillmentMethod || "").trim().toLowerCase();
      const orderId = String(item.orderId || item.order?._id || item.order?.id || "").trim();
      const orderNumber = String(item.orderNumber || item.orderNo || item.order?.orderNumber || "").trim();
      const receivedOrWaiting = ["received", "quality_check"].includes(status);
      const qualityPending = ["", "pending", "quality_check", "not_checked"].includes(quality);
      const isFarmerFulfillment =
        fulfillment === "farmer"
        || ["farmer_fulfillment", "farmer_fulfillment_transfer", "packed_orders_transfer"].includes(mode)
        || item.packingRequired === false
        || farmerOrderIds.has(orderId)
        || (orderNumber !== "" && farmerOrderNumbers.has(orderNumber));
      const isWarehouseFulfillment =
        ["warehouse", "warehouse_fulfillment", "warehouse_fulfillment_bulk", "warehouse_transfer"].includes(fulfillment)
        || ["warehouse_fulfillment", "warehouse_fulfillment_bulk"].includes(mode)
        || (item.packingRequired === true && !isFarmerFulfillment);
      return receivedOrWaiting && qualityPending && isWarehouseFulfillment && !isFarmerFulfillment;
    });
  }, [incomingQuery.data, farmerTransfersQuery.data]);

  const incomingQualityMutation = useMutation({
    mutationFn: async (qualityCheck: "passed" | "failed") => {
      if (!selectedIncoming?.id) throw new Error("Select a received shipment first");
      return api.put(`/warehouse/me/incoming/${selectedIncoming.id}/quality`, {
        qualityCheck,
        usableQuantity: Number(incomingUsableQuantity || selectedIncoming.usableQuantity || selectedIncoming.quantityReceived || selectedIncoming.quantity || 0),
        notes: incomingQualityNotes.trim() || undefined,
      });
    },
    onSuccess: async (_result, qualityCheck) => {
      setSelectedIncoming(null);
      setIncomingQualityNotes("");
      await queryClient.invalidateQueries({ queryKey: ["warehouseIncomingQualityQueue"] });
      await queryClient.invalidateQueries({ queryKey: ["warehouseIncoming"] });
      toast.success(qualityCheck === "passed" ? "Quality recheck passed. Shipment can continue to Store." : "Quality recheck failed. Shipment has been rejected and held.");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Unable to update shipment quality result");
    },
  });

  const openIncomingRecheck = (item: any) => {
    setSelectedIncoming(item);
    setIncomingQuality("passed");
    setIncomingUsableQuantity(String(item.usableQuantity ?? item.quantityReceived ?? item.quantity ?? ""));
    setIncomingQualityNotes("");
  };

  const queue: Inspection[] = useMemo(
    () => data?.data?.inspections ?? data?.inspections ?? [],
    [data]
  );

  const claimMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quality/inspections/${id}/claim`, { notes: "Inspector assigned for physical inspection" }),
    onSuccess: async (_result, id) => {
      // "selected" is a separate state object from the query cache. Updating
      // only the queue leaves it stuck at "pending", so Approve Quality stays
      // disabled even after a successful claim. Advance the open inspection
      // immediately, then refresh the queue's authoritative server state.
      setSelected(current =>
        current?.id === id
          ? { ...current, inspectionStatus: "in_progress" }
          : current
      );
      await queryClient.invalidateQueries({ queryKey: ["warehouseQualityQueue"] });
      toast.success("Inspection claimed. Complete the checks and approve quality.");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Could not claim inspection. Refresh the queue and try again.");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/quality/inspections/${id}/verify`, {
        verifiedGrade: grade,
        method: "warehouse_qc",
        freshness: freshness ? Number(freshness) : undefined,
        damagedPct: damagedPct ? Number(damagedPct) : undefined,
        weightKg: weightKg ? Number(weightKg) : undefined,
        notes,
      }),
    onSuccess: async () => {
      setSelected(null);
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["warehouseQualityQueue"] });
      toast.success("Quality approved. The linked product can now be activated.");
    },
    onError: (error: any) => {
      toast.error(error?.message || "Quality approval failed. Check the inspection and try again.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quality/inspections/${id}/reject`, { reason: rejectReason }),
    onSuccess: () => {
      setSelected(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["warehouseQualityQueue"] });
    },
  });

  const openInspection = (item: Inspection) => {
    setSelected(item);
    setGrade("A");
    setFreshness("");
    setDamagedPct("");
    setWeightKg(item.batch?.quantityKg ? String(item.batch.quantityKg) : "");
    setNotes("");
    setRejectReason("");
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-emerald-600" />
          <h1 className="text-3xl font-bold">Quality Inspection</h1>
        </div>
        <p className="mt-1 text-muted-foreground">
          Independent physical inspection for harvested batches. Farmers cannot approve their own produce.
        </p>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Pending</p><p className="text-2xl font-bold">{queue.length}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Critical / urgent</p><p className="text-2xl font-bold text-orange-600">{queue.filter(x => x.priority === "critical" || x.priority === "urgent").length}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Rule</p><p className="text-sm font-medium">Approval requires physical inspection evidence</p></div>
        </CardContent>
      </Card>

      {error && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-700">Unable to load inspection queue.</CardContent></Card>}

      <Card className="border-amber-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-amber-600" />Incoming Stock — Pending Quality Recheck</CardTitle>
          <p className="text-sm text-muted-foreground">Only Warehouse Fulfillment orders awaiting quality inspection appear here. Farmer Fulfillment and unrelated orders are excluded. Recheck pending shipments and save the final result; approved stock can then continue to Store.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {incomingQuery.isLoading && <p className="text-sm text-muted-foreground">Loading pending incoming receipts…</p>}
          {incomingQuery.isError && <p className="text-sm text-red-600">Could not load incoming receipt quality checks. Refresh and try again.</p>}
          {!incomingQuery.isLoading && !incomingQuery.isError && incomingQualityQueue.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No incoming shipments are waiting for a quality recheck.</p>}
          {incomingQualityQueue.map((item: any) => (
            <div key={item.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">{item.orderNumber || item.order?.orderNumber || item.orderId || item.id} · {item.productName || item.displayProductName || "Product"}</p>
                <p className="mt-1 text-sm text-muted-foreground">Farm: {item.farmName || item.farmerName || "Farm details unavailable"} · Received: {item.quantityReceived ?? item.quantity ?? "—"} {item.unit || "kg"}</p>
                <p className="mt-1 text-sm text-amber-700">Quality: Pending · {item.qualityNotes || item.notes || "Recheck required"}</p>
              </div>
              <Button type="button" onClick={() => openIncomingRecheck(item)}><ShieldCheck className="mr-2 h-4 w-4" />Recheck Quality</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedIncoming)} onOpenChange={(open) => { if (!open && !incomingQualityMutation.isPending) setSelectedIncoming(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Recheck Incoming Shipment Quality</DialogTitle>
            <DialogDescription>Review the existing receipt and save the final quality result. This does not receive the shipment again.</DialogDescription>
          </DialogHeader>
          {selectedIncoming && <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <p className="font-semibold">{selectedIncoming.orderNumber || selectedIncoming.orderId || selectedIncoming.id} · {selectedIncoming.productName || selectedIncoming.displayProductName || "Product"}</p>
              <p className="mt-1 text-sm text-muted-foreground">Farm: {selectedIncoming.farmName || selectedIncoming.farmerName || "Farm details unavailable"}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Declared quantity</p><p className="font-semibold">{selectedIncoming.quantity ?? "—"} {selectedIncoming.unit || "kg"}</p></div>
                <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Actually received</p><p className="font-semibold">{selectedIncoming.quantityReceived ?? selectedIncoming.receivedQuantity ?? "—"} {selectedIncoming.unit || "kg"}</p></div>
              </div>
            </div>
            <div><label className="text-sm font-medium">Usable quantity</label><input type="number" min="0" max={Number(selectedIncoming.quantityReceived ?? selectedIncoming.receivedQuantity ?? selectedIncoming.quantity ?? 0)} step="0.01" value={incomingUsableQuantity} onChange={e => setIncomingUsableQuantity(e.target.value)} className="mt-1 w-full rounded-lg border bg-background p-2" /></div>
            <div><label className="text-sm font-medium">Final quality result</label><select value={incomingQuality} onChange={e => setIncomingQuality(e.target.value as "passed" | "failed")} className="mt-1 w-full rounded-lg border bg-background p-2"><option value="passed">Passed — continue to Store</option><option value="failed">Failed — reject / hold</option></select></div>
            <div><label className="text-sm font-medium">Recheck notes</label><textarea value={incomingQualityNotes} onChange={e => setIncomingQualityNotes(e.target.value)} placeholder="Record what was rechecked and the result" className="mt-1 min-h-20 w-full rounded-lg border bg-background p-3" required /></div>
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSelectedIncoming(null)} disabled={incomingQualityMutation.isPending}>Cancel</Button><Button type="button" variant={incomingQuality === "failed" ? "destructive" : "default"} onClick={() => incomingQualityMutation.mutate(incomingQuality)} disabled={incomingQualityMutation.isPending || !incomingUsableQuantity.trim() || !Number.isFinite(Number(incomingUsableQuantity)) || Number(incomingUsableQuantity) < 0 || Number(incomingUsableQuantity) > Number(selectedIncoming.quantityReceived ?? selectedIncoming.receivedQuantity ?? selectedIncoming.quantity ?? 0) || !incomingQualityNotes.trim()}>{incomingQualityMutation.isPending ? "Saving result…" : incomingQuality === "passed" ? "Save Passed Result" : "Save Failed Result"}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>Inspection Queue</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading inspection requests…</p> : null}
            {!isLoading && queue.length === 0 ? <p className="text-sm text-muted-foreground">No pending inspection requests.</p> : null}
            {queue.map((item) => (
              <button key={item.id} onClick={() => openInspection(item)} className="w-full rounded-xl border p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.batch?.cropName || "Produce"} · {item.batch?.lotNumber}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.batch?.quantityKg ?? "—"} kg · {item.batch?.storageType || "normal"} storage</p>
                  </div>
                  <Badge variant={item.priority === "critical" ? "destructive" : item.priority === "urgent" ? "warning" : "default"}>{item.priority || "normal"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Due {item.inspectionDueAt ? new Date(item.inspectionDueAt).toLocaleString() : "—"}</span>
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Visit batch location</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{selected ? "Physical Inspection" : "Select a batch"}</CardTitle></CardHeader>
          <CardContent>
            {!selected ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Select a queue item, claim it, then inspect the physical produce.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl bg-muted/50 p-4">
                  <p className="font-semibold">{selected.batch?.cropName} · {selected.batch?.lotNumber}</p>
                  <p className="text-sm text-muted-foreground">{selected.batch?.quantityKg} kg · harvested {selected.batch?.harvestDate ? new Date(selected.batch.harvestDate).toLocaleDateString() : "—"}</p>
                </div>

                {selected.inspectionStatus !== "in_progress" && (
                  <Button className="w-full" onClick={() => claimMutation.mutate(selected.id)} disabled={claimMutation.isPending}>
                    {claimMutation.isPending ? "Assigning…" : "Claim Inspection"}
                  </Button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">Grade<select value={grade} onChange={e => setGrade(e.target.value)} className="mt-1 w-full rounded-lg border bg-background p-2"><option>A</option><option>B</option><option>C</option></select></label>
                  <label className="text-sm">Freshness %<input value={freshness} onChange={e => setFreshness(e.target.value)} type="number" min="0" max="100" className="mt-1 w-full rounded-lg border p-2" /></label>
                  <label className="text-sm">Damaged %<input value={damagedPct} onChange={e => setDamagedPct(e.target.value)} type="number" min="0" max="100" className="mt-1 w-full rounded-lg border p-2" /></label>
                  <label className="text-sm">Measured kg<input value={weightKg} onChange={e => setWeightKg(e.target.value)} type="number" min="0" className="mt-1 w-full rounded-lg border p-2" /></label>
                </div>

                <div className="rounded-xl border border-dashed p-4">
                  <div className="flex items-center gap-2 font-medium"><Camera className="h-4 w-4" /> Evidence</div>
                  <p className="mt-1 text-xs text-muted-foreground">Record the physical condition, measured weight and inspection notes. Photo upload can be connected to your existing storage service.</p>
                </div>

                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Inspection notes and findings" className="min-h-24 w-full rounded-lg border p-3 text-sm" />

                <Button className="w-full" onClick={() => verifyMutation.mutate(selected.id)} disabled={verifyMutation.isPending || selected.inspectionStatus !== "in_progress"}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />{verifyMutation.isPending ? "Approving…" : "Approve Quality"}
                </Button>

                <div className="border-t pt-4">
                  <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection" className="min-h-20 w-full rounded-lg border p-3 text-sm" />
                  <Button variant="destructive" className="mt-2 w-full" onClick={() => rejectMutation.mutate(selected.id)} disabled={!rejectReason.trim() || rejectMutation.isPending || selected.inspectionStatus !== "in_progress"}>
                    <XCircle className="mr-2 h-4 w-4" />Reject Batch
                  </Button>
                </div>

                <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  AI may assist with screening, but it cannot replace the authorized physical inspection or approve the batch by itself.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
