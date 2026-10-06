"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  PackageSearch,
  RefreshCw,
  Truck,
  ShoppingBasket,
} from "lucide-react";
import { api } from "../../../../lib/api/client";
import { Card, CardContent } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import toast from "react-hot-toast";

export default function EventSourcingPage() {
  const params = useParams<{ requestId: string }>();
  const requestId = params.requestId;
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [selectedOffers, setSelectedOffers] = useState<string[]>([]);

  const { data: requestData, isLoading: requestLoading } = useQuery({
    queryKey: ["bulk", "request", requestId],
    queryFn: () => api.get(`/bulk-orders/requests/${requestId}`),
    enabled: Boolean(requestId),
  });

  const request = requestData?.data;
  const isFamilyWeekly = request?.purchaseMode === "family_weekly" || request?.isManualWeeklyFamilyBasket === true;

  const sourceMutation = useMutation({
    mutationFn: () => {
      const delivery = request?.requestedDeliveryDate ? new Date(`${request.requestedDeliveryDate}T00:00:00`) : null;
      const plannedByDate = Boolean(delivery && delivery.getTime() - Date.now() > 24 * 60 * 60 * 1000);
      const planned = !isFamilyWeekly && (request?.eventSourcingMode === "planned_rfq" || plannedByDate);
      return api.post(`/bulk-orders/requests/${requestId}/${planned ? "planned-source" : "smart-source"}`, {});
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["bulk", "request", requestId] });
      if (res?.data?.missing?.length) {
        toast.error("Some requested quantities are not currently available.");
      } else if (res?.data?.sourcingMode === "planned_rfq") {
        toast.success("Smart sourcing completed. Eligible farmers have received the RFQ.");
      } else {
        toast.success(isFamilyWeekly ? "Available farmer stock found." : "Urgent nearby live stock found.");
      }
    },
    onError: (err: any) => toast.error(err?.message || "Could not start sourcing"),
  });

  const summaryQuery = useQuery({
    queryKey: ["event", "summary", requestId],
    queryFn: () => api.get(`/bulk-orders/event-orders/${requestId}/summary`),
    enabled: Boolean(requestId && (confirmed || request?.eventSourcingStatus === "confirmed")),
    refetchInterval: confirmed ? 5000 : false,
  });

  useEffect(() => {
    if (request && request.requestType === "bulk_event" && !request.eventSourcingPlan && !sourceMutation.isPending) {
      sourceMutation.mutate();
    }
  }, [request?.id, request?.eventSourcingPlan]);

  const sourcing = request?.eventSourcingPlan;
  const planned = !isFamilyWeekly && sourcing?.sourcingMode === "planned_rfq";
  const offers = request?.offers || [];
  const rankedOffers = useMemo(() => {
    if (!offers.length) return [];
    const maxPrice = Math.max(...offers.map((o: any) => Number(o.totalPrice || 0)), 1);
    return [...offers].map((offer: any) => {
      const coverage = Number(offer.coveragePercent || 0);
      const rating = Number(offer.farmerInfo?.rating || 0);
      const distance = Number((sourcing?.plan || []).flatMap((row: any) => row.candidates || []).find((c: any) => String(c.farmerId) === String(offer.farmerId))?.distanceKm || 999);
      const priceScore = Math.max(0, 100 - (Number(offer.totalPrice || 0) / maxPrice) * 100);
      const distanceScore = distance >= 999 ? 0 : Math.max(0, 100 - Math.min(distance, 100));
      const score = priceScore * 0.35 + coverage * 0.30 + (rating / 5) * 100 * 0.20 + distanceScore * 0.15;
      return { ...offer, smartScore: Math.round(score * 10) / 10, smartDistance: distance };
    }).sort((a: any, b: any) => b.smartScore - a.smartScore);
  }, [offers, sourcing]);
  const recommendedOfferId = rankedOffers[0]?.id;
  const allocations = useMemo(
    () =>
      (sourcing?.plan || []).flatMap((row: any) =>
        (row.allocations || []).map((a: any) => ({
          productName: row.productName,
          farmerId: a.farmerId,
          productId: a.productId,
          quantityKg: a.quantityKg,
          farmName: a.farmName,
          distanceKm: a.distanceKm,
        }))
      ),
    [sourcing]
  );

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/bulk-orders/requests/${requestId}/${planned ? "planned-confirm" : "confirm-source"}`,
        planned ? { offerIds: selectedOffers } : { allocations },
      ),
    onSuccess: () => {
      setConfirmed(true);
      toast.success(planned ? "Quotes confirmed. Live inventory is now reserved." : isFamilyWeekly ? "Stock reserved. Your weekly family basket is being prepared." : "Urgent sourcing confirmed. Stock has been reserved.");
      queryClient.invalidateQueries({ queryKey: ["bulk", "request", requestId] });
      queryClient.invalidateQueries({ queryKey: ["event", "summary", requestId] });
    },
    onError: (err: any) => toast.error(err?.message || "Could not confirm sourcing"),
  });

  if (requestLoading || !request) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const urgent = Boolean(sourcing?.urgent) && !planned;
  const missing = sourcing?.missing || [];
  const isConfirmed = confirmed || request.eventSourcingStatus === "confirmed";
  const fulfillmentRows = summaryQuery.data?.data?.fulfillmentSummary || {};
  const fulfillmentCount = summaryQuery.data?.data?.fulfillmentCount || 0;
  const steps = isFamilyWeekly
    ? ["Smart Sourcing", "Your Selection", "Reserve Stock", "Fulfillment"]
    : planned
      ? ["Smart Sourcing", "Farmer Quotes", "Your Selection", "Reserve Stock", "Fulfillment"]
      : ["Smart Sourcing", "Your Selection", "Reserve Stock", "Fulfillment"];
  const activeStep = isConfirmed ? steps.length : planned ? (offers.length ? 3 : 2) : sourcing ? 2 : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                {isFamilyWeekly ? <ShoppingBasket className="h-5 w-5 text-emerald-600" /> : <PackageSearch className="h-5 w-5 text-emerald-600" />}
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                  {isFamilyWeekly ? "Weekly Family Basket" : planned ? "Planned Event Sourcing" : "Urgent Event Sourcing"}
                </h1>
                <p className="mt-1 text-sm text-slate-500">{request.requestNumber} · {request.purpose}{request.guestCount ? ` · ${request.guestCount} guests` : ""}</p>
              </div>
            </div>
          </div>
          <Badge variant={isConfirmed ? "success" : urgent ? "warning" : "secondary"} className="w-fit">
            {isConfirmed ? "Stock Reserved" : planned ? "Waiting for Quotes" : urgent ? "Urgent · ≤24h" : "Finding Stock"}
          </Badge>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 ">
          {steps.map((step, index) => {
            const done = activeStep > index + 1;
            const current = activeStep === index + 1;
            return (
              <div key={step} className={`rounded-xl border px-3 py-2.5 ${done ? "border-emerald-200 bg-emerald-50" : current ? "border-slate-300 bg-slate-50" : "border-slate-100 bg-white"}`}>
                <div className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-600 text-white" : current ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {done ? "✓" : index + 1}
                  </span>
                  <span className={`text-xs font-medium ${current || done ? "text-slate-800" : "text-slate-400"}`}>{step}</span>
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {isFamilyWeekly ? (
        <Card className="border-emerald-100 bg-white shadow-sm">
          <CardContent className="flex items-start gap-3 p-4">
            <ShoppingBasket className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-900">One-time weekly purchase</p>
              <p className="text-sm text-emerald-800">
                AgriConnect is checking live farmer stock, availability and distance. This is not a subscription and no farmer quote is required.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : urgent && !isConfirmed ? (
        <Card className="border-amber-100 bg-white shadow-sm">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Urgent Event — Smart Sourcing</p>
              <p className="text-sm text-amber-800">
                Delivery is within 24 hours. AgriConnect is prioritizing nearby live inventory and the shortest reliable fulfillment path.
              </p>
              {sourcing?.hoursUntilDelivery != null ? (
                <p className="mt-1 text-xs text-amber-700">{sourcing.hoursUntilDelivery} hours until requested delivery.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {planned && !isConfirmed ? (
        <Card className="border-blue-100 bg-white shadow-sm">
          <CardContent className="space-y-3 p-5">
            <div>
              <p className="font-semibold text-blue-900">Planned Event — Request Farmer Quotes</p>
              <p className="text-sm text-blue-800">Smart sourcing has identified suitable farmers using live stock, quantity coverage, distance and rating. Distance is a recommendation factor, not a hard requirement.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {offers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-blue-200 bg-white p-4 text-sm text-slate-500 md:col-span-2">
                  Waiting for eligible farmers to submit quotes.
                </div>
              ) : (
                rankedOffers.map((offer: any) => {
                  const checked = selectedOffers.includes(offer.id);
                  const total = Number(offer.totalPrice || 0);
                  const coverage = Number(offer.coveragePercent || 0);
                  const rating = Number(offer.farmerInfo?.rating || 0);
                  const distance = offer.smartDistance;
                  return (
                    <button
                      type="button"
                      key={offer.id}
                      onClick={() => setSelectedOffers((current) => checked ? current.filter((id) => id !== offer.id) : [...current, offer.id])}
                      className={`rounded-2xl border p-4 text-left transition-all ${checked ? "border-emerald-500 bg-emerald-50/30 ring-1 ring-emerald-500" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                            {(offer.farmerInfo?.farmName || "F").slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{offer.farmerInfo?.farmName || "Farmer"}</p>
                            <p className="text-xs text-slate-500">{offer.farmerInfo?.city || "Location not provided"}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {offer.id === recommendedOfferId ? <Badge variant="success">Recommended</Badge> : null}
                          <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[11px] text-slate-500">Total</p>
                          <p className="mt-0.5 font-semibold text-slate-900">₹{total.toLocaleString("en-IN")}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[11px] text-slate-500">Coverage</p>
                          <p className="mt-0.5 font-semibold text-slate-900">{coverage.toFixed(0)}%</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[11px] text-slate-500">Rating</p>
                          <p className="mt-0.5 font-semibold text-slate-900">★ {rating.toFixed(1)}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-3 py-2">
                          <p className="text-[11px] text-slate-500">Distance</p>
                          <p className="mt-0.5 font-semibold text-slate-900">{distance < 999 ? `${distance} km` : "—"}</p>
                        </div>
                      </div>
                      {offer.id === recommendedOfferId ? (
                        <p className="mt-3 text-xs text-emerald-700">Best overall balance of price, coverage, reliability and distance.</p>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            {offers.length > 0 ? (
              <p className="text-xs text-slate-500">You can select one farmer or combine multiple quotes. The recommendation is only a guide — you remain in control.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isConfirmed ? (
        <Card className="border-emerald-100 bg-white shadow-sm">
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-900">
                {isFamilyWeekly ? "Stock reserved and farmer fulfillment created" : "Stock reserved and farmer fulfillment created"}
              </p>
              <p className="text-sm text-emerald-800">
                {fulfillmentCount} farmer fulfillment allocation(s) are now being prepared.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Products and available farmers</h2>
              <p className="text-sm text-slate-500">
                {isFamilyWeekly
                  ? "Smart sourcing can split your basket across suitable farmers based on live stock and distance."
                  : "One event order can be fulfilled by multiple farmers."}
              </p>
            </div>
            {!isConfirmed ? (
              <Button variant="outline" size="sm" onClick={() => sourceMutation.mutate()} disabled={sourceMutation.isPending}>
                {sourceMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Search Again
              </Button>
            ) : null}
          </div>

          <div className="space-y-3">
            {(sourcing?.plan || request.items || []).map((row: any, index: number) => {
              const required = Number(row.requiredKg ?? row.quantityKg ?? 0);
              const selected = Number(row.selectedKg ?? 0);
              const shortage = Number(row.shortageKg ?? Math.max(0, required - selected));
              return (
                <div key={row.productName || row.name || index} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{row.productName || row.name}</p>
                      <p className="text-sm text-slate-500">Required: {required} kg</p>
                    </div>
                    <Badge variant={shortage > 0 ? "destructive" : "success"}>
                      {shortage > 0 ? `Short ${shortage} kg` : `Fully sourced · ${selected} kg`}
                    </Badge>
                  </div>

                  {(row.allocations || []).length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {row.allocations.map((a: any, i: number) => (
                        <div key={`${a.farmerId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <span className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-emerald-600" />
                            <span className="font-medium">{a.farmName}</span>
                            {a.distanceKm < 999 ? (
                              <span className="flex items-center gap-1 text-xs text-slate-500"><MapPin className="h-3.5 w-3.5" />{a.distanceKm} km</span>
                            ) : null}
                          </span>
                          <span className="font-semibold">{a.quantityKg} kg</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">No live stock found.</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {missing.length > 0 && !isConfirmed ? (
        <Card className="border-red-100 bg-white">
          <CardContent className="space-y-2 p-5">
            <p className="font-semibold text-red-700">Cannot guarantee the complete order yet</p>
            {missing.map((m: any) => (
              <div key={m.productName} className="flex justify-between text-sm">
                <span>{m.productName}</span>
                <span className="font-medium text-red-600">{m.shortageKg} kg shortage</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-slate-500">
              Try again after stock changes, or adjust the required quantity before confirming.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!isConfirmed && !planned ? (
        <Button
          className="w-full"
          size="lg"
          disabled={Boolean(missing.length) || allocations.length === 0 || confirmMutation.isPending || sourceMutation.isPending}
          onClick={() => confirmMutation.mutate()}
        >
          {confirmMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          {isFamilyWeekly ? "Confirm & Reserve Stock" : "Confirm Sourcing & Reserve Stock"}
        </Button>
      ) : planned && !isConfirmed ? (
        <Button
          className="w-full"
          size="lg"
          disabled={selectedOffers.length === 0 || confirmMutation.isPending || offers.length === 0}
          onClick={() => confirmMutation.mutate()}
        >
          {confirmMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Confirm Selected Quote{selectedOffers.length === 1 ? "" : "s"} & Reserve Inventory
        </Button>
      ) : (
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 font-semibold">
              {isFamilyWeekly ? "Weekly basket fulfillment" : "Event fulfillment tracking"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(fulfillmentRows).map(([name, value]: any) => (
                <div key={name} className="rounded-xl border p-3">
                  <p className="font-medium">{name}</p>
                  <p className="text-xs text-slate-500">{value.allocatedKg} / {value.requiredKg} kg allocated</p>
                  <p className="mt-1 text-xs capitalize text-emerald-700">{(value.status?.[0] || "pending").replace(/_/g, " ")}</p>
                </div>
              ))}
            </div>
            {request.eventDeliveryStatus === "ready_for_event_delivery" ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                <Clock3 className="h-4 w-4" /> All farmer allocations collected. Event delivery is ready.
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">
                Farmers will accept, pack and mark each allocation ready for collection. AgriConnect will consolidate the order before final delivery.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}