"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Loader2, TrendingUp, ShoppingCart, Package, Users, Wallet, Clock } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899"];

export default function BusinessAnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["b2b", "analytics"],
    queryFn: () => api.get("/b2b/analytics/me"),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-80 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  const analytics = data?.data ?? {};
  const trend = analytics.monthlyTrend ?? [];
  const topProducts = analytics.topProducts ?? [];
  const topSuppliers = analytics.topSuppliers ?? [];

  const cards = [
    { label: "Total Procurement", value: formatPrice(analytics.totalSpend ?? 0), icon: Wallet, color: "text-emerald-600" },
    { label: "Total Orders", value: analytics.completedOrders ?? 0, icon: ShoppingCart, color: "text-blue-600" },
    { label: "Avg Order Value", value: formatPrice(analytics.avgOrderValue ?? 0), icon: TrendingUp, color: "text-purple-600" },
    { label: "Active RFQs", value: analytics.openRfqCount ?? 0, icon: BarChart3, color: "text-amber-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Procurement Analytics</h1>
        <p className="text-gray-500">Buyer-side insights across RFQs, orders and suppliers.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-6">
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <c.icon className={`h-4 w-4 ${c.color}`} /> {c.label}
              </p>
              <p className="mt-1 text-2xl font-bold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Procurement</CardTitle>
            <CardDescription>Settled spend per month</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend.length > 0 ? trend : [{ name: "No data", spend: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="spend" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Products</CardTitle>
            <CardDescription>By procurement value</CardDescription>
          </CardHeader>
          <CardContent>
            {topProducts.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">No settled procurement yet.</p>
            ) : (
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProducts} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={80} />
                    <Tooltip formatter={(v: any) => formatPrice(v)} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {topProducts.map((_: any, i: number) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" /> Top Suppliers
            </CardTitle>
            <CardDescription>By settled procurement value</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {topSuppliers.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">No suppliers yet.</p>
            ) : (
              topSuppliers.map((s: any) => (
                <div key={s.name} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-gray-500">{s.orders} order(s){s.rating ? ` • ★ ${Number(s.rating).toFixed(1)}` : ""}</p>
                  </div>
                  <p className="font-medium text-emerald-600">{formatPrice(s.total)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-600" /> Payments
            </CardTitle>
            <CardDescription>Outstanding vs settled procurement</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-emerald-50 p-4">
                <p className="flex items-center gap-1 text-xs text-emerald-700"><Wallet className="h-3.5 w-3.5" /> Paid</p>
                <p className="mt-1 text-xl font-bold text-emerald-700">{formatPrice(analytics.paidAmount ?? 0)}</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-4">
                <p className="flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3.5 w-3.5" /> Pending</p>
                <p className="mt-1 text-xl font-bold text-amber-700">{formatPrice(analytics.pendingAmount ?? 0)}</p>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              {analytics.rfqCount ?? 0} RFQs published · {analytics.offerCount ?? 0} quotes received · {analytics.activeOrders ?? 0} active orders
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
