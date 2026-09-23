"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  CheckCircle2,
  XCircle,
  Camera,
  Loader2,
  FileCheck,
  Scale,
  PackageSearch,
  Star,
  Bot,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { CameraCapture } from "../../../components/farmer/camera-capture";
import toast from "react-hot-toast";

const GRADES = [
  { value: "A", label: "Grade A", desc: "Premium - minimal defects, uniform size & colour" },
  { value: "B", label: "Grade B", desc: "Standard - minor surface defects, still excellent" },
  { value: "C", label: "Grade C", desc: "Economy - good for processing / bulk use" },
];

const SIZES = ["Extra Large", "Large", "Medium", "Small"];

interface InspectionRecord {
  id: string;
  batchId?: string;
  lotNumber: string;
  cropName: string;
  grade: string;
  size: string;
  freshness: number;
  damagedPct: number;
  weightKg: number;
  photos: string[];
  status: string;
  inspectedAt: string;
  requirement?: { grade: string; minAcceptablePct: number };
  inspectorNotes?: string;
}

export default function FarmerQualityPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [showInspect, setShowInspect] = useState(false);
  const [form, setForm] = useState({
    lotNumber: "",
    cropName: "",
    grade: "A",
    size: "Medium",
    freshness: "95",
    damagedPct: "1",
    weightKg: "100",
    inspectorNotes: "",
  });
  const [photos, setPhotos] = useState<string[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: recordsData, isLoading } = useQuery({
    queryKey: ["farmerQuality"],
    queryFn: () => api.get("/quality/inspections/me"),
    retry: 1,
  });

  const { data: batchesData } = useQuery({
    queryKey: ["farmerBatchesForQuality"],
    queryFn: () => api.get("/batches"),
    retry: 1,
  });

  const { data: productsData } = useQuery({
    queryKey: ["farmerProductsForQuality"],
    queryFn: () => api.get("/farmers/me/products", { params: { limit: 100 } }),
    enabled: showInspect,
    retry: 1,
  });

  const apiRecords = useMemo(() => {
    const list = recordsData?.data?.inspections || recordsData?.data?.records || [];
    return Array.isArray(list) ? list.map((r: any) => ({ ...r, id: r._id || r.id })) : [];
  }, [recordsData]);

  const batches = batchesData?.data?.batches || [];
  const products: { _id: string; name: string; quantity: number; unit: string }[] =
    productsData?.data?.products || productsData?.data || [];

  const submitMutation = useMutation({
    mutationFn: (payload: any) => api.post("/quality/inspections", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerQuality"] });
      setShowInspect(false);
      setPhotos([]);
      setForm({
        lotNumber: "",
        cropName: "",
        grade: "A",
        size: "Medium",
        freshness: "95",
        damagedPct: "1",
        weightKg: "100",
        inspectorNotes: "",
      });
      toast.success("Inspection recorded. Grade & photos saved for traceability.");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to save inspection"),
  });

  const aiMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quality/inspections/${id}/ai-assess`),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ["farmerQuality"] });
      const ai = _d?.data?.aiAssessment;
      if (ai?.mismatch) {
        toast.error(`AI screening: estimated Grade ${ai.estimatedGrade} differs from your declared grade. Manual inspection required.`);
      } else {
        toast.success(`AI screening: estimated Grade ${ai.estimatedGrade} (${Math.round(ai?.confidence * 100)}% confidence).`);
      }
    },
    onError: (err: any) => toast.error(err?.message || "AI screening failed"),
  });

  const records = filter === "all" ? apiRecords : apiRecords.filter((r) => r.status === filter);

  const meetsRequirement = (r: InspectionRecord) => {
    if (!r.requirement) return null;
    return r.grade === r.requirement.grade && 100 - r.damagedPct >= r.requirement.minAcceptablePct;
  };

  const persistPhotos = async (files: File[]) => {
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of files) {
        const res = await api.upload("/products/upload", file);
        const url = res?.data?.url;
        if (url) urls.push(url);
      }
      if (urls.length) {
        setPhotos((prev) => [...prev, ...urls]);
        toast.success(`${urls.length} photo${urls.length > 1 ? "s" : ""} uploaded as proof.`);
      } else {
        toast.error("Photo upload failed.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Photo upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.lotNumber.trim() || !form.cropName.trim() || !form.weightKg) {
      toast.error("Lot number, crop name and weight are required");
      return;
    }
    submitMutation.mutate({
      lotNumber: form.lotNumber.trim(),
      cropName: form.cropName.trim(),
      grade: form.grade,
      size: form.size,
      freshness: Number(form.freshness),
      damagedPct: Number(form.damagedPct),
      weightKg: Number(form.weightKg),
      inspectorNotes: form.inspectorNotes || undefined,
      photos,
      batchId: batches.find((b: any) => b.lotNumber === form.lotNumber.trim())?._id,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quality Inspection</h1>
          <p className="text-gray-500">
            Record grades, size, freshness and damage %, with photo proof. Essential for B2B &amp; bulk orders.
          </p>
        </div>
        <Button onClick={() => setShowInspect((v) => !v)}>
          {showInspect ? <XCircle className="mr-2 h-4 w-4" /> : <FlaskConical className="mr-2 h-4 w-4" />}
          {showInspect ? "Cancel" : "New Inspection"}
        </Button>
      </div>

      {showInspect && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record Inspection</CardTitle>
            <CardDescription>Attach to a harvest lot or enter details manually.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Lot number *</label>
                <Select value={form.lotNumber} onValueChange={(v) => {
                  const lot = batches.find((b: any) => b.lotNumber === v);
                  setForm((f) => ({ ...f, lotNumber: v, cropName: lot?.cropName || "" }));
                }}>
                  <SelectContent>
                    <SelectItem value="">Select a lot...</SelectItem>
                    {batches.map((b: any) => (
                      <SelectItem key={b._id || b.lotNumber} value={b.lotNumber}>
                        {b.lotNumber} · {b.cropName} ({b.quantityKg} kg)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-gray-400">No lots? Type a lot number manually below.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Crop name *</label>
                <Input
                  list="quality-products"
                  value={form.cropName}
                  onChange={(e) => setForm({ ...form, cropName: e.target.value })}
                  placeholder={
                    form.lotNumber
                      ? `Auto-filled from lot ${form.lotNumber}`
                      : "Search your product or type a crop, e.g. Tomato"
                  }
                  readOnly={Boolean(form.lotNumber)}
                  disabled={Boolean(form.lotNumber)}
                  className={cn(form.lotNumber && "cursor-not-allowed bg-slate-50 text-slate-700")}
                />
                <datalist id="quality-products">
                  {products.map((p) => (
                    <option key={p._id} value={p.name}>
                      {p.name} ({p.quantity} {p.unit})
                    </option>
                  ))}
                </datalist>
                {form.lotNumber && (
                  <p className="text-[11px] text-gray-400">Crop name is taken from lot {form.lotNumber}.</p>
                )}
                {!form.lotNumber && products.length === 0 && (
                  <p className="text-[11px] text-gray-400">
                    No products found — create one under Products to list it here.
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Grade *</label>
                <Select value={form.grade} onValueChange={(v) => setForm({ ...form, grade: v })}>
                  <SelectContent>
                    {GRADES.map((g) => (
                      <SelectItem key={g.value} value={g.value}>{g.label} — {g.desc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Size</label>
                <Select value={form.size} onValueChange={(v) => setForm({ ...form, size: v })}>
                  <SelectContent>
                    {SIZES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Freshness (%)</label>
                <input type="range" min="50" max="100" value={form.freshness} onChange={(e) => setForm({ ...form, freshness: e.target.value })} className="w-full accent-emerald-600" />
                <p className="text-right text-xs font-semibold text-emerald-700">{form.freshness}%</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Damaged / blemished (%)</label>
                <input type="range" min="0" max="25" value={form.damagedPct} onChange={(e) => setForm({ ...form, damagedPct: e.target.value })} className="w-full accent-red-500" />
                <p className="text-right text-xs font-semibold text-red-600">{form.damagedPct}%</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Verified weight (kg) *</label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={form.weightKg}
                  onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
                  className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Inspector notes</label>
                <input
                  value={form.inspectorNotes}
                  onChange={(e) => setForm({ ...form, inspectorNotes: e.target.value })}
                  placeholder="Colour, uniformity, packaging, remarks…"
                  className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-xs font-medium text-gray-500">Photo proof (packaging / product / weight)</label>
                <div className="flex flex-wrap gap-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg border">
                      <img src={p} alt={`proof-${i}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPhotos(photos.filter((_, x) => x !== i))}
                        className="absolute right-0.5 top-0.5 rounded-full bg-red-500 p-0.5 text-white"
                        aria-label="remove photo"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    disabled={uploading}
                    className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-gray-400 hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Camera className="h-5 w-5" />
                    <span className="text-[10px]">{uploading ? "Uploading…" : "Add photo"}</span>
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit" disabled={submitMutation.isPending}>
                  {submitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck className="mr-2 h-4 w-4" />}
                  Save Inspection
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {["all", "passed", "review", "failed"].map((f) => (
          <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <PackageSearch className="h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">No inspections yet. Run your first quality check on a harvest lot.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {records.map((r) => {
            const meets = meetsRequirement(r);
            const gradeInfo = GRADES.find((g) => g.value === r.grade);
            return (
              <Card key={r.id}>
                <CardContent className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{r.lotNumber}</span>
                      <Badge variant="outline">{r.cropName}</Badge>
                      <Badge variant={r.grade === "A" ? "success" : r.grade === "B" ? "warning" : "secondary"}>
                        Grade {r.grade}
                      </Badge>
                      {r.status === "passed" && <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Passed</Badge>}
                      {r.status === "review" && <Badge variant="warning"><FlaskConical className="mr-1 h-3 w-3" /> Review</Badge>}
                      {r.status === "failed" && <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Failed</Badge>}
                      {r.verificationStatus === "verified" && (
                        <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Verified Grade {r.verifiedGrade || r.grade}</Badge>
                      )}
                      {r.verificationStatus === "buyer_verified" && (
                        <Badge variant="success">✓ Buyer Verified Grade {r.verifiedGrade || r.grade}</Badge>
                      )}
                      {r.verificationStatus === "farmer_declared" && (
                        <Badge variant="warning">⚠ Farmer Declared · Unverified</Badge>
                      )}
                      {r.verificationStatus === "evidence_submitted" && (
                        <Badge variant="secondary">🔵 Evidence Submitted</Badge>
                      )}
                      {r.verificationStatus === "rejected" && (
                        <Badge variant="destructive">Rejected</Badge>
                      )}
                      {meets === true && (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                          ✓ Meets {r.requirement?.grade} requirement
                        </Badge>
                      )}
                      {meets === false && (
                        <Badge variant="outline" className="border-red-300 text-red-700">
                          ✗ Does not meet {r.requirement?.grade} requirement
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                      <span>{r.size} size</span>
                      <span>Freshness <span className="font-medium text-emerald-700">{r.freshness}%</span></span>
                      <span>Damaged <span className="font-medium text-red-600">{r.damagedPct}%</span></span>
                      <span className="flex items-center gap-1"><Scale className="h-3.5 w-3.5 text-slate-400" /> {r.weightKg} kg verified</span>
                      <span>Inspected {formatDate(r.inspectedAt)}</span>
                    </div>
                    {r.inspectorNotes && <p className="text-xs text-slate-500">{r.inspectorNotes}</p>}
                    {r.aiAssessment && (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                        <Bot className="h-3.5 w-3.5 text-indigo-500" />
                        <span className="font-medium text-slate-600">
                          AI estimate: Grade {r.aiAssessment.estimatedGrade}
                        </span>
                        <span className="text-slate-400">
                          ({Math.round((r.aiAssessment.confidence || 0) * 100)}% confidence)
                        </span>
                        {r.aiAssessment.mismatch ? (
                          <Badge variant="destructive">Mismatch — verification required</Badge>
                        ) : (
                          <Badge variant="success">Consistent with declaration</Badge>
                        )}
                      </div>
                    )}
                    {r.verificationStatus === "farmer_declared" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => aiMutation.mutate(r.id)}
                        disabled={aiMutation.isPending}
                      >
                        {aiMutation.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Bot className="mr-1.5 h-3 w-3" />}
                        Run AI Screening
                      </Button>
                    )}
                    {r.photos && r.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {r.photos.map((p, i) => (
                          <img key={i} src={p} alt="proof" className="h-16 w-16 rounded-lg border object-cover" />
                        ))}
                      </div>
                    )}
                  </div>
                  {gradeInfo && (
                    <div className="flex flex-col items-start gap-1 rounded-lg bg-slate-50 p-3 sm:min-w-[220px] sm:items-end">
                      <p className="flex items-center gap-1 text-xs font-semibold text-slate-500">
                        <Star className="h-3.5 w-3.5 text-amber-400" /> {gradeInfo.label}
                      </p>
                      <p className="text-right text-xs text-slate-500">{gradeInfo.desc}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file: File) => {
          void persistPhotos([file]);
        }}
        onUpload={(files: File[]) => {
          void persistPhotos(files);
        }}
      />
    </div>
  );
}
