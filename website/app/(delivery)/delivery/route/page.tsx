"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle, Clock, MapPin, MessageSquare, Navigation, Pause, Phone, RefreshCw, Route, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Map } from "../../../components/shared/map";
import { LiveChatDialog } from "../../../components/delivery/live-chat-dialog";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { formatTime } from "../../../lib/utils";
import toast from "react-hot-toast";

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
      if (matches.length) return matches;
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
          customerName: order?.customerName || stop.customerName || `Stop ${index + 1}`,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Live Route</h1>
          <p className="text-muted-foreground">{isNavigating ? "Navigation active" : routeLength > 0 ? "Route planned" : "No route assigned"}</p>
        </div>
        <div className="flex items-center gap-2">
          {routeLength > 0 && (
            <Button variant={isNavigating ? "destructive" : "default"} onClick={isNavigating ? () => setIsNavigating(false) : handleStartRoute}>
              {isNavigating ? <><Pause className="mr-2 h-4 w-4" />Stop Navigation</> : <><Navigation className="mr-2 h-4 w-4" />Start Route</>}
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={() => { refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card className="border-blue-200 bg-blue-50/40">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-slate-900">Keep the route profitable</p>
            <p className="text-xs text-slate-600">
              Show orders within this distance from the start point. {routeOrigin
                ? `Your live location is being used as the start${locationAccuracy != null ? ` (±${Math.round(locationAccuracy)} m accuracy)` : ""}.`
                : "Waiting for a live GPS location; no saved route start will be used."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[5, 10, 20, 25, 50].map((distance) => (
              <Button
                key={distance}
                size="sm"
                variant={radiusKm === distance ? "default" : "outline"}
                onClick={() => { setRadiusKm(distance); setCurrentStop(0); }}
              >
                {distance} km
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {routeLength === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Route className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-lg font-medium">No route assigned</p>
            <p className="mt-1 text-sm text-muted-foreground">You don&apos;t have any deliveries scheduled today.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Stops</p>
                    <p className="text-xl font-bold">{routeLength}</p>
                  </div>
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <p className="text-xl font-bold">{currentStop >= routeLength ? "Complete" : "Active"}</p>
                  </div>
                  <Clock className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              {mapMarkers.length > 0 && (
                <Map
                  center={{ lat: displayedRouteOrigin?.lat || 11.2322, lng: displayedRouteOrigin?.lng || 78.8805 }}
                  zoom={12}
                  trackUserLocation
                  userLocation={liveOrigin}
                  route={mapRoute}
                  markers={mapMarkers}
                  height="500px"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                Route Stops
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {stops.map((stop: any, index: number) => (
                  <div
                    key={stop.index ?? index}
                    className={cn(
                      "flex items-center gap-4 rounded-lg border-l-4 p-4",
                      index === currentStop && isNavigating ? "border-primary bg-primary/5" : index < currentStop ? "border-green-500 bg-green-50/50" : "border-muted bg-muted/20"
                    )}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{index + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{stop.customerName}</p>
                        {index < currentStop ? <Badge variant="success">Done</Badge> : index === currentStop && isNavigating ? <Badge variant="warning">Current</Badge> : <Badge variant="outline">Pending</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{stop.address || "Delivery address"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />ETA: {stop.eta || "Pending"}</span>
                        {stop.distanceFromStartKm != null && (
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{stop.distanceFromStartKm.toFixed(1)} km from start</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {stop.phone && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contactCustomer(stop.phone, "call")} aria-label={`Call ${stop.customerName}`}><Phone className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setChatStop(stop)} aria-label={`Message ${stop.customerName}`}><MessageSquare className="h-4 w-4" /></Button>
                      {index === currentStop && isNavigating && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openTurnByTurnNavigation(stop)}>
                            <Navigation className="mr-2 h-4 w-4" />Navigate
                          </Button>
                          <Button size="sm" onClick={handleNextStop}>
                            Deliver
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-4 rounded-lg border-l-4 border-green-500 bg-green-50/30 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600">•</div>
                  <div className="flex-1">
                    <p className="font-medium">End Location</p>
                    <p className="text-sm text-muted-foreground">Complete all deliveries</p>
                  </div>
                  {currentStop === routeLength && <Badge variant="success">Completed</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      {chatStop?.orderId && <LiveChatDialog orderId={chatStop.orderId} customerName={chatStop.customerName} onClose={() => setChatStop(null)} />}
    </div>
  );
}
