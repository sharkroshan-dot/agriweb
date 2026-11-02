"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, ShoppingCart, Store, Loader2, ArrowRight, ShieldCheck, ShieldAlert, Sparkles, TrendingUp, Package, Users, PlusCircle, AlertTriangle, ClipboardCheck, Clock3, CreditCard } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { BusinessPageHeader } from "../../../components/business/business-page-header";

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
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const { data: contractsData } = useQuery({
    queryKey: ["businessContracts"],
    queryFn: () => api.get("/b2b/contracts"),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: 1,
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
  const contracts = contractsData?.data?.contracts || [];
  const deliveryUpdates = contracts.flatMap((contract: any) =>
    (Array.isArray(contract.deliveryHistory) ? contract.deliveryHistory : []).map((delivery: any) => ({ ...delivery, contractNumber: contract.contractNumber, cropName: contract.cropName, farmerName: contract.farmerName }))
  );
  const todayKey = new Date().toLocaleDateString("en-CA");
  const todayDeliveries = deliveryUpdates.filter((delivery: any) => delivery.scheduledDate === todayKey);
  const shortageDeliveries = deliveryUpdates.filter((delivery: any) => ["shortage", "backup_required", "at_risk", "rescheduled"].includes(String(delivery.status || "").toLowerCase()));
  const awaitingConfirmations = contracts.filter((contract: any) => contract.status === "active" && !todayDeliveries.some((delivery: any) => delivery.contractNumber === contract.contractNumber));
  const analytics = analyticsData?.data ?? {};
  const priceRec = priceRecMutation.data?.data;
  const demandItems = demandData?.data?.items || [];
  const activeOrders = orders.filter((o: any) => ["confirmed", "preparing", "quality_check", "ready_for_pickup", "picked_up", "warehouse_received", "transfer_in_transit", "destination_warehouse_received", "dispatched", "in_transit"].includes(String(o.status || "").toLowerCase()));

  const ordersAwaitingInspection = orders.filter((order: any) =>
    String(order.status || "").toLowerCase() === "delivered" && !order.goodsReceipt
  );
  const goodsReceiptDisputes = orders.filter((order: any) =>
    ["dispute_open", "response_received"].includes(String(order.goodsReceipt?.status || "").toLowerCase())
  );
  const ordersAwaitingFinalConfirmation = orders.filter((order: any) =>
    String(order.status || "").toLowerCase() === "delivered"
    && String(order.goodsReceipt?.status || "").toLowerCase() === "resolved"
  );
  const openQuoteRfqs = rfqs.filter((rfq: any) =>
    String(rfq.status || "").toLowerCase() === "open" && Number(rfq.offerCount || 0) > 0
  );
  const pendingFarmerContracts = contracts.filter((contract: any) =>
    String(contract.status || "").toLowerCase() === "pending"
  );
  const delayedOrders = orders.filter((order: any) => {
    const status = String(order.status || "").toLowerCase();
    if (["completed", "delivered", "cancelled"].includes(status)) return false;
    const dueDate = String(order.scheduledDeliveryDate || order.requiredDate || "").slice(0, 10);
    return Boolean(dueDate && dueDate < todayKey);
  });

  const businessActions: Array<{ key: string; title: string; description: string; href: string; action: string; tone: "urgent" | "warning" | "info" }> = [
    ...goodsReceiptDisputes.map((order: any) => ({
      key: "receipt-dispute-" + order.id,
      title: "Goods receipt dispute needs resolution",
      description: order.orderNumber + " · " + (order.productName || "Produce") + " · " + (order.farmerInfo?.farmName || "Supplier"),
      href: "/business/orders",
      action: order.goodsReceipt?.status === "response_received" ? "Review supplier response" : "Review dispute",
      tone: "urgent" as const,
    })),
    ...ordersAwaitingInspection.map((order: any) => ({
      key: "receipt-" + order.id,
      title: "Inspect delivered goods",
      description: order.orderNumber + " · " + (order.productName || "Produce") + " · " + (order.quantityKg || 0) + " kg received for inspection",
      href: "/business/orders",
      action: "Record goods receipt",
      tone: "warning" as const,
    })),
    ...ordersAwaitingFinalConfirmation.map((order: any) => ({
      key: "receipt-final-" + order.id,
      title: "Final receipt confirmation is pending",
      description: order.orderNumber + " · " + (order.productName || "Produce") + " · Dispute resolution recorded",
      href: "/business/orders",
      action: "Confirm final receipt",
      tone: "warning" as const,
    })),
    ...awaitingConfirmations.map((contract: any) => ({
      key: "confirmation-" + (contract.id || contract.contractNumber),
      title: "Today's recurring delivery confirmation is missing",
      description: (contract.contractNumber || "Supply contract") + " · " + (contract.farmerName || "Supplier") + " · " + (contract.cropName || "Produce"),
      href: "/business/contracts",
      action: "Follow up",
      tone: "warning" as const,
    })),
    ...shortageDeliveries.map((delivery: any, index: number) => ({
      key: "shortage-" + delivery.contractNumber + "-" + delivery.scheduledDate + "-" + index,
      title: "Recurring supply shortage reported",
      description: delivery.contractNumber + " · " + delivery.cropName + " · " + delivery.scheduledDate,
      href: "/business/contracts",
      action: "Resolve shortage",
      tone: "urgent" as const,
    })),
    ...openQuoteRfqs.map((rfq: any) => ({
      key: "quotes-" + rfq.id,
      title: "Farmer quotes are waiting",
      description: (rfq.productName || "Product request") + " · " + (rfq.offerCount || 0) + " quote(s) received",
      href: "/business/rfqs",
      action: "Compare quotes",
      tone: "info" as const,
    })),
    ...pendingFarmerContracts.map((contract: any) => ({
      key: "contract-" + contract.id,
      title: "Supply contract awaiting farmer acceptance",
      description: (contract.contractNumber || "Contract") + " · " + (contract.farmerName || "Supplier"),
      href: "/business/contracts",
      action: "Review contract",
      tone: "warning" as const,
    })),
    ...delayedOrders.map((order: any) => ({
      key: "delayed-" + order.id,
      title: "Purchase order is past its required date",
      description: order.orderNumber + " · " + (order.productName || "Produce") + " · Due " + String(order.scheduledDeliveryDate || order.requiredDate).slice(0, 10),
      href: "/business/orders",
      action: "Track order",
      tone: "urgent" as const,
    })),
    ...orders.filter((order: any) =>
      String(order.status || "").toLowerCase() !== "cancelled" &&
      Math.max(0, Number(order.totalAmount || 0) - Number(order.paidAmount || (order.paymentStatus === "paid" ? order.totalAmount : order.paymentStatus === "advance" ? order.advanceAmount : 0))) > 0
    ).map((order: any) => ({
      key: "payment-" + order.id,
      title: "Payment balance is outstanding",
      description: order.orderNumber + " · Balance " + formatPrice(Math.max(0, Number(order.totalAmount || 0) - Number(order.paidAmount || (order.paymentStatus === "paid" ? order.totalAmount : order.paymentStatus === "advance" ? order.advanceAmount : 0)))),
      href: "/business/payments",
      action: "Review payment",
      tone: "info" as const,
    })),
  ].slice(0, 10);

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

      <BusinessPageHeader
        title={profile.businessName || "Business workspace"}
        eyebrow="Procurement workspace"
        description={`${(profile.businessType || "Business").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}${profile.city ? ` • ${profile.city}` : ""}`}
        actionHref="/business/rfqs/new"
        actionLabel="Create RFQ"
        actionIcon="plus"
      >
        {profile.isVerified ? (
          <Badge variant="success" className="gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Verified Business</Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-amber-700"><ShieldAlert className="h-3.5 w-3.5" /> Unverified</Badge>
        )}
      </BusinessPageHeader>

      <div className="business-task-banner flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="font-semibold text-blue-950">Procurement command centre</p><p className="text-sm text-blue-900">Review open quotes, confirm upcoming delivery dates and resolve supply risks before they become missed orders.</p></div>
        <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link href="/business/rfqs">Review RFQ quotes</Link></Button><Button asChild size="sm" variant="outline"><Link href="/business/orders">Track orders</Link></Button></div>
      </div>

      <section className="space-y-3" aria-labelledby="business-action-center">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="business-action-center" className="text-lg font-semibold">Business Action Center</h2>
            <p className="text-sm text-slate-500">Tasks that need your attention across quotes, contracts, deliveries, goods receipt and payments.</p>
          </div>
          <Badge variant={businessActions.some((item) => item.tone === "urgent") ? "warning" : "outline"}>
            {businessActions.length} action{businessActions.length === 1 ? "" : "s"}
          </Badge>
        </div>
        {businessActions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <ShieldCheck className="h-5 w-5 text-emerald-700" />
            <div><p className="text-sm font-semibold text-emerald-900">All caught up</p><p className="text-xs text-emerald-800">No pending business actions were found in your current RFQs, contracts or B2B orders.</p></div>
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {businessActions.map((item) => (
              <div key={item.key} className={"flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between " + (item.tone === "urgent" ? "border-rose-200 bg-rose-50/50" : item.tone === "warning" ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white")}>
                <div className="flex min-w-0 items-start gap-3">
                  <div className={"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " + (item.tone === "urgent" ? "bg-rose-100 text-rose-700" : item.tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-blue-700")}>
                    {item.title.toLowerCase().includes("receipt") || item.title.toLowerCase().includes("inspect") ? <ClipboardCheck className="h-4 w-4" /> : item.title.toLowerCase().includes("payment") ? <CreditCard className="h-4 w-4" /> : item.title.toLowerCase().includes("delayed") ? <Clock3 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-0.5 break-words text-xs text-slate-500">{item.description}</p>
                  </div>
                </div>
                <Button asChild size="sm" variant="outline" className="shrink-0">
                  <Link href={item.href}>{item.action} <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Recurring supply updates</h2>
            <p className="text-sm text-slate-500">Daily farmer confirmations and shortages from your supply contracts.</p>
          </div>
          <Link href="/business/contracts"><Button variant="outline" size="sm">View supply contracts <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Today's updates</p><p className="mt-1 text-2xl font-bold">{todayDeliveries.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Full supply confirmed</p><p className="mt-1 text-2xl font-bold text-emerald-700">{todayDeliveries.filter((delivery: any) => delivery.status === "confirmed").length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Shortage / at risk</p><p className="mt-1 text-2xl font-bold text-red-700">{shortageDeliveries.length}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Active contracts awaiting today's update</p><p className="mt-1 text-2xl font-bold text-amber-700">{awaitingConfirmations.length}</p></CardContent></Card>
        </div>
        {shortageDeliveries.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert className="mr-2 inline h-4 w-4" /> {shortageDeliveries.length} recurring delivery update(s) need review. Open Supply Contracts to review the farmer's quantities and choose a resolution.</div>}
      </section>

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
