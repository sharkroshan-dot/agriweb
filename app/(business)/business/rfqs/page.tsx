"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Plus, RefreshCw, CheckCircle, Star, ShieldCheck, AlertTriangle, CalendarDays, MapPin, Truck, Bot, ShoppingBag } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { CreateRfqForm } from "../../../components/business/create-rfq-form";
import { AcceptOfferDialog } from "../../../components/business/accept-offer-dialog";

const RFQ_STATUSES = ["", "open", "awarded", "closed", "cancelled"];

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

  const { data: rfqData, isLoading } = useQuery({
    queryKey: ["b2b", "rfqs"],
    queryFn: () => api.get("/b2b/rfqs", { params: { status: statusFilter || "" } }),
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

  const rfqs = (rfqData?.data?.rfqs || []).filter((r: any) =>
    !search.trim() || (r.productName || "").toLowerCase().includes(search.trim().toLowerCase())
  );

  const oneOffRfqs = rfqs.filter((r: any) => !r.recurring);
  const recurringRfqs = rfqs.filter((r: any) => r.recurring);
  const visibleRfqs = view === "one-off" ? oneOffRfqs : recurringRfqs;

  const bestOffer = (offers: any[]) => {
    const pending = offers.filter((o: any) => o.status === "pending");
    if (pending.length === 0) return null;
    const scored = pending.map((o) => {
      const priceScore = Math.max(0, 100 - (o.pricePerKg || 0));
      const ratingScore = (o.farmerInfo?.rating || 0) * 10;
      const verifiedScore = o.farmerInfo?.isVerified ? 8 : 0;
      return { o, score: priceScore * 0.6 + ratingScore + verifiedScore };
    });
    return scored.sort((a, b) => b.score - a.score)[0].o;
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
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            view === "one-off"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          <ShoppingBag className="h-4 w-4" />
          One-off Order
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${view === "one-off" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
            {oneOffRfqs.length}
          </span>
        </button>
        <button
          onClick={() => setView("recurring")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
            view === "recurring"
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700",
          )}
        >
          <RefreshCw className="h-4 w-4" />
          Recurring Order
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${view === "recurring" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
            {recurringRfqs.length}
          </span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {RFQ_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors ${
                statusFilter === s ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
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
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{r.productName}</p>
                      {r.qualityGrade ? <Badge variant="outline">{r.qualityGrade}</Badge> : null}
                      {r.recurring ? <Badge variant="outline">recurring</Badge> : <Badge variant="outline">one-off</Badge>}
                      <Badge variant="outline">{r.visibility}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      {r.quantityKg ?? `${r.quantityPerWeekKg} kg/week`} kg
                      {r.requiredDate ? ` • by ${r.requiredDate}` : ""}
                      {r.deliveryTimeSlot ? ` • ${r.deliveryTimeSlot}` : ""}
                      {r.deliveryCity ? ` • ${r.deliveryCity}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-400">
                      {r.priceCeilingPerKg ? <span>ceiling ₹{r.priceCeilingPerKg}/kg</span> : null}
                      {r.budgetMinPerKg && r.budgetMaxPerKg ? <span>budget ₹{r.budgetMinPerKg}–₹{r.budgetMaxPerKg}/kg</span> : null}
                      <span>{r.offerCount ?? 0} quote(s)</span>
                      {!r.recurring && r.remainingQuantityKg != null ? <span>remaining {r.remainingQuantityKg} kg</span> : null}
                      {r.closingIn ? <span>⏰ closes in {r.closingIn}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant[r.status] || "secondary"}>{r.status}</Badge>
                    {(r.status === "open" || r.status === "awarded") && (
                      <Button variant="outline" size="sm" onClick={() => setExpandedRfq(expandedRfq === r.id ? null : r.id)}>
                        {expandedRfq === r.id ? "Hide offers" : "View offers"}
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
                          const best = bestOffer(offersData?.data?.offers || []);
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
                        {offersData?.data?.offers?.map((o: any) => {
                          const isBest = bestOffer(offersData?.data?.offers || [])?.id === o.id;
                          return (
                            <div key={o.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${isBest && o.status === "pending" ? "border-violet-300 bg-violet-50/40" : ""}`}>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{o.farmerInfo?.farmName || "Farmer"}</p>
                                  {o.farmerInfo?.isVerified ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : null}
                                  {isBest && o.status === "pending" ? <Badge variant="outline" className="text-violet-700">🤖 Best</Badge> : null}
                                </div>
                                <p className="text-sm text-gray-500">
                                  ₹{o.pricePerKg}/kg · {o.availableQuantityKg || o.minOrderKg || 0} kg
                                  {o.deliveryCharge ? ` · delivery ₹${o.deliveryCharge}` : ""} · total ₹{o.totalPrice ?? 0}
                                </p>
                                <p className="flex flex-wrap gap-3 text-xs text-gray-400">
                                  {o.farmerInfo?.rating ? (
                                    <span className="flex items-center gap-1 text-yellow-600"><Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /> {Number(o.farmerInfo.rating).toFixed(1)}</span>
                                  ) : null}
                                  {o.farmerInfo?.city ? <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {o.farmerInfo.city}</span> : null}
                                  {o.expectedDeliveryDate ? <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {o.expectedDeliveryDate}</span> : null}
                                  <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> {(o.deliveryMethod || "farmer_delivery").replace(/_/g, " ")}</span>
                                </p>
                                {o.aboveBudget ? (
                                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> Above your budget ceiling</p>
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
