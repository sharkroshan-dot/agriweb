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
  if (/^(data:|blob:|https?:\/\/)/i.test(url)) return url;
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
  const [expandedInspectionId, setExpandedInspectionId] = useState<string>("");
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

  // Keep evidence status logic in the component scope so both workflow panels can use it.
  const getEvidenceStatus = (record: any) => {
    const status = String(record.inspectionStatus || record.verificationStatus || "").toLowerCase();
    if (["evidence_submitted", "in_progress"].includes(status)) return "awaiting";
    if (["approved", "verified", "buyer_verified", "rejected"].includes(status) || record.status === "passed" || record.status === "failed") return "completed";
    return "required";
  };

  const openEvidenceForRecord = (record: any) => {
    setSelectedEvidenceId(record.id);
    setExpandedInspectionId(record.id);
    window.setTimeout(() => {
      document.getElementById("evidence-submission")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
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
            const expanded = expandedInspectionId === record.id;
            return (
              <div key={record.id} className="overflow-hidden rounded-xl border border-slate-100 bg-white transition hover:border-emerald-200">
                <button type="button" aria-expanded={expanded} onClick={() => openEvidenceForRecord(record)} className="flex w-full min-w-0 items-center gap-3 px-2.5 py-2 text-left">
                  <div className="h-11 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-slate-50">
                    {thumbnail ? <img src={thumbnail} alt={record.cropName || "Harvest batch"} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-emerald-700"><FileCheck className="h-5 w-5" /></div>}
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
                  <span className={cn("shrink-0 text-xl text-slate-500 transition-transform", expanded && "rotate-90")}>›</span>
                </button>
                {expanded && (
                  <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 p-3 sm:grid-cols-[minmax(0,1fr)_190px]">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">{record.cropName}</Badge>
                        <Badge variant={record.grade === "A" ? "success" : record.grade === "B" ? "warning" : "secondary"}>Grade {record.grade}</Badge>
                        {record.verificationStatus === "verified" && <Badge variant="success">Verified Grade {record.verifiedGrade || record.grade}</Badge>}
                        {record.verificationStatus === "buyer_verified" && <Badge variant="success">Buyer verified Grade {record.verifiedGrade || record.grade}</Badge>}
                        {record.verificationStatus === "farmer_declared" && <Badge variant="warning">Farmer declared · Unverified</Badge>}
                        {record.verificationStatus === "evidence_submitted" && <Badge variant="secondary">Evidence submitted</Badge>}
                        {record.verificationStatus === "rejected" && <Badge variant="destructive">Rejected</Badge>}
                        {meets === true && <Badge variant="outline" className="border-emerald-300 text-emerald-700">Meets {record.requirement?.grade} requirement</Badge>}
                        {meets === false && <Badge variant="outline" className="border-red-300 text-red-700">Does not meet {record.requirement?.grade} requirement</Badge>}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>{record.size} size</span>
                        <span>Freshness <b className="text-emerald-700">{record.freshness}%</b></span>
                        <span>Damaged <b className="text-rose-700">{record.damagedPct}%</b></span>
                        <span>{record.weightKg} kg verified</span>
                        <span>Inspected {formatDate(record.inspectedAt)}</span>
                      </div>
                      {record.inspectorNotes && <p className="text-xs text-slate-500">{record.inspectorNotes}</p>}
                      {record.aiAssessment && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs">
                          <Bot className="h-3.5 w-3.5 text-indigo-500" />
                          <span className="font-medium text-slate-600">AI estimate: Grade {record.aiAssessment.estimatedGrade}</span>
                          <span className="text-slate-400">({Math.round((record.aiAssessment.confidence || 0) * 100)}% confidence)</span>
                          {record.aiAssessment.mismatch ? <Badge variant="destructive">Mismatch — verification required</Badge> : <Badge variant="success">Consistent with declaration</Badge>}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {record.verificationStatus === "verified" && (
                          <Button size="sm" onClick={() => {
                            const linkedBatch = batches.find((item: any) => String(item._id || item.id) === String(record.batchId || ""));
                            const planId = linkedBatch?.sourceHarvestPlanId;
                            if (!planId) {
                              toast.error("This verified inspection is not linked to a harvest plan.");
                              return;
                            }
                            router.push(`/farmer/products/new?fromHarvest=${encodeURIComponent(String(planId))}&fromBatch=${encodeURIComponent(String(record.batchId))}&quantity=${encodeURIComponent(String(linkedBatch.quantityKg || ""))}&price=${encodeURIComponent(String(linkedBatch.finalRatePerKg || ""))}`);
                          }}>
                            <PackageSearch className="mr-1.5 h-4 w-4" /> Create Product
                          </Button>
                        )}
                        {record.verificationStatus === "farmer_declared" && (
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => aiMutation.mutate(record.id)} disabled={aiMutation.isPending}>
                            {aiMutation.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Bot className="mr-1.5 h-3 w-3" />} Run AI Screening
                          </Button>
                        )}
                        {batch && batch.qualityStatus === "pending_inspection" && (
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => requestInspectionMutation.mutate(batch._id || batch.id)} disabled={requestInspectionMutation.isPending}>
                            Request inspection
                          </Button>
                        )}
                      </div>
                      {record.photos?.length > 0 && <div className="flex flex-wrap gap-2">{record.photos.map((photo: string, index: number) => <img key={index} src={resolveQualityMediaUrl(photo)} alt="Inspection evidence" className="h-14 w-14 rounded-lg border object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} />)}</div>}
                      {record.videos?.length > 0 && <p className="text-xs text-slate-500">{record.videos.length} inspection video(s) attached</p>}
                    </div>
                    {gradeInfo && (
                      <div className="flex flex-col justify-center gap-1 rounded-lg border border-slate-100 bg-white p-3">
                        <p className="flex items-center gap-1 text-xs font-semibold text-slate-500"><Star className="h-3.5 w-3.5 text-amber-400" />{gradeInfo.label}</p>
                        <p className="text-xs text-slate-500">{gradeInfo.desc}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {records.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">{apiRecords.length === 0 ? "No inspection records yet. Request an inspection for a harvested batch to get started." : "No inspections match this status. Choose another filter to see more batches."}</p>
          )}
        </CardContent>
      </Card>

      {(() => {
        const evidenceQueue = apiRecords.filter((r: any) => !["approved", "rejected", "verified", "buyer_verified"].includes(String(r.inspectionStatus || r.verificationStatus || "").toLowerCase()));
        const awaitingReview = evidenceQueue.filter((r: any) => getEvidenceStatus(r) === "awaiting").length;
        const needsEvidence = evidenceQueue.length - awaitingReview;
        const uploadable = evidenceQueue.filter((r: any) => getEvidenceStatus(r) === "required");
        const selectedEvidence = evidenceQueue.find((r: any) => r.id === selectedEvidenceId) || uploadable[0] || evidenceQueue[0];
        const selectedNeedsEvidence = selectedEvidence ? getEvidenceStatus(selectedEvidence) === "required" : false;
        const selectedFiles = selectedEvidence ? evidenceFiles[selectedEvidence.id] || [] : [];
        const isUploadingThis = selectedEvidence && evidenceMutation.isPending && evidenceMutation.variables?.id === selectedEvidence.id;
        return (
          <Card id="evidence-submission" className="h-full scroll-mt-24 overflow-hidden border-slate-200 shadow-sm">
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
                const submitted = getEvidenceStatus(r) === "awaiting";
                const active = selectedEvidence?.id === r.id;
                return (
                  <button key={r.id} type="button" onClick={() => !submitted && setSelectedEvidenceId(r.id)} disabled={submitted}
                    className={cn("grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition", active ? "border-emerald-300 bg-emerald-50/60" : "border-slate-100 bg-white", submitted && "cursor-default")}>
                    <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-emerald-700">
                      {r.photos?.[0] ? <img src={resolveQualityMediaUrl(r.photos[0])} alt="" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <Camera className="h-4 w-4" />}
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
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900">{selectedEvidence.cropName || "Harvest batch"} · {selectedEvidence.lotNumber || "Lot pending"}</p>
                      <p className="text-[11px] text-slate-500">{selectedEvidence.weightKg || 0} kg · {selectedEvidence.photos?.length || 0} photos · {selectedEvidence.videos?.length || 0} videos</p>
                    </div>
                    {selectedNeedsEvidence ? <Badge variant="warning">Evidence required</Badge> : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Awaiting warehouse review</Badge>}
                  </div>
                  {selectedNeedsEvidence ? (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(180px,1fr)_auto] sm:items-end">
                      <div>
                        <label htmlFor={`evidence-${selectedEvidence.id}`} className="flex min-h-[68px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-2 py-2 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40">
                          <Camera className="mb-1 h-5 w-5 text-emerald-700" />
                          <span className="text-xs font-semibold text-slate-700">Choose photos or video</span>
                          <span className="text-[10px] text-slate-500">JPG, PNG, MP4, WEBM, MOV · Max 50 MB per file</span>
                        </label>
                        <input id={`evidence-${selectedEvidence.id}`} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={e => { const chosen = Array.from(e.target.files || []); if (chosen.length) setEvidenceFiles(current => ({ ...current, [selectedEvidence.id]: [...(current[selectedEvidence.id] || []), ...chosen] })); e.currentTarget.value = ""; }} className="sr-only" />
                        {selectedFiles.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{selectedFiles.map((file, index) => <span key={`${file.name}-${file.lastModified}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600"><span className="max-w-[120px] truncate">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setEvidenceFiles(current => ({ ...current, [selectedEvidence.id]: (current[selectedEvidence.id] || []).filter((_, fileIndex) => fileIndex !== index) }))}><XCircle className="h-3 w-3 text-rose-600" /></button></span>)}</div>}
                      </div>
                      <div><label htmlFor={`evidence-notes-${selectedEvidence.id}`} className="mb-1 block text-[11px] font-semibold text-slate-600">Note for warehouse (optional)</label><textarea id={`evidence-notes-${selectedEvidence.id}`} value={evidenceNotes[selectedEvidence.id] || ""} onChange={e => setEvidenceNotes(current => ({ ...current, [selectedEvidence.id]: e.target.value }))} placeholder="Mention visible defects, harvest time or handling details…" rows={2} className="min-h-[68px] w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></div>
                      <Button size="sm" className="h-10 w-full sm:w-auto" onClick={() => evidenceMutation.mutate({ id: selectedEvidence.id, files: selectedFiles, notes: evidenceNotes[selectedEvidence.id] || "" })} disabled={evidenceMutation.isPending || selectedFiles.length === 0}>{isUploadingThis ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</> : "Submit for warehouse review"}</Button>
                    </div>
                  ) : <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-3 text-xs text-emerald-800">Your evidence has been submitted. The warehouse quality team must complete the review before this batch can proceed to product listing.</p>}
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
