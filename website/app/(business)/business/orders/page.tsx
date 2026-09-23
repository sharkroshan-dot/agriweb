"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Loader2, MapPin, Star, FileText, CheckCircle, XCircle, Star as StarIcon, ShieldCheck } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { formatPrice } from "../../../lib/utils";
import toast from "react-hot-toast";

const statusVariant: Record<string, any> = {
  confirmed: "default",
  preparing: "secondary",
  quality_check: "outline",
  dispatched: "default",
  in_transit: "warning",
  delivered: "success",
  completed: "success",
  cancelled: "destructive",
};

const ORDER_FILTERS = ["", "active", "completed", "cancelled"];

function StatusTimeline({ status }: { status: string }) {
  const flow = ["confirmed", "preparing", "quality_check", "dispatched", "in_transit", "delivered", "completed"];
  if (status === "cancelled") {
    return <p className="text-xs text-red-600">Cancelled</p>;
  }
  const idx = flow.indexOf(status);
  return (
    <div className="flex items-center gap-1">
      {flow.map((s, i) => (
        <div key={s} className="flex items-center">
          <div
            className={`h-2.5 w-2.5 rounded-full ${i <= idx ? (i === idx ? "bg-emerald-600 ring-2 ring-emerald-200" : "bg-emerald-500") : "bg-gray-200"}`}
            title={s}
          />
          {i < flow.length - 1 && <div className={`h-0.5 w-3 sm:w-5 ${i < idx ? "bg-emerald-500" : "bg-gray-200"}`} />}
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
                  <p className="text-xs font-medium text-gray-400">Seller</p>
                  <p className="font-medium">{inv.seller?.name || "—"}</p>
                  <p className="text-xs text-gray-500">{inv.seller?.city}{inv.seller?.rating ? ` · ★ ${Number(inv.seller.rating).toFixed(1)}` : ""}</p>
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
                <div className="flex justify-between"><span className="text-gray-500">Taxes</span><span>₹{inv.taxes}</span></div>
                <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Total</span><span>₹{inv.total}</span></div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                <span>Payment: {inv.paymentMode} · {inv.paymentStatus}</span>
                <span>Issued {new Date(inv.issuedAt).toLocaleString()}</span>
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

function RateFarmerModal({ order, onClose }: { order: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [ratings, setRatings] = useState<Record<string, number>>({ quality: 5, quantityAccuracy: 5, delivery: 5, communication: 5 });
  const [comment, setComment] = useState("");

  const submit = useMutation({
    mutationFn: (payload: any) => api.post(`/b2b/orders/${order.id}/rate`, payload),
    onSuccess: () => {
      toast.success("Farmer rated!");
      onClose();
      queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to submit rating"),
  });

  const fields = [
    { key: "quality", label: "Product Quality" },
    { key: "quantityAccuracy", label: "Quantity Accuracy" },
    { key: "delivery", label: "Delivery" },
    { key: "communication", label: "Communication" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md">
        <CardContent className="p-0" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-4 p-5">
            <div>
              <p className="text-lg font-semibold">Rate {order.farmerInfo?.farmName || "farmer"}</p>
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
              <Button className="flex-1" disabled={submit.isPending} onClick={() => submit.mutate({ direction: "business_to_farmer", ...ratings, comment })}>
                {submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Star className="mr-2 h-4 w-4" />}
                Submit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function BusinessOrdersPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [invoiceFor, setInvoiceFor] = useState<any>(null);
  const [rateFor, setRateFor] = useState<any>(null);

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ["b2b", "orders"],
    queryFn: () => api.get("/b2b/orders"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.put(`/b2b/orders/${id}/status`, payload),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Order updated");
      queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
      queryClient.invalidateQueries({ queryKey: ["b2b", "rfqs"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update order"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const orders = (ordersData?.data?.orders || []).filter((o: any) => {
    if (filter === "active") return ["confirmed", "preparing", "quality_check", "dispatched", "in_transit", "delivered"].includes(o.status);
    if (filter === "completed") return o.status === "completed";
    if (filter === "cancelled") return o.status === "cancelled";
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-6 w-6 text-emerald-600" />
          <h1 className="text-2xl font-bold">B2B Purchase Orders</h1>
        </div>
        <div className="flex gap-2">
          {ORDER_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors ${
                filter === f ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f === "" ? "All" : f}
            </button>
          ))}
        </div>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-400">
            No purchase orders here. Accept a farmer quote to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o: any) => (
            <Card key={o.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{o.orderNumber || o.id}</p>
                      <Badge variant={statusVariant[o.status] || "secondary"}>{o.status.replace(/_/g, " ")}</Badge>
                      {o.qualityGrade ? <Badge variant="outline">{o.qualityGrade}</Badge> : null}
                    </div>
                    <p className="text-sm text-gray-500">
                      {o.productName} · {o.quantityKg} kg · ₹{o.pricePerKg}/kg · {o.farmerInfo?.farmName || "Farm"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-600">{formatPrice(o.totalAmount)}</p>
                    <p className="text-xs text-gray-400">
                      {o.deliveryCharge ? `incl. ₹${o.deliveryCharge} delivery` : ""} · {o.paymentMode} · {o.paymentStatus}
                    </p>
                  </div>
                </div>

                <StatusTimeline status={o.status} />

                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  {o.deliveryCity ? (
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {o.deliveryCity}</span>
                  ) : null}
                  {o.requiredDate ? <span>required {o.requiredDate}{o.deliveryTimeSlot ? ` (${o.deliveryTimeSlot})` : ""}</span> : null}
                  {o.deliveryMethod ? <span>{(o.deliveryMethod || "").replace(/_/g, " ")}</span> : null}
                  <span>started {new Date(o.startedAt).toLocaleDateString()}</span>
                  {o.farmerInfo?.isVerified ? (
                    <span className="flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-3.5 w-3.5" /> verified supplier</span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {o.status === "delivered" && (
                    <>
                      <Button size="sm" onClick={() => updateMutation.mutate({ id: o.id, payload: { status: "completed", paymentStatus: "paid" } })}>
                        <CheckCircle className="mr-1.5 h-4 w-4" /> Confirm Receipt & Complete
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRateFor(o)}>
                        <Star className="mr-1.5 h-4 w-4" /> Rate Farmer
                      </Button>
                    </>
                  )}
                  {(o.status === "delivered" || o.status === "completed") && (
                    <Button size="sm" variant="outline" onClick={() => setInvoiceFor(o)}>
                      <FileText className="mr-1.5 h-4 w-4" /> Invoice
                    </Button>
                  )}
                  {o.status === "confirmed" && (
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => updateMutation.mutate({ id: o.id, payload: { status: "cancelled" } })}>
                      <XCircle className="mr-1.5 h-4 w-4" /> Cancel Order
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {invoiceFor && <InvoiceModal order={invoiceFor} onClose={() => setInvoiceFor(null)} />}
      {rateFor && <RateFarmerModal order={rateFor} onClose={() => setRateFor(null)} />}
    </div>
  );
}