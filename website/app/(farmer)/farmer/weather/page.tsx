"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CloudSun, CloudRain, Wind, Thermometer, Loader2, Search, AlertTriangle,
  Snowflake, LocateFixed, MapPin, CalendarDays, Truck, Droplets, ShieldCheck,
  Sprout, RefreshCw, Package, ArrowUpRight, Clock3, CheckCircle2,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";

const STORAGE_GUIDE: Record<string, { range: string; tip: string }> = {
  tomato: { range: "10–13°C for mature-green fruit", tip: "Keep shaded and ventilated. Avoid chilling, direct sun and pressure damage." },
  onion: { range: "Cool, dry and well ventilated", tip: "Cure fully before long storage and protect from moisture." },
  potato: { range: "Cool, dark and ventilated", tip: "Keep away from sunlight to reduce greening. Separate damaged tubers." },
  carrot: { range: "Near 0–4°C with high humidity", tip: "Prevent moisture loss and separate damaged roots." },
  strawberry: { range: "About 0–2°C; maintain the cold chain", tip: "Handle gently, keep dry and cool quickly after harvest." },
  spinach: { range: "About 0–2°C with high humidity", tip: "Keep leaves cool and humid; remove damaged leaves." },
  capsicum: { range: "About 7–10°C; avoid chilling", tip: "Keep dry, shaded and ventilated; avoid pressure damage." },
};
const cropStorage = (name: string) => STORAGE_GUIDE[name.toLowerCase()] || {
  range: "Follow crop-specific local storage guidance",
  tip: "Keep produce shaded, clean, ventilated and protected from rain. Separate damaged produce.",
};

function SectionHeading({ eyebrow, title, description, icon: Icon }: {
  eyebrow?: string; title: string; description?: string; icon?: any;
}) {
  return (
    <div className="flex items-start gap-3">
      {Icon && <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon className="h-[18px] w-[18px]" /></span>}
      <div className="min-w-0">
        {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">{eyebrow}</p>}
        <h2 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">{description}</p>}
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, icon: Icon, tone, hint }: {
  label: string; value: any; unit?: string; icon: any; tone: string; hint: string;
}) {
  return (
    <Card className="border-slate-200/80 shadow-none">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-2 flex items-baseline gap-1 text-2xl font-bold tracking-tight text-slate-950">
            {value ?? "—"}{value != null && unit && <span className="text-sm font-semibold text-slate-500">{unit}</span>}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
        </div>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tone)}><Icon className="h-[18px] w-[18px]" /></span>
      </CardContent>
    </Card>
  );
}

export default function FarmerWeatherPage() {
  const [location, setLocation] = useState("");
  const [crop, setCrop] = useState("");
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationSource, setLocationSource] = useState<"gps" | "approximate" | "manual" | null>(null);

  const weatherMutation = useMutation({
    mutationFn: () => api.post("/ai/weather-impact", {
      location: coordinates
        ? { latitude: coordinates.lat, longitude: coordinates.lng }
        : { city: location, state: "Tamil Nadu", country: "India" },
      cropName: selectedCrop,
      productId: null,
      days: 7,
    }),
    onError: (err: any) => toast.error(err?.message || "Could not load weather. Check the location and try again."),
  });

  const { data: stockData, isLoading: stockLoading, isError: stockError } = useQuery({
    queryKey: ["farmerWeatherStock"],
    queryFn: () => api.get("/inventory/farmer/summary"),
    retry: 1,
  });
  const { data: batchesData, isLoading: batchesLoading, isError: batchesError } = useQuery({
    queryKey: ["farmerWeatherBatches"],
    queryFn: () => api.get("/batches"),
    retry: 1,
  });

  const { data: harvestPlansData, isLoading: harvestPlansLoading, isError: harvestPlansError } = useQuery({
    queryKey: ["farmerWeatherHarvestPlans"],
    queryFn: () => api.get("/harvests/farmer/plans", { params: { source: "planner" } }),
    retry: 1,
  });

  const useCurrentLocation = () => {
    setLocating(true);
    setLocationError(null);

    const apply = async (lat: number, lng: number, source: "gps" | "approximate") => {
      setCoordinates({ lat, lng });
      setLocationSource(source);
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, { headers: { "Accept-Language": "en" } });
        if (!response.ok) throw new Error("Could not resolve location name");
        const result = await response.json();
        const a = result?.address || {};
        const locality = a.village || a.town || a.city || a.hamlet || a.suburb || a.city_district || a.municipality || "";
        const name = [locality, a.state_district || a.district, a.state, a.country]
          .filter(Boolean).filter((part, index, parts) => parts.indexOf(part) === index).join(", ");
        setLocation(name || `Current location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
      } catch {
        setLocation(`Current location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
      } finally {
        setLocating(false);
      }
    };

    const useApproximateLocation = async () => {
      try {
        const response = await fetch("https://ipapi.co/json/");
        if (!response.ok) throw new Error("Approximate location unavailable");
        const result = await response.json();
        const lat = Number(result?.latitude);
        const lng = Number(result?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Invalid approximate location");
        await apply(lat, lng, "approximate");
      } catch {
        setLocating(false);
        setLocationError("We couldn't detect your area. Please enter your village or town above.");
      }
    };

    if (!navigator.geolocation) {
      void useApproximateLocation();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      p => { void apply(p.coords.latitude, p.coords.longitude, "gps"); },
      () => { void useApproximateLocation(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  };

  const run = () => {
    if (!cropOptions.length) {\n      toast.error("Add a pre-harvest crop in Harvest Planner or record a harvested crop batch first.");\n      return;\n    }\n    if (!coordinates && !location.trim()) {
      setLocationError("Enter your village or town, or use the location button.");
      return;
    }
    weatherMutation.mutate();
  };

  const data = weatherMutation.data as any;
  const weather = data?.weather || {};
  const forecast = Array.isArray(data?.forecast) ? data.forecast : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const products = (stockData as any)?.data?.products || [];
  const batches = (batchesData as any)?.data?.batches || [];
  const harvestPlans = (harvestPlansData as any)?.data?.plans || [];
  const cropOptionMap = new Map<string, { name: string; stages: Set<string> }>();
  harvestPlans
    .filter((plan: any) => !["cancelled", "deleted"].includes(String(plan.status || "").toLowerCase()))
    .forEach((plan: any) => {
      const name = String(plan.cropName || "").trim();
      if (!name) return;
      const key = name.toLocaleLowerCase();
      const current = cropOptionMap.get(key) || { name, stages: new Set<string>() };
      current.stages.add(String(plan.status || "").toLowerCase() === "harvested" || String(plan.stage || "").toLowerCase() === "harvested" ? "Harvested" : "Pre-harvest");
      cropOptionMap.set(key, current);
    });
  batches
    .filter((batch: any) => !["expired", "cancelled"].includes(String(batch.status || "").toLowerCase()) && Number(batch.remainingKg ?? batch.quantityKg ?? 0) > 0)
    .forEach((batch: any) => {
      const name = String(batch.cropName || "").trim();
      if (!name) return;
      const key = name.toLocaleLowerCase();
      const current = cropOptionMap.get(key) || { name, stages: new Set<string>() };
      current.stages.add("Harvested");
      cropOptionMap.set(key, current);
    });
  const cropOptions = Array.from(cropOptionMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const selectedCrop = cropOptions.find(option => option.name.toLocaleLowerCase() === crop.toLocaleLowerCase())?.name || cropOptions[0]?.name || "";
  const riskScore = Number(data?.impactScore ?? 0);
  const riskLevel = riskScore >= 0.7 ? "High attention" : riskScore >= 0.35 ? "Moderate attention" : "Low weather risk";
  const riskClass = riskScore >= 0.7 ? "border-rose-200 bg-rose-50 text-rose-800" : riskScore >= 0.35 ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800";
  const remainingBatches = batches.filter((b: any) => Number(b.remainingKg ?? b.quantityKg ?? 0) > 0);
  const expiringBatches = remainingBatches.filter((b: any) => ["expiring", "expired"].includes(b.freshness?.status)).length;

  return (
    <main className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Farm weather & post-harvest care"
        title="Weather & Perishability"
        description="Check local weather, protect crops, plan harvest work and keep harvested produce in good condition."
      />

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><MapPin className="h-4 w-4" /></span>
            <div>
              <CardTitle className="text-sm font-semibold text-slate-900">Check your farm weather</CardTitle>
              <CardDescription className="text-xs">Choose your location and the crop you want to monitor.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(200px,0.8fr)_auto] lg:items-start">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Village / town / city</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={location} placeholder="Enter your farm location" className="h-10 border-slate-200 pl-9 text-sm" onChange={e => { setCoordinates(null); setLocationSource("manual"); setLocation(e.target.value); setLocationError(null); }} />
              </div>
              <Button type="button" variant="outline" className="h-10 w-10 shrink-0 border-slate-200 px-0" onClick={useCurrentLocation} disabled={locating} title="Use my current location">
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
              </Button>
            </div>
            {locationError && <p className="text-xs text-rose-600">{locationError}</p>}
            <p className="text-[11px] text-slate-400">{locationSource === "gps" ? "Using your device GPS location." : locationSource === "approximate" ? "Using an approximate area from your internet connection. Enter your village for a more accurate forecast." : "Enter a nearby village or town, or use the location button."}</p>
          </div>
          <div className="space-y-1.5 lg:pt-0">
            <label className="text-xs font-semibold text-slate-700">Your crops</label>
            <Select value={selectedCrop} onValueChange={setCrop} disabled={harvestPlansLoading || batchesLoading || cropOptions.length === 0}>
              <SelectContent>{cropOptions.map(option => (
                <SelectItem key={option.name} value={option.name}>
                  {option.name} — {Array.from(option.stages).join(" & ")}
                </SelectItem>
              ))}</SelectContent>
            </Select>
            <p className="text-[11px] text-slate-400">
              {harvestPlansLoading || batchesLoading ? "Loading your crops…" : cropOptions.length ? "Only your planned and harvested crops are shown." : "No crops found. Add a crop in Harvest Planner or create a harvest batch."}
            </p>
          </div>
          <Button onClick={run} disabled={weatherMutation.isPending || locating || harvestPlansLoading || batchesLoading || cropOptions.length === 0} className="h-10 self-start bg-emerald-700 px-5 text-sm font-semibold text-white shadow-none hover:bg-emerald-800 lg:mt-[22px]">
            {weatherMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            {data ? "Refresh weather" : "Check weather"}
          </Button>
        </CardContent>
      </Card>

      {weatherMutation.isError && (
        <Card className="border-rose-200 bg-rose-50/70 shadow-none"><CardContent className="flex gap-3 p-4 text-sm text-rose-800"><AlertTriangle className="h-5 w-5 shrink-0" />We could not retrieve weather for this place. Check the spelling or try again later. No weather risk has been assumed.</CardContent></Card>
      )}

      {!data && !weatherMutation.isPending && (
        <Card className="border-dashed border-slate-300 bg-slate-50/70 shadow-none">
          <CardContent className="flex flex-col items-center px-5 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-sky-700 shadow-sm"><CloudSun className="h-7 w-7" /></span>
            <h2 className="mt-4 text-base font-bold text-slate-900">Your local farm forecast starts here</h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">Enter your village or use GPS, then choose one of your pre-harvest or harvested crops to get weather and produce-care guidance.</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Live conditions</p><h2 className="mt-1 text-lg font-bold tracking-tight text-slate-950">Weather overview</h2><p className="mt-0.5 text-xs text-slate-500">{data.location} <span className="px-1">·</span> {crop} <span className="px-1">·</span> Updated {data.timestamp ? new Date(data.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "just now"}</p></div>
              <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold", riskClass)}>{riskLevel}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Temperature" value={weather.temperature} unit="°C" icon={Thermometer} tone="bg-orange-50 text-orange-700" hint="Current air temperature" />
              <MetricCard label="Humidity" value={weather.humidity} unit="%" icon={Droplets} tone="bg-sky-50 text-sky-700" hint="Relative air moisture" />
              <MetricCard label="Rain probability" value={weather.rainChance} unit="%" icon={CloudRain} tone="bg-blue-50 text-blue-700" hint="Highest chance in forecast" />
              <MetricCard label="Wind speed" value={weather.windSpeed} unit=" km/h" icon={Wind} tone="bg-violet-50 text-violet-700" hint="Current wind conditions" />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
            <Card className="border-slate-200/80 shadow-none">
              <CardHeader className="pb-3">
                <SectionHeading eyebrow="Next 7 days" title="Forecast & field planning" description="Use the daily outlook to plan irrigation, spraying and field activities." icon={CalendarDays} />
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-4">
                  {forecast.map((f: any, i: number) => (
                    <div key={f.date || i} className={cn("rounded-xl border p-3", f.alerts?.length ? "border-amber-200 bg-amber-50/50" : "border-slate-100 bg-slate-50/70")}>
                      <p className="text-xs font-semibold text-slate-700">{f.date ? new Date(f.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : `Day ${i + 1}`}</p>
                      <div className="my-3 flex items-center justify-between gap-1">
                        <CloudSun className="h-6 w-6 text-amber-500" />
                        <p className="text-sm font-bold text-slate-900">{f.minTemp ?? "—"}° <span className="font-normal text-slate-400">/</span> {f.temp ?? "—"}°</p>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500"><span>Rain chance</span><strong className="text-slate-800">{f.rainChance ?? "—"}%</strong></div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, Number(f.rainChance) || 0))}%` }} /></div>
                      {f.alerts?.length > 0 && <p className="mt-2 line-clamp-2 text-[10px] font-semibold leading-4 text-amber-800">{f.alerts.join(" · ")}</p>}
                    </div>
                  ))}
                </div>
                {forecast.length === 0 && <p className="py-5 text-center text-sm text-slate-500">Forecast details are not available for this location.</p>}
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 shadow-none">
              <CardHeader className="pb-3"><SectionHeading eyebrow="Crop watch" title="Weather risk & actions" description={data.recommendation} icon={AlertTriangle} /></CardHeader>
              <CardContent className="space-y-2">
                {alerts.map((a: any, i: number) => (
                  <div key={i} className={cn("rounded-xl border p-3", a.level === "warning" ? "border-amber-200 bg-amber-50/70" : "border-emerald-100 bg-emerald-50/60")}>
                    <div className="flex items-start gap-2.5">
                      {a.level === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />}
                      <div><p className="text-sm font-semibold text-slate-900">{a.title}</p><p className="mt-1 text-xs leading-5 text-slate-600">{a.message}</p></div>
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3">
                  <p className="flex items-center gap-2 text-xs font-bold text-sky-900"><Sprout className="h-4 w-4" /> Harvest guidance</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-700">{data.harvestAdvice}</p>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <SectionHeading eyebrow="Post-harvest care" title="Perishable stock & storage" description="Monitor available product quantities and follow suitable handling guidance." icon={Snowflake} />
          <div className="flex items-center gap-2 text-xs text-slate-500"><Package className="h-4 w-4" /> {products.length} products</div>
        </div>
        {stockLoading ? <Card className="shadow-none"><CardContent className="p-5 text-sm text-slate-500">Loading your stock…</CardContent></Card> : stockError ? <Card className="shadow-none"><CardContent className="p-5 text-sm text-amber-700">Stock information is temporarily unavailable. Check the Inventory page for current quantities.</CardContent></Card> : products.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.slice(0, 9).map((p: any) => {
              const guide = cropStorage(p.product_name || "");
              const low = Number(p.available_stock) > 0 && Number(p.available_stock) <= 5;
              return (
                <Card key={p.product_id} className="border-slate-200/80 shadow-none transition-shadow hover:shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{p.product_name}</p><p className="mt-0.5 text-[11px] text-slate-400">Available stock</p></div>
                      <Badge className={cn("shrink-0 border", p.is_out_of_stock ? "border-rose-200 bg-rose-50 text-rose-700" : low ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>{p.is_out_of_stock ? "Out of stock" : low ? "Low stock" : "In stock"}</Badge>
                    </div>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{p.available_stock} <span className="text-sm font-medium text-slate-500">{p.unit || "kg"}</span></p>
                    <div className="mt-3 rounded-lg bg-slate-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Storage condition</p>
                      <p className="mt-1 text-xs font-semibold text-slate-800">{guide.range}</p>
                      <p className="mt-1 text-[11px] leading-5 text-slate-500">{guide.tip}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : <Card className="border-dashed shadow-none"><CardContent className="p-6 text-center text-sm text-slate-500">No product stock is currently listed. Add products and stock in Inventory to see them here.</CardContent></Card>}
        <p className="text-[11px] leading-5 text-slate-400">Storage ranges are general guidance and vary by variety, maturity, packaging and storage duration. Confirm suitable conditions with local agricultural or post-harvest guidance.</p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <SectionHeading eyebrow="Freshness monitoring" title="Harvest batch expiry" description="Use your recorded harvest date and shelf life to prioritize batches." icon={Clock3} />
          {remainingBatches.length > 0 && <Badge className={cn("border", expiringBatches ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>{expiringBatches} need attention</Badge>}
        </div>
        {batchesLoading ? <Card className="shadow-none"><CardContent className="p-4 text-sm text-slate-500">Checking your harvest batches…</CardContent></Card> : batchesError ? <Card className="shadow-none"><CardContent className="p-4 text-sm text-amber-700">Batch freshness information is temporarily unavailable. Open Batches &amp; Traceability to verify expiry dates.</CardContent></Card> : remainingBatches.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {remainingBatches.slice(0, 8).map((b: any) => {
              const status = b.freshness?.status || "unknown";
              const days = b.freshness?.daysRemaining;
              const expired = status === "expired";
              const urgent = status === "expiring" || (typeof days === "number" && days <= 2);
              return (
                <div key={b.id || b._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", expired ? "bg-rose-50 text-rose-700" : urgent ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700")}><Package className="h-5 w-5" /></span>
                    <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{b.cropName || "Harvest batch"}</p><p className="mt-0.5 text-[11px] text-slate-500">{b.lotNumber || "Batch"} · {b.remainingKg ?? b.quantityKg ?? "—"} kg remaining</p><p className="mt-0.5 text-[11px] text-slate-400">Expiry: {b.expiresAt ? new Date(b.expiresAt).toLocaleDateString("en-IN") : "Not recorded"}</p></div>
                  </div>
                  <Badge className={cn("border", expired ? "border-rose-200 bg-rose-50 text-rose-700" : urgent ? "border-amber-200 bg-amber-50 text-amber-800" : status === "fresh" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600")}>{expired ? "Expired" : urgent ? `Expiring · ${days ?? "soon"}d` : status === "fresh" ? `Fresh · ${days ?? "—"}d left` : "Check record"}</Badge>
                </div>
              );
            })}
          </div>
        ) : <Card className="border-dashed shadow-none"><CardContent className="p-6 text-center"><p className="text-sm font-semibold text-slate-800">No active harvest batches</p><p className="mt-1 text-xs text-slate-500">Create batches from harvested crops to monitor their freshness and expiry here.</p></CardContent></Card>}
        <p className="text-[11px] leading-5 text-slate-400">Expiry estimates use the harvest date and shelf life recorded when the batch was created. Inspect produce physically before selling or discarding it.</p>
      </section>

      <section className="space-y-3">
        <SectionHeading eyebrow="Dispatch readiness" title="Delivery & transport care" description="Simple steps to protect produce from harvest until customer handover." icon={Truck} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: ShieldCheck, title: "Protect from heat", text: "Keep harvested produce shaded and ventilated while waiting for pickup.", tone: "bg-amber-50 text-amber-700" },
            { icon: CloudRain, title: "Keep it dry", text: (weather.rainChance ?? 0) >= 60 ? "Rain is likely. Use clean waterproof covers without trapping heat or moisture." : "Cover crates during unexpected rain and keep produce away from standing water.", tone: "bg-sky-50 text-sky-700" },
            { icon: Truck, title: "Handle carefully", text: "Use clean crates, avoid over-stacking and separate bruised or damaged items.", tone: "bg-violet-50 text-violet-700" },
            { icon: Snowflake, title: "Maintain cooling", text: "Arrange suitable cooling for crops that require a cold chain; avoid one temperature for every crop.", tone: "bg-cyan-50 text-cyan-700" },
          ].map((item) => (
            <Card key={item.title} className="border-slate-200/80 shadow-none">
              <CardContent className="p-4">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", item.tone)}><item.icon className="h-[18px] w-[18px]" /></span>
                <p className="mt-3 text-sm font-bold text-slate-900">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-1 border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>Weather data: Open-Meteo · Forecasts are estimates and may change.</span>
        <span>Weather alerts are precautions, not disease diagnoses or crop inspections.</span>
      </footer>
    </main>
  );
}
