"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MapPin, Loader2, Search, Sparkles, Info } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";
import { PageErrorState } from "../../../components/common/page-state";

const STATES = ["Tamil Nadu", "Maharashtra", "Karnataka", "Uttar Pradesh", "Punjab", "Gujarat", "Kerala", "Delhi", "West Bengal", "Telangana", "Rajasthan", "Madhya Pradesh", "Bihar", "Odisha", "Assam", "Jharkhand"];
const PERIODS = [
  { value: "today", label: "Today" },
  { value: "3d", label: "Next 3 days" },
  { value: "7d", label: "Next 7 days" },
  { value: "30d", label: "Next 30 days" },
  { value: "3m", label: "Next 3 months" },
];
const MODES = [
  { value: "demand", label: "Demand", emoji: "🔥" },
  { value: "predicted", label: "Predicted demand", emoji: "📈" },
  { value: "growth", label: "Demand growth", emoji: "📊" },
  { value: "gap", label: "Unmet demand", emoji: "🕳️" },
  { value: "household", label: "Household", emoji: "🏠" },
  { value: "bulk", label: "Bulk & events", emoji: "🎉" },
  { value: "b2b", label: "B2B", emoji: "🏢" },
];
const BUYERS = [
  { value: "all", label: "All buyers" },
  { value: "household", label: "Households" },
  { value: "bulk", label: "Bulk & events" },
  { value: "b2b", label: "B2B" },
];

const labelStyles: Record<string, string> = {
  "very-high": "bg-emerald-100 text-emerald-700 border-emerald-300",
  high: "bg-green-100 text-green-700 border-green-300",
  medium: "bg-amber-100 text-amber-700 border-amber-300",
  low: "bg-red-100 text-red-700 border-red-300",
};

const levelStyles: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-700 border-emerald-300",
  MEDIUM: "bg-amber-100 text-amber-700 border-amber-300",
  LOW: "bg-slate-100 text-slate-600 border-slate-300",
};

const confStyles: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-500 border-slate-200",
};

const heatStyles = [
  "bg-red-100 border-red-200",
  "bg-orange-100 border-orange-200",
  "bg-amber-100 border-amber-200",
  "bg-lime-100 border-lime-200",
  "bg-emerald-200 border-emerald-300",
];

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)} t` : `${Math.round(n).toLocaleString()} kg`;

export function DemandHeatmapView() {
  const [state, setState] = useState("Tamil Nadu");
  const [product, setProduct] = useState("all");
  const [period, setPeriod] = useState("7d");
  const [mode, setMode] = useState("demand");
  const [buyer, setBuyer] = useState("all");

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/ai/demand-heatmap", {
        state,
        product: product === "all" ? null : product,
        period,
        mode,
        customerType: buyer,
        category: null,
      }),
    onError: (err: any) => toast.error(err?.message || "Could not load demand"),
  });

  const raw = mutation.data as any;
  const data = raw?.data ?? raw;
  const locations: any[] = data?.locations || [];
  const rankedAreas: any[] = data?.rankedAreas || [];
  const summary: any = data?.summary || {};
  const products: string[] = data?.products || [];
  const cold = Boolean(summary.coldStart);

  const maxHeat = Math.max(1, ...locations.map((l) => Number(l.modeValue) || 0));
  const heatClass = (l: any) => {
    const idx = Math.min(heatStyles.length - 1, Math.floor((Number(l.modeValue) || 0) / maxHeat * heatStyles.length));
    return heatStyles[idx];
  };
  const modeMeta = MODES.find((m) => m.value === mode) ?? MODES[0];

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <div className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-emerald-50/60 to-teal-50/40 p-5 shadow-sm sm:p-6">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Farmer intelligence</div>
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          <MapPin className="h-6 w-6 text-emerald-600" /> Demand Heatmap
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Explore buyer demand by location, compare demand levels and discover the best markets for your produce.
        </p>
      </div>

      <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100">
                  <Search className="h-4 w-4 text-emerald-700" />
                </span>
                Pick your produce
              </CardTitle>
              <CardDescription className="mt-1.5">
                Set your market, choose your produce and select the period you want to explore.
              </CardDescription>
            </div>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              3 simple steps
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 p-5 sm:p-6">
          {summary.confidence != null && (
            <Card className="border-emerald-200 bg-emerald-50/50 shadow-none">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-xs font-medium text-emerald-700">Forecast confidence</p>
                  <p className="text-lg font-semibold text-emerald-900">
                    {Math.round(Number(summary.confidence) <= 1 ? Number(summary.confidence) * 100 : Number(summary.confidence))}%
                  </p>
                </div>
                <p className="max-w-xl text-xs leading-5 text-emerald-800">
                  {summary.confidenceReason || "Confidence reflects the available historical demand signal for this selection."}
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 transition-colors focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">1</span>
                <label className="text-sm font-semibold text-slate-800">Selling location</label>
              </div>
              <p className="mb-2 text-xs leading-5 text-slate-500">Choose the state where you want to find buyers.</p>
              <Select value={state} onValueChange={(v) => setState(v)}>
                <SelectContent>
                  {STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 transition-colors focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">2</span>
                <label className="text-sm font-semibold text-slate-800">Your produce</label>
              </div>
              <p className="mb-2 text-xs leading-5 text-slate-500">Select a crop or view demand for all your produce.</p>
              <Select value={product} onValueChange={(v) => setProduct(v)}>
                <SelectContent>
                  <SelectItem value="all">All my produce</SelectItem>
                  {(products.length ? products : ["Tomato", "Onion", "Potato", "Brinjal", "Carrot", "Wheat", "Rice"]).map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 transition-colors focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-100">
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">3</span>
                <label className="text-sm font-semibold text-slate-800">Demand period</label>
              </div>
              <p className="mb-2 text-xs leading-5 text-slate-500">Choose when you plan to sell your produce.</p>
              <Select value={period} onValueChange={(v) => setPeriod(v)}>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">What demand would you like to explore?</p>
              <p className="mt-1 text-xs text-slate-500">Choose one view to focus the demand analysis.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-center rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
                    mode === m.value
                      ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/60 hover:text-emerald-800"
                  )}
                >
                  <span className="mr-1.5 shrink-0">{m.emoji}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Which buyers should we include?</p>
              <p className="mt-1 text-xs text-slate-500">Filter demand by the type of customer.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {BUYERS.map((b) => (
                <button
                  key={b.value}
                  type="button"
                  aria-pressed={buyer === b.value}
                  onClick={() => setBuyer(b.value)}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-center rounded-xl border px-3 py-2 text-center text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
                    buyer === b.value
                      ? "border-slate-800 bg-slate-800 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-800">Ready to explore demand?</p>
              <p className="mt-1 text-xs text-slate-600">Your results will use the location, produce and buyer filters selected above.</p>
            </div>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full rounded-xl bg-emerald-700 px-6 shadow-sm hover:bg-emerald-800 sm:w-auto">
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              {mutation.isPending ? "Finding demand..." : "Show demand"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {mutation.isError && (
        <PageErrorState
          title="Demand analysis is unavailable"
          description="The demand service could not produce a forecast for this selection. Try another region or period."
          retry={() => { mutation.reset(); mutation.mutate(); }}
        />
      )}

      {mutation.data && (
        <>
          {cold && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <span className="font-medium">Heads up:</span> there isn't much buying history here yet, so these are
                early estimates, not proven demand. List your produce and check back as orders grow.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardContent className="p-5">
                <p className="text-xs text-gray-500">Expected demand · {data.periodLabel}</p>
                <p className="mt-1 text-3xl font-bold text-emerald-600">{fmt(Number(summary.predictedDemandKg) || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs text-gray-500">Your stock available</p>
                <p className="mt-1 text-3xl font-bold">{fmt(Number(summary.supplyKg) || 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs text-gray-500">Unmet demand (opportunity)</p>
                <p className={cn("mt-1 text-3xl font-bold", Number(summary.gapKg) > 0 ? "text-amber-600" : "text-gray-400")}>{fmt(Number(summary.gapKg) || 0)}</p>
              </CardContent>
            </Card>
          </div>

          {data.recommendations && (
            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-teal-50/40">
              <CardContent className="flex items-start gap-3 p-4">
                <Sparkles className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-900">🤖 What the AI suggests</p>
                  <p className="mt-0.5 text-sm text-emerald-700">{data.recommendations}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <span className="text-sm font-medium text-gray-700">🏠 Households</span>
                <span className="text-lg font-bold">{fmt(Number(summary.segments?.householdKg) || 0)}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <span className="text-sm font-medium text-gray-700">🎉 Bulk & events</span>
                <span className="text-lg font-bold">{fmt(Number(summary.segments?.bulkEventKg) || 0)}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <span className="text-sm font-medium text-gray-700">🏢 B2B / shops</span>
                <span className="text-lg font-bold">{fmt(Number(summary.segments?.b2bKg) || 0)}</span>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <MapPin className="h-5 w-5 text-emerald-600" /> Demand by area
              <span className="text-sm font-normal text-gray-400">· {modeMeta.emoji} {modeMeta.label}</span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {locations.map((l: any, i: number) => (
                <div key={`${l.location}-${i}`} className={cn("rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md", heatClass(l))}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-gray-900">{l.location}</p>
                    <Badge className={cn("border", labelStyles[l.demandLabel] ?? labelStyles.low)}>
                      {Math.round(Number(l.demandScore) * 100)}%
                    </Badge>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {Number(l.modeValue).toLocaleString()} <span className="text-sm font-normal text-gray-500">{l.modeUnit}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
                    {l.distanceKm != null ? <span>📍 {Math.round(l.distanceKm)} km away</span> : <span>📍 distance n/a</span>}
                    {l.growthPct > 0 ? <span className="text-emerald-700">▲ {Math.round(l.growthPct)}%</span> : l.growthPct < 0 ? <span className="text-red-600">▼ {Math.round(l.growthPct)}%</span> : <span>steady</span>}
                    <span className={cn("ml-auto rounded-full border px-2 py-0.5", confStyles[l.confidence] ?? confStyles.low)}>{l.confidence}</span>
                  </div>
                </div>
              ))}
            </div>
            {!locations.length && (
              <Card>
                <CardContent className="flex flex-col items-center py-10 text-center">
                  <MapPin className="h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm text-gray-500">No areas match yet. Try another produce or region.</p>
                </CardContent>
              </Card>
            )}
          </div>

          {rankedAreas.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-emerald-600" /> Best places to sell
              </h2>
              <div className="grid gap-4 xl:grid-cols-2">
                {rankedAreas.map((a: any) => (
                  <Card key={a.rank} className={cn("rounded-2xl border-slate-200 shadow-sm", a.rank === 1 && "border-emerald-300 bg-gradient-to-br from-emerald-50/60 to-teal-50/30")}>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className={cn("flex h-9 w-9 items-center justify-center rounded-full text-base", a.rank === 1 ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")}>
                            {a.rank === 1 ? "🥇" : a.rank === 2 ? "🥈" : a.rank === 3 ? "🥉" : a.rank}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{a.location}</p>
                            <p className="text-xs text-gray-500">
                              {a.distanceKm != null ? `${Math.round(a.distanceKm)} km away` : "distance unknown"} · {Math.round(a.predictedDemandKg).toLocaleString()} kg expected
                            </p>
                          </div>
                        </div>
                        <Badge className={cn("border", levelStyles[a.opportunity] ?? levelStyles.LOW)}>{a.opportunity}</Badge>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg bg-white/70 p-3">
                          <p className="text-[11px] text-gray-500">Expected demand</p>
                          <p className="text-base font-bold">{Math.round(a.predictedDemandKg).toLocaleString()} kg</p>
                        </div>
                        <div className="rounded-lg bg-white/70 p-3">
                          <p className="text-[11px] text-gray-500">Unmet demand</p>
                          <p className={cn("text-base font-bold", a.gapKg > 0 ? "text-amber-600" : "text-gray-400")}>{Math.round(a.gapKg).toLocaleString()} kg</p>
                        </div>
                        <div className="rounded-lg bg-white/70 p-3">
                          <p className="text-[11px] text-gray-500">Try listing</p>
                          <p className="text-base font-bold text-emerald-700">{a.recommendedQuantityKg > 0 ? `~${Math.round(a.recommendedQuantityKg).toLocaleString()} kg` : "—"}</p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-1 text-xs text-gray-600">
                        {a.reasons.map((r: string, i: number) => (
                          <li key={i} className="flex items-start gap-1.5"><span className="text-emerald-600">•</span>{r}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!mutation.data && !mutation.isPending && !mutation.isError && (
        <Card className="rounded-2xl border-dashed border-slate-300 bg-slate-50/70 shadow-none">
          <CardContent className="flex flex-col items-center py-16 text-center">
            <div className="grid h-24 w-24 grid-cols-2 overflow-hidden rounded-lg">
              <div className="bg-emerald-200" />
              <div className="bg-emerald-400" />
              <div className="bg-amber-300" />
              <div className="bg-red-300" />
            </div>
            <p className="mt-4 font-medium text-gray-600">Find the best places to sell</p>
            <p className="text-sm text-gray-400">Pick your produce, then tap "Show demand".</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}