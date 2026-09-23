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
  BadgePercent,
  Wallet,
  ArrowDownToLine,
  Star,
  BarChart3,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { formatPrice } from "../../lib/utils";
import { Card, CardContent } from "../../components/ui/card";

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

function monthLabel(month: string) {
  try {
    const [y, m] = month.split("-").map(Number);
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[(m || 1) - 1]} ${y}`;
  } catch {
    return month;
  }
}

export default function ImpactPage() {
  const { data: impactData, isLoading, isError, refetch } = useQuery({
    queryKey: ["impact", "me"],
    queryFn: () => api.get("/impact/me"),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Leaf className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Your Local Impact</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="h-24 animate-pulse bg-gray-100" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Leaf className="h-10 w-10 text-red-500" />
        <p className="font-medium">Failed to load your impact</p>
        <button
          onClick={() => refetch()}
          className="rounded-lg border border-emerald-200 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
        >
          Retry
        </button>
      </div>
    );
  }

  const d = impactData?.data ?? {};
  const ordersByMonth: { month: string; orders: number }[] = d.ordersByMonth || [];
  const maxMonthOrders = Math.max(1, ...ordersByMonth.map((m) => m.orders));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Leaf className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">Your Local Impact</h1>
        </div>
        <p className="text-gray-500">
          See how buying direct from farmers helps your community.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          icon={IndianRupee}
          label="Spent directly with farmers"
          value={formatPrice(d.totalSpent ?? 0)}
        />
        <Stat icon={Users} label="Farmers supported" value={d.farmersSupported ?? 0} />
        <Stat icon={Truck} label="Local deliveries" value={d.localDeliveries ?? 0} />
        <Stat icon={Store} label="Farm pickups" value={d.pickupOrders ?? 0} />
        <Stat icon={MapPin} label="Community deliveries" value={d.communityDeliveries ?? 0} />
        <Stat icon={Wheat} label="Delivered volume" value={`${d.deliveredKg ?? 0} kg`} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          icon={BadgePercent}
          label="Discounts & offers saved"
          value={formatPrice(d.discountSavings ?? 0)}
          sub={
            d.couponOrderCount
              ? `from ${d.couponOrderCount} order${d.couponOrderCount !== 1 ? "s" : ""} with coupons/offers`
              : "no coupon savings yet"
          }
        />
        <Stat
          icon={Store}
          label="Delivery fee saved by pickup"
          value={formatPrice(d.pickupFeeSavings ?? 0)}
          sub="delivery fee you avoided by choosing pickup"
        />
        <Stat
          icon={Wallet}
          label="AgriPoints earned"
          value={`${d.agriPointsEarned ?? 0} pts`}
          sub={`worth ≈ ${formatPrice(d.agriPointValueRs ?? 0)} wallet credit`}
        />
        <Stat
          icon={ArrowDownToLine}
          label="Money back via refunds"
          value={formatPrice(d.refundMoneyBack ?? 0)}
          sub="completed refunds returned to you"
        />
      </div>

      {ordersByMonth.length > 0 && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-emerald-600" />
              <p className="font-medium">Orders by month</p>
            </div>
            <div className="flex h-40 items-end gap-3">
              {ordersByMonth.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs font-semibold text-gray-700">{m.orders}</span>
                  <div
                    className="w-full max-w-10 rounded-t-md bg-emerald-500"
                    style={{ height: `${(m.orders / maxMonthOrders) * 100}%` }}
                  />
                  <span className="text-[10px] text-gray-400">{monthLabel(m.month)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {Array.isArray(d.topFarmers) && d.topFarmers.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-emerald-600" />
              <p className="font-medium">Your favourite farmers</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {d.topFarmers.map((f: any) => (
                <div
                  key={f.farmerId}
                  className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                      {(f.name || "F").charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium">{f.name}</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {f.orders} order{f.orders !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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