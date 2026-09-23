"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ShoppingCart,
  Truck,
  ArrowRight,
  Scale,
  Camera,
  XCircle,
  CheckCircle2,
  FileCheck,
  FileText,
  Star as StarIcon,
  MapPin,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { CameraCapture } from "../../../components/farmer/camera-capture";
import { formatPrice } from "../../../lib/utils";
import toast from "react-hot-toast";

const bulkStatusVariant: Record<string, any> = {
  confirmed: "secondary",
  preparing: "warning",
  quality_check: "warning",
  picked_up: "warning",
  dispatched: "warning",
  out_for_delivery: "success",
  delivered: "success",
  cancelled: "destructive",
};

const bulkFlow = ["confirmed", "preparing", "quality_check", "picked_up", "dispatched", "out_for_delivery", "delivered"];

const b2bStatusVariant: Record<string, any> = {
  confirmed: "default",
  preparing: "secondary",
  quality_check: "outline",
  dispatched: "default",
  in_transit: "warning",
  delivered: "success",
  completed: "success",
  cancelled: "destructive",
};

const b2bFlow = ["confirmed", "preparing", "quality_check", "dispatched", "in_transit", "delivered", "completed"];

function StatusFilter({
  filter,
  setFilter,
  counts,
}: {
  filter: string;
  setFilter: (f: string) => void;
  counts: { all: number; active: number; completed: number; cancelled: number };
}) {
  const options = [
    { key: "", label: "All" },
    { key: "active", label: "Active" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ];
  return (
    <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1">
      {options.map((o) => {
        const selected = filter === o.key;
        const count = o.key === "" ? counts.all : counts[o.key as keyof typeof counts];
        return (
          <button
            key={o.key}
            onClick={() => setFilter(o.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              selected ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {o.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                selected ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function B2bTimeline({ status }: { status: string }) {
  if (status === "cancelled") return <p className="text-xs text-red-600">Order cancelled</p>;
  const idx = b2bFlow.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {b2bFlow.map((s, i) => (
        <div key={s} className="flex items-center">
          <div className={`h-2.5 w-2.5 rounded-full ${i <= idx ? (i === idx ? "bg-emerald-600 ring-2 ring-emerald-200" : "bg-emerald-500") : "bg-gray-200"}`} title={s} />
          {i < b2bFlow.length - 1 && <div className={`h-0.5 w-3 sm:w-5 ${i < idx ? "bg-emerald-500" : "bg-gray-200"}`} />}
        </div>
      ))}
    </div>
  );
}

function InvoiceModal({ order, onClose }: { order: any; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["b2b", "invoice", order.id],
    queryFn: () => api.get(`/b2b/orders/${order.id}/invoice`),
  });
  const inv = data?.data?.invoice;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <CardContent className="p-0" onClick={(e) => e.stopPropagation()}>
          {isLoading ? (
            <div className="flex justify-center p-10"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
          ) : inv ? (
            <div className="p-5">
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <p className="text-lg font-bold">B2B INVOICE</p>
                  <p className="text-xs text-gray-500">{inv.invoiceNumber} · Order {inv.orderNumber}</p>
                </div>
                <FileText className="h-8 w-8 text-emerald-600" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-medium text-gray-400">Buyer</p>
                  <p className="font-medium">{inv.buyer?.name || "—"}</p>
                  <p className="text-xs text-gray-500">{inv.buyer?.city}{inv.buyer?.gstin ? ` · GST ${inv.buyer.gstin}` : ""}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400">Seller (You)</p>
                  <p className="font-medium">{inv.seller?.name || "—"}</p>
                  <p className="text-xs text-gray-500">{inv.seller?.city}</p>
                </div>
              </div>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-400">
                    <th className="pb-2">Product</th>
                    <th className="pb-2">Qty</th>
                    <th className="pb-2">Rate</th>
                    <th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((it: any, i: number) => (
                    <tr key={i} className="border-b border-dashed">
                      <td className="py-2">{it.product}{it.quality ? ` (${it.quality})` : ""}</td>
                      <td className="py-2">{it.quantityKg} kg</td>
                      <td className="py-2">₹{it.ratePerKg}</td>
                      <td className="py-2 text-right">₹{it.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>₹{inv.subtotal}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Delivery</span><span>₹{inv.deliveryCharge}</span></div>
                <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span>₹{inv.total}</span></div>
              </div>
              <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                Payment: {inv.paymentMode} · {inv.paymentStatus}{inv.advanceAmount ? ` · advance ₹${inv.advanceAmount}` : ""}
              </div>
            </div>
          ) : (
            <p className="p-10 text-center text-sm text-gray-400">Could not load invoice.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RateBusinessModal({ order, onClose }: { order: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [ratings, setRatings] = useState<Record<string, number>>({ paymentReliability: 5, orderAccuracy: 5, communication: 5 });
  const [comment, setComment] = useState("");

  const submit = useMutation({
    mutationFn: (payload: any) => api.post(`/b2b/orders/${order.id}/rate`, payload),
    onSuccess: () => {
      toast.success("Business rated!");
      onClose();
      queryClient.invalidateQueries({ queryKey: ["b2b", "farmer", "orders"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit rating"),
  });

  const fields = [
    { key: "paymentReliability", label: "Payment Reliability" },
    { key: "orderAccuracy", label: "Order Accuracy" },
    { key: "communication", label: "Communication" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md">
        <CardContent className="p-0" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-4 p-5">
            <div>
              <p className="text-lg font-semibold">Rate {order.businessInfo?.businessName || "business buyer"}</p>
              <p className="text-sm text-gray-500">Order {order.orderNumber} · {order.productName}</p>
            </div>
            {fields.map((f) => (
              <div key={f.key}>
                <p className="mb-1 text-sm font-medium">{f.label}</p>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => setRatings({ ...ratings, [f.key]: n })}>
                      <StarIcon className={`h-6 w-6 ${n <= ratings[f.key] ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Comment</label>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional feedback" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button className="flex-1" disabled={submit.isPending} onClick={() => submit.mutate({ direction: "farmer_to_business", ...ratings, comment })}>
                {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <StarIcon className="mr-2 h-4 w-4" />}
                Submit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FarmerBulkOrdersPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"bulk" | "b2b">("bulk");
  const [bulkFilter, setBulkFilter] = useState("");
  const [b2bFilter, setB2bFilter] = useState("");
  const [weighingFor, setWeighingFor] = useState<string | null>(null);
  const [preparedKg, setPreparedKg] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<Record<string, string[]>>({});
  const [cameraOpen, setCameraOpen] = useState<string | boolean>(false);
  const [invoiceFor, setInvoiceFor] = useState<any>(null);
  const [rateFor, setRateFor] = useState<any>(null);

  const { data: bulkData, isLoading: bulkLoading } = useQuery({
    queryKey: ["farmer", "bulk-orders"],
    queryFn: () => api.get("/bulk-orders/orders"),
  });

  const { data: b2bData, isLoading: b2bLoading } = useQuery({
    queryKey: ["b2b", "farmer", "orders"],
    queryFn: () => api.get("/b2b/orders"),
  });

  const advanceMutation = useMutation({
    mutationFn: (payload: { id: string; status: string }) => api.put(`/bulk-orders/orders/${payload.id}/status`, { status: payload.status }),
    onSuccess: () => {
      toast.success("Bulk order status updated");
      queryClient.invalidateQueries({ queryKey: ["farmer", "bulk-orders"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update status"),
  });

  const weighMutation = useMutation({
    mutationFn: (payload: { id: string; preparedKg: number; evidence?: string[] }) =>
      api.put(`/bulk-orders/orders/${payload.id}/weigh`, payload),
    onSuccess: () => {
      toast.success("Weight recorded. Buyer has been notified of the adjustment.");
      setWeighingFor(null);
      setPreparedKg({});
      queryClient.invalidateQueries({ queryKey: ["farmer", "bulk-orders"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to record weight"),
  });

  const updateB2bMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.put(`/b2b/orders/${id}/status`, payload),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Order updated");
      queryClient.invalidateQueries({ queryKey: ["b2b", "farmer", "orders"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update order"),
  });

  if (bulkLoading || b2bLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const orders = (bulkData?.data?.orders || []).map((o: any) => ({
    id: o.id,
    number: o.orderNumber,
    title: o.buyerName || "Buyer",
    subtitle: (o.items || []).map((i: any) => `${i.name} ${i.quantityKg} kg`).join(" • "),
    total: o.totalAmount,
    status: o.status,
    orderedKg: (o.items || []).reduce((s: number, i: any) => s + Number(i.quantityKg || 0), 0),
    preparedKg: o.preparedKg,
    weightDiffKg: o.preparedKg != null ? o.preparedKg - (o.items || []).reduce((s: number, i: any) => s + Number(i.quantityKg || 0), 0) : null,
    evidence: o.evidence || [],
    meta: `${o.purpose ? `${o.purpose} • ` : ""}${o.requestedDeliveryDate || ""}${o.deliveryMethod ? ` • ${o.deliveryMethod.replace(/_/g, " ")}` : ""}`,
  }));

  const b2bOrders = b2bData?.data?.orders || [];

  const filterBulk = (list: any[]) => {
    if (bulkFilter === "active") return list.filter((o) => !["delivered", "cancelled"].includes(o.status));
    if (bulkFilter === "completed") return list.filter((o) => o.status === "delivered");
    if (bulkFilter === "cancelled") return list.filter((o) => o.status === "cancelled");
    return list;
  };

  const filterB2b = (list: any[]) => {
    if (b2bFilter === "active") return list.filter((o) => ["confirmed", "preparing", "quality_check", "dispatched", "in_transit", "delivered"].includes(o.status));
    if (b2bFilter === "completed") return list.filter((o) => o.status === "completed");
    if (b2bFilter === "cancelled") return list.filter((o) => o.status === "cancelled");
    return list;
  };

  const visibleOrders = filterBulk(orders);
  const visibleB2bOrders = filterB2b(b2bOrders);

  const nextOfB2b = (status: string) => {
    const i = b2bFlow.indexOf(status);
    return i >= 0 && i < b2bFlow.length - 1 ? b2bFlow[i + 1] : null;
  };

  const sectionClass = "rounded-3xl border bg-white p-6";
  const headingClass = "flex items-center gap-3 text-xl font-bold text-slate-900";
  const countClass = "text-sm text-slate-500";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ShoppingCart className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">Bulk &amp; B2B Orders</h1>
      </div>
      <p className="text-sm text-gray-500">Confirmed orders you won through offers. Manage weight, quality proof and delivery from here.</p>

      {/* Tabs like harvested / pre-harvest */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setTab("bulk")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
            tab === "bulk" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Truck className="h-4 w-4" />
          Bulk Orders
          {orders.length > 0 && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">{orders.length}</span>
          )}
        </button>
        <button
          onClick={() => setTab("b2b")}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
            tab === "b2b" ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <ShoppingCart className="h-4 w-4" />
          B2B Orders
          {b2bOrders.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">{b2bOrders.length}</span>
          )}
        </button>
      </div>

      {/* Bulk Orders section */}
      {tab === "bulk" && (
        <section className={sectionClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className={headingClass}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100">
                <Truck className="h-5 w-5 text-purple-600" />
              </span>
              Bulk Orders
            </h2>
            <p className={countClass}>Confirmed event orders from your accepted offers</p>
          </div>

          <StatusFilter
            filter={bulkFilter}
            setFilter={setBulkFilter}
            counts={{
              all: orders.length,
              active: orders.filter((o: any) => !["delivered", "cancelled"].includes(o.status)).length,
              completed: orders.filter((o: any) => o.status === "delivered").length,
              cancelled: orders.filter((o: any) => o.status === "cancelled").length,
            }}
          />

          {visibleOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
              <Truck className="h-9 w-9 text-gray-300" />
              <p className="mt-3 font-medium text-gray-600">No bulk orders yet</p>
              <p className="text-sm text-gray-400">Once a buyer accepts your bulk offer, it shows up here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleOrders.map((o: any) => {
                const hasWeighed = o.preparedKg != null;
                const canWeigh = ["confirmed", "preparing", "quality_check"].includes(o.status);
                return (
                  <Card key={o.id}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-emerald-600" />
                          <p className="font-medium">{o.number}</p>
                          <Badge variant="outline">Event</Badge>
                          {hasWeighed && <Badge variant="success"><Scale className="mr-1 h-3 w-3" /> Weighed</Badge>}
                        </div>
                        <Badge variant={bulkStatusVariant[o.status] || "secondary"}>{o.status.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-sm font-medium text-gray-800">{o.title}</p>
                      <p className="text-sm text-gray-600">{o.subtitle}</p>
                      {o.meta ? <p className="text-xs text-gray-500">{o.meta}</p> : null}

                      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
                        <div className="text-center">
                          <p className="text-[11px] uppercase tracking-wide text-slate-400">Ordered</p>
                          <p className="text-lg font-bold text-slate-700">{o.orderedKg} kg</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[11px] uppercase tracking-wide text-slate-400">Prepared</p>
                          <p className="text-lg font-bold text-blue-700">{o.preparedKg != null ? `${o.preparedKg} kg` : "—"}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[11px] uppercase tracking-wide text-slate-400">Difference</p>
                          <p className={`text-lg font-bold ${o.weightDiffKg == null ? "text-slate-400" : o.weightDiffKg < 0 ? "text-red-600" : o.weightDiffKg > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                            {o.weightDiffKg == null ? "—" : `${o.weightDiffKg > 0 ? "+" : ""}${o.weightDiffKg} kg`}
                          </p>
                        </div>
                      </div>

                      {hasWeighed && o.evidence && o.evidence.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {o.evidence.map((p: string, i: number) => (
                            <img key={i} src={p} alt="evidence" className="h-16 w-16 rounded-lg border object-cover" />
                          ))}
                        </div>
                      )}

                      {canWeigh && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Button size="sm" variant="outline" onClick={() => setWeighingFor(weighingFor === o.id ? null : o.id)}>
                            <Scale className="mr-1.5 h-4 w-4" />
                            {weighingFor === o.id ? "Close" : hasWeighed ? "Update Weight & Proof" : "Record Weight & Proof"}
                          </Button>
                          {!["delivered", "cancelled"].includes(o.status) && (
                            <Button
                              size="sm"
                              disabled={advanceMutation.isPending}
                              onClick={() => {
                                const idx = bulkFlow.indexOf(o.status);
                                advanceMutation.mutate({ id: o.id, status: bulkFlow[Math.min(idx + 1, bulkFlow.length - 1)] });
                              }}
                            >
                              Mark {bulkFlow[Math.min(bulkFlow.indexOf(o.status) + 1, bulkFlow.length - 1)].replace(/_/g, " ")}
                              <ArrowRight className="ml-1.5 h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}

                      {weighingFor === o.id && (
                        <div className="rounded-md border bg-white p-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-500">Prepared weight (kg) *</label>
                              <input
                                type="number"
                                min="0.1"
                                step="0.1"
                                className="h-9 w-full rounded-md border border-gray-200 px-2 text-sm"
                                placeholder={String(o.orderedKg)}
                                value={preparedKg[o.id] ?? ""}
                                onChange={(e) => setPreparedKg({ ...preparedKg, [o.id]: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-500">Photo proof (weight / packaging)</label>
                              <div className="flex flex-wrap items-center gap-2">
                                {(evidence[o.id] || []).map((p, i) => (
                                  <div key={i} className="relative h-14 w-14 overflow-hidden rounded-lg border">
                                    <img src={p} alt="proof" className="h-full w-full object-cover" />
                                    <button
                                      type="button"
                                      onClick={() => setEvidence({ ...evidence, [o.id]: (evidence[o.id] || []).filter((_, x) => x !== i) })}
                                      className="absolute right-0.5 top-0.5 rounded-full bg-red-500 p-0.5 text-white"
                                      aria-label="remove"
                                    >
                                      <XCircle className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setCameraOpen(o.id)}
                                  className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-gray-400 hover:border-emerald-400 hover:text-emerald-600"
                                >
                                  <Camera className="h-4 w-4" />
                                  <span className="text-[10px]">Add</span>
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <p className="text-xs text-gray-400">The buyer can accept or reject the weight adjustment.</p>
                            <Button
                              size="sm"
                              disabled={!preparedKg[o.id] || Number(preparedKg[o.id]) <= 0 || weighMutation.isPending}
                              onClick={() =>
                                weighMutation.mutate({
                                  id: o.id,
                                  preparedKg: Number(preparedKg[o.id]),
                                  evidence: evidence[o.id],
                                })
                              }
                            >
                              {weighMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileCheck className="mr-1.5 h-4 w-4" />}
                              Save Weight
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* B2B Orders section */}
      {tab === "b2b" && (
        <section className={sectionClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className={headingClass}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100">
                <ShoppingCart className="h-5 w-5 text-emerald-600" />
              </span>
              B2B Orders
            </h2>
            <p className={countClass}>Confirmed orders from businesses that selected you</p>
          </div>

          <StatusFilter
            filter={b2bFilter}
            setFilter={setB2bFilter}
            counts={{
              all: b2bOrders.length,
              active: b2bOrders.filter((o: any) => ["confirmed", "preparing", "quality_check", "dispatched", "in_transit", "delivered"].includes(o.status)).length,
              completed: b2bOrders.filter((o: any) => o.status === "completed").length,
              cancelled: b2bOrders.filter((o: any) => o.status === "cancelled").length,
            }}
          />

          {visibleB2bOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center">
              <ShoppingCart className="h-9 w-9 text-gray-300" />
              <p className="mt-3 font-medium text-gray-600">No B2B orders yet</p>
              <p className="text-sm text-gray-400">Browse Business RFQs and submit quotes to get orders.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleB2bOrders.map((o: any) => {
                const next = nextOfB2b(o.status);
                return (
                  <Card key={o.id}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">{o.orderNumber || o.id}</p>
                            <Badge variant={b2bStatusVariant[o.status] || "secondary"}>{o.status.replace(/_/g, " ")}</Badge>
                            {o.qualityGrade ? <Badge variant="outline">{o.qualityGrade}</Badge> : null}
                          </div>
                          <p className="text-sm text-gray-500">
                            {o.productName} · {o.quantityKg} kg · ₹{o.pricePerKg}/kg · {(o.businessInfo || {})?.businessName || "Business buyer"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-emerald-600">{formatPrice(o.totalAmount)}</p>
                          <p className="text-xs text-gray-400">
                            {o.deliveryCharge ? `incl. ₹${o.deliveryCharge} delivery` : ""} · {o.paymentMode} · {o.paymentStatus}
                          </p>
                        </div>
                      </div>

                      <B2bTimeline status={o.status} />

                      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                        {o.deliveryCity ? <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {o.deliveryCity}</span> : null}
                        {o.requiredDate ? <span>required {o.requiredDate}{o.deliveryTimeSlot ? ` (${o.deliveryTimeSlot})` : ""}</span> : null}
                        <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> {(o.deliveryMethod || "").replace(/_/g, " ")}</span>
                        <span>started {new Date(o.startedAt).toLocaleDateString()}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {o.status === "quality_check" && (
                          <>
                            <Button size="sm" onClick={() => updateB2bMutation.mutate({ id: o.id, payload: { status: "dispatched", qualityCheck: "passed" } })}>
                              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Quality Passed · Dispatch
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateB2bMutation.mutate({ id: o.id, payload: { status: "dispatched", qualityCheck: "failed" } })}>
                              Mark Quality Failed
                            </Button>
                          </>
                        )}
                        {next && o.status !== "quality_check" && (
                          <Button size="sm" onClick={() => updateB2bMutation.mutate({ id: o.id, payload: { status: next } })}>
                            Mark {next.replace(/_/g, " ")}
                          </Button>
                        )}
                        {o.status === "confirmed" && (
                          <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateB2bMutation.mutate({ id: o.id, payload: { status: "cancelled" } })}>
                            <XCircle className="mr-1.5 h-4 w-4" /> Cancel Order
                          </Button>
                        )}
                        {(o.status === "delivered" || o.status === "completed") && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setInvoiceFor(o)}>
                              <FileText className="mr-1.5 h-4 w-4" /> Invoice
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRateFor(o)}>
                              <StarIcon className="mr-1.5 h-4 w-4" /> Rate Business
                            </Button>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      )}

      <CameraCapture
        open={cameraOpen === "quality" || cameraOpen === "proof" || typeof cameraOpen === "string"}
        onClose={() => setCameraOpen(false)}
        onCapture={(file: File) => {
          if (typeof cameraOpen === "string" && cameraOpen !== "quality" && cameraOpen !== "proof") {
            const url = URL.createObjectURL(file);
            setEvidence((prev) => ({ ...prev, [cameraOpen]: [...(prev[cameraOpen] || []), url] }));
            toast.success("Photo proof added.");
          }
        }}
        onUpload={(files: File[]) => {
          if (typeof cameraOpen === "string" && cameraOpen !== "quality" && cameraOpen !== "proof") {
            const urls = files.map((f) => URL.createObjectURL(f));
            setEvidence((prev) => ({ ...prev, [cameraOpen]: [...(prev[cameraOpen] || []), ...urls] }));
            toast.success(`${files.length} photo(s) added.`);
          }
        }}
      />

      {invoiceFor && <InvoiceModal order={invoiceFor} onClose={() => setInvoiceFor(null)} />}
      {rateFor && <RateBusinessModal order={rateFor} onClose={() => setRateFor(null)} />}
    </div>
  );
}