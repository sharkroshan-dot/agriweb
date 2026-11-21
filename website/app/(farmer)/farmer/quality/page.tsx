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

const resolveQualityMediaUrl = (value?: string | null) => {
  if (!value) return "";
  const url = String(value).trim();
  if (!url) return "";
  if (/^blob:/i.test(url)) return "";
  if (/^(data:|https?:\/\/)/i.test(url)) return url;
  const backendOrigin = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1").replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
  return `${backendOrigin}/${url.replace(/^\/+/, "")}`;
};

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
    // The backend route is /ai-assess; /ai-screen does not exist.
    mutationFn: (inspectionId: string) =>
      api.post(`/quality/inspections/${inspectionId}/ai-assess`),
    onSuccess: (response: any) => {
      queryClient.invalidateQueries({ queryKey: ["farmerQuality"] });
      queryClient.invalidateQueries({ queryKey: ["farmerBatchesForQuality"] });
      const assessment = response?.data?.data?.aiAssessment;
      if (assessment?.mismatch) {
        toast.error(`AI screening estimates Grade ${assessment.estimatedGrade}. A manual quality review is required.`);
      } else {
        toast.success(assessment?.estimatedGrade
          ? `AI screening completed. Estimated Grade ${assessment.estimatedGrade}.`
          : "AI quality screening completed.");
      }
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail || err?.message || "AI screening failed"),
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

  // Keep evidence status logic in the component scope so both workflow panels can use it.
  const getEvidenceStatus = (record: any) => {
    const status = String(record.inspectionStatus || record.verificationStatus || "").toLowerCase();
    if (["evidence_submitted", "in_progress"].includes(status)) return "awaiting";
    if (["approved", "verified", "buyer_verified", "rejected"].includes(status) || record.status === "passed" || record.status === "failed") return "completed";
    return "required";
  };

  const openEvidenceForRecord = (record: any) => {
    setSelectedEvidenceId(record.id);
  };

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
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,0.98fr)_minmax(0,1.02fr)]">
      <Card className="h-full overflow-hidden border-emerald-100 shadow-sm">
        <CardHeader className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-white">
          <CardTitle className="text-base">Harvest batches awaiting quality</CardTitle>
          <CardDescription>Each harvested batch must be independently inspected before a marketplace product can be created.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2" id="inspection-status-filters">
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold tracking-tight text-slate-900">Inspection status</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Filter by warehouse quality decision.</p>
              </div>
              <div className="grid w-full grid-cols-4 gap-1 rounded-lg bg-slate-50 p-1 sm:flex sm:w-auto">
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
                        "inline-flex min-h-9 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors sm:min-w-[78px]",
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
            const thumbnail = resolveQualityMediaUrl(record.photos?.[0] || batch?.imageUrl || batch?.productImage);
            const gradeInfo = GRADES.find((grade) => grade.value === record.grade);
            const meets = meetsRequirement(record);
            return (
              <div key={record.id} className="overflow-hidden rounded-xl border border-slate-100 bg-white transition hover:border-emerald-200">
                <button type="button" aria-pressed={selectedEvidenceId === record.id} onClick={() => openEvidenceForRecord(record)} className={cn("flex w-full min-w-0 items-center gap-3 px-2.5 py-2 text-left transition-colors", selectedEvidenceId === record.id ? "bg-emerald-50/70" : "bg-white hover:bg-slate-50")}>
                  <div className="h-11 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
                    {thumbnail ? <img src={thumbnail} alt={record.cropName || "Harvest batch"} className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="flex h-full items-center justify-center text-emerald-700"><FileCheck className="h-5 w-5" /></div>}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">{record.lotNumber} · {record.cropName}</span>
                    <span className="block text-xs text-slate-500">{record.weightKg || batch?.quantityKg || 0} kg · Harvest: {formatDate(batch?.harvestDate || record.inspectedAt)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold", statusTone)}>
                      <StatusIcon className="h-3.5 w-3.5" />{status === "passed" ? "Passed" : status === "failed" ? "Failed" : "Review"}
                    </span>
                    {getEvidenceStatus(record) === "awaiting" ? <Badge variant="outline" className="whitespace-nowrap border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">Awaiting warehouse review</Badge> : getEvidenceStatus(record) === "required" ? <Badge variant="warning" className="whitespace-nowrap text-[10px]">Evidence required</Badge> : <Badge variant="secondary" className="whitespace-nowrap text-[10px]">Review completed</Badge>}
                  </span>
                  <span className="shrink-0 text-xl text-slate-500">›</span>
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
        const awaitingReview = apiRecords.filter((r: any) => getEvidenceStatus(r) === "awaiting").length;
        const needsEvidence = apiRecords.filter((r: any) => getEvidenceStatus(r) === "required").length;
        // The right-hand panel is a detail workspace for the lot selected on the left,
        // not a second list of every lot.
        const selectedEvidence = apiRecords.find((r: any) => r.id === selectedEvidenceId) || apiRecords[0];
        const selectedNeedsEvidence = selectedEvidence ? getEvidenceStatus(selectedEvidence) === "required" : false;
        const selectedFiles = selectedEvidence ? evidenceFiles[selectedEvidence.id] || [] : [];
        const isUploadingThis = selectedEvidence && evidenceMutation.isPending && evidenceMutation.variables?.id === selectedEvidence.id;
        return (
          <Card id="evidence-submission" className="h-full scroll-mt-24 overflow-hidden border-emerald-200 shadow-sm">
            <CardHeader className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-white px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Camera className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <CardTitle className="text-base">Evidence submission</CardTitle>
                  <CardDescription className="mt-0.5">Share clear photos or a short video so the warehouse team can assess your harvest.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-3 sm:p-4">
              <div className="grid grid-cols-3 items-center gap-1.5 text-[11px] font-semibold sm:gap-2">
                <div className="flex min-h-9 items-center justify-center gap-1 rounded-full bg-emerald-100 px-2 text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" /> <span>Select lot</span></div>
                <div className="flex min-h-9 items-center justify-center gap-1 rounded-full bg-emerald-100 px-2 text-emerald-800"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-700 text-[10px] text-white">2</span><span>Add evidence</span></div>
                <div className="flex min-h-9 items-center justify-center gap-1 rounded-full bg-slate-100 px-2 text-slate-600"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-400 text-[10px] text-white">3</span><span>Submit for review</span></div>
              </div>
              {!selectedEvidence && (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-10 text-center text-sm text-slate-500">
                  Select a harvest lot from the left to view its evidence, inspection details and next actions here.
                </div>
              )}
              {selectedEvidence && (
                <>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
                        {resolveQualityMediaUrl(selectedEvidence.photos?.[0]) ? <img src={resolveQualityMediaUrl(selectedEvidence.photos?.[0])} alt={selectedEvidence.cropName || "Selected harvest lot"} className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="flex h-full items-center justify-center text-emerald-700"><Camera className="h-6 w-6" /></div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-slate-500">Selected lot (from Harvest batches awaiting quality)</p>
                        <p className="break-words text-sm font-bold text-slate-900">{selectedEvidence.lotNumber} · {selectedEvidence.cropName}</p>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1"><PackageSearch className="h-3.5 w-3.5" />Harvest quantity: {selectedEvidence.weightKg || 0} kg</span>
                          <span>Harvest date: {formatDate(batches.find((item: any) => String(item._id || item.id) === String(selectedEvidence.batchId || ""))?.harvestDate || selectedEvidence.inspectedAt)}</span>
                        </div>
                      </div>
                      {selectedNeedsEvidence ? <Badge variant="warning" className="shrink-0">Evidence required</Badge> : <Badge variant="outline" className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700">{getEvidenceStatus(selectedEvidence) === "completed" ? "Review completed" : "Awaiting warehouse review"}</Badge>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-800"><Scale className="h-4 w-4 text-emerald-700" />Inspection / Quality summary</div>
                    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                      <div className="rounded-full border border-slate-200 px-3 py-2 text-center text-[11px] font-semibold text-slate-700"><span className="text-emerald-700">Grade:</span> {selectedEvidence.grade || "Not graded"}</div>
                      <div className="rounded-full border border-slate-200 px-3 py-2 text-center text-[11px] font-semibold text-slate-700"><span className="text-emerald-700">Freshness:</span> {selectedEvidence.freshness ?? "—"}%</div>
                      <div className="rounded-full border border-slate-200 px-3 py-2 text-center text-[11px] font-semibold text-slate-700"><span className="text-amber-600">Damaged:</span> {selectedEvidence.damagedPct ?? "—"}%</div>
                      <div className="rounded-full border border-slate-200 px-3 py-2 text-center text-[11px] font-semibold text-slate-700">Photos: {selectedEvidence.photos?.length || 0} · Videos: {selectedEvidence.videos?.length || 0}</div>
                    </div>
                    {selectedEvidence.aiAssessment && <div className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">AI estimate: Grade {selectedEvidence.aiAssessment.estimatedGrade} ({Math.round((selectedEvidence.aiAssessment.confidence || 0) * 100)}% confidence)</div>}
                    {selectedEvidence.inspectorNotes && <p className="mt-2 text-xs text-slate-600">{selectedEvidence.inspectorNotes}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedEvidence.verificationStatus === "verified" && <Button size="sm" onClick={() => {
                        const linkedBatch = batches.find((item: any) => String(item._id || item.id) === String(selectedEvidence.batchId || ""));
                        const planId = linkedBatch?.sourceHarvestPlanId;
                        if (!planId) { toast.error("This verified inspection is not linked to a harvest plan."); return; }
                        router.push(`/farmer/products/new?fromHarvest=${encodeURIComponent(String(planId))}&fromBatch=${encodeURIComponent(String(selectedEvidence.batchId))}&quantity=${encodeURIComponent(String(linkedBatch.quantityKg || ""))}&price=${encodeURIComponent(String(linkedBatch.finalRatePerKg || ""))}`);
                      }}><PackageSearch className="mr-1.5 h-4 w-4" />Create Product</Button>}
                      {selectedEvidence.verificationStatus === "farmer_declared" && <Button size="sm" variant="outline" onClick={() => aiMutation.mutate(selectedEvidence.id)} disabled={aiMutation.isPending}>{aiMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Bot className="mr-1.5 h-4 w-4" />}Run AI Screening</Button>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-800"><Camera className="h-4 w-4 text-emerald-700" />Upload evidence <span className="font-normal text-slate-500">(Photos and video of the harvested lot)</span></div>
                    </div>
                    {selectedNeedsEvidence ? (
                      <>
                        <label htmlFor={`evidence-${selectedEvidence.id}`} className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/30 px-3 py-4 text-center transition hover:border-emerald-500 hover:bg-emerald-50">
                          <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm"><Camera className="h-5 w-5" /></span>
                          <span className="text-sm font-bold text-slate-800">Drag &amp; drop photos or a video here</span>
                          <span className="mt-0.5 text-xs text-slate-600">or click to browse files</span>
                          <span className="mt-2 rounded-full bg-emerald-100 px-3 py-1 text-[10px] text-slate-600">Supported: JPG, PNG, MP4, WEBM, MOV · Max size: 50 MB per file</span>
                        </label>
                        <input id={`evidence-${selectedEvidence.id}`} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={e => { const chosen = Array.from(e.target.files || []); if (chosen.length) setEvidenceFiles(current => ({ ...current, [selectedEvidence.id]: [...(current[selectedEvidence.id] || []), ...chosen] })); e.currentTarget.value = ""; }} className="sr-only" />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-800">Uploaded files ({(selectedEvidence.photos?.length || 0) + (selectedEvidence.videos?.length || 0) + selectedFiles.length})</p>
                          {selectedFiles.length > 0 && <button type="button" onClick={() => setEvidenceFiles(current => ({ ...current, [selectedEvidence.id]: [] }))} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" />Clear pending files</button>}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(selectedEvidence.photos || []).filter((photo: string) => !!resolveQualityMediaUrl(photo)).map((photo: string, index: number) => <div key={`photo-${index}`} className="w-28 overflow-hidden rounded-lg border border-slate-200 bg-white"><img src={resolveQualityMediaUrl(photo)} alt="Uploaded harvest evidence" className="h-20 w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /><p className="truncate px-2 py-1 text-[10px] text-slate-600">Photo {index + 1}</p></div>)}
                          {(selectedEvidence.videos || []).map((video: string, index: number) => <div key={`video-${index}`} className="flex w-28 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-600"><Film className="h-5 w-5 shrink-0 text-emerald-700" /><span className="truncate">Video {index + 1}</span></div>)}
                          {selectedFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="flex w-36 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 text-[10px] text-slate-700"><span className="min-w-0 flex-1 truncate">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setEvidenceFiles(current => ({ ...current, [selectedEvidence.id]: (current[selectedEvidence.id] || []).filter((_, fileIndex) => fileIndex !== index) }))}><XCircle className="h-3.5 w-3.5 text-rose-600" /></button></div>)}
                        </div>
                        <div className="mt-3">
                          <label htmlFor={`evidence-notes-${selectedEvidence.id}`} className="mb-1 block text-xs font-semibold text-slate-800">Note for warehouse (optional)</label>
                          <textarea id={`evidence-notes-${selectedEvidence.id}`} value={evidenceNotes[selectedEvidence.id] || ""} onChange={e => setEvidenceNotes(current => ({ ...current, [selectedEvidence.id]: e.target.value }))} placeholder="Mention visible defects, harvest time or handling details…" maxLength={500} rows={2} className="min-h-[64px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                          <div className="mt-0.5 text-right text-[10px] text-slate-500">{(evidenceNotes[selectedEvidence.id] || "").length} / 500</div>
                        </div>
                        <div className="flex justify-end">
                          <Button className="w-full sm:w-auto" onClick={() => evidenceMutation.mutate({ id: selectedEvidence.id, files: selectedFiles, notes: evidenceNotes[selectedEvidence.id] || "" })} disabled={evidenceMutation.isPending || selectedFiles.length === 0}>{isUploadingThis ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading…</> : <><Camera className="mr-2 h-4 w-4" />Submit for warehouse review</>}</Button>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs text-emerald-800">Evidence has been submitted for this lot. The warehouse quality team must complete the review before the batch can proceed to product listing.</div>
                    )}
                  </div>
                </>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px]">
                <span className="font-semibold text-slate-700">Current status (all lots):</span>
                <span className="font-semibold text-amber-700">{needsEvidence} evidence required</span>
                <span className="text-slate-400">|</span>
                <span className="font-semibold text-emerald-700">{awaitingReview} awaiting warehouse review</span>
              </div>
            </CardContent>
          </Card>
        );
      })()}
      </div>

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
