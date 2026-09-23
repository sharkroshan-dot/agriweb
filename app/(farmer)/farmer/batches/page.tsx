"use client";

import { useState } from "react";
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
  notes?: string;
  freshness?: { status: string; daysRemaining?: number; expiresAt?: string };
}

interface FarmerProduct {
  _id: string;
  name: string;
  quantity: number;
  price: number;
  unit: string;
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
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    cropName: "",
    quantityKg: "100",
    harvestDate: "",
    qualityGrade: "Premium",
    storageType: "normal",
    shelfLifeDays: "",
    notes: "",
  });
  const [converting, setConverting] = useState<{ batchId: string; productId: string } | null>(null);

  const { data: batchesData, isLoading } = useQuery({
    queryKey: ["farmerBatches"],
    queryFn: () => api.get("/batches"),
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
      setShowForm(false);
      setForm({ cropName: "", quantityKg: "100", harvestDate: "", qualityGrade: "Premium", storageType: "normal", shelfLifeDays: "", notes: "" });
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

  const batches: Batch[] = (batchesData?.data?.batches || []).map((b: any) => ({ ...b, id: b._id || b.id }));
  const products: FarmerProduct[] = productsData?.data?.products || productsData?.data || [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.cropName.trim() || !form.quantityKg) {
      toast.error("Crop name and quantity are required");
      return;
    }
    createMutation.mutate({
      cropName: form.cropName.trim(),
      quantityKg: Number(form.quantityKg),
      harvestDate: form.harvestDate ? new Date(form.harvestDate).toISOString() : undefined,
      qualityGrade: form.qualityGrade,
      storageType: form.storageType,
      shelfLifeDays: form.shelfLifeDays ? Number(form.shelfLifeDays) : undefined,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Batches &amp; Traceability</h1>
          <p className="text-gray-500">
            Record harvest lots, track freshness, and link them to your marketplace inventory.
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
            <CardTitle className="text-base">New Harvest Batch</CardTitle>
            <CardDescription>
              A unique lot number (LOT-YYYYMMDD-NNN) will be generated automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Crop name *</label>
                <Input
                  list="farmer-products"
                  value={form.cropName}
                  onChange={(e) => setForm({ ...form, cropName: e.target.value })}
                  placeholder="Search your product or type a crop, e.g. Tomato"
                />
                <datalist id="farmer-products">
                  {products.map((p) => (
                    <option key={p._id} value={p.name}>
                      {p.name} ({(p as any).availableQuantity ?? p.quantity} {p.unit})
                    </option>
                  ))}
                </datalist>
                {productsLoading && <p className="text-[11px] text-gray-400">Loading your products...</p>}
                {products.length === 0 && (
                  <p className="text-[11px] text-gray-400">
                    You have no products yet. Create one under Products to list it here.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Quantity (kg) *</label>
                <Input type="number" min="0.1" step="0.1" value={form.quantityKg} onChange={(e) => setForm({ ...form, quantityKg: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Harvest date</label>
                <Input type="date" value={form.harvestDate} onChange={(e) => setForm({ ...form, harvestDate: e.target.value })} />
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
                <Select value={form.storageType} onValueChange={(v) => setForm({ ...form, storageType: v })}>
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
                <label className="text-xs font-medium text-gray-500">Shelf life (days, optional)</label>
                <Input type="number" min="1" max="90" value={form.shelfLifeDays} onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })} placeholder="auto by storage type" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-500">Notes</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="variety, field plot, remarks..." />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit" disabled={createMutation.isPending}>
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
                    {freshnessBadge(batch)}
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
                  {!batch.productId && batch.status === "created" && (
                    <Button size="sm" onClick={() => setConverting({ batchId: batch.id, productId: "" })}>
                      <PackagePlus className="mr-1.5 h-4 w-4" /> Add to Inventory
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
