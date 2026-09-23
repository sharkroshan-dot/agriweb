"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Package, Heart, Truck, ArrowUpRight, ShoppingCart, TrendingUp, MapPin, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, Loader2, MessageCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { formatPrice } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { LiveChatDialog } from "../../../components/delivery/live-chat-dialog";
import { AICopilotCard } from "../../../components/shared/ai-copilot-card";
import { useWishlist } from "../../../lib/hooks/use-wishlist";
import { useSession } from "next-auth/react";

const statusColors: Record<string, string> = {
  pending: "border-yellow-200 bg-yellow-50 text-yellow-700",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  reserved: "border-purple-200 bg-purple-50 text-purple-700",
  processing: "border-purple-200 bg-purple-50 text-purple-700",
  preparing: "border-purple-200 bg-purple-50 text-purple-700",
  shipped: "border-purple-200 bg-purple-50 text-purple-700",
  in_transit: "border-blue-200 bg-blue-50 text-blue-700",
  delivered: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

const orderStatusTabs = [
  { key: "all", label: "All Orders" },
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "preparing", label: "Preparing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

const PERIODS = [
  { key: "all", label: "All Time" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
];

function getDateRange(period: string) {
  const now = new Date();
  const start = new Date(now);
  if (period === "week") start.setDate(start.getDate() - 7);
  else if (period === "month") start.setMonth(start.getMonth() - 1);
  else if (period === "year") start.setFullYear(start.getFullYear() - 1);
  else return { fromDate: undefined, toDate: undefined };
  return { fromDate: start.toISOString(), toDate: now.toISOString() };
}

export default function CustomerDashboardPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [period, setPeriod] = useState("all");
  const [chatOrderId, setChatOrderId] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState<Record<string, number>>({});
  const { data: session } = useSession();
  const customerId = String((session?.user as any)?.id || "");

  const dateRange = getDateRange(period);
  const { data: ordersData, isLoading: ordersLoading, isError: ordersError, error: ordersErrorObj, refetch: refetchOrders } = useQuery({
    queryKey: ["customerOrders", period],
    queryFn: () => api.get("/orders", { params: { limit: 100, fromDate: dateRange.fromDate, toDate: dateRange.toDate } }),
  });

  const { data: reservationsData } = useQuery({
    queryKey: ["customerReservations"],
    queryFn: () => api.get("/inventory/customer/reservations"),
  });

  const { data: productsData } = useQuery({
    queryKey: ["customerProducts", "featured"],
    queryFn: () => api.get("/products/search", { params: { limit: 5, sortBy: "createdAt", sortOrder: "desc" } }),
  });

  const { data: alertsData } = useQuery({
    queryKey: ["customerAlerts"],
    queryFn: () => api.get("/customers/me/alerts"),
  });

  const { items: wishlistItems } = useWishlist();

  if (ordersData) {
    console.debug("[Dashboard] ordersData:", JSON.stringify(ordersData, null, 2).slice(0, 2000));
  }

  const allOrders = useMemo(() => {
    const raw = ordersData?.data?.orders || ordersData?.orders || (Array.isArray(ordersData) ? ordersData : []);
    if (!raw.length) {
      console.debug("[Dashboard] No orders found in response. ordersData keys:", Object.keys(ordersData || {}));
    }
    return raw.map((o: any) => ({
      id: o._id || o.id || o.orderNumber || `order-${Math.random().toString(36).slice(2, 8)}`,
      total: o.totalAmount || 0,
      status: (o.status || o.orderStatus || "pending").toLowerCase(),
      date: o.orderDate ? new Date(o.orderDate).toLocaleDateString() : o.createdAt ? new Date(o.createdAt).toLocaleDateString() : "Recently",
      items: o.items?.length || 0,
    }));
  }, [ordersData]);

  const reservations = useMemo(() => {
    const raw = reservationsData?.data || reservationsData || (Array.isArray(reservationsData) ? reservationsData : []);
    return (Array.isArray(raw) ? raw : []).map((r: any) => ({
      id: r.reservation_id || r.id || r._id,
      productName: r.product_name || r.productName || r.name || "Product",
      quantity: r.quantity || 0,
      status: r.status || "active",
      expiresAt: r.expires_at || r.expiresAt,
    }));
  }, [reservationsData]);

  const filteredOrders = useMemo(() => {
    if (statusFilter === "all") return allOrders;
    if (statusFilter === "preparing") return allOrders.filter((o: any) => o.status === "preparing" || o.status === "processing");
    if (statusFilter === "shipped") return allOrders.filter((o: any) => o.status === "shipped" || o.status === "in_transit");
    return allOrders.filter((o: any) => o.status === statusFilter);
  }, [allOrders, statusFilter]);

  useEffect(() => {
    if (!customerId || allOrders.length === 0) return;
    let cancelled = false;
    const refreshUnread = async () => {
      const entries = await Promise.all(allOrders.map(async (order: any) => {
        const orderId = String(order.id || "");
        if (!orderId) return null;
        try {
          const response: any = await api.get(`/chat/conversations/delivery-chat-${orderId}/messages`);
          const incoming = (response?.data || []).filter((message: any) => message.sender_id !== customerId).length;
          const read = Number(window.localStorage.getItem(`agri-chat-read-delivery-chat-${orderId}`) || 0);
          const liveUnread = Number(window.localStorage.getItem(`agri-chat-unread-${orderId}`) || 0);
          return [orderId, Math.max(0, incoming - read, liveUnread)] as const;
        } catch {
          return [orderId, 0] as const;
        }
      }));
      if (!cancelled) setChatUnread(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, number]>));
    };
    void refreshUnread();
    const intervalId = window.setInterval(refreshUnread, 4000);
    const onRead = () => void refreshUnread();
    const onUnread = () => void refreshUnread();
    window.addEventListener("agri-chat-read", onRead);
    window.addEventListener("agri-chat-unread", onUnread);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("agri-chat-read", onRead);
      window.removeEventListener("agri-chat-unread", onUnread);
    };
  }, [allOrders, customerId]);

  const recommendedProducts = useMemo(() => {
    const products = productsData?.data?.products || [];
    return products.slice(0, 3).map((p: any) => ({
      id: p._id || p.id,
      name: p.name || "Fresh Produce",
      farmer: p.farmerName || "Local Farmer",
      price: p.price,
      unit: p.unit || "kg",
      rating: p.ratings?.average || 4.5,
      image: p.images?.[0] || "/images/placeholder-product.jpg",
    }));
  }, [productsData]);

  const activeOrders = allOrders.filter((o: any) => o.status !== "delivered" && o.status !== "cancelled").length;
  const deliveredOrders = allOrders.filter((o: any) => o.status === "delivered").length;
  const totalSpent = allOrders.reduce((sum: number, o: any) => sum + o.total, 0);
  const activeReservations = reservations.filter((r: any) => r.status === "active").length;
  const activeAlerts = Array.isArray(alertsData?.data) ? alertsData.data.length : 0;

  if (ordersLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (ordersError) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <div>
            <h2 className="text-lg font-semibold text-red-800">Failed to load orders</h2>
            <p className="mt-1 text-sm text-red-600">{(ordersErrorObj as any)?.message || "Unknown error"}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchOrders()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Welcome back! Here is your overview.</p>
        </div>
        <Button asChild>
          <Link href="/nearby">
            <ShoppingCart className="mr-2 h-4 w-4" /> Browse Products
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Link href="/wishlist">
          <Card className="transition hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Wishlist</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{wishlistItems.length}</p>
                </div>
                <div className="rounded-full bg-red-50 p-2">
                  <Heart className="h-5 w-5 text-red-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/alerts">
          <Card className="transition hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Alerts</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{activeAlerts}</p>
                </div>
                <div className="rounded-full bg-amber-50 p-2">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Active Orders</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{activeOrders}</p>
              </div>
              <div className="rounded-full bg-emerald-50 p-2">
                <Package className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Reserved Items</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{activeReservations}</p>
              </div>
              <div className="rounded-full bg-purple-50 p-2">
                <Clock className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Delivered</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{deliveredOrders}</p>
              </div>
              <div className="rounded-full bg-blue-50 p-2">
                <Truck className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Total Spent</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{formatPrice(totalSpent)}</p>
              </div>
              <div className="rounded-full bg-purple-50 p-2">
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="selection-control flex items-center gap-1 border shadow-sm">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${
              period === p.key
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-b pb-2">
        {orderStatusTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.key
                ? "bg-emerald-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AICopilotCard ctaHref="/customer/ai" ctaLabel="Open AI Copilot" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>Your latest purchases</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/orders">View All</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredOrders.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{statusFilter === "all" ? "No orders yet. Start browsing!" : `No orders with status "${statusFilter}".`}</p>
            ) : (
              filteredOrders.map((order: any) => (
                <div key={order.id} className="flex items-center justify-between rounded-lg border p-3 transition hover:bg-slate-50">
                  <Link href={`/orders/${order.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-slate-100 p-2">
                        <Package className="h-4 w-4 text-slate-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{order.id?.slice(-8) || order.id}</p>
                        <p className="text-xs text-muted-foreground">{order.date} &middot; {order.items} items</p>
                      </div>
                    </div>
                  </Link>
                  <div className="ml-3 flex items-center gap-2">
                    <span className="text-sm font-semibold">{formatPrice(order.total)}</span>
                    <Badge className={statusColors[order.status] || "border-gray-200 bg-gray-50 text-gray-700"}>{order.status.replace(/_/g, " ")}</Badge>
                    <Button className="relative" variant="ghost" size="icon" aria-label="Chat with delivery partner" onClick={() => setChatOrderId(order.id)}>
                      <MessageCircle className="h-4 w-4" />
                      {chatUnread[order.id] > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                          {chatUnread[order.id] > 9 ? "9+" : chatUnread[order.id]}
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {chatOrderId && (
          <LiveChatDialog orderId={chatOrderId} customerName="Delivery partner" onClose={() => setChatOrderId(null)} />
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Fresh Produce</CardTitle>
              <CardDescription>Recently listed products</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/nearby">Explore</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendedProducts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No products available yet.</p>
            ) : (
              recommendedProducts.map((product: any) => (
                <Link key={product.id} href={`/product/${product.id}`}>
                  <div className="flex items-center justify-between rounded-lg border p-3 transition hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 overflow-hidden rounded-md bg-slate-100">
                        <img src={product.image || "/images/placeholder-product.jpg"} alt={product.name} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg"; }} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.farmer}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-700">{formatPrice(product.price) ? `${formatPrice(product.price)}/${product.unit}` : "N/A"}</p>
                      <div className="flex items-center gap-1 text-xs text-yellow-600">
                        <span>★</span> {product.rating}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
