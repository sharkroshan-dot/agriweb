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
  const router = useRouter();
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
    queryFn: () => api.get("/farmers/me/orders", { params: { status: statusFilter !== "all" ? statusFilter : undefined, limit: 50 } }),
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

  const handleBulkWorkflowAction = async (action: "confirm" | "process" | "farmer_fulfillment" | "warehouse_fulfillment" | "pack" | "dispatch") => {
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
        pack: "packed",
        dispatch: "dispatched",
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

  const finalizeFarmerPacking = async (order: any) => {
    const orderId = order.id || order._id;
    const items = Array.isArray(order.items) ? order.items : [];
    const quantities: Record<string, string> = {};
    items.forEach((item: any, index: number) => {
      quantities[`${String(item.productId)}:${String(item.variantId || "")}:${index}`] = String(item.quantity ?? 0);
    });

    const rows = items.map((item: any, index: number) => ({
      item,
      key: `${String(item.productId)}:${String(item.variantId || "")}:${index}`,
    }));

    const packedItems = rows.map(({ item, key }) => {
      const raw = window.prompt(
        `${item.productName || "Product"} — ordered: ${item.quantity}. Enter actual quantity packed:`,
        quantities[key],
      );
      if (raw === null) throw new Error("Packing cancelled");
      const packed = Number(raw);
      if (!Number.isFinite(packed) || packed < 0 || packed > Number(item.quantity)) {
        throw new Error(`Invalid packed quantity for ${item.productName || "product"}`);
      }
      return {
        productId: item.productId,
        variantId: item.variantId || null,
        packedQuantity: packed,
      };
    });

    try {
      const response = await api.post(`/orders/${orderId}/farmer-packing-finalize`, { items: packedItems });
      const result = response?.data || response;
      const shortage = Array.isArray(result?.shortageCancelledItems) ? result.shortageCancelledItems.length : 0;
      toast.success(
        shortage
          ? `Packing complete. ${shortage} shortage line(s) cancelled; final payable amount updated.`
          : "Packing complete. All ordered quantities are available.",
      );
      await refetch();
    } catch (error: any) {
      toast.error(error?.message || "Failed to finalize packing");
    }
  };

  const updateFulfillmentStage = async (orderId: string, stage: "packed" | "dispatched") => {
    try {
      await api.put(`/orders/${orderId}/fulfillment-stage`, undefined, { params: { stage } });
      toast.success(stage === "packed" ? "Order packed" : "Order dispatched");
      await refetch();
      if (stage === "dispatched") {
        router.push(`/farmer/order-map?delivery=required&orderId=${encodeURIComponent(orderId)}`);
        return;
      }
    } catch (error: any) {
      toast.error(error?.message || "Failed to update fulfillment stage");
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

  const orderList = orders?.data?.orders || orders?.orders || (Array.isArray(orders) ? orders : []);

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
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-white px-3 py-1">
            {orderList.length} visible orders
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
            <p className="text-xs text-muted-foreground">Farmer Fulfillment orders may continue through packing and dispatch. Warehouse Fulfillment orders stop when farmer or warehouse input is required.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRunAllConfirmOpen(false)} disabled={bulkRunning}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setRunAllConfirmOpen(false); handleRunAllEligible(); }} disabled={bulkRunning}>
              {bulkRunning ? "Processing..." : "Run All Eligible"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <section className="space-y-4">
        <Card className="overflow-hidden border bg-white shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900">Order workspace</h2>
                  <Badge variant="outline" className="bg-slate-50">{orderList.length} orders</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Work from left to right: confirm → process → choose fulfillment → pack → dispatch.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setRunAllConfirmOpen(true)} disabled={bulkRunning || orderList.length === 0}>
                  {bulkRunning ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  {bulkRunning ? "Processing..." : "Run All Eligible"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline"><Package className="mr-2 h-4 w-4" />Bulk actions</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem onClick={() => handleBulkWorkflowAction("confirm")}>Confirm all eligible</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkWorkflowAction("process")}>Start processing</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkWorkflowAction("farmer_fulfillment")}>Select farmer fulfillment</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkWorkflowAction("warehouse_fulfillment")}>Select warehouse fulfillment</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkWorkflowAction("pack")}>Pack eligible orders</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkWorkflowAction("dispatch")}>Dispatch eligible orders</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="sm" asChild><Link href="/farmer/order-map"><Navigation className="mr-2 h-4 w-4" />Order map</Link></Button>
                <Button variant="outline" size="sm" onClick={() => { refetch(); availabilityQuery.refetch(); }}>
                  <RefreshCw className="mr-2 h-4 w-4" />Refresh
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Pending", value: orderList.filter((o: any) => getStatus(o) === "pending"), tone: "border-amber-200 bg-amber-50 text-amber-800", icon: Clock },
                { label: "Processing", value: orderList.filter((o: any) => getStatus(o) === "processing"), tone: "border-blue-200 bg-blue-50 text-blue-800", icon: Package },
                { label: "Need delivery", value: orderList.filter((o: any) => getStatus(o) === "ready_for_delivery"), tone: "border-indigo-200 bg-indigo-50 text-indigo-800", icon: Navigation },
                { label: "In transit", value: orderList.filter((o: any) => getStatus(o) === "in_transit"), tone: "border-violet-200 bg-violet-50 text-violet-800", icon: Truck },
                { label: "Completed", value: orderList.filter((o: any) => ["delivered", "picked_up"].includes(getStatus(o))), tone: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: CheckCircle },
              ].map((item) => (
                <div key={item.label} className={cn("rounded-xl border px-3 py-3", item.tone)}>
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold">{item.label}</span><item.icon className="h-4 w-4 opacity-80" /></div>
                  <p className="mt-1 text-xl font-semibold">{item.value.length}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-white shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Find an order</h3>
                <p className="text-xs text-slate-500">Keep the queue focused on one status at a time.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-wrap rounded-lg bg-slate-100 p-1">
                  {[
                    ["all", "All"],
                    ["pending", "Pending"],
                    ["processing", "Processing"],
                    ["ready_for_delivery", "Delivery"],
                    ["delivered", "Completed"],
                  ].map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setStatusFilter(value)}
                      className={cn("rounded-md px-3 py-2 text-xs font-semibold transition", statusFilter === value ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                      {label}
                    </button>
                  ))}
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-10 w-full sm:w-[190px]"><SelectValue placeholder="Filter status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="processing">Processing</SelectItem>
                    <SelectItem value="ready_for_delivery">Ready for delivery</SelectItem>
                    <SelectItem value="ready_for_pickup">Ready for pickup</SelectItem>
                    <SelectItem value="dispatched">Dispatched</SelectItem>
                    <SelectItem value="in_transit">In transit</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                    <SelectItem value="picked_up">Picked up</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant={showBulkSummary ? "default" : "outline"} size="sm" onClick={() => setShowBulkSummary((value) => !value)}>
                  <ShoppingBag className="mr-2 h-4 w-4" />Bulk summary
                </Button>
                <Button variant={showDeliveryRoutes ? "default" : "outline"} size="sm" onClick={() => setShowDeliveryRoutes((value) => !value)}>
                  <Navigation className="mr-2 h-4 w-4" />Routes
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {showBulkSummary && (
          <Card className="border-blue-100 bg-blue-50/40">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-semibold text-blue-950">Bulk order summary</h3><p className="text-xs text-blue-700">Group demand by product before packing.</p></div>
                <Button variant="ghost" size="sm" onClick={() => setShowBulkSummary(false)}><X className="h-4 w-4" /></Button>
              </div>
              {bulkLoading ? (
                <div className="mt-4 h-20 animate-pulse rounded-lg bg-white" />
              ) : !Array.isArray(bulkData?.data) || bulkData.data.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-blue-200 bg-white p-5 text-center text-sm text-blue-700">No pending bulk demand to summarize.</div>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {bulkData.data.map((item: any) => (
                    <div key={item.productId} className="rounded-xl border border-blue-100 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="font-medium text-slate-900">{item.productName}</p><p className="mt-1 text-sm text-slate-500">{item.totalQuantity} units across {item.orderCount} orders</p></div>
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{item.orderCount} orders</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(item.orders || []).slice(0, 6).map((itemOrder: any) => (
                          <Link key={itemOrder.orderId} href={"/farmer/orders/" + itemOrder.orderId} className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:border-blue-300 hover:text-blue-700">
                            {itemOrder.quantity} × order
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showDeliveryRoutes && (
          <Card className="border-emerald-100 bg-emerald-50/50">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="font-semibold text-emerald-950">Delivery routes</h3><p className="text-xs text-emerald-700">Open the dedicated map to make radius and delivery decisions.</p></div>
                <Button variant="ghost" size="sm" onClick={() => setShowDeliveryRoutes(false)}><X className="h-4 w-4" /></Button>
              </div>
              {routesLoading ? (
                <div className="mt-4 h-20 animate-pulse rounded-lg bg-white" />
              ) : !Array.isArray(routesData?.data) || routesData.data.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-emerald-200 bg-white p-5 text-center text-sm text-emerald-700">No pending delivery routes.</div>
              ) : (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {routesData.data.map((route: any) => (
                    <div key={route.routeName} className="rounded-xl border border-emerald-100 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="font-medium text-slate-900">{route.routeName}</p><p className="mt-1 text-sm text-slate-500">{route.orderCount} orders · {formatPrice(route.totalAmount)}</p></div>
                        <Button size="sm" variant="outline" asChild><Link href="/farmer/order-map"><Navigation className="mr-1.5 h-4 w-4" />Open map</Link></Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(route.orders || []).slice(0, 8).map((routeOrder: any) => (
                          <Link key={routeOrder.orderId} href={"/farmer/orders/" + routeOrder.orderId} className="rounded-md border bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:border-emerald-300 hover:text-emerald-700">
                            {routeOrder.orderNumber}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden border bg-white shadow-sm">
          <CardContent className="p-0">
            {filteredOrderList.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100"><Package className="h-7 w-7 text-slate-400" /></div>
                <h3 className="mt-4 font-semibold text-slate-900">No orders in this view</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                  {statusFilter === "all" ? "New customer orders will appear here." : "No " + (statusLabels[statusFilter] || statusFilter) + " orders are currently waiting for action."}
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredOrderList.map((order: any) => {
                  const orderId = String(order?.id || order?._id || "");
                  const status = getStatus(order);
                  const payment = paymentBadge(order?.paymentMethod);
                  const items = Array.isArray(order?.items) ? order.items : [];
                  const totalItems = items.reduce((sum: number, item: any) => sum + Number(item?.quantity || 0), 0);
                  const itemPreview = items.slice(0, 3);

                  const nextAction =
                    status === "pending" ? "Confirm order" :
                    status === "confirmed" ? "Start processing" :
                    status === "processing" ? "Choose fulfillment" :
                    status === "ready_for_delivery" ? "Open delivery map" :
                    status === "dispatched" ? "Mark in transit" :
                    status === "in_transit" ? "Mark delivered" :
                    status === "ready_for_pickup" ? "Open pickup" : "View details";

                  return (
                    <article key={orderId} className="p-4 transition hover:bg-slate-50/70 sm:p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={"/farmer/orders/" + orderId} className="font-semibold text-slate-900 hover:text-emerald-700">#{String(order?.orderNumber || orderId).slice(-10)}</Link>
                            <Badge variant="outline" className={cn("border text-[11px]", statusColors[status] || "border-slate-200 bg-slate-50 text-slate-600")}>{statusLabels[status] || status.replace(/_/g, " ")}</Badge>
                            {payment.label && <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", payment.cod ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700")}>{payment.label}</span>}
                            {order?.deliveryType === "pickup" && <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><Store className="h-3 w-3" />Farm pickup</span>}
                            {order?.isBulkOrder && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Bulk</span>}
                          </div>

                          <div className="mt-2 grid gap-1 text-sm text-slate-500 sm:grid-cols-2 lg:grid-cols-4">
                            <span>Customer <strong className="font-medium text-slate-800">{order?.customerName || "Customer"}</strong></span>
                            <span>{formatDate(order?.orderDate || order?.createdAt)}</span>
                            <span>{order?.deliveryType === "pickup" ? (order?.pickupDate ? "Pickup · " + formatDate(order.pickupDate) : "Farm pickup") : (order?.deliveryAddress?.city ? "Delivery · " + order.deliveryAddress.city : "Delivery address")}</span>
                            <span>{totalItems || items.length} item{(totalItems || items.length) === 1 ? "" : "s"}</span>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {itemPreview.map((item: any, index: number) => <span key={index} className="rounded-lg border bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">{item?.quantity || 0} × {item?.productName || "Product"}</span>)}
                            {items.length > 3 && <span className="rounded-lg border bg-white px-2.5 py-1 text-xs font-medium text-slate-500">+{items.length - 3} more</span>}
                          </div>

                          {status === "processing" && (
                            <div className="mt-4 rounded-xl border bg-slate-50 p-3">
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fulfillment</p>
                                  <p className="mt-1 text-sm font-medium text-slate-800">
                                    {order?.fulfillmentRouteSelected === true && Number(order?.fulfillmentRouteVersion || 0) === 1
                                      ? (order?.fulfillmentMethod === "farmer" ? "Farmer fulfillment" : "Warehouse fulfillment")
                                      : "Choose who fulfills this order"}
                                  </p>
                                </div>

                                {order?.fulfillmentRouteSelected !== true || Number(order?.fulfillmentRouteVersion || 0) !== 1 ? (
                                  <div className="flex flex-wrap gap-2">
                                    <Button size="sm" variant="outline" onClick={() => setFulfillmentRoute(orderId, "farmer")}><UserCheck className="mr-1.5 h-4 w-4" />Farmer</Button>
                                    <Button size="sm" variant="outline" onClick={() => setFulfillmentRoute(orderId, "warehouse")}><Store className="mr-1.5 h-4 w-4" />Warehouse</Button>
                                  </div>
                                ) : order?.fulfillmentMethod === "farmer" ? (
                                  <div className="flex flex-wrap gap-2 lg:justify-end">
                                    {(!order?.fulfillmentStage || order.fulfillmentStage === "pending") && <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => finalizeFarmerPacking(order)}><Package className="mr-1.5 h-4 w-4" />Finish packing</Button>}
                                    {order?.fulfillmentStage === "packed" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => updateFulfillmentStage(orderId, "dispatched")}><Navigation className="mr-1.5 h-4 w-4" />Dispatch</Button>}
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-2 lg:justify-end">
                                    {!order?.warehouseCollectionStatus && <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => markWarehouseReadyForPickup(orderId)}><Package className="mr-1.5 h-4 w-4" />Ready for warehouse</Button>}
                                    <span className="rounded-lg border bg-white px-3 py-2 text-xs text-slate-500">Warehouse team continues fulfillment.</span>
                                  </div>
                                )}
                              </div>

                              {order?.fulfillmentMethod === "farmer" && order?.fulfillmentStage && (
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                  {[["pending","Packing"],["packed","Packed"],["dispatched","Dispatched"]].map(([key,label]) => {
                                    const stages = ["pending","packed","dispatched"];
                                    const complete = stages.indexOf(String(order.fulfillmentStage)) >= stages.indexOf(key);
                                    return <span key={key} className={cn("rounded-full border px-2.5 py-1 font-medium", complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400")}>{complete ? "✓ " : ""}{label}</span>;
                                  })}
                                </div>
                              )}

                              {order?.fulfillmentMethod === "warehouse" && (
                                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                                  {[["incoming","Selected"],["pickup_requested","Pickup requested"],["collected","Collected"],["received","Warehouse received"],["ready_for_packing","Ready for packing"],["packed","Packed"],["ready_for_dispatch","Ready for dispatch"],["delivery_decision","Delivery decision"],["dispatched","Dispatched"]].map(([key,label], index) => {
                                    const stages = ["incoming","pickup_requested","collected","received","ready_for_packing","packed","ready_for_dispatch","delivery_decision","dispatched"];
                                    const complete = stages.indexOf(String(order?.warehouseFulfillmentStage || "incoming")) >= index;
                                    return <span key={key} className={cn("rounded-full border px-2 py-1", complete ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-400")}>{complete ? "✓ " : ""}{label}</span>;
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {(order?.selfDelivery || order?.deliveryPartnerId || order?.partnerRequested) && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                              <span className="font-medium text-slate-700">Delivery:</span>
                              {order?.selfDelivery && <span className="inline-flex items-center gap-1"><UserCheck className="h-3.5 w-3.5 text-emerald-600" />Farmer self-delivery</span>}
                              {order?.deliveryPartnerId && <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-blue-600" />{order?.deliveryPartnerName || "Delivery partner assigned"}</span>}
                              {order?.partnerRequested && !order?.deliveryPartnerId && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-amber-600" />Partner request pending</span>}
                            </div>
                          )}
                        </div>

                        <div className="w-full shrink-0 rounded-xl border bg-white p-3 xl:w-[230px]">
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Order total</p><p className="mt-1 text-2xl font-semibold text-emerald-700">{formatPrice(order?.totalAmount || 0)}</p></div>
                            <Badge variant="outline" className="w-fit bg-slate-50 text-[10px]">{nextAction}</Badge>
                          </div>

                          <div className="mt-3 grid gap-2">
                            <Button size="sm" variant="outline" asChild><Link href={"/farmer/orders/" + orderId}><Eye className="mr-1.5 h-4 w-4" />View details</Link></Button>

                            {status === "pending" && (
                              <>
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirmAction({ order, action: "confirmed" })}><CheckCircle className="mr-1.5 h-4 w-4" />Confirm order</Button>
                                <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmAction({ order, action: "cancelled" })}><XCircle className="mr-1.5 h-4 w-4" />Cancel</Button>
                              </>
                            )}

                            {status === "confirmed" && <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => handleUpdateStatus(orderId, "processing")}><Package className="mr-1.5 h-4 w-4" />Start processing</Button>}

                            {status === "ready_for_delivery" && order?.fulfillmentMethod === "farmer" && !order?.selfDelivery && !order?.deliveryPartnerId && !order?.partnerRequested && order?.deliveryType !== "pickup" && (
                              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => router.push("/farmer/order-map?delivery=required&orderId=" + encodeURIComponent(orderId))}><Navigation className="mr-1.5 h-4 w-4" />Open delivery map</Button>
                            )}

                            {status === "ready_for_delivery" && order?.selfDelivery && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleUpdateStatus(orderId, "delivered")}><CheckCircle className="mr-1.5 h-4 w-4" />Mark delivered</Button>}

                            {status === "dispatched" && <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => handleUpdateStatus(orderId, "in_transit")}><Truck className="mr-1.5 h-4 w-4" />Mark in transit</Button>}

                            {status === "in_transit" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleUpdateStatus(orderId, "delivered")}><CheckCircle className="mr-1.5 h-4 w-4" />Mark delivered</Button>}

                            {status === "ready_for_pickup" && <Button size="sm" variant="outline" asChild><Link href={"/farmer/orders/" + orderId}><Store className="mr-1.5 h-4 w-4" />Open pickup</Link></Button>}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

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
