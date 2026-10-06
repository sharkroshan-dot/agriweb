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

  const { data: requestData, isLoading: requestLoading } = useQuery({
    queryKey: ["bulk", "request", requestId],
    queryFn: () => api.get(`/bulk-orders/requests/${requestId}`),
    enabled: Boolean(requestId),
  });

  const request = requestData?.data;

  const sourceMutation = useMutation({
    mutationFn: () => api.post(`/bulk-orders/requests/${requestId}/smart-source`, {}),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["bulk", "request", requestId] });
      if (res?.data?.missing?.length) {
        toast.error("Some event quantities are not currently available.");
      } else {
        toast.success("Nearby live stock found for the complete event order.");
      }
    },
    onError: (err: any) => toast.error(err?.message || "Could not search nearby stock"),
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
      api.post(`/bulk-orders/requests/${requestId}/confirm-source`, {
        allocations,
      }),
    onSuccess: () => {
      setConfirmed(true);
      toast.success("Event sourcing confirmed. Stock has been reserved.");
      queryClient.invalidateQueries({ queryKey: ["bulk", "request", requestId] });
      queryClient.invalidateQueries({ queryKey: ["event", "summary", requestId] });
    },
    onError: (err: any) => toast.error(err?.message || "Could not confirm event sourcing"),
  });

  if (requestLoading || !request) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const urgent = Boolean(sourcing?.urgent);
  const missing = sourcing?.missing || [];
  const isConfirmed = confirmed || request.eventSourcingStatus === "confirmed";
  const fulfillmentRows = summaryQuery.data?.data?.fulfillmentSummary || {};
  const fulfillmentCount = summaryQuery.data?.data?.fulfillmentCount || 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PackageSearch className="h-6 w-6 text-emerald-600" />
            <h1 className="text-2xl font-bold">Event Smart Fulfillment</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {request.requestNumber} · {request.purpose} {request.guestCount ? `· ${request.guestCount} guests` : ""}
          </p>
        </div>
        <Badge variant={isConfirmed ? "success" : urgent ? "warning" : "secondary"}>
          {isConfirmed ? "Sourcing Confirmed" : urgent ? "Urgent · ≤24h" : "Planning"}
        </Badge>
      </div>

      {urgent && !isConfirmed ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Urgent event fulfillment</p>
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

      {isConfirmed ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            <div>
              <p className="font-semibold text-emerald-900">Stock reserved and farmer fulfillment created</p>
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
              <h2 className="font-semibold">Required products</h2>
              <p className="text-sm text-slate-500">One event order can be fulfilled by multiple farmers.</p>
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
        <Card className="border-red-200">
          <CardContent className="space-y-2 p-5">
            <p className="font-semibold text-red-700">Cannot guarantee the complete event yet</p>
            {missing.map((m: any) => (
              <div key={m.productName} className="flex justify-between text-sm">
                <span>{m.productName}</span>
                <span className="font-medium text-red-600">{m.shortageKg} kg shortage</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-slate-500">
              Try again after stock changes, or adjust the event requirement before confirming.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!isConfirmed ? (
        <Button
          className="w-full"
          size="lg"
          disabled={Boolean(missing.length) || allocations.length === 0 || confirmMutation.isPending || sourceMutation.isPending}
          onClick={() => confirmMutation.mutate()}
        >
          {confirmMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Confirm Sourcing & Reserve Stock
        </Button>
      ) : (
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 font-semibold">Event fulfillment tracking</h2>
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
                Farmers will accept, pack and mark each allocation ready for collection. AgriConnect will consolidate the event order before final delivery.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
