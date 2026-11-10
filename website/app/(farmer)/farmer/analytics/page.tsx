"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  Star,
  Lightbulb,
  Banknote,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Download,
  Printer,
  Users,
  RefreshCw,
  AlertCircle,
  PackageCheck,
  CircleDollarSign,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { formatPrice } from "../../../lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

const STATUS_COLORS: Record<string, string> = {
  delivered: "#22c55e",
  pending: "#f59e0b",
  confirmed: "#3b82f6",
  processing: "#8b5cf6",
  ready_for_delivery: "#06b6d4",
  ready_for_pickup: "#06b6d4",
  dispatched: "#6366f1",
  in_transit: "#ec4899",
  cancelled: "#ef4444",
};




function exportAnalyticsCsv(data: any, range: string) {
  const rows: any[][] = [
    ["Metric", "Value"],
    ["Total revenue", data.totalRevenue ?? 0],
    ["Total orders", data.totalOrders ?? 0],
    ["Average order value", data.averageOrderValue ?? 0],
    ["Delivered orders", data.deliveredOrders ?? 0],
    ["Wallet balance", data.walletBalance ?? 0],
    ["Pending earnings", data.pendingEarnings ?? 0],
    [],
    ["Revenue trend", "Revenue", "Orders"],
    ...(data.revenueTrend ?? []).map((x: any) => [x.name ?? x.label ?? "", x.revenue ?? 0, x.orders ?? 0]),
    [],
    ["Top products", "Revenue", "Quantity", "Orders"],
    ...(data.topProducts ?? []).map((x: any) => [x.name ?? "", x.revenue ?? 0, x.quantity ?? x.unitsSold ?? 0, x.orders ?? x.orderCount ?? 0]),
    [],
    ["Stock", "Remaining", "Reserved"],
    ...(data.productStock ?? []).map((x: any) => [x.name ?? "", x.remaining ?? 0, x.reserved ?? 0]),
    [],
    ["Customer trend", "Customers", "Revenue"],
    ...(data.customerInsights?.monthlyTrend ?? []).map((x: any) => [x.month ?? "", x.customers ?? 0, x.revenue ?? 0]),
  ];
  const csv = rows.map((row) => row.map((cell) => '"' + String(cell ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "agriconnect-analytics-" + range + ".csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function FarmerAnalyticsPage() {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");

  const { data: metrics, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["farmerAnalytics", range],
    queryFn: () => api.get(`/farmers/me/analytics?range=${range}`),
  });

  const { data: aiInsightsData } = useQuery({
    queryKey: ["farmerAiInsightsAnalytics"],
    queryFn: () => api.get("/ai/farmer/insights"),
    retry: 1,
  });

  const data = (metrics as any)?.data ?? {};
  const revenueTrend = data.revenueTrend ?? [];
  const categoryData = data.categoryDistribution ?? [];
  const topProducts = data.topProducts ?? [];
  const productStock = data.productStock ?? [];
  const insights = data.insights ?? [];
  const harvest = data.harvestActivity ?? {};
  const orderStatus = Object.entries(data.orderStatusCounts ?? {}).map(([name, count]) => ({
    name,
    count,
  }));
  const aiInsights = (aiInsightsData as any)?.data ?? {};
  const aiDemand = aiInsights.demand ?? [];
  const aiPricing = aiInsights.pricing ?? [];
  const customerInsights = data.customerInsights ?? {};
  const customerTrend = customerInsights.monthlyTrend ?? [];
  const lowStock = productStock.filter((p: any) => Number(p.remaining ?? 0) <= 5);
  const hasSalesData = Number(data.totalOrders ?? 0) > 0 || Number(data.totalRevenue ?? 0) > 0;

  if (isLoading) {
    return <div className="w-full min-w-0 space-y-6 animate-pulse"><div className="h-20 rounded-2xl bg-slate-100" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-slate-100" />)}</div><div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-64 rounded-2xl bg-slate-100" />)}</div></div>;
  }

  if (isError) {
    return <div className="w-full min-w-0 space-y-4"><FarmerPageHeader title="Farm analytics" description="Understand your sales, customers, stock and farm performance." /><Card className="rounded-2xl border-red-200 bg-red-50/50 shadow-none"><CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 text-red-600" /><div><p className="font-semibold text-slate-900">Analytics could not be loaded</p><p className="mt-1 text-sm text-slate-600">Check your connection and try again. Your farm data has not been changed.</p></div></div><Button onClick={() => refetch()} disabled={isFetching}><RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} /> Try again</Button></CardContent></Card></div>;
  }

  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <FarmerPageHeader title="Farm analytics" description="Use demand, sales and fulfilment trends to decide what to grow, stock and deliver next.">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
            {[("7d" as const), ("30d" as const), ("90d" as const)].map((r) => (
              <Button key={r} variant={range === r ? "default" : "ghost"} size="sm" className={cn("h-8 rounded-lg px-3 text-xs", range === r ? "bg-emerald-700 text-white hover:bg-emerald-800" : "text-slate-600")} onClick={() => setRange(r)}>{r === "7d" ? "7 days" : r === "30d" ? "30 days" : "90 days"}</Button>
            ))}
          </div>
          <Button onClick={() => exportAnalyticsCsv(data, range)} variant="outline" size="sm"><Download className="mr-2 h-4 w-4" /> Export CSV</Button>
          <Button onClick={() => window.print()} variant="outline" size="sm"><Printer className="mr-2 h-4 w-4" /> Print / PDF</Button>
          <Button onClick={() => refetch()} disabled={isFetching} variant="outline" size="sm"><RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} /> Refresh</Button>
        </div>
      </FarmerPageHeader>

      {!hasSalesData && (
        <Card className="rounded-2xl border-dashed border-emerald-200 bg-emerald-50/40 shadow-none">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-semibold text-slate-900">Your analytics journey starts with your first order</p><p className="mt-1 text-sm text-slate-600">Add products, keep stock updated and share your listings. Sales, customer trends and forecasts will appear here as data becomes available.</p></div>
            <a href="/farmer/products" className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800">Manage products</a>
          </CardContent>
        </Card>
      )}

      {insights.length > 0 && (
        <Card className="rounded-2xl border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Lightbulb className="h-5 w-5 text-emerald-700" />
              Farm insights and recommended actions
            </CardTitle>
            <CardDescription>Practical next steps based on your sales, inventory and harvest activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {insights.map((i: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div>
                    <p className="font-medium">{i.title}</p>
                    <p className="text-sm text-gray-500">{i.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium text-slate-500">Total revenue</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{formatPrice(data.totalRevenue ?? 0)}</p></div><span className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Banknote className="h-5 w-5" /></span></CardContent></Card>
        <Card className="rounded-2xl border-slate-200/80 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium text-slate-500">Orders received</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{data.totalOrders ?? 0}</p></div><span className="rounded-xl bg-sky-50 p-3 text-sky-700"><TrendingUp className="h-5 w-5" /></span></CardContent></Card>
        <Card className="rounded-2xl border-slate-200/80 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium text-slate-500">Average order value</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{formatPrice(data.averageOrderValue ?? 0)}</p></div><span className="rounded-xl bg-violet-50 p-3 text-violet-700"><Wallet className="h-5 w-5" /></span></CardContent></Card>
        <Card className="rounded-2xl border-slate-200/80 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium text-slate-500">Delivered orders</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{data.deliveredOrders ?? 0}</p></div><span className="rounded-xl bg-amber-50 p-3 text-amber-700"><Star className="h-5 w-5" /></span></CardContent></Card>
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm">
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <div><p className="text-xs text-slate-500">Harvest plans</p><p className="mt-1 text-xl font-bold text-slate-900">{harvest.harvestPlans ?? data.harvestPlans ?? 0}</p></div>
          <div><p className="text-xs text-slate-500">Upcoming harvests</p><p className="mt-1 text-xl font-bold text-slate-900">{harvest.upcomingHarvests ?? data.upcomingHarvests ?? 0}</p></div>
          <div><p className="text-xs text-slate-500">Pre-orders booked</p><p className="mt-1 text-xl font-bold text-slate-900">{harvest.preOrders ?? data.preOrders ?? 0}</p></div>
          <div><p className="text-xs text-slate-500">Customers interested</p><p className="mt-1 text-xl font-bold text-slate-900">{harvest.notifyMe ?? data.notifyMe ?? 0}</p></div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900"><Users className="h-5 w-5 text-sky-700" /> Customer trends</CardTitle>
            <CardDescription>Understand how many customers buy from your farm and how many return.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Customers</p><p className="mt-1 text-xl font-bold text-slate-900">{customerInsights.uniqueCustomers ?? "—"}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Repeat buyers</p><p className="mt-1 text-xl font-bold text-slate-900">{customerInsights.repeatCustomers ?? "—"}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Repeat rate</p><p className="mt-1 text-xl font-bold text-slate-900">{customerInsights.repeatRate != null ? customerInsights.repeatRate + "%" : "—"}</p></div>
            </div>
            {customerTrend.length > 0 ? <div className="h-52"><ResponsiveContainer width="100%" height="100%"><LineChart data={customerTrend}><CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} /><Tooltip /><Line type="monotone" dataKey="customers" name="Customers" stroke="#0284c7" strokeWidth={3} dot={false} /></LineChart></ResponsiveContainer></div> : <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">Customer trends will appear when customer order history is available.</div>}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900"><PackageCheck className="h-5 w-5 text-amber-600" /> Stock alerts</CardTitle>
            <CardDescription>Products that may need replenishment before the next orders arrive.</CardDescription>
          </CardHeader>
          <CardContent>
            {lowStock.length > 0 ? <div className="space-y-2">{lowStock.slice(0, 6).map((p: any) => <div key={p.id || p.name} className="flex items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/50 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{p.name}</p><p className="text-xs text-slate-500">{p.reserved ?? 0} reserved</p></div><span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">{p.remaining ?? 0} remaining</span></div>)}</div> : <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">{productStock.length ? "No low-stock products right now." : "Stock alerts will appear when product stock is available."}</div>}
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-5 w-5 text-emerald-700" /> Payout overview</CardTitle>
          <CardDescription>Track money available to withdraw and payments still being processed. Total sales are shown above.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4"><p className="text-xs font-medium text-sky-800">Wallet balance</p><p className="mt-1 text-xl font-bold text-sky-900">{formatPrice(data.walletBalance ?? 0)}</p></div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-4"><p className="text-xs font-medium text-amber-800">Pending payout</p><p className="mt-1 text-xl font-bold text-amber-900">{formatPrice(data.pendingEarnings ?? 0)}</p></div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Net profit is not calculated because farm input costs, labour, packaging and transport expenses are not currently included in this analytics data. Revenue is not the same as profit.</p>
        </CardContent>
      </Card>

      {(aiDemand.length > 0 || aiPricing.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="rounded-2xl border-slate-200/80 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                AI Demand Forecast
              </CardTitle>
              <CardDescription>
                Expected demand for the next 7 days. Plan inventory accordingly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {aiDemand.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-500">
                    Not enough sales history for a forecast yet.
                  </p>
                ) : (
                  aiDemand.map((d: any) => (
                    <div key={d.productId} className="flex items-center justify-between rounded-lg border bg-white p-3">
                      <div>
                        <p className="font-medium">{d.productName}</p>
                        <p className="text-sm text-gray-500">
                          Expected: <span className="font-semibold text-emerald-600">{d.expectedKg} KG</span> / next 7 days
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-[11px] font-semibold",
                            d.level === "HIGH"
                              ? "bg-emerald-100 text-emerald-700"
                              : d.level === "MEDIUM"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {d.level === "HIGH" ? "HIGH DEMAND" : d.level === "MEDIUM" ? "MEDIUM" : "LOW"}
                        </span>
                        {d.level === "HIGH" && <TrendingUp className="h-4 w-4 text-emerald-600" />}
                        {d.level === "LOW" && <TrendingDown className="h-4 w-4 text-slate-500" />}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-violet-200 bg-gradient-to-br from-violet-50/60 to-emerald-50/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-violet-600" />
                AI Pricing Opportunities
              </CardTitle>
              <CardDescription>
                Recommended price ranges vs your current price. Final price is your decision.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {aiPricing.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-500">
                    Pricing guidance appears once comparable nearby sales exist.
                  </p>
                ) : (
                  aiPricing.map((p: any) => (
                    <div key={p.productId} className="flex items-center justify-between rounded-lg border bg-white p-3">
                      <div>
                        <p className="font-medium">{p.productName}</p>
                        <p className="text-sm text-gray-500">
                          <span className="font-semibold">₹{p.currentPrice}</span> →{" "}
                          <span className="font-semibold text-violet-600">
                            ₹{p.recommendedMin}–₹{p.recommendedMax}
                          </span>{" "}
                          recommended
                        </p>
                      </div>
                      <div className="text-right">
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-[11px] font-semibold",
                            p.demand === "HIGH"
                              ? "bg-emerald-100 text-emerald-700"
                              : p.demand === "MEDIUM"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {p.demand} demand
                        </span>
                        <p className="mt-1 max-w-[180px] truncate text-[11px] text-gray-500">
                          {p.reasons?.join(" · ")}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">Revenue trend</CardTitle>
            <CardDescription>How much you earned in this period</CardDescription>
          </CardHeader>
          <CardContent>
            {revenueTrend.length > 0 ? <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueTrend}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 8px 24px rgba(15,23,42,0.08)" }} />
                  <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#059669" strokeWidth={3} dot={false} activeDot={{ r: 5 }} />
                  
                </LineChart>
              </ResponsiveContainer>
            </div> : <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 text-center text-sm text-slate-500">Revenue trend will appear here when orders are recorded for this period.</div>}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">Sales by product category</CardTitle>
            <CardDescription>Which crops customers buy the most</CardDescription>
          </CardHeader>
          <CardContent>
            {categoryData.length > 0 ? <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData} dataKey="value" cx="50%" cy="50%" outerRadius={80} label>
                    {categoryData.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 8px 24px rgba(15,23,42,0.08)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div> : <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 text-center text-sm text-slate-500">Category breakdown will appear after your products receive sales.</div>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">Order status breakdown</CardTitle>
            <CardDescription>Pending, shipped or delivered</CardDescription>
          </CardHeader>
          <CardContent>
            {orderStatus.length > 0 ? <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={orderStatus}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
                  <XAxis dataKey="name" tickFormatter={(v: string) => v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 8px 24px rgba(15,23,42,0.08)" }} />
                  <Bar dataKey="count" name="Orders" fill="#0f9f6e" radius={[6, 6, 0, 0]}>
                    {orderStatus.map((entry: any) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div> : <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 text-center text-sm text-slate-500">Order status data will appear after you receive orders.</div>}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-900">Top-selling products</CardTitle>
            <CardDescription>Products that earned you the most</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              {topProducts.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">No product sales data yet.</p>
              ) : (
                topProducts.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-10 w-10 rounded bg-gray-100 flex items-center justify-center text-xl">
                        🍅
                        {p.image && (
                          <img
                            src={p.image}
                            alt={p.name}
                            className="absolute inset-0 h-full w-full rounded object-cover"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-sm text-gray-500">{(p.unitsSold ?? p.quantity ?? 0)} units sold • {p.orders ?? p.orderCount ?? 0} orders</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-600">{formatPrice(p.revenue ?? 0)}</p>
                      {Number(p.growth ?? 0) !== 0 && <p className={cn("text-sm", (p.growth ?? 0) > 0 ? "text-green-600" : "text-red-600")}>{(p.growth ?? 0) > 0 ? "+" : ""}{(p.growth ?? 0)}%</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm">
        <CardHeader>
<CardTitle className="text-base font-semibold text-slate-900">Current product stock</CardTitle>
            <CardDescription>What you still have on hand</CardDescription>
        </CardHeader>
        <CardContent>
          {productStock.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No product data yet.</p>
          ) : (
            <div className="space-y-2">
              {productStock.map((p: any) => {
                const unit = p.unit || "kg";
                const hasTotal = (p.totalStock ?? 0) > 0;
                const pct = hasTotal ? Math.min(100, Math.round((p.remaining / p.totalStock) * 100)) : null;
                return (
                  <div key={p.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative h-10 w-10 rounded bg-gray-100 flex items-center justify-center text-xl">
                        🍅
                        {p.image && (
                          <img
                            src={p.image}
                            alt={p.name}
                            className="absolute inset-0 h-full w-full rounded object-cover"
                            onError={(e) => { e.currentTarget.style.display = "none"; }}
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="text-sm text-gray-500">
                          <span className="font-semibold text-blue-600">{p.unitsSold ?? 0} {unit} sold</span>
                          {" • "}
                          <span className="font-semibold text-emerald-600">{p.remaining ?? 0} {unit} remaining</span>
                          {p.reserved > 0 && <span className="text-amber-600"> • {p.reserved} reserved</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 sm:w-64">
                      {hasTotal ? (
                        <>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={cn("h-full rounded-full", p.remaining === 0 ? "bg-red-500" : (pct ?? 0) <= 20 ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-medium text-gray-600">{pct}%</span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-emerald-600">Live stock</span>
                      )}
                      {p.remaining === 0 ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">OOS</span>
                      ) : p.remaining <= 5 ? (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Low</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
