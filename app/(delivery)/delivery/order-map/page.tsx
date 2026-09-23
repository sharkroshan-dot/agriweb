"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  Crosshair,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Route,
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Map } from "../../../components/shared/map";
import { api } from "../../../lib/api/client";
import { DeliveryDistances } from "../../../components/delivery/delivery-distances";

const READY_STATUSES = ["ready_for_delivery", "assigned"];
const ACCEPTED_STATUSES = ["accepted", "picked_up", "in_transit", "dispatched"];
const HIDDEN_STATUSES = ["delivered", "cancelled", "refunded", "failed"];
const RADIUS_OPTIONS = [5, 10, 20, 25, 50] as const;
const FALLBACK_CENTER = { lat: 11.1271, lng: 78.6569 };

type RadiusFilter = typeof RADIUS_OPTIONS[number] | "all";

const asArray = (value: any): any[] => Array.isArray(value) ? value : [];

const formatAddress = (addr: any) => {
  if (!addr || typeof addr === "string") return addr || "Address unavailable";
  return [
    addr.addressLine1 || addr.address_line1,
    addr.addressLine2 || addr.address_line2,
    addr.city,
    addr.state,
    addr.zipCode || addr.zip_code,
  ].filter(Boolean).join(", ") || "Address unavailable";
};

const getOrderId = (delivery: any) => String(delivery?.orderId || delivery?.order?.id || delivery?.id || delivery?._id || "");

const getAssignmentId = (delivery: any) => (
  delivery?.assignmentId
  || (delivery?.id && delivery?.orderId && String(delivery.id) !== String(delivery.orderId) ? delivery.id : null)
);

const getStatus = (delivery: any) => String(delivery?.status || delivery?.orderStatus || "").toLowerCase();

const canAcceptOrder = (order: any) => READY_STATUSES.includes(getStatus(order)) && !ACCEPTED_STATUSES.includes(getStatus(order));

const getDeliveryAddress = (delivery: any) => (
  delivery?.deliveryAddress
  || delivery?.order?.deliveryAddress
  || delivery?.address
  || delivery?.customer?.address
);

const isValidCoordinate = (lat: number, lng: number) => (
  Number.isFinite(lat)
  && Number.isFinite(lng)
  && Math.abs(lat) <= 90
  && Math.abs(lng) <= 180
);

const isLikelyIndiaCoordinate = (lat: number, lng: number) => (
  lat >= 6
  && lat <= 38
  && lng >= 68
  && lng <= 98
);

const normalizeCoordinate = (lat: number, lng: number): { lat: number; lng: number } | null => {
  if (!isValidCoordinate(lat, lng)) {
    return isValidCoordinate(lng, lat) ? { lat: lng, lng: lat } : null;
  }

  // Some backend payloads store GeoJSON-style coordinates as [lat, lng]
  // instead of [lng, lat]. For this India-focused app, prefer the orientation
  // that lands inside India when only the swapped value makes geographic sense.
  if (!isLikelyIndiaCoordinate(lat, lng) && isLikelyIndiaCoordinate(lng, lat)) {
    return { lat: lng, lng: lat };
  }

  return { lat, lng };
};

const getCoordinates = (delivery: any): { lat: number; lng: number } | null => {
  const address = getDeliveryAddress(delivery);
  const location = address?.location || address?.deliveryLocation || address?.geo || delivery?.location || address;

  if (Array.isArray(location?.coordinates) && location.coordinates.length >= 2) {
    return normalizeCoordinate(Number(location.coordinates[1]), Number(location.coordinates[0]));
  }

  if (location?.latitude != null && location?.longitude != null) {
    return normalizeCoordinate(Number(location.latitude), Number(location.longitude));
  }

  if (location?.lat != null && location?.lng != null) {
    return normalizeCoordinate(Number(location.lat), Number(location.lng));
  }

  if (delivery?.latitude != null && delivery?.longitude != null) {
    return normalizeCoordinate(Number(delivery.latitude), Number(delivery.longitude));
  }

  return null;
};

const distanceBetweenKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const contactCustomer = (phone?: string) => {
  if (!phone) {
    toast.error("Customer phone number is not available");
    return;
  }
  window.location.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
};

export default function DeliveryOrderMapPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const [radiusKm, setRadiusKm] = useState<RadiusFilter>(10);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<Date | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [acceptingRoute, setAcceptingRoute] = useState(false);
  const lastLocationSyncAt = useRef(0);

  const todayQuery = useQuery({
    queryKey: ["deliveryToday"],
    queryFn: () => api.get("/delivery/me/today"),
    enabled: Boolean(accessToken),
  });

  const dashboardQuery = useQuery({
    queryKey: ["deliveryDashboardFallback"],
    queryFn: () => api.get("/delivery/me/dashboard"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const assignmentsQuery = useQuery({
    queryKey: ["deliveryAssignments"],
    queryFn: () => api.get("/delivery/assignments", { params: { status: "all", limit: 100 } }),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const nearbyOrigin = liveLocation || (radiusKm === "all" ? FALLBACK_CENTER : null);

  const nearbyQuery = useQuery({
    queryKey: ["deliveryNearbyOrders", nearbyOrigin, radiusKm],
    queryFn: () => api.get("/delivery/nearby-orders", {
      params: {
        lat: nearbyOrigin?.lat,
        lng: nearbyOrigin?.lng,
        radius: radiusKm === "all" ? 0 : radiusKm,
        limit: 100,
      },
    }),
    enabled: Boolean(accessToken && nearbyOrigin),
    retry: 1,
  });

  const refetchOrders = async () => {
    await Promise.all([
      todayQuery.refetch(),
      dashboardQuery.refetch(),
      assignmentsQuery.refetch(),
      nearbyQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: ["deliveryToday"] }),
      queryClient.invalidateQueries({ queryKey: ["deliveryAssignments"] }),
    ]);
  };

  const updateLivePosition = (position: GeolocationPosition) => {
    const nextLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
    setLiveLocation(nextLocation);
    setLocationUpdatedAt(new Date());
    setLocationError(false);

    const now = Date.now();
    if (accessToken && now - lastLocationSyncAt.current >= 10000) {
      lastLocationSyncAt.current = now;
      void api.put("/delivery/me/location", {
        latitude: nextLocation.lat,
        longitude: nextLocation.lng,
        accuracy: position.coords.accuracy,
      }).catch(() => {});
    }
  };

  const requestLiveLocation = () => {
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateLivePosition(position);
        setLocationLoading(false);
      },
      () => {
        setLocationError(true);
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    requestLiveLocation();
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      updateLivePosition,
      () => setLocationError(true),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const allOrders = useMemo(() => {
    const todayOrders = asArray(todayQuery.data?.data?.deliveries || todayQuery.data?.deliveries || todayQuery.data?.data);
    const dashboardOrders = asArray(dashboardQuery.data?.data?.todayDeliveries || dashboardQuery.data?.todayDeliveries);
    const assignmentOrders = asArray(
      assignmentsQuery.data?.data?.assignments
      || assignmentsQuery.data?.data?.deliveries
      || assignmentsQuery.data?.assignments
      || assignmentsQuery.data?.data
    );
    const nearbyOrders = asArray(nearbyQuery.data?.data?.orders || nearbyQuery.data?.orders || nearbyQuery.data?.data);
    const merged = new globalThis.Map<string, any>();

    [...nearbyOrders, ...assignmentOrders, ...todayOrders, ...dashboardOrders].forEach((order) => {
      const id = getOrderId(order);
      if (!id || merged.has(id)) return;
      merged.set(id, order);
    });

    return [...merged.values()];
  }, [assignmentsQuery.data, dashboardQuery.data, nearbyQuery.data, todayQuery.data]);

  const visibleOrders = useMemo(() => (
    allOrders
      .filter((order) => !HIDDEN_STATUSES.includes(getStatus(order)))
      .filter((order) => radiusKm === "all" || canAcceptOrder(order))
      .map((order) => {
        const coordinates = getCoordinates(order);
        const distanceFromPartnerKm = liveLocation && coordinates
          ? distanceBetweenKm(liveLocation, coordinates)
          : Number(order.distance ?? order.distanceFromPartnerKm);
        return {
          ...order,
          mapCoordinates: coordinates,
          distanceFromPartnerKm: Number.isFinite(distanceFromPartnerKm) ? distanceFromPartnerKm : null,
        };
      })
      .filter((order) => radiusKm === "all" || !liveLocation || order.distanceFromPartnerKm == null || order.distanceFromPartnerKm <= radiusKm)
      .sort((a, b) => Number(a.distanceFromPartnerKm ?? 9999) - Number(b.distanceFromPartnerKm ?? 9999))
  ), [allOrders, liveLocation, radiusKm]);

  const acceptReadyOrders = useMemo(() => visibleOrders.filter(canAcceptOrder), [visibleOrders]);

  const selectedOrder = visibleOrders.find((order) => getOrderId(order) === selectedOrderId) || visibleOrders[0] || null;

  const mapMarkers = useMemo(() => visibleOrders.map((order, index) => {
    const coordinates = order.mapCoordinates;
    const address = formatAddress(getDeliveryAddress(order));
    return {
      id: getOrderId(order),
      lat: coordinates?.lat,
      lng: coordinates?.lng,
      title: `${index + 1}. ${order.customerName || order.orderNumber || "Delivery order"}`,
      info: `${address}${order.distanceFromPartnerKm != null ? ` - ${order.distanceFromPartnerKm.toFixed(1)} km` : ""}`,
      address,
    };
  }), [visibleOrders]);

  const handleAccept = async (order: any) => {
    const orderId = getOrderId(order);
    const assignmentId = getAssignmentId(order);
    if (!orderId) {
      toast.error("Order id is not available");
      return;
    }

    setAcceptingOrderId(orderId);
    try {
      const res = assignmentId
        ? await api.put(`/delivery/assignments/${assignmentId}/accept`)
        : await api.put(`/delivery/orders/${orderId}/accept`);

      if (res?.success === false) {
        toast.error(res?.detail || "Failed to accept order");
        return;
      }

      toast.success("Order accepted");
      await refetchOrders();
    } catch (err: any) {
      toast.error(err?.message || "Failed to accept order");
    } finally {
      setAcceptingOrderId(null);
    }
  };

  const handleAcceptRoute = async () => {
    if (!acceptReadyOrders.length) {
      toast.error("No ready orders are available in this map view");
      return;
    }

    setAcceptingRoute(true);
    try {
      for (const order of acceptReadyOrders) {
        await handleAccept(order);
      }
      toast.success(`${acceptReadyOrders.length} order${acceptReadyOrders.length > 1 ? "s" : ""} accepted`);
    } finally {
      setAcceptingRoute(false);
    }
  };

  const isLoading = todayQuery.isLoading || assignmentsQuery.isLoading;
  const routeOrderIds = acceptReadyOrders.map(getOrderId).filter(Boolean);
  const routeHref = `/delivery/route?orderIds=${encodeURIComponent(routeOrderIds.join(","))}${radiusKm === "all" ? "" : `&radius=${radiusKm}`}`;
  const radiusLabel = radiusKm === "all" ? "All" : `${radiusKm} km`;
  const mapCenter = selectedOrder?.mapCoordinates || liveLocation || FALLBACK_CENTER;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Delivery workbench</p>
          <h1 className="text-3xl font-semibold tracking-tight">Order Map</h1>
          <p className="mt-1 text-sm text-muted-foreground">View available delivery orders by location and accept them from one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {RADIUS_OPTIONS.map((distance) => (
            <Button
              key={distance}
              size="sm"
              variant={radiusKm === distance ? "default" : "outline"}
              onClick={() => setRadiusKm(distance)}
            >
              {distance} km
            </Button>
          ))}
          <Button
            size="sm"
            variant={radiusKm === "all" ? "default" : "outline"}
            onClick={() => setRadiusKm("all")}
          >
            All
          </Button>
          <Button size="sm" variant="outline" onClick={requestLiveLocation} disabled={locationLoading}>
            {locationLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crosshair className="mr-1.5 h-4 w-4" />}
            Locate
          </Button>
          <Button size="sm" variant="outline" onClick={refetchOrders}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm text-muted-foreground">Available</p>
              <p className="text-2xl font-bold">{visibleOrders.length}</p>
            </div>
            <MapPin className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm text-muted-foreground">Radius</p>
              <p className="text-2xl font-bold">{radiusLabel}</p>
            </div>
            <Route className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm text-muted-foreground">Location</p>
              <p className="text-sm font-semibold">{liveLocation ? "Live GPS active" : locationError ? "Location unavailable" : "Waiting for GPS"}</p>
              {locationUpdatedAt && <p className="text-xs text-muted-foreground">{locationUpdatedAt.toLocaleTimeString()}</p>}
            </div>
            <Crosshair className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.8fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Available Order Locations</CardTitle>
              <CardDescription>Tap a marker or select an order to review before accepting.</CardDescription>
            </div>
            {routeOrderIds.length > 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href={routeHref}>
                  <Navigation className="mr-1.5 h-4 w-4" />
                  Preview Route
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="h-[560px] animate-pulse rounded-b-lg bg-muted" />
            ) : visibleOrders.length === 0 ? (
              <div className="flex h-[420px] flex-col items-center justify-center gap-3 rounded-b-lg border-t bg-muted/20 p-6 text-center">
                <MapPin className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">No available orders on the map</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {liveLocation && radiusKm !== "all" ? `Try increasing the ${radiusKm} km radius, choose All, or refresh orders.` : "Allow location access to find nearby orders."}
                  </p>
                </div>
              </div>
            ) : (
              <Map
                center={mapCenter}
                zoom={12}
                markers={mapMarkers}
                trackUserLocation
                userLocation={liveLocation}
                height="560px"
                onMarkerClick={(marker) => setSelectedOrderId(String(marker.id))}
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Selected Order</CardTitle>
              <CardDescription>Accept one order or build a route from all visible orders.</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedOrder ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Select an order from the map or list.</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{selectedOrder.customerName || selectedOrder.orderNumber || "Delivery order"}</p>
                      <Badge variant={canAcceptOrder(selectedOrder) ? "success" : "outline"}>{getStatus(selectedOrder).replace(/_/g, " ") || "unknown"}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{formatAddress(getDeliveryAddress(selectedOrder))}</p>
                    {selectedOrder.distanceFromPartnerKm != null && (
                      <p className="mt-2 text-sm font-medium text-emerald-700">{selectedOrder.distanceFromPartnerKm.toFixed(1)} km from you</p>
                    )}
                    <DeliveryDistances delivery={selectedOrder} origin={liveLocation} />
                    {selectedOrder.totalAmount && (
                      <p className="mt-1 text-sm text-muted-foreground">Order value: Rs {selectedOrder.totalAmount}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {canAcceptOrder(selectedOrder) && (
                      <Button
                        className="flex-1"
                        onClick={() => handleAccept(selectedOrder)}
                        disabled={acceptingOrderId === getOrderId(selectedOrder) || acceptingRoute}
                      >
                        {acceptingOrderId === getOrderId(selectedOrder) ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1.5 h-4 w-4" />
                        )}
                        Accept
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => contactCustomer(selectedOrder.customerPhone || selectedOrder.customer?.phone)}>
                      <Phone className="mr-1.5 h-4 w-4" />
                      Call
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>Visible Orders</CardTitle>
                  <CardDescription>{radiusKm === "all" ? "Active orders — delivered and cancelled ones are hidden." : "Ready orders inside the current map radius."}</CardDescription>
                </div>
                <Button size="sm" onClick={handleAcceptRoute} disabled={!acceptReadyOrders.length || acceptingRoute}>
                  {acceptingRoute ? "Accepting..." : "Accept All"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="max-h-[520px] space-y-3 overflow-y-auto">
              {visibleOrders.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No orders to show.</p>
              ) : (
                visibleOrders.map((order, index) => {
                  const orderId = getOrderId(order);
                  const selected = orderId === selectedOrderId || (!selectedOrderId && index === 0);
                  return (
                    <button
                      key={orderId}
                      type="button"
                      onClick={() => setSelectedOrderId(orderId)}
                      className={`w-full rounded-lg border p-3 text-left transition ${selected ? "border-emerald-500 bg-emerald-50" : "bg-white hover:bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{index + 1}. {order.customerName || order.orderNumber || "Delivery order"}</p>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{formatAddress(getDeliveryAddress(order))}</p>
                          <DeliveryDistances delivery={order} origin={liveLocation} compact />
                        </div>
                        {order.distanceFromPartnerKm != null && (
                          <Badge variant="outline">{order.distanceFromPartnerKm.toFixed(1)} km</Badge>
                        )}
                        <Badge variant={canAcceptOrder(order) ? "success" : "outline"}>{getStatus(order).replace(/_/g, " ") || "unknown"}</Badge>
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
