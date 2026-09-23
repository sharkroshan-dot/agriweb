"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Progress } from "../../components/ui/progress";
import { Snowflake, AlertTriangle, CheckCircle2, Droplets } from "lucide-react";
import { api } from "../../lib/api/client";
import { PageErrorState } from "../../components/common/page-state";

export default function ColdStoragePage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["warehouseColdStorage"],
    queryFn: () => api.get("/warehouse/me/cold-storage"),
  });

  const items = useMemo(() => {
    const raw = data?.data?.coldStorage || data?.coldStorage || [];
    return Array.isArray(raw) ? raw : [];
  }, [data]);

  if (isLoading) return <div className="space-y-4">{[1,2,3].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />)}</div>;
  if (isError) return <PageErrorState title="Unable to load cold storage" description="Live cold-storage records are unavailable. Retry to fetch the latest warehouse readings." retry={() => { void refetch(); }} />;

  return (
    <div className="space-y-6">
      <div><h1 className="text-3xl font-bold">Cold Storage</h1><p className="text-muted-foreground">Monitor temperature-sensitive inventory using current warehouse records.</p></div>
      {items.length === 0 ? (
        <Card><CardContent className="p-10 text-center"><Snowflake className="mx-auto h-10 w-10 text-slate-300" /><h2 className="mt-3 font-semibold">No cold-storage records</h2><p className="mt-1 text-sm text-slate-500">Add a cold-storage record when temperature-controlled stock is received.</p></CardContent></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {items.map((item: any) => {
            const current = Number(item.temperature);
            const optimal = item.optimalTemperature != null ? Number(item.optimalTemperature) : null;
            const humidity = item.humidity != null ? Number(item.humidity) : null;
            const optimalHumidity = item.optimalHumidity != null ? Number(item.optimalHumidity) : null;
            const healthy = (optimal == null || Math.abs(current - optimal) <= 2) && (optimalHumidity == null || humidity == null || Math.abs(humidity - optimalHumidity) <= 10);
            return (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3"><CardTitle>{item.productName || item.productId || "Cold-storage item"}</CardTitle><Badge variant={healthy ? "success" : "destructive"}>{healthy ? "Normal" : "Alert"}</Badge></div>
                  <CardDescription>{item.storageType || "chilled"} · {item.quantity ?? 0} units</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Temperature</p><p className="mt-1 text-xl font-semibold">{current}°C</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-1 text-xs text-slate-500"><Droplets className="h-3.5 w-3.5" />Humidity</p><p className="mt-1 text-xl font-semibold">{humidity != null ? `${humidity}%` : "—"}</p></div>
                  </div>
                  <div className="space-y-2"><div className="flex items-center justify-between text-xs text-slate-500"><span>Temperature target</span><span>{optimal != null ? `${optimal}°C` : "Not configured"}</span></div><Progress value={optimal == null ? 50 : Math.max(0, Math.min(100, 100 - Math.abs(current - optimal) * 20))} /></div>
                  <div className="flex items-center gap-2 text-sm">{healthy ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-red-600" />}<span className="text-slate-600">{healthy ? "Within configured storage range" : "Review temperature or humidity settings"}</span></div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
