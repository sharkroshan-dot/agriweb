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

/**
 * Upload APIs may return either an absolute URL or a path such as
 * /uploads/evidence-file.jpg. Resolve relative media paths against the
 * backend origin, not the Next.js website origin (localhost:3000).
 */
function resolveEvidenceMediaUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;

  const configuredApiUrl =
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    "http://localhost:8000/api/v1";

  let backendOrigin = "http://localhost:8000";
  try {
    backendOrigin = new URL(configuredApiUrl, window.location.origin).origin;
  } catch {
    // Keep the local backend fallback for malformed or relative config values.
  }

  const normalizedPath = raw.startsWith("/") ? raw : `/${raw}`;
  return new URL(normalizedPath, backendOrigin).toString();
}

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
  const [queueSearch, setQueueSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["warehouseQualityQueue"],
    queryFn: () => api.get("/quality/inspections/queue"),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
    retry: 2,
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

  const queue: Inspection[] = useMemo(() => {
    // Support Axios, unwrapped API responses, and FastAPI response envelopes.
    let payload: any = data;
    for (let depth = 0; depth < 3; depth += 1) {
      if (payload && !Array.isArray(payload) && payload.data && typeof payload.data === "object") {
        payload = payload.data;
      } else {
        break;
      }
    }
    const rows = (Array.isArray(payload) ? payload : null)
      ?? payload?.inspections
      ?? payload?.items
      ?? payload?.results
      ?? payload?.data?.inspections
      ?? [];
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row: any) => row && typeof row === "object")
      .map((row: any) => ({
        ...row,
        id: String(row.id || row._id || ""),
        batch: {
          ...(row.batch || {}),
          lotNumber: row.batch?.lotNumber || row.lotNumber,
          cropName: row.batch?.cropName || row.cropName,
          quantityKg: row.batch?.quantityKg ?? row.weightKg,
          storageType: row.batch?.storageType || row.storageType,
        },
      }))
      .filter((row: Inspection) => Boolean(row.id));
  }, [data]);

  const visibleQueue = useMemo(() => queue.filter(item => {
    const q = queueSearch.trim().toLowerCase();
    const matchesSearch = !q || [item.batch?.cropName, item.batch?.lotNumber, item.id].some(value => String(value || "").toLowerCase().includes(q));
    return matchesSearch && (priorityFilter === "all" || (item.priority || "normal") === priorityFilter);
  }), [queue, queueSearch, priorityFilter]);

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
    <div className="warehouse-quality-page space-y-6 pb-8">
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-white to-emerald-50/70 p-5 shadow-sm lg:flex-row lg:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><ShieldCheck className="h-6 w-6"/></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Warehouse operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Quality Inspection</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Review farmer-submitted evidence, inspect received produce and record an authorized quality decision.</p></div>
        </div>
        <Button type="button" variant="outline" onClick={() => { refetch(); incomingQuery.refetch(); farmerTransfersQuery.refetch(); }} disabled={isFetching || incomingQuery.isFetching} className="shrink-0 bg-white"><Clock3 className="mr-2 h-4 w-4"/>{isFetching || incomingQuery.isFetching ? "Refreshing…" : "Refresh queues"}</Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-sm font-medium text-slate-500">Farmer inspections</p><p className="mt-1 text-3xl font-bold tabular-nums text-slate-950">{queue.length}</p><p className="mt-1 text-xs text-slate-500">Evidence submitted for review</p></div><div className="rounded-xl bg-sky-50 p-3 text-sky-700"><Camera className="h-5 w-5"/></div></CardContent></Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-sm font-medium text-slate-500">Urgent inspections</p><p className="mt-1 text-3xl font-bold tabular-nums text-amber-600">{queue.filter(x => x.priority === "critical" || x.priority === "urgent").length}</p><p className="mt-1 text-xs text-slate-500">Critical or urgent priority</p></div><div className="rounded-xl bg-amber-50 p-3 text-amber-700"><AlertTriangle className="h-5 w-5"/></div></CardContent></Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-sm font-medium text-slate-500">Incoming quality checks</p><p className="mt-1 text-3xl font-bold tabular-nums text-slate-950">{incomingQualityQueue.length}</p><p className="mt-1 text-xs text-slate-500">Warehouse fulfillment only</p></div><div className="rounded-xl bg-violet-50 p-3 text-violet-700"><PackageCheck className="h-5 w-5"/></div></CardContent></Card>
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50/60 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-white p-3 text-emerald-700"><ShieldCheck className="h-5 w-5"/></div><div><p className="text-sm font-semibold text-emerald-900">Inspection standard</p><p className="mt-1 text-xs leading-5 text-emerald-800">Only an authorized warehouse inspector can approve or reject produce.</p></div></CardContent></Card>
      </div>

      {error && <Card className="rounded-xl border-red-200 bg-red-50"><CardContent className="flex flex-col gap-3 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Unable to load inspection queue</p><p className="mt-1">{(error as Error).message || "The quality inspection API returned an error."}</p></div><Button type="button" size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["warehouseQualityQueue"] })}>Retry queue</Button></CardContent></Card>}

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-white pb-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-lg text-slate-900">Incoming Stock · Quality Recheck</CardTitle><p className="mt-1 text-sm leading-5 text-slate-500">Only received Warehouse Fulfillment shipments awaiting inspection appear here. Farmer Fulfillment orders are excluded.</p></div><Badge variant="outline" className="w-fit border-amber-200 bg-amber-50 text-amber-800">{incomingQualityQueue.length} awaiting recheck</Badge></div></CardHeader>
        <CardContent className="space-y-3 p-4">
          {incomingQuery.isLoading && <p className="text-sm text-slate-500">Loading incoming quality checks…</p>}
          {incomingQuery.isError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Could not load incoming receipt quality checks. Refresh and try again.</p>}
          {!incomingQuery.isLoading && !incomingQuery.isError && incomingQualityQueue.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center"><CheckCircle2 className="mx-auto h-6 w-6 text-emerald-600"/><p className="mt-2 text-sm font-semibold text-slate-800">No incoming quality rechecks pending</p><p className="mt-1 text-xs text-slate-500">New eligible warehouse receipts will appear here.</p></div>}
          <div className="grid gap-3 lg:grid-cols-2">{incomingQualityQueue.map((item: any) => <div key={item.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-900">{item.orderNumber || item.order?.orderNumber || item.orderId || item.id}</p><Badge variant="warning">Quality pending</Badge></div><p className="mt-1 text-sm font-medium text-slate-700">{item.productName || item.displayProductName || "Product"}</p><p className="mt-1 text-xs text-slate-500">Farm: {item.farmName || item.farmerName || "Farm details unavailable"} · Received: {item.quantityReceived ?? item.quantity ?? "—"} {item.unit || "kg"}</p></div><Button type="button" onClick={() => openIncomingRecheck(item)} className="shrink-0"><ShieldCheck className="mr-2 h-4 w-4"/>Review quality</Button></div>)}</div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedIncoming)} onOpenChange={(open) => { if (!open && !incomingQualityMutation.isPending) setSelectedIncoming(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-xl">
          <DialogHeader><DialogTitle>Review incoming shipment quality</DialogTitle><DialogDescription>Confirm usable quantity and save the final quality result. This does not receive the shipment again.</DialogDescription></DialogHeader>
          {selectedIncoming && <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="font-semibold text-slate-900">{selectedIncoming.orderNumber || selectedIncoming.orderId || selectedIncoming.id} · {selectedIncoming.productName || selectedIncoming.displayProductName || "Product"}</p><p className="mt-1 text-sm text-slate-500">Farm: {selectedIncoming.farmName || selectedIncoming.farmerName || "Farm details unavailable"}</p><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Declared quantity</p><p className="mt-1 text-base font-semibold text-slate-900">{selectedIncoming.quantity ?? "—"} {selectedIncoming.unit || "kg"}</p></div><div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Actually received</p><p className="mt-1 text-base font-semibold text-slate-900">{selectedIncoming.quantityReceived ?? selectedIncoming.receivedQuantity ?? "—"} {selectedIncoming.unit || "kg"}</p></div></div></div>
            <div><label className="text-sm font-medium text-slate-800">Usable quantity</label><input type="number" min="0" max={Number(selectedIncoming.quantityReceived ?? selectedIncoming.receivedQuantity ?? selectedIncoming.quantity ?? 0)} step="0.01" value={incomingUsableQuantity} onChange={e => setIncomingUsableQuantity(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"/></div>
            <div><label className="text-sm font-medium text-slate-800">Final quality result</label><select value={incomingQuality} onChange={e => setIncomingQuality(e.target.value as "passed" | "failed")} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="passed">Passed — continue to Store</option><option value="failed">Failed — reject / hold</option></select></div>
            <div><label className="text-sm font-medium text-slate-800">Inspection notes</label><textarea value={incomingQualityNotes} onChange={e => setIncomingQualityNotes(e.target.value)} placeholder="Record what was checked and the result" className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm" required/></div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4"><Button type="button" variant="outline" onClick={() => setSelectedIncoming(null)} disabled={incomingQualityMutation.isPending}>Cancel</Button><Button type="button" variant={incomingQuality === "failed" ? "destructive" : "default"} onClick={() => incomingQualityMutation.mutate(incomingQuality)} disabled={incomingQualityMutation.isPending || !incomingUsableQuantity.trim() || !Number.isFinite(Number(incomingUsableQuantity)) || Number(incomingUsableQuantity) < 0 || Number(incomingUsableQuantity) > Number(selectedIncoming.quantityReceived ?? selectedIncoming.receivedQuantity ?? selectedIncoming.quantity ?? 0) || !incomingQualityNotes.trim()}>{incomingQualityMutation.isPending ? "Saving result…" : incomingQuality === "passed" ? "Save passed result" : "Save failed result"}</Button></div>
          </div>}
        </DialogContent>
      </Dialog>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.4fr)]">
        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="space-y-3 border-b border-slate-100 bg-white pb-4">
            <div className="flex items-center justify-between gap-2"><div><CardTitle className="text-lg text-slate-900">Inspection queue</CardTitle><p className="mt-1 text-sm text-slate-500">Farmer-submitted harvest evidence</p></div><Badge variant="outline">{visibleQueue.length} shown</Badge></div>
            <input value={queueSearch} onChange={e => setQueueSearch(e.target.value)} placeholder="Search crop, lot or inspection ID…" className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400"/>
            <div className="flex flex-wrap gap-2">{["all","critical","urgent","normal"].map(value=><button type="button" key={value} onClick={()=>setPriorityFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition ${priorityFilter===value?"border-emerald-700 bg-emerald-700 text-white":"border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>{value==="all"?"All priorities":value}</button>)}</div>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {isLoading && <p className="p-4 text-sm text-slate-500">Loading inspection requests…</p>}
            {!isLoading && !error && queue.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600"/><p className="mt-2 text-sm font-semibold text-slate-800">Queue is clear</p><p className="mt-1 text-xs leading-5 text-slate-500">Farmer evidence submitted for this warehouse district will appear here.</p></div>}
            {!isLoading && !error && queue.length > 0 && visibleQueue.length === 0 && <p className="p-5 text-center text-sm text-slate-500">No inspections match these filters.</p>}
            {visibleQueue.map(item=><button type="button" key={item.id} onClick={()=>openInspection(item)} className={`w-full rounded-xl border p-4 text-left transition ${selected?.id===item.id?"border-emerald-400 bg-emerald-50/70 shadow-sm":"border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-900">{item.batch?.cropName || "Produce"}</p><p className="mt-1 text-xs text-slate-500">Lot {item.batch?.lotNumber || "—"} · {item.batch?.quantityKg ?? "—"} kg</p></div><Badge variant={item.priority==="critical"?"destructive":item.priority==="urgent"?"warning":"secondary"}>{item.priority || "normal"}</Badge></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5"/>{item.inspectionDueAt?new Date(item.inspectionDueAt).toLocaleString():"Due date not set"}</span><span className="font-medium text-emerald-700">{item.inspectionStatus==="in_progress"?"In progress":"Awaiting claim"}</span></div></button>)}
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-white pb-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="text-lg text-slate-900">{selected?"Inspection workspace":"Inspection details"}</CardTitle><p className="mt-1 text-sm text-slate-500">{selected?"Review evidence and record the physical inspection result.":"Select an inspection from the queue to begin."}</p></div>{selected && <Badge variant={selected.inspectionStatus==="in_progress"?"success":"warning"}>{selected.inspectionStatus==="in_progress"?"Claimed by inspector":"Awaiting claim"}</Badge>}</div></CardHeader>
          <CardContent className="p-4 sm:p-5">
            {!selected ? <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-8 text-center"><div className="rounded-2xl bg-white p-4 text-emerald-700 shadow-sm"><ClipboardCheck className="h-8 w-8"/></div><p className="mt-4 font-semibold text-slate-900">Choose a batch to inspect</p><p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">Review farmer-submitted photos and videos, claim the inspection, then record your measured quality findings.</p></div> : <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Product</p><p className="mt-1 font-semibold text-slate-900">{selected.batch?.cropName || "Produce"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Lot number</p><p className="mt-1 font-semibold text-slate-900">{selected.batch?.lotNumber || "—"}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Harvest quantity</p><p className="mt-1 font-semibold text-slate-900">{selected.batch?.quantityKg ?? "—"} kg</p></div></div>
              <section className="rounded-xl border border-slate-200 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-slate-900">Farmer-submitted evidence</h3><p className="mt-1 text-xs text-slate-500">Review the condition shown before recording a decision.</p></div><Badge variant="outline">{((selected as any).photos?.length||0)+((selected as any).videos?.length||0)} files</Badge></div>
                {(selected as any).photos?.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{(selected as any).photos.map((storedUrl:string,index:number)=>{const mediaUrl=resolveEvidenceMediaUrl(storedUrl);return <a key={storedUrl+index} href={mediaUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border bg-slate-50"><img src={mediaUrl} alt={`Farmer evidence ${index+1}`} loading="lazy" className="h-48 w-full bg-slate-100 object-contain transition group-hover:scale-[1.02]" onError={event=>{event.currentTarget.style.display="none";const fallback=event.currentTarget.nextElementSibling as HTMLElement|null;if(fallback)fallback.classList.remove("hidden");}}/><div className="hidden min-h-32 items-center justify-center p-4 text-sm text-rose-700">Image could not be loaded. Check backend upload access.</div><p className="border-t bg-white px-3 py-2 text-xs text-slate-500">Photo {index+1} · Open full size</p></a>;})}</div> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No photos submitted.</p>}
                {(selected as any).videos?.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{(selected as any).videos.map((storedUrl:string,index:number)=><div key={storedUrl+index} className="overflow-hidden rounded-xl border bg-black"><video src={resolveEvidenceMediaUrl(storedUrl)} controls playsInline preload="metadata" className="max-h-64 w-full"/><p className="bg-white px-3 py-2 text-xs text-slate-500">Farmer video {index+1}</p></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No videos submitted.</p>}
                {(selected as any).evidenceNotes && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{(selected as any).evidenceNotes}</p>}<p className="mt-3 text-xs text-slate-500">Evidence submitted: {(selected as any).evidenceSubmittedAt?new Date((selected as any).evidenceSubmittedAt).toLocaleString():"—"}</p>
              </section>
              {selected.inspectionStatus!=="in_progress" && <Button type="button" className="w-full" onClick={()=>claimMutation.mutate(selected.id)} disabled={claimMutation.isPending}>{claimMutation.isPending?"Claiming inspection…":"Claim inspection"}</Button>}
              <section className="rounded-xl border border-slate-200 p-4"><div className="mb-4"><h3 className="font-semibold text-slate-900">Physical quality assessment</h3><p className="mt-1 text-xs text-slate-500">Enter measurements from the actual warehouse inspection.</p></div><div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Quality grade<select value={grade} onChange={e=>setGrade(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option>A</option><option>B</option><option>C</option></select></label>
                <label className="text-sm font-medium text-slate-700">Freshness (%)<input value={freshness} onChange={e=>setFreshness(e.target.value)} type="number" min="0" max="100" className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/></label>
                <label className="text-sm font-medium text-slate-700">Damaged produce (%)<input value={damagedPct} onChange={e=>setDamagedPct(e.target.value)} type="number" min="0" max="100" className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/></label>
                <label className="text-sm font-medium text-slate-700">Measured weight (kg)<input value={weightKg} onChange={e=>setWeightKg(e.target.value)} type="number" min="0" className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"/></label>
              </div><label className="mt-4 block text-sm font-medium text-slate-700">Inspection notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Record appearance, freshness, damage, weight variance and other findings…" className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3 text-sm"/></label>
                <label className="mt-4 block text-sm font-medium text-slate-700">Reason for rejection (required to reject)<textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Explain the quality issue and why the batch cannot be approved…" className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 p-3 text-sm"/></label>
                <div className="mt-4 grid gap-2 sm:grid-cols-2"><Button type="button" onClick={()=>verifyMutation.mutate(selected.id)} disabled={verifyMutation.isPending||selected.inspectionStatus!=="in_progress"}><CheckCircle2 className="mr-2 h-4 w-4"/>{verifyMutation.isPending?"Saving approval…":"Approve quality"}</Button><Button type="button" variant="destructive" onClick={()=>rejectMutation.mutate(selected.id)} disabled={!rejectReason.trim()||rejectMutation.isPending||selected.inspectionStatus!=="in_progress"}><XCircle className="mr-2 h-4 w-4"/>{rejectMutation.isPending?"Rejecting…":"Reject batch"}</Button></div>
                {selected.inspectionStatus!=="in_progress" && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Claim this inspection before approving or rejecting it.</p>}
              </section>
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>AI may assist with screening, but it cannot replace the authorized physical inspection or approve the batch by itself.</div>
            </div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
