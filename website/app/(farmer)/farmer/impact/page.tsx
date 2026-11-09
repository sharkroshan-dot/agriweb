"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  IndianRupee,
  Users,
  Truck,
  Store,
  MapPin,
  Wheat,
  Sparkles,
  CalendarDays,
  Download,
  FileDown,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";

function Stat({ icon: Icon, label, value, color = "text-emerald-600" }: any) {
  return (
    <Card className="h-full">
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
          </div>
          <div className={`shrink-0 rounded-full bg-gray-100 p-2 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string): string {
  const [, m] = key.split("-").map(Number);
  return m >= 1 && m <= 12 ? MONTHS[m - 1] : key;
}

function fmtINR(v: number): string {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
  return `₹${Math.round(v)}`;
}

const PIE_COLORS = ["#10b981", "#f59e0b", "#6366f1"];

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function downloadImpactCsv(data: any, startDate: string, endDate: string) {
  const rows = [
    ["Farm Impact Report"],
    ["Period", startDate, "to", endDate],
    ["Metric", "Value"],
    ["Completed orders", data.orders ?? 0],
    ["Direct sales", data.totalSpent ?? 0],
    ["Unique customers", data.uniqueCustomers ?? 0],
    ["New customers", data.newCustomers ?? 0],
    ["Repeat customers", data.repeatCustomers ?? 0],
    ["Local deliveries", data.localDeliveries ?? 0],
    ["Farm pickups", data.pickupOrders ?? 0],
    ["Community deliveries", data.communityDeliveries ?? 0],
    ["Delivered volume (kg)", data.deliveredKg ?? 0],
    ["Orders in progress (separate)", data.ordersInProgress ?? 0],
    ["Recorded delivery distance (km)", data.recordedDeliveryDistanceKm ?? 0],
    [],
    ["Month", "Sales", "Orders", "Delivered volume (kg)"],
    ...(data.monthlyTrend || []).map((item: any) => [item.label, item.sales ?? 0, item.orders ?? 0, item.kg ?? 0]),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `farm-impact-${startDate}-to-${endDate}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FarmerImpactPage() {
  const today = new Date();
  const initialEnd = toISODate(today);
  const initialStartDate = new Date(today);
  initialStartDate.setDate(initialStartDate.getDate() - 29);
  const [period, setPeriod] = useState("30d");
  const [startDate, setStartDate] = useState(toISODate(initialStartDate));
  const [endDate, setEndDate] = useState(initialEnd);

  const setPreset = (value: string) => {
    const end = new Date();
    const start = new Date(end);
    if (value === "7d") start.setDate(start.getDate() - 6);
    else if (value === "30d") start.setDate(start.getDate() - 29);
    else if (value === "90d") start.setDate(start.getDate() - 89);
    else if (value === "year") start.setMonth(0, 1);
    setPeriod(value);
    if (value !== "custom") {
      setStartDate(toISODate(start));
      setEndDate(toISODate(end));
    }
  };

  const { data: impactData, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["impact", "me", startDate, endDate],
    queryFn: () => api.get(`/impact/me?start_date=${startDate}&end_date=${endDate}`),
    enabled: Boolean(startDate && endDate && startDate <= endDate),
  });

  if (isLoading) {
    return (
      <div className="space-y-5 pb-8">
        <FarmerPageHeader title="Farm Impact" description="Your verified sales, customer reach and delivery performance." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const d = impactData?.data ?? {};
  const dateRangeInvalid = Boolean(startDate && endDate && startDate > endDate);

  const trend: any[] = (d.monthlyTrend || []).map((t: any) => ({
    ...t,
    label: monthLabel(t.label),
  }));

  const breakdown = d.deliveryBreakdown || {};
  const pieData = [
    { name: "Local deliveries", value: breakdown.local ?? 0, color: PIE_COLORS[0] },
    { name: "Farm pickups", value: breakdown.pickup ?? 0, color: PIE_COLORS[1] },
    { name: "Community deliveries", value: breakdown.community ?? 0, color: PIE_COLORS[2] },
  ].filter((s) => s.value > 0);

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <FarmerPageHeader
        title="Farm Impact"
        description="Track verified sales, customer reach, completed deliveries and produce volume."
      />

      <Card className="rounded-xl border-slate-200 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CalendarDays className="h-4 w-4 text-emerald-700" /> Reporting period
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["7d", "Last 7 days"],
                ["30d", "Last 30 days"],
                ["90d", "Last 90 days"],
                ["year", "This year"],
                ["custom", "Custom"],
              ].map(([value, label]) => (
                <button key={value} type="button" onClick={() => setPreset(value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${period === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              From
              <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => { setStartDate(event.target.value); setPeriod("custom"); }} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              To
              <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => { setEndDate(event.target.value); setPeriod("custom"); }} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800" />
            </label>
            <button type="button" onClick={() => refetch()} disabled={dateRangeInvalid || isFetching} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </CardContent>
      </Card>
      {dateRangeInvalid && <p className="text-sm text-red-600">The start date must be on or before the end date.</p>}
      {isError && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-red-700">We couldn't load your impact report. Please try again.</p>
            <button onClick={() => refetch()} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-red-700 shadow-sm">Try again</button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Verified impact summary</h2>
          <p className="text-sm text-slate-500">Only completed and picked-up orders are included in these totals.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => downloadImpactCsv(d, startDate, endDate)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">
            <FileDown className="h-4 w-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Stat icon={IndianRupee} label="Direct sales" value={formatPrice(d.totalSpent ?? 0)} color="text-green-600" />
        <Stat icon={Users} label="Unique customers served" value={d.uniqueCustomers ?? 0} color="text-blue-600" />
        <Stat icon={Truck} label="Local deliveries" value={d.localDeliveries ?? 0} color="text-emerald-600" />
        <Stat icon={Store} label="Farm pickups" value={d.pickupOrders ?? 0} color="text-purple-600" />
        <Stat icon={MapPin} label="Community deliveries" value={d.communityDeliveries ?? 0} color="text-amber-600" />
        <Stat icon={Wheat} label="Delivered volume" value={`${d.deliveredKg ?? 0} kg`} color="text-teal-600" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat icon={Users} label="New customers" value={d.newCustomers ?? 0} color="text-cyan-600" />
        <Stat icon={Users} label="Repeat customers" value={d.repeatCustomers ?? 0} color="text-indigo-600" />
      </div>

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-6">
          <CardTitle className="text-lg font-semibold text-slate-900">Sales &amp; orders — last 6 months</CardTitle>
          <CardDescription className="mt-1 text-sm text-slate-500">Verified delivered orders per month.</CardDescription>
        </CardHeader>
        <CardContent className="p-5 sm:p-6">
          {trend.length ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} />
                  <YAxis yAxisId="sales" tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(v: number) => fmtINR(v)} width={56} />
                  <YAxis yAxisId="orders" orientation="right" allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} width={36} />
                  <Tooltip
                    formatter={(value: any, name: any) => {
                      if (name === "sales") return [fmtINR(Number(value)), "Sales"];
                      if (name === "orders") return [value, "Orders"];
                      return [value, name];
                    }}
                    labelStyle={{ color: "#0f172a", fontWeight: 600 }}
                  />
                  <Legend />
                  <Bar yAxisId="orders" dataKey="orders" name="Orders" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={22} />
                  <Area yAxisId="sales" type="monotone" dataKey="sales" name="Sales" stroke="#10b981" strokeWidth={2.5} fill="url(#salesGrad)" />
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-gray-400">No monthly data yet.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <CardTitle className="text-lg font-semibold text-slate-900">Delivered volume — last 6 months</CardTitle>
            <CardDescription className="mt-1 text-sm text-slate-500">Kilograms of produce delivered per month.</CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            {trend.length ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} />
                    <YAxis tick={{ fontSize: 12, fill: "#64748b" }} width={48} />
                    <Tooltip
                      formatter={(value: any) => [`${value} kg`, "Volume"]}
                      labelStyle={{ color: "#0f172a", fontWeight: 600 }}
                    />
                    <Bar dataKey="kg" name="Volume" fill="#14b8a6" radius={[4, 4, 0, 0]} barSize={26} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-gray-400">No volume data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <CardTitle className="text-lg font-semibold text-slate-900">How your orders were fulfilled</CardTitle>
            <CardDescription className="mt-1 text-sm text-slate-500">Share of local deliveries, farm pickups and community deliveries.</CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            {pieData.length ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-5 sm:flex-row sm:gap-8">
                <div className="relative h-44 w-44 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3} stroke="none">
                        {pieData.map((s) => (
                          <Cell key={s.name} fill={s.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: any, name: any) => [value, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-2xl font-bold text-gray-800">{pieData.reduce((a, s) => a + s.value, 0)}</p>
                    <p className="text-sm leading-6 text-slate-500">orders</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {pieData.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 text-sm">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-gray-600">{s.name}</span>
                      <span className="ml-auto font-semibold text-gray-800">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-gray-400">No fulfilment data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Customer reach</CardTitle>
            <CardDescription>Customers with at least one completed order in the selected period.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-2">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">New customers</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{d.newCustomers ?? 0}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Repeat customers</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{d.repeatCustomers ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Delivery distance insights</CardTitle>
            <CardDescription>Distance values recorded on completed delivery orders only.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-2">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-sm text-emerald-800">Recorded delivery distance</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{d.recordedDeliveryDistanceKm ?? 0} km</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Average per local delivery</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{d.averageDeliveryDistanceKm ?? 0} km</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-amber-200 bg-amber-50/60 shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-base font-semibold text-slate-900">Orders currently in progress</p>
            <p className="mt-1 text-sm text-slate-600">Shown separately and excluded from completed impact totals.</p>
          </div>
          <p className="text-3xl font-bold text-amber-700">{d.ordersInProgress ?? 0}</p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-emerald-200 bg-gradient-to-r from-emerald-50/70 to-white shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-base font-semibold text-slate-900">Delivery impact</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {d.recordedDeliveryDistanceKm != null
                  ? "Based on recorded delivery distances. No estimated carbon or environmental savings are claimed."
                  : "Distance savings are shown only where the customer impact calculation supports them."}
              </p>
            </div>
          </div>
          <p className="text-3xl font-bold tracking-tight text-emerald-700">
            {d.recordedDeliveryDistanceKm != null ? `${d.recordedDeliveryDistanceKm} km` : `${d.estimatedDistanceSavedKm ?? 0} km`}
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        {d.disclaimer || "Metrics are computed from delivered orders only."} No unverifiable environmental claims are made.
      </p>
    </div>
  );
}