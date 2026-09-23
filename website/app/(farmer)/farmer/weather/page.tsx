"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CloudSun, CloudRain, Wind, Thermometer, Loader2, Search, AlertTriangle, Snowflake } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";

const CROPS = ["Tomato", "Onion", "Potato", "Carrot", "Strawberry", "Spinach", "Capsicum"];

export default function FarmerWeatherPage() {
  const [location, setLocation] = useState("Coimbatore");
  const [crop, setCrop] = useState("Tomato");

  const weatherMutation = useMutation({
    mutationFn: () =>
      api.post("/ai/weather-impact", {
        location: { city: location, state: "Tamil Nadu", country: "India" },
        productId: null,
        days: 5,
      }),
    onError: (err: any) => toast.error(err?.message || "Failed to load weather data"),
  });

  const { data: stockData } = useQuery({
    queryKey: ["farmerWeatherStock"],
    queryFn: () => api.get("/inventory/farmer/summary"),
    retry: 1,
  });

  const run = () => weatherMutation.mutate();
  const data = weatherMutation.data as any;
  const weather = data?.weather || {};
  const forecast = data?.forecast || [];

  const impactColor = (score: number) =>
    score >= 70 ? "bg-amber-100 text-amber-800" : score >= 40 ? "bg-yellow-100 text-yellow-800" : "bg-emerald-100 text-emerald-800";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Weather &amp; Perishability</h1>
        <p className="text-gray-500">
          Weather impact on your crops plus recommended storage for perishable stock.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudSun className="h-5 w-5 text-sky-600" />
            Weather Impact Analysis
          </CardTitle>
          <CardDescription>Check how upcoming weather affects your harvest and deliveries.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Location</label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Coimbatore" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Crop (for guidance)</label>
            <Select value={crop} onValueChange={setCrop}>
              <SelectContent>
                {CROPS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button onClick={run} disabled={weatherMutation.isPending}>
              {weatherMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Check Weather
            </Button>
          </div>
        </CardContent>
      </Card>

      {weatherMutation.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Thermometer className="h-4 w-4 text-amber-600" /> Current
                </div>
                <p className="mt-1 text-2xl font-bold">{weather?.temperature ?? "—"}°C</p>
                <p className="text-xs text-gray-400">{weather?.condition || "—"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <CloudRain className="h-4 w-4 text-sky-600" /> Rain forecast
                </div>
                <p className="mt-1 text-2xl font-bold">{weather?.rainChance ?? "—"}%</p>
                <p className="text-xs text-gray-400">next {forecast.length || 5} days</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Wind className="h-4 w-4 text-slate-500" /> Wind
                </div>
                <p className="mt-1 text-2xl font-bold">{weather?.windSpeed ?? "—"} km/h</p>
                <p className="text-xs text-gray-400">{weather?.humidity != null ? `${weather.humidity}% humidity` : ""}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Impact on {crop}</CardTitle>
              <CardDescription>{data?.location} · next 5 days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm text-gray-600">Impact score</span>
                <Badge className={impactColor(data?.impactScore ?? 0)}>
                  {(Number(data?.impactScore) * 100).toFixed(0)}%
                </Badge>
              </div>
              {data?.recommendation && (
                <p className={cn("rounded-lg p-3 text-sm", (data.impactScore ?? 0) >= 0.7 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800")}>
                  <AlertTriangle className="mr-1 inline h-4 w-4" />
                  {data.recommendation}
                </p>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {forecast.map((f: any, i: number) => (
                  <div key={i} className="rounded-lg border p-3">
                    <p className="text-xs font-medium text-gray-500">{f.date || `Day ${i + 1}`}</p>
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1">
                        {f.condition?.includes("rain") || f.rainChance > 50
                          ? <CloudRain className="h-4 w-4 text-sky-500" />
                          : <CloudSun className="h-4 w-4 text-amber-500" />}
                        {f.condition || "—"}
                      </span>
                      <span className="font-semibold">{f.temp}°C</span>
                    </div>
                    {f.rainChance != null && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-sky-500" style={{ width: `${f.rainChance}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="border-blue-200 bg-gradient-to-b from-blue-50/60 to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Snowflake className="h-5 w-5 text-blue-600" />
            Perishable Stock &amp; Storage Guidance
          </CardTitle>
          <CardDescription>Batches close to expiry get priority. Keep fragile produce cool.</CardDescription>
        </CardHeader>
        <CardContent>
          {(stockData as any)?.data?.products?.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {(stockData as any).data.products.slice(0, 6).map((p: any) => (
                <div key={p.product_id} className="flex items-center justify-between rounded-lg border bg-white p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <CloudSun className="h-4 w-4 text-sky-500" />
                    <span className="font-medium">{p.product_name}</span>
                    {p.is_out_of_stock && <Badge variant="destructive" className="px-1.5 text-[10px]">OOS</Badge>}
                  </div>
                  <span className={cn("font-medium", p.available_stock <= 5 ? "text-amber-600" : "text-emerald-700")}>
                    {p.available_stock} {p.unit || "kg"} avail
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No live stock data available.</p>
          )}
          <div className="mt-4 rounded-lg border border-dashed p-3 text-xs text-gray-500">
            <span className="font-medium text-blue-700">Storage guidance:</span> Strawberries 2–4°C · Leafy greens 0–2°C · Tomatoes 10–12°C. Use Cold Storage for anything that needs to last &gt;3 days.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}