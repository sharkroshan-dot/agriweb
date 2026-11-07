"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Plus,
  XCircle,
  Loader2,
  CheckCircle2,
  Link2,
  Layers,
  Snowflake,
  Wheat,
  FlaskConical,
  PackagePlus,
  QrCode,
  Search,
  RefreshCw,
  CalendarDays,
  Clock3,
  ShieldCheck,
  AlertTriangle,
  Filter,
  PackageCheck,
  CircleCheck,
} from "lucide-react";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";

interface Batch {
  id: string;
  lotNumber: string;
  cropName: string;
  quantityKg: number;
  remainingKg: number;
  harvestDate: string;
  qualityGrade?: string;
  storageType?: string;
  shelfLifeDays?: number;
  defaultShelfLifeDays?: number;
  actualShelfLifeDays?: number;
  expiresAt?: string;
  safeDeliveryDate?: string;
  masterCropId?: string;
  status: string;
  productId?: string;
  sourceHarvestPlanId?: string;
  notes?: string;
  freshness?: { status: string; daysRemaining?: number; expiresAt?: string };
  qualityStatus?: string;
  inspectionPriority?: "critical" | "urgent" | "normal";
  inspectionDueAt?: string;
  inspectionId?: string;
}

interface FarmerProduct {
  _id: string;
  name: string;
  quantity: number;
  price: number;
  unit: string;
  sourceHarvestPlanId?: string;
}

const STORAGE_OPTIONS = [
  { value: "normal", label: "Normal / ambient" },
  { value: "refrigerated", label: "Refrigerated" },
  { value: "cold_storage", label: "Cold storage" },
  { value: "frozen", label: "Frozen" },
];

const GRADE_OPTIONS = ["Premium", "Standard", "Economy"];

export default function FarmerBatchesPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const fromHarvestId = searchParams.get("fromHarvest") || "";
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "inspection" | "listed" | "expired">("all");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedHarvestId, setSelectedHarvestId] = useState("");
  const [form, setForm] = useState({
    cropName: "",
    quantityKg: "100",
    harvestDate: "",
    qualityGrade: "Premium",
    storageType: "normal",
    shelfLifeDays: "3",
    notes: "",
  });
  const [converting, setConverting] = useState<{ batchId: string; productId: string } | null>(null);
  const storageShelfLifeDefaults: Record<string, number> = { normal: 3, refrigerated: 5, cold_storage: 7, frozen: 30 };

  const { data: batchesData, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["farmerBatches"],
    queryFn: () => api.get("/batches"),
  });

  const { data: harvestedData, isLoading: harvestedLoading } = useQuery({
    queryKey: ["farmerHarvestedForBatches"],
    queryFn: () => api.get("/harvests/farmer/plans", { params: { status: "harvested" } }),
    enabled: showForm,
  });

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["farmerProductsForBatches"],
    queryFn: () => api.get("/farmers/me/products", { params: { limit: 100 } }),
    enabled: showForm || converting !== null,
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/batches", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerBatches"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestedForBatches"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestPlans"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvests"] });
      setShowForm(false);
      setSelectedProductId("");
      setSelectedHarvestId("");
      setForm({ cropName: "", quantityKg: "", harvestDate: "", qualityGrade: "Premium", storageType: "normal", shelfLifeDays: "3", notes: "" });
      toast.success("Batch created with a new lot number!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create batch"),
  });

  const convertMutation = useMutation({
    mutationFn: ({ batchId, productId }: { batchId: string; productId: string }) =>
      api.post(`/batches/${batchId}/convert`, { productId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerBatches"] });
      setConverting(null);
      toast.success("Batch added to product inventory");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to convert batch"),
  });
  const requestInspectionMutation = useMutation({
    mutationFn: (batchId: string) => api.post('/quality/inspections/request', { batchId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['farmerBatches'] }); toast.success('Quality inspection requested'); },
    onError: (err: any) => toast.error(err?.message || 'Could not request inspection'),
  });

  const urgentMutation = useMutation({
    mutationFn: (inspectionId: string) => api.post(`/quality/inspections/${inspectionId}/urgent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerBatches"] });
      toast.success("Inspection escalated as urgent");
    },
    onError: (err: any) => toast.error(err?.message || "Could not escalate inspection"),
  });


  const batches: Batch[] = (batchesData?.data?.batches || []).map((b: any) => ({ ...b, id: b._id || b.id }));
  const products: FarmerProduct[] = productsData?.data?.products || productsData?.data || [];
  const harvestedPlans: any[] = harvestedData?.data?.plans || harvestedData?.plans || [];

  // Use the API freshness state when available, with the expiry timestamp as a
  // fallback so older batch records still appear in the Expired dashboard view.
  const isBatchExpired = (batch: Batch) => {
    if (batch.freshness?.status === "expired") return true;
    const expiry = batch.expiresAt || batch.freshness?.expiresAt;
    if (!expiry) return false;
    const expiryTime = new Date(expiry).getTime();
    return Number.isFinite(expiryTime) && expiryTime <= Date.now();
  };

  const batchSummary = useMemo(() => ({
    total: batches.length,
    awaitingInspection: batches.filter((batch) => batch.qualityStatus !== "approved" && batch.qualityStatus !== "rejected").length,
    listed: batches.filter((batch) => Boolean(batch.productId)).length,
    expired: batches.filter(isBatchExpired).length,
    remainingKg: batches.reduce((sum, batch) => sum + Math.max(0, Number(batch.remainingKg || 0)), 0),
  }), [batches]);

  const filteredBatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return batches.filter((batch) => {
      const matchesSearch = !query || [
        batch.lotNumber,
        batch.cropName,
        batch.qualityGrade,
        batch.storageType,
        batch.status,
        batch.qualityStatus,
      ].some((value) => String(value || "").toLowerCase().includes(query));

      const matchesFilter =
        activeFilter === "all" ||
        (activeFilter === "inspection" && batch.qualityStatus !== "approved" && batch.qualityStatus !== "rejected") ||
        (activeFilter === "listed" && Boolean(batch.productId)) ||
        (activeFilter === "expired" && isBatchExpired(batch));

      return matchesSearch && matchesFilter;
    });
  }, [batches, searchQuery, activeFilter]);

  // Batch creation is one-to-one with a product. Once a product has a batch,
  // it must never appear again in the batch-creation selector.
  const productsWithBatches = new Set(
    batches.map((batch) => batch.productId).filter(Boolean).map((id) => String(id))
  );
  const harvestPlansWithBatches = new Set(
    batches.map((batch) => batch.sourceHarvestPlanId).filter(Boolean).map((id) => String(id))
  );
  const batchEligibleProducts = products.filter((product) => {
    const productId = String(product._id);
    const sourcePlanId = String(product.sourceHarvestPlanId || "");
    return !productsWithBatches.has(productId) && !harvestPlansWithBatches.has(sourcePlanId);
  });
  const availableHarvests = harvestedPlans
    .filter((plan) => {
      const id = String(plan.id || plan._id || "");
      return id && !batches.some((batch) => String(batch.sourceHarvestPlanId || "") === id);
    })
    .sort((a, b) => new Date(b.harvestedAt || b.expectedHarvestDate).getTime() - new Date(a.harvestedAt || a.expectedHarvestDate).getTime());
  const selectedProduct = batchEligibleProducts.find((product) => String(product._id) === selectedProductId);
  const selectedHarvest = availableHarvests.find((plan) => String(plan.id || plan._id) === selectedHarvestId);
  const selectedHarvestQuantity = Number(selectedHarvest?.actualQuantityKg ?? selectedHarvest?.expectedQuantityKg ?? 0);

  // Guided Harvest -> Batch handoff: hydrate the form from the harvested plan
  // so the farmer never has to search for the harvest or re-enter its quantity.
  useEffect(() => {
    if (!fromHarvestId || harvestedLoading || !availableHarvests.length) return;
    const plan = availableHarvests.find((item) => String(item.id || item._id) === fromHarvestId);
    if (!plan) return;
    const planId = String(plan.id || plan._id);
    setShowForm(true);
    setSelectedHarvestId(planId);
    setForm((previous) => ({
      ...previous,
      cropName: String(plan.cropName || ""),
      quantityKg: String(plan.actualQuantityKg ?? plan.expectedQuantityKg ?? ""),
      harvestDate: String(plan.harvestedAt || plan.expectedHarvestDate || ""),
    }));
  }, [fromHarvestId, harvestedLoading, availableHarvests.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHarvest || selectedHarvestQuantity <= 0) {
      toast.error("Select a harvested crop first");
      return;
    }
    createMutation.mutate({
      ...(selectedProductId ? { productId: selectedProductId } : {}),
      cropName: selectedProduct?.name || selectedHarvest.cropName,
      quantityKg: selectedHarvestQuantity,
      harvestDate: selectedHarvest.harvestedAt || selectedHarvest.expectedHarvestDate,
      qualityGrade: form.qualityGrade,
      storageType: form.storageType,
      shelfLifeDays: form.shelfLifeDays ? Number(form.shelfLifeDays) : undefined,
      sourceHarvestPlanId: String(selectedHarvest.id || selectedHarvest._id),
      notes: form.notes || undefined,
    });
  };

  const freshnessBadge = (batch: Batch) => {
    const f = batch.freshness?.status;
    // Keep the row status consistent with the Expired summary and filter,
    // including legacy records that only have an expiresAt timestamp.
    if (isBatchExpired(batch)) return <Badge variant="destructive">Expired</Badge>;
    if (f === "expiring") return <Badge variant="warning">Expiring ({batch.freshness?.daysRemaining}d left)</Badge>;
    if (f === "fresh") return <Badge variant="success">Fresh ({batch.freshness?.daysRemaining}d left)</Badge>;
    return <Badge variant="secondary">Unknown</Badge>;
  };

  const storageLabel = (s?: string) => STORAGE_OPTIONS.find((o) => o.value === s)?.label ?? "—";

  const qualityBadge = (batch: Batch) => {
    if (batch.qualityStatus === "approved") return <Badge variant="success">Quality approved</Badge>;
    if (batch.qualityStatus === "rejected") return <Badge variant="destructive">Quality rejected</Badge>;
    if (batch.inspectionPriority === "critical") return <Badge variant="destructive">Inspection critical</Badge>;
    if (batch.inspectionPriority === "urgent") return <Badge variant="warning">Inspection urgent</Badge>;
    return <Badge variant="secondary">Awaiting inspection</Badge>;
  };

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Harvest lots & product traceability"
        title="Batches & Traceability"
        description="Track harvested lots, monitor freshness and shelf life, complete quality inspection and link approved batches to marketplace products."
      >
        <Button
          type="button"
          className="h-10 bg-emerald-700 shadow-sm hover:bg-emerald-800"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Close form" : "New batch"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </FarmerPageHeader>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Total batches", value: batchSummary.total, icon: Layers, tone: "bg-slate-100 text-slate-700" },
          { label: "Awaiting inspection", value: batchSummary.awaitingInspection, icon: FlaskConical, tone: "bg-amber-50 text-amber-700" },
          { label: "Listed", value: batchSummary.listed, icon: PackageCheck, tone: "bg-emerald-50 text-emerald-700" },
          { label: "Expired", value: batchSummary.expired, icon: AlertTriangle, tone: "bg-rose-50 text-rose-700" },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-200 shadow-sm">
            <CardContent className="flex min-w-0 items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{isLoading || isError ? "—" : stat.value}</p>
              </div>
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", stat.tone)}>
                <stat.icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      {showForm && (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/60">
            <CardTitle className="text-base font-semibold text-slate-950">Create batch from harvested crop</CardTitle>
            <CardDescription>
              Select a completed harvest to create its traceable batch. The marketplace product can be linked after quality approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 rounded-xl sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-500">Harvested crop *</label>
                <Select value={selectedHarvestId} onValueChange={(v) => {
                  setSelectedHarvestId(v);
                  const plan = availableHarvests.find((p) => String(p.id || p._id) === v);
                  const linked = batchEligibleProducts.find((p) => String(p.sourceHarvestPlanId || "") === v);
                  setSelectedProductId(linked?._id || "");
                  setForm((current) => ({
                    ...current,
                    cropName: linked?.name || plan?.cropName || "",
                    quantityKg: String(plan?.actualQuantityKg ?? 0),
                    harvestDate: plan?.harvestedAt ? String(plan.harvestedAt).slice(0, 10) : "",
                  }));
                }}>
                  <SelectContent>
                    {availableHarvests.map((plan) => (
                      <SelectItem key={String(plan.id || plan._id)} value={String(plan.id || plan._id)}>
                        {plan.cropName} — {plan.actualQuantityKg || 0} kg
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400">Batch creation starts from the completed harvest. A product link is optional and can be added after quality approval.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Crop name</label>
                <Input value={form.cropName} readOnly className="bg-slate-50" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Harvest quantity (kg)</label>
                <Input type="number" value={form.quantityKg} readOnly className="bg-slate-50" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Harvest date</label>
                <Input type="date" value={form.harvestDate} readOnly className="bg-slate-50" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Quality grade</label>
                <Select value={form.qualityGrade} onValueChange={(v) => setForm({ ...form, qualityGrade: v })}>
                  <SelectContent>
                    {GRADE_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Storage type</label>
                <Select value={form.storageType} onValueChange={(v) => setForm({ ...form, storageType: v, shelfLifeDays: String(storageShelfLifeDefaults[v] ?? 3) })}>
                  <SelectContent>
                    {STORAGE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Actual shelf life (days)</label>
                <Input type="number" min="1" max="90" value={form.shelfLifeDays} onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })} />
                <p className="text-xs text-muted-foreground">Default: {storageShelfLifeDefaults[form.storageType] ?? 3} days for this storage type. Confirm or adjust the actual batch shelf life.</p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-500">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="variety, field plot, remarks..." />
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <Button type="submit" disabled={createMutation.isPending || !selectedHarvest}>
                  {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Create Batch
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && batches.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Harvest batches</h2>
              <p className="mt-1 text-sm text-slate-500">{filteredBatches.length} of {batches.length} batches shown · {batchSummary.remainingKg.toLocaleString("en-IN")} kg remaining in stock</p>
            </div>
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search lot number, crop or grade..."
                aria-label="Search harvest batches"
                className="h-10 w-full bg-white pl-9 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
            <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Filter className="h-3.5 w-3.5" />Filter
            </span>
            {([
              ["all", "All batches", batches.length],
              ["inspection", "Needs inspection", batchSummary.awaitingInspection],
              ["listed", "Listed", batchSummary.listed],
              ["expired", "Expired", batchSummary.expired],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={activeFilter === value}
                onClick={() => setActiveFilter(value)}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors",
                  activeFilter === value
                    ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                )}
              >
                {label}
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums", activeFilter === value ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{count}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {isError ? (
        <Card className="border-red-200 shadow-sm">
          <CardContent className="flex flex-col items-center px-5 py-14 text-center">
            <AlertTriangle className="h-10 w-10 text-red-600" />
            <h2 className="mt-3 text-base font-semibold text-slate-900">Unable to load batches</h2>
            <p className="mt-1 max-w-lg text-sm text-slate-600">{(error as any)?.response?.data?.detail || (error as any)?.message || "Check your connection and try again."}</p>
            <Button className="mt-4 bg-emerald-700 hover:bg-emerald-800" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />Try again
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid gap-3" aria-label="Loading batches">
          {[0, 1, 2].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : batches.length === 0 ? (
        <Card className="border-dashed border-slate-300 shadow-none">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Package className="h-7 w-7" /></span>
            <h2 className="text-base font-semibold text-slate-900">No batches created yet</h2>
            <p className="max-w-md text-sm leading-6 text-slate-500">Create a traceable lot from a completed harvest to record shelf life, complete quality inspection and prepare the produce for listing.</p>
            <Button className="mt-2 bg-emerald-700 hover:bg-emerald-800" onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />Create first batch
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {filteredBatches.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <Search className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-900">No matching batches</p>
              <p className="mt-1 text-sm text-slate-500">Try another search or filter.</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchQuery(""); setActiveFilter("all"); }}>Clear filters</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Batch / product</th>
                    <th className="px-4 py-3">Harvest date</th>
                    <th className="px-4 py-3">Quantity</th>
                    <th className="px-4 py-3">Storage</th>
                    <th className="px-4 py-3">Quality grade</th>
                    <th className="px-4 py-3">Shelf life</th>
                    <th className="px-4 py-3">Batch status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBatches.map((batch) => (
                    <Fragment key={batch.id}>
                      <tr className="align-top transition-colors hover:bg-slate-50/70">
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Layers className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <p className="font-mono text-xs font-bold text-slate-900">{batch.lotNumber}</p>
                              <p className="mt-1 text-sm font-semibold text-slate-800">{batch.cropName}</p>
                              <p className="mt-1 text-xs text-slate-500">{batch.productId ? "Linked to marketplace" : "Not listed yet"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{formatDate(batch.harvestDate)}</td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <p className="text-sm font-semibold tabular-nums text-slate-900">{Number(batch.quantityKg || 0).toLocaleString("en-IN")} kg</p>
                          <p className="mt-1 text-xs text-slate-500">{Number(batch.remainingKg || 0).toLocaleString("en-IN")} kg remaining</p>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">{storageLabel(batch.storageType)}</td>
                        <td className="px-4 py-4 text-sm text-slate-700">{batch.qualityGrade || "—"}</td>
                        <td className="px-4 py-4">
                          <p className="text-sm font-medium text-slate-800">{batch.actualShelfLifeDays ?? batch.shelfLifeDays ?? "—"} days actual</p>
                          <p className="mt-1 text-xs text-slate-500">Default: {batch.defaultShelfLifeDays ?? "—"} days</p>
                          <p className="mt-1 text-xs text-slate-500">Safe by: {batch.safeDeliveryDate ? formatDate(batch.safeDeliveryDate) : "Not set"}</p>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col items-start gap-1.5">
                            {freshnessBadge(batch)}
                            {qualityBadge(batch)}
                            {batch.productId ? <Badge variant="outline"><Link2 className="mr-1 h-3 w-3" /> Listed</Badge> : <Badge variant="secondary">Unlisted</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-2">
                            <a href={`/trace/${encodeURIComponent(batch.lotNumber)}`} target="_blank" rel="noreferrer" aria-label={`Open traceability for ${batch.lotNumber}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800">
                              <QrCode className="h-4 w-4" /> Trace
                            </a>
                            {!batch.productId && batch.status === "created" && batch.qualityStatus === "approved" && (
                              <Button size="sm" className="h-9 bg-emerald-700 px-2.5 text-xs hover:bg-emerald-800" onClick={() => setConverting({ batchId: batch.id, productId: "" })}>
                                <PackagePlus className="mr-1 h-3.5 w-3.5" /> List
                              </Button>
                            )}
                            {batch.qualityStatus === "pending_inspection" && batch.inspectionId && (
                              <Button size="sm" variant="outline" className="h-9 border-amber-200 px-2.5 text-xs text-amber-800 hover:bg-amber-50" disabled={urgentMutation.isPending} onClick={() => urgentMutation.mutate(batch.inspectionId!)}>
                                {urgentMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="mr-1 h-3.5 w-3.5" />} Urgent
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {converting?.batchId === batch.id && (
                        <tr className="bg-emerald-50/40">
                          <td colSpan={8} className="px-4 py-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Link {batch.lotNumber} to a marketplace product</p>
                                <p className="mt-1 text-xs text-slate-600">Choose the product that should receive this approved batch inventory.</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Select value={converting.productId} onValueChange={(value) => setConverting({ batchId: batch.id, productId: value })}>
                                  <SelectContent>
                                    <SelectItem value="">Select a product...</SelectItem>
                                    {products.map((product) => (
                                      <SelectItem key={product._id} value={product._id}>{product.name} ({(product as any).availableQuantity ?? product.quantity} {product.unit})</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button size="sm" disabled={!converting.productId || convertMutation.isPending} onClick={() => convertMutation.mutate({ batchId: batch.id, productId: converting.productId })}>
                                  {convertMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Add
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setConverting(null)}>Cancel</Button>
                              </div>
                            </div>
                            {products.length === 0 && <p className="mt-2 text-xs text-slate-500">You have no products. Create one first under Products, then link this batch to it.</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
