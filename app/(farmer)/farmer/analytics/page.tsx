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

const SUMMARY_CARDS = [
  { key: "totalRevenue", label: "Total earned", emoji: "💰", color: "text-emerald-600", format: (v: any) => formatPrice(v ?? 0) },
  { key: "totalOrders", label: "Orders placed", emoji: "🧺", color: "text-blue-600", format: (v: any) => `${v ?? 0}` },
  { key: "averageOrderValue", label: "Average order size", emoji: "🛒", color: "text-purple-600", format: (v: any) => formatPrice(v ?? 0) },
  { key: "deliveredOrders", label: "Delivered to customers", emoji: "✅", color: "text-amber-600", format: (v: any) => `${v ?? 0}` },
];

export default function FarmerAnalyticsPage() {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");

  const { data: metrics, isLoading } = useQuery({
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

  if (isLoading) {
    return <div className="space-y-4"><div className="h-12 w-48 animate-pulse rounded bg-gray-200" /><div className="h-80 animate-pulse rounded bg-gray-200" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-gray-500">Data-driven insights to optimize your farm.</p>
        </div>
        <div className="flex items-center gap-2">
          {[("7d" as const), ("30d" as const), ("90d" as const)].map((r) => (
            <Button key={r} variant={range === r ? "default" : "outline"} size="sm" onClick={() => setRange(r)}>{r}</Button>
          ))}
        </div>
      </div>

      {insights.length > 0 && (
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-green-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-emerald-600" />
              💡 Your farm at a glance
            </CardTitle>
            <CardDescription>Simple tips to help your farm grow.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {insights.map((i: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3 rounded-lg border bg-white p-3">
                  <span className="text-xl">{i.emoji}</span>
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {SUMMARY_CARDS.map(({ key, label, emoji, color, format }) => (
          <Card key={key}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-3xl">{emoji}</p>
                  <p className="mt-1 text-3xl font-extrabold text-slate-900">{format(data[key])}</p>
                  <p className="text-sm text-gray-500">{label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-emerald-600">
              <Wallet className="h-5 w-5" />
              <p className="text-sm text-gray-500">💰 Money in your wallet</p>
            </div>
            <p className="mt-2 text-3xl font-extrabold text-emerald-700">{formatPrice(data.walletBalance ?? 0)}</p>
            <p className="mt-1 text-xs text-gray-400">Ready to spend or withdraw</p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50/60 to-white">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-amber-600">
              <Banknote className="h-5 w-5" />
              <p className="text-sm text-gray-500">⏳ Coming to you</p>
            </div>
            <p className="mt-2 text-3xl font-extrabold text-amber-700">{formatPrice(data.pendingEarnings ?? 0)}</p>
            <p className="mt-1 text-xs text-gray-400">Earned but not paid out yet</p>
          </CardContent>
        </Card>
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50/60 to-white">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-violet-600">
              <Star className="h-5 w-5" />
              <p className="text-sm text-gray-500">⭐ Customer rating</p>
            </div>
            <p className="mt-2 text-3xl font-extrabold text-violet-700">
              {Number(data.avgRating ?? 0) > 0 ? `${Number(data.avgRating).toFixed(1)} / 5` : "—"}
              <span className="ml-2 text-sm font-normal text-gray-400">({data.reviewCount ?? 0} reviews)</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Harvest plans", value: harvest.harvestPlans ?? data.harvestPlans ?? 0, emoji: "🌱" },
          { label: "Upcoming harvests", value: harvest.upcomingHarvests ?? data.upcomingHarvests ?? 0, emoji: "📅" },
          { label: "Pre-orders booked", value: harvest.preOrders ?? data.preOrders ?? 0, emoji: "🛒" },
          { label: "Customers interested", value: harvest.notifyMe ?? data.notifyMe ?? 0, emoji: "🔔" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-6">
              <p className="text-3xl">{s.emoji}</p>
              <p className="mt-1 text-3xl font-extrabold text-slate-900">{s.value}</p>
              <p className="text-sm text-gray-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {(aiDemand.length > 0 || aiPricing.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-violet-50/40">
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
        <Card>
          <CardHeader>
            <CardTitle>📈 Your earnings over time</CardTitle>
            <CardDescription>How much you earned in this period</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueTrend.length > 0 ? revenueTrend : [{ name: "No data", revenue: 0, orders: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} />
                  <Line type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>🍎 Where your sales come from</CardTitle>
            <CardDescription>Which crops customers buy the most</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData.length > 0 ? categoryData : [{ name: "No data", value: 1 }]} dataKey="value" cx="50%" cy="50%" outerRadius={80} label>
                    {(categoryData.length > 0 ? categoryData : [{ name: "No data", value: 1 }]).map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>🚚 Where your orders stand</CardTitle>
            <CardDescription>Pending, shipped or delivered</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={orderStatus.length > 0 ? orderStatus : [{ name: "No data", count: 1 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickFormatter={(v: string) => v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {orderStatus.map((entry: any) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>🥇 Your best sellers</CardTitle>
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
                        <p className="text-sm text-gray-500">{(p.unitsSold ?? p.quantity ?? 0)} units • {p.orders ?? 0} orders</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-600">{formatPrice(p.revenue ?? 0)}</p>
                      <p className={cn("text-sm", (p.growth ?? 0) > 0 ? "text-green-600" : "text-red-600")}>{(p.growth ?? 0) > 0 ? '+' : ''}{(p.growth ?? 0)}%</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
<CardTitle>📦 Stock left to sell</CardTitle>
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
