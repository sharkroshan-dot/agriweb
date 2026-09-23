"use client";

import { useState, useMemo } from "react";
import { Eye, Search, RefreshCw, Loader2, Package } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { formatPrice, formatDate } from "../../../lib/utils";
import Link from "next/link";
import { api } from "../../../lib/api/client";

const backendOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1").origin;
  } catch {
    return "http://localhost:8000";
  }
})();

const badgeVariant: Record<string, "success" | "warning" | "outline" | "destructive"> = {
  delivered: "success",
  dispatched: "success",
  packed: "warning",
  processing: "warning",
  pending: "outline",
  cancelled: "destructive",
  refunded: "destructive",
};

const paymentBadge = (method?: string): { label: string; cod: boolean } => {
  const m = (method || "").toLowerCase();
  const cod = m === "cash" || m === "cod" || m === "cash_on_delivery";
  return { label: cod ? "COD" : m ? "Online" : "", cod };
};

export default function AdminOrdersPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  const { data: ordersData, isLoading, refetch } = useQuery({
    queryKey: ["adminOrders", statusFilter],
    queryFn: () =>
      api.get("/admin/orders", {
        params: { status: statusFilter !== "all" ? statusFilter : undefined, limit: 50 },
      }),
  });

  const orders = useMemo(() => {
    const list = ordersData?.data?.orders || ordersData?.orders || [];
    return list.map((o: any) => ({
      id: o.id || o._id,
      orderNumber: o.orderNumber || o.id || o._id,
      customer: o.customer?.name || o.customerName || o.customer || "Unknown",
      amount: o.totalAmount || 0,
      status: (o.status || o.orderStatus || "pending").toLowerCase(),
      items: o.items?.length || 0,
      date: o.orderDate || o.createdAt,
      paymentMethod: o.paymentMethod || "",
      deliveryType: o.deliveryType || "delivery",
      pod: o.pod || null,
    }));
  }, [ordersData]);

  const filtered = useMemo(() => {
    return orders.filter((order: any) => {
      const matchesQuery = [order.orderNumber, order.customer, String(order.amount)].some((value) =>
        value.toLowerCase().includes(query.toLowerCase())
      );
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [orders, query, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Orders</h1>
          <p className="text-sm text-muted-foreground">Review and manage the latest platform orders.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
          <Button asChild><Link href="/admin/reports">Open reports</Link></Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search orders..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="dispatched">Dispatched</SelectItem>
            <SelectItem value="in_transit">In Transit</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
          <CardDescription>{isLoading ? "Loading..." : `${filtered.length} orders found`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Package className="h-12 w-12 text-slate-300" />
              <p className="text-lg font-medium text-slate-700">No orders found</p>
              <p className="text-sm text-slate-500">
                {query || statusFilter !== "all" ? "Try adjusting your search or filters" : "No orders have been placed yet."}
              </p>
            </div>
          ) : (
            filtered.map((order: any) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium">{order.orderNumber}</p>
                  <p className="text-sm text-muted-foreground">
                    {order.customer} &bull; {order.items} items &bull; {order.date ? formatDate(order.date) : "N/A"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={badgeVariant[order.status] || "outline"} className="capitalize">
                    {order.status.replace(/_/g, " ")}
                  </Badge>
                  {paymentBadge(order.paymentMethod).label && (
                    <Badge variant={paymentBadge(order.paymentMethod).cod ? "warning" : "outline"} className={paymentBadge(order.paymentMethod).cod ? "" : "border-blue-200 text-blue-700"}>
                      {paymentBadge(order.paymentMethod).label}
                    </Badge>
                  )}
                  <p className="font-semibold">{formatPrice(order.amount)}</p>
                  <Button variant="outline" size="sm" onClick={() => setSelectedOrder(order)}>
                    <Eye className="mr-2 h-4 w-4" />
                    Details
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedOrder?.orderNumber}</DialogTitle>
            <DialogDescription>{selectedOrder?.customer}</DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-2 text-sm">
              <p>Amount: {formatPrice(selectedOrder.amount)}</p>
              <p>Status: <Badge variant={badgeVariant[selectedOrder.status] || "outline"} className="capitalize">{selectedOrder.status.replace(/_/g, " ")}</Badge></p>
              <p>Items: {selectedOrder.items}</p>
              <p>Date: {selectedOrder.date ? formatDate(selectedOrder.date) : "N/A"}</p>
              <p className="flex items-center gap-2">
                Payment: {paymentBadge(selectedOrder.paymentMethod).label ? (
                  <Badge variant={paymentBadge(selectedOrder.paymentMethod).cod ? "warning" : "outline"}>{paymentBadge(selectedOrder.paymentMethod).label}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              {selectedOrder.deliveryType && <p>Delivery: {selectedOrder.deliveryType}</p>}
              {selectedOrder.pod?.photoUrl ? (
                <div className="mt-2 rounded-lg border p-3">
                  <p className="mb-2 font-medium">Proof of Delivery</p>
                  <img
                    src={`${backendOrigin}${selectedOrder.pod.photoUrl}`}
                    alt="Proof of delivery"
                    className="max-h-56 w-full rounded-md border object-cover"
                  />
                  {selectedOrder.pod.recipientName && (
                    <p className="mt-2">Recipient: {selectedOrder.pod.recipientName}</p>
                  )}
                  {selectedOrder.pod.completedAt && (
                    <p className="text-muted-foreground">
                      Delivered: {formatDate(selectedOrder.pod.completedAt)}
                    </p>
                  )}
                  {selectedOrder.pod.uploadedAt && (
                    <p className="text-muted-foreground">
                      POD uploaded: {formatDate(selectedOrder.pod.uploadedAt)}
                    </p>
                  )}
                </div>
              ) : (
                selectedOrder.status === "delivered" && (
                  <p className="text-muted-foreground">Proof of Delivery: not available</p>
                )
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

