"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  ArrowRight, Bell, CalendarDays, CheckCircle2, Clock3, CreditCard,
  Gift, Heart, Leaf, Loader2, MapPin, MessageCircle, Package,
  PackageCheck, Plus, RotateCcw, Search, ShoppingBasket, ShoppingCart,
  Tag, Truck, WalletCards
} from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { formatPrice } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { useWishlist } from "../../../lib/hooks/use-wishlist";
import { useCartStore } from "../../../lib/store/cart-store";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  confirmed: "bg-blue-50 text-blue-700 border-blue-200",
  reserved: "bg-violet-50 text-violet-700 border-violet-200",
  processing: "bg-violet-50 text-violet-700 border-violet-200",
  preparing: "bg-violet-50 text-violet-700 border-violet-200",
  shipped: "bg-sky-50 text-sky-700 border-sky-200",
  in_transit: "bg-sky-50 text-sky-700 border-sky-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-rose-50 text-rose-700 border-rose-200",
};

const money = (value: unknown) => formatPrice(Number(value || 0));
const pickArray = (value: any, ...paths: string[]) => {
  for (const path of paths) {
    const result = path.split(".").reduce((item, key) => item?.[key], value);
    if (Array.isArray(result)) return result;
  }
  return Array.isArray(value) ? value : [];
};

export default function CustomerDashboardPage() {
  const addItem = useCartStore((s: any) => s.addItem);
  const { data: session } = useSession();
  const customerId = String((session?.user as any)?.id || "");
  const userName = String((session?.user as any)?.name || "there").split(" ")[0];
  const { items: wishlistItems } = useWishlist();

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["customerOrders", "dashboard"],
    queryFn: () => api.get("/orders", { params: { limit: 100 } }),
  });
  const { data: reservationsData } = useQuery({
    queryKey: ["customerReservations"],
    queryFn: () => api.get("/inventory/customer/reservations"),
  });
  const { data: productsData } = useQuery({
    queryKey: ["customerProducts", "featured"],
    queryFn: () => api.get("/products/search", { params: { limit: 8, sortBy: "createdAt", sortOrder: "desc" } }),
  });
  const { data: walletData } = useQuery({
    queryKey: ["customerWalletDashboard"],
    queryFn: () => api.get("/payments/wallet/info"),
  });
  const { data: loyaltyData } = useQuery({
    queryKey: ["customerLoyaltyDashboard"],
    queryFn: () => api.get("/loyalty/me"),
  });

  const orders = useMemo(() => pickArray(ordersData, "data.orders", "orders").map((o: any) => ({
    ...o,
    id: String(o._id || o.id || o.orderNumber || ""),
    total: Number(o.totalAmount || o.total || 0),
    status: String(o.status || o.orderStatus || "pending").toLowerCase(),
    created: o.orderDate || o.createdAt || o.updatedAt,
    itemsCount: Array.isArray(o.items) ? o.items.length : Number(o.itemCount || 0),
  })), [ordersData]);

  const reservations = useMemo(() => pickArray(reservationsData, "data.reservations", "data").map((r: any) => ({
    ...r,
    status: String(r.status || "active").toLowerCase(),
    name: r.product_name || r.productName || r.name || "Farm Basket",
  })), [reservationsData]);

  const products = useMemo(() => pickArray(productsData, "data.products", "products").slice(0, 6), [productsData]);
  const activeOrders = orders.filter((o: any) => !["delivered", "cancelled", "refunded", "completed"].includes(o.status));
  const deliveredOrders = orders.filter((o: any) => ["delivered", "completed"].includes(o.status));
  const inTransitOrders = orders.filter((o: any) => ["shipped", "in_transit", "out_for_delivery"].includes(o.status));
  const returnedOrders = orders.filter((o: any) => ["returned", "refunded"].includes(o.status));
  const activeReservation = reservations.find((r: any) => ["active", "confirmed", "reserved"].includes(r.status));
  const walletBalance = Number(walletData?.data?.balance ?? walletData?.balance ?? 0);
  const loyaltyBalance = Number(loyaltyData?.data?.balance ?? loyaltyData?.balance ?? 0);
  const loyaltyValue = Number(loyaltyData?.data?.rewardValueRs ?? loyaltyData?.rewardValueRs ?? 0);
  const currentOrder = activeOrders.find((o: any) => ["in_transit", "out_for_delivery", "shipped", "dispatched", "preparing", "confirmed"].includes(o.status)) || activeOrders[0];
  const recentOrders = [...orders].sort((a: any, b: any) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime()).slice(0, 3);

  const steps = ["confirmed", "preparing", "dispatched", "in_transit", "delivered"];
  const stepLabels = ["Confirmed", "Preparing", "Dispatched", "In Transit", "Delivered"];
  const stepIndex = currentOrder ? Math.max(0, steps.indexOf(currentOrder.status === "shipped" ? "in_transit" : currentOrder.status)) : -1;
  const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" }).format(new Date());
  const handleAddToCart = (product: any) => {
    const id = product?._id || product?.id;
    if (!id) { toast.error("This product is not available to add right now"); return; }
    addItem({ id, name: product.name || product.productName || "Fresh Produce", price: Number(product.price || 0), quantity: 1, image: product.images?.[0] || product.image || "/images/placeholder-product.jpg", originalPrice: Number(product.price || 0) });
    toast.success("Added to your cart");
  };

  if (ordersLoading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="space-y-4 bg-slate-50/70 p-3 sm:p-5 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">Customer dashboard</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Good morning, <span className="text-emerald-700">{userName}</span> <span aria-hidden="true">👋</span></h1>
          <p className="mt-1 text-sm text-slate-600">Fresh, safe and local farm products delivered to your home.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm"><CalendarDays className="h-4 w-4 text-emerald-700" />{dateLabel}</div>
      </div>

      <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <section className="relative min-h-[190px] overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(105deg,#f3fce5_0%,#e7f8d9_48%,#c8edb5_100%)] p-6 shadow-sm sm:p-8">
            <div className="relative z-10 max-w-xl">
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Fresh daily · Farm to home</p>
              <h2 className="max-w-lg text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">Fresh from local farmers to your home</h2>
              <p className="mt-2 text-sm font-medium text-slate-600">Fresh Produce <span className="mx-2 text-emerald-500">|</span> Verified Farmers <span className="mx-2 text-emerald-500">|</span> Safe & Traceable</p>
              <Button asChild className="mt-4 rounded-full bg-emerald-700 px-6 hover:bg-emerald-800"><Link href="/nearby">Shop Now <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </div>
            <div className="pointer-events-none absolute -right-8 -bottom-16 h-64 w-[48%] rounded-tl-[100%] bg-gradient-to-tl from-emerald-300/60 via-lime-200/60 to-transparent" />
            <div className="pointer-events-none absolute right-5 top-1 hidden h-[190px] w-[42%] items-center justify-center sm:flex"><div className="absolute inset-x-0 bottom-0 h-16 rounded-t-[100%] bg-gradient-to-t from-lime-300/70 to-transparent" /><div className="relative rounded-[45%] bg-white/35 px-8 py-5 text-7xl drop-shadow-sm">🥬🥦🥕🍅🫑</div></div>
            <div className="pointer-events-none absolute bottom-0 right-0 h-10 w-full bg-gradient-to-t from-lime-200/50 to-transparent" />
          </section>

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {[
              { label: "Shop Products", href: "/nearby", icon: ShoppingBasket, tone: "bg-emerald-50 text-emerald-700" },
              { label: "My Orders", href: "/orders", icon: Package, tone: "bg-blue-50 text-blue-700" },
              { label: "Subscribe Farm Basket", href: "/subscriptions", icon: CalendarDays, tone: "bg-amber-50 text-amber-700" },
              { label: "Bulk & Event Orders", href: "/bulk-orders", icon: Gift, tone: "bg-violet-50 text-violet-700" },
              { label: "Track a Lot", href: "/trace", icon: Search, tone: "bg-teal-50 text-teal-700" },
            ].map((action) => (
              <Link key={action.label} href={action.href} className="flex min-h-[72px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${action.tone}`}><action.icon className="h-5 w-5" /></span>
                <span className="text-sm font-semibold leading-tight text-slate-800">{action.label}</span>
              </Link>
            ))}
          </section>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Leaf className="h-5 w-5 text-emerald-700" />My Orders Overview</h2><Button asChild variant="outline" size="sm" className="rounded-full"><Link href="/orders">View All Orders <ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Active Orders", value: activeOrders.length, icon: Package, cls: "bg-emerald-50 text-emerald-700" },
                  { label: "In Transit", value: inTransitOrders.length, icon: Truck, cls: "bg-amber-50 text-amber-700" },
                  { label: "Delivered", value: deliveredOrders.length, icon: CheckCircle2, cls: "bg-blue-50 text-blue-700" },
                  { label: "Returns", value: returnedOrders.length, icon: RotateCcw, cls: "bg-violet-50 text-violet-700" },
                ].map((metric) => <div key={metric.label} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3"><span className={`rounded-xl p-2 ${metric.cls}`}><metric.icon className="h-5 w-5" /></span><div><p className="text-xl font-bold text-slate-900">{metric.value}</p><p className="text-xs text-slate-600">{metric.label}</p></div></div>)}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 xl:grid-cols-2">
            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between gap-2"><div><h2 className="font-bold text-slate-900">Active Order</h2><p className="text-xs text-slate-500">{currentOrder ? currentOrder.orderNumber || currentOrder.id : "Your next order will appear here"}</p></div>{currentOrder && <Badge className={statusColors[currentOrder.status] || statusColors.pending}>{currentOrder.status.replace(/_/g, " ")}</Badge>}</div>
                {currentOrder ? <>
                  <div className="mb-4 flex items-center justify-between gap-1">
                    {stepLabels.map((label, index) => <div key={label} className="flex min-w-0 flex-1 flex-col items-center text-center"><span className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full border-2 ${index <= stepIndex ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-400"}`}>{index < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-[10px] font-bold">{index + 1}</span>}</span><span className="text-[10px] leading-tight text-slate-500 sm:text-xs">{label}</span></div>)}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600"><span className="flex items-center gap-1"><Clock3 className="h-4 w-4 text-emerald-700" />{currentOrder.created ? new Date(currentOrder.created).toLocaleDateString() : "Date not available"}</span><span className="flex items-center gap-1"><MapPin className="h-4 w-4 text-emerald-700" />{currentOrder.shippingAddress?.city || currentOrder.deliveryAddress?.city || "Delivery address on order"}</span><Button asChild size="sm" variant="outline" className="rounded-full"><Link href={`/orders/${currentOrder.id}`}>Track Order <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button></div>
                </> : <div className="rounded-xl bg-slate-50 p-5 text-center"><PackageCheck className="mx-auto mb-2 h-8 w-8 text-slate-300" /><p className="text-sm text-slate-600">No active orders right now.</p><Link href="/nearby" className="mt-2 inline-flex text-sm font-semibold text-emerald-700">Explore fresh products <ArrowRight className="ml-1 h-4 w-4" /></Link></div>}
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-sm">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between"><div><h2 className="font-bold text-slate-900">My Farm Basket Subscription</h2><p className="text-xs text-slate-500">Fresh produce on a regular schedule</p></div><Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">{activeReservation ? "Active" : "Explore"}</Badge></div>
                {activeReservation ? <div className="flex items-center gap-3 rounded-xl bg-emerald-50/70 p-3"><div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-3xl">🥗</div><div className="min-w-0 flex-1"><p className="font-semibold text-slate-900">{activeReservation.name}</p><p className="text-xs text-slate-600">{activeReservation.quantity ? `Quantity: ${activeReservation.quantity}` : "Your recurring farm selection"}</p>{activeReservation.expiresAt && <p className="mt-1 text-xs text-slate-600">Next date: {new Date(activeReservation.expiresAt).toLocaleDateString()}</p>}</div></div> : <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Choose a recurring basket of seasonal farm produce.</div>}
                <div className="mt-3 flex justify-end"><Button asChild variant="outline" size="sm" className="rounded-full"><Link href="/subscriptions">{activeReservation ? "Manage Subscription" : "Explore Subscriptions"} <ArrowRight className="ml-1 h-4 w-4" /></Link></Button></div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Leaf className="h-5 w-5 text-emerald-700" />Recommended for You</h2><Button asChild variant="ghost" size="sm" className="text-emerald-700"><Link href="/nearby">View More <ArrowRight className="ml-1 h-4 w-4" /></Link></Button></div>
              {products.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{products.map((product: any) => {
                const id = product._id || product.id;
                const name = product.name || product.productName || "Fresh Produce";
                const image = product.images?.[0] || product.image || "/images/placeholder-product.jpg";
                return <div key={id} className="group overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:shadow-md"><Link href={`/product/${id}`}><div className="aspect-square overflow-hidden bg-emerald-50"><img src={image} alt={name} className="h-full w-full object-cover transition group-hover:scale-105" onError={(e) => { (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg"; }} /></div><div className="p-2.5"><p className="line-clamp-1 text-sm font-semibold text-slate-900">{name}</p><p className="mt-1 text-xs text-slate-500">{product.farmerName || product.farmer?.name || "Local Farmer"}</p><p className="mt-1 font-bold text-emerald-700">{money(product.price)}<span className="font-normal text-slate-500">/{product.unit || "kg"}</span></p></div></Link><div className="px-2.5 pb-2.5"><Button size="sm" className="w-full rounded-full bg-emerald-700 hover:bg-emerald-800" onClick={() => handleAddToCart(product)}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button></div></div>;
              })}</div> : <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Fresh products will appear here when available.</div>}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-3">
          <Card className="border-slate-200 bg-gradient-to-br from-emerald-50 to-white shadow-sm"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-xl bg-white p-3 text-emerald-700 shadow-sm"><WalletCards className="h-6 w-6" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-700">My Wallet</p><p className="text-2xl font-extrabold text-slate-900">{money(walletBalance)}</p></div><Button asChild size="sm" variant="outline" className="rounded-full"><Link href="/wallet">Top Up</Link></Button></CardContent></Card>

          <Card className="border-emerald-100 bg-gradient-to-br from-lime-50 to-white shadow-sm"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-xl bg-white p-3 text-emerald-700 shadow-sm"><Leaf className="h-6 w-6" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-700">AgriPoints</p><p className="text-2xl font-extrabold text-slate-900">{loyaltyBalance.toLocaleString("en-IN")} <span className="text-sm font-semibold">Points</span></p><p className="text-xs text-emerald-700">≈ {money(loyaltyValue)} reward value</p></div><Button asChild size="sm" variant="outline" className="rounded-full"><Link href="/agripoints">Redeem Now <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button></CardContent></Card>

          <Card className="overflow-hidden border-emerald-100 bg-gradient-to-r from-lime-100 via-emerald-50 to-green-100 shadow-sm"><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Seasonal offers</p><h2 className="mt-1 text-lg font-extrabold text-emerald-950">Fresh deals from local farms</h2><p className="mt-1 text-xs text-emerald-800">Browse current coupons and savings.</p></div><Tag className="h-10 w-10 text-emerald-700" /></div><Button asChild size="sm" className="mt-3 rounded-full bg-emerald-700 hover:bg-emerald-800"><Link href="/coupons">View Offers <ArrowRight className="ml-1 h-4 w-4" /></Link></Button></CardContent></Card>

          <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><h2 className="mb-3 flex items-center gap-2 font-bold text-slate-900"><Gift className="h-5 w-5 text-emerald-700" />Quick Actions</h2><div className="grid grid-cols-2 gap-2">{[{label:"Schedule Delivery",href:"/delivery-slots",icon:CalendarDays},{label:"Saved Addresses",href:"/profile/addresses",icon:MapPin},{label:"My Offers",href:"/coupons",icon:Tag},{label:"Help & Support",href:"/support",icon:MessageCircle}].map((item) => <Link key={item.label} href={item.href} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-xs font-semibold text-slate-700 hover:border-emerald-200 hover:bg-emerald-50"><item.icon className="h-4 w-4 text-emerald-700" />{item.label}</Link>)}</div></CardContent></Card>

          <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold text-slate-900"><Clock3 className="h-5 w-5 text-emerald-700" />Recent Activity</h2><Button asChild size="sm" variant="ghost" className="text-emerald-700"><Link href="/orders">View All</Link></Button></div>{recentOrders.length ? <div className="space-y-3">{recentOrders.map((order: any) => <div key={order.id} className="flex items-start gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Package className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{order.status.replace(/_/g, " ").replace(/^./, (c: string) => c.toUpperCase())}</p><p className="truncate text-xs text-slate-500">{order.orderNumber || order.id}</p><p className="text-[11px] text-slate-400">{order.created ? new Date(order.created).toLocaleString() : "Date not available"}</p></div><Badge className={statusColors[order.status] || statusColors.pending}>{order.status.replace(/_/g, " ")}</Badge></div>)}</div> : <p className="py-4 text-center text-sm text-slate-500">Your recent orders and updates will appear here.</p>}</CardContent></Card>
        </aside>
      </div>
    </div>
  );
}
