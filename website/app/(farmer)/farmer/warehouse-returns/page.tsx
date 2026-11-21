"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Package,
  RefreshCw,
  Truck,
  Warehouse,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

type ReturnStatus =
  | "pending_farmer_acceptance"
  | "accepted"
  | "in_transit_to_farmer"
  | "received_by_farmer"
  | "rejected"
  | string;

function statusLabel(status: ReturnStatus) {
  const labels: Record<string, string> = {
    pending_farmer_acceptance: "Awaiting your decision",
    accepted: "Accepted · Awaiting dispatch",
    in_transit_to_farmer: "In transit to farm",
    received_by_farmer: "Received by farmer",
    rejected: "Rejected",
  };
  return labels[status] || String(status || "Unknown").replace(/_/g, " ");
}

function statusVariant(status: ReturnStatus): "success" | "warning" | "secondary" | "destructive" | "outline" {
  if (status === "received_by_farmer") return "success";
  if (status === "pending_farmer_acceptance") return "warning";
  if (status === "rejected") return "destructive";
  if (status === "accepted" || status === "in_transit_to_farmer") return "secondary";
  return "outline";
}

function formatReturnDate(value?: string | Date | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WarehouseReturnsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["farmerWarehouseReturns"],
    queryFn: () => api.get("/farmers/me/warehouse-returns"),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const returns = Array.isArray(data?.data?.returns) ? data.data.returns : [];

  const summary = useMemo(() => ({
    total: returns.length,
    pending: returns.filter((item: any) => item.status === "pending_farmer_acceptance").length,
    inTransit: returns.filter((item: any) => item.status === "in_transit_to_farmer").length,
    received: returns.filter((item: any) => item.status === "received_by_farmer").length,
  }), [returns]);

  const decide = async (id: string, decision: "accept" | "reject") => {
    try {
      await api.put(`/farmers/me/warehouse-returns/${id}`, { decision });
      toast.success(decision === "accept" ? "Return accepted" : "Return rejected");
      await refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || "Unable to update return");
    }
  };

  const receive = async (id: string) => {
    try {
      await api.put(`/farmers/me/warehouse-returns/${id}/receive`);
      toast.success("Returned shipment received");
      await refetch();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || "Receipt failed");
    }
  };

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Warehouse ↔ Farmer"
        title="Warehouse Returns"
        description="Review warehouse return requests, decide how to proceed and confirm the physical receipt of returned produce."
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-10 border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </FarmerPageHeader>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total returns", value: summary.total, icon: Package, tone: "bg-emerald-50 text-emerald-700" },
          { label: "Awaiting decision", value: summary.pending, icon: Clock3, tone: "bg-amber-50 text-amber-700" },
          { label: "In transit", value: summary.inTransit, icon: Truck, tone: "bg-blue-50 text-blue-700" },
          { label: "Received", value: summary.received, icon: CheckCircle2, tone: "bg-green-50 text-green-700" },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{isLoading || isError ? "—" : stat.value}</p>
              </div>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${stat.tone}`}>
                <stat.icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Return requests</h2>
            <p className="mt-1 text-sm text-slate-500">Warehouse-to-farmer shipments that need your attention.</p>
          </div>
          {!isLoading && !isError ? (
            <span className="text-xs font-medium text-slate-500">{summary.total} request{summary.total === 1 ? "" : "s"}</span>
          ) : null}
        </div>

        <div className="p-4 sm:p-5">
          {isLoading ? (
            <div className="space-y-3" aria-label="Loading warehouse return requests">
              {[0, 1].map((key) => (
                <div key={key} className="h-32 animate-pulse rounded-xl border border-slate-100 bg-slate-50" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center rounded-xl border border-red-200 bg-red-50/60 px-5 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-red-600 shadow-sm">
                <AlertCircle className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">We couldn't load return requests</h3>
              <p className="mt-1 max-w-lg text-sm text-slate-600">
                {(error as any)?.response?.data?.detail || (error as any)?.message || "Check your connection and try again."}
              </p>
              <Button className="mt-4 bg-emerald-700 hover:bg-emerald-800" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />Try again
              </Button>
            </div>
          ) : returns.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50/30 px-5 py-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <Warehouse className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">No warehouse return requests</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
                There are no warehouse-to-farmer returns for your farm right now. If a warehouse flags a Farmer Fulfillment shipment and sends it back, the request will appear here for your review.
              </p>
              <Button type="button" variant="outline" className="mt-5 border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />Check again
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {returns.map((item: any) => {
                const status = String(item.status || "");
                const createdAt = formatReturnDate(item.createdAt || item.requestedAt);
                const items = Array.isArray(item.items) ? item.items : [];
                return (
                  <article key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-emerald-200">
                    <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-950">Order #{item.orderNumber || item.orderId}</h3>
                          <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
                        </div>
                        {createdAt ? <p className="mt-1.5 text-xs text-slate-500">Requested {createdAt}</p> : null}
                      </div>
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                        <span className="font-semibold">Return reason:</span> {item.reason || "Not provided"}
                      </div>
                    </div>

                    <div className="p-4 sm:p-5">
                      {items.length > 0 ? (
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {items.map((line: any, index: number) => (
                            <div key={`${line.productId || line.productName || "return-item"}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700">
                                  <Package className="h-4 w-4" />
                                </span>
                                <span className="truncate text-sm font-semibold text-slate-800">{line.productName || "Product"}</span>
                              </div>
                              <span className="shrink-0 text-sm font-bold text-slate-900">{line.quantity} {line.unit || "units"}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No item-level details were supplied with this return.</p>
                      )}

                      {item.notes ? (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                          <span className="font-semibold text-slate-800">Warehouse notes: </span>{item.notes}
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                        <span className="text-xs font-medium text-slate-500">Return status: {statusLabel(status)}</span>
                        <div className="flex flex-wrap gap-2">
                          {status === "pending_farmer_acceptance" ? (
                            <>
                              <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => decide(item.id, "accept")}>
                                <CheckCircle2 className="mr-2 h-4 w-4" />Accept return
                              </Button>
                              <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => decide(item.id, "reject")}>
                                <XCircle className="mr-2 h-4 w-4" />Reject return
                              </Button>
                            </>
                          ) : status === "accepted" ? (
                            <Badge variant="secondary"><Truck className="mr-2 h-4 w-4" />Waiting for warehouse dispatch</Badge>
                          ) : status === "in_transit_to_farmer" ? (
                            <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" onClick={() => receive(item.id)}>
                              <CheckCircle2 className="mr-2 h-4 w-4" />Confirm receipt
                            </Button>
                          ) : status === "received_by_farmer" ? (
                            <Badge variant="success"><CheckCircle2 className="mr-2 h-4 w-4" />Received by farmer</Badge>
                          ) : status === "rejected" ? (
                            <Badge variant="destructive">Return rejected</Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
