"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Plus, RefreshCw, CheckCircle, Star, ShieldCheck, AlertTriangle, CalendarDays, MapPin, Truck, Bot, ShoppingBag, PackageSearch, Clock } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { CreateRfqForm } from "../../../components/business/create-rfq-form";
import { AcceptOfferDialog } from "../../../components/business/accept-offer-dialog";

const RFQ_STATUSES = ["", "open", "awarded", "closed", "cancelled"];

function formatRfqDeadline(rfq: any): string | null {
  const raw = rfq.deadline ?? rfq.closesAt ?? rfq.closingAt ?? rfq.closingDate ?? null;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date) + " IST";
}

const statusVariant: Record<string, any> = {
  open: "success",
  awarded: "secondary",
  closed: "outline",
  cancelled: "destructive",
};

function AcceptDialog({ offer, rfq, onClose }: { offer: any; rfq: any; onClose: () => void }) {
  return <AcceptOfferDialog offer={offer} rfq={rfq} onClose={onClose} />;
}

export default function BusinessRfqsPage() {
  const [showForm, setShowForm] = useState(false);
  const [expandedRfq, setExpandedRfq] = useState<string | null>(null);
  const [acceptingOffer, setAcceptingOffer] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"one-off" | "recurring">("one-off");

  const { data: rfqData, isLoading, isError, error, refetch } = useQuery({
    // Load the complete RFQ list once; status tabs filter it locally so each
    // tab reliably shows only matching orders regardless of backend query behavior.
    queryKey: ["b2b", "rfqs"],
    queryFn: () => api.get("/b2b/rfqs", { params: { status: "" } }),
  });

  const { data: offersData, isFetching: offersLoading } = useQuery({
    queryKey: ["b2b", "rfq", "offers", expandedRfq],
    queryFn: () => api.get(`/b2b/rfqs/${expandedRfq}/offers`),
    enabled: Boolean(expandedRfq),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-amber-600" />
          <h2 className="font-semibold text-slate-900">Could not load your RFQs</h2>
          <p className="max-w-md text-sm text-slate-500">
            Your RFQ data has not been changed. Check your connection and try again.
            {error instanceof Error && error.message ? ` Details: ${error.message}` : ""}
          </p>
          <Button onClick={() => refetch()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const rawRfqs = rfqData?.data?.rfqs ?? rfqData?.rfqs ?? rfqData?.data?.data?.rfqs ?? [];
  const allRfqs = Array.isArray(rawRfqs) ? rawRfqs : [];
  const rfqs = allRfqs.filter((r: any) => {
    const matchesStatus =
      !statusFilter || String(r.status || "").toLowerCase() === statusFilter.toLowerCase();
    const matchesSearch =
      !search.trim() || String(r.productName || "").toLowerCase().includes(search.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const oneOffRfqs = rfqs.filter((r: any) => !r.recurring);
  const recurringRfqs = rfqs.filter((r: any) => r.recurring);
  const visibleRfqs = view === "one-off" ? oneOffRfqs : recurringRfqs;

  const rankOffers = (rfq: any, offers: any[]) => {
    const requested = Number(rfq.remainingQuantityKg ?? rfq.quantityKg ?? rfq.quantityPerWeekKg ?? 0);
    const budget = Number(rfq.budgetMaxPerKg ?? rfq.priceCeilingPerKg ?? 0);
    return offers.map((o: any) => {
      const price = Number(o.pricePerKg ?? 0);
      const quantity = Number(o.availableQuantityKg ?? o.minOrderKg ?? 0);
      const rating = Number(o.farmerInfo?.rating ?? 0);
      const withinBudget = budget <= 0 || price <= budget;
      const canCoverRemaining = requested > 0 && quantity >= requested;
      const priceScore = budget > 0 ? Math.max(0, 100 - (price / budget) * 100) : Math.max(0, 100 - price);
      const ratingScore = Math.min(5, Math.max(0, rating)) * 12;
      const verificationScore = o.farmerInfo?.isVerified ? 10 : 0;
      const quantityScore = requested > 0 ? Math.min(100, (quantity / requested) * 100) * 0.2 : 10;
      const budgetScore = withinBudget ? 15 : -35;
      const score = priceScore * 0.45 + ratingScore + verificationScore + quantityScore + budgetScore;
      return { ...o, _rankScore: score, _withinBudget: withinBudget, _canCoverRemaining: canCoverRemaining };
    }).sort((a: any, b: any) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (b.status === "pending" && a.status !== "pending") return 1;
      return b._rankScore - a._rankScore;
    });
  };
  const bestOffer = (rfq: any, offers: any[]) => {
    const pending = rankOffers(rfq, offers).filter((o: any) => String(o.status).toLowerCase() === "pending");
    return pending[0] ?? null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">My Requests for Quote</h1>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? <RefreshCw className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "New RFQ"}
        </Button>
      </div>

      {showForm && <CreateRfqForm onDone={() => setShowForm(false)} />}

      {/* One-off / Recurring toggle */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setView("one-off")}
          aria-pressed={view === "one-off"}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            view === "one-off"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700",
          )}
        >
          <ShoppingBag className="h-4 w-4" />
          One-off Order
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${view === "one-off" ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"}`}>
            {oneOffRfqs.length}
          </span>
        </button>
        <button
          onClick={() => setView("recurring")}
          aria-pressed={view === "recurring"}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            view === "recurring"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700",
          )}
        >
          <RefreshCw className="h-4 w-4" />
          Recurring Order
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${view === "recurring" ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"}`}>
            {recurringRfqs.length}
          </span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1 rounded-xl bg-slate-100 p-1 sm:flex-nowrap">
          {RFQ_STATUSES.map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
                statusFilter === s
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
              }`}
            >
              {s === "" ? "All" : s}
            </button>
          ))}
        </div>
        <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" />
      </div>

      {rfqs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-400">
            No RFQs match. Publish one to start receiving farmer quotes.
          </CardContent>
        </Card>
      ) : visibleRfqs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-400">
            No {view} order RFQs match. Publish one to start receiving farmer quotes.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleRfqs.map((r: any) => (
            <div key={r.id} className="space-y-2">
              <Card>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">{r.productName || "Product request"}</h3>
                        {r.qualityGrade ? <Badge variant="outline">{r.qualityGrade}</Badge> : null}
                        <Badge variant="outline">{r.recurring ? "Recurring supply" : "One-off order"}</Badge>
                        <Badge variant="outline">{String(r.visibility || "state").replace(/^./, (v: string) => v.toUpperCase())} reach</Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        {r.recurring
                          ? `Regular supply: ${r.quantityPerWeekKg ?? r.quantityKg ?? "—"} kg per week`
                          : `Requested quantity: ${r.quantityKg ?? "—"} kg`}
                      </p>
                    </div>
                    <Badge variant={statusVariant[String(r.status || "").toLowerCase()] || "secondary"}>
                      {({ open: "Open for quotes", awarded: "Awarded", closed: "Closed", cancelled: "Cancelled" } as Record<string, string>)[String(r.status || "").toLowerCase()] || String(r.status || "Unknown")}
                    </Badge>
                  </div>

                  <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="flex items-start gap-2">
                      <PackageSearch className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <div><p className="text-xs text-slate-500">Quantity needed</p><p className="text-sm font-semibold text-slate-800">{r.recurring ? `${r.quantityPerWeekKg ?? r.quantityKg ?? "—"} kg/week` : `${r.quantityKg ?? "—"} kg`}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <div><p className="text-xs text-slate-500">Delivery location</p><p className="text-sm font-semibold text-slate-800">{[r.deliveryCity, r.deliveryDistrict, r.deliveryState].filter(Boolean).join(", ") || "Not specified"}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <div><p className="text-xs text-slate-500">{r.recurring ? "Supply schedule" : "Required by"}</p><p className="text-sm font-semibold text-slate-800">{r.recurring ? (r.deliveryDays || "Schedule to be confirmed") : (r.requiredDate || "Date not specified")}{!r.recurring && r.deliveryTimeSlot ? ` · ${r.deliveryTimeSlot}` : ""}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <div><p className="text-xs text-slate-500">Buyer budget</p><p className="text-sm font-semibold text-slate-800">{r.budgetMinPerKg != null && r.budgetMaxPerKg != null ? `₹${r.budgetMinPerKg}–₹${r.budgetMaxPerKg}/kg` : r.priceCeilingPerKg != null ? `Up to ₹${r.priceCeilingPerKg}/kg` : "Not specified"}</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Bot className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <div><p className="text-xs text-slate-500">Farmer quotes received</p><p className="text-sm font-semibold text-slate-800">{r.offerCount ?? 0} quotes</p></div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                      <div><p className="text-xs text-slate-500">Quote deadline</p><p className="text-sm font-semibold text-slate-800">{formatRfqDeadline(r) || r.closingIn || "No deadline specified"}</p></div>
                    </div>
                  </div>

                  {r.notes ? <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2"><p className="text-xs font-medium text-amber-900">Additional requirements</p><p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">{r.notes}</p></div> : null}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <p className="text-xs text-slate-500">{!r.recurring && r.remainingQuantityKg != null ? `${r.remainingQuantityKg} kg still to source` : r.recurring ? "Recurring procurement" : "One-time procurement"}</p>
                    {(String(r.status || "").toLowerCase() === "open" || String(r.status || "").toLowerCase() === "awarded") && (
                      <Button variant="outline" size="sm" onClick={() => setExpandedRfq(expandedRfq === r.id ? null : r.id)}>
                        {expandedRfq === r.id ? "Hide farmer quotes" : `View farmer quotes (${r.offerCount ?? 0})`}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {expandedRfq === r.id && (
                <Card className="border-emerald-200">
                  <CardHeader>
                    <CardTitle className="text-sm">Farmer quotes for {r.productName}</CardTitle>
                    <CardDescription>
                      {r.recurring
                        ? "Accepting awards the full recurring supply order."
                        : `Split procurement enabled — accept multiple farmers until ${r.quantityKg} kg is covered (${r.remainingQuantityKg ?? r.quantityKg} kg remaining).`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {offersLoading ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                      </div>
                    ) : (offersData?.data?.offers ?? []).length === 0 ? (
                      <p className="py-4 text-center text-sm text-gray-400">No quotes yet — share the RFQ with your farmers.</p>
                    ) : (
                      <>
                        {(() => {
                          const best = bestOffer(r, offersData?.data?.offers || []);
                          return best ? (
                            <div className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
                              <Bot className="h-4 w-4 shrink-0" />
                              <span>
                                <strong>Best overall value:</strong> {best.farmerInfo?.farmName} at ₹{best.pricePerKg}/kg
                                {best.farmerInfo?.rating ? ` · ★ ${Number(best.farmerInfo.rating).toFixed(1)}` : ""}
                                {best.farmerInfo?.isVerified ? " · verified" : ""} — good price, quality and supply.
                              </span>
                            </div>
                          ) : null;
                        })()}
                        {rankedOffers.map((o: any) => {
                          const rankedOffers = rankOffers(r, offersData?.data?.offers || []);
                          const isBest = bestOffer(r, offersData?.data?.offers || [])?.id === o.id;
                          return (
                            <div key={o.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${isBest && o.status === "pending" ? "border-violet-300 bg-violet-50/40" : ""}`}>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{o.farmerInfo?.farmName || "Farmer"}</p>
                                  {o.farmerInfo?.isVerified ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : null}
                                  {isBest && o.status === "pending" ? <Badge variant="outline" className="text-violet-700">🤖 Best</Badge> : null}
                                </div>
                                <div className="mt-1 grid gap-2 text-sm sm:grid-cols-3">
                                  <p className="text-slate-700"><span className="text-xs text-slate-500">Price</span><br /><strong>₹{o.pricePerKg}/kg</strong></p>
                                  <p className="text-slate-700"><span className="text-xs text-slate-500">Can supply</span><br /><strong>{o.availableQuantityKg || o.minOrderKg || 0} kg</strong></p>
                                  <p className="text-slate-700"><span className="text-xs text-slate-500">Est. value of available quantity</span><br /><strong>₹{(Number(o.pricePerKg || 0) * Number(o.availableQuantityKg || o.minOrderKg || 0)).toLocaleString("en-IN")}</strong></p>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  <Badge variant={o._withinBudget ? "success" : "destructive"}>{o._withinBudget ? "Within budget" : "Above budget"}</Badge>
                                  <Badge variant={o._canCoverRemaining ? "success" : "outline"}>{o._canCoverRemaining ? "Covers remaining quantity" : "Partial supply"}</Badge>
                                  {o.farmerInfo?.isVerified ? <Badge variant="outline">Verified farmer</Badge> : <Badge variant="outline">Verification unavailable</Badge>}
                                </div>
                                <p className="flex flex-wrap gap-3 text-xs text-gray-400">
                                  {o.farmerInfo?.rating ? (
                                    <span className="flex items-center gap-1 text-yellow-600"><Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /> {Number(o.farmerInfo.rating).toFixed(1)}</span>
                                  ) : null}
                                  {o.farmerInfo?.city ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {o.farmerInfo.city}</span> : null}
                                  {o.expectedDeliveryDate ? <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {o.expectedDeliveryDate}</span> : null}
                                  <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> {(o.deliveryMethod || "farmer_delivery").replace(/_/g, " ")}</span>
                                </p>
                                {!o._withinBudget ? (
                                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> This quote exceeds the RFQ budget. Review before accepting.</p>
                                ) : null}
                                {o.message ? <p className="mt-1 text-xs text-gray-500">{o.message}</p> : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={o.status === "accepted" ? "success" : "secondary"}>{o.status}</Badge>
                                {o.status === "pending" && (
                                  <Button size="sm" onClick={() => setAcceptingOffer(o)}>
                                    <CheckCircle className="mr-1.5 h-4 w-4" /> Accept
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ))}
        </div>
      )}

      {acceptingOffer && (
        <AcceptDialog
          offer={acceptingOffer}
          rfq={rfqs.find((r: any) => r.id === expandedRfq)}
          onClose={() => setAcceptingOffer(null)}
        />
      )}
    </div>
  );
}
