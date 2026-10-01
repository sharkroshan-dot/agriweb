"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Loader2, FlaskConical } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

export default function AdminQualityPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["adminQualityInspections"], queryFn: () => api.get("/quality/inspections") });
  const inspections = data?.data?.inspections ?? [];
  const approve = useMutation({
    mutationFn: (r: any) => api.post(`/quality/inspections/${r.id}/approve-batch`, { verifiedGrade: r.grade || "A", method: "manual_inspection" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["adminQualityInspections"] }); toast.success("Batch approved and marketplace stock activated"); },
    onError: (e: any) => toast.error(e?.message || "Approval failed"),
  });
  const reject = useMutation({
    mutationFn: (r: any) => api.post(`/quality/inspections/${r.id}/reject`, { reason: "Quality verification rejected; rework required." }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["adminQualityInspections"] }); toast.success("Batch moved to rework"); },
    onError: (e: any) => toast.error(e?.message || "Rejection failed"),
  });
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Quality Verification</h1><p className="text-muted-foreground">Approve or reject harvest batches before marketplace activation.</p></div>
    {isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div> :
      <div className="space-y-3">{inspections.map((r: any) => <Card key={r.id}>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FlaskConical className="h-4 w-4" />{r.lotNumber} · {r.cropName}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">Grade {r.grade} · Freshness {r.freshness}% · Damage {r.damagedPct}% · {r.verificationStatus}</div>
          <div className="flex gap-2">
            {r.verificationStatus !== "verified" && r.verificationStatus !== "buyer_verified" && <>
              <Button size="sm" onClick={() => approve.mutate(r)} disabled={approve.isPending}><CheckCircle2 className="mr-1 h-4 w-4" />Approve & Activate</Button>
              <Button size="sm" variant="outline" onClick={() => reject.mutate(r)} disabled={reject.isPending}><XCircle className="mr-1 h-4 w-4" />Reject / Rework</Button>
            </>}
            <Badge variant={r.verificationStatus === "verified" ? "success" : "secondary"}>{r.verificationStatus}</Badge>
          </div>
        </CardContent>
      </Card>)}</div>}
  </div>;
}
