"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CloudSun, CloudRain, Wind, Thermometer, Loader2, Search, AlertTriangle, Snowflake, LocateFixed, MapPin, Sprout, CalendarDays, Truck, Droplets, ShieldCheck } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";

const CROPS = ["Tomato", "Onion", "Potato", "Carrot", "Strawberry", "Spinach", "Capsicum"];
const STORAGE_GUIDE: Record<string, { range: string; tip: string }> = {
  tomato: { range: "About 10–13°C for mature-green fruit; avoid chilling", tip: "Keep dry, shaded and ventilated. Avoid direct sun and crushing." },
  onion: { range: "Cool, dry and well ventilated", tip: "Cure fully before long storage. Keep away from moisture." },
  potato: { range: "Cool, dark and ventilated; avoid freezing", tip: "Keep away from sunlight to reduce greening. Separate damaged tubers." },
  carrot: { range: "Near 0–4°C with high humidity", tip: "Remove damaged roots and prevent drying. Keep away from ethylene sources." },
  strawberry: { range: "About 0–2°C; keep the cold chain", tip: "Handle gently, keep dry and cool quickly after harvest." },
  spinach: { range: "About 0–2°C with high humidity", tip: "Keep leaves cool and humid; remove damaged leaves." },
  capsicum: { range: "About 7–10°C; avoid chilling", tip: "Keep dry, shaded and ventilated; avoid pressure damage." },
};
const cropStorage = (name: string) => STORAGE_GUIDE[name.toLowerCase()] || {
  range: "Use crop-specific local extension guidance",
  tip: "Keep produce shaded, clean, ventilated and protected from rain. Separate damaged produce.",
};

export default function FarmerWeatherPage() {
  const [location, setLocation] = useState("");
  const [crop, setCrop] = useState("Tomato");
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const weatherMutation = useMutation({
    mutationFn: () => api.post("/ai/weather-impact", {
      location: coordinates
        ? { latitude: coordinates.lat, longitude: coordinates.lng }
        : { city: location, state: "Tamil Nadu", country: "India" },
      cropName: crop,
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

  const useCurrentLocation = () => {
    setLocating(true);
    setLocationError(null);
    const apply = async (lat: number, lng: number) => {
      setCoordinates({ lat, lng });
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`, { headers: { "Accept-Language": "en" } });
        const result = response.ok ? await response.json() : {};
        const a = result?.address || {};
        const name = [a.village || a.town || a.city || a.hamlet || a.suburb, a.state_district || a.district, a.state, a.country].filter(Boolean).join(", ");
        setLocation(name || `GPS ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      } catch {
        setLocation(`GPS ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      } finally { setLocating(false); }
    };
    if (!navigator.geolocation) {
      setLocating(false);
      setLocationError("Location is not available in this browser. Enter your village or town instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => { void apply(p.coords.latitude, p.coords.longitude); },
      () => { setLocating(false); setLocationError("Location permission was not granted. Enter your village or town manually."); },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 },
    );
  };

  const run = () => {
    if (!coordinates && !location.trim()) {
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
  const riskLevel = (data?.impactScore ?? 0) >= 0.7 ? "High attention" : (data?.impactScore ?? 0) >= 0.35 ? "Some attention" : "Low weather risk";
  const riskClass = (data?.impactScore ?? 0) >= 0.7 ? "bg-rose-100 text-rose-800" : (data?.impactScore ?? 0) >= 0.35 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";

  return (
    <div className="space-y-6 pb-8">
      <header className="rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-sky-100 p-3 text-sky-700"><CloudSun className="h-6 w-6" /></span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Farm protection and produce care</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">Weather &amp; Perishability</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Understand weather risks, plan field work and protect harvested vegetables from heat, rain and handling damage.</p>
          </div>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-sky-600" /> Your farm weather</CardTitle>
          <CardDescription>Enter your village or town and select the crop you want to protect.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Village / town / city</label>
            <div className="flex gap-2">
              <Input value={location} placeholder="Example: Manachanallur" onChange={e => { setCoordinates(null); setLocation(e.target.value); setLocationError(null); }} />
              <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={locating} title="Use my location">
                {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
              </Button>
            </div>
            {locationError && <p className="text-xs text-rose-600">{locationError}</p>}
            <p className="text-xs text-slate-500">{coordinates ? "Using your GPS location." : "Weather is looked up for the place you enter."}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Which crop are you growing?</label>
            <Select value={crop} onValueChange={setCrop}>
              <SelectContent>{CROPS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button onClick={run} disabled={weatherMutation.isPending || locating} className="bg-emerald-700 hover:bg-emerald-800">
            {weatherMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Check weather
          </Button>
        </CardContent>
      </Card>

      {weatherMutation.isError && <Card className="border-rose-200 bg-rose-50"><CardContent className="p-4 text-sm text-rose-800">We could not retrieve weather for this place. Check the spelling or try again later. No weather risk has been assumed.</CardContent></Card>}

      {data && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-lg font-bold text-slate-900">Weather right now</h2><p className="text-sm text-slate-500">{data.location} · {crop}</p></div>
              <Badge className={riskClass}>{riskLevel}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm text-slate-500"><Thermometer className="h-4 w-4 text-amber-600" /> Temperature</p><p className="mt-2 text-2xl font-bold">{weather.temperature ?? "—"}°C</p><p className="text-xs text-slate-500">Current air temperature</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm text-slate-500"><Droplets className="h-4 w-4 text-sky-600" /> Air moisture</p><p className="mt-2 text-2xl font-bold">{weather.humidity ?? "—"}%</p><p className="text-xs text-slate-500">Humidity</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm text-slate-500"><CloudRain className="h-4 w-4 text-sky-600" /> Rain chance</p><p className="mt-2 text-2xl font-bold">{weather.rainChance ?? "—"}%</p><p className="text-xs text-slate-500">Highest chance in forecast</p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="flex items-center gap-2 text-sm text-slate-500"><Wind className="h-4 w-4 text-slate-600" /> Wind speed</p><p className="mt-2 text-2xl font-bold">{weather.windSpeed ?? "—"} km/h</p><p className="text-xs text-slate-500">Current wind</p></CardContent></Card>
            </div>
          </section>

          <section className="space-y-3">
            <div><h2 className="text-lg font-bold text-slate-900">Crop protection alerts</h2><p className="text-sm text-slate-500">Weather-based precautions for {crop}. These are forecast warnings, not disease diagnoses.</p></div>
            <div className="grid gap-3 md:grid-cols-2">
              {alerts.map((a: any, i: number) => <Card key={i} className={cn("shadow-none", a.level === "warning" ? "border-amber-200 bg-amber-50/60" : "border-emerald-200 bg-emerald-50/50")}><CardContent className="flex gap-3 p-4"><AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", a.level === "warning" ? "text-amber-700" : "text-emerald-700")} /><div><p className="font-semibold text-slate-900">{a.title}</p><p className="mt-1 text-sm leading-6 text-slate-700">{a.message}</p></div></CardContent></Card>)}
            </div>
            <Card className="border-sky-200 bg-sky-50/50 shadow-none"><CardContent className="flex gap-3 p-4"><CalendarDays className="h-5 w-5 shrink-0 text-sky-700" /><div><p className="font-semibold text-slate-900">Harvest planning guidance</p><p className="mt-1 text-sm leading-6 text-slate-700">{data.harvestAdvice}</p><p className="mt-1 text-xs text-slate-500">Check crop maturity and field conditions; weather alone cannot determine harvest readiness.</p></div></CardContent></Card>
          </section>

          <section className="space-y-3">
            <div><h2 className="text-lg font-bold text-slate-900">Weather for the next 7 days</h2><p className="text-sm text-slate-500">Plan watering, spraying, harvesting and field work around the forecast.</p></div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {forecast.map((f: any, i: number) => <Card key={f.date || i} className="shadow-none"><CardContent className="p-3"><p className="text-sm font-semibold text-slate-800">{f.date || `Day ${i + 1}`}</p><div className="mt-2 flex items-center justify-between"><span className="text-lg font-bold">{f.minTemp ?? "—"}° / {f.temp ?? "—"}°C</span><CloudSun className="h-5 w-5 text-amber-500" /></div><div className="mt-2 flex justify-between text-xs text-slate-600"><span>Rain chance</span><strong>{f.rainChance ?? "—"}%</strong></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(0, Math.min(100, Number(f.rainChance) || 0))}%` }} /></div>{f.rainfall != null && <p className="mt-2 text-xs text-slate-500">Expected rain: {f.rainfall} mm</p>}{f.alerts?.length > 0 && <p className="mt-2 text-xs font-medium text-amber-700">{f.alerts.join(" · ")}</p>}</CardContent></Card>)}
            </div>
          </section>
        </>
      )}

      <section className="space-y-3">
        <div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Snowflake className="h-5 w-5 text-sky-700" /> Perishable stock and storage</h2><p className="text-sm text-slate-500">Your listed product stock and practical storage precautions.</p></div>
        {stockLoading ? <Card><CardContent className="p-5 text-sm text-slate-500">Loading your stock…</CardContent></Card> : stockError ? <Card><CardContent className="p-5 text-sm text-amber-700">Stock information is temporarily unavailable. Check the Inventory page for current quantities.</CardContent></Card> : products.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {products.slice(0, 8).map((p: any) => {
              const guide = cropStorage(p.product_name || "");
              const low = Number(p.available_stock) > 0 && Number(p.available_stock) <= 5;
              return <Card key={p.product_id} className="shadow-none"><CardContent className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-slate-900">{p.product_name}</p><p className="text-xs text-slate-500">Available quantity</p></div><div className="text-right"><p className="text-lg font-bold">{p.available_stock} {p.unit || "kg"}</p><Badge className={p.is_out_of_stock ? "bg-rose-100 text-rose-800" : low ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>{p.is_out_of_stock ? "Out of stock" : low ? "Low stock" : "In stock"}</Badge></div></div><div className="mt-3 rounded-lg bg-sky-50 p-3"><p className="text-xs font-semibold text-sky-900">Storage temperature / condition</p><p className="mt-1 text-sm text-slate-800">{guide.range}</p><p className="mt-1 text-xs leading-5 text-slate-600">{guide.tip}</p></div></CardContent></Card>;
            })}
          </div>
        ) : <Card><CardContent className="p-5 text-sm text-slate-600">No product stock is currently listed. Add products and stock in Inventory to see them here.</CardContent></Card>}
        <p className="text-xs text-slate-500">Storage ranges are general guidance and vary by variety, maturity, packaging and storage duration. Confirm the correct conditions with local agricultural or post-harvest guidance.</p>
      </section>

      <section className="space-y-3">
        <div><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Truck className="h-5 w-5 text-emerald-700" /> Delivery and transport precautions</h2><p className="text-sm text-slate-500">Use weather warnings to protect produce while it is being moved.</p></div>
        {data ? (
          <Card className="shadow-none"><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="flex gap-2"><ShieldCheck className="h-5 w-5 shrink-0 text-emerald-700" /><div><p className="text-sm font-semibold text-slate-900">Protect produce from heat</p><p className="text-sm text-slate-600">Keep harvested produce shaded, ventilated and out of direct sunlight while waiting for pickup.</p></div></div>
            <div className="flex gap-2"><CloudRain className="h-5 w-5 shrink-0 text-sky-700" /><div><p className="text-sm font-semibold text-slate-900">Protect from rain</p><p className="text-sm text-slate-600">{(weather.rainChance ?? 0) >= 60 ? "Rain is likely during the forecast period. Use clean waterproof covers without trapping heat or moisture." : "Keep crates covered during unexpected rain and avoid leaving produce in standing water."}</p></div></div>
            <div className="flex gap-2"><Truck className="h-5 w-5 shrink-0 text-slate-700" /><div><p className="text-sm font-semibold text-slate-900">Move delicate produce carefully</p><p className="text-sm text-slate-600">Use clean crates, avoid over-stacking and separate bruised or damaged items.</p></div></div>
            <div className="flex gap-2"><Snowflake className="h-5 w-5 shrink-0 text-sky-700" /><div><p className="text-sm font-semibold text-slate-900">Use cooling when required</p><p className="text-sm text-slate-600">Arrange suitable cooling for crops that need a cold chain; do not assume every crop should be stored at the same temperature.</p></div></div>
          </CardContent></Card>
        ) : <Card><CardContent className="p-4 text-sm text-slate-600">Check the weather above to receive location-specific transport precautions. General advice: shade produce, use clean crates and avoid delays after harvest.</CardContent></Card>}
      </section>

      <p className="text-xs leading-5 text-slate-500">Weather data source: Open-Meteo. Forecasts are estimates and may change. Alerts are based on general crop-weather thresholds, not a farm inspection or plant-disease diagnosis. Check local conditions before spraying, irrigating or harvesting.</p>
    </div>
  );
}
