"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Package,
  ShoppingCart,
  DollarSign,
  Star,
  Truck,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  MoreVertical,
  Users,
  Navigation,
  Calendar,
  Box,
  Sparkles,
  Briefcase,
  ArrowRight,
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
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { formatPrice, formatDate } from "../../../lib/utils";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { AICopilotCard } from "../../../components/shared/ai-copilot-card";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

const TIME_SLOTS = [
  { label: "Morning", period: "6:00 - 8:00 AM", color: "amber" },
  { label: "Mid-day", period: "8:00 - 10:00 AM", color: "sky" },
  { label: "Afternoon", period: "4:00 - 6:00 PM", color: "orange" },
];

const CARD_ICONS: Record<string, { icon: any; color: string }> = {
  totalRevenue: { icon: DollarSign, color: "text-green-600" },
  totalOrders: { icon: ShoppingCart, color: "text-blue-600" },
  productsSold: { icon: Package, color: "text-purple-600" },
  averageRating: { icon: Star, color: "text-yellow-600" },
};

const CARD_TITLES: Record<string, string> = {
  totalRevenue: "Total Revenue",
  totalOrders: "Total Orders",
  productsSold: "Products Sold",
  averageRating: "Average Rating",
};

export default function FarmerDashboardPage() {
  const { data: session } = useSession();
  const userName = (session?.user as any)?.name || "Farmer";
  const [period, setPeriod] = useState<"week" | "month" | "year">("week");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ["farmerDashboard", period],
    queryFn: () => api.get(`/farmers/me/dashboard?period=${period}`),
  });

  const { data: ordersData } = useQuery({
    queryKey: ["farmerRecentOrders"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 5 } }),
  });

  const { data: productsData } = useQuery({
    queryKey: ["farmerTopProducts"],
    queryFn: () => api.get("/farmers/me/top-products", { params: { limit: 5 } }),
  });

  const { data: nearbyData } = useQuery({
    queryKey: ["farmerNearby", location],
    queryFn: () =>
      api.get("/marketplace/farmer-nearby", {
        params: { lat: location!.lat, lng: location!.lng, radius: 10 },
      }),
    enabled: !!location,
  });

  const { data: calendarData } = useQuery({
    queryKey: ["farmerDeliveryCalendar"],
    queryFn: () => api.get("/farmers/me/delivery-calendar"),
  });

  const { data: stockSummary } = useQuery({
    queryKey: ["farmerStockSummary"],
    queryFn: () => api.get("/inventory/farmer/summary"),
  });

  const { data: aiInsightsData } = useQuery({
    queryKey: ["aiFarmerInsights"],
    queryFn: () => api.get("/ai/farmer/insights"),
  });

  const { data: routeData } = useQuery({
    queryKey: ["farmerSmartRoute"],
    queryFn: () => api.get("/farmers/me/smart-route"),
  });

  const { data: b2bData } = useQuery({
    queryKey: ["farmerB2bAnalytics"],
    queryFn: () => api.get("/b2b/analytics/me"),
  });

  const stockData = (stockSummary as any)?.data ?? {};
  const stockProducts = stockData.products ?? [];
  const stats = (dashboardData as any)?.stats ?? {};
  const revenueTrend = (dashboardData as any)?.revenueTrend ?? [];
  const categoryDistribution = (dashboardData as any)?.categoryDistribution ?? [];
  const orders = (ordersData as any)?.data?.orders ?? (ordersData as any)?.orders ?? [];
  const topProducts = (productsData as any)?.products ?? [];
  const nearbyZones = (nearbyData as any)?.zones ?? [];
  const calendarSlots = (calendarData as any)?.slots ?? [];
  const calendarSummary = (calendarData as any)?.summary ?? {};
  const aiInsights = (aiInsightsData as any)?.data ?? {};
  const demandInsights = aiInsights.demand ?? [];
  const deliveryInsight = aiInsights.delivery ?? {};
  const pricingInsights = aiInsights.pricing ?? [];
  const communityInsight = aiInsights.community ?? {};
  const routeSummary = (routeData as any)?.summary ?? null;
  const routeStops = (routeData as any)?.stops ?? [];
  const b2b = (b2bData as any)?.data ?? {};

  const todayName = new Date().toLocaleDateString("en-IN", { weekday: "long" });
  const todaySlots = calendarSlots.filter((s: any) => s.day === todayName);

  const zoneColors = [
    "bg-emerald-50 border-emerald-200",
    "bg-blue-50 border-blue-200",
    "bg-amber-50 border-amber-200",
  ];
  const zoneBadgeColors = [
    "bg-emerald-100 text-emerald-700",
    "bg-blue-100 text-blue-700",
    "bg-amber-100 text-amber-700",
  ];

  if (dashboardLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-500">Welcome back, {userName}! Here's what's happening with your farm.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="selection-control flex rounded-lg border">
            {[("week" as const), ("month" as const), ("year" as const)].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "selection-item rounded-md px-3 py-1.5 text-sm font-medium",
                  period === p ? "selection-item-active" : "selection-item-inactive"
                )}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm">
            Export Report
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Object.keys(CARD_TITLES).map((key) => {
          const cardStat = (stats as any)[key] || {};
          const { icon: Icon, color } = CARD_ICONS[key];
          return (
            <Card key={key}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-500">{CARD_TITLES[key]}</p>
                    <p className="text-2xl font-bold">{cardStat.value ?? "—"}</p>
                  </div>
                  <div className={cn("rounded-full p-2 bg-gray-100", color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                {cardStat.change && (
                  <div className="mt-3 flex items-center gap-1 text-sm">
                    {cardStat.trend === "up" ? (
                      <ArrowUpRight className="h-4 w-4 text-green-600" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 text-red-600" />
                    )}
                    <span className={cn(cardStat.trend === "up" ? "text-green-600" : "text-red-600")}>{cardStat.change}</span>
                    <span className="text-gray-500">from last period</span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-amber-200 bg-gradient-to-b from-amber-50/60 to-transparent">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-amber-600" />
              B2B Opportunities
            </CardTitle>
            <CardDescription>Verified businesses sourcing in bulk — your second sales channel.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/farmer/b2b/rfqs">View B2B Marketplace <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "New RFQs", value: b2b.openRfqs ?? "—" },
              { label: "My Quotes", value: b2b.myQuotes ?? "—" },
              { label: "Won RFQs", value: b2b.wonOffers ?? "—" },
              { label: "Active B2B Orders", value: b2b.activeOrders ?? "—" },
              { label: "B2B Sales", value: b2b.totalSales ? formatPrice(b2b.totalSales) : "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border bg-white p-3 text-center">
                <p className="text-xl font-bold text-slate-900">{s.value}</p>
                <p className="mt-0.5 text-xs text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {stockData.total_products > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5 text-emerald-600" />
              Inventory Overview
            </CardTitle>
            <CardDescription>Real-time stock across your products</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">Total Stock</p>
                <p className="text-xl font-bold text-slate-900">{stockData.total_stock}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 text-center">
                <p className="text-xs text-emerald-600">Available</p>
                <p className="text-xl font-bold text-emerald-700">{stockData.total_available}</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 text-center">
                <p className="text-xs text-amber-600">Reserved</p>
                <p className="text-xl font-bold text-amber-700">{stockData.total_reserved}</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <p className="text-xs text-blue-600">Sold</p>
                <p className="text-xl font-bold text-blue-700">{stockData.total_sold}</p>
              </div>
            </div>
            <div className="space-y-2">
              {stockProducts.slice(0, 5).map((p: any) => (
                <div key={p.product_id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium">{p.product_name}</span>
                    {p.is_out_of_stock && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">OOS</span>
                    )}
                    {p.available_stock > 0 && p.available_stock <= 5 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Low</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>T: {p.total_stock}</span>
                    <span className="text-amber-600">R: {p.reserved_stock}</span>
                    <span className="text-blue-600">S: {p.sold_stock}</span>
                    <span className="font-medium text-emerald-700">{p.available_stock} avail</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AICopilotCard ctaHref="/farmer/ai" ctaLabel="Open AI Copilot" />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
            <CardDescription>Daily revenue and order trends</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueTrend.length > 0 ? revenueTrend : [{ name: "No data", revenue: 0, orders: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} dot={{ fill: "#22c55e" }} />
                  <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Product Categories</CardTitle>
            <CardDescription>Distribution by category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryDistribution.length > 0 ? categoryDistribution : [{ name: "No data", value: 100 }]} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {(categoryDistribution.length > 0 ? categoryDistribution : [{ name: "No data", value: 100 }]).map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {categoryDistribution.map((item: any, index: number) => (
                <div key={item.name} className="flex items-center gap-2 text-sm">
                  <div className={cn("h-3 w-3 rounded-full", index === 0 && "bg-emerald-500", index === 1 && "bg-blue-500", index === 2 && "bg-amber-500", index === 3 && "bg-red-500", index === 4 && "bg-violet-500")} />
                  <span>{item.name}</span>
                  <span className="ml-auto font-medium">{item.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Nearby Orders
            </CardTitle>
            <CardDescription>Grouped by distance zones for efficient delivery</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/farmer/smart-route">
              <Navigation className="mr-1 h-4 w-4" />
              Plan Route
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {nearbyZones.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <Users className="h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-gray-500">No nearby orders found. Enable location or check back later.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {nearbyZones.map((zone: any, zi: number) => (
                <div key={zi} className={cn("rounded-xl border p-4", zoneColors[zi % zoneColors.length])}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">{zone.zone}</h3>
                    <Badge className={cn("text-xs", zoneBadgeColors[zi % zoneBadgeColors.length])}>{zone.totalItems}</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(zone.customers || []).map((c: any, ci: number) => (
                      <div key={ci} className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-sm">
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-gray-500">{c.products}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">{c.distance}</p>
                          <p className="text-xs font-medium text-gray-700">{c.items}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-3 w-full">
                    <Truck className="mr-1 h-3 w-3" />
                    Deliver
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Community delivery scheduling</CardTitle>
            <CardDescription>Publish weekly delivery windows so nearby customers can join a single grouped trip.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {calendarSlots.length > 0 ? (
              (() => {
                const first = calendarSlots[0];
                const total = calendarSlots.reduce((s: number, sl: any) => s + (sl.count || 0), 0);
                return (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                    {first.day} · {first.timeSlot} · {total} total deliveries
                  </div>
                );
              })()
            ) : (
              <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
                No delivery windows scheduled yet. Create one to let nearby customers join.
              </div>
            )}
            <Button variant="outline" size="sm">Manage schedules</Button>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600" />
              AI Farm Insights
            </CardTitle>
            <CardDescription>Demand, delivery, pricing and delivery-grouping guidance generated from your marketplace data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-emerald-600" /> Demand forecast (next 7 days)
              </p>
              {demandInsights.length === 0 ? (
                <p className="text-sm text-slate-600 mt-1">No demand forecast available yet — more delivered orders will unlock it.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {demandInsights.map((d: any) => (
                    <div key={d.productId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{d.productName}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-slate-500">{d.expectedKg} KG</span>
                        <Badge className={cn(
                          d.level === "HIGH" && "bg-red-100 text-red-700",
                          d.level === "MEDIUM" && "bg-amber-100 text-amber-700",
                          d.level === "LOW" && "bg-slate-100 text-slate-600"
                        )}>{d.level}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-blue-600" /> Delivery risk
              </p>
              <p className="text-sm text-slate-600 mt-1">
                {deliveryInsight.totalOrders > 0
                  ? `${deliveryInsight.totalOrders} active orders · ${deliveryInsight.highRisk} high risk · ${deliveryInsight.mediumRisk} medium risk · ${deliveryInsight.lowRisk} low risk`
                  : "No active deliveries to assess yet."}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-amber-600" /> Pricing opportunities
              </p>
              {pricingInsights.length === 0 ? (
                <p className="text-sm text-slate-600 mt-1">No pricing recommendations yet.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {pricingInsights.slice(0, 3).map((p: any) => (
                    <div key={p.productId} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.productName}</span>
                      <span className="text-emerald-600 font-medium">₹{p.currentPrice} → ₹{p.recommendedMin}–{p.recommendedMax}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {communityInsight.customerCount > 1 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                <p className="text-sm font-semibold text-violet-900 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-violet-600" /> Delivery group detected
                </p>
                <p className="text-sm text-violet-700 mt-1">
                  {communityInsight.customerCount} customers can be delivered together
                  ({communityInsight.totalWeight} KG). Batch these orders to save distance.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/farmer/order-map">View on Order Map</Link>
                </Button>
              </div>
            )}
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/farmer/analytics">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> View Full Forecast
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Orders</CardTitle>
              <CardDescription>Latest customer orders</CardDescription>
            </div>
            <Link href="/farmer/orders">
              <Button variant="ghost" size="sm">
                View All
                <ArrowUpRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No orders yet.</p>
            ) : (
              <div className="space-y-4">
                {orders.map((order: any) => (
                    <div key={order._id || order.id} className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{order.orderNumber || order._id || order.id}</p>
                        <Badge className={cn(
                          (order.orderStatus || order.status) === "delivered" && "border-green-200 bg-green-50 text-green-700",
                          (order.orderStatus || order.status) === "processing" && "border-purple-200 bg-purple-50 text-purple-700",
                          (order.orderStatus || order.status) === "pending" && "border-yellow-200 bg-yellow-50 text-yellow-700",
                          (order.orderStatus || order.status) === "confirmed" && "border-blue-200 bg-blue-50 text-blue-700",
                          (order.orderStatus || order.status) === "cancelled" && "border-red-200 bg-red-50 text-red-700",
                          !["delivered","processing","pending","confirmed","cancelled"].includes(order.orderStatus || order.status) && "border-gray-200 bg-gray-50 text-gray-700",
                        )}>{(order.orderStatus || order.status || "Unknown").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</Badge>
                      </div>
                      <p className="text-sm text-gray-500">{order.customerName || "Customer"} • {(order.items || []).length} items</p>
                      <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{order.orderDate ? formatDate(order.orderDate) : "—"}</span>
                        <span className="font-medium text-emerald-600">{formatPrice(order.totalAmount)}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Top Products</CardTitle>
              <CardDescription>Best selling items</CardDescription>
            </div>
            <Link href="/farmer/products">
              <Button variant="ghost" size="sm">
                View All
                <ArrowUpRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No products data yet.</p>
            ) : (
              <div className="space-y-4">
                {topProducts.map((product: any, index: number) => (
                  <div key={index} className="flex items-center gap-4 rounded-lg border p-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-2xl">{product.image}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-gray-500">{product.sold} units sold</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-600">{formatPrice(product.revenue)}</p>
                      <p className={cn("text-sm", product.growth > 0 ? "text-green-600" : "text-red-600")}>{product.growth > 0 ? "+" : ""}{product.growth}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Navigation className="h-5 w-5 text-emerald-600" />
                Smart Route Preview
              </CardTitle>
              <CardDescription>Today's planned delivery route</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/farmer/smart-route">
                View Full Route
                <ArrowUpRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {routeSummary ? (
              <>
                <div className="flex items-center justify-between rounded-lg bg-gradient-to-r from-emerald-50 to-blue-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                      <Truck className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Farm → {routeSummary.customersCount} Customer{routeSummary.customersCount > 1 ? "s" : ""}</p>
                      <p className="text-xs text-gray-500">{routeSummary.totalDistance} km total</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <p className="font-bold text-gray-900">{routeSummary.totalDistance} km</p>
                      <p className="text-xs text-gray-500">Distance</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-gray-900">{routeSummary.customersCount}</p>
                      <p className="text-xs text-gray-500">Customers</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bold text-gray-900">{routeSummary.estimatedTime}</p>
                      <p className="text-xs text-gray-500">Est. Time</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  {routeStops.slice(0, 4).map((_: any, s: number) => (
                    <div key={s} className="flex flex-1 flex-col items-center">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-medium text-emerald-600">
                        {s + 1}
                      </div>
                      {s < Math.min(routeStops.length, 4) - 1 && <div className="mt-1 h-0.5 w-full bg-emerald-200" />}
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between px-1 text-[10px] text-gray-500">
                  <span>Farm</span>
                  {routeStops.slice(0, 4).map((stop: any, i: number) => (
                    <span key={i}>{stop.customerName?.split(" ")[0]}</span>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                <Navigation className="h-8 w-8 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">No route planned for today.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-emerald-600" />
              Delivery Schedule
            </CardTitle>
            <CardDescription>Today's delivery slots</CardDescription>
          </CardHeader>
          <CardContent>
            {todaySlots.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center">
                <Calendar className="h-8 w-8 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">No deliveries scheduled for today.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {TIME_SLOTS.map((slot) => {
                  const slotData = todaySlots.find((s: any) => s.timeSlot === slot.label);
                  if (!slotData || !slotData.count) return null;
                  const deliveries = slotData.deliveries || [];
                  const borderColor = slot.color === "amber" ? "border-amber-200 bg-amber-50" : slot.color === "sky" ? "border-sky-200 bg-sky-50" : "border-orange-200 bg-orange-50";
                  const textColor = slot.color === "amber" ? "text-amber-800" : slot.color === "sky" ? "text-sky-800" : "text-orange-800";
                  const iconColor = slot.color === "amber" ? "text-amber-600" : slot.color === "sky" ? "text-sky-600" : "text-orange-600";
                  return (
                    <div key={slot.label} className={cn("rounded-lg border p-3", borderColor)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className={cn("h-4 w-4", iconColor)} />
                          <span className={cn("text-sm font-medium", textColor)}>{slot.label}</span>
                        </div>
                        <Badge variant={slot.color === "amber" ? "warning" : "default"} className={cn("text-xs", slot.color === "sky" && "bg-sky-500")}>{slotData.count} delivery{slotData.count > 1 ? "ies" : "y"}</Badge>
                      </div>
                      <p className={cn("mt-1 text-xs", slot.color === "amber" ? "text-amber-700" : slot.color === "sky" ? "text-sky-700" : "text-orange-700")}>{slot.period}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {deliveries.map((d: any, i: number) => (
                          <Badge key={i} variant="outline" className="border-white/80 bg-white text-[10px]">
                            {d.customerName}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-emerald-600" />Today's Route</CardTitle>
            <CardDescription>Optimized delivery route for today</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm"><Link href="/farmer/route">View Route</Link></Button>
        </CardHeader>
        <CardContent>
          {routeStops.length > 0 ? (
            <>
              <div className="flex flex-wrap items-center gap-8">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">🏠</div>
                  <div>
                    <p className="text-sm font-medium">Farm</p>
                    <p className="text-xs text-gray-500">Starting Point</p>
                  </div>
                </div>

                <div className="flex flex-1 items-center gap-2 overflow-x-auto py-2">
                  {routeStops.map((stop: any, index: number) => (
                    <div key={index} className="flex items-center">
                      {index > 0 && <div className="mx-2 h-0.5 w-8 bg-gray-300/50" />}
                      <div className="flex flex-col items-center rounded-lg border bg-white px-3 py-2 min-w-[100px]">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-sm font-medium text-emerald-600">{index + 1}</div>
                        <p className="mt-1 text-sm font-medium">{stop.customerName}</p>
                        <p className="text-xs text-gray-500">{stop.distance} km</p>
                        <p className="text-xs text-emerald-600">{stop.deliveryWindow}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">📍</div>
                  <div>
                    <p className="text-sm font-medium">End</p>
                    <p className="text-xs text-gray-500">{routeSummary?.totalDistance ?? 0} km total</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-gray-50 p-4">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-sm text-gray-500">Total Distance</p>
                    <p className="font-medium">{routeSummary?.totalDistance ?? 0} km</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Estimated Time</p>
                    <p className="font-medium">{routeSummary?.estimatedTime ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Stops</p>
                    <p className="font-medium">{routeStops.length} customer{routeStops.length > 1 ? "s" : ""}</p>
                  </div>
                </div>
                <Button><Truck className="mr-2 h-4 w-4" />Start Route</Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
              <Truck className="h-10 w-10 text-gray-300" />
              <p className="mt-3 text-sm text-gray-500">No route planned for today. Schedule deliveries to see your route here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
