"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessagesSquare,
  Loader2,
  Bot,
  ShieldCheck,
  Star,
  AlertTriangle,
  CheckCircle,
  Sparkles,
  MapPin,
  Clock,
  Truck,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { AcceptOfferDialog } from "../../../components/business/accept-offer-dialog";
import toast from "react-hot-toast";

function AiScorePill({ score }: { score: number }) {
  const color = score >= 90 ? "bg-emerald-100 text-emerald-700" : score >= 75 ? "bg-blue-100 text-blue-700" : score >= 60 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>{score}%</span>;
}

function DimensionRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

export default function FarmerQuotesPage() {
  const queryClient = useQueryClient();
  const [accepting, setAccepting] = useState<{ offer: any; rfq: any } | null>(null);

  const { data: rfqData, isLoading } = useQuery({
    queryKey: ["b2b", "rfqs"],
    queryFn: () => api.get("/b2b/rfqs", { params: { status: "" } }),
  });

  const rfqs = (rfqData?.data?.rfqs || []).filter(
    (r: any) => ["open", "awarded"].includes(r.status) && (r.offerCount ?? 0) > 0
  );

  const { data: offersByRfq, isFetching: offersLoading } = useQuery({
    queryKey: ["b2b", "quotes", "all"],
    queryFn: async () => {
      const out: Record<string, any[]> = {};
      await Promise.all(
        rfqs.map(async (r: any) => {
          const res = await api.get(`/b2b/rfqs/${r.id}/offers`);
          out[r.id] = res?.data?.offers ?? [];
        })
      );
      return out;
    },
    enabled: rfqs.length > 0,
  });

  const { data: aiByRfq, isFetching: aiLoading } = useQuery({
    queryKey: ["b2b", "quotes", "ai"],
    queryFn: async () => {
      const out: Record<string, any> = {};
      const ids = rfqs.filter((r: any) => (offersByRfq?.[r.id] ?? []).some((o: any) => o.status === "pending")).map((r: any) => r.id);
      await Promise.all(
        ids.map(async (id: string) => {
          const [rank, split] = await Promise.all([
            api.post(`/b2b/rfqs/${id}/ai-rank`),
            api.post(`/b2b/rfqs/${id}/ai-split`),
          ]);
          out[id] = { rank: rank?.data, split: split?.data };
        })
      );
      return out;
    },
    enabled: rfqs.length > 0,
  });

  const acceptSplit = useMutation({
    mutationFn: async ({ rfqId, rows }: { rfqId: string; rows: any[] }) => {
      const results = [];
      for (const row of rows) {
        const res = await api.post(`/b2b/offers/${row.offerId}/accept`, {
          quantityKg: row.quantityKg,
          deliveryMethod: undefined,
          paymentMode: "cod",
          advanceAmount: 0,
        });
        results.push(res);
      }
      return results;
    },
    onSuccess: (res: any) => {
      toast.success(`Split procurement complete — ${res.length} B2B order(s) created.`);
      queryClient.invalidateQueries({ queryKey: ["b2b", "rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
      queryClient.invalidateQueries({ queryKey: ["b2b", "quotes", "all"] });
      queryClient.invalidateQueries({ queryKey: ["b2b", "quotes", "ai"] });
    },
    onError: (err: any) => toast.error(err?.message || "Split acceptance failed"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (rfqs.length === 0) {
    return (
      <Card>
        <CardContent className="py-14 text-center">
          <MessagesSquare className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No pending farmer quotes.</p>
          <p className="text-sm text-gray-400">Publish an RFQ to receive quotes from verified farmers.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <MessagesSquare className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">Farmer Quotes</h1>
      </div>

      {(offersLoading || aiLoading) && rfqs.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> Ranking quotes with AI…
        </div>
      )}

      {rfqs.map((r: any) => {
        const offers = offersByRfq?.[r.id] || [];
        const pending = offers.filter((o: any) => o.status === "pending");
        if (pending.length === 0) return null;
        const ai = aiByRfq?.[r.id];
        const ranking = ai?.rank;
        const scores = ranking?.scores ?? [];
        const bestId = ranking?.best?.offerId;
        const split = ai?.split;

        return (
          <Card key={r.id} className="border-emerald-200">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    {r.productName} — {r.quantityKg ?? `${r.quantityPerWeekKg} kg/week`} kg {r.qualityGrade ? `· ${r.qualityGrade}` : ""}
                  </CardTitle>
                  <CardDescription>
                    {r.deliveryCity ? `Delivery: ${r.deliveryCity}` : ""}
                    {r.requiredDate ? ` · by ${r.requiredDate}${r.deliveryTimeSlot ? ` (${r.deliveryTimeSlot})` : ""}` : ""}
                    {r.closingIn ? ` · closes in ${r.closingIn}` : ""}
                  </CardDescription>
                </div>
                <Badge variant="outline">{pending.length} pending quote(s)</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {ranking?.best && (
                <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-emerald-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                        <Bot className="h-5 w-5 text-violet-600" />
                      </div>
                      <div>
                        <p className="flex items-center gap-2 text-sm font-semibold text-violet-900">
                          AI Procurement Recommendation
                          <AiScorePill score={ranking.best.aiScore} />
                        </p>
                        <p className="text-sm text-gray-700">
                          Recommended supplier: <strong>{ranking.best.farmName}</strong> at ₹{ranking.best.pricePerKg}/kg
                        </p>
                      </div>
                    </div>
                    {ranking.reason ? (
                      <p className="flex items-start gap-1.5 text-xs text-gray-600 sm:max-w-md">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                        <span>{ranking.reason}</span>
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      { label: "Quantity", value: `${ranking.best.availableQuantityKg} kg` },
                      { label: "Rating", value: ranking.best.isVerified ? "✓ Verified" : "Unverified" },
                      { label: "On-time", value: `${ranking.best.onTimeRate}%` },
                      { label: "Distance", value: ranking.best.distanceKm != null ? `${ranking.best.distanceKm} km` : "—" },
                    ].map((d) => (
                      <div key={d.label} className="rounded-lg bg-white/70 p-2 text-center">
                        <p className="text-[11px] text-gray-400">{d.label}</p>
                        <p className="text-sm font-medium text-slate-800">{d.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {split && split.rows?.length > 0 && !split.possible && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    <strong>No single farmer covers the full quantity</strong> — quoted availability covers only {split.totalQuantityKg} of {split.targetQuantityKg} kg. The AI split below shows the best available allocation.
                  </span>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Supplier</th>
                      {scores.map((o: any) => {
                        const isBest = o.offerId === bestId;
                        return (
                          <th key={o.offerId} className="px-2 pb-2">
                            <div className={`rounded-lg p-2 text-left ${isBest ? "bg-violet-50 ring-1 ring-violet-200" : ""}`}>
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-slate-900">{o.farmName}</p>
                                <AiScorePill score={o.aiScore} />
                              </div>
                              <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                                {o.rating ? (
                                  <span className="flex items-center gap-0.5 text-yellow-600">
                                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" /> {Number(o.rating).toFixed(1)}
                                  </span>
                                ) : null}
                                {o.isVerified ? <ShieldCheck className="h-3 w-3 text-emerald-600" /> : null}
                                {isBest ? <Badge variant="outline" className="text-violet-700">🤖 Best</Badge> : null}
                              </p>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Price / kg", value: (o: any) => `₹${o.pricePerKg}` },
                      { label: "Available qty", value: (o: any) => `${o.availableQuantityKg} kg` },
                      { label: "Quality", value: (o: any) => o.qualityGrade || "—" },
                      { label: "Distance", value: (o: any) => (o.distanceKm != null ? `${o.distanceKm} km` : "—") },
                      { label: "On-time rate", value: (o: any) => `${o.onTimeRate}%` },
                      { label: "Delivery", value: (o: any) => (o.deliveryMethod || "farmer_delivery").replace(/_/g, " ") },
                      { label: "Expected delivery", value: (o: any) => o.expectedDeliveryDate || "—" },
                    ].map((row) => (
                      <tr key={row.label} className="border-b border-dashed border-gray-100">
                        <td className="py-2 pr-2 text-xs font-medium text-gray-500">{row.label}</td>
                        {scores.map((o: any) => (
                          <td key={o.offerId} className={`px-2 py-2 ${o.offerId === bestId ? "bg-violet-50/40" : ""}`}>
                            {row.value(o)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {scores[0]?.aboveBudget != null && (
                      <tr className="border-b border-dashed border-gray-100">
                        <td className="py-2 pr-2 text-xs font-medium text-gray-500">Budget check</td>
                        {scores.map((o: any) => (
                          <td key={o.offerId} className={`px-2 py-2 ${o.offerId === bestId ? "bg-violet-50/40" : ""}`}>
                            {o.aboveBudget ? (
                              <span className="flex items-center gap-1 text-xs text-amber-700">
                                <AlertTriangle className="h-3 w-3" /> Above ceiling
                              </span>
                            ) : (
                              <span className="text-xs text-emerald-600">Within budget</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    )}
                    <tr>
                      <td />
                      {scores.map((o: any) => {
                        const offer = pending.find((p: any) => p.id === o.offerId);
                        return (
                          <td key={o.offerId} className={`px-2 pt-3 ${o.offerId === bestId ? "bg-violet-50/40" : ""}`}>
                            <Button size="sm" className="w-full" onClick={() => offer && setAccepting({ offer, rfq: r })}>
                              <CheckCircle className="mr-1.5 h-4 w-4" /> Select
                            </Button>
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              {ranking?.scores?.length ? (
                <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    <Sparkles className="h-3.5 w-3.5" /> AI score breakdown
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {scores.map((o: any) => (
                      <div key={o.offerId} className={`rounded-lg border p-3 ${o.offerId === bestId ? "border-violet-200 bg-violet-50/50" : "bg-white"}`}>
                        <p className="mb-1 flex items-center justify-between text-sm font-medium">
                          {o.farmName} <AiScorePill score={o.aiScore} />
                        </p>
                        <DimensionRow label="Price" value={`${o.dimensions?.price ?? 0}%`} />
                        <DimensionRow label="Availability" value={`${o.dimensions?.coverage ?? 0}%`} />
                        <DimensionRow label="Quality" value={`${o.dimensions?.quality ?? 0}%`} />
                        <DimensionRow label="Rating" value={`${o.dimensions?.rating ?? 0}%`} />
                        <DimensionRow label="Distance" value={`${o.dimensions?.distance ?? 0}%`} />
                        <DimensionRow label="Delivery" value={`${o.dimensions?.delivery ?? 0}%`} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {split?.rows?.length ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                    <Bot className="h-4 w-4" /> AI Suggested Split Procurement
                  </p>
                  {split.possible ? null : (
                    <p className="mt-1 text-xs text-amber-700">{split.reason}</p>
                  )}
                  <div className="mt-2 space-y-1 text-sm">
                    {split.rows.map((row: any) => (
                      <div key={row.offerId} className="flex justify-between text-gray-700">
                        <span>{row.farmName} — {row.quantityKg} kg @ ₹{row.pricePerKg}/kg</span>
                        <span className="font-medium">₹{row.amount}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-1 font-semibold text-emerald-800">
                      <span>TOTAL {split.totalQuantityKg} kg (target {split.targetQuantityKg} kg)</span>
                      <span>≈ ₹{split.estimatedTotal ?? 0}</span>
                    </div>
                  </div>
                  {split.possible ? (
                    <Button
                      size="sm"
                      className="mt-3"
                      disabled={acceptSplit.isPending}
                      onClick={() => acceptSplit.mutate({ rfqId: r.id, rows: split.rows })}
                    >
                      {acceptSplit.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1.5 h-4 w-4" />}
                      Accept Split Procurement
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}

      {accepting && (
        <AcceptOfferDialog
          offer={accepting.offer}
          rfq={accepting.rfq}
          onClose={() => setAccepting(null)}
        />
      )}
    </div>
  );
}
