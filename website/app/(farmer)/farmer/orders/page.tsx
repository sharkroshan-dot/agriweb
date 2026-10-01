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
  // Farmer fulfillment is the default selection, so the delivery dropdown
  // is visible immediately on page load. Switching to warehouse hides it.
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

  const handleSelfDeliver = async (orderId: string) => {
    try {
      await api.put(`/orders/${orderId}/self-delivery`);
      toast.success("Order marked for self-delivery");
      refetch();
    } catch (error) {
      toast.error("Failed to mark for self-delivery");
    }
  };

  const handleAssignPartner = async (orderId: string) => {
    try {
      await api.put(`/orders/${orderId}/assign-partner`, {});
      toast.success("Delivery partner assigned");
      refetch();
    } catch (error: any) {
      let msg = "Failed to assign delivery partner";
      try { const j = JSON.parse(error.message); msg = j.detail || j.error?.message || j.message || msg; } catch {}
      toast.error(msg);
    }
  };

  const handleRouteSelfDeliver = async (orders: any[]) => {
    try {
      for (const o of orders) {
        await api.put(`/orders/${o.orderId}/self-delivery`);
      }
      toast.success(`Marked ${orders.length} orders for self-delivery`);
      refetch();
    } catch (error) {
      toast.error("Failed to mark some orders for self-delivery");
    }
  };

  const handleRouteAssignPartner = async (orders: any[]) => {
    try {
      for (const o of orders) {
        await api.put(`/orders/${o.orderId}/assign-partner`);
      }
      toast.success(`Assigned partners for ${orders.length} orders`);
      refetch();
    } catch (error) {
      toast.error("Failed to assign partners for some orders");
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

  const setDeliveryResponsibility = async (orderId: string, responsibility: "farmer" | "delivery_partner") => {
    try {
      await api.put("/orders/" + orderId + "/delivery-responsibility", {
        deliveryResponsibility: responsibility,
      });
      toast.success(
        responsibility === "farmer"
          ? "Farmer will deliver this order"
          : "Delivery partner will collect the order from the farm",
      );
      refetch();
    } catch (error: any) {
      let msg = "Failed to select delivery responsibility";
      try {
        const j = JSON.parse(error.message);
        msg = j.detail || j.error?.message || j.message || msg;
      } catch {}
      toast.error(msg);
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

      <Card className="overflow-hidden border shadow-sm">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-semibold">Order Workflow</h2>
              <p className="text-xs text-muted-foreground">Each action advances one workflow stage. Use individual order actions or bulk actions for eligible orders.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => handleBulkWorkflowAction("confirm")}>Confirm All Eligible</Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkWorkflowAction("process")}>Process All</Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkWorkflowAction("farmer_fulfillment")}>Farmer Fulfillment All</Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkWorkflowAction("warehouse_fulfillment")}>Warehouse Fulfillment All</Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkWorkflowAction("pack")}>Pack All Farmer Orders</Button>
              <Button size="sm" variant="outline" onClick={() => handleBulkWorkflowAction("dispatch")}>Dispatch All Farmer Orders</Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Pending", orderList.filter((o:any) => getStatus(o) === "pending").length],
              ["Confirmed", orderList.filter((o:any) => getStatus(o) === "confirmed").length],
              ["Processing", orderList.filter((o:any) => getStatus(o) === "processing").length],
              ["Packed", orderList.filter((o:any) => o.fulfillmentMethod === "farmer" && o.fulfillmentStage === "packed").length],
              ["Dispatched", orderList.filter((o:any) => o.fulfillmentStage === "dispatched" || getStatus(o) === "ready_for_delivery").length],
              ["Warehouse", orderList.filter((o:any) => o.fulfillmentMethod === "warehouse" && !["delivered","cancelled"].includes(getStatus(o))).length],
            ].map(([label,value]) => (
              <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

        <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <CheckCircle className="h-4 w-4"/>
                </span>
                <div>
                  <h2 className="font-semibold">Ready to process</h2>
                  <p className="text-xs text-muted-foreground">Only orders with sufficient stock will move forward. Farmer delivery can be chosen now or later from Order Map.</p>
                </div>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
              <Select value={overallFulfillmentMethod} onValueChange={(v: "farmer" | "warehouse") => {
                setOverallFulfillmentMethod(v);
                if (v === "warehouse") setOverallDeliveryResponsibility("");
              }}>
                <SelectTrigger className="w-full bg-white sm:w-[210px]">
                  <SelectValue placeholder="Choose fulfillment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="farmer">Farmer Fulfillment</SelectItem>
                  <SelectItem value="warehouse">Warehouse Fulfillment</SelectItem>
                </SelectContent>
              </Select>
              {overallFulfillmentMethod === "farmer" && (
                <Select
                  value={overallDeliveryResponsibility}
                  onValueChange={(v: "none" | "farmer" | "delivery_partner") =>
                    setOverallDeliveryResponsibility(v)
                  }
                >
                  <SelectTrigger className="w-full bg-white sm:w-[210px]">
                    <SelectValue placeholder="Choose delivery" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="farmer">Farmer Delivery</SelectItem>
                    <SelectItem value="delivery_partner">Delivery Partner</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button
              onClick={handleProcessAvailableOrders}
              size="default"
              disabled={
                availabilityQuery.isLoading ||
                !availabilityQuery.data ||
                !overallFulfillmentMethod
              }
              className="shrink-0"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Confirm & Process Available Orders
            </Button>
          </div>

          {availabilityQuery.isLoading ? (
            <div className="h-28 animate-pulse rounded-lg bg-white" />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-muted-foreground">Orders received</p>
                  <p className="text-2xl font-bold">{availabilityQuery.data?.data?.receivedOrders ?? 0}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-muted-foreground">Can be fulfilled</p>
                  <p className="text-2xl font-bold text-emerald-600">{availabilityQuery.data?.data?.fulfillableOrders ?? 0}</p>
                </div>
                <div className="rounded-lg border bg-white p-3">
                  <p className="text-xs text-muted-foreground">Waiting for stock</p>
                  <p className="text-2xl font-bold text-amber-600">{availabilityQuery.data?.data?.blockedOrders ?? 0}</p>
                </div>
              </div>

              <div className="space-y-2">
                {(availabilityQuery.data?.data?.products || []).map((product: any) => (
                  <div key={product.productId} className="rounded-lg border bg-white p-3.5 shadow-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{product.productName}</p>
                        <p className="text-sm text-muted-foreground">
                          {product.orderCount} customer order{product.orderCount === 1 ? "" : "s"} · Required {Number(product.requestedQuantity || 0).toLocaleString()} {product.unit}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-sm">
                          Available: <span className="font-semibold">{Number(product.availableQuantity || 0).toLocaleString()} {product.unit}</span>
                        </p>
                        <p className={cn(
                          "text-xs font-medium",
                          Number(product.shortageQuantity || 0) > 0 ? "text-amber-600" : "text-emerald-600"
                        )}>
                          {Number(product.shortageQuantity || 0) > 0
                            ? `Shortage ${Number(product.shortageQuantity).toLocaleString()} ${product.unit}`
                            : "Sufficient product available"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {(availabilityQuery.data?.data?.products || []).length === 0 && (
                  <p className="rounded-lg border border-dashed bg-white p-4 text-sm text-muted-foreground">
                    No pending customer orders require confirmation.
                  </p>
                )}
              </div>
            </div>
          )}
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
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          
                          onClick={() => handleRouteSelfDeliver(route.orders)}
                        >
                          <UserCheck className="mr-1 h-3 w-3" /> Deliver Myself
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRouteAssignPartner(route.orders)}
                        >
                          <Truck className="mr-1 h-3 w-3" /> Assign Partner
                        </Button>
                      </div>
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

      {showMapView && (() => {
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
            {(activeCity === null ? groupEntries : groupEntries.filter(([city]) => city === activeCity)).map(([city, orders]) => (
              <div key={city} className="space-y-4">
                {orders.map((order: any) => (
                  <Card key={order.id || order._id}>
                    <CardContent className="p-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/farmer/orders/${order.id || order._id}`} className="font-medium hover:text-emerald-600">{order.orderNumber || order.id || order._id}</Link>
                            <Badge variant="outline" className={cn("border", statusColors[getStatus(order)] || "bg-gray-500/10 text-gray-600 border-gray-500/20")}>{statusLabels[getStatus(order)] || getStatus(order)}</Badge>
                            {order.paymentStatus === "paid" && <Badge variant="success">Paid</Badge>}
                            {order.isBulkOrder && (
                              <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700"><ShoppingBag className="mr-1 h-3 w-3" /> Bulk</Badge>
                            )}
                            {order.selfDelivery && (
                              <Badge variant="outline" className="border-purple-300 bg-purple-50 text-purple-700"><UserCheck className="mr-1 h-3 w-3" /> Self-Delivery</Badge>
                            )}
                            {(order.deliveryPartnerId || order.partnerRequested) && (
                              <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-indigo-700"><Truck className="mr-1 h-3 w-3" /> Delivery Partner</Badge>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                            <span>Customer: <span className="font-medium text-foreground">{order.customerName}</span></span>
                            <span>•</span>
                            <span>Ordered: {formatDate(order.orderDate)}</span>
                            <span>•</span>
                            <span>{(order.items || []).length} items</span>
                            {order.deliveryAddress?.city && (
                              <><span>•</span><span>Deliver to: <span className="font-medium text-foreground">{order.deliveryAddress.city}</span></span></>
                            )}
                            {order.deliveryPartnerId && order.deliveryPartnerName && (
                              <><span>•</span><span>Partner: <span className="font-medium text-indigo-600">{order.deliveryPartnerName}</span></span></>
                            )}
                            {order.pickedBy && (
                              <><span>•</span><span>Picked by: <span className="font-medium text-emerald-600">{order.pickedBy}</span></span></>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {(order.items || []).slice(0,3).map((item:any, idx:number)=> (<Badge key={idx} variant="outline" className="text-xs">{item.quantity}x {item.productName}</Badge>))}
                            {(order.items || []).length > 3 && (<Badge variant="outline" className="text-xs">+{(order.items || []).length - 3} more</Badge>)}
                          </div>
                        </div>
                        <div className="flex flex-col items-stretch gap-3 lg:min-w-[180px] lg:items-end">
                          <div className="text-right shrink-0">
  <p className="text-lg font-bold text-emerald-600">{formatPrice(order.totalAmount)}</p>
  {paymentBadge(order.paymentMethod).label && (
    <span className={cn("mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold border", paymentBadge(order.paymentMethod).cod ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "bg-blue-500/10 text-blue-600 border-blue-500/20")}>
      {paymentBadge(order.paymentMethod).label}
    </span>
  )}
</div>
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:grid-cols-1">
                            <Button size="sm" variant="outline" asChild className="w-full">
                              <Link href={`/farmer/orders/${order.id || order._id}`}><Eye className="mr-1.5 h-3.5 w-3.5"/>View</Link>
                            </Button>
                            {getStatus(order) === "pending" && (
                              <>
                                <Button size="sm"  onClick={() => setConfirmAction({ order, action: 'confirmed' })}>
                                  <CheckCircle className="mr-1.5 h-3.5 w-3.5"/>Confirm
                                </Button>
                                <Button size="sm" variant="destructive" className="w-full" onClick={() => setConfirmAction({ order, action: 'cancelled' })}>
                                  <XCircle className="mr-1.5 h-3.5 w-3.5"/>Cancel
                                </Button>
                              </>
                            )}
                            {getStatus(order) === "confirmed" && (
                              <>
                                <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => handleUpdateStatus(order.id || order._id, 'processing')}>
                                  <Package className="mr-1.5 h-3.5 w-3.5"/>Process
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => setConfirmAction({ order, action: 'cancelled' })}>
                                  <XCircle className="mr-1.5 h-3.5 w-3.5"/>Cancel
                                </Button>
                              </>
                            )}
                            {getStatus(order) === "processing" && (
                              <div className="flex flex-col gap-2">
                                {order.fulfillmentRouteSelected !== true || Number(order.fulfillmentRouteVersion || 0) !== 1 ? (
                                  <>
                                    <span className="text-xs font-medium text-muted-foreground">Fulfillment route</span>
                                    <div className="flex flex-wrap gap-1.5">
                                      <Button size="sm" variant="outline" className="justify-start" onClick={() => setFulfillmentRoute(order.id || order._id, "farmer")}>
                                        <UserCheck className="mr-1.5 h-3.5 w-3.5"/>Farmer Fulfillment
                                      </Button>
                                      <Button size="sm" variant="outline" onClick={() => setFulfillmentRoute(order.id || order._id, "warehouse")}>
                                        <Store className="mr-1.5 h-3.5 w-3.5"/>Warehouse Fulfillment
                                      </Button>
                                    </div>
                                  </>
                                ) : order.fulfillmentMethod === "farmer" ? (
                                  <>
                                    {(!order.fulfillmentStage || order.fulfillmentStage === "pending" || order.fulfillmentStage === "picked") && <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => updateFulfillmentStage(order.id || order._id, "packed")}><Package className="mr-1.5 h-3.5 w-3.5"/>Pack</Button>}
                                    {order.fulfillmentStage === "packed" && <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => updateFulfillmentStage(order.id || order._id, "dispatched")}><Navigation className="mr-1.5 h-3.5 w-3.5"/>Dispatch</Button>}
                                  </>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Warehouse will Receive → Check → Store → Pick → Pack → Dispatch.</span>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  Distance: {Number(order.deliveryDetails?.distanceKm || 0).toFixed(1)} km
                                </span>
                              </div>
                            )}

                            {getStatus(order) === "ready_for_delivery" && !order.selfDelivery && !order.deliveryPartnerId && !order.partnerRequested && (
                              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => router.push(`/farmer/order-map?delivery=required&orderId=${encodeURIComponent(order.id || order._id)}`)}>
                                <Navigation className="mr-1.5 h-3.5 w-3.5"/>Open Order Map
                              </Button>
                            )}
                            {getStatus(order) === "ready_for_delivery" && order.deliveryType !== "pickup" && (order.selfDelivery || order.deliveryPartnerId || order.partnerRequested) && (
                              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => handleUpdateStatus(order.id || order._id, 'dispatched')}>
                                <Navigation className="mr-1.5 h-3.5 w-3.5"/>Dispatch
                              </Button>
                            )}
                            {getStatus(order) === "dispatched" && !order.selfDelivery && !order.deliveryPartnerId && (
                              <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={() => handleUpdateStatus(order.id || order._id, 'in_transit')}>
                                <Truck className="mr-1.5 h-3.5 w-3.5"/>In Transit
                              </Button>
                            )}
                            {getStatus(order) === "dispatched" && (order.selfDelivery || order.deliveryPartnerId) && (
                              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => handleUpdateStatus(order.id || order._id, 'in_transit')}>
                                <Truck className="mr-1.5 h-3.5 w-3.5"/>In Transit
                              </Button>
                            )}
                            {getStatus(order) === "in_transit" && (
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleUpdateStatus(order.id || order._id, 'delivered')}>
                                <CheckCircle className="mr-1.5 h-3.5 w-3.5"/>Delivered
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ))}
          </div>
        );
      })()}

      {!showMapView && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Customer Orders</h2>
              <p className="text-sm text-muted-foreground">Review each order and complete the next required step.</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-slate-50 px-3 py-1">{filteredOrderList?.length || 0} orders</Badge>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[170px] bg-white"><SelectValue placeholder="Filter status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="ready_for_delivery">Ready for Delivery</SelectItem>
                  <SelectItem value="dispatched">Dispatched</SelectItem>
                  <SelectItem value="in_transit">In Transit</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {!filteredOrderList || filteredOrderList.length === 0 ? (
            <Card className="border-dashed shadow-none">
              <CardContent className="flex flex-col items-center justify-center px-6 py-14 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100"><Package className="h-7 w-7 text-slate-400" /></div>
                <h3 className="mt-4 text-base font-semibold">No orders found</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{statusFilter !== "all" ? "There are no " + (statusLabels[statusFilter] || statusFilter) + " orders right now." : "New customer orders will appear here."}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredOrderList.map((order: any) => {
                const orderId = order.id || order._id;
                const status = getStatus(order);
                const payment = paymentBadge(order.paymentMethod);
                const itemCount = (order.items || []).length;
                return (
                  <Card key={orderId} className="overflow-hidden border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="p-0">
                      <div className="flex flex-col lg:flex-row">
                        <div className="min-w-0 flex-1 p-4 sm:p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Link href={"/farmer/orders/" + orderId} className="text-sm font-semibold text-slate-900 hover:text-emerald-700">#{order.orderNumber || String(orderId).slice(-8)}</Link>
                                <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-xs", statusColors[status] || "bg-slate-50 text-slate-600 border-slate-200")}>{statusLabels[status] || status}</Badge>
                                {order.paymentStatus === "paid" && <Badge variant="success" className="rounded-full px-2.5 py-0.5 text-xs">Paid</Badge>}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{formatDate(order.orderDate)}</p>
                            </div>
                            <div className="text-left sm:text-right">
                              <p className="text-lg font-bold tracking-tight text-slate-900">{formatPrice(order.totalAmount)}</p>
                              {payment.label && <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", payment.cod ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700")}>{payment.label}</span>}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Customer</p><p className="mt-1 truncate text-sm font-medium text-slate-900">{order.customerName || "Customer"}</p></div>
                            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Items</p><p className="mt-1 text-sm font-medium text-slate-900">{itemCount} item{itemCount === 1 ? "" : "s"}</p></div>
                            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Delivery</p><p className="mt-1 truncate text-sm font-medium text-slate-900">{order.deliveryAddress?.city || "Home delivery"}</p></div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {(order.items || []).slice(0, 2).map((item: any, idx: number) => <span key={idx} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">{item.productName} · {item.quantity}</span>)}
                            {itemCount > 2 && <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">+{itemCount - 2} more</span>}
                          </div>
                        </div>

                        <div className="border-t bg-slate-50/70 p-4 lg:w-[280px] lg:border-l lg:border-t-0 sm:p-5">
                          <div className="mb-3 flex items-center justify-between">
                            <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Next action</p><p className="mt-0.5 text-sm font-medium text-slate-900">{status === "pending" ? "Review order" : status === "confirmed" ? "Start processing" : status === "processing" ? "Complete fulfillment" : status === "ready_for_delivery" ? "Arrange delivery" : status === "dispatched" ? "Track delivery" : status === "in_transit" ? "Complete delivery" : "View order"}</p></div>
                            <Link href={"/farmer/orders/" + orderId} className="text-xs font-medium text-emerald-700 hover:underline">Details</Link>
                          </div>

                          <div className="space-y-2">
                            {status === "pending" && <>
                              <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirmAction({ order, action: "confirmed" })}><CheckCircle className="mr-2 h-4 w-4" />Confirm Order</Button>
                              <Button variant="outline" className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmAction({ order, action: "cancelled" })}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>
                            </>}
                            {status === "confirmed" && <>
                              <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => handleUpdateStatus(orderId, "processing")}><Package className="mr-2 h-4 w-4" />Start Processing</Button>
                              <Button variant="outline" className="w-full border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmAction({ order, action: "cancelled" })}><XCircle className="mr-2 h-4 w-4" />Cancel Order</Button>
                            </>}
                            {status === "processing" && order.deliveryType !== "pickup" && (
                              order.fulfillmentRouteSelected !== true || Number(order.fulfillmentRouteVersion || 0) !== 1 ? (
                                <div className="space-y-2"><p className="text-xs font-medium text-slate-600">Choose fulfillment</p><div className="grid gap-2">
                                  <Button size="sm" variant="outline" className="justify-start bg-white" onClick={() => setFulfillmentRoute(orderId, "farmer")}><UserCheck className="mr-2 h-4 w-4 text-emerald-600" />Farmer Fulfillment</Button>
                                  <Button size="sm" variant="outline" className="justify-start bg-white" onClick={() => setFulfillmentRoute(orderId, "warehouse")}><Store className="mr-2 h-4 w-4 text-blue-600" />Warehouse Fulfillment</Button>
                                </div></div>
                              ) : order.fulfillmentMethod === "farmer" ? (
                                <div className="space-y-2">
                                  {!order.deliveryResponsibility && <div className="space-y-2"><p className="text-xs font-medium text-slate-600">Choose delivery</p><div className="grid gap-2"><Button size="sm" variant="outline" className="justify-start bg-white" onClick={() => setDeliveryResponsibility(orderId, "farmer")}><UserCheck className="mr-2 h-4 w-4 text-purple-600" />Farmer Delivery</Button><Button size="sm" variant="outline" className="justify-start bg-white" onClick={() => setDeliveryResponsibility(orderId, "delivery_partner")}><Truck className="mr-2 h-4 w-4 text-indigo-600" />Delivery Partner</Button></div></div>}
                                  {order.deliveryResponsibility && (!order.fulfillmentStage || order.fulfillmentStage === "pending") && <Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => updateFulfillmentStage(orderId, "picked")}><Package className="mr-2 h-4 w-4" />Mark Picked</Button>}
                                  {order.fulfillmentStage === "picked" && <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => updateFulfillmentStage(orderId, "packed")}><Package className="mr-2 h-4 w-4" />Mark Packed</Button>}
                                  {order.fulfillmentStage === "packed" && <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => updateFulfillmentStage(orderId, "dispatched")}><Navigation className="mr-2 h-4 w-4" />Dispatch Order</Button>}
                                  {order.fulfillmentStage === "dispatched" && !order.deliveryPartnerId && <p className="rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-800">Order dispatched. Choose Deliver Myself or Delivery Partner in Order Map.</p>}
                                </div>
                              ) : <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800"><strong>Warehouse fulfillment</strong><br />Receive → Check → Store → Pick → Pack → Dispatch → Delivery</div>
                            )}
                            {status === "ready_for_delivery" && !order.selfDelivery && !order.deliveryPartnerId && !order.partnerRequested && order.deliveryType !== "pickup" && (order.fulfillmentMethod === "warehouse" || order.deliveryResponsibility === "delivery_partner" ? <Button size="sm" className="w-full bg-indigo-600 hover:bg-indigo-700" onClick={() => handleAssignPartner(orderId)}><Truck className="mr-2 h-4 w-4" />Assign Delivery Partner</Button> : order.deliveryResponsibility === "farmer" ? <Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => handleSelfDeliver(orderId)}><UserCheck className="mr-2 h-4 w-4" />Deliver Myself</Button> : null)}
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
          )}
        </section>
      )}
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
