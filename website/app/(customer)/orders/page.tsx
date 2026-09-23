"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Package,
  RefreshCw,
  Loader2,
  Star,
  CheckCircle,
  Store,
  Truck,
  Home,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { formatPrice } from "../../lib/utils";
import { api } from "../../lib/api/client";
import { useCartStore } from "../../lib/store/cart-store";
import toast from "react-hot-toast";

const statusColors: Record<string, string> = {
  pending: "border-yellow-200 bg-yellow-50 text-yellow-700",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  processing: "border-purple-200 bg-purple-50 text-purple-700",
  ready_for_delivery: "border-indigo-200 bg-indigo-50 text-indigo-700",
  ready_for_pickup: "border-indigo-200 bg-indigo-50 text-indigo-700",
  dispatched: "border-purple-200 bg-purple-50 text-purple-700",
  in_transit: "border-blue-200 bg-blue-50 text-blue-700",
  delivered: "border-green-200 bg-green-50 text-green-700",
  picked_up: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  refunded: "border-orange-200 bg-orange-50 text-orange-700",
};

export default function CustomerOrdersPage() {
  const router = useRouter();
  const addItem = useCartStore((s: any) => s.addItem);
  const [activeTab, setActiveTab] = useState<"pickup" | "delivery">("delivery");
  const [subTab, setSubTab] = useState<"all" | "active" | "delivered">("all");

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
    return list.map((o: any) => ({
      id: o._id || o.id,
      orderNumber: o.orderNumber || o.id || o._id || "Order",
      status: (o.orderStatus || o.status || "pending").toLowerCase(),
      deliveryType: (o.deliveryType || "delivery").toLowerCase(),
      date: o.orderDate
        ? new Date(o.orderDate).toLocaleDateString()
        : o.createdAt
          ? new Date(o.createdAt).toLocaleDateString()
          : "Recently",
      total: o.totalAmount || 0,
      paymentMethod: o.paymentMethod || (o.payment?.method) || "",
      items: (o.items || []).map((i: any) => ({
        id: i.productId || i.product_id,
        name: i.productName || "Product",
        quantity: Number(i.quantity) || 1,
        price: Number(i.unitPrice) || 0,
        image: i.productImage,
        pickupAvailable: i.pickupAvailable ?? false,
        farmAddress: i.farmAddress || "",
      })),
    }));
  }, [data]);

  const pickupOrders = useMemo(
    () => orders.filter((o: any) => o.deliveryType === "pickup"),
    [orders],
  );
  const deliveryOrders = useMemo(
    () => orders.filter((o: any) => o.deliveryType !== "pickup"),
    [orders],
  );

  const filterOrders = (list: any[]) => {
    if (subTab === "active") return list.filter((o: any) => !["delivered", "cancelled", "picked_up", "refunded"].includes(o.status));
    if (subTab === "delivered") return list.filter((o: any) => o.status === "delivered" || o.status === "picked_up");
    return list;
  };

  const SUB_TABS = [
    { key: "all" as const, label: "All" },
    { key: "active" as const, label: "Active" },
    { key: "delivered" as const, label: "Delivered" },
  ];

  const handleBuyAgain = (order: any) => {
    const reorderable = order.items.filter((i: any) => i.id);
    if (reorderable.length === 0) {
      toast.error("This order has no items to reorder");
      return;
    }
    reorderable.forEach((item: any) => {
      addItem({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        image: item.image || "/images/placeholder-product.jpg",
        originalPrice: item.price,
        pickupAvailable: item.pickupAvailable ?? false,
        farmAddress: item.farmAddress || "",
      });
    });
    toast.success(
      `${reorderable.length} item${reorderable.length > 1 ? "s" : ""} added to your cart`
    );
    router.push("/cart");
  };

  const renderOrders = (sectionOrders: any[], isPickup: boolean) => {
    if (sectionOrders.length === 0) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            {isPickup ? (
              <Store className="h-10 w-10 text-muted-foreground" />
            ) : (
              <Truck className="h-10 w-10 text-muted-foreground" />
            )}
            <p className="font-medium">{isPickup ? "No farm pickup orders" : "No home delivery orders"}</p>
            <p className="text-sm text-muted-foreground">
              {isPickup
                ? "Orders you choose to collect from the farm will appear here."
                : "Orders delivered to your doorstep will appear here."}
            </p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {sectionOrders.map((order: any) => (
          <Card key={order.id}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/orders/${order.id}`}
                    className="font-medium text-slate-900 hover:text-emerald-700"
                  >
                    Order {String(order.orderNumber).slice(-8)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {order.date} · {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      isPickup
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }
                  >
                    {isPickup ? <Store className="mr-1 h-3 w-3" /> : <Truck className="mr-1 h-3 w-3" />}
                    {isPickup ? "Pickup" : "Delivery"}
                  </Badge>
                  <Badge className={statusColors[order.status] || "border-gray-200 bg-gray-50 text-gray-700"}>
                    {order.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="font-semibold text-emerald-700">{formatPrice(order.total)}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/orders/${order.id}`}>
                      <Package className="mr-1.5 h-3.5 w-3.5" /> Details
                    </Link>
                  </Button>
                  {(order.status === "delivered" || order.status === "picked_up") && (
                    <>
                      <Button size="sm" onClick={() => handleBuyAgain(order)}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Buy Again
                      </Button>
                      {!refundedOrderIds.has(String(order.id)) && (
                        <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" asChild>
                          <Link href={`/orders/${order.id}`}>Report a Problem</Link>
                        </Button>
                      )}
                    </>
                  )}
                  {!isPickup && order.status === "delivered" &&
                    (ratedOrderIds.has(String(order.id)) ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle className="h-3 w-3" /> Rated
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-50" asChild>
                        <Link href={`/orders/${order.id}#rate-delivery`}>
                          <Star className="mr-1.5 h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /> Rate Delivery Partner
                        </Link>
                      </Button>
                    ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-8 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">My Orders</h1>
          <p className="text-sm text-muted-foreground">Your purchase history</p>
        </div>
        <Button asChild>
          <Link href="/nearby">Shop Again</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : (
        <>
          {/* Tabs like the harvest sections */}
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            <button
              onClick={() => setActiveTab("delivery")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                activeTab === "delivery"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Home className="h-4 w-4" />
              Home Delivery
              {deliveryOrders.length > 0 && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  {deliveryOrders.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("pickup")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                activeTab === "pickup"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Store className="h-4 w-4" />
              Farm Pickup
              {pickupOrders.length > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  {pickupOrders.length}
                </span>
              )}
            </button>
          </div>

          {/* Farm Pickup section */}
          {activeTab === "pickup" && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                    <Store className="h-5 w-5 text-amber-600" />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Farm Pickup</h2>
                    <p className="text-sm text-slate-500">Orders you collect directly from the farm</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
                  <Link href="/pickups">View all</Link>
                </Button>
              </div>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {SUB_TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setSubTab(t.key)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                      subTab === t.key
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {renderOrders(filterOrders(pickupOrders), true)}
            </section>
          )}

          {/* Home Delivery section */}
          {activeTab === "delivery" && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
                    <Home className="h-5 w-5 text-emerald-600" />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Home Delivery</h2>
                    <p className="text-sm text-slate-500">Orders delivered to your doorstep</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
                  <Link href="/my-deliveries">View all</Link>
                </Button>
              </div>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {SUB_TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setSubTab(t.key)}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                      subTab === t.key
                        ? "bg-white text-emerald-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {renderOrders(filterOrders(deliveryOrders), false)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
