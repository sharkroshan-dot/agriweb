"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Clock3, Package, RefreshCw, Search, ShieldCheck, Sprout, Warehouse, XCircle } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { cn, formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";
import { WarehousePageHeader } from "../../components/warehouse/warehouse-page-header";

type FulfillmentKind = "farmer" | "warehouse";
type QualityResult = "passed" | "failed";

const asText = (value: unknown) => String(value ?? "").trim().toLowerCase();

const getFulfillmentKind = (item: any): FulfillmentKind => {
  const values = [
    item?.fulfillmentType,
    item?.fulfillment_type,
    item?.fulfillmentMethod,
    item?.fulfillment_method,
    item?.order?.fulfillmentType,
    item?.order?.fulfillmentMethod,
  ].map(asText);

  if (values.some((value) => ["farmer", "farmer_fulfillment", "farmer_fulfilled"].includes(value))) return "farmer";
  if (values.some((value) => ["warehouse", "warehouse_fulfillment", "warehouse_fulfilled"].includes(value))) return "warehouse";

  const sourceMode = asText(item?.sourceMode || item?.source_mode);
  if (["farmer_fulfillment_transfer", "farmer_fulfillment"].includes(sourceMode)) return "farmer";
  if (["warehouse_fulfillment_bulk", "warehouse_fulfillment"].includes(sourceMode)) return "warehouse";

  if (item?.packingRequired === false || item?.packing_required === false) return "farmer";
  if (item?.packingRequired === true || item?.packing_required === true) return "warehouse";

  // Do not infer farmer fulfillment from the presence of a pickup route/order ID.
  // Those fields can also exist on warehouse-fulfilled orders.
  return "warehouse";
};

const getReceiptState = (item: any) => {
  const status = asText(item?.status);
  if (["received", "quality_check", "quality_passed", "stored", "rejected"].includes(status)) return true;
  return Boolean(item?.receivedAt || item?.receivedDate || item?.warehouseReceivedAt || item?.bulkShipmentReceivedAt);
};

const getQualityState = (item: any) => {
  const quality = asText(item?.qualityCheck || item?.quality_check || item?.receipt?.qualityResult);
  if (quality === "passed" || asText(item?.status) === "quality_passed") return "passed";
  if (quality === "failed" || asText(item?.status) === "rejected") return "failed";
  if (getReceiptState(item)) return "pending";
  return "not_started";
};

const getOrderReference = (item: any) =>
  item?.orderNumber ||
  item?.order_number ||
  item?.order?.orderNumber ||
  item?.eventOrderNumber ||
  item?.requestNumber ||
  item?.orderId ||
  item?.id ||
  item?._id ||
  "Order reference unavailable";

const getProductName = (item: any) =>
  item?.productName || item?.product?.name || item?.product?.productName || "Product details unavailable";

const getFarmerName = (item: any) =>
  item?.farmName || item?.farmerName || item?.pickupLocation?.farmName || item?.pickupLocation?.name || "Farm details unavailable";

const getQuantity = (item: any) =>
  Number(item?.quantityReceived ?? item?.receivedQuantity ?? item?.actualQuantityReceived ?? item?.quantity ?? 0);

const getStatusLabel = (item: any) => {
  const quality = getQualityState(item);
  if (quality === "passed") return "Quality Passed";
  if (quality === "failed") return "Quality Failed";
  if (quality === "pending") return "Quality Check Pending";
  const status = asText(item?.status);
  if (["scheduled", "ready_for_pickup"].includes(status)) return "Awaiting Warehouse Receipt";
  if (status === "in_transit") return "In Transit to Warehouse";
  return "Awaiting Warehouse Receipt";
};

export default function WarehouseIncomingPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | FulfillmentKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "receipt" | "quality" | "passed" | "failed">("all");
  const [selected, setSelected] = useState<any>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [usableQuantity, setUsableQuantity] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [qualityNotes, setQualityNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseIncomingWorkflow"],
    queryFn: () => api.get("/warehouse/me/incoming", { params: { limit: 100 } }),
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  const shipments = useMemo(() => {
    const raw = data?.data?.incoming ?? data?.incoming ?? [];
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.results) ? raw.results : [];
    const query = search.trim().toLowerCase();
    return rows.map((item: any) => ({
      ...item,
      _fulfillmentKind: getFulfillmentKind(item),
      _received: getReceiptState(item),
      _quality: getQualityState(item),
    })).filter((item: any) => {
      if (typeFilter !== "all" && item._fulfillmentKind !== typeFilter) return false;
      if (statusFilter === "receipt" && item._received) return false;
      if (statusFilter === "quality" && (!item._received || item._quality !== "pending")) return false;
      if (statusFilter === "passed" && item._quality !== "passed") return false;
      if (statusFilter === "failed" && item._quality !== "failed") return false;
      if (!query) return true;
      return [
        getOrderReference(item), getProductName(item), getFarmerName(item),
        item?.pickupLocation?.address, item?.farmAddress, item?.batchNumber,
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
    }).sort((a: any, b: any) => {
      const priority = (item: any) => !item._received ? 0 : item._quality === "pending" ? 1 : item._quality === "passed" ? 2 : 3;
      return priority(a) - priority(b);
    });
  }, [data, search, typeFilter, statusFilter]);

  const counts = useMemo(() => ({
    total: shipments.length,
    awaitingReceipt: shipments.filter((item: any) => !item._received).length,
    qualityPending: shipments.filter((item: any) => item._received && item._quality === "pending").length,
    passed: shipments.filter((item: any) => item._quality === "passed").length,
    failed: shipments.filter((item: any) => item._quality === "failed").length,
    farmer: shipments.filter((item: any) => item._fulfillmentKind === "farmer").length,
    warehouse: shipments.filter((item: any) => item._fulfillmentKind === "warehouse").length,
  }), [shipments]);

  const openReceipt = (item: any) => {
    setSelected(item);
    setReceivedQuantity(String(item?.quantity ?? 1));
    setUsableQuantity(String(item?.quantity ?? 1));
    setReceiptNotes("");
    setReceiptOpen(true);
  };

  const saveReceipt = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected?.id) {
      toast.error("This incoming record has no receipt ID.");
      return;
    }
    const received = Number(receivedQuantity);
    const usable = Number(usableQuantity);
    if (!Number.isFinite(received) || received <= 0 || !Number.isFinite(usable) || usable < 0 || usable > received) {
      toast.error("Enter a valid received quantity and usable quantity.");
      return;
    }
    if (Math.abs(received - Number(selected.quantity || 0)) > 0.001 && !receiptNotes.trim()) {
      toast.error("Add a note explaining the difference from the expected quantity.");
      return;
    }
    try {
      setSaving(true);
      await api.put("/warehouse/me/incoming/" + selected.id + "/receive", undefined, {
        params: {
          quantity: received,
          usableQuantity: usable,
          quality_check: "pending",
          notes: receiptNotes.trim() || undefined,
        },
      });
      toast.success("Warehouse receipt recorded. The order is now waiting for quality inspection.");
      setReceiptOpen(false);
      await refetch();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || "Could not record warehouse receipt.");
    } finally {
      setSaving(false);
    }
  };

  const saveQuality = async (result: QualityResult) => {
    if (!selected?.id) return;
    try {
      setSaving(true);
      await api.put("/warehouse/me/incoming/" + selected.id + "/quality", {
        qualityCheck: result,
        usableQuantity: Number(selected.quantityReceived ?? selected.receivedQuantity ?? selected.quantity ?? 0),
        notes: qualityNotes.trim() || undefined,
      });
      toast.success(result === "passed" ? "Quality passed. This order can now continue to its fulfillment page." : "Quality failed. The order remains on hold and will not be routed.");
      setQualityOpen(false);
      setQualityNotes("");
      await refetch();
    } catch (error: any) {
      toast.error(error?.response?.data?.detail || error?.message || "Could not save the quality inspection.");
    } finally {
      setSaving(false);
    }
  };

  const continueToFulfillment = (item: any) => {
    if (getQualityState(item) !== "passed") {
      toast.error("Quality inspection must pass before this order can continue.");
      return;
    }
    if (getFulfillmentKind(item) === "farmer") {
      window.location.assign("/warehouse/farmer-fulfillment");
      return;
    }
    const orderId = item?.orderId || item?.order_id || item?.order?.id || item?.order?._id;
    window.location.assign(orderId ? "/packing?orderId=" + encodeURIComponent(String(orderId)) : "/packing");
  };

  if (isLoading) {
    return <div className="space-y-5"><WarehousePageHeader eyebrow="Warehouse operations" title="Incoming Stock" description="Receive stock, inspect quality, and route accepted orders to fulfillment." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div><div className="h-96 animate-pulse rounded-xl bg-muted" /></div>;
  }

  return (
    <div className="warehouse-incoming-page mx-auto w-full max-w-[1800px] space-y-5 pb-8">
      <WarehousePageHeader
        eyebrow="Warehouse operations"
        title="Incoming Stock"
        description="Receive orders at the warehouse, complete quality inspection, then continue to the correct fulfillment workflow."
        actions={<Button variant="outline" size="icon" aria-label="Refresh incoming stock" onClick={() => { void refetch(); }}><RefreshCw className="h-4 w-4" /></Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total Incoming", value: counts.total, icon: Package, tone: "bg-slate-100 text-slate-700" },
          { label: "Awaiting Receipt", value: counts.awaitingReceipt, icon: Clock3, tone: "bg-amber-50 text-amber-700" },
          { label: "Quality Checking", value: counts.qualityPending, icon: ShieldCheck, tone: "bg-blue-50 text-blue-700" },
          { label: "Quality Passed", value: counts.passed, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "Quality Failed", value: counts.failed, icon: XCircle, tone: "bg-red-50 text-red-700" },
        ].map((metric) => {
          const Icon = metric.icon;
          return <Card key={metric.label} className="rounded-2xl border-slate-200 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><span className={cn("flex h-10 w-10 items-center justify-center rounded-xl", metric.tone)}><Icon className="h-5 w-5" /></span><div><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className="text-2xl font-bold tracking-tight">{metric.value}</p></div></CardContent></Card>;
        })}
      </div>

      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="text-lg font-bold">Warehouse Receiving & Quality Queue</h2><p className="text-sm text-muted-foreground">Only warehouse receipt and quality inspection actions are managed here.</p></div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={typeFilter === "all" ? "default" : "outline"} onClick={() => setTypeFilter("all")}>All Types ({counts.total})</Button>
              <Button size="sm" variant={typeFilter === "farmer" ? "default" : "outline"} onClick={() => setTypeFilter("farmer")}><Sprout className="mr-1.5 h-4 w-4" />Farmer ({counts.farmer})</Button>
              <Button size="sm" variant={typeFilter === "warehouse" ? "default" : "outline"} onClick={() => setTypeFilter("warehouse")}><Warehouse className="mr-1.5 h-4 w-4" />Warehouse ({counts.warehouse})</Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_220px]">
            <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, farmer or product..." className="pl-9" /></div>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as any)}>
              <option value="all">All statuses</option><option value="receipt">Awaiting receipt</option><option value="quality">Quality checking</option><option value="passed">Quality passed</option><option value="failed">Quality failed</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="hidden grid-cols-[1.2fr_1fr_1fr_0.7fr_0.9fr_auto] gap-3 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 lg:grid">
              <span>Order / Reference</span><span>Farm / Product</span><span>Fulfillment Type</span><span>Quantity</span><span>Status</span><span className="text-right">Action</span>
            </div>
            {shipments.length === 0 ? <div className="p-10 text-center"><Package className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 font-semibold">No incoming orders found</p><p className="mt-1 text-sm text-muted-foreground">Try another filter or refresh the receiving queue.</p></div> : shipments.map((item: any) => {
              const quality = item._quality;
              const received = item._received;
              const kind = item._fulfillmentKind;
              const passed = quality === "passed";
              const failed = quality === "failed";
              const canReceive = !received;
              const canInspect = received && quality === "pending";
              return <div key={String(item.id || item._id || getOrderReference(item))} className="grid gap-3 border-t border-slate-100 px-4 py-4 first:border-t-0 lg:grid-cols-[1.2fr_1fr_1fr_0.7fr_0.9fr_auto] lg:items-center">
                <div className="min-w-0"><p className="break-all text-sm font-semibold">{getOrderReference(item)}</p><p className="mt-1 text-xs text-muted-foreground">{item?.expectedDate ? "Expected " + formatDate(item.expectedDate) : "Expected date unavailable"}</p></div>
                <div className="min-w-0"><p className="text-sm font-medium">{getFarmerName(item)}</p><p className="text-xs text-muted-foreground">{getProductName(item)}</p></div>
                <div><Badge variant="outline" className={kind === "farmer" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700"}>{kind === "farmer" ? "Farmer Fulfillment" : "Warehouse Fulfillment"}</Badge></div>
                <div><p className="text-sm font-semibold">{received ? getQuantity(item) : Number(item.quantity || 0)} {item.unit || "kg"}</p><p className="text-xs text-muted-foreground">{received ? "Received" : "Expected"}</p></div>
                <div><Badge variant="outline" className={cn("border", passed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : failed ? "border-red-200 bg-red-50 text-red-700" : received ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600")}>{getStatusLabel(item)}</Badge></div>
                <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                  {canReceive && <Button size="sm" onClick={() => openReceipt(item)}>Confirm Receipt</Button>}
                  {canInspect && <Button size="sm" onClick={() => { setSelected(item); setQualityNotes(""); setQualityOpen(true); }}>Start Quality Check</Button>}
                  {passed && <Button size="sm" onClick={() => continueToFulfillment(item)}><ArrowRight className="mr-1.5 h-4 w-4" />{kind === "farmer" ? "Farmer Fulfillment" : "Order Packing"}</Button>}
                  {failed && <Badge variant="destructive">On hold</Badge>}
                </div>
              </div>;
            })}
          </div>
          <p className="text-xs text-muted-foreground">Quality-passed orders remain visible here for traceability. They are not stored as a separate Incoming Stock step; continue them to Farmer Fulfillment or Order Packing.</p>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="rounded-xl border-slate-200"><CardContent className="flex gap-3 p-4"><span className="rounded-lg bg-slate-100 p-2"><Package className="h-5 w-5" /></span><div><p className="font-semibold">1. Warehouse Received</p><p className="mt-1 text-xs text-muted-foreground">Confirm physical arrival and actual quantity.</p></div></CardContent></Card>
        <Card className="rounded-xl border-slate-200"><CardContent className="flex gap-3 p-4"><span className="rounded-lg bg-amber-50 p-2 text-amber-700"><ShieldCheck className="h-5 w-5" /></span><div><p className="font-semibold">2. Quality Check</p><p className="mt-1 text-xs text-muted-foreground">Inspect the received product before approving it.</p></div></CardContent></Card>
        <Card className="rounded-xl border-slate-200"><CardContent className="flex gap-3 p-4"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><ArrowRight className="h-5 w-5" /></span><div><p className="font-semibold">3. Continue Fulfillment</p><p className="mt-1 text-xs text-muted-foreground">Farmer orders go to Farmer Fulfillment; warehouse orders go to Order Packing.</p></div></CardContent></Card>
      </div>

      <Dialog open={receiptOpen} onOpenChange={setReceiptOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Confirm Warehouse Receipt</DialogTitle><DialogDescription>Confirm that this order physically arrived at this warehouse. Quality inspection is a separate step after receipt.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={saveReceipt}>
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{getOrderReference(selected || {})}</p><p className="text-muted-foreground">{getFarmerName(selected || {})} · {getProductName(selected || {})}</p><p className="mt-1">Expected: {selected?.quantity ?? "—"} {selected?.unit || "kg"}</p></div>
            <div><label className="mb-1 block text-sm font-medium">Actual received quantity</label><Input type="number" min="0.01" step="0.01" value={receivedQuantity} onChange={(event) => setReceivedQuantity(event.target.value)} required /></div>
            <div><label className="mb-1 block text-sm font-medium">Usable quantity for inspection</label><Input type="number" min="0" step="0.01" value={usableQuantity} onChange={(event) => setUsableQuantity(event.target.value)} required /></div>
            <div><label className="mb-1 block text-sm font-medium">Receipt notes / quantity discrepancy</label><Input value={receiptNotes} onChange={(event) => setReceiptNotes(event.target.value)} placeholder="Optional unless quantity differs" /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setReceiptOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Confirm Warehouse Receipt"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={qualityOpen} onOpenChange={setQualityOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Quality Inspection</DialogTitle><DialogDescription>Inspect the physically received product. Only passed orders can continue to the next fulfillment page.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{getOrderReference(selected || {})}</p><p className="text-muted-foreground">{getProductName(selected || {})} · Received {getQuantity(selected || {})} {selected?.unit || "kg"}</p></div>
            <div><label className="mb-1 block text-sm font-medium">Inspection notes</label><Input value={qualityNotes} onChange={(event) => setQualityNotes(event.target.value)} placeholder="Record grade, damage or inspection observations..." /></div>
            <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setQualityOpen(false)}>Cancel</Button><Button variant="destructive" onClick={() => saveQuality("failed")} disabled={saving}>Fail / Hold</Button><Button onClick={() => saveQuality("passed")} disabled={saving}><CheckCircle2 className="mr-1.5 h-4 w-4" />Pass Quality</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
