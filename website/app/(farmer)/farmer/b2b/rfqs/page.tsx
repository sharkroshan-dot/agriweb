"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Loader2,
  Send,
  MapPin,
  CalendarDays,
  Clock,
  ShieldCheck,
  PackageSearch,
  CheckCircle,
  ShoppingBag,
  RefreshCw,
  Bot,
  AlertCircle,
} from "lucide-react";
import { api } from "../../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Badge } from "../../../../components/ui/badge";
import toast from "react-hot-toast";

const SCOPES = ["all", "nearby", "district", "state", "national"];

function scopeOf(rfq: any): string {
  const vis = rfq.visibility || "state";
  if (vis === "nearby" || (rfq.distanceKm != null && rfq.distanceKm <= 50)) return "nearby";
  return vis;
}

function PillTabs({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string; icon?: any; count?: number }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => {
        const selected = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              selected ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-white/70 hover:text-emerald-700"
            }`}
          >
            {o.icon}
            {o.label}
            {o.count != null && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  selected ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function QuoteForm({ rfq, onDone }: { rfq: any; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(String(rfq.priceCeilingPerKg || rfq.budgetMaxPerKg || ""));
  // Default to the buyer requested quantity, not the farmer stock quantity.
  const requestedQty = Number(rfq.quantityKg ?? rfq.quantityPerWeekKg ?? 0) || 0;
  const farmerStockQty = Number(rfq.availableKg ?? 0) || 0;
  const [qty, setQty] = useState(String(requestedQty > 0 ? Math.min(requestedQty, farmerStockQty > 0 ? farmerStockQty : requestedQty) : farmerStockQty || ""));
  const [deliveryCharge, setDeliveryCharge] = useState("");
  const [eta, setEta] = useState("");
  const [message, setMessage] = useState("");
  const [aiRec, setAiRec] = useState<any>(null);

  const aiMutation = useMutation({
    mutationFn: (payload: { productName: string; city?: string }) =>
      api.post("/b2b/ai/price-recommendation", payload),
    onSuccess: (res: any) => setAiRec(res?.data),
    onError: (err: any) => toast.error(err?.message || "AI price check failed"),
  });

  const submit = useMutation({
    mutationFn: (payload: any) => api.post(`/b2b/rfqs/${rfq.id}/offers`, payload),
    onSuccess: () => {
      toast.success("Quote submitted! The business buyer has been notified.");
      onDone();
      queryClient.invalidateQueries({ queryKey: ["b2b", "farmer", "rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["farmer", "purchase-requests"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit quote"),
  });

  const priceNum = Number(price) || 0;
  const qtyNum = Number(qty) || 0;
  const deliveryNum = Number(deliveryCharge) || 0;
  const total = priceNum * qtyNum + deliveryNum;

  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle className="text-sm">Submit your quote for {rfq.productName}</CardTitle>
        <CardDescription>
          {rfq.quantityKg != null ? `${rfq.quantityKg} kg` : `${rfq.quantityPerWeekKg ?? "—"} kg/week`}
          {rfq.qualityGrade ? ` · ${rfq.qualityGrade}` : ""}
          {rfq.budgetMinPerKg && rfq.budgetMaxPerKg ? ` · budget ₹${rfq.budgetMinPerKg}–₹${rfq.budgetMaxPerKg}/kg` : ""}
          {rfq.priceCeilingPerKg ? ` · ceiling ₹${rfq.priceCeilingPerKg}/kg` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Your price (₹/kg) *</label>
          <Input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Quantity you can supply (kg) *</label>
          <Input
            type="number"
            min="1"
            max={farmerStockQty > 0 ? Math.min(farmerStockQty, requestedQty > 0 ? requestedQty : farmerStockQty) : requestedQty || undefined}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <p className="text-[11px] text-slate-500">
            Buyer needs: <strong>{requestedQty > 0 ? `${requestedQty} kg` : "quantity not specified"}</strong>
            {rfq.availableKg != null ? ` · Your stock: ${rfq.availableKg} kg` : ""}
          </p>
          {requestedQty > 0 && qtyNum > requestedQty ? (
            <p className="text-[11px] text-amber-700">Your quote quantity cannot exceed the buyer's requested quantity.</p>
          ) : null}
          {farmerStockQty > 0 && qtyNum > farmerStockQty ? (
            <p className="text-[11px] text-amber-700">Your quote quantity cannot exceed your available stock.</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Delivery charge (₹)</label>
          <Input type="number" min="0" value={deliveryCharge} onChange={(e) => setDeliveryCharge(e.target.value)} />
        </div>
        <div className="sm:col-span-2 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
          <p className="mb-2 text-sm font-semibold text-emerald-900">B2B collection and delivery workflow</p>
          <ol className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-5">
            {[
              "Farmer marks the order ready for pickup",
              "Warehouse assigns a pickup team",
              "Pickup team collects and hands over the goods",
              "Warehouse checks, packs and dispatches",
              "Bulk transport / delivery partner delivers to the business",
            ].map((step, index) => (
              <li key={step} className="flex items-start gap-2 rounded-lg bg-white p-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-800">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-emerald-800">The farmer submits the price and quantity quote only. Pickup and delivery are coordinated through the B2B fulfillment workflow.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Expected delivery</label>
          <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium text-gray-500">Message to buyer</label>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Quality, packaging, farm details…" />
        </div>
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 sm:col-span-2">
          Total: ₹{total.toLocaleString("en-IN")} ({qtyNum} kg × ₹{priceNum}/kg{qtyNum > 0 ? ` + ₹${deliveryNum} delivery` : ""})
        </div>
        <div className="sm:col-span-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={aiMutation.isPending}
            onClick={() => aiMutation.mutate({ productName: rfq.productName || "", city: rfq.deliveryCity || undefined })}
          >
            {aiMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Bot className="mr-1.5 h-4 w-4" />}
            AI price check
          </Button>
          {aiRec && aiRec.count === 0 && (
            <p className="mt-2 rounded-lg border border-violet-200 bg-violet-50 p-2.5 text-sm text-violet-800">
              🤖 {aiRec.notes || "Not enough price data yet."}
            </p>
          )}
          {aiRec && aiRec.count > 0 && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">🤖 Market range: ₹{aiRec.minPerKg}–₹{aiRec.maxPerKg}/kg · median ₹{aiRec.medianPerKg}/kg</p>
                <span className="rounded-full bg-violet-200/70 px-2 py-0.5 text-xs font-medium">
                  Confidence {aiRec.confidenceScore}%
                </span>
              </div>
              <p className="text-xs">Recommended price: ₹{aiRec.suggestedPricePerKg}/kg</p>
              <p className="text-xs">{aiRec.notes}</p>
              <Button type="button" size="sm" onClick={() => setPrice(String(aiRec.suggestedPricePerKg))}>
                Use ₹{aiRec.suggestedPricePerKg}/kg
              </Button>
            </div>
          )}
        </div>
        <div className="sm:col-span-2">
          <Button
            className="w-full"
            disabled={!price || !qty || Number(price) <= 0 || Number(qty) <= 0 || submit.isPending}
            onClick={() =>
              submit.mutate({
                pricePerKg: Number(price),
                availableQuantityKg: Number(qty),
                deliveryCharge: deliveryCharge ? Number(deliveryCharge) : 0,
                deliveryMethod: "dedicated_transport",
                expectedDeliveryDate: eta || null,
                message,
              })
            }
          >
            {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Submit Quote
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function FarmerB2bRfqsPage() {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"one-off" | "recurring">("one-off");
  const hasAutoSelectedView = useRef(false);

  const { data: rfqData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["b2b", "farmer", "rfqs"],
    queryFn: async () => {
      const response: any = await api.get("/b2b/rfqs", { params: { status: "open", limit: 200 } });

      // The shared API client may return either the raw API envelope
      // ({ success, data: { rfqs } }) or its flattened form
      // ({ success, rfqs, data: { rfqs } }). Normalize both without
      // accidentally turning a valid response into an empty list.
      const candidates = [
        response?.rfqs,
        response?.data?.rfqs,
        response?.data?.data?.rfqs,
        response?.data?.data?.data?.rfqs,
        response?.data?.items,
        response?.data?.data?.items,
        response?.items,
      ];
      const rfqs = candidates.find((value) => Array.isArray(value));
      if (Array.isArray(rfqs)) return { rfqs };

      // An empty list is valid only when the API explicitly returned a
      // recognizable list/count payload; unexpected response shapes should
      // be surfaced as an error instead of misleading farmers with "0 RFQs".
      const knownEmpty = [
        response?.count,
        response?.data?.count,
        response?.data?.data?.count,
      ].some((count) => count === 0);
      if (knownEmpty) return { rfqs: [] };

      throw new Error("The RFQ API returned an unexpected response. Please retry or check the backend response.");
    },
    retry: 2,
  });

  const allRfqs = Array.isArray(rfqData?.rfqs) ? rfqData.rfqs : [];

  const scopeCounts: Record<string, number> = {
    all: allRfqs.length,
    nearby: allRfqs.filter((r: any) => scopeOf(r) === "nearby").length,
    district: allRfqs.filter((r: any) => scopeOf(r) === "district").length,
    state: allRfqs.filter((r: any) => scopeOf(r) === "state").length,
    national: allRfqs.filter((r: any) => scopeOf(r) === "national").length,
  };

  const rfqs = allRfqs
    .filter((r: any) => (scope === "all" ? true : scopeOf(r) === scope))
    .filter((r: any) => !search.trim() || (r.productName || "").toLowerCase().includes(search.trim().toLowerCase()));

  const oneOff = rfqs.filter((r: any) => !r.recurring);
  const recurring = rfqs.filter((r: any) => r.recurring);

  // On the first successful load, select the tab that actually has RFQs.
  // This prevents existing recurring RFQs from appearing to have vanished
  // simply because the empty One-off tab is selected by default.
  useEffect(() => {
    if (hasAutoSelectedView.current || isLoading || isError) return;
    if (oneOff.length === 0 && recurring.length > 0) setView("recurring");
    hasAutoSelectedView.current = true;
  }, [isLoading, isError, oneOff.length, recurring.length]);

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <h2 className="font-semibold">Business RFQs could not be loaded</h2>
            <p className="mt-1 text-sm">{(error as any)?.message || "The RFQ request failed. Check that the backend is running and your farmer session is valid."}</p>
            <Button className="mt-3" variant="outline" onClick={() => refetch()}>Retry loading RFQs</Button>
          </div>
        </div>
      </div>
    );
  }

  const renderRfq = (r: any) => (
    <div key={r.id} className="space-y-2">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">
                {(r.businessInfo?.businessType || "Business").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} ·{" "}
                {r.businessInfo?.businessName || "Business"}
              </p>
              {r.businessInfo?.isVerified ? (
                <span className="flex items-center gap-1 text-xs text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" /> Verified</span>
              ) : null}
              <Badge variant="outline">{scopeOf(r)}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
              {r.distanceKm != null ? <span>📍 {r.distanceKm} km away</span> : null}
              <span>{r.offerCount ?? 0} offers</span>
              {r.closingIn ? <span className="text-amber-700">⏰ closes in {r.closingIn}</span> : null}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <p className="text-lg font-semibold">{r.productName}</p>
              {r.qualityGrade ? <Badge variant="outline">{r.qualityGrade}</Badge> : null}
              {r.recurring ? <Badge variant="outline">recurring</Badge> : <Badge variant="outline">one-off</Badge>}
            </div>
            <p className="mt-1 text-sm text-gray-600">Quantity: {r.quantityKg ?? `${r.quantityPerWeekKg} kg/week`} kg</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
              {r.requiredDate ? (
                <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {r.requiredDate}{r.deliveryTimeSlot ? `, ${r.deliveryTimeSlot}` : ""}</span>
              ) : r.deliveryDays ? (
                <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" /> {r.deliveryDays}</span>
              ) : null}
              {r.deliveryCity ? (
                <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> {r.deliveryCity}{r.deliveryState ? `, ${r.deliveryState}` : ""}</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
              {r.budgetMinPerKg && r.budgetMaxPerKg ? (
                <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700">Business budget ₹{r.budgetMinPerKg}–₹{r.budgetMaxPerKg}/kg</span>
              ) : null}
              {r.priceCeilingPerKg ? <span>Max ₹{r.priceCeilingPerKg}/kg</span> : null}
              {r.canSupply ? (
                <span className="flex items-center gap-1 font-medium text-emerald-600"><CheckCircle className="h-3.5 w-3.5" /> You can supply {r.availableKg} kg</span>
              ) : null}
            </div>
          </div>

          {r.notes ? <p className="text-xs text-gray-500">{r.notes}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-3 text-xs text-gray-400">
              {r.businessInfo?.city ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {r.businessInfo.city}</span> : null}
              {r.rfqNumber ? <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {r.rfqNumber}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              {r.myOfferStatus ? (
                <Badge variant="success" className="gap-1"><CheckCircle className="h-3.5 w-3.5" /> Offered · {r.myOfferStatus}</Badge>
              ) : (
                <Button variant={openFor === r.id ? "outline" : "default"} onClick={() => setOpenFor(openFor === r.id ? null : r.id)}>
                  {openFor === r.id ? "Close" : "Submit Quote"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {openFor === r.id && <QuoteForm rfq={r} onDone={() => setOpenFor(null)} />}
    </div>
  );

  const section = (title: string, description: string, icon: any, list: any[]) => (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{list.length}</span>
          </div>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>
      {list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-8 text-center text-sm text-gray-400">
            <PackageSearch className="mb-2 h-8 w-8 text-gray-300" />
            No open {title.toLowerCase()} right now. Check back soon.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">{list.map(renderRfq)}</div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-emerald-600" />
            <h1 className="text-2xl font-bold">Business RFQs</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Verified businesses are looking for reliable suppliers. Bid on requests that fit your farm.
          </p>
        </div>
        <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔎 Search RFQs…" />
      </div>

      <PillTabs
        value={scope}
        onChange={setScope}
        options={SCOPES.map((s) => ({
          key: s,
          label: s === "all" ? "All" : s === "nearby" ? "Nearby" : s[0].toUpperCase() + s.slice(1),
          icon: s === "nearby" ? <MapPin className="h-4 w-4" /> : undefined,
          count: scopeCounts[s],
        }))}
      />

      {/* One-off / Recurring toggle */}
      <PillTabs
        value={view}
        onChange={(k) => setView(k as "one-off" | "recurring")}
        options={[
          { key: "one-off", label: "One-off Orders", icon: <ShoppingBag className="h-4 w-4" />, count: oneOff.length },
          { key: "recurring", label: "Recurring Supply", icon: <RefreshCw className="h-4 w-4" />, count: recurring.length },
        ]}
      />

      {view === "one-off" ? (
        section("One-off Orders", "Single delivery requests. Bid once and fulfill a one-time order.", <ShoppingBag className="h-5 w-5" />, oneOff)
      ) : (
        section("Recurring Supply", "Ongoing weekly supply contracts with a regular delivery schedule.", <RefreshCw className="h-5 w-5" />, recurring)
      )}
    </div>
  );
}