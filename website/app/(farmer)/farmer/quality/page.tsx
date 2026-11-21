"use client";

import { useEffect, useMemo, useState } from "react";
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
  Trash2,
  Film,
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

export function FarmerQualityPanel() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string>("");
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
  const [evidencePreviews, setEvidencePreviews] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const previews: Record<string, string[]> = {};
    Object.entries(evidenceFiles).forEach(([inspectionId, files]) => {
      previews[inspectionId] = files.map(file => URL.createObjectURL(file));
    });
    setEvidencePreviews(previews);
    return () => {
      Object.values(previews).flat().forEach(url => URL.revokeObjectURL(url));
    };
  }, [evidenceFiles]);
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
    return Array.isArray(list) ? list.map((r: any) => {
      const rawStatus = String(r.status || r.inspectionStatus || "").toLowerCase();
      const status = ["passed", "pass", "approved", "verified", "quality_approved"].includes(rawStatus)
        ? "passed"
        : ["failed", "fail", "rejected", "quality_rejected"].includes(rawStatus)
          ? "failed"
          : "review";
      return { ...r, id: r._id || r.id, status };
    }) : [];
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Quality inspection & evidence</h2>
          <p className="text-gray-500">
            Submit batch evidence, follow warehouse review and view the final quality decision.
          </p>
        </div>
        <div className="rounded-lg border bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Farmer action: request inspection / submit evidence. Quality approval is completed by an authorized verifier.
        </div>
      </div>

      <div className="grid items-start gap-3 xl:grid-cols-[0.92fr_1.08fr]">
      <Card className="h-full overflow-hidden border-emerald-100 shadow-sm">
        <CardHeader className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-white">
          <CardTitle className="text-base">Harvest batches awaiting quality</CardTitle>
          <CardDescription>Each harvested batch must be independently inspected before a marketplace product can be created.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-3" id="inspection-status-filters">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-bold tracking-tight text-slate-900">Inspection status</h3>
                <p className="mt-1 text-xs text-slate-500">Review completed quality checks and filter results by their decision.</p>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 rounded-xl bg-slate-50 p-1.5 sm:flex sm:w-auto">
                {[
                  { value: "all", label: "All", icon: PackageSearch, tone: "text-emerald-700" },
                  { value: "passed", label: "Passed", icon: CheckCircle2, tone: "text-emerald-700" },
                  { value: "review", label: "Review", icon: FlaskConical, tone: "text-amber-700" },
                  { value: "failed", label: "Failed", icon: XCircle, tone: "text-rose-700" },
                ].map((item) => {
                  const count = item.value === "all" ? apiRecords.length : apiRecords.filter((record) => record.status === item.value).length;
                  const active = filter === item.value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(item.value)}
                      className={cn(
                        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors sm:min-w-[92px]",
                        active
                          ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                          : "border-transparent bg-white text-slate-600 hover:border-slate-200 hover:bg-white"
                      )}
                    >
                      <item.icon className={cn("h-3.5 w-3.5", active ? "text-white" : item.tone)} />
                      {item.label}
                      <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] tabular-nums", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {records.map((record: any) => {
            const batch = batches.find((item: any) => String(item._id || item.id) === String(record.batchId || ""));
            const status = record.status || "review";
            const statusTone = status === "passed"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : status === "failed"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-amber-200 bg-amber-50 text-amber-700";
            const StatusIcon = status === "passed" ? CheckCircle2 : status === "failed" ? XCircle : FlaskConical;
            const thumbnail = record.photos?.[0] || batch?.imageUrl || batch?.productImage;
            return (
              <div key={record.id} className="flex min-w-0 items-center gap-3 border-b border-slate-100 px-1 py-2.5 last:border-b-0">
                <div className="h-11 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
                  {thumbnail ? <img src={thumbnail} alt={record.cropName || "Harvest batch"} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-emerald-700"><FileCheck className="h-5 w-5" /></div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{record.lotNumber} · {record.cropName}</p>
                  <p className="text-xs text-slate-500">{record.weightKg || batch?.quantityKg || 0} kg · Harvest: {formatDate(batch?.harvestDate || record.inspectedAt)}</p>
                </div>
                <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", statusTone)}>
                  <StatusIcon className="h-3.5 w-3.5" />{status === "passed" ? "Passed" : status === "failed" ? "Failed" : "Review"}
                </span>
                <button type="button" aria-label={`Open inspection for ${record.lotNumber}`} onClick={() => document.getElementById("inspection-history")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 sm:inline-flex">
                  <span aria-hidden="true" className="text-xl">›</span>
                </button>
              </div>
            );
          })}
          {records.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">{apiRecords.length === 0 ? "No inspection records yet. Request an inspection for a harvested batch to get started." : "No inspections match this status. Choose another filter to see more batches."}</p>
          )}
        </CardContent>
      </Card>

      {(() => {
        const evidenceQueue = apiRecords.filter((r: any) => !["approved", "rejected"].includes(r.inspectionStatus || ""));
        const awaitingReview = evidenceQueue.filter((r: any) => ["evidence_submitted", "in_progress"].includes(r.inspectionStatus || "")).length;
        const needsEvidence = evidenceQueue.length - awaitingReview;
        const uploadable = evidenceQueue.filter((r: any) => !["evidence_submitted", "in_progress"].includes(r.inspectionStatus || ""));
        const selectedEvidence = uploadable.find((r: any) => r.id === selectedEvidenceId) || uploadable[0];
        const selectedFiles = selectedEvidence ? evidenceFiles[selectedEvidence.id] || [] : [];
        const isUploadingThis = selectedEvidence && evidenceMutation.isPending && evidenceMutation.variables?.id === selectedEvidence.id;
        return (
          <Card className="h-full overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Camera className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <CardTitle className="text-base">Evidence submission</CardTitle>
                  <CardDescription className="mt-0.5">Share clear photos or a short video so the warehouse team can assess your harvest.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {evidenceQueue.map((r: any) => {
                const submitted = ["evidence_submitted", "in_progress"].includes(r.inspectionStatus || "");
                const active = selectedEvidence?.id === r.id;
                return (
                  <button key={r.id} type="button" onClick={() => !submitted && setSelectedEvidenceId(r.id)} disabled={submitted}
                    className={cn("grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition", active ? "border-emerald-300 bg-emerald-50/60" : "border-slate-100 bg-white", submitted && "cursor-default")}>
                    <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-emerald-700">
                      {r.photos?.[0] ? <img src={r.photos[0]} alt="" className="h-full w-full object-cover" /> : <Camera className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-slate-900">{r.cropName || "Harvest batch"} <span className="ml-1 font-mono text-[10px] font-normal text-slate-500">({r.lotNumber || "Lot pending"})</span></span>
                      <span className="block truncate text-[11px] text-slate-500">{r.photos?.length || 0} photos · {r.videos?.length || 0} videos {active ? "· Selected" : ""}</span>
                    </span>
                    {submitted ? <span className="flex flex-wrap items-center justify-end gap-1"><Badge variant="success" className="whitespace-nowrap text-[10px]"><CheckCircle2 className="mr-1 h-3 w-3" />Evidence submitted</Badge><Badge variant="outline" className="whitespace-nowrap border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Awaiting warehouse review</Badge></span> : <Badge variant="warning" className="whitespace-nowrap text-[10px]">Evidence required</Badge>}
                  </button>
                );
              })}
              {evidenceQueue.length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500">No evidence submissions pending. Request an inspection for a harvest batch when it is ready.</div>
              )}
              {selectedEvidence && (
                <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(180px,1fr)_auto] sm:items-end">
                  <div>
                    <label htmlFor={`evidence-${selectedEvidence.id}`} className="flex min-h-[68px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-2 py-2 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40">
                      <Camera className="mb-1 h-5 w-5 text-emerald-700" />
                      <span className="text-xs font-semibold text-slate-700">Choose photos or video</span>
                      <span className="text-[10px] text-slate-500">JPG, PNG, MP4, WEBM, MOV · Max 50 MB per file</span>
                    </label>
                    <input id={`evidence-${selectedEvidence.id}`} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple
                      onChange={e => { const chosen = Array.from(e.target.files || []); if (chosen.length) setEvidenceFiles(current => ({ ...current, [selectedEvidence.id]: [...(current[selectedEvidence.id] || []), ...chosen] })); e.currentTarget.value = ""; }}
                      className="sr-only" />
                    {selectedFiles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedFiles.map((file, index) => (
                          <span key={`${file.name}-${file.lastModified}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
                            <span className="max-w-[120px] truncate">{file.name}</span>
                            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setEvidenceFiles(current => ({ ...current, [selectedEvidence.id]: (current[selectedEvidence.id] || []).filter((_, fileIndex) => fileIndex !== index) }))}><XCircle className="h-3 w-3 text-rose-600" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label htmlFor={`evidence-notes-${selectedEvidence.id}`} className="mb-1 block text-[11px] font-semibold text-slate-600">Note for warehouse (optional)</label>
                    <textarea id={`evidence-notes-${selectedEvidence.id}`} value={evidenceNotes[selectedEvidence.id] || ""} onChange={e => setEvidenceNotes(current => ({ ...current, [selectedEvidence.id]: e.target.value }))} placeholder="Mention visible defects, harvest time or handling details…" rows={2} className="min-h-[68px] w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                  </div>
                  <Button size="sm" className="h-10 w-full sm:w-auto" onClick={() => evidenceMutation.mutate({ id: selectedEvidence.id, files: selectedFiles, notes: evidenceNotes[selectedEvidence.id] || "" })} disabled={evidenceMutation.isPending || selectedFiles.length === 0}>
                    {isUploadingThis ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : "Submit for warehouse review"}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-2 text-[11px]">
                <span className="font-medium text-amber-700">{needsEvidence} evidence required</span>
                <span className="font-medium text-emerald-700">{awaitingReview} awaiting warehouse review</span>
              </div>
            </CardContent>
          </Card>
        );
      })()}
      </div>

      <section id="inspection-history" className="scroll-mt-24 space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <div><h3 className="text-sm font-semibold text-slate-900">Inspection history &amp; verification details</h3><p className="text-xs text-slate-500">Expand a record to review grading, evidence, AI screening and available actions.</p></div>
        <Badge variant="outline">{records.length} records</Badge>
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
              <details key={r.id} className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-xs font-mono font-semibold text-slate-900">{r.lotNumber}</span>
                    <Badge variant="outline">{r.cropName}</Badge>
                    <Badge variant={r.grade === "A" ? "success" : r.grade === "B" ? "warning" : "secondary"}>Grade {r.grade}</Badge>
                    {r.status === "passed" ? <Badge variant="success">Passed</Badge> : r.status === "failed" ? <Badge variant="destructive">Failed</Badge> : <Badge variant="warning">Review</Badge>}
                    {r.verificationStatus === "farmer_declared" && <Badge variant="warning">Farmer declared · Unverified</Badge>}
                    {r.verificationStatus === "evidence_submitted" && <Badge variant="secondary">Evidence submitted</Badge>}
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700">Inspection details <span className="transition-transform group-open:rotate-180">⌄</span></span>
                </summary>
                <div className="grid gap-3 border-t border-slate-100 p-3 sm:grid-cols-[1fr_auto]">
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
                </div>
              </details>
            );
          })}
        </div>
      )}
      </section>

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


export default function FarmerQualityPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/farmer/batches");
  }, [router]);
  return <div className="p-6 text-sm text-slate-500">Opening combined Batches &amp; Quality workspace…</div>;
}
