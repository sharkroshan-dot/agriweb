"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, XCircle, Truck, Package, Eye, MoreVertical, RefreshCw, Store, ShoppingBag, Clock, UserCheck, Navigation, X, User, Star, Phone, Map as MapIcon } from "lucide-react";
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
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showBulkSummary, setShowBulkSummary] = useState(false);
  const [showDeliveryRoutes, setShowDeliveryRoutes] = useState(false);
  const [showMapView, setShowMapView] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ order: any; action: string } | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [geoVersion, setGeoVersion] = useState(0);
  const geocodingRef = useRef<Record<string, any>>({});

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ["farmerOrders", statusFilter],
    queryFn: () => api.get("/farmers/me/orders", { params: { status: statusFilter !== "all" ? statusFilter : undefined, limit: 500 } }),
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

  const handleBulkWorkflowAction = async (action: "confirm" | "process" | "farmer_fulfillment" | "warehouse_fulfillment") => {
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

  const filteredOrderList = orderList;


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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-600">Farmer workspace</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review customer demand, confirm available stock, and manage fulfillment.</p>
        </div>
        <div className="mb-3 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm"><Package className="h-4 w-4" /></div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Packing & Checking</p>
              <p className="text-xs text-slate-600">Check all Farmer Fulfillment orders, record packed quantities, and prepare delivery labels.</p>
            </div>
          </div>
          <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700">
            <Link href="/farmer/packing">Open Packing</Link>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-white px-3 py-1">
            {orderList.length} orders · newest first
          </Badge>
          <Button variant="outline" size="icon" onClick={() => { refetch(); availabilityQuery.refetch(); }} aria-label="Refresh orders">
            <RefreshCw className="h-4 w-4"/>
          </Button>
        </div>
      </div>

      <Dialog open={runAllConfirmOpen} onOpenChange={setRunAllConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run all eligible orders?</DialogTitle>
            <DialogDescription>
              This will process every farmer order that can safely advance. Each order is checked independently; orders needing a fulfillment choice, warehouse action, or delivery decision will stop there.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span>Total visible orders</span><strong>{orderList.length}</strong></div>
            <p className="text-xs text-muted-foreground">Farmer Fulfillment stops at Packed here. Open the Farmer Order Map for distance calculation and delivery decision; Dispatch happens only on the delivery-partner branch.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRunAllConfirmOpen(false)} disabled={bulkRunning}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setRunAllConfirmOpen(false); handleRunAllEligible(); }} disabled={bulkRunning}>
              {bulkRunning ? "Processing..." : "Run All Eligible"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="overflow-hidden border shadow-sm">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-semibold">Order Workflow</h2>
              <p className="text-xs text-muted-foreground">
                Complete one stage first; the next action appears automatically. Bulk actions advance only eligible orders by one stage.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={bulkRunning} onClick={() => setRunAllConfirmOpen(true)}>
                  {bulkRunning ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  {bulkRunning ? "Processing Orders..." : "Overall Processing"}
                </Button>
                <span className="text-xs text-muted-foreground">Advances each eligible order through the workflow.</span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkRunning}
                  onClick={() => handleBulkWorkflowAction("confirm")}
                >
                  <CheckCircle className="mr-2 h-4 w-4" />Confirm All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkRunning}
                  onClick={() => handleBulkWorkflowAction("process")}
                >
                  <Package className="mr-2 h-4 w-4" />Process All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkRunning}
                  onClick={() => handleBulkWorkflowAction("farmer_fulfillment")}
                >
                  <UserCheck className="mr-2 h-4 w-4" />Farmer Fulfillment All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkRunning}
                  onClick={() => handleBulkWorkflowAction("warehouse_fulfillment")}
                >
                  <Store className="mr-2 h-4 w-4" />Warehouse Fulfillment All
                </Button>

</div>

              <div className="rounded-lg border bg-slate-50/70 p-2">
                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Quick Access</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                    className="border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                  >
                    <Link href="/farmer/packing">
                      <Package className="mr-2 h-4 w-4" />Open Packing
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                    className="border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800"
                  >
                    <Link href="/farmer/order-map?delivery=required">
                      <Navigation className="mr-2 h-4 w-4" />Open Farmer Order Map
                    </Link>
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Use a stage button when you want to run only that stage for eligible orders. Fulfillment selection and delivery routing still require the individual order when a manual decision is needed.
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">Pending → Confirmed</Badge>
              <span>→</span>
              <Badge variant="outline">Processing</Badge>
              <span>→</span>
              <Badge variant="outline">Choose Fulfillment</Badge>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
              <p className="text-xs font-semibold text-emerald-900">Farmer Fulfillment branch</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-emerald-900">
                <Badge variant="outline" className="border-emerald-200 bg-white">Farmer Packs Each Order</Badge>
                <span>→</span>
                <Badge variant="outline" className="border-emerald-200 bg-white">Shortage Check</Badge>
                <span>→</span>
                <Badge variant="outline" className="border-emerald-200 bg-white">Packed</Badge>
                <span>→</span>
                <Badge variant="outline" className="border-emerald-200 bg-white">Farmer Order Map</Badge>
              </div>
              <p className="mt-2 text-[11px] text-emerald-800">
                After packing, open the Farmer Order Map. Self-delivery follows Dispatch → Farmer → Customer; delivery-partner routes also Dispatch first and then follow the nearby/long-distance path.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

        <div className="flex items-center gap-2">
          <Button
            variant={showDeliveryRoutes ? "default" : "outline"}
            size="sm"
            onClick={() => setShowDeliveryRoutes(!showDeliveryRoutes)}
            className="flex items-center gap-2"
          >
            <Navigation className="h-4 w-4" />
            Delivery Routes
          </Button>
          <Button
            variant={showBulkSummary ? "default" : "outline"}
            size="sm"
            onClick={() => setShowBulkSummary(!showBulkSummary)}
            className="flex items-center gap-2"
          >
            <ShoppingBag className="h-4 w-4" />
            Bulk Summary
          </Button>
          <Button
            variant={showMapView ? "default" : "outline"}
            size="sm"
            onClick={() => setShowMapView(!showMapView)}
            className="flex items-center gap-2"
          >
            <Navigation className="h-4 w-4" />
            Split by Location
          </Button>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full bg-white sm:w-[180px]"><SelectValue placeholder="Filter by status"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="ready_for_delivery">Ready for Delivery</SelectItem>
              <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
              <SelectItem value="dispatched">Dispatched</SelectItem>
              <SelectItem value="in_transit">In Transit</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="picked_up">Picked Up</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
            </SelectContent>
          </Select>
           
        </div>



      {showDeliveryRoutes && (
        <Card>
          <CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Delivery Routes</h2>
                <p className="text-sm text-gray-500">
                  Pending delivery orders grouped by area — choose to self-deliver or assign a partner
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowDeliveryRoutes(false)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            {routesLoading ? (
              <div className="h-32 animate-pulse rounded-lg bg-gray-100" />
            ) : routesData?.data?.length === 0 || !routesData?.data ? (
              <p className="text-sm text-gray-400">No pending delivery orders to route</p>
            ) : (
              <div className="space-y-4">
                {routesData.data.map((route: any) => (
                  <div key={route.routeName} className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="flex items-center gap-2 font-medium text-emerald-900">
                          <Navigation className="h-4 w-4" /> {route.routeName}
                        </p>
                        <p className="text-sm text-emerald-700">
                          {route.orderCount} orders · {formatPrice(route.totalAmount)} total
                        </p>
                        <p className="text-xs text-emerald-600">
                          From {formatDate(route.earliestDate)} to {formatDate(route.latestDate)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push("/farmer/order-map")}
                      >
                        <Navigation className="mr-1 h-3 w-3" /> Open Order Map
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {route.orders.map((o: any) => (
                        <Badge key={o.orderId} variant="outline" className="border-emerald-200 bg-white text-xs">
                          <Link href={`/farmer/orders/${o.orderId}`} className="text-emerald-700 hover:underline">
                            {o.orderNumber}
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
        orderList.forEach((o: any) => {
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
          orderList.forEach((o: any) => {
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

        const allMapMarkers = orderList
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
            {showMapView && (
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
                  {orderList.length}
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
              ? orderList
              : orderList.filter((order: any) => (order.deliveryAddress?.city || "Unknown").toLowerCase() === activeCity)
            ).map((order: any) => {
                  const orderId = String(order.id || order._id || "");
                  const status = getStatus(order);
                  return (
                  <Card key={orderId} className="overflow-hidden border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="p-0">
                      <div className="flex flex-col lg:flex-row">
                        <div className="min-w-0 flex-1 p-4 sm:p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link href={`/farmer/orders/${orderId}`} className="text-sm font-semibold text-slate-900 hover:text-emerald-700">
                                  #{order.orderNumber || String(orderId).slice(-8)}
                                </Link>
                                <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-xs", statusColors[status] || "bg-slate-50 text-slate-600 border-slate-200")}>
                                  {statusLabels[status] || status}
                                </Badge>
                                {order.paymentStatus === "paid" && <Badge variant="success" className="rounded-full px-2.5 py-0.5 text-xs">Paid</Badge>}
                                {order.isBulkOrder && (
                                  <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700">
                                    <ShoppingBag className="mr-1 h-3 w-3" />Bulk
                                  </Badge>
                                )}
                                {order.selfDelivery && (
                                  <Badge variant="outline" className="rounded-full border-purple-200 bg-purple-50 text-purple-700">
                                    <UserCheck className="mr-1 h-3 w-3" />Self Delivery
                                  </Badge>
                                )}
                                {(order.deliveryPartnerId || order.partnerRequested) && (
                                  <Badge variant="outline" className="rounded-full border-indigo-200 bg-indigo-50 text-indigo-700">
                                    <Truck className="mr-1 h-3 w-3" />Delivery Partner
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{formatDate(order.orderDate)}</p>
                            </div>

                            <div className="text-left sm:text-right">
                              <p className="text-lg font-bold tracking-tight text-slate-900">{formatPrice(order.totalAmount)}</p>
                              {paymentBadge(order.paymentMethod).label && (
                                <span className={cn(
                                  "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                  paymentBadge(order.paymentMethod).cod
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-blue-200 bg-blue-50 text-blue-700"
                                )}>
                                  {paymentBadge(order.paymentMethod).label}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-lg bg-slate-50 p-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Customer</p>
                              <p className="mt-1 truncate text-sm font-medium text-slate-900">{order.customerName || "Customer"}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 p-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Items</p>
                              <p className="mt-1 text-sm font-medium text-slate-900">{(order.items || []).length} item{(order.items || []).length === 1 ? "" : "s"}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 p-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Delivery</p>
                              <p className="mt-1 truncate text-sm font-medium text-slate-900">
                                {order.deliveryType === "pickup" ? "Customer Pickup" : (order.deliveryAddress?.city || "Home delivery")}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {(order.items || []).slice(0, 2).map((item: any, idx: number) => (
                              <span key={idx} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                                {item.productName} · {item.quantity}
                              </span>
                            ))}
                            {(order.items || []).length > 2 && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                                +{(order.items || []).length - 2} more
                              </span>
                            )}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {order.fulfillmentMethod === "farmer" && (
                              <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700">
                                <UserCheck className="mr-1 h-3 w-3" />Farmer Fulfillment
                              </Badge>
                            )}
                            {order.fulfillmentMethod === "warehouse" && (
                              <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 text-blue-700">
                                <Store className="mr-1 h-3 w-3" />Warehouse Fulfillment
                              </Badge>
                            )}
                            {status === "processing" && order.fulfillmentRouteSelected !== true && (
                              <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                                Fulfillment Selection Required
                              </Badge>
                            )}
                            {order.deliveryPartnerRoute === "long_distance" && (
                              <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-700">
                                <Truck className="mr-1 h-3 w-3" />Long-Distance · Warehouse Transfer
                              </Badge>
                            )}
                            {order.deliveryPartnerRoute === "nearby" && (
                              <Badge variant="outline" className="rounded-full border-green-200 bg-green-50 text-green-700">
                                <Navigation className="mr-1 h-3 w-3" />Nearby Delivery
                              </Badge>
                            )}
                            {order.deliveryPartnerName && (
                              <Badge variant="outline" className="rounded-full border-indigo-200 bg-indigo-50 text-indigo-700">
                                Partner: {order.deliveryPartnerName}
                              </Badge>
                            )}
                            {order.pickedBy && (
                              <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-slate-600">
                                Picked by: {order.pickedBy}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="border-t bg-slate-50/70 p-4 sm:p-5 lg:w-[300px] lg:border-l lg:border-t-0">
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
                                   status === "ready_for_delivery" && order.deliveryPartnerRoute === "long_distance" ? "Complete warehouse transfer / delivery routing" :
                                   status === "ready_for_delivery" ? "Arrange delivery" :
                                   status === "dispatched" ? "Track delivery" :
                                   status === "in_transit" ? "Complete delivery" : "View order"}
                                </p>
                              </div>
                              <Link href={`/farmer/orders/${orderId}`} className="shrink-0 text-xs font-medium text-emerald-700 hover:underline">Details</Link>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Manual processing</p>
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
                                          <span className="mt-0.5 block text-[11px] font-normal leading-4 text-slate-500">
                                            You pack the order and continue to the Farmer Order Map.
                                          </span>
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
                                          <span className="mt-0.5 block text-[11px] font-normal leading-4 text-slate-500">
                                            Send stock to the warehouse for order allocation and packing.
                                          </span>
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
                                        <p className="text-[11px] text-muted-foreground">Check the order, enter actual quantities, resolve shortages, and prepare the delivery label in the packing workspace.</p>
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
                                        <p className="text-[11px] text-muted-foreground">Packing is complete. Choose self delivery or let distance decide the delivery-partner route.</p>
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
                                        <p className="mt-2 border-t border-amber-200 pt-2">These customer orders were already packed by you. The warehouse is a transfer point only and will not repack them.</p>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                                    <div>
                                      <strong>Warehouse fulfillment</strong>
                                      <p className="mt-1">Bulk harvest/product is sent to the warehouse. The warehouse then allocates stock to this individual order and packs this order separately.</p>
                                    </div>
                                    {!order.warehouseCollectionStatus && (
                                      <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => markWarehouseReadyForPickup(orderId)}>
                                        <Package className="mr-2 h-4 w-4" />Product Ready for Warehouse Pickup
                                      </Button>
                                    )}
                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                      {[
                                        ["incoming", "Warehouse Fulfillment Selected"],
                                        ["pickup_requested", "Product Ready · Pickup Requested"],
                                        ["collection_team_assigned", "Collection Team Assigned"],
                                        ["collection_en_route", "Collection Team En Route"],
                                        ["collection_arrived", "Collection Team Arrived at Farm"],
                                        ["collected", "Collected from Farm"],
                                        ["collection_departed", "Departed Farm"],
                                        ["received", "Warehouse Received"],
                                        ["received", "Received & Quality Checked"],
                                        ["stored", "Stock Stored"],
                                        ["ready_for_packing", "Ready for Packing"],
                                        ["packing_team_assigned", "Packing Team Assigned"],
                                        ["packing", "Order Packing"],
                                        ["packed", "Packing Complete"],
                                        ["ready_for_dispatch", "Ready for Dispatch"],
                                        ["delivery_decision", "Delivery Decision"],
                                        ["dispatched", "Warehouse Dispatched"],
                                      ].map(([key, label], index) => {
                                        const stage = String(order.warehouseFulfillmentStage || "incoming");
                                        const stages = ["incoming", "pickup_requested", "collection_team_assigned", "collection_en_route", "collection_arrived", "collected", "collection_departed", "received", "stored", "ready_for_packing", "packing_team_assigned", "packing", "packed", "ready_for_dispatch", "delivery_decision", "dispatched"];
                                        const currentIndex = stages.indexOf(stage);
                                        const isComplete = currentIndex >= index;
                                        return (
                                          <div key={key + index} className={"flex items-center gap-2 rounded-md px-2 py-1.5 " + (isComplete ? "bg-white font-medium text-blue-900" : "text-blue-500")}>
                                            <span className={"h-2 w-2 rounded-full " + (isComplete ? "bg-blue-600" : "bg-blue-200")} />
                                            <span>{label}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <p className="border-t border-blue-200 pt-2">Farmer visibility only — warehouse staff performs these steps.</p>
                                  </div>
                                )}
                              </div>
                            )}
                            {status === "ready_for_delivery" && order.fulfillmentMethod === "farmer" && !order.selfDelivery && !order.deliveryPartnerId && !order.partnerRequested && order.deliveryType !== "pickup" && (
                              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => router.push(`/farmer/order-map?delivery=required&orderId=${encodeURIComponent(orderId)}`)}>
                                <Navigation className="mr-2 h-4 w-4" />Open Order Map
                              </Button>
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