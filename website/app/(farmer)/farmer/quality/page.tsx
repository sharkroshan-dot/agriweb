"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  videos?: string[];
  inspectionStatus?: string;
  status: string;
  inspectedAt: string;
  requirement?: { grade: string; minAcceptablePct: number };
  inspectorNotes?: string;
}

export default function FarmerQualityPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
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
  const [evidenceFiles, setEvidenceFiles] = useState<Record<string, File[]>>({});
  const [evidenceNotes, setEvidenceNotes] = useState<Record<string, string>>({});

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

  const aiMutation = useMutation({
    mutationFn: (inspectionId: string) =>
      api.post(`/quality/inspections/${inspectionId}/ai-screen`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerQuality"] });
      queryClient.invalidateQueries({ queryKey: ["farmerBatchesForQuality"] });
      toast.success("AI quality screening completed.");
    },
    onError: (err: any) => toast.error(err?.message || "AI screening failed"),
  });

  const requestInspectionMutation = useMutation({
    mutationFn: (batchId: string) => api.post("/quality/inspections/request", { batchId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerQuality"] });
      queryClient.invalidateQueries({ queryKey: ["farmerBatchesForQuality"] });
      toast.success("Inspection requested. A quality verifier must approve the batch before it can become a product.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not request quality inspection"),
  });

  const evidenceMutation = useMutation({
    mutationFn: async ({ id, files, notes }: { id: string; files: File[]; notes: string }) => {
      if (!files.length) throw new Error("Choose at least one photo or video");
      const photos: string[] = [];
      const videos: string[] = [];
      for (const file of files) {
        const response = await api.upload("/products/upload", file);
        const url = response?.data?.url;
        if (!url) throw new Error("An evidence file could not be uploaded");
        if (file.type.startsWith("video/")) videos.push(url);
        else if (file.type.startsWith("image/")) photos.push(url);
        else throw new Error("Only image and video files are supported");
      }
      return api.post("/quality/inspections/" + id + "/evidence", { photos, videos, notes });
    },
    onSuccess: async (_result, variables) => {
      setEvidenceFiles(current => ({ ...current, [variables.id]: [] }));
      await queryClient.invalidateQueries({ queryKey: ["farmerQuality"] });
      await queryClient.invalidateQueries({ queryKey: ["farmerBatchesForQuality"] });
      toast.success("Evidence sent to the warehouse quality team.");
    },
    onError: (err: any) => toast.error(err?.message || "Could not submit evidence"),
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


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quality Inspection</h1>
          <p className="text-gray-500">
            Record grades, size, freshness and damage %, with photo proof. Essential for B2B &amp; bulk orders.
          </p>
        </div>
        <div className="rounded-lg border bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Farmer action: request inspection / submit evidence. Quality approval is completed by an authorized verifier.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Harvest batches awaiting quality</CardTitle>
          <CardDescription>Each harvested batch must be independently inspected before a marketplace product can be created.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {batches.filter((b: any) => b.qualityStatus !== "approved" && b.qualityStatus !== "rejected").map((b: any) => {
            const inspection = apiRecords.find((r: any) => String(r.batchId || "") === String(b._id || b.id));
            return (
              <div key={b._id || b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="font-semibold">{b.lotNumber} · {b.cropName}</p>
                  <p className="text-xs text-slate-500">{b.quantityKg} kg · {b.storageType || "normal"} · {b.qualityStatus || "pending_inspection"}</p>
                </div>
                <div className="flex gap-2">
                  {!inspection && (
                    <Button size="sm" onClick={() => requestInspectionMutation.mutate(String(b._id || b.id))} disabled={requestInspectionMutation.isPending}>
                      <FlaskConical className="mr-1.5 h-4 w-4" /> Request Inspection
                    </Button>
                  )}
                  {inspection && !["approved", "rejected"].includes(inspection.inspectionStatus || "") && (
                    <span className="text-xs font-medium text-amber-700">{["evidence_submitted", "in_progress"].includes(inspection.inspectionStatus || "") ? "Sent to warehouse · Awaiting decision" : "Inspection requested · Evidence required"}</span>
                  )}
                </div>
              </div>
            );
          })}
          {batches.filter((b: any) => b.qualityStatus !== "approved" && b.qualityStatus !== "rejected").length === 0 && (
            <p className="text-sm text-slate-500">No pending batches. Complete a harvest and create a batch first.</p>
          )}
        </CardContent>
      </Card>

      {(() => {
        const evidenceQueue = apiRecords.filter((r: any) => !["approved", "rejected"].includes(r.inspectionStatus || ""));
        const awaitingReview = evidenceQueue.filter((r: any) => ["evidence_submitted", "in_progress"].includes(r.inspectionStatus || "")).length;
        const needsEvidence = evidenceQueue.length - awaitingReview;
        return (
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/70 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Evidence submission</CardTitle>
                  <CardDescription className="mt-1">Share clear photos or a short video so the warehouse team can assess your harvest.</CardDescription>
                </div>
                <Badge variant="outline" className="border-slate-200 bg-white">{evidenceQueue.length} active {evidenceQueue.length === 1 ? "inspection" : "inspections"}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2 sm:max-w-md">
                <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2">
                  <p className="text-xl font-semibold tabular-nums text-amber-800">{needsEvidence}</p>
                  <p className="text-xs font-medium text-amber-800">Evidence required</p>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2">
                  <p className="text-xl font-semibold tabular-nums text-emerald-800">{awaitingReview}</p>
                  <p className="text-xs font-medium text-emerald-800">Awaiting warehouse</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {evidenceQueue.map((r: any) => {
                const submitted = ["evidence_submitted", "in_progress"].includes(r.inspectionStatus || "");
                const selectedFiles = evidenceFiles[r.id] || [];
                const isUploadingThis = evidenceMutation.isPending && evidenceMutation.variables?.id === r.id;
                return (
                  <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-900">{r.cropName || "Harvest batch"}</p>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">{r.lotNumber || "Lot pending"}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{r.photos?.length || 0} photos · {r.videos?.length || 0} videos attached</p>
                      </div>
                      <Badge variant={submitted ? "success" : "warning"}>{submitted ? "Awaiting warehouse review" : "Evidence required"}</Badge>
                    </div>
                    {submitted ? (
                      <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        Evidence submitted. The warehouse quality team will review this inspection.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
                        <div>
                          <label htmlFor={`evidence-${r.id}`} className="flex min-h-[112px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 py-4 text-center transition-colors hover:border-emerald-400 hover:bg-emerald-50/40">
                            <Camera className="mb-2 h-5 w-5 text-emerald-700" />
                            <span className="text-sm font-semibold text-slate-700">Choose photos or video</span>
                            <span className="mt-1 text-xs text-slate-500">JPG, PNG, MP4, WEBM or MOV · Select multiple files</span>
                          </label>
                          <input id={`evidence-${r.id}`} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={e => setEvidenceFiles(current => ({ ...current, [r.id]: Array.from(e.target.files || []) }))} className="sr-only" />
                          {selectedFiles.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {selectedFiles.map((file, index) => (
                                <span key={`${file.name}-${index}`} className="max-w-full truncate rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{file.name}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2">
                          <label htmlFor={`evidence-notes-${r.id}`} className="text-xs font-semibold text-slate-600">Note for warehouse (optional)</label>
                          <textarea id={`evidence-notes-${r.id}`} value={evidenceNotes[r.id] || ""} onChange={e => setEvidenceNotes(current => ({ ...current, [r.id]: e.target.value }))} placeholder="Mention visible defects, harvest time or handling details…" rows={3} className="min-h-[88px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                          <Button size="sm" className="mt-auto w-full sm:w-auto sm:self-end" onClick={() => evidenceMutation.mutate({ id: r.id, files: selectedFiles, notes: evidenceNotes[r.id] || "" })} disabled={evidenceMutation.isPending || selectedFiles.length === 0}>
                            {isUploadingThis ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading evidence…</> : "Submit for warehouse review"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {evidenceQueue.length === 0 && (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 px-4 py-9 text-center">
                  <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-600" />
                  <p className="text-sm font-semibold text-slate-800">No evidence submissions pending</p>
                  <p className="mt-1 text-xs text-slate-500">Request an inspection for a harvest batch when it is ready.</p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

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
                    {r.verificationStatus === "verified" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const batch = batches.find((b: any) => String(b._id || b.id) === String(r.batchId || ""));
                          const planId = batch?.sourceHarvestPlanId;
                          if (!planId) {
                            toast.error("This verified inspection is not linked to a harvest plan.");
                            return;
                          }
                          router.push(`/farmer/products/new?fromHarvest=${encodeURIComponent(String(planId))}&fromBatch=${encodeURIComponent(String(r.batchId))}&quantity=${encodeURIComponent(String(batch.quantityKg || ""))}&price=${encodeURIComponent(String(batch.finalRatePerKg || ""))}`);
                        }}
                      >
                        <PackageSearch className="mr-1.5 h-4 w-4" /> Create Product
                      </Button>
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
