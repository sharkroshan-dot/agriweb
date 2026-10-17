"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, RefreshCw, Loader2, Star, CheckCircle, Truck } from "lucide-react";
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
  dispatched: "border-purple-200 bg-purple-50 text-purple-700",
  in_transit: "border-blue-200 bg-blue-50 text-blue-700",
  delivered: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  refunded: "border-orange-200 bg-orange-50 text-orange-700",
};

export default function CustomerOrdersPage() {
  const router = useRouter();
  const addItem = useCartStore((s: any) => s.addItem);

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
        date: o.orderDate ? new Date(o.orderDate).toLocaleDateString() : "Recently",
        total: o.totalAmount || 0,
        paymentMethod: o.paymentMethod || "",
        items: (o.items || []).map((i: any) => ({
          id: i.productId || i.product_id,
          name: i.productName || "Product",
          quantity: Number(i.quantity) || 1,
          price: Number(i.unitPrice) || 0,
          image: i.productImage,
        })),
      }));
  }, [data]);

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

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild><Link href="/customer/dashboard"><ArrowLeft className="h-4 w-4" /></Link></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">My Orders</h1>
          <p className="text-sm text-muted-foreground">Home delivery orders</p>
        </div>
        <Button asChild><Link href="/nearby">Shop Again</Link></Button>
      </div>

      {orders.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <Truck className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium">No home delivery orders</p>
          <p className="text-sm text-muted-foreground">Orders delivered to your doorstep will appear here.</p>
          <Button asChild><Link href="/nearby">Browse products</Link></Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {orders.map((order: any) => (
            <Card key={order.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/orders/${order.id}`} className="font-medium text-slate-900 hover:text-emerald-700">
                      Order {String(order.orderNumber).slice(-8)}
                    </Link>
                    <p className="text-xs text-muted-foreground">{order.date} · {order.items.length} item{order.items.length !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><Truck className="mr-1 h-3 w-3" /> Delivery</Badge>
                    <Badge className={statusColors[order.status] || "border-gray-200 bg-gray-50 text-gray-700"}>{order.status.replace(/_/g, " ")}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <span className="font-semibold text-emerald-700">{formatPrice(order.total)}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {["pending", "confirmed", "processing", "ready_for_delivery", "dispatched", "in_transit", "shipped", "out_for_delivery", "picked_up"].includes(order.status) && (
                      <Button size="sm" asChild>
                        <Link href={`/orders/${order.id}`}><Truck className="mr-1.5 h-3.5 w-3.5" /> Track Order</Link>
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild><Link href={`/orders/${order.id}`}><Package className="mr-1.5 h-3.5 w-3.5" /> Details</Link></Button>
                    {(order.status === "delivered" || order.status === "cancelled") && (
                      <Button size="sm" onClick={() => handleBuyAgain(order)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Buy Again</Button>
                    )}
                    {order.status === "delivered" && (
                      ratedOrderIds.has(String(order.id)) ? (
                        <Badge variant="success" className="gap-1"><CheckCircle className="h-3 w-3" /> Rated</Badge>
                      ) : (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/orders/${order.id}#rate-delivery`}><Star className="mr-1.5 h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /> Rate Delivery</Link>
                        </Button>
                      )
                    )}
                    {order.status === "delivered" && !refundedOrderIds.has(String(order.id)) && (
                      <Button size="sm" variant="outline" className="border-amber-300 text-amber-700 hover:bg-amber-50" asChild>
                        <Link href={`/orders/${order.id}`}>Report a Problem</Link>
                      </Button>
                    )}
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
