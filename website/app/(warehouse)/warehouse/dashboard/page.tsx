"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Warehouse,
  Package,
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Truck,
  ClipboardCheck,
  Boxes,
  PackageCheck,
  ArrowRight,
  Route,
  ShieldAlert,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { WarehousePageHeader } from "../../../components/warehouse/warehouse-page-header";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function WarehouseDashboardPage() {
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");
  const { data: dashboardData, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["warehouseDashboard", period],
    queryFn: () => api.get(`/warehouse/me/dashboard?period=${period}`),
    refetchInterval: 60000,
  });

  const dashboard = dashboardData?.data ?? dashboardData ?? {};
  const warehouse = dashboard.warehouse ?? {};
  const summary = dashboard.stockSummary ?? {};
  const inventoryData = Array.isArray(dashboard.inventoryFlow) ? dashboard.inventoryFlow : [];
  const categoryData = Array.isArray(dashboard.stockByCategory) ? dashboard.stockByCategory : [];
  const recentActivities = Array.isArray(dashboard.recentActivities) ? dashboard.recentActivities : [];
  const lowStockItems = Array.isArray(dashboard.lowStockItems) ? dashboard.lowStockItems : [];
  const capacityUtilization = Number(dashboard.capacityUtilization ?? 0);
  const coldStorageUtilization = Number(dashboard.coldStorageUtilization ?? 0);
  const usedCapacity = Number(warehouse.usedCapacity ?? 0);
  const totalCapacity = Number(warehouse.totalCapacity ?? 0);
  const coldStorageUsed = Number(warehouse.coldStorageUsed ?? 0);
  const coldStorageCapacity = Number(warehouse.coldStorageCapacity ?? 0);


  const operations = [
    { title: "Farm collections", description: "Assign teams and collect produce from farms", href: "/warehouse/collections", icon: Truck },
    { title: "Incoming stock", description: "Receive and verify arriving stock", href: "/warehouse/incoming", icon: ArrowDown },
    { title: "Quality inspections", description: "Review produce and inspection evidence", href: "/warehouse/quality-inspection", icon: ClipboardCheck },
    { title: "Packing & fulfillment", description: "Prepare and verify customer orders", href: "/warehouse/packing", icon: Boxes },
    { title: "Outgoing dispatch", description: "Manage ready and dispatched shipments", href: "/warehouse/outgoing", icon: PackageCheck },
    { title: "Warehouse transfers", description: "Track inter-warehouse movement", href: "/warehouse/transfers", icon: Route },
    { title: "B2B fulfillment", description: "Process business orders and deliveries", href: "/warehouse/b2b-fulfillment", icon: Warehouse },
    { title: "Farmer fulfillment", description: "Handle farmer-packed fulfillment orders", href: "/warehouse/farmer-fulfillment", icon: Package },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[1,2,3,4].map((i)=><div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}</div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="warehouse-dashboard-page space-y-7">
      <WarehousePageHeader
        eyebrow="Warehouse overview"
        title="Warehouse Dashboard"
        description="Monitor inventory, storage capacity and today's warehouse operations."
        meta={<span>{warehouse.name || "Warehouse"} • {capacityUtilization}% capacity used</span>}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="selection-control flex rounded-lg border">
              {(["week","month","year"] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)} className={cn("selection-item rounded-md px-3 py-1.5 text-sm font-medium", period === p ? "selection-item-active" : "selection-item-inactive")}>{p.charAt(0).toUpperCase() + p.slice(1)}</button>
              ))}
            </div>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh dashboard"><RefreshCw className="h-4 w-4" /></Button>
          </div>
        }
      />

      {isError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <span>Dashboard data could not be loaded. Values may be unavailable until the connection is restored.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      <section aria-labelledby="warehouse-operations-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="warehouse-operations-title" className="text-xl font-semibold tracking-tight">Today's operations</h2>
            <p className="mt-1 text-sm text-muted-foreground">Open the existing workflow to review its live queue and take action.</p>
          </div>
          <span className="text-xs text-muted-foreground">Dashboard refreshes every 60 seconds</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {operations.map((operation) => (
            <Link key={operation.href} href={operation.href} className="group flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
              <div className="shrink-0 rounded-lg bg-emerald-50 p-2.5 text-emerald-700"><operation.icon className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold">{operation.title}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{operation.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="warehouse-attention-title" className="space-y-3">
        <div>
          <h2 id="warehouse-attention-title" className="text-xl font-semibold tracking-tight">Attention required</h2>
          <p className="mt-1 text-sm text-muted-foreground">Warnings supported by current inventory and capacity data.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Link href="/warehouse/stock" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-amber-300">
            <ShieldAlert className={lowStockItems.length ? "h-5 w-5 text-amber-600" : "h-5 w-5 text-emerald-600"} />
            <div><p className="text-sm font-semibold">Low-stock items</p><p className="text-xs text-muted-foreground">{isError ? "Unavailable" : `${lowStockItems.length} shown in dashboard`}</p></div>
            <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
          </Link>
          <Link href="/warehouse/settings" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-amber-300">
            <Warehouse className={totalCapacity > 0 && capacityUtilization >= 90 ? "h-5 w-5 text-amber-600" : "h-5 w-5 text-emerald-600"} />
            <div><p className="text-sm font-semibold">Warehouse capacity</p><p className="text-xs text-muted-foreground">{isError ? "Unavailable" : totalCapacity <= 0 ? "Capacity not configured" : `${capacityUtilization.toFixed(1)}% used`}</p></div>
            <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
          </Link>
          <Link href="/warehouse/cold-storage" className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-amber-300">
            <AlertTriangle className={coldStorageCapacity > 0 && coldStorageUtilization >= 90 ? "h-5 w-5 text-amber-600" : "h-5 w-5 text-emerald-600"} />
            <div><p className="text-sm font-semibold">Cold storage</p><p className="text-xs text-muted-foreground">{isError ? "Unavailable" : coldStorageCapacity <= 0 ? "Capacity not configured" : `${coldStorageUtilization.toFixed(1)}% used`}</p></div>
            <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
          </Link>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Total Stock Items", value: String(summary.totalItems ?? 0), change: "", icon: Package, color: "text-blue-600" },
          { title: "Stock Value", value: `₹${Number(summary.totalValue ?? 0).toLocaleString("en-IN")}`, change: "", icon: Warehouse, color: "text-green-600" },
          { title: "Incoming Today", value: String(dashboard.incomingToday ?? 0), change: "", icon: ArrowDown, color: "text-purple-600" },
          { title: "Outgoing Today", value: String(dashboard.outgoingToday ?? 0), change: "", icon: ArrowUp, color: "text-orange-600" },
        ].map((stat, index) => (
          <Card key={index} className="wh-dashboard-kpi"><CardContent className="p-5"><div className="flex items-center justify-between"><div className="space-y-1"><p className="text-sm text-muted-foreground">{stat.title}</p><p className="text-2xl font-bold">{stat.value}</p></div><div className={cn("rounded-full p-2 bg-muted", stat.color)}><stat.icon className="h-5 w-5" /></div></div>{stat.change && <div className="mt-2 text-sm text-muted-foreground">{stat.change}</div>}</CardContent></Card>
        ))}
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-3">
        <Card className="wh-dashboard-panel min-w-0 xl:col-span-2">
          <CardHeader><CardTitle>Inventory Flow</CardTitle><CardDescription>Received vs Dispatched items</CardDescription></CardHeader>
          <CardContent>
            {inventoryData.length > 0 ? (
            <div className="h-[300px] min-w-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={inventoryData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Area type="monotone" dataKey="received" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorReceived)" /><Area type="monotone" dataKey="dispatched" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorDispatched)" /><defs><linearGradient id="colorReceived" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient><linearGradient id="colorDispatched" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs></AreaChart></ResponsiveContainer></div>
          ) : (
            <div className="flex h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center">
              <Package className="h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No inventory movement yet</p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Received and dispatched activity will appear here when stock movements are recorded.</p>
            </div>
          )}
          </CardContent>
        </Card>

        <Card className="wh-dashboard-panel min-w-0">
          <CardHeader><CardTitle>Stock by Category</CardTitle><CardDescription>Distribution of inventory</CardDescription></CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <>
                <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">{categoryData.map((entry,index)=><Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div>
            <div className="mt-4 grid grid-cols-2 gap-2">{categoryData.map((item,index)=><div key={item.name} className="flex items-center gap-2 text-sm"><div className={cn("h-3 w-3 rounded-full", index === 0 && "bg-green-500", index === 1 && "bg-blue-500", index === 2 && "bg-yellow-500", index === 3 && "bg-red-500")} /><span>{item.name}</span><span className="ml-auto font-medium">{item.value}%</span></div>)}</div>
              </>
            ) : (
              <div className="flex h-[250px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center">
                <Package className="h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-700">No category data available</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Stock distribution will appear here when inventory is available.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <Card className="wh-dashboard-panel">
          <CardHeader><CardTitle>Capacity Utilization</CardTitle><CardDescription>Storage space usage</CardDescription></CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-700">Total warehouse capacity</span><span className="font-semibold tabular-nums text-slate-900">{usedCapacity.toLocaleString("en-IN")} / {totalCapacity > 0 ? totalCapacity.toLocaleString("en-IN") : "—"}</span></div>
                <Progress value={capacityUtilization} className="mt-3 h-2.5" />
                <p className="mt-2 text-xs text-muted-foreground">{capacityUtilization.toFixed(1)}% used · {totalCapacity > 0 ? Math.max(0, totalCapacity - usedCapacity).toLocaleString("en-IN") : "Capacity not configured"} available</p>
              </div>
              <div className="border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-700">Cold storage</span><span className="font-semibold tabular-nums text-slate-900">{coldStorageUsed.toLocaleString("en-IN")} / {coldStorageCapacity > 0 ? coldStorageCapacity.toLocaleString("en-IN") : "—"}</span></div>
                <Progress value={coldStorageUtilization} className="mt-3 h-2.5" />
                <p className="mt-2 text-xs text-muted-foreground">{coldStorageCapacity > 0 ? coldStorageUtilization.toFixed(1) + "% used" : "Cold storage capacity not configured"}</p>
              </div>
              <div className="rounded-xl bg-emerald-50/80 p-4"><div className="flex items-center justify-between text-sm"><span className="font-medium text-emerald-900">Overall utilization</span><span className="text-lg font-bold tabular-nums text-emerald-800">{capacityUtilization.toFixed(1)}%</span></div></div>
            </div>
          </CardContent>
        </Card>

        <Card className="wh-dashboard-panel">
          <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Recent Activities</CardTitle><CardDescription>Latest warehouse operations</CardDescription></div><Button asChild variant="ghost" size="sm"><Link href="/warehouse/activities">View All</Link></Button></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivities.length ? recentActivities.map((activity: any, index: number) => {
                const status = String(activity.status || activity.stage || "").toLowerCase();
                const action = activity.action || activity.title || activity.type || "Warehouse activity";
                const item = activity.item || activity.productName || activity.description || "Activity details unavailable";
                const quantity = activity.quantity != null ? String(activity.quantity) + " " + (activity.unit || "units") : "";
                const time = activity.createdAt || activity.timestamp || activity.updatedAt;
                return <div key={String(activity.id || activity._id || index)} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
                  <div className={cn("rounded-xl p-2.5", ["completed","received","passed"].includes(status) ? "bg-emerald-50 text-emerald-700" : ["failed","rejected"].includes(status) ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>{["completed","received","passed"].includes(status) ? <CheckCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{action}</p><p className="truncate text-xs text-slate-500">{item}{quantity ? " · " + quantity : ""}</p></div>
                  <div className="whitespace-nowrap text-xs text-slate-400">{time ? new Date(time).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Time unavailable"}</div>
                </div>;
              }) : <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-9 text-center"><Clock className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-semibold text-slate-700">No recent activity recorded</p><p className="mt-1 text-xs text-slate-500">Warehouse actions will appear here when activity history is available.</p></div>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="wh-dashboard-panel">
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />Stock attention</CardTitle><CardDescription>Live items below their configured stock threshold</CardDescription></div>
          <Badge variant={lowStockItems.length ? "warning" : "success"}>{lowStockItems.length} items</Badge>
        </CardHeader>
        <CardContent>
          {lowStockItems.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{lowStockItems.map((item: any, index: number) => {
            const name = item.productName || item.product?.name || item.name || "Stock item";
            const quantity = Number(item.quantity || 0);
            const minimum = Number(item.minimumStock || item.reorderLevel || item.minStock || 0);
            const out = quantity <= 0 || String(item.status || "").toLowerCase() === "out_of_stock";
            return <div key={String(item.id || item._id || index)} className="rounded-xl border border-amber-100 bg-amber-50/60 p-4"><div className="flex items-start justify-between gap-2"><p className="font-semibold text-slate-800">{name}</p><Badge variant={out ? "destructive" : "warning"}>{out ? "Out of stock" : "Low stock"}</Badge></div><p className="mt-3 text-sm text-slate-600">Available: <strong className="tabular-nums text-slate-900">{quantity}</strong>{minimum > 0 ? " · Reorder level " + minimum : ""}</p></div>;
          })}</div> : <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center"><CheckCircle className="mx-auto h-7 w-7 text-emerald-500" /><p className="mt-2 text-sm font-semibold text-slate-700">Stock levels look healthy</p><p className="mt-1 text-xs text-slate-500">No low-stock or out-of-stock items were returned by inventory.</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}
