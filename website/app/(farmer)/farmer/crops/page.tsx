"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sprout, Plus, Loader2, Leaf } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

export default function FarmerCropsPage() {
  const qc = useQueryClient();
  const [masterCropId, setMasterCropId] = useState("");
  const [name, setName] = useState("");
  const [variety, setVariety] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [areaAcres, setAreaAcres] = useState("");

  const { data: masterData, isLoading: mastersLoading } = useQuery({
    queryKey: ["masterCrops"],
    queryFn: () => api.get("/master-crops"),
  });
  const { data: farmerData, isLoading: cropsLoading } = useQuery({
    queryKey: ["farmerCrops"],
    queryFn: () => api.get("/master-crops/farmer"),
  });

  const masters = masterData?.data?.crops || [];
  const crops = farmerData?.data?.crops || [];
  const selected = masters.find((x: any) => String(x.id) === masterCropId);

  const create = useMutation({
    mutationFn: () => api.post("/master-crops/farmer", {
      masterCropId,
      name: name || selected?.name,
      variety: variety || undefined,
      fieldName: fieldName || undefined,
      areaAcres: areaAcres ? Number(areaAcres) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["farmerCrops"] });
      setMasterCropId(""); setName(""); setVariety(""); setFieldName(""); setAreaAcres("");
      toast.success("Farmer crop created from Master Crop defaults");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to create farmer crop"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Sprout className="h-6 w-6 text-emerald-600" /> My Crops</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose a Master Crop first. Shelf-life and safe-delivery rules are inherited automatically.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Farmer Crop</CardTitle>
          <CardDescription>Master Crop is the source of truth for default shelf life.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-medium">Master Crop *</label>
            <Select value={masterCropId} onValueChange={(v) => { setMasterCropId(v); setName(masters.find((x: any) => String(x.id) === v)?.name || ""); }}>
              <SelectTrigger><SelectValue placeholder={mastersLoading ? "Loading..." : "Select master crop"} /></SelectTrigger>
              <SelectContent>{masters.map((m: any) => <SelectItem key={m.id} value={String(m.id)}>{m.name} · {m.defaultShelfLifeDays} days</SelectItem>)}</SelectContent>
            </Select>
            {selected && <p className="text-xs text-emerald-700">Shelf life {selected.defaultShelfLifeDays} days · Safe delivery buffer {selected.safeDeliveryBufferHours ?? 24} hours</p>}
          </div>
          <div className="space-y-1"><label className="text-xs font-medium">Farmer crop name</label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-xs font-medium">Variety</label><Input value={variety} onChange={e => setVariety(e.target.value)} placeholder="e.g. Hybrid" /></div>
          <div className="space-y-1"><label className="text-xs font-medium">Field name</label><Input value={fieldName} onChange={e => setFieldName(e.target.value)} placeholder="e.g. Field A" /></div>
          <div className="space-y-1"><label className="text-xs font-medium">Area (acres)</label><Input type="number" min={0.1} step={0.1} value={areaAcres} onChange={e => setAreaAcres(e.target.value)} /></div>
          <div className="sm:col-span-2 flex justify-end"><Button onClick={() => create.mutate()} disabled={!masterCropId || create.isPending}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create Farmer Crop</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">My Crop Catalog</CardTitle></CardHeader>
        <CardContent>
          {cropsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : crops.length === 0 ? <p className="text-sm text-muted-foreground">No farmer crops yet.</p> : <div className="grid gap-3 sm:grid-cols-2">{crops.map((crop: any) => <div key={crop.id} className="rounded-xl border p-4"><div className="flex items-center justify-between"><p className="font-semibold">{crop.name}</p><Badge variant="outline">{crop.defaultShelfLifeDays}d shelf life</Badge></div><p className="mt-1 text-xs text-muted-foreground">Master: {crop.masterCropName} · Buffer: {crop.safeDeliveryBufferHours ?? 24}h</p>{crop.variety && <p className="mt-1 text-xs">Variety: {crop.variety}</p>}{crop.fieldName && <p className="mt-1 text-xs">Field: {crop.fieldName}</p>}</div>)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
