"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, ChevronRight, Store, ShoppingBag, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { formatPrice, formatDate } from "../../../lib/utils";
import { api } from "../../../lib/api/client";

const statusColors: Record<string, string> = {
  pending: "border-yellow-200 bg-yellow-50 text-yellow-700",
  confirmed: "border-blue-200 bg-blue-50 text-blue-700",
  processing: "border-purple-200 bg-purple-50 text-purple-700",
  ready_for_delivery: "border-indigo-200 bg-indigo-50 text-indigo-700",
  ready_for_pickup: "border-amber-200 bg-amber-50 text-amber-700",
  shipped: "border-purple-200 bg-purple-50 text-purple-700",
  in_transit: "border-blue-200 bg-blue-50 text-blue-700",
  delivered: "border-green-200 bg-green-50 text-green-700",
  picked_up: "border-teal-200 bg-teal-50 text-teal-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
};

export default function CustomerOrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: ordersData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["customerOrders", statusFilter],
    queryFn: () => api.get("/orders", { params: { status: statusFilter !== "all" ? statusFilter : undefined, limit: 50 } }),
  });

  if (ordersData) {
    console.debug("[OrdersPage] ordersData:", JSON.stringify(ordersData, null, 2).slice(0, 2000));
  }

  const orders = useMemo(() => {
    const raw = ordersData?.data?.orders || ordersData?.orders || (Array.isArray(ordersData) ? ordersData : []);
    return raw.map((o: any) => ({
      id: o._id || o.id || o.orderNumber || `order-${Math.random().toString(36).slice(2, 8)}`,
      items: (o.items || []).map((i: any) => i.productName || i.name || "Item").join(", ") || "Order items",
      total: o.totalAmount || 0,
      status: (o.status || o.orderStatus || "pending").toLowerCase(),
      date: o.orderDate || o.createdAt,
      estimatedDelivery: o.estimatedDeliveryDate || o.deliveryDate,
      deliveryType: o.deliveryType || "delivery",
      isBulkOrder: o.isBulkOrder || false,
    }));
  }, [ordersData]);

  const filtered = useMemo(() => {
    return orders.filter((o: any) => {
      const matchesSearch = o.id.toLowerCase().includes(search.toLowerCase()) || o.items.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || o.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [orders, search, statusFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <div>
            <h2 className="text-lg font-semibold text-red-800">Failed to load orders</h2>
            <p className="mt-1 text-sm text-red-600">{(error as any)?.message || "Unknown error"}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">My Orders</h1>
        <p className="text-sm text-muted-foreground">Track and manage your purchases</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="ready_for_delivery">Ready for Delivery</SelectItem>
            <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
            <SelectItem value="shipped">Shipped</SelectItem>
            <SelectItem value="in_transit">In Transit</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="picked_up">Picked Up</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No orders found</p>
            <p className="text-sm text-muted-foreground">Start shopping to see your orders here.</p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((order: any) => (
            <Link key={order.id} href={`/orders/${order.id}`}>
              <Card className="cursor-pointer transition hover:shadow-md">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{order.id?.slice(-8) || order.id}</span>
                      <Badge className={statusColors[order.status]}>
                        {order.status.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </Badge>
                      {order.deliveryType === "pickup" && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs">
                          <Store className="mr-1 h-3 w-3" /> Pickup
                        </Badge>
                      )}
                      {order.isBulkOrder && (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700 text-xs">
                          <ShoppingBag className="mr-1 h-3 w-3" /> Bulk
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{order.items}</p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{formatDate(order.date)}</span>
                      <span>{formatPrice(order.total)}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
