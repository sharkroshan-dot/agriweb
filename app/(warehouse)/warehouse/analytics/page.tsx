"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Boxes, RefreshCw, Snowflake, TrendingUp, Warehouse } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Progress } from "../../../components/ui/progress";
import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";

const stockStatusLabels: Record<string, string> = {
  in_stock: "In Stock",
  low_stock: "Low Stock",
  out_of_stock: "Out of Stock",
  expired: "Expired",
  reserved: "Reserved",
};

export default function WarehouseAnalyticsPage() {
  const [period, setPeriod] = useState<"week" | "month" | "year">("month");

  const dashboardQuery = useQuery({
    queryKey: ["warehouseAnalyticsDashboard", period],
    queryFn: () => api.get(`/warehouse/me/dashboard?period=${period}`),
  });

  const stockQuery = useQuery({
    queryKey: ["warehouseAnalyticsStock"],
    queryFn: () => api.get("/warehouse/me/stock", { params: { limit: 100 } }),
  });

  const incomingQuery = useQuery({
    queryKey: ["warehouseAnalyticsIncoming"],
    queryFn: () => api.get("/warehouse/me/incoming", { params: { limit: 100, date: period === "week" ? "week" : period === "month" ? "month" : "all" } }),
  });

  const outgoingQuery = useQuery({
    queryKey: ["warehouseAnalyticsOutgoing"],
    queryFn: () => api.get("/warehouse/me/outgoing", { params: { limit: 100 } }),
  });

  const coldStorageQuery = useQuery({
    queryKey: ["warehouseAnalyticsColdStorage"],
    queryFn: () => api.get("/warehouse/me/cold-storage", { params: { limit: 100 } }),
  });

  const dashboard = dashboardQuery.data;
  const stockItems = stockQuery.data?.data?.stock || [];
  const incomingItems = incomingQuery.data?.data?.incoming || [];
  const outgoingItems = outgoingQuery.data?.data?.outgoing || [];
  const coldStorageItems = coldStorageQuery.data?.data?.coldStorage || [];
  const isLoading = dashboardQuery.isLoading || stockQuery.isLoading || incomingQuery.isLoading || outgoingQuery.isLoading || coldStorageQuery.isLoading;

  const stockTotals = useMemo(() => {
    return stockItems.reduce(
      (totals: any, item: any) => {
        const quantity = Number(item.quantity || 0);
        totals.quantity += quantity;
        totals.reserved += Number(item.reservedQuantity || 0);
        totals.byStatus[item.status || "in_stock"] = (totals.byStatus[item.status || "in_stock"] || 0) + 1;
        totals.byStorage[item.storageType || "ambient"] = (totals.byStorage[item.storageType || "ambient"] || 0) + quantity;
        return totals;
      },
      { quantity: 0, reserved: 0, byStatus: {}, byStorage: {} }
    );
  }, [stockItems]);

  const flowData = useMemo(() => {
    const buckets = ["Scheduled", "In Transit", "Received", "Stored", "Rejected"];
    return buckets.map((label) => {
      const key = label.toLowerCase().replaceAll(" ", "_");
      return {
        name: label,
        incoming: incomingItems.filter((item: any) => item.status === key).length,
        outgoing: outgoingItems.filter((item: any) => item.status === key || (label === "Stored" && item.status === "packed")).length,
      };
    });
  }, [incomingItems, outgoingItems]);

  const storageData = Object.entries(stockTotals.byStorage).map(([name, quantity]) => ({
    name: String(name).replaceAll("_", " "),
    quantity,
  }));

  const refreshAll = () => {
    dashboardQuery.refetch();
    stockQuery.refetch();
    incomingQuery.refetch();
    outgoingQuery.refetch();
    coldStorageQuery.refetch();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Warehouse Analytics</h1>
          <p className="text-muted-foreground">Stock movement, capacity usage, and operational performance.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-1">
            {(["week", "month", "year"] as const).map((item) => (
              <button key={item} onClick={() => setPeriod(item)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", period === item ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={refreshAll}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { title: "Total Quantity", value: stockTotals.quantity, note: `${stockItems.length} stock lines`, icon: Boxes },
          { title: "Reserved", value: stockTotals.reserved, note: "Units held for orders", icon: TrendingUp },
          { title: "Incoming", value: incomingItems.length, note: `${dashboard?.incomingToday || 0} due today`, icon: ArrowDown },
          { title: "Outgoing", value: outgoingItems.length, note: `${dashboard?.outgoingToday || 0} today`, icon: ArrowUp },
        ].map((stat) => (
          <Card key={stat.title}><CardContent className="p-6"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{stat.title}</p><p className="mt-1 text-2xl font-bold">{stat.value}</p></div><div className="rounded-full bg-muted p-2 text-emerald-600"><stat.icon className="h-5 w-5" /></div></div><p className="mt-3 text-sm text-muted-foreground">{stat.note}</p></CardContent></Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Stock Flow</CardTitle><CardDescription>Incoming and outgoing work grouped by current status.</CardDescription></CardHeader>
          <CardContent>
            <div className="h-[320px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={flowData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="incoming" stroke="#16a34a" fill="#16a34a" fillOpacity={0.18} /><Area type="monotone" dataKey="outgoing" stroke="#2563eb" fill="#2563eb" fillOpacity={0.14} /></AreaChart></ResponsiveContainer></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Capacity</CardTitle><CardDescription>Live utilization from warehouse records.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <div><div className="flex justify-between text-sm"><span>General Storage</span><span className="font-medium">{Math.round(dashboard?.capacityUtilization || 0)}%</span></div><Progress value={dashboard?.capacityUtilization || 0} className="mt-2" /></div>
            <div><div className="flex justify-between text-sm"><span>Cold Storage</span><span className="font-medium">{Math.round(dashboard?.coldStorageUtilization || 0)}%</span></div><Progress value={dashboard?.coldStorageUtilization || 0} className="mt-2" /></div>
            <div className="rounded-lg border p-4"><div className="flex items-center gap-2"><Snowflake className="h-4 w-4 text-blue-600" /><span className="text-sm font-medium">Cold Storage Lines</span></div><p className="mt-2 text-2xl font-bold">{coldStorageItems.length}</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Storage Mix</CardTitle><CardDescription>Quantity by storage type.</CardDescription></CardHeader>
          <CardContent><div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={storageData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="quantity" fill="#0f766e" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Stock Status</CardTitle><CardDescription>Items grouped by availability.</CardDescription></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(stockStatusLabels).map(([status, label]) => {
                const count = stockTotals.byStatus[status] || 0;
                return (
                  <div key={status} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3"><Warehouse className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{label}</span></div>
                    <Badge variant={status === "low_stock" || status === "expired" ? "warning" : status === "out_of_stock" ? "destructive" : "outline"}>{count}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
