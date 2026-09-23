"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Brain,
  CreditCard,
  Package,
  Users,
  Warehouse,
  TrendingUp,
  Globe,
  MapPin,
  Truck,
  ShoppingCart,
  Thermometer,
  BarChart3,
  Route,
  Clock,
  Loader2,
  MessageSquare,
  UserCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import { cn, formatPrice, formatDate } from "../../../lib/utils";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Progress } from "../../../components/ui/progress";

interface DashboardStats {
  totalUsers: number;
  totalFarmers: number;
  totalCustomers: number;
  totalProducts: number;
  totalOrders: number;
  todayOrders: number;
  pendingOrders: number;
  totalRevenue: number;
  pendingFarmers: number;
  pendingComplaints: number;
}

interface OrdersTrendItem {
  date: string;
  count: number;
}

interface MarketplaceDistribution {
  nearby: number;
  state: number;
  national: number;
}

interface AdminActivityItem {
  type: string;
  title: string;
  description: string;
  timestamp: string;
}

interface DashboardResponse {
  stats: DashboardStats;
  ordersTrend: OrdersTrendItem[];
  marketplace?: MarketplaceDistribution;
  recentActivity?: AdminActivityItem[];
}

interface AIAnalyticsModel {
  modelType: string;
  predictionAccuracy: number;
  totalPredictions: number;
  lastUpdated?: string;
}

interface AIAnalyticsData {
  success: boolean;
  data: {
    models: AIAnalyticsModel[];
  };
}

interface DemandLocation {
  name: string;
  demand: string;
  topProduct: string;
  orderCount: number;
}

interface DemandHeatmapResponse {
  locations: DemandLocation[];
}

interface DeliveryRoute {
  farmer?: string;
  farmerName?: string;
  partner?: string;
  partnerName?: string;
  area?: string;
  orders?: number;
  status?: string;
  startTime?: string;
}

const modelLabelMap: Record<string, string> = {
  price_prediction: "Price Predictions",
  demand_forecasting: "Demand Forecasts",
  crop_recommendation: "Crop Recommendations",
  quality_assessment: "Quality Assessment",
  weather_impact: "Weather Impact",
};

export default function AdminDashboardPage() {
  const dashboardQuery = useQuery<DashboardResponse>({
    queryKey: ["admin-dashboard"],
    queryFn: () => api.get("/admin/dashboard"),
  });

  const aiAnalyticsQuery = useQuery<AIAnalyticsData>({
    queryKey: ["ai-analytics"],
    queryFn: () => api.get("/ai/analytics"),
  });

  const demandHeatmapQuery = useQuery<DemandHeatmapResponse>({
    queryKey: ["admin-regions"],
    queryFn: () => api.get("/admin/dashboard/regions"),
  });

  const deliveryStatsQuery = useQuery<{ data?: { routes?: DeliveryRoute[] } }>({
    queryKey: ["delivery-stats"],
    queryFn: () => api.get("/delivery/admin/stats"),
  });

  const inventoryAnalyticsQuery = useQuery({
    queryKey: ["admin-inventory-analytics"],
    queryFn: () => api.get("/inventory/admin/analytics"),
  });

  const isLoading =
    dashboardQuery.isLoading ||
    aiAnalyticsQuery.isLoading ||
    demandHeatmapQuery.isLoading ||
    deliveryStatsQuery.isLoading ||
    inventoryAnalyticsQuery.isLoading;

  const stats = dashboardQuery.data?.stats;
  const ordersTrend = dashboardQuery.data?.ordersTrend;
  const invAnalytics = (inventoryAnalyticsQuery.data as any)?.data ?? {};
  const aiModels = aiAnalyticsQuery.data?.data?.models;
  const locations = demandHeatmapQuery.data?.locations;
  const deliveryRoutes = deliveryStatsQuery.data?.data?.routes ?? [];
  const marketplace = dashboardQuery.data?.marketplace;
  const recentActivity = dashboardQuery.data?.recentActivity;

  const maxOrderCount =
    ordersTrend && ordersTrend.length > 0
      ? Math.max(...ordersTrend.map((w) => w.count), 1)
      : 1;

  const chartMaxHeight = 100;

  const pricePredictionModel = aiModels?.find((m) => m.modelType === "price_prediction");
  const totalPredictions = aiModels?.reduce((sum, m) => sum + m.totalPredictions, 0) ?? 0;
  const avgAccuracy =
    aiModels && aiModels.length > 0
      ? aiModels.reduce((sum, m) => sum + m.predictionAccuracy, 0) / aiModels.length
      : 0;

  const services = (aiModels ?? []).map((model) => ({
    label: modelLabelMap[model.modelType] ?? model.modelType.replace(/_/g, " "),
    value: Math.round(model.predictionAccuracy * 1000) / 10,
  }));

  const formatDateLabel = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    } catch {
      return dateStr;
    }
  };

  const formatRelativeTime = (iso: string) => {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const marketplaceTotal =
    marketplace ? marketplace.nearby + marketplace.state + marketplace.national : 0;

  const marketplaceLevels = marketplace
    ? [
        { key: "nearby", label: "Nearby", count: marketplace.nearby, color: "bg-emerald-500" },
        { key: "state", label: "State", count: marketplace.state, color: "bg-amber-500" },
        { key: "national", label: "National", count: marketplace.national, color: "bg-purple-500" },
      ]
    : [];

  const activityIcon: Record<string, typeof MessageSquare> = {
    complaint: MessageSquare,
    product: Package,
    farmer: UserCheck,
    order: ShoppingCart,
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const metricsCards = stats
    ? [
        { title: "Active Users", value: stats.totalUsers.toLocaleString("en-IN"), icon: Users, tone: "success" as const },
        { title: "Orders Today", value: stats.todayOrders.toLocaleString("en-IN"), icon: Package, tone: "default" as const },
        { title: "Revenue", value: formatPrice(stats.totalRevenue), icon: CreditCard, tone: "success" as const },
        { title: "Total Farmers", value: stats.totalFarmers.toLocaleString("en-IN"), icon: Warehouse, tone: "default" as const },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Operations overview</p>
          <h1 className="text-3xl font-semibold tracking-tight">Administrator command center</h1>
          <p className="mt-1 text-sm text-muted-foreground">Monitor platform performance, operational health, and growth signals from one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/reports">Export Report</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/alerts">Review Alerts</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricsCards.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.title}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{metric.title}</p>
                    <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                  </div>
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {invAnalytics.total_products > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Live Inventory Analytics
            </CardTitle>
            <CardDescription>Real-time stock position across all products</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">Total Products</p>
                <p className="text-xl font-bold text-slate-900">{invAnalytics.total_products}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 text-center">
                <p className="text-xs text-emerald-600">Available</p>
                <p className="text-xl font-bold text-emerald-700">{invAnalytics.total_available}</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 text-center">
                <p className="text-xs text-amber-600">Reserved</p>
                <p className="text-xl font-bold text-amber-700">{invAnalytics.total_reserved}</p>
              </div>
              <div className="rounded-lg bg-blue-50 p-3 text-center">
                <p className="text-xs text-blue-600">Sold</p>
                <p className="text-xl font-bold text-blue-700">{invAnalytics.total_sold}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                Out of stock: <strong>{invAnalytics.out_of_stock_products}</strong>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                Low stock: <strong>{invAnalytics.low_stock_products}</strong>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Total stock: <strong>{invAnalytics.total_stock}</strong>
              </span>
            </div>
            {invAnalytics.top_reserved_products?.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-slate-500">Top reserved products</p>
                <div className="flex flex-wrap gap-2">
                  {invAnalytics.top_reserved_products.slice(0, 5).map((p: any) => (
                    <Badge key={p.product_id} variant="outline" className="text-xs">
                      {p.product_name}: {p.total_reserved} reserved
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {stats ? (
          <>
            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-emerald-700 text-base">
                  <MapPin className="h-5 w-5" />
                  Nearby Sales
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Farmers</span>
                  <span className="font-semibold">{stats.totalFarmers.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Customers</span>
                  <span className="font-semibold">{stats.totalCustomers.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Orders Today</span>
                  <span className="font-semibold">{stats.todayOrders.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Revenue</span>
                  <span className="font-semibold text-emerald-600">{formatPrice(stats.totalRevenue)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-amber-200 bg-gradient-to-br from-amber-50/50 to-white">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-amber-700 text-base">
                  <Route className="h-5 w-5" />
                  State Sales
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Products</span>
                  <span className="font-semibold">{stats.totalProducts.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Orders</span>
                  <span className="font-semibold">{stats.totalOrders.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pending Orders</span>
                  <span className="font-semibold">{stats.pendingOrders.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pending Farmers</span>
                  <span className="font-semibold">{stats.pendingFarmers}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-purple-200 bg-gradient-to-br from-purple-50/50 to-white">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-purple-700 text-base">
                  <Globe className="h-5 w-5" />
                  National Sales
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Users</span>
                  <span className="font-semibold">{stats.totalUsers.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pending Complaints</span>
                  <span className="font-semibold">{stats.pendingComplaints}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pending Farmers</span>
                  <span className="font-semibold">{stats.pendingFarmers}</span>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="col-span-3">
            <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
              No data available
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Demand Heat Map
            </CardTitle>
            <CardDescription>Regional demand intensity across India</CardDescription>
          </CardHeader>
          <CardContent>
            {locations && locations.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {locations.map((state) => (
                    <div
                      key={state.name}
                      className={cn(
                        "rounded-lg border p-3 transition-all hover:shadow-md",
                        state.demand === "high" && "bg-red-50 border-red-200",
                        state.demand === "medium" && "bg-amber-50 border-amber-200",
                        state.demand === "low" && "bg-green-50 border-green-200"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">{state.name}</p>
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full",
                            state.demand === "high" && "bg-red-500",
                            state.demand === "medium" && "bg-amber-500",
                            state.demand === "low" && "bg-green-500"
                          )}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Top: {state.topProduct}</p>
                      <p className="text-xs text-muted-foreground">{state.orderCount.toLocaleString("en-IN")} orders</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> High</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Medium</span>
                  <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Low</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                No regions available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform growth</CardTitle>
            <CardDescription>Weekly activity across users, orders, and fulfillment.</CardDescription>
          </CardHeader>
          <CardContent>
            {ordersTrend && ordersTrend.length > 0 ? (
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex items-end gap-3">
                  {ordersTrend.map((item, index) => {
                    const height = Math.max((item.count / maxOrderCount) * chartMaxHeight, 4);
                    return (
                      <div key={item.date} className="flex flex-1 flex-col items-center gap-2">
                        <div
                          className="w-full rounded-t-lg bg-gradient-to-t from-primary to-emerald-400"
                          style={{ height: `${height}px` }}
                        />
                        <span className="text-xs text-muted-foreground">{formatDateLabel(item.date)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                No trend data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              Active Delivery Routes
            </CardTitle>
            <CardDescription>Currently active delivery routes across the platform</CardDescription>
          </CardHeader>
          <CardContent>
            {deliveryRoutes.length > 0 ? (
              <div className="space-y-3">
                {deliveryRoutes.map((route, i) => (
                  <div key={i} className="flex items-center gap-4 rounded-lg border p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Route className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{route.farmer ?? route.farmerName ?? "Unknown"}</p>
                        {route.status && (
                          <Badge
                            variant={
                              route.status === "active" || route.status === "in_transit"
                                ? "success"
                                : route.status === "completed"
                                ? "default"
                                : "secondary"
                            }
                            className="text-[10px] px-1.5 py-0"
                          >
                            {route.status.replace("_", " ")}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[route.partner ?? route.partnerName, route.area, route.orders != null ? `${route.orders} orders` : null]
                          .filter(Boolean)
                          .join(" \u2022 ")}
                      </p>
                    </div>
                    {route.startTime && (
                      <div className="text-right text-xs text-muted-foreground shrink-0">
                        <Clock className="inline h-3 w-3 mr-1" />
                        {route.startTime}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                No active routes
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              Marketplace Overview
            </CardTitle>
            <CardDescription>Order distribution across marketplace levels</CardDescription>
          </CardHeader>
          {marketplaceLevels.length > 0 && marketplaceTotal > 0 ? (
            <CardContent className="space-y-4">
              {marketplaceLevels.map((level) => {
                const pct = Math.round((level.count / marketplaceTotal) * 100);
                return (
                  <div key={level.key}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${level.color}`} />
                        <span className="font-medium">{level.label}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {level.count.toLocaleString("en-IN")} orders · {pct}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${level.color}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          ) : (
            <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
              No distribution data available
            </CardContent>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Service health</CardTitle>
            <CardDescription>Current uptime and response quality for key services.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {services.length > 0 ? (
              services.map((service) => (
                <div key={service.label}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="capitalize">{service.label}</span>
                    <span className="font-medium">{service.value}%</span>
                  </div>
                  <Progress value={service.value} />
                </div>
              ))
            ) : (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                No service data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent admin activity</CardTitle>
            <CardDescription>Latest actions from platform administrators.</CardDescription>
          </CardHeader>
          {recentActivity && recentActivity.length > 0 ? (
            <CardContent className="space-y-4">
              {recentActivity.map((item, i) => {
                const Icon = activityIcon[item.type] ?? Activity;
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          ) : (
            <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
              No recent activity
            </CardContent>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>AI assistant performance</CardTitle>
              <CardDescription>Insights generated for the platform this week.</CardDescription>
            </div>
            <Badge variant="success" className="flex items-center gap-2">
              <Brain className="h-3.5 w-3.5" />
              Live
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Forecast accuracy</p>
            <p className="mt-2 text-2xl font-semibold">
              {avgAccuracy > 0 ? `${(avgAccuracy * 100).toFixed(1)}%` : "No data"}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Recommendations served</p>
            <p className="mt-2 text-2xl font-semibold">
              {totalPredictions > 0 ? `${(totalPredictions / 1000).toFixed(0)}K` : "No data"}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Active models</p>
            <p className="mt-2 text-2xl font-semibold">
              {aiModels && aiModels.length > 0 ? aiModels.length : "No data"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
