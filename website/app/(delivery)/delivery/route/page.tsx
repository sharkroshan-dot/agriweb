"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle, Clock, MapPin, MessageSquare, Navigation, Pause, Phone, RefreshCw, Route, Truck, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Map } from "../../../components/shared/map";
import { LiveChatDialog } from "../../../components/delivery/live-chat-dialog";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { formatTime } from "../../../lib/utils";
import toast from "react-hot-toast";

function DeliveryPriorityBadge({ delivery, compact = false }: { delivery?: any; compact?: boolean }) {
  const priority = String(delivery?.priority || delivery?.deliveryPriority || delivery?.order?.priority || "normal").toLowerCase();
  const label = priority === "urgent" || priority === "high" ? "High Priority" : priority === "medium" ? "Medium Priority" : "Normal Priority";
  return <Badge variant={priority === "urgent" || priority === "high" ? "destructive" : priority === "medium" ? "warning" : "secondary"} className={compact ? "text-[10px]" : undefined}>{label}</Badge>;
}

const ACTIVE_STATUSES = ["in_transit", "ready_for_delivery", "picked_up", "accepted", "assigned", "dispatched"];

const getDeliveryId = (delivery: any) => String(
  delivery?.order?.id
  || delivery?.order?._id
  || delivery?.orderId
  || delivery?.id
  || delivery?._id
  || ""
);

const getDeliveryAddress = (delivery: any) => (
  delivery?.deliveryAddress
  || delivery?.order?.deliveryAddress
  || delivery?.order?.address
  || delivery?.customer?.address
  || delivery?.address
);

const getCustomerPhone = (delivery: any) => (
  delivery?.customerPhone
  || delivery?.customer?.phone
  || delivery?.customer?.phoneNumber
  || delivery?.order?.customerPhone
  || delivery?.order?.customer?.phone
  || delivery?.order?.phone
  || delivery?.phone
  || delivery?.phoneNumber
  || ""
);

const getDeliveryCoordinates = (delivery: any) => {
  const address = getDeliveryAddress(delivery);
  const addressLocation = address?.location || address?.deliveryLocation || address?.geo;
  const location = addressLocation || (address ? null : delivery?.location);
  if (Array.isArray(location?.coordinates) && location.coordinates.length >= 2) {
    const lng = Number(location.coordinates[0]);
    const lat = Number(location.coordinates[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
  }
  if (location?.longitude != null && location?.latitude != null) {
    const lng = Number(location.longitude);
    const lat = Number(location.latitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
  }
  return null;
};

const getDeliveryAssignmentId = (delivery: any) => (
  delivery?.assignmentId
  || (delivery?.id && delivery?.orderId && String(delivery.id) !== String(delivery.orderId) ? delivery.id : null)
);

const distanceBetweenKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const earthRadius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const formatAddress = (addr: any) => {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  return [
    addr.addressLine1 || addr.address_line1,
    addr.addressLine2 || addr.address_line2,
    addr.area,
    addr.city,
    addr.district,
    addr.state,
    addr.zipCode || addr.zip_code || addr.postalCode || addr.pincode,
    "India",
  ].filter(Boolean).join(", ") || addr.address || "";
};

const contactCustomer = (phone: string | undefined, type: "call" | "message") => {
  if (!phone) {
    toast.error("Customer phone number is not available");
    return;
  }
  const number = phone.replace(/[^\d+]/g, "");
  window.location.href = type === "call" ? `tel:${number}` : `sms:${number}`;
};

export default function DeliveryRoutePage() {
  const searchParams = useSearchParams();
  const requestedRadius = Number(searchParams.get("radius"));
  const requestedOrderId = searchParams.get("orderId");
  const requestedOrderIds = useMemo(
    () => (searchParams.get("orderIds") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    [searchParams]
  );
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStop, setCurrentStop] = useState(0);
  const [radiusKm, setRadiusKm] = useState([5, 10, 20, 25, 50].includes(requestedRadius) ? requestedRadius : 10);
  const [liveOrigin, setLiveOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const lastLocationSyncAt = useRef(0);
  const [chatStop, setChatStop] = useState<any | null>(null);
  const [removingOrderId, setRemovingOrderId] = useState<string | null>(null);
  const [activeRouteTab, setActiveRouteTab] = useState<"stops" | "details" | "timeline">("stops");
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const queryClient = useQueryClient();

  const { data: routeData, isLoading, refetch } = useQuery({
    queryKey: ["deliveryRoute"],
    queryFn: () => api.get("/delivery/me/route"),
    enabled: Boolean(accessToken),
  });

  const { data: todayData, isLoading: todayLoading } = useQuery({
    queryKey: ["deliveryToday"],
    queryFn: () => api.get("/delivery/me/today"),
    enabled: Boolean(accessToken),
  });

  const { data: dashboardData } = useQuery({
    queryKey: ["deliveryDashboardFallback"],
    queryFn: () => api.get("/delivery/me/dashboard"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const { data: assignmentsData } = useQuery({
    queryKey: ["deliveryAssignments"],
    queryFn: () => api.get("/delivery/assignments", { params: { status: "all", limit: 100 } }),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const routeWaypoints = routeData?.data?.waypoints || [];
  const todayDeliveriesFromApi = todayData?.data?.deliveries
    || todayData?.deliveries
    || (Array.isArray(todayData?.data) ? todayData.data : [])
    || [];
  const todayDeliveries = todayDeliveriesFromApi.length
    ? todayDeliveriesFromApi
    : assignmentsData?.data?.assignments
      || assignmentsData?.data
      || assignmentsData?.assignments
      || dashboardData?.data?.todayDeliveries
      || dashboardData?.todayDeliveries
      || [];
  const activeDeliveries = todayDeliveries.filter((d: any) =>
    ACTIVE_STATUSES.includes(d.status || d.orderStatus)
  );
  // Always start from the driver's live browser location. Never use the
  // saved route origin (for example Thavalakuppam) as a fallback.
  const routeOrigin = liveOrigin;

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const accuracy = Number(position.coords.accuracy);
        // Use the latest browser GPS coordinate. Desktop browsers may report
        // a large accuracy radius even when the coordinate itself is usable.
        if (!Number.isFinite(accuracy)) return;
        setLiveOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocationAccuracy(accuracy);
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Publish the same live position used by the map/navigation to the backend.
  // Customer order tracking and server-side ETA calculations consume this
  // delivery-partner location.
  useEffect(() => {
    if (!liveOrigin || !accessToken) return;
    const now = Date.now();
    if (now - lastLocationSyncAt.current < 10000) return;
    lastLocationSyncAt.current = now;
    void api.put("/delivery/me/location", {
      latitude: liveOrigin.lat,
      longitude: liveOrigin.lng,
      accuracy: locationAccuracy,
    }).catch(() => undefined);
  }, [liveOrigin, locationAccuracy, accessToken]);
  // Prefer the optimized route order, but append any active orders that were
  // not included in a saved route so the partner always sees the complete run.
  const source = useMemo(() => {
    if (requestedOrderIds.length > 0) {
      const requested = new Set(requestedOrderIds.map(String));
      const matches = [...routeWaypoints, ...todayDeliveries, ...activeDeliveries]
        .filter((delivery: any) => requested.has(getDeliveryId(delivery)));
      return matches;
    }
    if (requestedOrderId) {
      // The deliveries page can link using either the order id or assignment
      // id. Search every API response so an order is never hidden just because
      // its status is not in ACTIVE_STATUSES or because it has no saved route.
      const matches = [...routeWaypoints, ...todayDeliveries, ...activeDeliveries]
        .filter((delivery: any) => getDeliveryId(delivery) === String(requestedOrderId));
      if (matches.length) return [matches[0]];
    }
    if (!routeWaypoints.length) return activeDeliveries;
    const routeIds = new Set(routeWaypoints.map((stop: any) => String(stop.orderId || stop.order?.id || "")));
    return [
      ...routeWaypoints,
      ...activeDeliveries.filter((delivery: any) => !routeIds.has(String(delivery.orderId || delivery.id || ""))),
    ];
  }, [routeWaypoints, activeDeliveries, requestedOrderId, requestedOrderIds, todayDeliveries]);

  const stops = useMemo(
    () =>
      source.map((stop: any, index: number) => {
        const order = stop.order;
        const deliveryAddress = getDeliveryAddress(stop) || order?.deliveryAddress;
        // For a single opened order, resolve the visible address itself. This
        // avoids using stale route/warehouse coordinates that may belong to a
        // different city than the customer's saved address.
        const coords = requestedOrderId ? null : getDeliveryCoordinates(stop);
        const lat = coords?.[1];
        const lng = coords?.[0];
        return {
          index,
          orderId: getDeliveryId({ ...stop, order }),
          assignmentId: getDeliveryAssignmentId({ ...stop, order }),
          status: String(stop.status || stop.orderStatus || order?.status || order?.orderStatus || "").toLowerCase(),
          customerName: order?.customerName || stop.customerName || `Stop ${index + 1}`,
          priority: order?.priority ?? stop.priority,
          priorityLabel: order?.priorityLabel ?? stop.priorityLabel,
          deliveryDeadline: order?.deliveryDeadline ?? stop.deliveryDeadline,
          deliveryHoursRemaining: order?.deliveryHoursRemaining ?? stop.deliveryHoursRemaining,
          priorityReason: order?.priorityReason ?? stop.priorityReason,
          address: formatAddress(deliveryAddress || order?.address),
          phone: getCustomerPhone({ ...stop, order }),
          eta: stop.eta,
          lat,
          lng,
          distanceFromStartKm: routeOrigin && lat != null && lng != null
            ? distanceBetweenKm(routeOrigin, { lat, lng })
            : null,
        };
      })
        // When the user opens one specific order, always show that order's
        // route even if it is outside the route-radius selector.
        .filter((stop: any) => requestedOrderId || requestedOrderIds.length > 0 || !routeOrigin || stop.distanceFromStartKm == null || stop.distanceFromStartKm <= radiusKm),
    [source, routeOrigin, radiusKm, requestedOrderId, requestedOrderIds]
  );

  const routeLength = stops.length;
  // A selected order must never inherit the saved multi-stop route's origin.
  // That origin may belong to another route/city (for example Pondicherry).
  // In single-order mode, the map itself uses browser GPS as the only origin.
  const displayedRouteOrigin = requestedOrderId || requestedOrderIds.length > 0 ? liveOrigin : routeOrigin;
  const mapMarkers = [
    // In single-order mode the browser's live location is the start point.
    // Do not add the saved route origin as another stop (it can be in a
    // different city and makes the route detour through that location).
    ...(!requestedOrderId && requestedOrderIds.length === 0 && displayedRouteOrigin ? [{
      id: "live-origin",
      lat: displayedRouteOrigin.lat,
      lng: displayedRouteOrigin.lng,
      title: "Current live location",
      info: "Route starting point",
      address: "Driver location",
    }] : []),
    ...stops.map((stop) => ({
    id: String(stop.index),
    lat: stop.lat,
    lng: stop.lng,
    title: stop.customerName,
    info: `${stop.address || "Delivery stop"} • ${stop.eta || "ETA pending"}`,
    address: stop.address,
  })),
  ];
  const mapRoute = [
    ...(displayedRouteOrigin ? [displayedRouteOrigin] : []),
    ...stops
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat, lng: s.lng })),
  ];

  const getLiveLocation = () => new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracy = Number(position.coords.accuracy);
        resolve(Number.isFinite(accuracy)
          ? { lat: position.coords.latitude, lng: position.coords.longitude }
          : null);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });

  const getNavigationOrigin = async () => {
    const liveLocation = await getLiveLocation();
    if (liveLocation) return `${liveLocation.lat},${liveLocation.lng}`;
    if (liveOrigin) return `${liveOrigin.lat},${liveOrigin.lng}`;
    return "";
  };

  const openFullRouteNavigation = async () => {
    const navigableStops = stops.filter((stop) => stop.lat != null && stop.lng != null || stop.address);
    if (!navigableStops.length) {
      toast.error("No delivery addresses are available for navigation");
      return;
    }

    const navigationWindow = window.open("about:blank", "_blank");
    const origin = await getNavigationOrigin();
    if (!origin) {
      navigationWindow?.close();
      toast.error("Allow location access to start from your current location");
      return;
    }
    const first = navigableStops[0];
    const last = navigableStops[navigableStops.length - 1];
    const stopValue = (stop: any) => stop.lat != null && stop.lng != null ? `${stop.lat},${stop.lng}` : stop.address;
    const destination = stopValue(last);
    const waypoints = navigableStops.slice(0, -1).map(stopValue).join("|");
    const originParam = `&origin=${encodeURIComponent(origin)}`;
    const waypointParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
    const url = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${encodeURIComponent(destination)}${waypointParam}&travelmode=driving`;
    if (navigationWindow) navigationWindow.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const openTurnByTurnNavigation = async (stop: any) => {
    const destination = stop.lat != null && stop.lng != null
      ? `${stop.lat},${stop.lng}`
      : stop.address;
    if (!destination) {
      toast.error("This stop has no navigable address");
      return;
    }

    // Open immediately so browser popup blockers do not reject navigation after
    // waiting for the GPS permission prompt.
    const navigationWindow = window.open("about:blank", "_blank");
    const liveLocation = await getLiveLocation();
    const origin = liveLocation
      ? `${liveLocation.lat},${liveLocation.lng}`
      : liveOrigin
        ? `${liveOrigin.lat},${liveOrigin.lng}`
        : "";
    if (!origin) {
      navigationWindow?.close();
      toast.error("Allow location access to navigate from your current location");
      return;
    }
    const originParam = `&origin=${encodeURIComponent(origin)}`;
    const navigationUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    if (navigationWindow) {
      navigationWindow.location.href = navigationUrl;
    } else {
      window.open(navigationUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleStartRoute = () => {
    setIsNavigating(true);
    toast.success("Route navigation started");
    void openFullRouteNavigation();
  };

  const handleRemoveStop = async (stop: any) => {
    if (!stop.assignmentId || !stop.orderId) {
      toast.error("This order has no active delivery assignment to remove.");
      return;
    }
    if (!["assigned", "accepted"].includes(String(stop.status || "").toLowerCase())) {
      toast.error("A delivery can only be removed before pickup has started.");
      return;
    }
    const confirmed = window.confirm(
      "Remove " + stop.customerName + " from this route? This cancels your assignment and makes the order available to another delivery partner."
    );
    if (!confirmed) return;
    setRemovingOrderId(stop.orderId);
    try {
      await api.put("/delivery/assignments/" + stop.assignmentId + "/cancel", { reason: "Removed from delivery route by partner" });
      toast.success("Order removed from your route and reopened for other delivery partners.");
      setIsNavigating(false);
      setCurrentStop(0);
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["deliveryToday"] }),
        queryClient.invalidateQueries({ queryKey: ["deliveryAssignments"] }),
        queryClient.invalidateQueries({ queryKey: ["deliveryNearbyOrders"] }),
        queryClient.invalidateQueries({ queryKey: ["deliveryDashboardFallback"] }),
      ]);
    } catch (error: any) {
      toast.error(error?.message || "Could not remove this order from the route.");
    } finally {
      setRemovingOrderId(null);
    }
  };

  const handleNextStop = async () => {
    const stop = stops[currentStop];
    if (!stop) {
      toast.error("No active stop available for delivery");
      return;
    }

    const orderId = stop.orderId;
    const assignmentId = stop.assignmentId;

    if (!orderId) {
      toast.error("Unable to determine the delivery order");
      return;
    }

    try {
      const res = await api.put(`/orders/${orderId}/status`, { status: "delivered" });
      if (res?.success === false) {
        if (!assignmentId) {
          throw new Error(res?.detail || "Failed to complete delivery");
        }
        await api.put(`/delivery/assignments/${assignmentId}/complete`);
      }
      toast.success("Delivery completed");
    } catch (err: any) {
      if (assignmentId) {
        try {
          await api.put(`/delivery/assignments/${assignmentId}/complete`);
          toast.success("Delivery completed");
        } catch {
          toast.error(err?.message || "Failed to complete delivery");
          return;
        }
      } else {
        toast.error(err?.message || "Failed to complete delivery");
        return;
      }
    }

    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["deliveryToday"] }),
      queryClient.invalidateQueries({ queryKey: ["deliveryDashboardFallback"] }),
      queryClient.invalidateQueries({ queryKey: ["deliveryAssignments"] }),
    ]);

    if (currentStop < routeLength - 1) {
      setCurrentStop((value) => value + 1);
      toast.success(`Navigating to stop ${currentStop + 2}`);
      return;
    }

    setIsNavigating(false);
    toast.success("All deliveries completed");
  };

  if (isLoading || (routeWaypoints.length === 0 && todayLoading)) {
    return (
      <div className="space-y-6">
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
        </div>
      </div>
    );
  }

  const metrics = routeData?.data || {};
  const weightKg = stops.reduce((n: number, stop: any) => n + (Number(stop.weight ?? stop.order?.weight ?? 0) || 0), 0);
  const distanceKm = metrics.totalDistanceKm ?? metrics.distanceKm ?? metrics.distance;
  const durationMin = metrics.estimatedDurationMinutes ?? metrics.estimatedTimeMinutes;
  const completed = stops.filter((stop: any) => ["delivered", "completed"].includes(stop.status)).length;
  const metric = (v: any, suffix: string) => v == null || v === "" ? "—" : `${v} ${suffix}`;

  return (
    <div className="space-y-5 pb-6">
      <div className="delivery-page-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="delivery-page-title text-2xl font-bold tracking-tight">Delivery Route</h1><p className="text-sm text-muted-foreground">Manage your selected deliveries, follow the optimized route and complete all stops.</p></div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant={isNavigating ? "success" : "secondary"}>{isNavigating ? "In progress" : "Route ready"}</Badge><Button size="sm" variant="outline" onClick={() => { refetch(); void queryClient.invalidateQueries({queryKey:["deliveryToday"]}); }}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button>{routeLength > 0 && <Button size="sm" onClick={isNavigating ? () => setIsNavigating(false) : handleStartRoute}>{isNavigating ? <><Pause className="mr-2 h-4 w-4"/>Stop route</> : <><Navigation className="mr-2 h-4 w-4"/>Start route</>}</Button>}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-emerald-100 p-3 text-emerald-700"><Route className="h-5 w-5"/></div><div className="min-w-0"><p className="text-xs text-muted-foreground">Current route</p><p className="truncate font-semibold">{String(metrics.routeNumber || metrics.routeId || "Active route")}</p><p className="text-xs text-emerald-700">{isNavigating ? "In progress" : "Ready"}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><MapPin className="h-6 w-6 text-emerald-600"/><div><p className="text-xs text-muted-foreground">Total stops</p><p className="text-xl font-bold">{routeLength}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><CheckCircle className="h-6 w-6 text-blue-600"/><div><p className="text-xs text-muted-foreground">Completed</p><p className="text-xl font-bold">{completed}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Truck className="h-6 w-6 text-emerald-600"/><div><p className="text-xs text-muted-foreground">Total weight</p><p className="text-xl font-bold">{weightKg > 0 ? `${weightKg} kg` : "—"}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Route className="h-6 w-6 text-emerald-600"/><div><p className="text-xs text-muted-foreground">Route distance</p><p className="text-xl font-bold">{metric(distanceKm,"km")}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 p-4"><Clock className="h-6 w-6 text-emerald-600"/><div><p className="text-xs text-muted-foreground">Estimated time</p><p className="text-xl font-bold">{metric(durationMin,"min")}</p></div></CardContent></Card>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)]">
        <div className="space-y-4">
          <Card className="overflow-hidden"><CardHeader className="border-b py-4"><CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-5 w-5 text-emerald-600"/>Delivery Route Map</CardTitle></CardHeader><CardContent className="p-2">{mapMarkers.length ? <Map center={{lat:displayedRouteOrigin?.lat || 11.2322,lng:displayedRouteOrigin?.lng || 78.8805}} zoom={12} trackUserLocation userLocation={liveOrigin} route={mapRoute} markers={mapMarkers} height="520px"/> : <div className="flex h-[360px] items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">No mapped delivery stops yet</div>}</CardContent></Card>
          <Card className="border-emerald-200 bg-emerald-50/50"><CardContent className="flex flex-col gap-3 p-4"><div><p className="font-semibold text-emerald-900">Route planning</p><p className="text-xs text-emerald-800">{routeOrigin ? "Your live GPS location is being used as the start point." : "Waiting for live GPS location. Allow location access to enable navigation."}</p></div><div className="flex flex-wrap gap-2">{[5,10,20,25,50].map((d)=><Button key={d} size="sm" variant={radiusKm===d?"default":"outline"} onClick={()=>{setRadiusKm(d);setCurrentStop(0);}}>{d} km</Button>)}</div></CardContent></Card>
        </div>
        <Card className="overflow-hidden">
          <div className="grid grid-cols-3 gap-1 border-b bg-muted/30 p-2"><Button size="sm" variant={activeRouteTab==="stops"?"default":"ghost"} onClick={()=>setActiveRouteTab("stops")}><MapPin className="mr-1 h-4 w-4"/>Stops ({routeLength})</Button><Button size="sm" variant={activeRouteTab==="details"?"default":"ghost"} onClick={()=>setActiveRouteTab("details")}><Route className="mr-1 h-4 w-4"/>Details</Button><Button size="sm" variant={activeRouteTab==="timeline"?"default":"ghost"} onClick={()=>setActiveRouteTab("timeline")}><Clock className="mr-1 h-4 w-4"/>Timeline</Button></div>
          <CardContent className="p-4 sm:p-5">
            {activeRouteTab==="stops" && <><div className="mb-3 flex items-center justify-between"><div><h2 className="font-semibold">Delivery Stops ({routeLength})</h2><p className="text-xs text-muted-foreground">Orders assigned to your current route</p></div><Badge variant="outline">{completed}/{routeLength} completed</Badge></div><div className="flex gap-3 border-b py-3"><div className="rounded-full bg-emerald-100 p-2 text-emerald-700"><Truck className="h-4 w-4"/></div><div><p className="text-sm font-semibold">Start point · Your location</p><p className="text-xs text-muted-foreground">{liveOrigin ? `${liveOrigin.lat.toFixed(5)}, ${liveOrigin.lng.toFixed(5)}` : "Waiting for GPS"}</p></div></div>
              {stops.map((stop:any,index:number)=><div key={stop.index ?? index} className={cn("flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center",index===currentStop&&isNavigating&&"rounded-lg bg-emerald-50/70")}><div className="flex min-w-0 flex-1 gap-3"><div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",index<currentStop?"bg-emerald-600":"bg-blue-600")}>{index+1}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold">{stop.orderId || `Stop ${index+1}`}</p>{index<currentStop?<Badge variant="success">Done</Badge>:index===currentStop&&isNavigating?<Badge variant="warning">Current</Badge>:<Badge variant="outline">Pending</Badge>}</div><p className="text-sm">{stop.customerName}</p><p className="text-xs text-muted-foreground">{stop.address || "Delivery address unavailable"}</p><div className="mt-2 flex flex-wrap items-center gap-2"><DeliveryPriorityBadge delivery={stop} compact/>{stop.eta&&<span className="text-xs text-muted-foreground">ETA {stop.eta}</span>}{stop.distanceFromStartKm!=null&&<span className="text-xs text-muted-foreground">{stop.distanceFromStartKm.toFixed(1)} km direct distance</span>}</div></div></div><div className="flex shrink-0 flex-wrap gap-1.5">{stop.phone&&<Button variant="outline" size="icon" onClick={()=>contactCustomer(stop.phone,"call")} aria-label="Call customer"><Phone className="h-4 w-4"/></Button>}<Button variant="outline" size="icon" onClick={()=>openTurnByTurnNavigation(stop)} aria-label="Navigate to customer"><Navigation className="h-4 w-4"/></Button><Button variant="outline" size="icon" onClick={()=>setChatStop(stop)} aria-label="Message customer"><MessageSquare className="h-4 w-4"/></Button>{["assigned","accepted"].includes(stop.status)&&stop.assignmentId&&<Button size="sm" variant="outline" className="text-destructive" disabled={removingOrderId===stop.orderId||isNavigating} onClick={()=>void handleRemoveStop(stop)}><X className="mr-1 h-4 w-4"/>{removingOrderId===stop.orderId?"Removing":"Remove"}</Button>}{index===currentStop&&isNavigating&&<Button size="sm" onClick={handleNextStop}>Deliver<ArrowRight className="ml-1 h-4 w-4"/></Button>}</div></div>)}
              {routeLength===0&&<p className="py-10 text-center text-sm text-muted-foreground">No active delivery orders assigned.</p>}</>}
            {activeRouteTab==="details"&&<div className="space-y-4"><h2 className="font-semibold">Route Details</h2><div className="grid gap-3 sm:grid-cols-2">{[["Route reference",String(metrics.routeNumber||metrics.routeId||"Not assigned")],["Status",isNavigating?"Navigation active":"Ready to start"],["Total stops",String(routeLength)],["Completed stops",String(completed)],["Route distance",metric(distanceKm,"km")],["Estimated duration",metric(durationMin,"min")]].map(([k,v])=><div key={k} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 font-semibold">{v}</p></div>)}</div><p className="text-xs text-muted-foreground">Distance and duration are shown only when provided by the route service. Straight-line GPS distance is not presented as road distance.</p></div>}
            {activeRouteTab==="timeline"&&<div className="space-y-3"><h2 className="font-semibold">Delivery Timeline</h2><p className="text-xs text-muted-foreground">Actual recorded timestamps are shown when available.</p>{stops.map((stop:any,index:number)=><div key={stop.index??index} className="flex gap-3 border-b pb-3"><span className={cn("mt-1 h-3 w-3 rounded-full",["delivered","completed"].includes(stop.status)?"bg-emerald-600":"bg-blue-600")}/><div><p className="text-sm font-medium">{stop.customerName}</p><p className="text-xs text-muted-foreground">{stop.orderId} · {stop.status||"Status pending"}</p><p className="text-xs text-muted-foreground">Time: {stop.deliveredAt||stop.completedAt||stop.updatedAt||"Not recorded"}</p></div></div>)}</div>}
            {routeLength>0&&<div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Distance</p><p className="font-semibold">{metric(distanceKm,"km")}</p></div><div><p className="text-xs text-muted-foreground">Est. time</p><p className="font-semibold">{metric(durationMin,"min")}</p></div><div><p className="text-xs text-muted-foreground">Weight</p><p className="font-semibold">{weightKg>0?`${weightKg} kg`:"—"}</p></div><div><p className="text-xs text-muted-foreground">Orders</p><p className="font-semibold">{routeLength}</p></div></div><Button onClick={isNavigating?()=>setIsNavigating(false):handleStartRoute}>{isNavigating?<><Pause className="mr-2 h-4 w-4"/>Stop</>:<><Navigation className="mr-2 h-4 w-4"/>Start route</>}</Button></div>}
          </CardContent>
        </Card>
      </div>
      {chatStop?.orderId&&<LiveChatDialog orderId={chatStop.orderId} customerName={chatStop.customerName} onClose={()=>setChatStop(null)}/>}
    </div>
  );
}
