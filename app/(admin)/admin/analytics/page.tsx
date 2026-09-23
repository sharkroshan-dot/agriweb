"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Users, Package, DollarSign, Truck, CheckCircle, Activity, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";

const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

export default function AdminAnalyticsPage() {
  const { data: overviewData, isLoading } = useQuery({
    queryKey: ["adminAnalyticsOverview"],
    queryFn: () => api.get("/analytics/overview"),
  });

  const { data: deliveryAnalytics } = useQuery({
    queryKey: ["adminDeliveryAnalytics"],
    queryFn: () => api.get("/analytics/delivery"),
    refetchInterval: 30000,
  });

  const delivery = deliveryAnalytics?.data || deliveryAnalytics || {};
  const overview = overviewData ?? {};

  const metrics = [
    { title: "Total Revenue", value: inr(overview.totalRevenue ?? 0), icon: DollarSign, color: "text-emerald-600 bg-emerald-50" },
    { title: "Active Users", value: (overview.totalCustomers ?? 0).toLocaleString("en-IN"), icon: Users, color: "text-blue-600 bg-blue-50" },
    { title: "Total Orders", value: (overview.totalOrders ?? 0).toLocaleString("en-IN"), icon: Package, color: "text-purple-600 bg-purple-50" },
    { title: "Avg. Order Value", value: inr(overview.averageOrderValue ?? 0), icon: TrendingUp, color: "text-orange-600 bg-orange-50" },
  ];

  const salesTrend = Array.isArray(overview.salesTrends) ? overview.salesTrends : [];
  const maxRevenue = salesTrend.length > 0 ? Math.max(...salesTrend.map((d) => d.revenue || 0), 1) : 1;
  const topProducts: any[] = overview.topProducts ?? [];
  const topFarmers: any[] = overview.topFarmers ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">Platform-wide performance metrics and insights</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div>
            <h2 className="mb-3 text-lg font-semibold">Delivery Operations</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Assignments", value: delivery.totalAssignments || 0, icon: Package },
                { label: "Active deliveries", value: delivery.activeDeliveries || 0, icon: Truck },
                { label: "Delivered", value: delivery.delivered || 0, icon: CheckCircle },
                { label: "Completion rate", value: `${delivery.completionRate || 0}%`, icon: TrendingUp },
                { label: "Active partners", value: delivery.activePartners || 0, icon: Activity },
              ].map((metric) => (
                <Card key={metric.label}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <metric.icon className="h-5 w-5 text-emerald-600" />
                    <div><p className="text-xl font-bold">{metric.value}</p><p className="text-xs text-muted-foreground">{metric.label}</p></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((m) => (
              <Card key={m.title}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className={`rounded-full p-2 ${m.color}`}>
                      <m.icon className="h-5 w-5" />
                    </div>
                  </div>
                  <p className="mt-3 text-2xl font-bold text-slate-900">{m.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.title}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sales trend</CardTitle>
                <CardDescription>Revenue trend from real order data</CardDescription>
              </CardHeader>
              <CardContent>
                {salesTrend.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No trend data available.</p>
                ) : (
                  <div className="flex items-end gap-2" style={{ height: 160 }}>
                    {salesTrend.map((d) => (
                      <div key={d.period} className="flex flex-1 flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground">{inr(d.revenue).replace("Rs ", "")}</span>
                        <div
                          className="w-full rounded-t-lg bg-emerald-500 transition hover:bg-emerald-600"
                          style={{ height: `${Math.max((d.revenue / maxRevenue) * 120, 4)}px` }}
                        />
                        <span className="text-xs text-muted-foreground">{d.period}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top products</CardTitle>
                <CardDescription>Best selling products</CardDescription>
              </CardHeader>
              <CardContent>
                {topProducts.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No product data available.</p>
                ) : (
                  <div className="space-y-3">
                    {topProducts.map((p, i) => (
                      <div key={p.id ?? p.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                            {i + 1}
                          </span>
                          <span className="text-sm font-medium text-slate-900">{p.name}</span>
                        </div>
                        <div className="text-right text-sm">
                          <span className="text-muted-foreground">{p.quantity ?? p.orderCount ?? 0} units</span>
                          <span className="ml-3 font-medium text-emerald-700">{inr(p.revenue ?? 0)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {topFarmers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top farmers</CardTitle>
                <CardDescription>Highest performing farmer accounts</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {topFarmers.map((f, i) => (
                  <div key={f.id ?? f.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">{i + 1}</span>
                      <span className="text-sm font-medium text-slate-900">{f.name}</span>
                    </div>
                    <div className="text-right text-sm">
                      <span className="text-muted-foreground">{f.orderCount ?? 0} orders</span>
                      <span className="ml-3 font-medium text-emerald-700">{inr(f.revenue ?? 0)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
