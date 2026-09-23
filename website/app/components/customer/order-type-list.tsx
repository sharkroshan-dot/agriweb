"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, RefreshCw, Loader2, Star, CheckCircle, Store, Truck } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
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

const TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "delivered", label: "Completed" },
];

export function OrderTypeList({ type }: { type: "pickup" | "delivery" }) {
  const isPickup = type === "pickup";
  const router = useRouter();
  const addItem = useCartStore((s: any) => s.addItem);
  const [tab, setTab] = useState("all");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["customerOrders", isPickup ? "pickup" : "delivery"],
    queryFn: () => api.get("/orders", { params: { limit: 100 } }),
  });

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

  const typeOrders = useMemo(
    () => orders.filter((o: any) => (o.deliveryType === "pickup") === isPickup),
    [orders, isPickup]
  );

  const filtered = useMemo(() => {
    if (tab === "active") return typeOrders.filter((o: any) => !["delivered", "cancelled", "picked_up", "refunded"].includes(o.status));
    if (tab === "delivered") return typeOrders.filter((o: any) => o.status === "delivered" || o.status === "picked_up");
    return typeOrders;
  }, [typeOrders, tab]);

  const { data: ratingsData } = useQuery({
    queryKey: ["customerDeliveryRatings", isPickup ? "pickup" : "delivery"],
    queryFn: () => api.get("/delivery-ratings/me", { params: { limit: 100 } }),
  });

  const ratedOrderIds = useMemo(() => {
    const ratings = ratingsData?.data?.ratings || (Array.isArray(ratingsData) ? ratingsData : []);
    return new Set(ratings.map((r: any) => String(r.orderId)));
  }, [ratingsData]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/orders">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {isPickup ? (
              <>
                <Store className="h-6 w-6 text-amber-600" /> Farm Pickup
              </>
            ) : (
              <>
                <Truck className="h-6 w-6 text-emerald-600" /> Deliveries
              </>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isPickup
              ? "Orders you collect directly from the farm"
              : "Orders delivered to your doorstep"}
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-1 rounded-lg border bg-white p-1 shadow-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition-all ${
              tab === t.key
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="mr-2 whitespace-nowrap text-xs font-medium text-muted-foreground">
          {typeOrders.length} {isPickup ? "pickups" : "deliveries"}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            {isPickup ? (
              <Store className="h-10 w-10 text-muted-foreground" />
            ) : (
              <Truck className="h-10 w-10 text-muted-foreground" />
            )}
            <p className="font-medium">{isPickup ? "No farm pickup orders" : "No deliveries yet"}</p>
            <p className="text-sm text-muted-foreground">
              {isPickup
                ? "Orders you choose to collect from the farm will appear here."
                : `When you place a delivery order it will show up here.`}
            </p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((order: any) => (
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
                        order.deliveryType === "pickup"
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-emerald-200 bg-emerald-50 text-emerald-700"
                      }
                    >
                      {order.deliveryType === "pickup" ? (
                        <Store className="mr-1 h-3 w-3" />
                      ) : (
                        <Truck className="mr-1 h-3 w-3" />
                      )}
                      {order.deliveryType === "pickup" ? "Pickup" : "Delivery"}
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
                      <Button size="sm" onClick={() => handleBuyAgain(order)}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Buy Again
                      </Button>
                    )}
                    {order.status === "delivered" &&
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
      )}
    </div>
  );
}