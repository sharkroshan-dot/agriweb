"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, Truck, Package, Eye, MoreVertical, RefreshCw, Store, ShoppingBag, Clock, UserCheck, Navigation, X, User, Star, Phone, Map as MapIcon, MapPin, Search } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../../components/ui/dialog";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { formatPrice, formatDate } from "../../../lib/utils";
import { Map } from "../../../components/shared/map";
import toast from "react-hot-toast";

const statusColors: Record<string,string> = {
  pending: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  confirmed: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  processing: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  ready_for_delivery: "bg-green-500/10 text-green-600 border-green-500/20",
  ready_for_pickup: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  dispatched: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  in_transit: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  delivered: "bg-green-500/10 text-green-600 border-green-500/20",
  picked_up: "bg-teal-500/10 text-teal-600 border-teal-500/20",
  cancelled: "bg-red-500/10 text-red-600 border-red-500/20",
  refunded: "bg-gray-500/10 text-gray-600 border-gray-500/20",
};

const statusLabels: Record<string,string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  processing: "Processing",
  ready_for_delivery: "Ready for Delivery",
  ready_for_pickup: "Ready for Pickup",
  dispatched: "Dispatched",
  in_transit: "In Transit",
  delivered: "Delivered",
  picked_up: "Picked Up",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

function DeliveryPriorityBadge({ priority, label }: { priority?: string; label?: string }) {
  const value = label || priority || "Normal";
  const normalized = String(priority || "").toLowerCase();
  return (
    <Badge variant={normalized === "urgent" || normalized === "high" ? "destructive" : normalized === "medium" ? "warning" : "secondary"}>
      {value}
    </Badge>
  );
}

const paymentBadge = (method?: string): { label: string; cod: boolean } => {
  const m = (method || "").toLowerCase();
  const cod = m === "cash" || m === "cod" || m === "cash_on_delivery";
  return { label: cod ? "COD" : m ? "Online" : "", cod };
};

function MapWithMarkers({ markers }: { markers: { id: string; lat: number; lng: number; title: string; info: string }[] }) {
  const router = useRouter();

  if (markers.length === 0) {
    return (
      <div className="flex h-[250px] w-full flex-col items-center justify-center rounded-lg border border-dashed text-center">
        <MapIcon className="h-8 w-8 text-gray-300" />
        <p className="mt-2 text-sm font-medium text-gray-500">No order locations to show</p>
      </div>
    );
  }

  return (
    <Map
      height="250px"
      zoom={markers.length === 1 ? 11 : 9}
      center={markers.length > 0 ? { lat: markers[0].lat, lng: markers[0].lng } : undefined}
      markers={markers.map((m, i) => ({
        ...m,
        color: "#059669",
        label: String(i + 1),
      }))}
      drawRoute={false}
      onMarkerClick={(m: any) => {
        if (m?.id) router.push(`/farmer/orders/${m.id}`);
      }}
      className="rounded-lg border"
    />
  );
}

export default function FarmerOrdersPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showBulkSummary, setShowBulkSummary] = useState(false);
  const [showDeliveryRoutes, setShowDeliveryRoutes] = useState(false);
  const [showMapView, setShowMapView] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ order: any; action: string } | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [geoVersion, setGeoVersion] = useState(0);
  const geocodingRef = useRef<Record<string, any>>({});

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ["farmerOrders"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 500 } }),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const availabilityQuery = useQuery({
    queryKey: ["farmerOrderAvailability"],
    queryFn: () => api.get("/orders/farmer/order-availability"),
  });

  const { data: bulkData, isLoading: bulkLoading } = useQuery({
    queryKey: ["farmerBulkSummary"],
    queryFn: () => api.get("/orders/farmer/bulk-summary"),
    enabled: showBulkSummary,
  });

  const { data: routesData, isLoading: routesLoading } = useQuery({
    queryKey: ["farmerDeliveryRoutes"],
    queryFn: () => api.get("/orders/farmer/delivery-routes"),
    enabled: showDeliveryRoutes,
  });

  const availablePartners: any[] = [];

  const handleUpdateStatus = async (orderId: string, status: string) => {
    try {
      await api.put(`/orders/${orderId}/status`, { status });
      toast.success(`Order ${statusLabels[status]}`);
      refetch();
    } catch (error: any) {
      let msg = "Failed to update order status";
      try { const j = JSON.parse(error.message); msg = j.detail || j.error?.message || j.message || msg; } catch {}
      toast.error(msg);
    }
  };

  const [bulkRunning, setBulkRunning] = useState(false);
  const [runAllConfirmOpen, setRunAllConfirmOpen] = useState(false);

  const handleRunAllEligible = async () => {
    try {
      setBulkRunning(true);
      const response = await api.post("/orders/farmer/bulk-run");
      const result = response?.data || response;
      const processed = Number(result?.processedOrders || 0);
      const blocked = Number(result?.blockedOrders || 0);
      toast.success(
        processed
          ? `${processed} order${processed === 1 ? "" : "s"} processed through all currently eligible farmer steps${blocked ? ` · ${blocked} waiting for a manual/warehouse step` : ""}`
          : "No orders can advance automatically. Check the waiting reasons on individual orders.",
      );
      await refetch();
      await availabilityQuery.refetch();
    } catch (error: any) {
      let msg = "Failed to run all eligible orders";
      try { const j = JSON.parse(error.message); msg = j.detail || j.error?.message || j.message || msg; } catch {}
      toast.error(msg);
    } finally {
      setBulkRunning(false);
    }
  };

  const handleBulkWorkflowAction = async (action: "confirm" | "process" | "farmer_fulfillment" | "warehouse_fulfillment" | "warehouse_ready_for_pickup") => {
    try {
      const response = await api.post("/orders/farmer/bulk-advance", { action });
      const result = response?.data || response;
      const processed = Number(result?.processedOrders || 0);
      const skipped = Number(result?.skippedOrders || 0);
      const labels: Record<string, string> = {
        confirm: "confirmed",
        process: "processing started",
        farmer_fulfillment: "set to Farmer Fulfillment",
        warehouse_fulfillment: "set to Warehouse Fulfillment",
        warehouse_ready_for_pickup: "marked Ready for Warehouse Pickup",
      };
      toast.success(
        processed
          ? processed + " order" + (processed === 1 ? "" : "s") + " " + labels[action] + (skipped ? " · " + skipped + " skipped" : "")
          : "No orders are ready for " + (labels[action] || action),
      );
      await refetch();
      await availabilityQuery.refetch();
    } catch (error: any) {
      let msg = "Bulk workflow action failed";
      try {
        const j = JSON.parse(error.message);
        msg = j.detail || j.error?.message || j.message || msg;
      } catch {}
      toast.error(msg);
    }
  };

  const updateFulfillmentStage = async (orderId: string, stage: "dispatched") => {
    try {
      await api.put(`/orders/${orderId}/fulfillment-stage`, undefined, { params: { stage } });
      toast.success("Order dispatched");
      await refetch();
      router.push(`/farmer/order-map?delivery=required&orderId=${encodeURIComponent(orderId)}`);
    } catch (error: any) {
      toast.error(error?.message || "Failed to dispatch order");
    }
  };

  const setFulfillmentRoute = async (orderId: string, fulfillmentMethod: "farmer" | "warehouse") => {
    try {
      await api.put("/orders/" + orderId + "/fulfillment-route", {
        fulfillmentMethod,
      });
      toast.success(
        fulfillmentMethod === "warehouse"
          ? "Warehouse fulfillment selected"
          : "Farmer fulfillment selected"
      );
      refetch();
    } catch (error: any) {
      let msg = "Failed to select fulfillment route";
      try {
        const j = JSON.parse(error.message);
        msg = j.detail || j.error?.message || j.message || msg;
      } catch {}
      toast.error(msg);
    }
  };

  const markWarehouseReadyForPickup = async (orderId: string) => {
    try {
      await api.put(`/orders/${orderId}/warehouse-ready-for-pickup`);
      toast.success("Warehouse collection request created");
      await refetch();
    } catch (error: any) {
      toast.error(error?.message || "Failed to create warehouse collection request");
    }
  };

  const getStatus = (order: any) => (order.status || order.orderStatus || "pending").toLowerCase();

  const orderList = useMemo(() => {
    const candidates = [
      orders?.orders,
      orders?.data?.orders,
      orders?.data,
      orders,
    ];
    const raw = candidates.find((value: any) => Array.isArray(value)) || [];

    const getOrderTime = (order: any) => {
      // Prefer the actual order creation time. updatedAt must not move an
      // old order above a newly created order just because its status changed.
      const dateValues = [order?.orderDate, order?.createdAt];
      for (const value of dateValues) {
        if (!value) continue;
        const parsed = new Date(value).getTime();
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }

      // Some legacy orders do not have a parseable date. Their order number
      // contains YYYYMMDD-HHMMSS (e.g. ORD-20261002-095038), so use it as a
      // deterministic recent-order fallback.
      const orderNumber = String(order?.orderNumber || "");
      const match = orderNumber.match(/(20\\d{6})[-_](\\d{6})/);
      if (match) {
        const parsed = new Date(
          Number(match[1].slice(0, 4)),
          Number(match[1].slice(4, 6)) - 1,
          Number(match[1].slice(6, 8)),
          Number(match[2].slice(0, 2)),
          Number(match[2].slice(2, 4)),
          Number(match[2].slice(4, 6)),
        ).getTime();
        if (Number.isFinite(parsed)) return parsed;
      }

      return 0;
    };

    return [...raw].sort((a: any, b: any) => {
      const timeDifference = getOrderTime(b) - getOrderTime(a);
      if (timeDifference !== 0) return timeDifference;

      // Final deterministic fallback when timestamps are identical/missing.
      return String(b?.orderNumber || b?.id || b?._id || "").localeCompare(
        String(a?.orderNumber || a?.id || a?._id || ""),
      );
    });
  }, [orders]);

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredOrderList = useMemo(() => orderList.filter((order: any) => {
    const status = getStatus(order);
    const matchesStatus = statusFilter === "all"
      || status === statusFilter
      || (statusFilter === "ready_for_pickup" && String(order.fulfillmentStage || "").toLowerCase() === "ready_for_pickup");
    if (!matchesStatus) return false;
    if (!normalizedSearch) return true;
    const searchableValues = [
      order.orderNumber,
      order.id,
      order._id,
      order.customerName,
      order.customer?.name,
      order.customerPhone,
      order.deliveryAddress?.city,
      ...(Array.isArray(order.items) ? order.items.flatMap((item: any) => [item.productName, item.name, item.productId]) : []),
    ];
    return searchableValues.some((value) => String(value || "").toLocaleLowerCase().includes(normalizedSearch));
  }), [orderList, statusFilter, normalizedSearch]);

  const orderStats = useMemo(() => {
    const count = (predicate: (order: any, status: string) => boolean) =>
      orderList.filter((order: any) => predicate(order, getStatus(order))).length;
    return {
      total: orderList.length,
      pending: count((_order, status) => status === "pending"),
      processing: count((_order, status) => status === "processing"),
      readyForPickup: count((order, status) => status === "ready_for_pickup" || String(order.fulfillmentStage || "").toLowerCase() === "ready_for_pickup"),
      inTransit: count((_order, status) => status === "dispatched" || status === "in_transit"),
      delivered: count((_order, status) => status === "delivered" || status === "picked_up"),
      confirmed: count((_order, status) => status === "confirmed"),
      cancelled: count((_order, status) => status === "cancelled"),
    };
  }, [orderList]);

  const packedFarmerOrders = useMemo(
    () => orderList.filter((order: any) => {
      const method = String(order?.fulfillmentMethod || "").toLowerCase();
      const stage = String(order?.fulfillmentStage || "").toLowerCase();
      return method === "farmer" && stage === "packed" && order?.packingComplete === true && String(order?.orderStatus || "").toLowerCase() === "processing";
    }),
    [orderList],
  );


  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Orders</h1>
            <p className="text-gray-500">Manage your orders</p>
          </div>
        </div>
        {[1,2,3,4].map(i => <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-200"/>)}
      </div>
    );
  }

  return (
    <div className="farmer-orders-page w-full min-w-0 space-y-5 pb-8">
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <ShoppingBag className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Farmer workspace</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Orders</h1>
            <p className="mt-1 text-sm text-slate-500">Manage customer orders, fulfillment and delivery from one place.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-9 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            {orderList.length} total orders
          </Badge>
          <Button variant="outline" className="h-9" onClick={() => { refetch(); availabilityQuery.refetch(); }} aria-label="Refresh orders">
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
          <Button asChild className="h-9 bg-emerald-700 hover:bg-emerald-800">
            <Link href="/farmer/order-map"><Navigation className="mr-2 h-4 w-4" />Order Map</Link>
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Total orders", value: orderStats.total, icon: ShoppingBag, tone: "bg-emerald-50 text-emerald-700" },
          { label: "Pending", value: orderStats.pending, icon: Clock, tone: "bg-amber-50 text-amber-700" },
          { label: "Processing", value: orderStats.processing, icon: Package, tone: "bg-blue-50 text-blue-700" },
          { label: "Ready for pickup", value: orderStats.readyForPickup, icon: Package, tone: "bg-green-50 text-green-700" },
          { label: "In transit", value: orderStats.inTransit, icon: Truck, tone: "bg-indigo-50 text-indigo-700" },
          { label: "Delivered", value: orderStats.delivered, icon: CheckCircle, tone: "bg-emerald-50 text-emerald-700" },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center justify-between gap-2 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{stat.value}</p>
              </div>
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", stat.tone)}>
                <stat.icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Order Workflow</h2>
              <p className="mt-1 text-xs text-slate-500">Run actions for every order eligible at that stage. Each order is validated independently.</p>
            </div>
            <Button
              size="sm"
              className="h-9 w-full bg-emerald-700 hover:bg-emerald-800 sm:w-auto"
              onClick={() => setRunAllConfirmOpen(true)}
              disabled={bulkRunning || orderList.length === 0}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {bulkRunning ? "Processing…" : "Run All Eligible"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" onClick={() => handleBulkWorkflowAction("confirm")}>
              <CheckCircle className="mr-2 h-4 w-4 shrink-0 text-emerald-700" />Confirm All
            </Button>
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" onClick={() => handleBulkWorkflowAction("process")}>
              <Package className="mr-2 h-4 w-4 shrink-0 text-blue-700" />Process All
            </Button>
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" onClick={() => handleBulkWorkflowAction("farmer_fulfillment")}>
              <UserCheck className="mr-2 h-4 w-4 shrink-0 text-emerald-700" />Farmer Fulfillment All
            </Button>
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" onClick={() => handleBulkWorkflowAction("warehouse_fulfillment")}>
              <Store className="mr-2 h-4 w-4 shrink-0 text-blue-700" />Warehouse Fulfillment All
            </Button>
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" onClick={() => handleBulkWorkflowAction("warehouse_ready_for_pickup")}>
              <Truck className="mr-2 h-4 w-4 shrink-0 text-amber-700" />Warehouse Ready for Pickup All
            </Button>
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" onClick={() => setShowBulkSummary((current) => !current)}>
              <ShoppingBag className="mr-2 h-4 w-4 shrink-0 text-slate-600" />Bulk Summary
            </Button>
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" asChild>
              <Link href="/farmer/packing"><Package className="mr-2 h-4 w-4 shrink-0" />Open Packing</Link>
            </Button>
            <Button size="sm" variant="outline" className="h-10 justify-start whitespace-normal text-left" asChild>
              <Link href="/farmer/order-map?delivery=required"><Navigation className="mr-2 h-4 w-4 shrink-0" />Open Farmer Order Map</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search order number, customer or product..."
                aria-label="Search orders"
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={showDeliveryRoutes ? "default" : "outline"}
                className="h-10"
                onClick={() => setShowDeliveryRoutes((current) => !current)}
              >
                <Navigation className="mr-2 h-4 w-4" />Delivery Routes
              </Button>
              <Button
                size="sm"
                variant={showMapView ? "default" : "outline"}
                className="h-10"
                onClick={() => setShowMapView((current) => !current)}
              >
                <MapIcon className="mr-2 h-4 w-4" />Split by Location
              </Button>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-stretch gap-2">
            {[
              { value: "all", label: "All orders", count: orderStats.total },
              { value: "pending", label: "Pending", count: orderStats.pending },
              { value: "confirmed", label: "Confirmed", count: orderStats.confirmed },
              { value: "processing", label: "Processing", count: orderStats.processing },
              { value: "ready_for_pickup", label: "Ready for pickup", count: orderStats.readyForPickup },
              { value: "dispatched", label: "Dispatched", count: orderList.filter((order: any) => getStatus(order) === "dispatched").length },
              { value: "in_transit", label: "In transit", count: orderStats.inTransit },
              { value: "delivered", label: "Delivered", count: orderStats.delivered },
              { value: "cancelled", label: "Cancelled", count: orderStats.cancelled },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusFilter(tab.value)}
                title={`${tab.label}: ${tab.count}`}
                className={cn(
                  "inline-flex h-10 min-w-[112px] flex-1 items-center justify-between gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors",
                  statusFilter === tab.value
                    ? "border-emerald-700 bg-emerald-700 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                )}
              >
                <span className="min-w-0 truncate">{tab.label}</span>
                <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums", statusFilter === tab.value ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{tab.count}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>Showing {filteredOrderList.length} of {orderList.length} orders</span>
            <span>Orders refresh automatically every 15 seconds</span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={runAllConfirmOpen} onOpenChange={setRunAllConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run all eligible orders?</DialogTitle>
            <DialogDescription>
              This processes every farmer order that can safely advance. Each order is checked independently; orders requiring a fulfillment choice, warehouse action or delivery decision will stop at that stage.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span>Total orders</span><strong>{orderList.length}</strong></div>
            <p className="text-xs text-muted-foreground">Farmer Fulfillment stops at Packed here. Open Farmer Order Map for distance calculation and delivery decisions.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRunAllConfirmOpen(false)} disabled={bulkRunning}>Cancel</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => { setRunAllConfirmOpen(false); handleRunAllEligible(); }} disabled={bulkRunning}>
              {bulkRunning ? "Processing..." : "Run All Eligible"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {showBulkSummary && (
        <Card>
          <CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Bulk Order Summary</h2>
                <p className="text-sm text-gray-500">
                  Pending orders grouped by product — process in bulk for higher profit
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowBulkSummary(false)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            {bulkLoading ? (
              <div className="h-32 animate-pulse rounded-lg bg-gray-100" />
            ) : bulkData?.data?.length === 0 || !bulkData?.data ? (
              <p className="text-sm text-gray-400">No pending orders to aggregate</p>
            ) : (
              <div className="space-y-3">
                {bulkData.data.map((item: any) => (
                  <div key={item.productId} className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-blue-900">{item.productName}</p>
                        <p className="text-sm text-blue-700">
                          {item.totalQuantity} units across {item.orderCount} orders
                        </p>
                        <p className="text-xs text-blue-600">
                          Avg price: {formatPrice(item.avgUnitPrice)}/unit · First order: {formatDate(item.earliestOrderDate)}
                        </p>
                      </div>
                      <Badge className="bg-blue-600 text-white">{item.orderCount} orders</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.orders.map((o: any) => (
                        <Badge key={o.orderId} variant="outline" className="border-blue-200 bg-white text-xs">
                          <Link href={`/farmer/orders/${o.orderId}`} className="text-blue-700 hover:underline">
                            {o.quantity}x {o.deliveryType === "pickup" ? "(Pickup)" : ""}
                          </Link>
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(() => {
        const groups: Record<string, any[]> = {};
        filteredOrderList.forEach((o: any) => {
          const city = (o.deliveryAddress?.city || "Unknown").toLowerCase();
          if (!groups[city]) groups[city] = [];
          groups[city].push(o);
        });
        const groupEntries = Object.entries(groups);
        const activeCity = selectedCity === null ? null : (selectedCity && groups[selectedCity] ? selectedCity : null);
        const knownPlaces: Record<string, { lat: number; lng: number }> = {
          krishnagiri: { lat: 12.5186, lng: 78.2147 },
          trichirapalli: { lat: 10.7905, lng: 78.7047 },
          trichy: { lat: 10.7905, lng: 78.7047 },
          tiruchirappalli: { lat: 10.7905, lng: 78.7047 },
          manachanallur: { lat: 10.9289, lng: 78.7085 },
          bangalore: { lat: 12.9716, lng: 77.5946 },
          hosur: { lat: 12.7409, lng: 77.8253 },
          dharmapuri: { lat: 12.1277, lng: 78.1579 },
        };
        function addrFallback(addr: any): { lat: number; lng: number } {
          const addrAll = [addr?.addressLine1, addr?.addressLine2, addr?.city, addr?.state, addr?.zipCode].filter(Boolean).join(" ").toLowerCase();
          for (const [name, coords] of Object.entries(knownPlaces)) {
            if (addrAll.includes(name)) return coords;
          }
          const city = (addr?.city || "").toLowerCase();
          return knownPlaces[city] || knownPlaces.krishnagiri;
        }
        const geoCache = geocodingRef.current;
        if (showMapView && geoCache._started === undefined) {
          geoCache._started = true;
          let delay = 0;
          filteredOrderList.forEach((o: any) => {
            if (o.deliveryAddress?.location?.coordinates) return;
            const addrText = [o.deliveryAddress?.addressLine1, o.deliveryAddress?.addressLine2, o.deliveryAddress?.city, o.deliveryAddress?.state, o.deliveryAddress?.zipCode].filter(Boolean).join(", ");
            if (!addrText) return;
            const key = addrText.toLowerCase();
            if (geoCache[key]) return;
            geoCache[key] = null;
            const cityFallback = addrFallback(o.deliveryAddress);
            const currentDelay = delay;
            delay += 1100;
            setTimeout(() => {
              fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addrText)}&format=json&limit=1`, { headers: { "Accept-Language": "en" } })
                .then(r => r.json())
                .then(data => {
                  geoCache[key] = data?.[0] ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : cityFallback;
                  setGeoVersion(v => v + 1);
                })
                .catch(() => {
                  geoCache[key] = addrFallback(o.deliveryAddress);
                  setGeoVersion(v => v + 1);
                });
            }, currentDelay);
          });
        }

        const allMapMarkers = filteredOrderList
          .filter((o: any) => o.deliveryAddress?.city)
          .filter((o: any) => !activeCity || o.deliveryAddress.city.toLowerCase() === activeCity)
          .map((o: any) => {
            const coords = o.deliveryAddress?.location?.coordinates;
            const label = o.orderNumber || o.id || o._id;
            const addrFull = [o.deliveryAddress?.addressLine1, o.deliveryAddress?.addressLine2, o.deliveryAddress?.city, o.deliveryAddress?.state, o.deliveryAddress?.zipCode].filter(Boolean).join(", ");
            const addrShort = addrFull.length > 50 ? addrFull.slice(0, 50) + "..." : addrFull;
            const addrInfo = `${o.customerName} · ${formatPrice(o.totalAmount)} · ${addrShort}`;
            if (coords) {
              const [lng, lat] = coords;
              return { id: o.id || o._id, lat, lng, title: label, info: addrInfo };
            }
            const addrKey = addrFull.toLowerCase();
            const cached = addrKey ? geoCache[addrKey] : null;
            if (cached) return { id: o.id || o._id, lat: cached.lat, lng: cached.lng, title: label, info: addrInfo };
            const fallback = addrFallback(o.deliveryAddress);
            return { id: o.id || o._id, lat: fallback.lat, lng: fallback.lng, title: label, info: addrInfo };
          });
        return (
          <div className="space-y-4">
            {filteredOrderList.length === 0 ? (
              <Card className="border-dashed border-slate-300 shadow-none">
                <CardContent className="flex flex-col items-center px-4 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Search className="h-5 w-5" /></span>
                  <p className="mt-3 text-base font-semibold text-slate-900">No orders found</p>
                  <p className="mt-1 max-w-md text-sm text-slate-500">Try another search term or choose a different order status.</p>
                  {(searchQuery || statusFilter !== "all") ? (
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}>Clear filters</Button>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {showMapView && filteredOrderList.length > 0 && (
              <>
                <MapWithMarkers markers={allMapMarkers} />
                <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCity(null)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  activeCity === null
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                )}
              >
                <span>All Locations</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  activeCity === null ? "bg-emerald-500 text-white" : "bg-emerald-200 text-emerald-800"
                )}>
                  {filteredOrderList.length}
                </span>
              </button>
              {groupEntries.map(([city, orders]) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => setSelectedCity(city)}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                    activeCity === city
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  )}
                >
                  <span className="capitalize">{city}</span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    activeCity === city ? "bg-emerald-500 text-white" : "bg-emerald-200 text-emerald-800"
                  )}>
                    {orders.length}
                  </span>
                </button>
              ))}
                </div>
              </>
            )}
            {(activeCity === null
              ? filteredOrderList
              : filteredOrderList.filter((order: any) => (order.deliveryAddress?.city || "Unknown").toLowerCase() === activeCity)
            ).map((order: any) => {
                  const orderId = String(order.id || order._id || "");
                  const status = getStatus(order);
                  const primaryItem = Array.isArray(order.items) ? order.items[0] || {} : {};
                  const itemCount = Array.isArray(order.items) ? order.items.length : 0;
                  const productName = primaryItem.productName || primaryItem.name || (itemCount > 1 ? `${itemCount} products` : "Order items");
                  const productGrade = primaryItem.qualityGrade || primaryItem.grade || primaryItem.quality || "";
                  const productQuantity = primaryItem.quantity ?? primaryItem.quantityKg ?? primaryItem.orderedQuantity ?? "—";
                  const productUnit = primaryItem.unit || primaryItem.unitName || "kg";
                  const productUnitPrice = primaryItem.unitPrice ?? primaryItem.pricePerUnit ?? primaryItem.price;
                  const rawProductImage = [
                    primaryItem.productImageUrl,
                    primaryItem.imageUrl,
                    primaryItem.productImage,
                    primaryItem.image,
                    primaryItem.product?.imageUrl,
                    primaryItem.product?.image,
                  ].find((value) => typeof value === "string" && (value.startsWith("https://") || value.startsWith("http://") || value.startsWith("/")));
                  const isReadyForPickup = status === "ready_for_pickup" || String(order.fulfillmentStage || "").toLowerCase() === "ready_for_pickup";
                  const progressStages = [
                    { key: "confirmed", label: "Confirmed" },
                    { key: "processing", label: "Processing" },
                    { key: "ready", label: status === "dispatched" ? "Dispatched" : isReadyForPickup ? "Ready for pickup" : "Ready" },
                    { key: "transit", label: "In transit" },
                    { key: "delivered", label: "Delivered" },
                  ];
                  const progressIndex = status === "pending" ? -1
                    : status === "confirmed" ? 0
                    : status === "processing" ? (isReadyForPickup ? 2 : 1)
                    : ["ready_for_delivery", "ready_for_pickup", "dispatched"].includes(status) ? 2
                    : status === "in_transit" ? 3
                    : ["delivered", "picked_up"].includes(status) ? 4
                    : -1;
                  return (
                  <Card key={orderId} className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-emerald-200 hover:shadow-md">
                    <CardContent className="p-0">
                      <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(170px,0.85fr)_minmax(210px,1fr)_minmax(270px,1.25fr)_minmax(245px,1fr)]">
                        <div className="min-w-0 border-b border-slate-100 p-4 sm:p-5 xl:border-b-0 xl:border-r">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/farmer/orders/${orderId}`} className="text-sm font-bold tracking-tight text-slate-950 hover:text-emerald-700">
                              #{order.orderNumber || String(orderId).slice(-8)}
                            </Link>
                            {order.isBulkOrder ? <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Bulk</Badge> : <Badge variant="secondary">Individual order</Badge>}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">Placed: {formatDate(order.orderDate)}</p>
                          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                            <div className="flex items-start gap-2.5">
                              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><User className="h-3.5 w-3.5" /></span>
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Customer</p>
                                <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">{order.customerName || order.customer?.name || "Customer"}</p>
                                {order.customerPhone ? <p className="mt-0.5 text-xs text-slate-500">{order.customerPhone}</p> : null}
                              </div>
                            </div>
                            <div className="flex items-start gap-2.5">
                              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><MapPin className="h-3.5 w-3.5" /></span>
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Delivery</p>
                                <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">{order.deliveryType === "pickup" ? "Customer pickup" : order.deliveryAddress?.city || "Home delivery"}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="min-w-0 border-b border-slate-100 p-4 sm:p-5 xl:border-b-0 xl:border-r">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className="flex h-[68px] w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-emerald-700"
                              style={rawProductImage ? { backgroundImage: `url("${rawProductImage}")`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
                              aria-label={rawProductImage ? `${productName} image` : "Product image unavailable"}
                            >
                              {!rawProductImage ? <Package className="h-7 w-7" /> : null}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-slate-950">{productName}</p>
                              {productGrade ? <p className="mt-0.5 text-xs text-slate-500">Grade {productGrade}</p> : <p className="mt-0.5 text-xs text-slate-500">{itemCount} item{itemCount === 1 ? "" : "s"} in order</p>}
                              {itemCount > 1 ? <p className="mt-1 text-[11px] font-medium text-emerald-700">+{itemCount - 1} more product{itemCount === 2 ? "" : "s"}</p> : null}
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2">
                            <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Quantity</p>
                              <p className="mt-1 text-sm font-bold text-slate-900">{productQuantity} {productUnit}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Unit price</p>
                              <p className="mt-1 text-sm font-bold text-emerald-700">{productUnitPrice != null ? formatPrice(productUnitPrice) : "—"}{productUnitPrice != null ? `/${productUnit}` : ""}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                            <span className="text-xs font-medium text-slate-500">Order total</span>
                            <div className="text-right">
                              <p className="text-lg font-bold tracking-tight text-slate-950">{formatPrice(order.totalAmount)}</p>
                              {paymentBadge(order.paymentMethod).label ? <span className={cn("text-[10px] font-semibold", paymentBadge(order.paymentMethod).cod ? "text-amber-700" : "text-blue-700")}>{paymentBadge(order.paymentMethod).label}{order.paymentStatus === "paid" ? " · Paid" : ""}</span> : null}
                            </div>
                          </div>
                        </div>

                        <div className="min-w-0 p-4 sm:p-5">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-800">Fulfillment progress</p>
                            <span className="text-[11px] font-semibold text-emerald-700">{statusLabels[status] || status}</span>
                          </div>
                          {progressIndex >= 0 ? (
                            <div className="flex items-start">
                              {progressStages.map((step, index) => {
                                const complete = index <= progressIndex;
                                const current = index === progressIndex;
                                return (
                                  <div key={step.key} className="flex min-w-0 flex-1 flex-col items-center">
                                    <div className="flex w-full items-center">
                                      {index > 0 ? <span className={cn("h-0.5 flex-1", index <= progressIndex ? "bg-emerald-500" : "bg-slate-200")} /> : <span className="h-0.5 flex-1 bg-transparent" />}
                                      <span className={cn("flex h-3 w-3 shrink-0 rounded-full border-2", complete ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white", current && "ring-4 ring-emerald-100")} />
                                      {index < progressStages.length - 1 ? <span className={cn("h-0.5 flex-1", index < progressIndex ? "bg-emerald-500" : "bg-slate-200")} /> : <span className="h-0.5 flex-1 bg-transparent" />}
                                    </div>
                                    <span className={cn("mt-2 max-w-full text-center text-[9px] leading-3 sm:text-[10px]", current ? "font-bold text-emerald-800" : complete ? "font-medium text-slate-700" : "text-slate-400")}>{step.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Awaiting order confirmation</div>
                          )}

                          <div className="mt-4 flex flex-wrap gap-1.5">
                            {order.fulfillmentMethod === "farmer" ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700"><UserCheck className="mr-1 h-3 w-3" />Farmer fulfillment</Badge> : null}
                            {order.fulfillmentMethod === "warehouse" ? <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700"><Store className="mr-1 h-3 w-3" />Warehouse fulfillment</Badge> : null}
                            {order.deliveryPartnerRoute === "long_distance" ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Long distance transfer</Badge> : null}
                            {order.deliveryPartnerRoute === "nearby" ? <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">Nearby delivery</Badge> : null}
                          </div>
                          {order.deliveryPartnerName || order.warehouse?.name || order.warehouseCollectionStatus ? (
                            <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Delivery update</p>
                              <p className="mt-0.5 text-xs leading-5 text-emerald-900">
                                {order.deliveryPartnerName ? `Partner: ${order.deliveryPartnerName}` : order.warehouse?.name ? `Warehouse: ${order.warehouse.name}` : String(order.warehouseCollectionStatus || "").replace(/_/g, " ")}
                              </p>
                              {order.warehouseCollectionStatus ? <p className="mt-0.5 text-[10px] text-emerald-800">Farm collection: {String(order.warehouseCollectionStatus).replace(/_/g, " ")}</p> : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="min-w-0 border-t border-slate-100 bg-slate-50/60 p-4 sm:p-5 xl:border-l xl:border-t-0">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <Badge variant="outline" className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", statusColors[status] || "border-slate-200 bg-white text-slate-700")}>{statusLabels[status] || status}</Badge>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" aria-label={`More actions for order ${order.orderNumber || orderId}`}>
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild><Link href={`/farmer/orders/${orderId}`}><Eye className="mr-2 h-4 w-4" />View full order</Link></DropdownMenuItem>
                                <DropdownMenuItem onClick={() => router.push(`/farmer/order-map?delivery=required&orderId=${encodeURIComponent(orderId)}`)}><Navigation className="mr-2 h-4 w-4" />Open in order map</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Next action</p>
                                <p className="mt-0.5 text-sm font-semibold text-slate-900">
                                  {status === "pending" ? "Review and confirm order" :
                                   status === "confirmed" ? "Start processing" :
                                   status === "processing" && order.fulfillmentRouteSelected !== true ? "Choose fulfillment route" :
                                   status === "processing" && order.fulfillmentMethod === "farmer" && (!order.fulfillmentStage || order.fulfillmentStage === "pending") ? "Complete farmer packing" :
                                   status === "processing" && order.fulfillmentMethod === "warehouse" && !order.warehouseCollectionStatus ? "Prepare product for warehouse pickup" :
                                   status === "ready_for_delivery" && order.deliveryPartnerId && order.deliveryPartnerRoute === "long_distance" ? "Delivery partner assigned · Warehouse transfer in progress" :
                                   status === "ready_for_delivery" && order.deliveryPartnerId ? "Delivery partner assigned · Continue delivery route" :
                                   status === "ready_for_delivery" && order.deliveryPartnerRoute === "long_distance" ? "Complete warehouse transfer / delivery routing" :
                                   status === "ready_for_delivery" ? "Open Farmer Order Map" :
                                   status === "dispatched" ? "Track delivery" :
                                   status === "in_transit" ? "Complete delivery" : "View order"}
                                </p>
                              </div>
                              <Link href={`/farmer/orders/${orderId}`} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline">Details</Link>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Available actions</p>
                            {getStatus(order) === "pending" && (
                              <>
                                <Button size="sm" className="w-full" onClick={() => setConfirmAction({ order, action: 'confirmed' })}>
                                  <CheckCircle className="mr-1.5 h-3.5 w-3.5"/>Confirm
                                </Button>
                                <Button size="sm" variant="destructive" className="w-full" onClick={() => setConfirmAction({ order, action: 'cancelled' })}>
                                  <XCircle className="mr-1.5 h-3.5 w-3.5"/>Cancel
                                </Button>
                              </>
                            )}
                            {getStatus(order) === "confirmed" && (
                              <>
                                <Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => handleUpdateStatus(order.id || order._id, 'processing')}>
                                  <Package className="mr-1.5 h-3.5 w-3.5"/>Process
                                </Button>
                                <Button size="sm" variant="destructive" className="w-full" onClick={() => setConfirmAction({ order, action: 'cancelled' })}>
                                  <XCircle className="mr-1.5 h-3.5 w-3.5"/>Cancel
                                </Button>
                              </>
                            )}
                            {getStatus(order) === "processing" && (
                              <div className="flex flex-col gap-2">
                                {order.fulfillmentRouteSelected !== true || Number(order.fulfillmentRouteVersion || 0) !== 1 ? (
                                  <div className="space-y-2.5">
                                    <div className="grid gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-auto w-full justify-start rounded-xl border-emerald-200 bg-white p-3 text-left hover:border-emerald-400 hover:bg-emerald-50/60"
                                        onClick={() => setFulfillmentRoute(order.id || order._id, "farmer")}
                                      >
                                        <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                                          <UserCheck className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-xs font-semibold text-slate-900">Farmer Fulfillment</span>
                                        </span>
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-auto w-full justify-start rounded-xl border-blue-200 bg-white p-3 text-left hover:border-blue-400 hover:bg-blue-50/60"
                                        onClick={() => setFulfillmentRoute(order.id || order._id, "warehouse")}
                                      >
                                        <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                                          <Store className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block text-xs font-semibold text-slate-900">Warehouse Fulfillment</span>
                                        </span>
                                      </Button>
                                    </div>
                                  </div>
                                ) : order.fulfillmentMethod === "farmer" ? (
                                  <div className="space-y-2">
                                    {(!order.fulfillmentStage || order.fulfillmentStage === "pending") && (
                                      <div className="space-y-2">
                                        <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" asChild>
                                          <Link href="/farmer/packing">
                                            <Package className="mr-2 h-4 w-4" />Open Packing & Checking
                                          </Link>
                                        </Button>
                                      </div>
                                    )}
                                    {order.fulfillmentStage === "packed" && (
                                      <div className="space-y-2">
                                        <Button
                                          size="sm"
                                          className="w-full bg-indigo-600 hover:bg-indigo-700"
                                          onClick={() => router.push(`/farmer/order-map?delivery=required&orderId=${encodeURIComponent(orderId)}`)}
                                        >
                                          <Navigation className="mr-2 h-4 w-4" />Open Farmer Order Map
                                        </Button>
                                      </div>
                                    )}
                                    {order.deliveryPartnerRoute === "long_distance" && order.warehouseCollectionStatus && (
                                      <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-900">
                                        <strong>Warehouse transfer for long-distance delivery</strong>
                                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                                          {[["ready_for_pickup","Warehouse collection requested"],["team_assigned","Collection team assigned"],["en_route","Team en route"],["arrived_at_farm","Team arrived at farm"],["collected","Packed orders collected"],["departed_farm","Departed farm"],["arrived_warehouse","Arrived at warehouse"]].map(([key,label]) => {
                                            const stages=["ready_for_pickup","team_assigned","en_route","arrived_at_farm","collected","departed_farm","arrived_warehouse"];
                                            const idx=stages.indexOf(String(order.warehouseCollectionStatus));
                                            const complete=idx>=stages.indexOf(key);
                                            return <div key={key} className={"rounded-md px-2 py-1.5 " + (complete ? "bg-white font-medium" : "text-amber-600")}>{complete ? "✓ " : "○ "}{label}</div>;
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-3">
                                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Current status</p>
                                      <p className="mt-1 font-semibold text-slate-900">
                                        {(() => {
                                          const stage = String(order.warehouseFulfillmentStage || "incoming").toLowerCase();
                                          const labels: Record<string, string> = {
                                            incoming: "Warehouse Fulfillment Selected",
                                            pickup_requested: "Product Ready · Pickup Requested",
                                            collection_team_assigned: "Collection Team Assigned",
                                            collection_en_route: "Collection Team En Route",
                                            collection_arrived: "Collection Team Arrived at Farm",
                                            collected: "Collected from Farm",
                                            collection_departed: "Departed Farm",
                                            received: "Warehouse Received",
                                            stored: "Stock Stored",
                                            ready_for_packing: "Warehouse Processing",
                                            packing_team_assigned: "Warehouse Processing",
                                            packing: "Warehouse Processing",
                                            packed: "Warehouse Processing",
                                            ready_for_dispatch: "Ready for Dispatch",
                                            delivery_decision: "Ready for Dispatch",
                                            dispatched: "Warehouse Dispatched",
                                          };
                                          return labels[stage] || "Warehouse Processing";
                                        })()}
                                      </p>
                                    </div>

                                    {!order.warehouseCollectionStatus && (
                                      <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => markWarehouseReadyForPickup(orderId)}>
                                        <Package className="mr-2 h-4 w-4" />Product Ready for Warehouse Pickup
                                      </Button>
                                    )}

                                  </div>
                                )}
                              </div>
                            )}
                            {status === "ready_for_delivery" && order.fulfillmentMethod === "farmer" && !order.selfDelivery && !order.deliveryPartnerId && !order.partnerRequested && order.deliveryType !== "pickup" && (
                              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => router.push(`/farmer/order-map?delivery=required&orderId=${encodeURIComponent(orderId)}`)}>
                                <Navigation className="mr-2 h-4 w-4" />Open Order Map
                              </Button>
                            )}
                            {status === "ready_for_delivery" && order.fulfillmentMethod === "farmer" && order.deliveryPartnerId && (
                              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                                <div className="font-semibold">Delivery Partner Assigned</div>
                                <div className="mt-1">{order.deliveryPartnerName || "Assigned partner"} · {order.deliveryPartnerRoute === "long_distance" ? "Long Distance · Warehouse → Local Hub → Partner" : "Nearby · Local Hub → Partner"}</div>
                              </div>
                            )}
                            {status === "ready_for_delivery" && order.selfDelivery && <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => handleUpdateStatus(orderId, "delivered")}><CheckCircle className="mr-2 h-4 w-4" />Mark Delivered</Button>}
                            {status === "dispatched" && <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => handleUpdateStatus(orderId, "in_transit")}><Truck className="mr-2 h-4 w-4" />Mark In Transit</Button>}
                            {status === "in_transit" && <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => handleUpdateStatus(orderId, "delivered")}><CheckCircle className="mr-2 h-4 w-4" />Mark Delivered</Button>}
                            {!["pending", "confirmed", "processing", "ready_for_delivery", "dispatched", "in_transit"].includes(status) && <Button size="sm" variant="outline" className="w-full" asChild><Link href={"/farmer/orders/" + orderId}><Eye className="mr-2 h-4 w-4" />View Order</Link></Button>}
                            {["pending", "confirmed"].includes(status) && <Button size="sm" variant="ghost" className="w-full text-slate-600" asChild><Link href={"/farmer/orders/" + orderId}><Eye className="mr-2 h-4 w-4" />View Full Order</Link></Button>}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  );
            })}
          </div>
        );
      })()}
      <Dialog open={!!confirmAction} onOpenChange={(v) => { if (!v) setConfirmAction(null); }}>
        {confirmAction && (() => {
          const o = confirmAction.order;
          const action = confirmAction.action;
          const isConfirm = action === "confirmed";
          const label = isConfirm ? "Confirm Order" : "Cancel Order";
          return (
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{label}</DialogTitle>
                <DialogDescription>
                  {isConfirm
                    ? `Are you sure you want to confirm order #${(o.orderNumber || o.id || o._id).slice(-8)}?`
                    : `Are you sure you want to cancel order #${(o.orderNumber || o.id || o._id).slice(-8)}?`}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-slate-500">Customer</span><span className="font-medium">{o.customerName}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Items</span><span className="font-medium">{(o.items || []).length} item(s)</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Total</span><span className="font-semibold text-emerald-600">{formatPrice(o.totalAmount)}</span></div>
                {!isConfirm && <div className="flex justify-between"><span className="text-slate-500">Status</span><Badge variant="outline" className={statusColors[action]}>{statusLabels[action]}</Badge></div>}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={() => setConfirmAction(null)}>Go Back</Button>
                <Button
                  variant={isConfirm ? "default" : "destructive"}
                  onClick={async () => {
                    await handleUpdateStatus(o.id || o._id, action);
                    setConfirmAction(null);
                  }}
                >
                  {isConfirm ? <CheckCircle className="mr-2 h-4 w-4" /> : <XCircle className="mr-2 h-4 w-4" />}
                  Yes, {isConfirm ? "Confirm" : "Cancel"}
                </Button>
              </div>
            </DialogContent>
          );
        })()}
      </Dialog>
    </div>
  );
}
