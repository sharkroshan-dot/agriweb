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

  const orderList = Array.isArray(orders?.data)
    ? orders.data
    : orders?.data?.orders || orders?.orders || (Array.isArray(orders) ? orders : []);

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
                <span className="text-xs text-muted-foreground">Advances each eligible order to its next valid stage.</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Overall Processing works progressively: each order advances only as far as its current workflow allows. Manual decisions such as fulfillment selection and delivery routing remain on the individual order.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">Pending → Confirmed</Badge>
            <span>→</span>
            <Badge variant="outline">Processing</Badge>
            <span>→</span>
            <Badge variant="outline">Choose Fulfillment</Badge>
            <span>→</span>
            <Badge variant="outline">Pack → Dispatch</Badge>
            <span>→</span>
            <Badge variant="outline">Delivery Decision</Badge>
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
            {(activeCity === null ? groupEntries : groupEntries.filter(([city]) => city === activeCity)).map(([city, orders]) => (
              <div key={city} className="space-y-4">
                {orders.map((order: any) => {
                  const orderId = String(order.id || order._id || "");
                  const status = getStatus(order);
                  return (
                  <Card key={orderId}>
                    <CardContent className="p-5 sm:p-6">
                      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
                        <div className="min-w-0 lg:col-span-2">
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
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {(order.items || []).slice(0,3).map((item:any, idx:number)=> (<Badge key={idx} variant="outline" className="text-xs">{item.quantity}x {item.productName}</Badge>))}
                            {(order.items || []).length > 3 && (<Badge variant="outline" className="text-xs">+{(order.items || []).length - 3} more</Badge>)}
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 rounded-xl border bg-slate-50/70 p-4 lg:col-span-1 lg:border-l lg:border-t-0 lg:rounded-l-none lg:bg-transparent lg:pl-5">
                          <div className="flex items-center justify-between gap-3 border-b pb-3 lg:block">
  <div><p className="text-lg font-bold text-emerald-600">{formatPrice(order.totalAmount)}</p>
  {paymentBadge(order.paymentMethod).label && (
    <span className={cn("mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold border", paymentBadge(order.paymentMethod).cod ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "bg-blue-500/10 text-blue-600 border-blue-500/20")}>
      {paymentBadge(order.paymentMethod).label}
    </span>
  )}
                          </div>
</div>
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:grid-cols-1">
                            <Button size="sm" variant="outline" asChild className="w-full">
                              <Link href={`/farmer/orders/${order.id || order._id}`}><Eye className="mr-1.5 h-3.5 w-3.5"/>View</Link>
                            </Button>
                            <p className="col-span-2 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:col-span-1">Manual processing</p>
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
                                  <div className="space-y-2">
                                    {(!order.fulfillmentStage || order.fulfillmentStage === "pending") && (
                                      <div className="space-y-2">
                                        <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => finalizeFarmerPacking(order)}>
                                          <Package className="mr-2 h-4 w-4" />Finish Packing & Check Shortage
                                        </Button>
                                        <p className="text-[11px] text-muted-foreground">After packing all products, enter the actual packed quantity. Any unavailable quantity is cancelled and the final amount is recalculated.</p>
                                      </div>
                                    )}
                                    {order.fulfillmentStage === "packed" && (
                                      <div className="space-y-2">
                                        <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => updateFulfillmentStage(orderId, "dispatched")}>
                                          <Navigation className="mr-2 h-4 w-4" />Dispatch Order
                                        </Button>
                                        <p className="text-[11px] text-muted-foreground">After dispatch, choose the delivery route on the Order Map.</p>
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
            ))}
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
