"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
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
  expiresAt?: string;
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

  const { data: batchesData, isLoading } = useQuery({
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
    if (f === "expired") return <Badge variant="destructive">Expired</Badge>;
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Batches &amp; Traceability</h1>
          <p className="text-gray-500">
            Create traceable harvest lots, record the actual shelf life for each harvested batch, and send every batch through independent quality inspection before listing. Delivery deadlines and priority are calculated automatically.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "New Batch"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Batch from Harvested Crop</CardTitle>
            <CardDescription>
              Select a completed harvest to create its traceable batch. The marketplace product can be linked after quality approval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
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
              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit" disabled={createMutation.isPending || !selectedHarvest}>
                  {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Create Batch
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Package className="h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">No batches yet. Create your first harvest lot to enable traceability.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <Card key={batch.id}>
              <CardContent className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <span className="font-mono text-sm font-semibold">{batch.lotNumber}</span>
                    {batch.productId ? (
                      <Badge variant="outline">
                        <Link2 className="mr-1 h-3 w-3" /> Listed
                      </Badge>
                    ) : batch.status === "created" ? (
                      <Badge variant="secondary">Unlisted</Badge>
                    ) : null}
                    {freshnessBadge(batch)}\n                    {qualityBadge(batch)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600">
                    <span className="flex items-center gap-1">
                      <Wheat className="h-3.5 w-3.5 text-slate-400" /> {batch.cropName}
                    </span>
                    <span>{batch.quantityKg} kg{Number(batch.remainingKg) > 0 ? ` (${batch.remainingKg} kg remaining)` : ""}</span>
                    <span className="flex items-center gap-1">
                      <Snowflake className="h-3.5 w-3.5 text-slate-400" /> {storageLabel(batch.storageType)}
                    </span>
                    {batch.qualityGrade && (
                      <span className="flex items-center gap-1">
                        <FlaskConical className="h-3.5 w-3.5 text-slate-400" /> Grade: {batch.qualityGrade}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    Harvested {formatDate(batch.harvestDate)} · Shelf life {batch.shelfLifeDays ?? "—"} days
                  </div>
                </div>
                <div className="flex items-start justify-end gap-2">
                  <a
                    href={`/trace/${encodeURIComponent(batch.lotNumber)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
                  >
                    <QrCode className="h-4 w-4" /> QR / Trace
                  </a>
                  {!batch.productId && batch.status === "created" && batch.qualityStatus === "approved" && (
                    <Button size="sm" onClick={() => setConverting({ batchId: batch.id, productId: "" })}>
                      <PackagePlus className="mr-1.5 h-4 w-4" /> Add to Inventory
                    </Button>
                  )}
                  {batch.qualityStatus === "pending_inspection" && batch.inspectionId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={urgentMutation.isPending}
                      onClick={() => urgentMutation.mutate(batch.inspectionId!)}
                    >
                      {urgentMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1.5 h-4 w-4" />}
                      Request Urgent Inspection
                    </Button>
                  )}
                </div>

                {converting?.batchId === batch.id && (
                  <div className="sm:col-span-2 flex flex-col gap-2 rounded-md border bg-slate-50 p-3">
                    <div className="flex items-center gap-2">
                      <Select value={converting.productId} onValueChange={(v) => setConverting({ batchId: batch.id, productId: v })}>
                        <SelectContent>
                          <SelectItem value="">Select a product...</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p._id} value={p._id}>
                              {p.name} ({(p as any).availableQuantity ?? p.quantity} {p.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!converting.productId || convertMutation.isPending}
                        onClick={() => convertMutation.mutate({ batchId: batch.id, productId: converting.productId })}
                      >
                        {convertMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                        Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConverting(null)}>
                        Cancel
                      </Button>
                    </div>
                    {products.length === 0 && (
                      <p className="text-xs text-slate-500">
                        You have no products. Create one first under Products, then link this batch to it.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
