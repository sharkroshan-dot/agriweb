"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart, Clock, CheckCircle, XCircle, Truck, Package, Eye, MoreVertical, RefreshCw, Store, ShoppingBag, UserCheck, Navigation, X, User, Star, Phone, Map as MapIcon } from "lucide-react";
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
  const [typeFilter, setTypeFilter] = useState<string>("all");
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

  const getStatus = (order: any) => (order.status || order.orderStatus || "pending").toLowerCase();

  const orderList = orders?.data?.orders || orders?.orders || (Array.isArray(orders) ? orders : []);

  const filteredOrderList = useMemo(() => {
    if (typeFilter === "all") return orderList;
    const isPickupTab = typeFilter === "pickup";
    return orderList.filter(
      (o: any) => ((o.deliveryType || "").toLowerCase() === "pickup") === isPickupTab
    );
  }, [orderList, typeFilter]);

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

  const pendingCount = orderList.filter((o: any) => getStatus(o) === "pending").length;
  const inTransitCount = orderList.filter((o: any) => getStatus(o) === "in_transit").length;
  const deliveredCount = orderList.filter((o: any) => getStatus(o) === "delivered").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Orders</h1>
          <p className="text-gray-500">Manage your orders ({orderList.length})</p>
        </div>
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
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Filter by status"/></SelectTrigger>
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
          <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4"/></Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {[
          { value: "all", label: "All", icon: ShoppingBag, pill: "bg-emerald-100 text-emerald-700" },
          { value: "delivery", label: "Delivery", icon: Truck, pill: "bg-blue-100 text-blue-700" },
          { value: "pickup", label: "Farm Pickup", icon: Store, pill: "bg-amber-100 text-amber-700" },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setTypeFilter(tab.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
              typeFilter === tab.value
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <tab.icon className="h-4 w-4" />
            <span>{tab.label}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tab.pill)}>
              {tab.value === "all"
                ? orderList.length
                : orderList.filter((o: any) => ((o.deliveryType || "").toLowerCase() === "pickup") === (tab.value === "pickup")).length}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Total Orders", value: orderList.length, icon: ShoppingCart, color: "text-blue-600" },
          { label: "Pending", value: pendingCount, icon: Clock, color: "text-yellow-600" },
          { label: "In Transit", value: inTransitCount, icon: Truck, color: "text-purple-600" },
          { label: "Delivered", value: deliveredCount, icon: CheckCircle, color: "text-green-600" }
        ].map((stat, index) => (
          <Card key={index}><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-500">{stat.label}</p><p className="text-2xl font-bold">{stat.value}</p></div><stat.icon className={cn("h-8 w-8", stat.color)} /></div></CardContent></Card>
        ))}
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
                          className="bg-emerald-600 hover:bg-emerald-700"
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
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <Link href={`/farmer/orders/${order.id || order._id}`} className="font-medium hover:text-emerald-600">{order.orderNumber || order.id || order._id}</Link>
                            <Badge variant="outline" className={cn("border", statusColors[getStatus(order)] || "bg-gray-500/10 text-gray-600 border-gray-500/20")}>{statusLabels[getStatus(order)] || getStatus(order)}</Badge>
                            {order.paymentStatus === "paid" && <Badge variant="success">Paid</Badge>}
                            {order.deliveryType === "pickup" && (
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700"><Store className="mr-1 h-3 w-3" /> Pickup</Badge>
                            )}
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
                          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                            <span>Customer: <span className="font-medium text-foreground">{order.customerName}</span></span>
                            <span>•</span>
                            <span>Ordered: {formatDate(order.orderDate)}</span>
                            <span>•</span>
                            <span>{(order.items || []).length} items</span>
                            {order.deliveryType !== "pickup" && order.deliveryAddress?.city && (
                              <><span>•</span><span>Deliver to: <span className="font-medium text-foreground">{order.deliveryAddress.city}</span></span></>
                            )}
                            {order.deliveryType === "pickup" && order.pickupDate && (
                              <><span>•</span><span>Pickup: {formatDate(order.pickupDate)}</span></>
                            )}
                            {order.deliveryPartnerId && order.deliveryPartnerName && (
                              <><span>•</span><span>Partner: <span className="font-medium text-indigo-600">{order.deliveryPartnerName}</span></span></>
                            )}
                            {order.pickedBy && (
                              <><span>•</span><span>Picked by: <span className="font-medium text-emerald-600">{order.pickedBy}</span></span></>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(order.items || []).slice(0,3).map((item:any, idx:number)=> (<Badge key={idx} variant="outline" className="text-xs">{item.quantity}x {item.productName}</Badge>))}
                            {(order.items || []).length > 3 && (<Badge variant="outline" className="text-xs">+{(order.items || []).length - 3} more</Badge>)}
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="text-right shrink-0">
  <p className="text-lg font-bold text-emerald-600">{formatPrice(order.totalAmount)}</p>
  {paymentBadge(order.paymentMethod).label && (
    <span className={cn("mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold border", paymentBadge(order.paymentMethod).cod ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "bg-blue-500/10 text-blue-600 border-blue-500/20")}>
      {paymentBadge(order.paymentMethod).label}
    </span>
  )}
</div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/farmer/orders/${order.id || order._id}`}><Eye className="mr-1.5 h-3.5 w-3.5"/>View</Link>
                            </Button>
                            {getStatus(order) === "pending" && (
                              <>
                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirmAction({ order, action: 'confirmed' })}>
                                  <CheckCircle className="mr-1.5 h-3.5 w-3.5"/>Confirm
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => setConfirmAction({ order, action: 'cancelled' })}>
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
                            {getStatus(order) === "processing" && order.deliveryType !== "pickup" && (
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleUpdateStatus(order.id || order._id, 'ready_for_delivery')}>
                                <Truck className="mr-1.5 h-3.5 w-3.5"/>Ready
                              </Button>
                            )}
                            {getStatus(order) === "processing" && order.deliveryType === "pickup" && (
                              <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => handleUpdateStatus(order.id || order._id, 'ready_for_pickup')}>
                                <Store className="mr-1.5 h-3.5 w-3.5"/>Pickup Ready
                              </Button>
                            )}
                            {getStatus(order) === "ready_for_delivery" && !order.selfDelivery && !order.deliveryPartnerId && !order.partnerRequested && order.deliveryType !== "pickup" && (
                              <>
                                <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => handleSelfDeliver(order.id || order._id)}>
                                  <UserCheck className="mr-1.5 h-3.5 w-3.5"/>Deliver Myself
                                </Button>
                                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => handleAssignPartner(order)}>
                                  <Truck className="mr-1.5 h-3.5 w-3.5"/>Assign Partner
                                </Button>
                              </>
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
                            {getStatus(order) === "ready_for_pickup" && (
                              <Link href={`/farmer/orders/${order.id || order._id}`}>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700">
                                  <ShoppingBag className="mr-1.5 h-3.5 w-3.5"/>Confirm Pickup
                                </Button>
                              </Link>
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

      {!showMapView && (!filteredOrderList || filteredOrderList.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold">No orders found</h3>
          <p className="mt-2 text-gray-500">
            {typeFilter !== "all"
              ? `No ${typeFilter === "pickup" ? "farm pickup" : "delivery"} orders`
              : statusFilter !== "all"
                ? `No ${statusLabels[statusFilter]} orders`
                : "You haven't received any orders yet"}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredOrderList.map((order: any) => (
            <Card key={order.id || order._id}>
              <CardContent className="p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/farmer/orders/${order.id || order._id}`} className="font-medium hover:text-emerald-600">{order.orderNumber || order.id || order._id}</Link>
                      <Badge variant="outline" className={cn("border", statusColors[getStatus(order)] || "bg-gray-500/10 text-gray-600 border-gray-500/20")}>{statusLabels[getStatus(order)] || getStatus(order)}</Badge>
                      {order.paymentStatus === "paid" && <Badge variant="success">Paid</Badge>}
                      {order.deliveryType === "pickup" && (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                          <Store className="mr-1 h-3 w-3" /> Pickup
                        </Badge>
                      )}
                      {order.isBulkOrder && (
                        <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">
                          <ShoppingBag className="mr-1 h-3 w-3" /> Bulk
                        </Badge>
                      )}
                      {order.selfDelivery && (
                        <Badge variant="outline" className="border-purple-300 bg-purple-50 text-purple-700">
                          <UserCheck className="mr-1 h-3 w-3" /> Self-Delivery
                        </Badge>
                      )}
                      {(order.deliveryPartnerId || order.partnerRequested) && (
                        <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-indigo-700">
                          <Truck className="mr-1 h-3 w-3" /> Delivery Partner
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-500">
                      <span>Customer: <span className="font-medium text-foreground">{order.customerName}</span></span>
                      <span>•</span>
                      <span>Ordered: {formatDate(order.orderDate)}</span>
                      <span>•</span>
                      <span>{(order.items || []).length} items</span>
                      {order.deliveryType !== "pickup" && order.deliveryAddress?.city && (
                        <>
                          <span>•</span>
                          <span>Deliver to: <span className="font-medium text-foreground">{order.deliveryAddress.city}</span></span>
                        </>
                      )}
                      {order.deliveryType === "pickup" && order.pickupDate && (
                        <>
                          <span>•</span>
                          <span>Pickup: {formatDate(order.pickupDate)}</span>
                        </>
                      )}
                      {order.deliveryPartnerId && order.deliveryPartnerName && (
                        <>
                          <span>•</span>
                          <span>Partner: <span className="font-medium text-indigo-600">{order.deliveryPartnerName}</span></span>
                        </>
                      )}
                      {order.pickedBy && (
                        <>
                          <span>•</span>
                          <span>Picked by: <span className="font-medium text-emerald-600">{order.pickedBy}</span></span>
                        </>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(order.items || []).slice(0,3).map((item:any, idx:number)=> (<Badge key={idx} variant="outline" className="text-xs">{item.quantity}x {item.productName}</Badge>))}
                      {(order.items || []).length > 3 && (<Badge variant="outline" className="text-xs">+{(order.items || []).length - 3} more</Badge>)}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="text-right shrink-0">
  <p className="text-lg font-bold text-emerald-600">{formatPrice(order.totalAmount)}</p>
  {paymentBadge(order.paymentMethod).label && (
    <span className={cn("mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold border", paymentBadge(order.paymentMethod).cod ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "bg-blue-500/10 text-blue-600 border-blue-500/20")}>
      {paymentBadge(order.paymentMethod).label}
    </span>
  )}
</div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/farmer/orders/${order.id || order._id}`}><Eye className="mr-1.5 h-3.5 w-3.5"/>View</Link>
                      </Button>
                      {getStatus(order) === "pending" && (
                        <>
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setConfirmAction({ order, action: 'confirmed' })}>
                            <CheckCircle className="mr-1.5 h-3.5 w-3.5"/>Confirm
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setConfirmAction({ order, action: 'cancelled' })}>
                            <XCircle className="mr-1.5 h-3.5 w-3.5"/>Cancel
                          </Button>
                        </>
                      )}
                      {getStatus(order) === "confirmed" && (
                        <>
                          <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => handleUpdateStatus(order.id || order._id, 'processing')}>
                            <Clock className="mr-1.5 h-3.5 w-3.5"/>Process
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => setConfirmAction({ order, action: 'cancelled' })}>
                            <XCircle className="mr-1.5 h-3.5 w-3.5"/>Cancel
                          </Button>
                        </>
                      )}
                      {getStatus(order) === "processing" && order.deliveryType !== "pickup" && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleUpdateStatus(order.id || order._id, 'ready_for_delivery')}>
                          <Truck className="mr-1.5 h-3.5 w-3.5"/>Ready
                        </Button>
                      )}
                      {getStatus(order) === "processing" && order.deliveryType === "pickup" && (
                        <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => handleUpdateStatus(order.id || order._id, 'ready_for_pickup')}>
                          <Store className="mr-1.5 h-3.5 w-3.5"/>Pickup Ready
                        </Button>
                      )}
                      {getStatus(order) === "ready_for_delivery" && !order.selfDelivery && !order.deliveryPartnerId && !order.partnerRequested && order.deliveryType !== "pickup" && (
                        <>
                          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" onClick={() => handleSelfDeliver(order.id || order._id)}>
                            <UserCheck className="mr-1.5 h-3.5 w-3.5"/>Deliver Myself
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleAssignPartner(order.id || order._id)}>
                            <Truck className="mr-1.5 h-3.5 w-3.5"/>Assign Partner
                          </Button>
                        </>
                      )}
                      {getStatus(order) === "ready_for_delivery" && order.selfDelivery && (
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
