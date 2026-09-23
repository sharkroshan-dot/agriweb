"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Leaf,
  IndianRupee,
  Users,
  Truck,
  Store,
  MapPin,
  Wheat,
  Loader2,
  Sparkles,
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

function Stat({ icon: Icon, label, value, sub }: any) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50">
          <Icon className="h-6 w-6 text-emerald-600" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
          <p className="text-xl font-bold text-gray-800">{value}</p>
          {sub ? <p className="text-xs text-gray-500">{sub}</p> : null}
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

export default function FarmerImpactPage() {
  const { data: impactData, isLoading } = useQuery({
    queryKey: ["impact", "me"],
    queryFn: () => api.get("/impact/me"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const d = impactData?.data ?? {};

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
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Leaf className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Your Farm Impact</h1>
        </div>
        <p className="text-gray-500">How your farm serves the local community - from verified delivered orders.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat icon={IndianRupee} label="Direct sales" value={formatPrice(d.totalSpent ?? 0)} />
        <Stat icon={Users} label="Customers served" value={d.orders ?? 0} />
        <Stat icon={Truck} label="Local deliveries" value={d.localDeliveries ?? 0} />
        <Stat icon={Store} label="Farm pickups" value={d.pickupOrders ?? 0} />
        <Stat icon={MapPin} label="Community deliveries" value={d.communityDeliveries ?? 0} />
        <Stat icon={Wheat} label="Delivered volume" value={`${d.deliveredKg ?? 0} kg`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sales &amp; orders — last 6 months</CardTitle>
          <CardDescription>Verified delivered orders per month.</CardDescription>
        </CardHeader>
        <CardContent>
          {trend.length ? (
            <div className="h-64">
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivered volume — last 6 months</CardTitle>
            <CardDescription>Kilograms of produce delivered per month.</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length ? (
              <div className="h-56">
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How your orders were fulfilled</CardTitle>
            <CardDescription>Share of local deliveries, farm pickups and community deliveries.</CardDescription>
          </CardHeader>
          <CardContent>
            {pieData.length ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 sm:flex-row sm:gap-6">
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
                    <p className="text-xs text-gray-400">orders</p>
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

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="font-medium">Estimated delivery distance saved</p>
              <p className="text-xs text-gray-500">
                Conservative estimate from local delivery routes instead of longer farm-pickup alternatives.
              </p>
            </div>
          </div>
          <p className="text-2xl font-bold text-emerald-600">{d.estimatedDistanceSavedKm ?? 0} km</p>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        {d.disclaimer || "Metrics are computed from delivered orders only."} No unverifiable environmental claims are made.
      </p>
    </div>
  );
}