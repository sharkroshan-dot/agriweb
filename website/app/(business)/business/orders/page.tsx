"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, Loader2, MapPin, Star, FileText, CheckCircle, XCircle, Star as StarIcon, ShieldCheck, AlertTriangle, CreditCard, Download, Search, CalendarDays, Truck, Package, ChevronDown, ChevronUp, Wallet, RefreshCw, Clock3, ArrowUpRight } from "lucide-react";
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
  quality_check: "warning",
  ready_for_pickup: "warning",
  picked_up: "default",
  warehouse_received: "default",
  transfer_in_transit: "warning",
  destination_warehouse_received: "default",
  dispatched: "warning",
  in_transit: "warning",
  delivered: "success",
  completed: "success",
  cancelled: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  preparing: "Preparing",
  quality_check: "Quality check",
  ready_for_pickup: "Ready for pickup",
  picked_up: "Collected from farm",
  warehouse_received: "Warehouse received",
  transfer_in_transit: "Warehouse transfer",
  destination_warehouse_received: "Destination received",
  dispatched: "Dispatched",
  in_transit: "In transit",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

const ORDER_FILTERS = [
  { key: "all", label: "All orders" },
  { key: "attention", label: "Needs attention" },
  { key: "preparation", label: "Preparation" },
  { key: "ready", label: "Ready for pickup" },
  { key: "warehouse", label: "Pickup & warehouse" },
  { key: "transit", label: "In transit" },
  { key: "delivered", label: "Delivered" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

const WAREHOUSE_STATUSES = ["picked_up", "warehouse_received", "transfer_in_transit", "destination_warehouse_received"];
const TRANSIT_STATUSES = ["dispatched", "in_transit"];

function displayDate(value: any) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function displayAddress(value: any) {
  if (!value) return "Address not provided";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return [
      value.formattedAddress,
      value.address,
      value.street,
      value.addressLine1,
      value.addressLine2,
      value.city,
      value.state,
      value.postalCode,
    ].filter(Boolean).join(", ") || "Address not provided";
  }
  return String(value);
}

function getPaidAmount(order: any) {
  const total = Math.max(0, Number(order.totalAmount || 0));
  if (String(order.paymentStatus || "").toLowerCase() === "paid") return total;
  const paid = order.paidAmount ?? (String(order.paymentStatus || "").toLowerCase() === "advance" ? order.advanceAmount : 0);
  return Math.min(total, Math.max(0, Number(paid || 0)));
}

function StatusTimeline({ status }: { status: string }) {
  // Restore the original detailed, one-marker-per-stage fulfillment tracker.
  // The native title tooltip appears when the pointer hovers over each marker.
  const flow = [
    "confirmed",
    "preparing",
    "quality_check",
    "ready_for_pickup",
    "picked_up",
    "warehouse_received",
    "transfer_in_transit",
    "destination_warehouse_received",
    "in_transit",
    "delivered",
    "completed",
  ];
  const labels: Record<string, string> = {
    confirmed: "Order placed",
    preparing: "Farmer preparing produce",
    quality_check: "Quality inspection",
    ready_for_pickup: "Ready for farm pickup",
    picked_up: "Collected from farm",
    warehouse_received: "Received at source warehouse",
    transfer_in_transit: "Warehouse transfer in transit",
    destination_warehouse_received: "Received at destination warehouse",
    in_transit: "Final delivery to business",
    delivered: "Delivered to business",
    completed: "Business confirmed receipt — order completed",
  };
  const descriptions: Record<string, string> = {
    confirmed: "The business accepted the farmer quote and the order was created.",
    preparing: "The farmer is preparing and packing the requested produce.",
    quality_check: "The packed produce is being inspected for quality and quantity.",
    ready_for_pickup: "The farmer confirmed that the produce is ready for collection.",
    picked_up: "The pickup team collected the produce from the farm.",
    warehouse_received: "The source warehouse received and checked the collected stock.",
    transfer_in_transit: "The order is travelling from the source warehouse to the destination warehouse.",
    destination_warehouse_received: "The destination warehouse received the transferred stock.",
    in_transit: "The final delivery partner is taking the order to the business.",
    delivered: "The order was handed over to the business.",
    completed: "The business confirmed receipt and completed the order.",
  };

  if (status === "cancelled") {
    return <p className="text-xs font-medium text-red-600">Cancelled</p>;
  }

  // "dispatched" is a legacy/API alias for the final delivery journey.
  const normalizedStatus = status === "dispatched" ? "in_transit" : status;
  const idx = flow.indexOf(normalizedStatus);

  return (
    <div className="space-y-1.5">
      <div
        className="flex items-center gap-1"
        aria-label={"Order progress: " + (labels[normalizedStatus] || status)}
      >
        {flow.map((stage, index) => {
          const reached = idx >= 0 && index <= idx;
          const current = idx >= 0 && index === idx;
          const tooltip = labels[stage] + ". " + descriptions[stage];
          return (
            <div key={stage} className="flex min-w-0 flex-1 items-center">
              <span
                role="img"
                aria-label={tooltip}
                title={tooltip}
                className={
                  "h-2.5 w-2.5 shrink-0 cursor-default rounded-full transition-shadow hover:ring-4 hover:ring-emerald-100 " +
                  (reached
                    ? current
                      ? "bg-emerald-600 ring-2 ring-emerald-200"
                      : "bg-emerald-500"
                    : "bg-gray-200")
                }
              />
              {index < flow.length - 1 && (
                <span
                  aria-hidden="true"
                  className={
                    "h-0.5 min-w-1 flex-1 " +
                    (idx >= 0 && index < idx ? "bg-emerald-500" : "bg-gray-200")
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs font-medium text-slate-600">
        Current stage: {labels[normalizedStatus] || String(status || "Unknown").replace(/_/g, " ")}
      </p>
    </div>
  );
}

function OrderActivityTimeline({ order }: { order: any }) {
  // Keep the original compact chronological activity timeline. The event
  // fallbacks also support warehouse/pickup tracking events stored as
  // title/description/eventType, as well as B2B action/details events.
  const events = Array.isArray(order.statusHistory)
    ? [...order.statusHistory]
        .filter((event: any) => event && typeof event === "object")
        .sort((a: any, b: any) => {
          const ta = new Date(a.timestamp || a.createdAt || 0).getTime();
          const tb = new Date(b.timestamp || b.createdAt || 0).getTime();
          return ta - tb;
        })
    : [];

  const label = (value: any) =>
    String(value || "Order updated")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (ch) => ch.toUpperCase());

  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">
          Order activity & fulfillment updates
        </p>
        <Badge variant="outline">{events.length} updates</Badge>
      </div>
      {events.length === 0 ? (
        <p className="text-xs text-slate-500">
          No additional fulfillment events recorded yet. This timeline will update
          as farmers, pickup teams, warehouse staff, and delivery partners
          process the order.
        </p>
      ) : (
        <ol className="space-y-3">
          {events
            .slice()
            .reverse()
            .map((event: any, index: number) => {
              const timestamp = event.timestamp || event.createdAt;
              const parsedTime = timestamp ? new Date(timestamp) : null;
              const eventTitle =
                event.isInvalidTransition
                  ? "Ignored update: " + (event.title || event.action || event.eventType || event.status)
                  : event.title || event.action || event.eventType || event.status;
              const details =
                event.isInvalidTransition
                  ? event.reconciliationNote || event.details || event.description
                  : event.details || event.description || event.note || event.message;

              return (
                <li
                  key={String(timestamp || event._id || index) + "-" + index}
                  className="flex gap-3"
                >
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-600 ring-2 ring-emerald-100" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-medium text-slate-800">
                        {label(eventTitle)}
                      </p>
                      <time className="text-xs text-slate-500">
                        {parsedTime && Number.isFinite(parsedTime.getTime())
                          ? parsedTime.toLocaleString("en-IN")
                          : "Time unavailable"}
                      </time>
                    </div>
                    <p className="text-xs text-slate-500">
                      {event.isInvalidTransition
                        ? "Lifecycle reconciliation · ignored"
                        : event.actorRole
                          ? label(event.actorRole)
                          : "AgriConnect"}
                      {event.status || event.orderStatus
                        ? " · " + label(event.status || event.orderStatus)
                        : ""}
                    </p>
                    {details ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                        {details}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
        </ol>
      )}
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
                  <p className="text-lg font-bold">B2B PROCUREMENT INVOICE</p>
                  <p className="text-xs text-gray-500">{inv.invoiceNumber} · Order {inv.orderNumber}</p>
                  {inv.recurring && inv.scheduledDeliveryDate ? (
                    <p className="text-xs text-gray-500">Contract {inv.contractNumber || "—"} · Delivery {String(inv.scheduledDeliveryDate).slice(0, 10)}</p>
                  ) : null}
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
                  {inv.seller?.gstin ? <p className="text-xs text-gray-500">GSTIN: {inv.seller.gstin}</p> : null}
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
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatPrice(inv.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Delivery</span><span>{formatPrice(inv.deliveryCharge)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Other charges</span><span>{formatPrice(inv.otherCharges || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Taxes ({Number(inv.taxRate || 0)}%)</span><span>{formatPrice(inv.taxes || 0)}</span></div>
                <div className="flex justify-between border-t pt-2 text-base font-bold"><span>Invoice total</span><span>{formatPrice(inv.total)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Amount paid</span><span>{formatPrice(inv.paidAmount || 0)}</span></div>
                <div className="flex justify-between font-semibold text-amber-800"><span>Balance due</span><span>{formatPrice(inv.amountDue || 0)}</span></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
                <span className="capitalize">Method: {inv.paymentMode || "—"} · Terms: {String(inv.paymentTerms || "—").replace(/_/g, " ")} · {inv.paymentStatus || "pending"}</span>
                <span>Issued {inv.issuedAt ? new Date(inv.issuedAt).toLocaleString("en-IN") : "—"}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const response = await fetch(`/api/invoice-pdf/${order.id}`, { credentials: "include" });
                      if (!response.ok) throw new Error(`Download failed (${response.status})`);
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${inv.invoiceNumber || "invoice"}.pdf`;
                      document.body.appendChild(link);
                      link.click();
                      link.remove();
                      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (error: any) {
                      toast.error(error?.message || "Could not download invoice");
                    }
                  }}
                >
                  <Download className="mr-1.5 h-4 w-4" /> Download PDF
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Procurement invoice for order records. A statutory GST tax invoice, where applicable, must be issued by the registered supplier.
              </p>
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


function GoodsReceiptModal({ order, onClose }: { order: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const orderedQuantity = Math.max(0, Number(order.quantityKg || 0));
  const [receivedQuantity, setReceivedQuantity] = useState(String(orderedQuantity));
  const [acceptedQuantity, setAcceptedQuantity] = useState(String(orderedQuantity));
  const [issues, setIssues] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [evidenceUrls, setEvidenceUrls] = useState("");
  const submit = useMutation({
    mutationFn: (payload: any) => api.post(`/b2b/orders/${encodeURIComponent(order.id)}/goods-receipt`, payload),
    onSuccess: async (response: any) => {
      toast.success(response?.data?.message || "Goods receipt saved");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] }),
        queryClient.invalidateQueries({ queryKey: ["b2b", "payments"] }),
        queryClient.invalidateQueries({ queryKey: ["b2b", "analytics"] }),
      ]);
      onClose();
    },
    onError: (error: any) => toast.error(error?.message || "Could not save goods receipt"),
  });

  const issueOptions = [
    { key: "missing_quantity", label: "Missing quantity" },
    { key: "rejected_quantity", label: "Quantity rejected" },
    { key: "quality_issue", label: "Quality does not meet requirements" },
    { key: "damaged_goods", label: "Produce damaged during handling" },
    { key: "wrong_product", label: "Wrong product delivered" },
    { key: "packaging_issue", label: "Packaging problem" },
  ];
  const received = Number(receivedQuantity);
  const accepted = Number(acceptedQuantity);
  const valid = receivedQuantity.trim() !== "" && acceptedQuantity.trim() !== ""
    && Number.isFinite(received) && Number.isFinite(accepted)
    && received >= 0 && received <= orderedQuantity
    && accepted >= 0 && accepted <= received;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-5" onClick={onClose}>
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-slate-950">Goods receipt & inspection</p>
              <p className="mt-1 text-sm text-slate-500">{order.orderNumber} · {order.productName || "B2B produce"} · Supplier {order.farmerInfo?.farmName || "Farm"}</p>
            </div>
            <Badge variant="outline">Delivered</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
            <div><p className="text-xs text-slate-500">Ordered quantity</p><p className="text-lg font-bold">{orderedQuantity} kg</p></div>
            <div><p className="text-xs text-slate-500">Order value</p><p className="text-lg font-bold">{formatPrice(order.totalAmount || 0)}</p></div>
            <div className="col-span-2 sm:col-span-1"><p className="text-xs text-slate-500">Payment status</p><p className="text-sm font-semibold capitalize">{String(order.paymentStatus || "pending").replace(/_/g, " ")}</p></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-800">Quantity received (kg)</label>
              <Input inputMode="decimal" value={receivedQuantity} onChange={(event) => {
                setReceivedQuantity(event.target.value);
                const nextReceived = Number(event.target.value);
                if (Number.isFinite(nextReceived) && nextReceived >= 0) setAcceptedQuantity((current) => String(Math.min(Number(current || 0), nextReceived)));
              }} />
              <p className="text-xs text-slate-500">Enter the physical quantity delivered to your business.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-800">Quantity accepted (kg)</label>
              <Input inputMode="decimal" value={acceptedQuantity} onChange={(event) => setAcceptedQuantity(event.target.value)} />
              <p className="text-xs text-slate-500">Enter the quantity accepted after quality inspection.</p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-800">Inspection issues</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {issueOptions.map((issue) => (
                <label key={issue.key} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 text-sm text-slate-700">
                  <input type="checkbox" checked={issues.includes(issue.key)} onChange={(event) => setIssues((current) => event.target.checked ? [...current, issue.key] : current.filter((value) => value !== issue.key))} />
                  {issue.label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-800">Inspection notes</label>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={3000} placeholder="Describe the condition, shortage, damaged quantity or quality problem…" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-800">Evidence links (optional)</label>
            <textarea value={evidenceUrls} onChange={(event) => setEvidenceUrls(event.target.value)} rows={2} placeholder="Paste one image/document URL per line (HTTP or HTTPS)" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            <p className="text-xs text-slate-500">Add up to five links to inspection photographs or supporting documents.</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            Full accepted quantity completes the order and makes the invoice available. A shortage or quality issue opens a supplier dispute. This inspection does not automatically charge, refund or change the payment balance.
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!valid || submit.isPending} onClick={() => submit.mutate({
              receivedQuantityKg: received,
              acceptedQuantityKg: accepted,
              issues,
              notes,
              evidenceUrls: evidenceUrls.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
            })}>
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              {submit.isPending ? "Saving inspection…" : "Submit goods receipt"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


function GoodsReceiptDisputeModal({ order, onClose }: { order: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const receipt = order.goodsReceipt || {};
  const [resolution, setResolution] = useState("accept_as_is");
  const [notes, setNotes] = useState("");
  const [replacementQuantity, setReplacementQuantity] = useState(String(Math.max(0, Number(receipt.requestedQuantityKg || order.quantityKg || 0) - Number(receipt.acceptedQuantityKg || 0))));

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post(`/b2b/orders/${encodeURIComponent(order.id)}/goods-receipt/resolve`, payload),
    onSuccess: async (response: any) => {
      toast.success(response?.data?.message || "Dispute resolution saved");
      await queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
      onClose();
    },
    onError: (error: any) => toast.error(error?.message || "Could not resolve goods receipt dispute"),
  });

  const resolutionOptions = [
    { key: "replacement_received", label: "Replacement produce received" },
    { key: "accept_as_is", label: "Accept the received quantity as-is" },
    { key: "credit_or_refund_agreed", label: "Credit / refund agreed separately" },
    { key: "withdrawn", label: "Withdraw the dispute" },
  ];
  const evidence = Array.isArray(receipt.evidenceUrls) ? receipt.evidenceUrls : [];
  const farmerEvidence = Array.isArray(receipt.farmerResponse?.evidenceUrls) ? receipt.farmerResponse.evidenceUrls : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-5" onClick={onClose}>
      <Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-slate-950">Goods receipt dispute</p>
              <p className="mt-1 text-sm text-slate-500">{order.orderNumber} · {order.productName || "B2B produce"} · {order.farmerInfo?.farmName || "Supplier"}</p>
            </div>
            <Badge variant={receipt.status === "response_received" ? "success" : "warning"}>{receipt.status === "response_received" ? "Supplier responded" : "Awaiting supplier"}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center">
            <div><p className="text-xs text-slate-500">Ordered</p><p className="font-bold">{receipt.requestedQuantityKg ?? order.quantityKg} kg</p></div>
            <div><p className="text-xs text-slate-500">Received</p><p className="font-bold">{receipt.receivedQuantityKg ?? "—"} kg</p></div>
            <div><p className="text-xs text-slate-500">Accepted</p><p className="font-bold">{receipt.acceptedQuantityKg ?? "—"} kg</p></div>
          </div>
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
            <p className="text-sm font-semibold text-amber-950">Business inspection report</p>
            <p className="text-xs text-slate-700">Issues: {(receipt.issueTypes || []).map((value: string) => value.replace(/_/g, " ")).join(", ") || "Not specified"}</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{receipt.notes || "No inspection notes supplied."}</p>
            {evidence.length ? <div className="flex flex-wrap gap-2">{evidence.map((url: string) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-700 underline">Open buyer evidence</a>)}</div> : null}
          </div>
          {receipt.farmerResponse ? (
            <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-sm font-semibold text-emerald-950">Supplier response · {String(receipt.farmerResponse.proposal || "").replace(/_/g, " ")}</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{receipt.farmerResponse.notes}</p>
              {farmerEvidence.length ? <div className="flex flex-wrap gap-2">{farmerEvidence.map((url: string) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-700 underline">Open supplier evidence</a>)}</div> : null}
            </div>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">The supplier has not responded yet. You may wait for their response or record an agreed resolution when ready.</p>
          )}
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-800">Resolution</label>
            <select value={resolution} onChange={(event) => setResolution(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">
              {resolutionOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </div>
          {resolution === "replacement_received" ? (
            <div className="space-y-1">
              <label className="text-sm font-semibold text-slate-800">Replacement quantity received (kg)</label>
              <Input inputMode="decimal" value={replacementQuantity} onChange={(event) => setReplacementQuantity(event.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-800">Resolution notes</label>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} maxLength={3000} placeholder="Record the agreed outcome and any supporting details…" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
          </div>
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            Recording an agreed credit/refund does not move money or alter the paid balance. Process any financial adjustment separately. Once resolved, confirm final receipt to complete the order and issue its invoice.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button disabled={!notes.trim() || mutation.isPending || (resolution === "replacement_received" && (!Number.isFinite(Number(replacementQuantity)) || Number(replacementQuantity) <= 0))} onClick={() => mutation.mutate({
              resolution,
              notes,
              replacementReceivedQuantityKg: resolution === "replacement_received" ? Number(replacementQuantity) : 0,
            })}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              {mutation.isPending ? "Saving resolution…" : "Save resolution"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


export default function BusinessOrdersPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [detailTabs, setDetailTabs] = useState<Record<string, string>>({});
  const [invoiceFor, setInvoiceFor] = useState<any>(null);
  const [rateFor, setRateFor] = useState<any>(null);
  const [goodsReceiptFor, setGoodsReceiptFor] = useState<any>(null);
  const [goodsReceiptDisputeFor, setGoodsReceiptDisputeFor] = useState<any>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || (window as any).Razorpay) return;
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => { script.remove(); };
  }, []);

  const payB2BOrder = async (order: any) => {
    setPayingId(order.id);
    try {
      const intentResponse = await api.post(
        "/b2b/orders/" + encodeURIComponent(order.id) + "/payment-intent",
        { payment_method: "razorpay" },
      );
      const intent = intentResponse?.data?.data || intentResponse?.data || intentResponse;
      if (!intent?.order_id || !intent?.payment_id) {
        throw new Error(intent?.error || "Could not start online payment. Check Razorpay configuration.");
      }
      if (!(window as any).Razorpay) {
        throw new Error("Razorpay Checkout is still loading. Please try again.");
      }
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        const checkout = new (window as any).Razorpay({
          key: intent.key_id,
          amount: intent.amount,
          currency: intent.currency || "INR",
          name: intent.name || "AgriConnect",
          description: intent.description || ("B2B Order " + order.orderNumber),
          order_id: intent.order_id,
          prefill: intent.prefill || {},
          theme: intent.theme || { color: "#059669" },
          handler: async (response: any) => {
            try {
              await api.post(
                "/b2b/orders/" + encodeURIComponent(order.id) + "/verify-payment",
                {
                  payment_id: intent.payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                },
              );
              toast.success("Payment verified for " + order.orderNumber);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] }),
                queryClient.invalidateQueries({ queryKey: ["b2b", "payments"] }),
              ]);
              finish();
            } catch (error: any) {
              finish(new Error(error?.message || "Payment verification failed. Check payment history before retrying."));
            }
          },
          modal: { ondismiss: () => finish() },
        });
        checkout.on("payment.failed", (event: any) => {
          finish(new Error(event?.error?.description || "Payment failed. No successful payment was recorded."));
        });
        checkout.open();
      });
    } catch (error: any) {
      toast.error(error?.message || "B2B payment failed");
    } finally {
      setPayingId(null);
    }
  };

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ["b2b", "orders"],
    queryFn: () => api.get("/b2b/orders"),
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  const { data: contractsData } = useQuery({
    queryKey: ["businessContracts"],
    queryFn: () => api.get("/b2b/contracts"),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const shortageReports = (contractsData?.data?.contracts || contractsData?.data || [])
    .flatMap((contract: any) => {
      const contractId = String(contract.id || contract._id || "");
      const history = Array.isArray(contract.deliveryHistory) ? contract.deliveryHistory : [];
      return history
        .filter((delivery: any) => ["shortage", "backup_required"].includes(String(delivery.status || "").toLowerCase()))
        .map((delivery: any) => ({
          contractId,
          contractNumber: contract.contractNumber || contractId,
          farmerName: contract.farmerName || "Contract farmer",
          cropName: contract.cropName || "Produce",
          scheduledDate: String(delivery.scheduledDate || ""),
          requestedQuantityKg: Number(delivery.requestedQuantityKg || contract.quantityPerDeliveryKg || 0),
          availableQuantityKg: Number(delivery.availableQuantityKg || 0),
          packedQuantityKg: Number(delivery.packedQuantityKg || 0),
          notes: delivery.notes || delivery.shortageReason || "",
        }));
    })
    .sort((a: any, b: any) => a.scheduledDate.localeCompare(b.scheduledDate));

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.put("/b2b/orders/" + id + "/status", payload),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Order updated");
      queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
      queryClient.invalidateQueries({ queryKey: ["b2b", "rfqs"] });
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update order"),
  });

  const allOrders = (ordersData?.data?.orders || []) as any[];
  const activeOrders = allOrders.filter((order: any) => !["completed", "cancelled"].includes(String(order.status || "").toLowerCase()));
  const logisticsOrders = allOrders.filter((order: any) =>
    [...WAREHOUSE_STATUSES, ...TRANSIT_STATUSES, "delivered"].includes(String(order.status || "").toLowerCase())
  );
  const completedOrders = allOrders.filter((order: any) => order.status === "completed");
  const totalOutstanding = allOrders.reduce((sum: number, order: any) => {
    if (order.status === "cancelled") return sum;
    const total = Number(order.totalAmount || 0);
    return sum + Math.max(0, total - getPaidAmount(order));
  }, 0);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleOrders = allOrders.filter((order: any) => {
    const status = String(order.status || "").toLowerCase();
    const paid = getPaidAmount(order);
    const due = Math.max(0, Number(order.totalAmount || 0) - paid);
    const matchesFilter =
      filter === "all" ||
      (filter === "attention" && (order.qualityCheck === "failed" || (String(order.paymentTerms || "").toLowerCase() === "advance" && due > 0))) ||
      (filter === "preparation" && ["confirmed", "preparing", "quality_check"].includes(status)) ||
      (filter === "ready" && status === "ready_for_pickup") ||
      (filter === "warehouse" && WAREHOUSE_STATUSES.includes(status)) ||
      (filter === "transit" && TRANSIT_STATUSES.includes(status)) ||
      (filter === "delivered" && status === "delivered") ||
      (filter === "completed" && status === "completed") ||
      (filter === "cancelled" && status === "cancelled");
    if (!matchesFilter) return false;
    if (!normalizedSearch) return true;
    const haystack = [
      order.orderNumber,
      order.id,
      order.productName,
      order.farmerInfo?.farmName,
      order.contractNumber,
      order.deliveryCity,
      order.scheduledDeliveryDate,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedSearch);
  });

  const filterCount = (key: string) => allOrders.filter((order: any) => {
    const status = String(order.status || "").toLowerCase();
    const due = Math.max(0, Number(order.totalAmount || 0) - getPaidAmount(order));
    if (key === "all") return true;
    if (key === "attention") return order.qualityCheck === "failed" || (String(order.paymentTerms || "").toLowerCase() === "advance" && due > 0);
    if (key === "preparation") return ["confirmed", "preparing", "quality_check"].includes(status);
    if (key === "ready") return status === "ready_for_pickup";
    if (key === "warehouse") return WAREHOUSE_STATUSES.includes(status);
    if (key === "transit") return TRANSIT_STATUSES.includes(status);
    if (key === "delivered") return status === "delivered";
    if (key === "completed") return status === "completed";
    if (key === "cancelled") return status === "cancelled";
    return false;
  }).length;

  const selectDetailsTab = (orderId: string, tab: string) => {
    setDetailTabs((current) => ({ ...current, [orderId]: tab }));
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
        <div className="h-56 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Business procurement workspace</p>
          <div className="mt-1 flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Orders & Deliveries</h1>
              <p className="mt-1 text-sm text-slate-500">Manage every purchase, fulfillment stage, delivery and payment in one place.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["b2b", "orders"] });
            queryClient.invalidateQueries({ queryKey: ["businessContracts"] });
          }}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button onClick={() => window.location.assign("/business/rfqs/new")}>
            <ShoppingCart className="h-4 w-4" /> Create RFQ
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Package className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-2xl font-bold text-slate-950">{allOrders.length}</p><p className="text-xs text-slate-500">Total orders</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Clock3 className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-2xl font-bold text-slate-950">{activeOrders.length}</p><p className="text-xs text-slate-500">Active orders</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Truck className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-2xl font-bold text-slate-950">{logisticsOrders.length}</p><p className="text-xs text-slate-500">In delivery flow</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="text-2xl font-bold text-slate-950">{completedOrders.length}</p><p className="text-xs text-slate-500">Completed</p></div>
          </CardContent>
        </Card>
        <Card className="col-span-2 xl:col-span-1">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><Wallet className="h-5 w-5" /></div>
            <div className="min-w-0"><p className="truncate text-xl font-bold text-slate-950">{formatPrice(totalOutstanding)}</p><p className="text-xs text-slate-500">Outstanding balance</p></div>
          </CardContent>
        </Card>
      </section>

      {shortageReports.length > 0 ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="space-y-3 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800"><AlertTriangle className="h-5 w-5" /></div>
              <div className="min-w-0">
                <h2 className="font-semibold text-amber-950">Recurring delivery shortages <span className="ml-1 text-sm font-medium">({shortageReports.length})</span></h2>
                <p className="mt-1 text-sm text-amber-900">Review the affected delivery and arrange a replacement or shortage resolution.</p>
              </div>
            </div>
            {shortageReports.map((report: any) => (
              <div key={report.contractId + ":" + report.scheduledDate} className="rounded-xl border border-amber-200 bg-white p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-900">{report.cropName} · {report.contractNumber}</p>
                      <Badge variant="warning">Decision required</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">Farmer: {report.farmerName} · Scheduled: {report.scheduledDate || "Not specified"}</p>
                    <p className="mt-1 text-sm text-slate-700">Required {report.requestedQuantityKg} kg · Available {report.availableQuantityKg} kg · Packed {report.packedQuantityKg} kg · Shortage {Math.max(0, report.requestedQuantityKg - Math.min(report.availableQuantityKg, report.packedQuantityKg))} kg</p>
                    {report.notes ? <p className="mt-1 text-xs text-slate-500">Farmer note: {report.notes}</p> : null}
                  </div>
                  <Button size="sm" onClick={() => window.location.assign("/business/contracts?replacementContractId=" + encodeURIComponent(report.contractId) + "&scheduledDate=" + encodeURIComponent(report.scheduledDate))}>
                    Review shortage <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Find an order</h2>
              <p className="mt-0.5 text-xs text-slate-500">Search by order number, product, supplier or contract.</p>
            </div>
            <div className="relative w-full lg:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search orders…" className="h-11 rounded-xl pl-9" />
            </div>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {ORDER_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={"inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors " + (
                  filter === item.key
                    ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
                )}
              >
                {item.label}
                <span className={"rounded-md px-1.5 py-0.5 text-[10px] " + (filter === item.key ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500")}>{filterCount(item.key)}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{ORDER_FILTERS.find((item) => item.key === filter)?.label || "Orders"}</h2>
            <p className="text-xs text-slate-500">Showing {visibleOrders.length} of {allOrders.length} orders</p>
          </div>
          <p className="text-xs text-slate-400">Updates automatically every 10 seconds</p>
        </div>

        {visibleOrders.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><ShoppingCart className="h-6 w-6" /></div>
              <h3 className="mt-3 font-semibold text-slate-900">{allOrders.length === 0 ? "No purchase orders yet" : "No matching orders"}</h3>
              <p className="mt-1 max-w-md text-sm text-slate-500">{allOrders.length === 0 ? "Accept a farmer quote from My RFQs to create your first purchase order." : "Try another status filter or search term."}</p>
              {allOrders.length === 0 ? <Button className="mt-4" onClick={() => window.location.assign("/business/rfqs")} >Review My RFQs</Button> : null}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visibleOrders.map((order: any) => {
              const total = Math.max(0, Number(order.totalAmount || 0));
              const paid = getPaidAmount(order);
              const due = Math.max(0, total - paid);
              const expanded = expandedOrderId === order.id;
              const activeTab = detailTabs[order.id] || "activity";
              const typeLabel = order.recurring ? "Recurring delivery" : "One-off order";
              const deliveryDate = order.scheduledDeliveryDate || order.expectedDeliveryDate || order.requiredDate;
              const paymentState = String(order.paymentStatus || "pending").toLowerCase();
              const deliveryMethod = String(order.deliveryMethod || "Not assigned").replace(/_/g, " ");
              return (
                <Card key={order.id} className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-950">{order.orderNumber || order.id}</span>
                          <Badge variant="outline">{typeLabel}</Badge>
                          <Badge variant={statusVariant[order.status] || "secondary"}>{STATUS_LABELS[order.status] || String(order.status || "Unknown").replace(/_/g, " ")}</Badge>
                          {order.goodsReceipt?.status === "dispute_open" ? <Badge variant="warning">Goods receipt dispute</Badge> : null}
                          {order.goodsReceipt?.status === "response_received" ? <Badge variant="success">Supplier responded</Badge> : null}
                          {order.goodsReceipt?.status === "resolved" && order.status === "delivered" ? <Badge variant="outline">Resolution recorded · confirm receipt</Badge> : null}
                          {order.isReplacementSupply ? <Badge variant="warning">Replacement supply</Badge> : null}
                          {order.farmerInfo?.isVerified ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Verified supplier</span> : null}
                        </div>
                        <h3 className="text-base font-semibold text-slate-900">{order.productName || "B2B produce order"}</h3>
                        <p className="text-sm text-slate-500">{order.quantityKg || 0} kg · {order.qualityGrade || "Quality grade not specified"} · {order.farmerInfo?.farmName || "Farm supplier"}</p>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Order total</p>
                          <p className="text-xl font-bold tracking-tight text-slate-950">{formatPrice(total)}</p>
                        </div>
                        <Badge variant={paymentState === "paid" ? "success" : paid > 0 ? "warning" : "outline"} className="capitalize">{paymentState === "paid" ? "Paid" : paid > 0 ? "Partially paid" : "Payment pending"}</Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 p-3">
                        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Delivery date</p><p className="mt-0.5 truncate text-xs font-semibold text-slate-700">{displayDate(deliveryDate)}</p></div>
                      </div>
                      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 p-3">
                        <Truck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Delivery method</p><p className="mt-0.5 truncate text-xs font-semibold capitalize text-slate-700">{deliveryMethod}</p></div>
                      </div>
                      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 p-3">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Destination</p><p className="mt-0.5 truncate text-xs font-semibold text-slate-700">{[order.deliveryCity, order.deliveryState].filter(Boolean).join(", ") || "Address pending"}</p></div>
                      </div>
                      <div className="flex min-w-0 items-start gap-2 rounded-xl bg-slate-50 p-3">
                        <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Balance due</p><p className="mt-0.5 truncate text-xs font-semibold text-slate-700">{formatPrice(due)}</p></div>
                      </div>
                    </div>

                    <StatusTimeline status={order.status} />

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>Supplier: {order.farmerInfo?.farmName || "Farm"}</span>
                        {order.recurring && order.contractNumber ? <span className="rounded-md bg-violet-50 px-2 py-1 font-medium text-violet-700">Contract {order.contractNumber}</span> : null}
                        {order.requiredDate && !order.scheduledDeliveryDate ? <span>Required {displayDate(order.requiredDate)}</span> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {order.status !== "cancelled" && due > 0 ? (
                          <Button size="sm" disabled={payingId === order.id} onClick={() => payB2BOrder(order)}>
                            {payingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                            {payingId === order.id ? "Processing…" : "Pay online"}
                          </Button>
                        ) : null}
                        {order.status === "delivered" && !order.goodsReceipt ? (
                          <Button size="sm" onClick={() => setGoodsReceiptFor(order)}>
                            <ClipboardCheck className="h-4 w-4" /> Inspect delivery
                          </Button>
                        ) : null}
                        {order.status === "delivered" && ["dispute_open", "response_received"].includes(String(order.goodsReceipt?.status || "")) ? (
                          <Button size="sm" variant="outline" onClick={() => setGoodsReceiptDisputeFor(order)}>
                            <AlertTriangle className="h-4 w-4" /> {order.goodsReceipt?.status === "response_received" ? "Review supplier response" : "Review dispute"}
                          </Button>
                        ) : null}
                        {order.status === "delivered" && order.goodsReceipt?.status === "resolved" ? (
                          <Button size="sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate({ id: order.id, payload: { status: "completed" } })}>
                            <CheckCircle className="h-4 w-4" /> Confirm final receipt
                          </Button>
                        ) : null}
                        {order.status === "completed" ? (
                          <Button size="sm" variant="outline" onClick={() => setInvoiceFor(order)}>
                            <FileText className="h-4 w-4" /> Invoice
                          </Button>
                        ) : null}
                        {order.status === "completed" ? (
                          <Button size="sm" variant="outline" onClick={() => setRateFor(order)}>
                            <Star className="h-4 w-4" /> Rate supplier
                          </Button>
                        ) : null}
                        {order.status === "confirmed" ? (
                          <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => updateMutation.mutate({ id: order.id, payload: { status: "cancelled" } })}>
                            <XCircle className="h-4 w-4" /> Cancel
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" onClick={() => {
                          setExpandedOrderId(expanded ? null : order.id);
                          if (!expanded) setDetailTabs((current) => ({ ...current, [order.id]: current[order.id] || "activity" }));
                        }}>
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          {expanded ? "Hide details" : "View details"}
                        </Button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="space-y-4 border-t border-slate-200 pt-4">
                        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
                          {[
                            { key: "activity", label: "Activity", icon: Clock3 },
                            { key: "delivery", label: "Delivery", icon: Truck },
                            { key: "payment", label: "Payment", icon: Wallet },
                            { key: "invoice", label: "Invoice", icon: FileText },
                          ].map((tab) => (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => selectDetailsTab(order.id, tab.key)}
                              className={"inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors " + (activeTab === tab.key ? "bg-white text-emerald-800 shadow-sm" : "text-slate-500 hover:text-slate-800")}
                            >
                              <tab.icon className="h-3.5 w-3.5" /> {tab.label}
                            </button>
                          ))}
                        </div>

                        {activeTab === "activity" ? <OrderActivityTimeline order={order} /> : null}

                        {activeTab === "delivery" ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              <DetailValue label="Current delivery stage" value={STATUS_LABELS[order.status] || order.status} icon={Truck} />
                              <DetailValue label="Delivery method" value={deliveryMethod} icon={Package} />
                              <DetailValue label="Expected / required date" value={displayDate(deliveryDate)} icon={CalendarDays} />
                              <DetailValue label="Pickup team" value={order.pickupTeamName || order.pickupTeam?.name || order.pickupAssignment?.teamName} icon={Truck} />
                              <DetailValue label="Warehouse" value={order.warehouseName || order.sourceWarehouseName || order.destinationWarehouseName} icon={Package} />
                              <DetailValue label="Route / tracking" value={order.routeNumber || order.trackingNumber || order.deliveryRouteNumber} icon={MapPin} />
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Delivery address</p>
                              <p className="text-sm leading-6 text-slate-700">{displayAddress(order.deliveryAddress)}</p>
                              {order.deliveryTimeSlot ? <p className="mt-1 text-xs text-slate-500">Preferred time: {order.deliveryTimeSlot}</p> : null}
                            </div>
                            <p className="text-xs text-slate-500">Pickup, warehouse and transfer actions are recorded against the same B2B order. Use Activity to review the full timestamped history.</p>
                          </div>
                        ) : null}

                        {activeTab === "payment" ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <DetailValue label="Order total" value={formatPrice(total)} icon={Wallet} />
                              <DetailValue label="Amount paid" value={formatPrice(paid)} icon={CheckCircle} />
                              <DetailValue label="Balance due" value={formatPrice(due)} icon={AlertTriangle} />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <DetailValue label="Payment method" value={order.paymentMode || "Not selected"} icon={CreditCard} />
                              <DetailValue label="Payment terms" value={String(order.paymentTerms || "Not specified").replace(/_/g, " ")} icon={FileText} />
                              <DetailValue label="Payment status" value={paymentState} icon={Wallet} />
                              <DetailValue label="Payment transaction" value={order.paymentTransactionId || order.paymentId || "No verified transaction"} icon={FileText} />
                            </div>
                            {due > 0 && order.status !== "cancelled" ? (
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                                <div><p className="text-sm font-semibold text-amber-950">Outstanding balance</p><p className="text-xs text-amber-800">Pay the remaining amount through the secure online checkout.</p></div>
                                <Button size="sm" disabled={payingId === order.id} onClick={() => payB2BOrder(order)}>
                                  <CreditCard className="h-4 w-4" /> {payingId === order.id ? "Processing…" : "Pay online"}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {activeTab === "invoice" ? (
                          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700"><FileText className="h-5 w-5" /></div>
                              <div>
                                <p className="text-sm font-semibold text-slate-900">Final procurement invoice</p>
                                <p className="mt-1 text-xs leading-5 text-slate-500">{order.recurring ? "This invoice belongs to this completed scheduled delivery occurrence." : "The final invoice is generated after the business confirms receipt and completes the order."}</p>
                              </div>
                            </div>
                            {order.status === "completed" ? (
                              <Button size="sm" onClick={() => setInvoiceFor(order)}><FileText className="h-4 w-4" /> View invoice</Button>
                            ) : (
                              <Badge variant="outline">Available after completion</Badge>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {invoiceFor ? <InvoiceModal order={invoiceFor} onClose={() => setInvoiceFor(null)} /> : null}
      {rateFor ? <RateFarmerModal order={rateFor} onClose={() => setRateFor(null)} /> : null}
      {goodsReceiptFor ? <GoodsReceiptModal order={goodsReceiptFor} onClose={() => setGoodsReceiptFor(null)} /> : null}
      {goodsReceiptDisputeFor ? <GoodsReceiptDisputeModal order={goodsReceiptDisputeFor} onClose={() => setGoodsReceiptDisputeFor(null)} /> : null}
    </div>
  );
}
