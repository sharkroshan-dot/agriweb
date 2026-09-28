"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, Clock3, MapPin, ShieldCheck, XCircle } from "lucide-react";
import { api } from "../../../../lib/api/client";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";

type Inspection = {
  id: string;
  priority?: "critical" | "urgent" | "normal";
  inspectionStatus?: string;
  inspectionDueAt?: string;
  batch?: {
    id: string;
    lotNumber?: string;
    cropName?: string;
    quantityKg?: number;
    harvestDate?: string;
    storageType?: string;
    expiresAt?: string;
    qualityStatus?: string;
  };
};

export default function WarehouseQualityInspectionPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [grade, setGrade] = useState("A");
  const [freshness, setFreshness] = useState("");
  const [damagedPct, setDamagedPct] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["warehouseQualityQueue"],
    queryFn: () => api.get("/quality/inspections/queue"),
    refetchInterval: 30000,
  });

  const queue: Inspection[] = useMemo(
    () => data?.data?.inspections ?? data?.inspections ?? [],
    [data]
  );

  const claimMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quality/inspections/${id}/claim`, { notes: "Inspector assigned for physical inspection" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["warehouseQualityQueue"] }),
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/quality/inspections/${id}/verify`, {
        verifiedGrade: grade,
        method: "warehouse_qc",
        freshness: freshness ? Number(freshness) : undefined,
        damagedPct: damagedPct ? Number(damagedPct) : undefined,
        weightKg: weightKg ? Number(weightKg) : undefined,
        notes,
      }),
    onSuccess: () => {
      setSelected(null);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["warehouseQualityQueue"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/quality/inspections/${id}/reject`, { reason: rejectReason }),
    onSuccess: () => {
      setSelected(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["warehouseQualityQueue"] });
    },
  });

  const openInspection = (item: Inspection) => {
    setSelected(item);
    setGrade("A");
    setFreshness("");
    setDamagedPct("");
    setWeightKg(item.batch?.quantityKg ? String(item.batch.quantityKg) : "");
    setNotes("");
    setRejectReason("");
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-emerald-600" />
          <h1 className="text-3xl font-bold">Quality Inspection</h1>
        </div>
        <p className="mt-1 text-muted-foreground">
          Independent physical inspection for harvested batches. Farmers cannot approve their own produce.
        </p>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Pending</p><p className="text-2xl font-bold">{queue.length}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Critical / urgent</p><p className="text-2xl font-bold text-orange-600">{queue.filter(x => x.priority === "critical" || x.priority === "urgent").length}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Rule</p><p className="text-sm font-medium">Approval requires physical inspection evidence</p></div>
        </CardContent>
      </Card>

      {error && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-700">Unable to load inspection queue.</CardContent></Card>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><CardTitle>Inspection Queue</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading inspection requests…</p> : null}
            {!isLoading && queue.length === 0 ? <p className="text-sm text-muted-foreground">No pending inspection requests.</p> : null}
            {queue.map((item) => (
              <button key={item.id} onClick={() => openInspection(item)} className="w-full rounded-xl border p-4 text-left transition hover:border-emerald-400 hover:bg-emerald-50/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{item.batch?.cropName || "Produce"} · {item.batch?.lotNumber}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{item.batch?.quantityKg ?? "—"} kg · {item.batch?.storageType || "normal"} storage</p>
                  </div>
                  <Badge variant={item.priority === "critical" ? "destructive" : item.priority === "urgent" ? "warning" : "default"}>{item.priority || "normal"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Due {item.inspectionDueAt ? new Date(item.inspectionDueAt).toLocaleString() : "—"}</span>
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />Visit batch location</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{selected ? "Physical Inspection" : "Select a batch"}</CardTitle></CardHeader>
          <CardContent>
            {!selected ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Select a queue item, claim it, then inspect the physical produce.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl bg-muted/50 p-4">
                  <p className="font-semibold">{selected.batch?.cropName} · {selected.batch?.lotNumber}</p>
                  <p className="text-sm text-muted-foreground">{selected.batch?.quantityKg} kg · harvested {selected.batch?.harvestDate ? new Date(selected.batch.harvestDate).toLocaleDateString() : "—"}</p>
                </div>

                {selected.inspectionStatus !== "in_progress" && (
                  <Button className="w-full" onClick={() => claimMutation.mutate(selected.id)} disabled={claimMutation.isPending}>
                    {claimMutation.isPending ? "Assigning…" : "Claim Inspection"}
                  </Button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">Grade<select value={grade} onChange={e => setGrade(e.target.value)} className="mt-1 w-full rounded-lg border bg-background p-2"><option>A</option><option>B</option><option>C</option></select></label>
                  <label className="text-sm">Freshness %<input value={freshness} onChange={e => setFreshness(e.target.value)} type="number" min="0" max="100" className="mt-1 w-full rounded-lg border p-2" /></label>
                  <label className="text-sm">Damaged %<input value={damagedPct} onChange={e => setDamagedPct(e.target.value)} type="number" min="0" max="100" className="mt-1 w-full rounded-lg border p-2" /></label>
                  <label className="text-sm">Measured kg<input value={weightKg} onChange={e => setWeightKg(e.target.value)} type="number" min="0" className="mt-1 w-full rounded-lg border p-2" /></label>
                </div>

                <div className="rounded-xl border border-dashed p-4">
                  <div className="flex items-center gap-2 font-medium"><Camera className="h-4 w-4" /> Evidence</div>
                  <p className="mt-1 text-xs text-muted-foreground">Record the physical condition, measured weight and inspection notes. Photo upload can be connected to your existing storage service.</p>
                </div>

                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Inspection notes and findings" className="min-h-24 w-full rounded-lg border p-3 text-sm" />

                <Button className="w-full" onClick={() => verifyMutation.mutate(selected.id)} disabled={verifyMutation.isPending || selected.inspectionStatus !== "in_progress"}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />{verifyMutation.isPending ? "Approving…" : "Approve Quality"}
                </Button>

                <div className="border-t pt-4">
                  <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection" className="min-h-20 w-full rounded-lg border p-3 text-sm" />
                  <Button variant="destructive" className="mt-2 w-full" onClick={() => rejectMutation.mutate(selected.id)} disabled={!rejectReason.trim() || rejectMutation.isPending || selected.inspectionStatus !== "in_progress"}>
                    <XCircle className="mr-2 h-4 w-4" />Reject Batch
                  </Button>
                </div>

                <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  AI may assist with screening, but it cannot replace the authorized physical inspection or approve the batch by itself.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
