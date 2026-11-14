"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown, CalendarDays, CheckCircle2, XCircle,
  Copy, CreditCard, FileText, Layers, Loader2, MapPin, Package,
  RefreshCw, Search, ShoppingBag, Star, Truck, Wallet,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { formatPrice } from "../../lib/utils";
import { api } from "../../lib/api/client";
import { useCartStore } from "../../lib/store/cart-store";
import toast from "react-hot-toast";

const activeStatuses = [
  "pending", "confirmed", "processing", "preparing", "quality_check",
  "ready_for_delivery", "dispatched", "in_transit", "shipped",
  "out_for_delivery", "picked_up",
];

const statusMeta: Record<string, { label: string; className: string; step: number }> = {
  pending: { label: "Pending", className: "border-amber-200 bg-amber-50 text-amber-800", step: 0 },
  confirmed: { label: "Confirmed", className: "border-blue-200 bg-blue-50 text-blue-800", step: 0 },
  processing: { label: "Preparing", className: "border-blue-200 bg-blue-50 text-blue-800", step: 1 },
  preparing: { label: "Preparing", className: "border-blue-200 bg-blue-50 text-blue-800", step: 1 },
  quality_check: { label: "Quality check", className: "border-blue-200 bg-blue-50 text-blue-800", step: 1 },
  ready_for_delivery: { label: "Ready for delivery", className: "border-indigo-200 bg-indigo-50 text-indigo-800", step: 2 },
  dispatched: { label: "Dispatched", className: "border-indigo-200 bg-indigo-50 text-indigo-800", step: 2 },
  shipped: { label: "Shipped", className: "border-indigo-200 bg-indigo-50 text-indigo-800", step: 2 },
  picked_up: { label: "Picked up", className: "border-blue-200 bg-blue-50 text-blue-800", step: 3 },
  in_transit: { label: "In Transit", className: "border-sky-200 bg-sky-100 text-sky-800", step: 3 },
  out_for_delivery: { label: "Out for delivery", className: "border-sky-200 bg-sky-100 text-sky-800", step: 3 },
  delivered: { label: "Delivered", className: "border-green-200 bg-green-50 text-green-800", step: 4 },
  cancelled: { label: "Cancelled", className: "border-red-200 bg-red-50 text-red-700", step: -1 },
  refunded: { label: "Refunded", className: "border-orange-200 bg-orange-50 text-orange-800", step: -1 },
};

const progressSteps = ["Confirmed", "Preparing", "Dispatched", "In Transit", "Delivered"];

function paymentLabel(method: string) {
  const value = method.toLowerCase().replace(/[_-]/g, " ");
  if (!value) return "Payment details unavailable";
  if (value.includes("upi")) return "Online (UPI)";
  if (value.includes("cash") || value.includes("cod")) return "Cash on Delivery";
  if (value.includes("net")) return "Online (Net Banking)";
  if (value.includes("card")) return "Online (Card)";
  return method.replace(/[_-]/g, " ");
}

export default function CustomerOrdersPage() {
  const router = useRouter();
  const addItem = useCartStore((s: any) => s.addItem);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");

  const { data, isLoading } = useQuery({
    queryKey: ["customerOrders", "history"],
    queryFn: () => api.get("/orders", { params: { limit: 100 } }),
  });
  const { data: ratingsData } = useQuery({
    queryKey: ["customerDeliveryRatings"],
    queryFn: () => api.get("/delivery-ratings/me", { params: { limit: 100 } }),
  });
  const { data: refundsData } = useQuery({
    queryKey: ["customerOrdersRefunds"],
    queryFn: () => api.get("/customers/me/refunds", { params: { limit: 100 } }),
  });

  const refundedOrderIds = useMemo(() => {
    const refunds = refundsData?.data || (Array.isArray(refundsData) ? refundsData : []);
    return new Set(refunds.map((r: any) => String(r.orderId)));
  }, [refundsData]);
  const ratedOrderIds = useMemo(() => {
    const ratings = ratingsData?.data?.ratings || (Array.isArray(ratingsData) ? ratingsData : []);
    return new Set(ratings.map((r: any) => String(r.orderId)));
  }, [ratingsData]);

  const orders = useMemo(() => {
    const list = data?.data?.orders || data?.orders || (Array.isArray(data) ? data : []);
    return list
      .filter((o: any) => (o.deliveryType || "delivery").toLowerCase() !== "pickup")
      .map((o: any) => ({
        id: o._id || o.id,
        orderNumber: o.orderNumber || o.id || o._id || "Order",
        status: (o.orderStatus || o.status || "pending").toLowerCase(),
        date: o.orderDate || o.createdAt || o.created_at || null,
        total: Number(o.totalAmount ?? o.total ?? 0),
        paymentMethod: o.paymentMethod || o.payment_method || "",
        items: (o.items || []).map((i: any) => ({
          id: i.productId || i.product_id,
          name: i.productName || i.name || "Product",
          quantity: Number(i.quantity) || 1,
          price: Number(i.unitPrice ?? i.price ?? 0),
          image: i.productImage || i.image,
        })),
      }))
      .sort((a: any, b: any) => {
        const aTime = a.date ? new Date(a.date).getTime() : 0;
        const bTime = b.date ? new Date(b.date).getTime() : 0;
        return sort === "oldest" ? aTime - bTime : aTime - bTime ? bTime - aTime : 0;
      });
  }, [data, sort]);

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order: any) =>
      String(order.orderNumber).toLowerCase().includes(term) ||
      order.items.some((item: any) => item.name.toLowerCase().includes(term))
    );
  }, [orders, search]);

  const counts = useMemo(() => ({
    all: orders.length,
    active: orders.filter((o: any) => activeStatuses.includes(o.status)).length,
    delivered: orders.filter((o: any) => o.status === "delivered").length,
    cancelled: orders.filter((o: any) => ["cancelled", "refunded"].includes(o.status)).length,
  }), [orders]);

  const handleBuyAgain = (order: any) => {
    const reorderable = order.items.filter((i: any) => i.id);
    if (!reorderable.length) {
      toast.error("This order has no items to reorder");
      return;
    }
    reorderable.forEach((item: any) => addItem({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      image: item.image || "/images/placeholder-product.jpg",
      originalPrice: item.price,
    }));
    toast.success(`${reorderable.length} item${reorderable.length > 1 ? "s" : ""} added to your cart`);
    router.push("/cart");
  };

  const formatDate = (value: any) => value
    ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Date unavailable";

  if (isLoading) {
    return <div className="flex min-h-[45vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><ShoppingBag className="h-9 w-9" /></div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">My Orders</h1>
            <p className="text-sm text-slate-600">Track deliveries, review past purchases, and reorder your favourites.</p>
          </div>
        </div>
        <Button asChild className="rounded-xl bg-green-700 hover:bg-green-800"><Link href="/nearby"><ShoppingBag className="mr-2 h-4 w-4" /> Shop Again</Link></Button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card className="border-emerald-200 bg-gradient-to-br from-white to-emerald-50 shadow-sm"><CardContent className="flex items-center gap-4 p-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Layers className="h-8 w-8" /></span>
          <div><p className="text-sm font-semibold text-slate-700">All Orders</p><p className="text-3xl font-extrabold text-slate-950">{counts.all}</p></div>
        </CardContent></Card>
        <Card className="border-blue-200 bg-gradient-to-br from-white to-blue-50 shadow-sm"><CardContent className="flex items-center gap-4 p-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-700"><Truck className="h-8 w-8" /></span>
          <div><p className="text-sm font-semibold text-slate-700">In Progress</p><p className="text-3xl font-extrabold text-slate-950">{counts.active}</p></div>
        </CardContent></Card>
        <Card className="border-green-200 bg-gradient-to-br from-white to-green-50 shadow-sm"><CardContent className="flex items-center gap-4 p-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-700"><CheckCircle2 className="h-8 w-8" /></span>
          <div><p className="text-sm font-semibold text-slate-700">Delivered</p><p className="text-3xl font-extrabold text-slate-950">{counts.delivered}</p></div>
        </CardContent></Card>
        <Card className="border-rose-200 bg-gradient-to-br from-white to-rose-50 shadow-sm"><CardContent className="flex items-center gap-4 p-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-600"><XCircle className="h-8 w-8" /></span>
          <div><p className="text-sm font-semibold text-slate-700">Cancelled</p><p className="text-3xl font-extrabold text-slate-950">{counts.cancelled}</p></div>
        </CardContent></Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-700" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order number or product..." className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
        </div>
        <div className="relative sm:w-48">
          <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-9 text-sm font-semibold text-slate-800 shadow-sm outline-none focus:border-emerald-500">
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      {filteredOrders.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <Package className="h-10 w-10 text-slate-300" />
          <p className="font-semibold text-slate-800">{orders.length ? "No matching orders" : "No home delivery orders yet"}</p>
          <p className="text-sm text-slate-500">{orders.length ? "Try another order number or product name." : "Orders delivered to your doorstep will appear here."}</p>
          {orders.length === 0 && <Button asChild className="bg-green-700 hover:bg-green-800"><Link href="/nearby">Browse products</Link></Button>}
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order: any) => {
            const meta = statusMeta[order.status] || { label: order.status.replace(/_/g, " "), className: "border-slate-200 bg-slate-50 text-slate-700", step: 0 };
            const isDelivered = order.status === "delivered";
            const isCancelled = ["cancelled", "refunded"].includes(order.status);
            const canTrack = activeStatuses.includes(order.status);
            return (
              <Card key={order.id} className={`overflow-hidden rounded-2xl border shadow-sm transition-shadow hover:shadow-md ${isCancelled ? "border-l-4 border-l-rose-500" : "border-l-4 border-l-green-600"}`}>
                <CardContent className="p-4 md:p-5">
                  <div className="grid gap-5 xl:grid-cols-[minmax(340px,1.05fr)_minmax(300px,0.95fr)_minmax(390px,1.35fr)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link href={`/orders/${order.id}`} className="truncate text-lg font-extrabold text-slate-950 hover:text-emerald-700">Order #{order.orderNumber}</Link>
                        <button type="button" aria-label="Copy order number" onClick={() => { void navigator.clipboard?.writeText(String(order.orderNumber)); toast.success("Order number copied"); }} className="shrink-0 text-green-700 hover:text-green-900"><Copy className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                        <div className="flex gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-green-800" /><div><p className="text-xs text-slate-500">Ordered on</p><p className="font-semibold text-slate-800">{formatDate(order.date)}</p></div></div>
                        <div className="flex gap-2"><ShoppingBag className="mt-0.5 h-4 w-4 shrink-0 text-green-800" /><div><p className="text-xs text-slate-500">Items</p><p className="font-semibold text-slate-800">{order.items.length} items</p></div></div>
                        <div className="flex gap-2"><Wallet className="mt-0.5 h-4 w-4 shrink-0 text-green-800" /><div><p className="text-xs text-slate-500">Total Amount</p><p className="font-extrabold text-slate-950">{formatPrice(order.total)}</p></div></div>
                      </div>
                      <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-slate-800"><CreditCard className="h-4 w-4 text-emerald-800" /> Payment: {paymentLabel(order.paymentMethod)}</div>
                    </div>

                    <div className="flex min-w-0 flex-wrap content-start gap-3 border-y border-slate-100 py-3 xl:border-x xl:border-y-0 xl:px-4 xl:py-2">
                      {order.items.slice(0, 4).map((item: any, index: number) => (
                        <div key={item.id || `${item.name}-${index}`} className="w-[calc(50%-0.5rem)] max-w-[118px]">
                          <div className="flex h-[76px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1">
                            {item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-contain" /> : <Package className="h-8 w-8 text-slate-300" />}
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs font-bold text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-600">{item.quantity} {item.quantity === 1 ? "pc" : "items"}</p>
                        </div>
                      ))}
                      {order.items.length > 4 && <p className="self-center text-xs font-semibold text-slate-500">+{order.items.length - 4} more</p>}
                    </div>

                    <div className="flex min-w-0 flex-col justify-center gap-3">
                      <div><Badge variant="outline" className={`rounded-full px-4 py-1.5 text-sm font-bold ${meta.className}`}>{isDelivered ? <CheckCircle2 className="mr-2 h-4 w-4" /> : isCancelled ? <XCircle className="mr-2 h-4 w-4" /> : <Truck className="mr-2 h-4 w-4" />}{meta.label}</Badge></div>
                      {isDelivered ? (
                        <div className="rounded-xl bg-green-50 px-4 py-3"><p className="font-bold text-slate-900">Your order has been delivered</p><p className="text-sm text-slate-600">Thank you for shopping with local farmers.</p></div>
                      ) : isCancelled ? (
                        <div className="rounded-xl bg-rose-50 px-4 py-3"><p className="font-bold text-rose-800">Order {order.status === "refunded" ? "refunded" : "cancelled"}</p><p className="text-sm text-slate-700">This order is no longer in progress.</p></div>
                      ) : (
                        <div className="px-1 pt-1">
                          <div className="flex items-center">
                            {progressSteps.map((step, index) => {
                              const complete = index <= Math.max(0, meta.step);
                              return <div key={step} className="flex min-w-0 flex-1 items-center last:flex-none">
                                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${complete ? "border-green-700 bg-green-700 text-white" : "border-slate-300 bg-white"}`}>{complete && <CheckCircle2 className="h-3 w-3" />}</span>
                                {index < progressSteps.length - 1 && <span className={`h-1 min-w-2 flex-1 ${index < meta.step ? "bg-green-700" : "bg-slate-200"}`} />}
                              </div>;
                            })}
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] font-medium text-slate-600"><span>Confirmed</span><span>Preparing</span><span>Dispatched</span><span>In Transit</span><span>Delivered</span></div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {canTrack && <Button asChild className="flex-1 rounded-xl bg-green-700 hover:bg-green-800"><Link href={`/orders/${order.id}`}><MapPin className="mr-2 h-4 w-4" /> Track Order</Link></Button>}
                        <Button asChild variant="outline" className="flex-1 rounded-xl border-slate-300"><Link href={`/orders/${order.id}`}><FileText className="mr-2 h-4 w-4" /> Order Details</Link></Button>
                        {(isDelivered || isCancelled) && <Button onClick={() => handleBuyAgain(order)} variant="outline" className="rounded-xl border-green-300 text-green-800 hover:bg-green-50"><RefreshCw className="mr-2 h-4 w-4" /> Buy Again</Button>}
                        {isDelivered && (ratedOrderIds.has(String(order.id)) ? <Badge variant="success" className="gap-1 self-center"><CheckCircle2 className="h-3 w-3" /> Rated</Badge> : <Button asChild variant="outline" className="rounded-xl"><Link href={`/orders/${order.id}#rate-delivery`}><Star className="mr-2 h-4 w-4" /> Rate Delivery</Link></Button>)}
                        {isDelivered && !refundedOrderIds.has(String(order.id)) && <Button asChild variant="outline" className="rounded-xl"><Link href={`/orders/${order.id}`}>Report a Problem</Link></Button>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
