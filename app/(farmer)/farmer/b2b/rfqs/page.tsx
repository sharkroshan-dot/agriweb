"use client";

import { useState } from "react";
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
} from "lucide-react";
import { api } from "../../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Badge } from "../../../../components/ui/badge";
import toast from "react-hot-toast";

const DELIVERY_METHODS = ["farmer_delivery", "delivery_partner", "dedicated_transport", "buyer_pickup"];
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
              selected ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
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
  const [qty, setQty] = useState(String(rfq.availableKg || rfq.quantityKg || ""));
  const [deliveryCharge, setDeliveryCharge] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("farmer_delivery");
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
          {rfq.quantityKg ?? `${rfq.quantityPerWeekKg} kg/week`} kg
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
          <label className="text-xs font-medium text-gray-500">Available quantity (kg) *</label>
          <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          {rfq.availableKg ? <p className="text-[11px] text-gray-400">Your stock: {rfq.availableKg} kg</p> : null}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Delivery charge (₹)</label>
          <Input type="number" min="0" value={deliveryCharge} onChange={(e) => setDeliveryCharge(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Delivery method</label>
          <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)} className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm">
            {DELIVERY_METHODS.map((m) => (
              <option key={m} value={m}>{m.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</option>
            ))}
          </select>
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
                deliveryMethod,
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

  const { data: rfqData, isLoading } = useQuery({
    queryKey: ["b2b", "farmer", "rfqs"],
    queryFn: () => api.get("/b2b/rfqs", { params: { status: "open" } }),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const allRfqs = rfqData?.data?.rfqs || [];

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

      {rfqs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center text-sm text-gray-400">
            <PackageSearch className="mb-2 h-10 w-10 text-gray-300" />
            No open RFQs in this view right now. Check back soon.
          </CardContent>
        </Card>
      ) : view === "one-off" ? (
        section("One-off Orders", "Single delivery requests. Bid once and fulfill a one-time order.", <ShoppingBag className="h-5 w-5" />, oneOff)
      ) : (
        section("Recurring Supply", "Ongoing weekly supply contracts with a regular delivery schedule.", <RefreshCw className="h-5 w-5" />, recurring)
      )}
    </div>
  );
}