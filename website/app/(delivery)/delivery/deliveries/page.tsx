"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, Share2, Camera, Loader2, CalendarClock, Zap, Phone, MessageSquare, Navigation } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";
import { useState, useRef, useMemo, useEffect } from "react";

const distanceBetweenKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const formatAddress = (addr: any) => {
  if (!addr || typeof addr === "string") return addr || "Address";
  return [
    addr.addressLine1 || addr.address_line1,
    addr.addressLine2 || addr.address_line2,
    addr.city,
    addr.state,
    addr.zipCode || addr.zip_code,
  ].filter(Boolean).join(", ") || "Address";
};

const contactCustomer = (phone: string | undefined, type: "call" | "message") => {
  if (!phone) {
    toast.error("Customer phone number is not available");
    return;
  }
  const number = phone.replace(/[^\d+]/g, "");
  window.location.href = type === "call" ? `tel:${number}` : `sms:${number}`;
};

const getCoordinates = (address: any): [number, number] | null => {
  const location = address?.location || address?.deliveryLocation || address?.geo || address;
  if (Array.isArray(location?.coordinates) && location.coordinates.length >= 2) {
    const coordinates: [number, number] = [Number(location.coordinates[0]), Number(location.coordinates[1])];
    return coordinates.every(Number.isFinite) ? coordinates : null;
  }
  if (location?.longitude != null && location?.latitude != null) {
    const coordinates: [number, number] = [Number(location.longitude), Number(location.latitude)];
    return coordinates.every(Number.isFinite) ? coordinates : null;
  }
  if (location?.lng != null && location?.lat != null) {
    const coordinates: [number, number] = [Number(location.lng), Number(location.lat)];
    return coordinates.every(Number.isFinite) ? coordinates : null;
  }
  return null;
};

const asArray = (value: any): any[] => Array.isArray(value) ? value : [];

const statusVariant: Record<string, "success" | "warning" | "default" | "destructive" | "secondary" | "outline"> = {
  delivered: "success",
  in_transit: "warning",
  picked_up: "secondary",
  accepted: "default",
  assigned: "outline",
  failed: "destructive",
  cancelled: "destructive",
};

const OFFLINE_LOCATION_QUEUE_KEY = "agriconnect:delivery-location-queue";
const ACCEPTED_STATUSES = ["accepted", "picked_up", "in_transit", "dispatched"];
const READY_STATUSES = ["ready_for_delivery", "assigned"];
const DELIVERED_STATUSES = ["delivered", "completed"];

const getOrderId = (delivery: any) => String(delivery?.orderId || delivery?.order?.id || delivery?.id || delivery?._id || "");
const getAssignmentId = (delivery: any) => (
  delivery?.assignmentId
  || (delivery?.id && delivery?.orderId && String(delivery.id) !== String(delivery.orderId) ? delivery.id : null)
);
const getDeliveryStatus = (delivery: any) => String(delivery?.status || delivery?.orderStatus || "").toLowerCase();
const isAcceptedDelivery = (delivery: any) => ACCEPTED_STATUSES.includes(getDeliveryStatus(delivery));
const isReadyDelivery = (delivery: any) => READY_STATUSES.includes(getDeliveryStatus(delivery));
const isDeliveredDelivery = (delivery: any) => DELIVERED_STATUSES.includes(getDeliveryStatus(delivery));

export default function DeliveryDeliveriesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [nearbyRadius, setNearbyRadius] = useState(10);
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<Date | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [acceptingNearby, setAcceptingNearby] = useState(false);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [geocodedOrders, setGeocodedOrders] = useState<Record<string, [number, number]>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const lastLocationSyncAt = useRef(0);

  const { data, isLoading, refetch: refetchToday } = useQuery({
    queryKey: ["deliveryToday"],
    queryFn: () => api.get("/delivery/me/today"),
    enabled: Boolean(accessToken),
  });

  const { data: dashboardData, refetch: refetchDashboard } = useQuery({
    queryKey: ["deliveryDashboardFallback"],
    queryFn: () => api.get("/delivery/me/dashboard"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const { data: assignmentsData, refetch: refetchAssignments } = useQuery({
    queryKey: ["deliveryAssignments"],
    queryFn: () => api.get("/delivery/assignments", { params: { status: "all", limit: 100 } }),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const { data: nearbyOrdersData, refetch: refetchNearbyOrders } = useQuery({
    queryKey: ["deliveryNearbyOrders", liveLocation, nearbyRadius],
    queryFn: () => api.get("/delivery/nearby-orders", {
      params: {
        lat: liveLocation?.lat,
        lng: liveLocation?.lng,
        radius: nearbyRadius,
        limit: 100,
      },
    }),
    enabled: Boolean(accessToken && liveLocation),
    retry: 1,
  });

  const todayDeliveries = asArray(data?.data?.deliveries || data?.deliveries || data?.data);
  const fallbackDeliveries = asArray(dashboardData?.data?.todayDeliveries || dashboardData?.todayDeliveries);
  const assignedDeliveries = asArray(
    assignmentsData?.data?.assignments
      || assignmentsData?.data?.deliveries
      || assignmentsData?.assignments
      || assignmentsData?.data
  );
  const refetchDeliveries = async () => {
    await Promise.all([
      refetchToday(),
      refetchDashboard(),
      refetchAssignments(),
      refetchNearbyOrders(),
    ]);
  };
  // Combine every delivery source. /me/today also contains farmer-available
  // ready orders, while /assignments contains partner assignments. Selecting
  // only one source can hide nearby orders from the other source.
  const deliveries = useMemo(() => {
    const merged: any[] = [];
    const seen = new Set<string>();
    [...assignedDeliveries, ...todayDeliveries, ...fallbackDeliveries].forEach((delivery: any) => {
      const key = String(delivery.orderId || delivery.orderNumber || delivery.id || delivery._id || "");
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push(delivery);
    });
    return merged;
  }, [assignedDeliveries, todayDeliveries, fallbackDeliveries]);
  // Nearby filtering must use the browser's current GPS position. Do not
  // silently fall back to a stale profile location from a previous session.
  const partnerLocation = liveLocation;
  const queueLocationUpdate = (payload: { latitude: number; longitude: number; accuracy?: number | null }) => {
    try {
      const queued = JSON.parse(localStorage.getItem(OFFLINE_LOCATION_QUEUE_KEY) || "[]");
      queued.push({ ...payload, queuedAt: new Date().toISOString() });
      localStorage.setItem(OFFLINE_LOCATION_QUEUE_KEY, JSON.stringify(queued.slice(-100)));
    } catch {
      // Local storage may be unavailable; the live in-memory position remains usable.
    }
  };

  const flushQueuedLocations = async () => {
    try {
      const queued = JSON.parse(localStorage.getItem(OFFLINE_LOCATION_QUEUE_KEY) || "[]");
      if (!Array.isArray(queued) || queued.length === 0) return;
      const remaining = [...queued];
      while (remaining.length) {
        try {
          await api.put("/delivery/me/location", remaining[0]);
          remaining.shift();
        } catch {
          break;
        }
      }
      if (remaining.length) localStorage.setItem(OFFLINE_LOCATION_QUEUE_KEY, JSON.stringify(remaining));
      else localStorage.removeItem(OFFLINE_LOCATION_QUEUE_KEY);
    } catch {
      // Ignore malformed offline data and continue live tracking.
    }
  };

  const applyLivePosition = (position: GeolocationPosition, syncBackend = true) => {
    const location = { lat: position.coords.latitude, lng: position.coords.longitude };
    setLiveLocation(location);
    setLocationAccuracy(Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null);
    setLocationUpdatedAt(new Date());
    setLocationError(false);

    const now = Date.now();
    if (syncBackend && now - lastLocationSyncAt.current >= 10000) {
      lastLocationSyncAt.current = now;
      const payload = {
        latitude: location.lat,
        longitude: location.lng,
        accuracy: position.coords.accuracy,
      };
      void api.put("/delivery/me/location", payload).catch(() => queueLocationUpdate(payload));
    }
  };

  const requestLiveLocation = () => {
    if (!navigator.geolocation) {
      setLocationError(true);
      return;
    }
    setLocationLoading(true);
    setLocationError(false);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // maximumAge is zero below, so this button always uses a fresh reading.
        applyLivePosition(position);
        setLocationLoading(false);
      },
      () => {
        setLocationError(true);
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  const selectNearbyRadius = (distance: number) => {
    setNearbyRadius(distance);
    requestLiveLocation();
  };

  useEffect(() => {
    void flushQueuedLocations();
    const interval = window.setInterval(() => { void flushQueuedLocations(); }, 15000);
    const handleOnline = () => { void flushQueuedLocations(); };
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    requestLiveLocation();
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        applyLivePosition(position);
      },
      () => setLocationError(true),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const missing = deliveries.filter((delivery: any) => {
      const address = delivery.deliveryAddress || delivery.address;
      return !getCoordinates(address) && (formatAddress(address) !== "Address");
    });
    if (!missing.length) return () => { cancelled = true; };

    Promise.all(missing.map(async (delivery: any) => {
      const rawAddress = delivery.deliveryAddress || delivery.address;
      const address = formatAddress(rawAddress);
      const cityState = [rawAddress?.city, rawAddress?.state].filter(Boolean).join(", ");
      const queries = [address, cityState].filter((query, index, list) => query && list.indexOf(query) === index);
      try {
        for (const query of queries) {
          const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`);
          const result = await response.json();
          if (result?.[0]) return [String(delivery.id || delivery.orderId), [Number(result[0].lon), Number(result[0].lat)] as [number, number]] as const;
        }
        const photonResponse = await fetch(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(address)}`);
        const photonResult = await photonResponse.json();
        const photonCoordinates = photonResult?.features?.[0]?.geometry?.coordinates;
        if (photonCoordinates?.length >= 2) {
          return [String(delivery.id || delivery.orderId), [Number(photonCoordinates[0]), Number(photonCoordinates[1])] as [number, number]] as const;
        }
      } catch {
        // The API may already provide coordinates; geocoding is only a fallback.
      }
      return null;
    })).then((results) => {
      if (cancelled) return;
      const resolved: Record<string, [number, number]> = {};
      results.forEach((result) => { if (result) resolved[result[0]] = result[1]; });
      if (Object.keys(resolved).length) setGeocodedOrders((current) => ({ ...current, ...resolved }));
    });

    return () => { cancelled = true; };
  }, [deliveries]);

  const nearbyDeliveries = useMemo(() => {
    if (!partnerLocation) return [];
    const localNearbyDeliveries = deliveries
      .map((delivery: any) => {
        const coordinates = getCoordinates(delivery.deliveryAddress)
          || getCoordinates(delivery.address)
          || getCoordinates(delivery.location)
          || (delivery.longitude != null && delivery.latitude != null
            ? [Number(delivery.longitude), Number(delivery.latitude)] as [number, number]
            : null)
          || geocodedOrders[String(delivery.id || delivery.orderId)];
        if (!coordinates) return null;
        const distance = distanceBetweenKm(partnerLocation, { lat: coordinates[1], lng: coordinates[0] });
        return { ...delivery, distanceFromPartnerKm: distance };
      })
      .filter((delivery: any) => delivery && delivery.distanceFromPartnerKm <= nearbyRadius);
    const serverNearbyOrders = nearbyOrdersData?.data;
    const serverResults = Array.isArray(serverNearbyOrders)
      ? serverNearbyOrders
        .map((delivery: any) => ({
          ...delivery,
          distanceFromPartnerKm: Number(delivery.distance ?? delivery.distanceFromPartnerKm),
        }))
        .filter((delivery: any) => Number.isFinite(delivery.distanceFromPartnerKm))
        : [];
    const merged = new Map<string, any>();
    [...localNearbyDeliveries, ...serverResults].forEach((delivery: any) => {
      const key = String(delivery.orderId || delivery.id || delivery._id || "");
      if (key && !merged.has(key)) merged.set(key, delivery);
    });
    return [...merged.values()].sort((a: any, b: any) => a.distanceFromPartnerKm - b.distanceFromPartnerKm);
  }, [deliveries, partnerLocation, nearbyRadius, geocodedOrders, nearbyOrdersData]);
  const nearbyRouteOrders = useMemo(
    () => nearbyDeliveries.filter((delivery: any) => !isAcceptedDelivery(delivery) && isReadyDelivery(delivery)),
    [nearbyDeliveries]
  );
  const acceptedDeliveries = useMemo(() => {
    const accepted = deliveries.filter(isAcceptedDelivery);
    const nearbyAccepted = nearbyDeliveries.filter(isAcceptedDelivery);
    const merged = new Map<string, any>();
    [...nearbyAccepted, ...accepted].forEach((delivery: any) => {
      const key = getOrderId(delivery);
      if (key && !merged.has(key)) merged.set(key, delivery);
    });
    return [...merged.values()].sort((a: any, b: any) => {
      const aDistance = Number(a.distanceFromPartnerKm ?? Number.MAX_SAFE_INTEGER);
      const bDistance = Number(b.distanceFromPartnerKm ?? Number.MAX_SAFE_INTEGER);
      return aDistance - bDistance;
    });
  }, [deliveries, nearbyDeliveries]);
  const deliveredDeliveries = useMemo(() => {
    const delivered = deliveries.filter(isDeliveredDelivery);
    const nearbyDelivered = nearbyDeliveries.filter(isDeliveredDelivery);
    const merged = new Map<string, any>();
    [...nearbyDelivered, ...delivered].forEach((delivery: any) => {
      const key = getOrderId(delivery);
      if (key && !merged.has(key)) merged.set(key, delivery);
    });
    return [...merged.values()].sort((a: any, b: any) => {
      const aTime = new Date(a.completedAt || a.deliveredAt || a.updatedAt || a.orderDate || 0).getTime();
      const bTime = new Date(b.completedAt || b.deliveredAt || b.updatedAt || b.orderDate || 0).getTime();
      return bTime - aTime;
    });
  }, [deliveries, nearbyDeliveries]);
  const nearbyRouteOrderIds = nearbyRouteOrders.map(getOrderId).filter(Boolean);
  const acceptedRouteOrderIds = acceptedDeliveries.map(getOrderId).filter(Boolean);
  const routeBenefit = useMemo(() => {
    if (!partnerLocation || nearbyRouteOrders.length < 2) return null;
    const directDistance = nearbyRouteOrders.reduce((sum: number, delivery: any) => sum + Number(delivery.distanceFromPartnerKm || 0) * 2, 0);
    let routeDistance = Number(nearbyRouteOrders[0]?.distanceFromPartnerKm || 0);
    for (let index = 1; index < nearbyRouteOrders.length; index += 1) {
      const previous = nearbyRouteOrders[index - 1];
      const current = nearbyRouteOrders[index];
      const previousCoordinates = getCoordinates(previous.deliveryAddress) || getCoordinates(previous.address);
      const currentCoordinates = getCoordinates(current.deliveryAddress) || getCoordinates(current.address);
      if (previousCoordinates && currentCoordinates) {
        routeDistance += distanceBetweenKm(
          { lat: previousCoordinates[1], lng: previousCoordinates[0] },
          { lat: currentCoordinates[1], lng: currentCoordinates[0] }
        );
      } else {
        routeDistance += Number(current.distanceFromPartnerKm || 0);
      }
    }
    const saving = Math.max(0, directDistance - routeDistance);
    return { routeDistance, saving };
  }, [nearbyRouteOrders, partnerLocation]);
  const nearestDelivery = useMemo(() => {
    if (!partnerLocation) return null;
    return deliveries
      .map((delivery: any) => {
        const coordinates = getCoordinates(delivery.deliveryAddress)
          || getCoordinates(delivery.address)
          || getCoordinates(delivery.location)
          || (delivery.longitude != null && delivery.latitude != null
            ? [Number(delivery.longitude), Number(delivery.latitude)] as [number, number]
            : null)
          || geocodedOrders[String(delivery.id || delivery.orderId)];
        if (!coordinates) return null;
        return {
          ...delivery,
          distanceFromPartnerKm: distanceBetweenKm(partnerLocation, { lat: coordinates[1], lng: coordinates[0] }),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.distanceFromPartnerKm - b.distanceFromPartnerKm)[0] || null;
  }, [deliveries, partnerLocation, geocodedOrders]);
  const prioritizedDeliveries = useMemo(() => [...deliveries].sort((a: any, b: any) => {
    const aDate = a.requestedDeliveryDate ? new Date(a.requestedDeliveryDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bDate = b.requestedDeliveryDate ? new Date(b.requestedDeliveryDate).getTime() : Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  }), [deliveries]);

  const freshnessLabel = (delivery: any) => {
    if (!delivery.requestedDeliveryDate) return null;
    const date = new Date(delivery.requestedDeliveryDate);
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    return { isToday, date: isToday ? "Today" : "Tomorrow", slot: delivery.deliveryTimeSlot?.replace(/_/g, " ") || "Any time" };
  };

  const handleAccept = async (delivery: any) => {
    const orderId = getOrderId(delivery);
    // Assignment records have different ids from their orders. Direct order
    // fallbacks use the same id, so use the assignment endpoint only when we
    // can identify a real assignment record.
    const assignmentId = getAssignmentId(delivery);
    if (!orderId) return;
    setAcceptingOrderId(orderId);
    try {
      const res = assignmentId
        ? await api.put(`/delivery/assignments/${assignmentId}/accept`)
        : await api.put(`/delivery/orders/${orderId}/accept`);
      if (res?.success) {
        toast.success("Delivery accepted!");
        void refetchDeliveries();
      } else {
        toast.error(res?.detail || "Failed to accept delivery");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to accept delivery");
    } finally {
      setAcceptingOrderId(null);
    }
  };

  const handleAcceptNearby = async () => {
    const readyOrders = nearbyRouteOrders;
    if (!readyOrders.length) {
      toast.error("No ready orders in this nearby radius");
      return;
    }
    setAcceptingNearby(true);
    try {
      for (const delivery of readyOrders) await handleAccept(delivery);
      toast.success(`${readyOrders.length} nearby orders accepted for one route`);
      await refetchDeliveries();
    } catch (err: any) {
      toast.error(err?.message || "Some nearby orders could not be accepted");
    } finally {
      setAcceptingNearby(false);
    }
  };

  const handleMarkDelivered = async (delivery: any) => {
    const orderId = getOrderId(delivery);
    const assignmentId = getAssignmentId(delivery);
    try {
      const res = await api.put(`/orders/${orderId}/status`, { status: "delivered" });
      if (res?.success) {
        toast.success("Order delivered!");
        void refetchDeliveries();
      } else {
        if (assignmentId) {
          await api.put(`/delivery/assignments/${assignmentId}/complete`);
          toast.success("Delivery completed!");
        } else {
          toast.error(res?.detail || "Failed to mark delivered");
        }
        void refetchDeliveries();
      }
    } catch (err: any) {
      if (assignmentId) {
        try {
          await api.put(`/delivery/assignments/${assignmentId}/complete`);
          toast.success("Delivery completed!");
          void refetchDeliveries();
          return;
        } catch {
          // Surface the original status update error below.
        }
      }
      toast.error(err?.message || "Failed to mark delivered");
    }
  };

  const handlePodUpload = async (assignmentId: string, file: File) => {
    if (!file) return;
    setUploadingId(assignmentId);
    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("recipientName", "Customer");
      const signature = window.prompt("Enter recipient signature/name") || "";
      form.append("signature", signature);
      const res = await fetch(
        `/api/v1/delivery/assignments/${assignmentId}/pod`,
        {
          method: "POST",
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        }
      );
      if (!res.ok) throw new Error("Upload failed");
      toast.success("Proof of delivery uploaded");
      void refetchDeliveries();
    } catch (err: any) {
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploadingId(null);
    }
  };

  const podUses = (delivery: any) => {
    const assignmentId = String(delivery.id || delivery._id || delivery.orderId || "");
    return { assignmentId };
  };

  const handleShare = async (orderId: string) => {
    try {
      const res = await api.post(`/delivery/orders/${orderId}/share`);
      const url = res?.data?.shareUrl;
      if (!url) throw new Error("No link returned");
      await navigator.clipboard.writeText(url);
      toast.success("Tracking link copied to clipboard");
    } catch (err: any) {
      toast.error(err?.message || "Failed to create link");
    }
  };

  const openLiveRouteForOrder = (delivery: any) => {
    const orderId = getOrderId(delivery);
    if (!orderId) {
      toast.error("Order id is not available for this delivery");
      return;
    }
    router.push(`/delivery/route?orderIds=${encodeURIComponent(orderId)}&radius=${nearbyRadius}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Delivery workbench</p>
        <h1 className="text-3xl font-semibold tracking-tight">My Deliveries</h1>
        <p className="mt-1 text-sm text-muted-foreground">Orders to deliver — assigned and available.</p>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Nearby single route</CardTitle>
              <CardDescription>
                {partnerLocation
                  ? `${nearbyRouteOrders.length} available orders within ${nearbyRadius} km${locationUpdatedAt ? ` (${locationUpdatedAt.toLocaleTimeString()})` : ""}${locationAccuracy != null ? ` - accuracy +/- ${Math.round(locationAccuracy)} m` : ""}.`
                  : "Use your current location to find nearby orders that can be accepted as one route."}
              </CardDescription>
              {routeBenefit && (
                <p className="mt-2 text-xs font-medium text-emerald-700">
                  Optimized as one route: about {routeBenefit.routeDistance.toFixed(1)} km, saving up to {routeBenefit.saving.toFixed(1)} km versus separate trips.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {[5, 10, 20, 25, 50].map((distance) => (
                <Button key={distance} size="sm" variant={nearbyRadius === distance ? "default" : "outline"} onClick={() => selectNearbyRadius(distance)} disabled={locationLoading}>
                  {distance} km
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {!partnerLocation ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              <p>{locationError ? "Location access was not available." : "Getting your current location..."}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={requestLiveLocation} disabled={locationLoading}>
                {locationLoading ? "Locating..." : "Use my current location"}
              </Button>
            </div>
          ) : nearbyRouteOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              <p>No available nearby route orders are within {nearbyRadius} km.</p>
              {nearestDelivery ? (
                <p className="mt-1">Nearest order is {nearestDelivery.distanceFromPartnerKm.toFixed(1)} km away. Use your current location or choose a larger radius.</p>
              ) : (
                <p className="mt-1">Order locations are not available yet. Refresh after location lookup completes.</p>
              )}
              <Button size="sm" variant="outline" className="mt-3" onClick={requestLiveLocation} disabled={locationLoading}>
                {locationLoading ? "Locating..." : "Use current location"}
              </Button>
            </div>
          ) : (
            nearbyRouteOrders.map((delivery: any, index: number) => (
              <div key={`nearby-${getOrderId(delivery)}`} className="flex items-center justify-between rounded-lg border bg-white p-3">
                <div className="min-w-0">
                  <p className="font-medium">{index + 1}. {delivery.customerName || "Customer"}</p>
                  <p className="truncate text-sm text-muted-foreground">{formatAddress(delivery.deliveryAddress)}</p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contactCustomer(delivery.customerPhone, "call")} aria-label="Call customer"><Phone className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contactCustomer(delivery.customerPhone, "message")} aria-label="Message customer"><MessageSquare className="h-4 w-4" /></Button>
                  <Badge variant="success">{delivery.distanceFromPartnerKm.toFixed(1)} km</Badge>
                  <Badge variant={statusVariant[delivery.status] || "default"}>{delivery.status?.replace("_", " ")}</Badge>
                  <Button size="sm" onClick={() => handleAccept(delivery)} disabled={acceptingOrderId === getOrderId(delivery) || acceptingNearby}>
                    {acceptingOrderId === getOrderId(delivery) ? "Accepting..." : "Accept"}
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/delivery/route?orderIds=${encodeURIComponent(nearbyRouteOrderIds.join(","))}&radius=${nearbyRadius}`}>
                      <Navigation className="mr-1.5 h-4 w-4" />Preview Route
                    </Link>
                  </Button>
                </div>
              </div>
            ))
          )}
          {nearbyRouteOrders.length > 0 && (
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button className="flex-1" onClick={handleAcceptNearby} disabled={acceptingNearby}>
                {acceptingNearby ? "Accepting route orders..." : "Accept single route"}
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href={`/delivery/route?orderIds=${encodeURIComponent(nearbyRouteOrderIds.join(","))}&radius=${nearbyRadius}`}>Preview single route</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-blue-200 bg-blue-50/30">
        <CardHeader>
          <CardTitle>Accepted orders</CardTitle>
          <CardDescription>Orders you accepted are kept separate so you can start the live route when ready.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {acceptedDeliveries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No accepted orders yet. Accept nearby route orders to start delivery.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 rounded-lg border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Accepted route</p>
                  <p className="text-sm text-muted-foreground">{acceptedDeliveries.length} order{acceptedDeliveries.length > 1 ? "s" : ""} ready for live routing.</p>
                </div>
                <Button asChild>
                  <Link href={`/delivery/route?orderIds=${encodeURIComponent(acceptedRouteOrderIds.join(","))}&radius=${nearbyRadius}`}>
                    <Navigation className="mr-2 h-4 w-4" />Start Route
                  </Link>
                </Button>
              </div>
              {acceptedDeliveries.map((delivery: any, index: number) => (
                <div key={`accepted-${getOrderId(delivery)}`} className="flex items-center justify-between rounded-lg border bg-white p-3">
                  <div className="min-w-0">
                    <p className="font-medium">{index + 1}. {delivery.customerName || delivery.orderNumber || "Accepted order"}</p>
                    <p className="truncate text-sm text-muted-foreground">{formatAddress(delivery.deliveryAddress || delivery.address)}</p>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-2">
                    {delivery.distanceFromPartnerKm != null && <Badge variant="success">{Number(delivery.distanceFromPartnerKm).toFixed(1)} km</Badge>}
                    <Badge variant={statusVariant[getDeliveryStatus(delivery)] || "default"}>{getDeliveryStatus(delivery).replace("_", " ")}</Badge>
                    <Button size="sm" variant="success" onClick={() => handleMarkDelivered(delivery)}>
                      <CheckCircle className="mr-1.5 h-4 w-4" />Delivered
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openLiveRouteForOrder(delivery)}>
                      <Navigation className="mr-1.5 h-4 w-4" />Start
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-green-200 bg-green-50/30">
        <CardHeader>
          <CardTitle>Delivered orders</CardTitle>
          <CardDescription>Completed orders move here after delivery, keeping accepted orders ready for the next route.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {deliveredDeliveries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No delivered orders yet. Completed orders will appear here.</p>
          ) : (
            deliveredDeliveries.map((delivery: any, index: number) => (
              <div key={`delivered-${getOrderId(delivery)}`} className="flex items-center justify-between rounded-lg border bg-white p-3">
                <div className="min-w-0">
                  <p className="font-medium">{index + 1}. {delivery.customerName || delivery.orderNumber || "Delivered order"}</p>
                  <p className="truncate text-sm text-muted-foreground">{formatAddress(delivery.deliveryAddress || delivery.address)}</p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-2">
                  {delivery.totalAmount && <span className="text-sm font-medium text-slate-700">₹{delivery.totalAmount}</span>}
                  <Badge variant="success">Delivered</Badge>
                  <Button size="sm" variant="outline" onClick={() => handleShare(getOrderId(delivery))}>
                    <Share2 className="mr-1.5 h-4 w-4" />Share
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All assigned orders</CardTitle>
          <CardDescription>Every order assigned by farmers, including orders outside your nearby radius.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : deliveries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No orders available for delivery.</p>
          ) : (
            prioritizedDeliveries.map((delivery: any) => (
              <div key={delivery.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">{delivery.orderNumber || delivery.id}</p>
                  <p className="text-sm text-muted-foreground">
                    {delivery.customerName || "Customer"} - {formatAddress(delivery.deliveryAddress)}
                  </p>
                  {delivery.totalAmount && (
                    <p className="text-sm text-muted-foreground">₹{delivery.totalAmount}</p>
                  )}
                  {delivery.items && delivery.items.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {delivery.items.map((i: any) => i.productName).join(", ")}
                    </p>
                  )}
                  {freshnessLabel(delivery) && (
                    <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${freshnessLabel(delivery)?.isToday ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                      {freshnessLabel(delivery)?.isToday ? <Zap className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                      {freshnessLabel(delivery)?.date} · {freshnessLabel(delivery)?.slot}
                      {freshnessLabel(delivery)?.isToday && <span className="ml-1">Freshness priority</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={statusVariant[delivery.status] || "default"}>
                    {delivery.status?.replace("_", " ")}
                  </Badge>
                  {delivery.status === "ready_for_delivery" && (
                    <Button size="sm" onClick={() => handleAccept(delivery)}>
                      <CheckCircle className="mr-1.5 h-4 w-4" />Accept
                    </Button>
                  )}
                  {(delivery.status === "in_transit" || delivery.status === "dispatched" || delivery.status === "picked_up") && (
                    <Button size="sm" variant="success" onClick={() => handleMarkDelivered(delivery)}>
                      <CheckCircle className="mr-1.5 h-4 w-4" />Mark Delivered
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => handleShare(delivery.orderId || delivery.id)}>
                    <Share2 className="mr-1.5 h-4 w-4" />Share
                  </Button>
                  <>
                    <input
                      ref={(el) => { fileRefs.current[podUses(delivery).assignmentId] = el; }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        const aid = podUses(delivery).assignmentId;
                        if (f && aid) handlePodUpload(aid, f);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploadingId === podUses(delivery).assignmentId}
                      onClick={() => fileRefs.current[podUses(delivery).assignmentId]?.click()}
                    >
                      {uploadingId === podUses(delivery).assignmentId
                        ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        : <Camera className="mr-1.5 h-4 w-4" />}
                      POD
                    </Button>
                  </>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/delivery/route?orderId=${encodeURIComponent(String(delivery.orderId || delivery.id || ""))}`}>Open</Link>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
