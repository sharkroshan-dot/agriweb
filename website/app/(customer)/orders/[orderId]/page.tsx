"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Box, CalendarDays, CheckCircle2, Clock3, CreditCard,
  Download, FileText, Headphones, MapPin, Package, Phone,
  Truck, XCircle
} from "lucide-react";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";
import { api } from "../../../../lib/api/client";
import { formatDate, formatPrice } from "../../../../lib/utils";
import { LiveChatDialog } from "../../../../components/delivery/live-chat-dialog";

const statusStyles: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  processing: "border-violet-200 bg-violet-50 text-violet-700",
  preparing: "border-violet-200 bg-violet-50 text-violet-700",
  ready_for_delivery: "border-indigo-200 bg-indigo-50 text-indigo-700",
  dispatched: "border-sky-200 bg-sky-50 text-sky-700",
  in_transit: "border-sky-200 bg-sky-50 text-sky-700",
  delivered: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  refunded: "border-orange-200 bg-orange-50 text-orange-700",
};

const stages = [
  { key: "confirmed", label: "Confirmed", description: "Your order has been confirmed." },
  { key: "preparing", label: "Preparing", description: "Your order is being prepared by the farmer." },
  { key: "dispatched", label: "Dispatched", description: "Your order has left the dispatch point." },
  { key: "in_transit", label: "In Transit", description: "Your order is on its way." },
  { key: "delivered", label: "Delivered", description: "Your order has been delivered." },
];

function titleCase(value: string) {
  return String(value || "pending").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function OrderDetailPage() {
  const [chatOpen, setChatOpen] = useState(false);
  const params = useParams();
  const orderId = params.orderId as string;

  const { data, isLoading, error } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api.get(`/orders/${orderId}`),
    enabled: !!orderId,
    refetchInterval: 15000,
  });

  const raw = data?.data || data;
  const order = raw ? {
    id: raw.id || raw._id,
    number: raw.orderNumber || raw.id || raw._id,
    status: String(raw.status || raw.orderStatus || "pending").toLowerCase(),
    date: raw.orderDate || raw.createdAt,
    items: (raw.items || []).map((item: any) => ({
      id: item.productId || item.product_id || item.id,
      name: item.productName || item.name || "Product",
      image: item.productImage || item.image,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      total: Number(item.totalPrice ?? (Number(item.unitPrice || 0) * Number(item.quantity || 0))),
    })),
    subtotal: Number(raw.subtotal || 0),
    delivery: Number(raw.deliveryCharge || 0),
    platformFee: Number(raw.platformFee || 0),
    discount: Number(raw.discount || 0),
    total: Number(raw.totalAmount || 0),
    paymentMethod: raw.paymentMethod || "Not specified",
    paymentStatus: raw.paymentStatus || raw.payment?.status || (raw.paymentMethod === "cash" ? "Pending" : "Not available"),
    address: raw.deliveryAddress || {},
    estimatedDelivery: raw.deliveryDate || raw.estimatedDeliveryDate,
    history: (raw.statusHistory || []).slice().sort((a: any, b: any) =>
      new Date(a.timestamp || a.createdAt || 0).getTime() - new Date(b.timestamp || b.createdAt || 0).getTime()
    ),
  } : null;

  if (isLoading) {
    return <div className="flex min-h-[320px] items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div>;
  }

  if (error || !order) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 py-10">
        <Link href="/orders" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-emerald-700"><ArrowLeft className="h-4 w-4" /> My Orders</Link>
        <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Package className="h-10 w-10 text-slate-300" />
          <p className="font-semibold text-slate-900">{error ? "Unable to load order" : "Order not found"}</p>
          <p className="text-sm text-slate-500">Please refresh or return to your orders.</p>
          <Button asChild><Link href="/orders">Back to My Orders</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  const addressName = [order.address.addressLine1, order.address.addressLine2, order.address.landmark, order.address.city, order.address.state, order.address.zipCode || order.address.postalCode]
    .filter(Boolean).join(", ");
  const currentIndex = order.status === "delivered" ? 4
    : ["in_transit", "out_for_delivery", "shipped"].includes(order.status) ? 3
    : ["dispatched"].includes(order.status) ? 2
    : ["preparing", "processing", "ready_for_delivery", "packed"].includes(order.status) ? 1 : 0;
  const currentStage = stages[Math.min(currentIndex, stages.length - 1)];
  const paymentLabel = titleCase(String(order.paymentMethod));
  const paymentStatus = titleCase(String(order.paymentStatus));
  const isCancelled = ["cancelled", "refunded"].includes(order.status);

  return (
    <div className="customer-retail-shell space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Link href="/orders" className="hover:text-emerald-700">My Orders</Link><span>›</span><span className="text-slate-800">Order Details</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/orders" aria-label="Back to My Orders" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><FileText className="h-6 w-6" /></div>
            <div><h1 className="text-2xl font-extrabold tracking-tight text-slate-950">Order Details</h1><p className="text-sm text-slate-500">Complete information about your order</p></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" className="rounded-xl border-slate-200 bg-white"><Link href={`/orders/${orderId}/track`}><Truck className="mr-2 h-4 w-4 text-emerald-700" /> Track Order</Link></Button>
          <Button asChild variant="outline" className="rounded-xl border-slate-200 bg-white"><Link href={`/orders/${orderId}/invoice`}><Download className="mr-2 h-4 w-4" /> Download Invoice</Link></Button>
          <Button variant="outline" className="rounded-xl border-slate-200 bg-white" onClick={() => setChatOpen(true)}><Headphones className="mr-2 h-4 w-4" /> Need Help?</Button>
        </div>
      </div>

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-5 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-slate-50">
              {order.items[0]?.image ? <img src={order.items[0].image} alt={order.items[0].name} className="h-full w-full object-contain" /> : <Package className="h-8 w-8 text-slate-300" />}
            </div>
            <div className="min-w-0"><p className="break-all text-lg font-extrabold text-slate-950">Order #{order.number}</p><p className="mt-1 text-sm text-slate-500">Placed on {order.date ? formatDate(order.date) : "Date unavailable"}</p></div>
            <Badge className={statusStyles[order.status] || "border-slate-200 bg-slate-50 text-slate-700"}>{titleCase(order.status)}</Badge>
          </div>
          <div className="min-w-[130px] border-l border-slate-100 pl-5 text-right"><p className="text-xs font-medium text-slate-500">Total Amount</p><p className="text-xl font-extrabold text-slate-950">{formatPrice(order.total)}</p><Badge className="mt-1 border-emerald-200 bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" /> {paymentStatus}</Badge></div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.95fr)]">
        <div className="space-y-5">
          <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 py-4"><CardTitle className="flex items-center gap-3 text-base"><Box className="h-5 w-5 text-emerald-700" /> Order Items ({order.items.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-[minmax(0,1.5fr)_0.7fr_0.8fr_0.8fr] gap-3 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"><span>Product</span><span className="text-center">Quantity</span><span className="text-right">Unit Price</span><span className="text-right">Total</span></div>
              {order.items.map((item: any, index: number) => (
                <div key={item.id || index} className="grid grid-cols-[minmax(0,1.5fr)_0.7fr_0.8fr_0.8fr] items-center gap-3 border-b border-slate-100 px-5 py-4 text-sm last:border-0">
                  <div className="flex min-w-0 items-center gap-3"><div className="h-12 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-50">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-contain" /> : <Package className="m-3 h-6 w-6 text-slate-300" />}</div><span className="truncate font-semibold text-slate-900">{item.name}</span></div>
                  <span className="text-center text-slate-600">{item.quantity}</span><span className="text-right text-slate-600">{formatPrice(item.unitPrice)}</span><span className="text-right font-semibold text-slate-900">{formatPrice(item.total)}</span>
                </div>
              ))}
              <div className="ml-auto max-w-sm space-y-2 px-5 py-4 text-sm">
                <div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{formatPrice(order.subtotal)}</span></div>
                <div className="flex justify-between text-slate-600"><span>Delivery Charge</span><span>{formatPrice(order.delivery)}</span></div>
                <div className="flex justify-between text-slate-600"><span>Platform Fee</span><span>{formatPrice(order.platformFee)}</span></div>
                {order.discount > 0 && <div className="flex justify-between text-emerald-700"><span>Discount</span><span>-{formatPrice(order.discount)}</span></div>}
                <div className="flex justify-between rounded-lg bg-emerald-50 px-3 py-3 text-base font-extrabold text-slate-950"><span>Total Amount</span><span>{formatPrice(order.total)}</span></div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 py-4"><CardTitle className="flex items-center gap-3 text-base"><MapPin className="h-5 w-5 text-emerald-700" /> Delivery Address</CardTitle></CardHeader>
              <CardContent className="space-y-3 p-5 text-sm">
                <p className="font-bold text-slate-900">{order.address.fullName || order.address.name || "Delivery recipient"}</p>
                <p className="leading-relaxed text-slate-600">{addressName || "Delivery address not available"}</p>
                {order.address.phone && <p className="flex items-center gap-2 text-slate-600"><Phone className="h-4 w-4 text-emerald-700" />{order.address.phone}</p>}
                {order.estimatedDelivery && <p className="flex items-center gap-2 border-t pt-3 text-slate-600"><CalendarDays className="h-4 w-4 text-emerald-700" /> Estimated delivery: {formatDate(order.estimatedDelivery)}</p>}
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 py-4"><CardTitle className="flex items-center gap-3 text-base"><CreditCard className="h-5 w-5 text-emerald-700" /> Payment Information</CardTitle></CardHeader>
              <CardContent className="space-y-3 p-5 text-sm">
                <div className="flex justify-between gap-3"><span className="text-slate-500">Payment Method</span><span className="text-right font-semibold text-slate-900">{paymentLabel}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">Payment Status</span><span className="font-semibold text-slate-900">{paymentStatus}</span></div>
                <div className="flex justify-between gap-3 border-t pt-3"><span className="text-slate-500">Order Amount</span><span className="font-bold text-slate-900">{formatPrice(order.total)}</span></div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="h-fit rounded-2xl border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-4"><CardTitle className="flex items-center gap-3 text-base"><Clock3 className="h-5 w-5 text-emerald-700" /> Order Timeline</CardTitle></CardHeader>
          <CardContent className="p-5">
            <div className="space-y-1">
              <div className="relative flex gap-3 pb-5"><span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><CheckCircle2 className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-slate-900">Order Placed</p><p className="text-xs text-slate-500">{order.date ? formatDate(order.date) : "Date unavailable"}</p></div></div>
              {stages.map((stage, index) => {
                const done = !isCancelled && index < currentIndex;
                const active = !isCancelled && index === currentIndex;
                const event = order.history.find((entry: any) => {
                  const value = String(entry.status || "").toLowerCase();
                  return stage.key === "preparing" ? ["preparing", "processing", "ready_for_delivery", "packed"].includes(value) : stage.key === "in_transit" ? ["in_transit", "out_for_delivery", "shipped"].includes(value) : value.includes(stage.key);
                });
                return <div key={stage.key} className={`relative flex gap-3 rounded-xl pb-4 last:pb-0 ${active ? "bg-emerald-50 p-3" : "px-0 py-2"}`}>
                  <span className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-emerald-600 bg-emerald-600 text-white" : active ? "border-emerald-600 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-300"}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-current" />}</span>
                  <div className="min-w-0"><p className={`text-sm font-semibold ${active ? "text-emerald-900" : "text-slate-700"}`}>{stage.label}</p>{(done || active) && <p className="mt-0.5 text-xs text-slate-500">{event?.timestamp || event?.createdAt ? formatDate(event.timestamp || event.createdAt) : stage.description}</p>}</div>
                </div>;
              })}
              {isCancelled && <div className="flex items-center gap-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700"><XCircle className="h-5 w-5" />{titleCase(order.status)}</div>}
            </div>
            <Button asChild variant="outline" className="mt-5 w-full rounded-xl"><Link href={`/orders/${orderId}/track`}><Truck className="mr-2 h-4 w-4" /> View Tracking Details</Link></Button>
          </CardContent>
        </Card>
      </div>
      {chatOpen && <LiveChatDialog orderId={orderId} customerName="Customer" onClose={() => setChatOpen(false)} />}
    </div>
  );
}
