"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, ShoppingCart, Store, Loader2, ArrowRight, ShieldCheck, ShieldAlert, Sparkles, TrendingUp, Package, Users, PlusCircle } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";

export default function BusinessDashboard() {
  const router = useRouter();
  const [priceProduct, setPriceProduct] = useState("");

  const { data: profileData, isLoading: profileLoading } = useQuery({
    queryKey: ["businessProfile"],
    queryFn: () => api.get("/b2b/business/profile"),
    retry: false,
  });

  const { data: rfqData, isLoading: rfqLoading } = useQuery({
    queryKey: ["b2b", "rfqs"],
    queryFn: () => api.get("/b2b/rfqs", { params: { status: "" } }),
  });

  const { data: ordersData } = useQuery({
    queryKey: ["b2b", "orders"],
    queryFn: () => api.get("/b2b/orders"),
  });

  const { data: analyticsData } = useQuery({
    queryKey: ["b2b", "analytics"],
    queryFn: () => api.get("/b2b/analytics/me"),
    enabled: Boolean(profileData?.data),
  });

  const { data: demandData } = useQuery({
    queryKey: ["b2b", "ai", "demand-forecast"],
    queryFn: () => api.get("/b2b/ai/demand-forecast"),
  });

  const priceRecMutation = useMutation({
    mutationFn: (productName: string) => api.post("/b2b/ai/price-recommendation", { productName }),
  });

  if (profileLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const hasProfile = Boolean(profileData?.data);
  const profile = profileData?.data ?? {};
  const rfqs = rfqData?.data?.rfqs || [];
  const orders = ordersData?.data?.orders || [];
  const analytics = analyticsData?.data ?? {};
  const priceRec = priceRecMutation.data?.data;
  const demandItems = demandData?.data?.items || [];
  const activeOrders = orders.filter((o: any) => ["confirmed", "preparing", "quality_check", "dispatched", "in_transit"].includes(o.status));

  const statCards = [
    { label: "Active RFQs", value: rfqs.filter((r: any) => r.status === "open").length, icon: FileText, color: "text-emerald-600" },
    { label: "Open Quotes", value: analytics.offerCount ?? rfqs.reduce((s: number, r: any) => s + (r.offerCount || 0), 0), icon: Users, color: "text-blue-600" },
    { label: "Active Purchase Orders", value: activeOrders.length, icon: ShoppingCart, color: "text-amber-600" },
    { label: "Total Procurement", value: formatPrice(analytics.totalSpend ?? 0), icon: TrendingUp, color: "text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      {!hasProfile && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-14 text-center">
          <Store className="h-12 w-12 text-gray-300" />
          <h1 className="mt-4 text-xl font-semibold">Complete your business profile</h1>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            Set up your business profile to publish requests for quote and buy fresh produce directly from farmers.
          </p>
          <Link href="/business/profile" className="mt-6">
            <Button>
              Create Business Profile <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      )}

      {hasProfile && (
        <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{profile.businessName}</h1>
          {profile.isVerified ? (
            <Badge variant="success" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Verified Business</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-amber-700"><ShieldAlert className="h-3.5 w-3.5" /> Unverified</Badge>
          )}
        </div>
        <p className="text-gray-500">
          {(profile.businessType || "Business").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
          {profile.city ? ` • ${profile.city}` : ""}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-6">
              <p className="flex items-center gap-2 text-sm text-gray-500">
                <s.icon className={`h-4 w-4 ${s.color}`} /> {s.label}
              </p>
              <p className="mt-1 text-2xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6">
        <div>
          <h2 className="text-lg font-semibold text-emerald-900">Need agricultural products?</h2>
          <p className="text-sm text-gray-600">
            Create an RFQ and receive offers from verified farmers for your procurement.
          </p>
        </div>
        <Link href="/business/rfqs/new">
          <Button size="lg" className="gap-2">
            <PlusCircle className="h-5 w-5" /> Create New RFQ
          </Button>
        </Link>
      </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-violet-200 bg-gradient-to-b from-violet-50/60 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-5 w-5 text-violet-600" /> AI Price Guidance
            </CardTitle>
            <CardDescription>Market range for your RFQ budget from recent farmer quotes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={priceProduct} onChange={(e) => setPriceProduct(e.target.value)} placeholder="e.g. Tomato" />
              <Button
                variant="outline"
                disabled={!priceProduct.trim() || priceRecMutation.isPending}
                onClick={() => priceProduct.trim() && priceRecMutation.mutate(priceProduct.trim())}
              >
                {priceRecMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
              </Button>
            </div>
            {priceRec && (
              priceRec.count > 0 ? (
                <div className="space-y-1.5 rounded-lg border border-violet-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-violet-800">{priceRec.productName} — market range</p>
                      <Badge variant="outline" className="border-violet-300 text-xs capitalize text-violet-700">
                        {priceRec.source === "blended" ? "Market blend" : priceRec.source}
                      </Badge>
                    </div>
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
                      Confidence {priceRec.confidenceScore}%
                    </span>
                  </div>
                  <p className="text-gray-700">
                    ₹{priceRec.minPerKg} – ₹{priceRec.maxPerKg}/kg · median ₹{priceRec.medianPerKg}/kg
                  </p>
                  <p className="text-xs text-gray-500">
                    Typical ₹{priceRec.p25PerKg}–₹{priceRec.p75PerKg}/kg
                    {priceRec.trend && priceRec.trend !== "n/a" ? ` · trend ${priceRec.trend}` : ""}
                  </p>
                  <p className="font-medium text-violet-700">
                    Recommended RFQ budget: ₹{priceRec.recommendedMin}–₹{priceRec.recommendedMax}/kg
                    <span className="ml-2 text-emerald-700">Suggested ₹{priceRec.suggestedPricePerKg}/kg</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {priceRec.sourcesUsed?.orders ? `${priceRec.sourcesUsed.orders} order(s) · ` : ""}
                    {priceRec.sourcesUsed?.quotes ? `${priceRec.sourcesUsed.quotes} quote(s) · ` : ""}
                    {priceRec.sourcesUsed?.marketplace ? `${priceRec.sourcesUsed.marketplace} listing(s)` : ""}
                  </p>
                  <p className="text-xs text-gray-400">{priceRec.notes}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500">{priceRec.notes}</p>
              )
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-5 w-5 text-emerald-600" /> Top Suppliers
              </CardTitle>
              <CardDescription>By settled procurement value</CardDescription>
            </div>
            <Link href="/business/rfqs">
              <Button variant="ghost" size="sm">New RFQ <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </Link>
          </CardHeader>
          <CardContent>
            {(analytics.topSuppliers ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                No settled procurement yet. Publish an RFQ to start buying from farmers.
              </p>
            ) : (
              <div className="space-y-2">
                {analytics.topSuppliers.map((s: any) => (
                  <div key={s.name} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-gray-500">{s.orders} order(s){s.rating ? ` • ★ ${Number(s.rating).toFixed(1)}` : ""}</p>
                    </div>
                    <p className="font-medium text-emerald-600">{formatPrice(s.total)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-violet-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-violet-600" /> AI Demand Forecast
          </CardTitle>
          <CardDescription>Expected weekly procurement needs based on your B2B orders (last 60 days).</CardDescription>
        </CardHeader>
        <CardContent>
          {demandItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              Not enough order history yet. Once you place B2B orders, demand forecasts will appear here.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {demandItems.map((d: any) => (
                <div key={d.productName} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{d.productName}</p>
                    <Badge variant={d.level === "HIGH" ? "success" : d.level === "MEDIUM" ? "secondary" : "outline"}>
                      {d.level} demand
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    ~{d.expectedKgPerWeek} kg/week
                    <span className="text-xs text-gray-400"> · {d.orderCount} order(s)</span>
                  </p>
                  <p className="mt-0.5 text-xs capitalize text-gray-500">Trend: {d.trend}</p>
                  <p className="mt-2 text-xs text-violet-700">{d.recommendation}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent RFQs</CardTitle>
            <Link href="/business/rfqs">
              <Button variant="ghost" size="sm">View all <ArrowRight className="ml-1 h-4 w-4" /></Button>
            </Link>
          </div>
          <CardDescription>Your requests for quote and their status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rfqs.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              No RFQs yet. <Link href="/business/rfqs" className="text-emerald-600">Create your first request.</Link>
            </p>
          ) : (
            rfqs.slice(0, 5).map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{r.productName}</p>
                    {r.qualityGrade ? <Badge variant="outline">{r.qualityGrade}</Badge> : null}
                  </div>
                  <p className="text-xs text-gray-500">
                    {r.quantityKg ?? `${r.quantityPerWeekKg} kg/week`} kg{r.recurring ? " • recurring" : " • one-off"}
                    {r.requiredDate ? ` • by ${r.requiredDate}` : ""}
                    {r.deliveryCity ? ` • ${r.deliveryCity}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{r.offerCount ?? 0} quote(s)</span>
                  <Badge variant={r.status === "open" ? "success" : "secondary"}>{r.status}</Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}