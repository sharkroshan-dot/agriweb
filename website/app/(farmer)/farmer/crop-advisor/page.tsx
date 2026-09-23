"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sprout, Loader2, CloudSun, Thermometer, Droplets, TreePine, RefreshCcw } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";

const SOIL_TYPES = ["loamy", "clay", "sandy", "black"];
const SEASONS = ["kharif", "rabi", "summer"];
const CROPS = ["Tomato", "Rice", "Wheat", "Potato", "Onion", "Chilli", "Brinjal", "Carrot", "Maize", "Cotton"];

export default function FarmerCropAdvisorPage() {
  const [form, setForm] = useState({
    soilType: "loamy",
    location: "",
    temperature: "28",
    rainfall: "100",
    previousCrop: "",
    season: "kharif",
    areaAcres: "1",
  });

  const advisorMutation = useMutation({
    mutationFn: () =>
      api.post("/ai/crop-recommendation", {
        soilType: form.soilType,
        location: form.location || "Farm",
        temperature: Number(form.temperature),
        rainfall: Number(form.rainfall),
        previousCrop: form.previousCrop || null,
        season: form.season,
        areaAcres: Number(form.areaAcres),
      }),
    onError: (err: any) => toast.error(err?.message || "Failed to get crop recommendations"),
  });

  const run = () => advisorMutation.mutate();
  const data = advisorMutation.data as any;

  const suitColor = (s: string) =>
    s === "high"
      ? "bg-emerald-100 text-emerald-700"
      : s === "moderate"
        ? "bg-amber-100 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Crop Advisor</h1>
        <p className="text-gray-500">
          AI recommends the best crops for your soil, season, weather and field.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TreePine className="h-5 w-5 text-emerald-600" />
            Field &amp; Climate Inputs
          </CardTitle>
          <CardDescription>Enter your field conditions to get personalised crop suggestions.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Soil type</label>
            <Select value={form.soilType} onValueChange={(v) => setForm({ ...form, soilType: v })}>
              <SelectContent>
                {SOIL_TYPES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Location</label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Coimbatore" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1"><Thermometer className="h-3 w-3" /> Temperature (°C)</label>
            <Input type="number" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1"><Droplets className="h-3 w-3" /> Rainfall (mm)</label>
            <Input type="number" value={form.rainfall} onChange={(e) => setForm({ ...form, rainfall: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Season</label>
            <Select value={form.season} onValueChange={(v) => setForm({ ...form, season: v })}>
              <SelectContent>
                {SEASONS.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Previous crop</label>
            <Select value={form.previousCrop} onValueChange={(v) => setForm({ ...form, previousCrop: v })}>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {CROPS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Area (acres)</label>
            <Input type="number" min={0.1} step={0.1} value={form.areaAcres} onChange={(e) => setForm({ ...form, areaAcres: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={run} disabled={advisorMutation.isPending}>
              {advisorMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sprout className="mr-2 h-4 w-4" />}
              Recommend Crops
            </Button>
          </div>
        </CardContent>
      </Card>

      {advisorMutation.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-teal-50/40">
              <CardContent className="p-4">
                <p className="text-xs font-medium text-gray-500 flex items-center gap-1"><Sprout className="h-3 w-3 text-emerald-600" /> Best crop for you</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">{data?.topCrop}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium text-gray-500 flex items-center gap-1"><CloudSun className="h-3 w-3 text-sky-600" /> Soil health</p>
                <p className="mt-1 text-sm text-slate-700">{data?.soilHealth}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-xs font-medium text-gray-500 flex items-center gap-1"><RefreshCcw className="h-3 w-3 text-violet-600" /> {data?.seasonInfo}</p>
              <div className="space-y-2 pt-1">
                {(data?.recommendations || []).map((rec: any, i: number) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{rec.crop}</p>
                        <Badge className={cn("border", suitColor(rec.suitability))}>{rec.suitability}</Badge>
                      </div>
                      <p className="text-xs text-gray-500">Duration {rec.duration} · Soil {rec.soil} · Season {rec.season}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-end">
                        <p className="text-sm font-bold text-emerald-600">{rec.score}/100</p>
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-100">
                          <div className={cn("h-full rounded-full", rec.score >= 70 ? "bg-emerald-500" : rec.score >= 50 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${rec.score}%` }} />
                        </div>
                      </div>
                    </div>
                    {rec.reasons?.length > 0 && (
                      <p className="w-full text-xs text-gray-500">{rec.reasons.join(" · ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!advisorMutation.data && !advisorMutation.isPending && (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Sprout className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No recommendations yet</p>
            <p className="text-sm text-gray-400">Fill in your field details and click "Recommend Crops".</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
