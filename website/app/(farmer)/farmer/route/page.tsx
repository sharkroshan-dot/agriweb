"use client";
import { DeliveryWorkflowNav } from "../../../components/farmer/delivery-workflow-nav";
import { useSearchParams } from "next/navigation";

import React, { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  MapPin,
  Navigation,
  Clock,
  Truck,
  CheckCircle,
  Phone,
  MessageSquare,
  AlertCircle,
  Route,
  Calendar,
  Play,
  Home,
  CloudSun,
  Crosshair,
  DollarSign,
  Package,
  Users,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  QrCode,
  Wallet,
  XCircle,
  Loader2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { api } from "../../../lib/api/client";
import { cn, formatPrice } from "../../../lib/utils";
import { Map } from "../../../components/shared/map";
import toast from "react-hot-toast";

interface Stop {
  id: string;
  orderId: string;
  orderNumber: string;
  buyerName: string;
  location: string;
  city: string;
  lat: number | null;
  lng: number | null;
  quantity: string;
  quantityKg: number;
  product: string;
  items: { name: string; quantity: number }[];
  status: string;
  time: string;
  deliveryType: string;
  distance: number;
  total: number;
  customerPhone: string;
  isCOD?: boolean;
  paymentMethod?: string;
  priority?: number;
}

const priorityInfo = (p?: number) => {
  const v = Number(p ?? 1);
  if (v >= 3) return { label: "Critical priority", cls: "border-red-300 bg-red-50 text-red-600" };
  if (v === 2) return { label: "High priority", cls: "border-amber-300 bg-amber-50 text-amber-700" };
  if (v <= 0) return { label: "Low priority", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  return null;
};

function distanceKmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface Farm {
  name: string;
  lat: number | null;
  lng: number | null;
  address: string;
}

interface RouteData {
  route: Stop[];
  summary: {
    totalDistance: number;
    totalDuration: number;
    totalQuantity: number;
    totalRevenue: number;
    totalStops: number;
    pendingStops: number;
  };
  farm: Farm;
}

const getStatusBadge = (status: string, done?: boolean) => {
  if (done || status === "completed") return <Badge variant="success">Completed</Badge>;
  switch (status) {
    case "in_transit":
    case "dispatched":
      return <Badge variant="warning">In Progress</Badge>;
    case "ready_for_delivery":
      return <Badge variant="default">Ready to Deliver</Badge>;
    case "ready_for_pickup":
      return <Badge variant="default">Ready for Pickup</Badge>;
    case "pending":
      return <Badge variant="secondary">Pending</Badge>;
    default:
      return <Badge variant="outline">{status.replace(/_/g, " ")}</Badge>;
  }
};

const PROBLEM_CATEGORIES = [
  { value: "customer_unavailable", label: "Customer unavailable" },
  { value: "wrong_address", label: "Wrong address" },
  { value: "customer_cancelled", label: "Customer cancelled" },
  { value: "vehicle_problem", label: "Vehicle problem" },
  { value: "product_damaged", label: "Product damaged" },
  { value: "payment_problem", label: "Payment problem" },
  { value: "weather_problem", label: "Weather problem" },
  { value: "other", label: "Other" },
] as const;

const isPickupStop = (stop: Stop) =>
  stop.deliveryType === "pickup" || stop.status === "ready_for_pickup";

function RouteMap({
  farm,
  stops,
  started,
  nextStop,
  userLocation,
  routePoints,
}: {
  farm: Farm;
  stops: Stop[];
  started: boolean;
  nextStop: Stop | null;
  userLocation: { lat: number; lng: number } | null;
  routePoints: { lat: number; lng: number }[];
}) {
  const completedIds = new Set(
    stops.filter((s) => s.status === "delivered" || s.status === "picked_up").map((s) => s.id)
  );
  const pendingStops = stops.filter((s) => !completedIds.has(s.id));

  // Keep map stop numbers identical to the numbered location groups in the
  // delivery schedule. Several orders at one address produce one map pin.
  const groups = new globalThis.Map<string, { location: string; city: string; stops: Stop[] }>();
  for (const stop of pendingStops) {
    const normalize = (value: string) => String(value || "").trim().toLowerCase()
      .replace(/[.,#]/g, " ").replace(/\\s+/g, " ").replace(/\\s*,\\s*/g, ", ");
    const address = normalize(stop.location);
    const city = normalize(stop.city);
    const coordinateKey = stop.lat != null && stop.lng != null
      ? `${Number(stop.lat).toFixed(5)},${Number(stop.lng).toFixed(5)}`
      : "";
    const key = address || city ? `${address}|${city}` : coordinateKey || `order:${stop.id}`;
    const current = groups.get(key);
    if (current) current.stops.push(stop);
    else groups.set(key, { location: stop.location || "Address unavailable", city: stop.city || "", stops: [stop] });
  }
  const locationGroups = Array.from(groups.values());
  const markers = [
    ...(!started && (farm.lat != null && farm.lng != null || farm.address)
      ? [{
          id: "farm",
          ...(farm.lat != null && farm.lng != null ? { lat: farm.lat, lng: farm.lng } : {}),
          title: farm.name,
          color: "#7c3aed",
          label: "F",
          address: farm.address,
          info: "Route starting point",
        }]
      : []),
    ...locationGroups.map((group, index) => {
      const representative = group.stops.find((s) => s.lat != null && s.lng != null);
      const address = [group.location, group.city].filter(Boolean).join(", ");
      const orderLines = group.stops.map((s) => `#${s.orderNumber} · ${s.buyerName} · ${s.quantity} ${s.product}`).join("<br/>");
      const isNext = group.stops.some((s) => s.id === nextStop?.id);
      return {
        id: `delivery-location-${index + 1}`,
        ...(representative ? { lat: representative.lat as number, lng: representative.lng as number } : {}),
        title: `${index + 1}. ${address} · ${group.stops.length} ${group.stops.length === 1 ? "order" : "orders"}`,
        color: isNext ? "#2563eb" : "#059669",
        label: String(index + 1),
        displayLabel: `${index + 1} · ${group.stops.length} ${group.stops.length === 1 ? "order" : "orders"}`,
        address,
        info: `${address}<br/><strong>${group.stops.length} orders at this location</strong><br/>${orderLines}`,
      };
    }),
  ];

  const locatedStops = locationGroups.flatMap((group) =>
    group.stops.filter((s): s is Stop & { lat: number; lng: number } => s.lat != null && s.lng != null)
  );
  const hasFarmCoords = farm.lat != null && farm.lng != null;
  const center = userLocation || (hasFarmCoords
    ? { lat: farm.lat as number, lng: farm.lng as number }
    : locatedStops.length > 0
      ? { lat: locatedStops[0].lat, lng: locatedStops[0].lng }
      : { lat: 20.5937, lng: 78.9629 });

  // Use one coordinate per physical delivery location so duplicate orders do
  // not create repeated route waypoints at the same landmark.
  const groupedRoutePoints = locationGroups.flatMap((group) => {
    const point = group.stops.find((s) => s.lat != null && s.lng != null);
    return point ? [{ lat: point.lat as number, lng: point.lng as number }] : [];
  });

  return (
    <Map
      center={center}
      zoom={hasFarmCoords || locatedStops.length > 0 ? 10 : 5}
      height="420px"
      markers={markers}
      route={groupedRoutePoints.length ? groupedRoutePoints : routePoints}
      trackUserLocation={true}
      userLocation={userLocation}
      className="rounded-lg"
    />
  );
}

function WeatherCard({ farm }: { farm: Farm }) {
  const [weather, setWeather] = useState<{
    temperature: number;
    windSpeed: number;
    precipitation: number;
    code: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (farm.lat == null || farm.lng == null) return;
    let cancelled = false;
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${farm.lat}&longitude=${farm.lng}&current_weather=true&timezone=auto`
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.current_weather) return;
        const cw = data.current_weather;
        setWeather({
          temperature: cw.temperature,
          windSpeed: cw.windspeed,
          precipitation: cw.precipitation ?? 0,
          code: cw.weathercode,
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [farm.lat, farm.lng]);

  const isRainy = weather ? weather.code >= 51 && weather.code <= 67 : false;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CloudSun className="h-5 w-5 text-sky-500" />
            <span className="text-sm font-medium">Weather today</span>
          </div>
          {weather && (
            <span className="text-2xl font-bold text-gray-900">{Math.round(weather.temperature)}°C</span>
          )}
        </div>
        {failed ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Weather unavailable for your farm location.
          </p>
        ) : weather ? (
          <div className="mt-2 space-y-1 text-sm text-muted-foreground">
            <p>
              Wind <span className="font-medium text-gray-700">{weather.windSpeed} km/h</span>
            </p>
            <p>
              Rain <span className="font-medium text-gray-700">{weather.precipitation} mm</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5">
              {isRainy ? (
                <AlertCircle className="h-4 w-4 text-amber-500" />
              ) : (
                <CheckCircle className="h-4 w-4 text-emerald-500" />
              )}
              <span className={cn("font-medium", isRainy ? "text-amber-600" : "text-emerald-600")}>
                {isRainy ? "Rain possible — allow extra travel time" : "Good conditions for delivery"}
              </span>
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Loading weather…</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function FarmerRoutePage() {
  const searchParams = useSearchParams();
  const workflowOrderIds = searchParams.get("orderIds") || "";

  const [started, setStarted] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(true);
  const [arrivalStopId, setArrivalStopId] = useState<string | null>(null);
  const lastLocationSyncRef = useRef(0);
  const arrivalAnnouncedRef = useRef<string | null>(null);
  const watchRef = useRef<number | null>(null);

  // Request location permission and begin live GPS tracking as soon as the
  // farmer opens My Delivery Route. The same live fix drives the map and the
  // Google Maps navigation origin; it is not necessary to press Track Me.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      toast.error("This browser does not support live location tracking.");
      return;
    }

    let active = true;
    setTracking(true);
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (!active) return;
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setTracking(true);
      },
      (error) => {
        if (!active) return;
        setTracking(false);
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("Allow location access in your browser to track your position and build the delivery route.");
        } else if (error.code === error.TIMEOUT) {
          toast.error("Getting your current location is taking too long. Check GPS and try again.");
        } else {
          toast.error("Your current location is unavailable. Check GPS and browser location permission.");
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 }
    );

    return () => {
      active = false;
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, []);
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const [pickupTarget, setPickupTarget] = useState<Stop | null>(null);
  const [pickupCode, setPickupCode] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const scannerRef = useRef<any>(null);
  const [problemTarget, setProblemTarget] = useState<Stop | null>(null);
  const [problemCategory, setProblemCategory] = useState<string>(PROBLEM_CATEGORIES[0].value);
  const [problemNote, setProblemNote] = useState("");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["farmerRoute", workflowOrderIds],
    queryFn: () => api.get(`/farmers/me/route${workflowOrderIds ? `?orderIds=${encodeURIComponent(workflowOrderIds)}` : ""}`),
    enabled: Boolean(accessToken),
  });

  // Use the same optimized stop sequence as Smart Route Planner so the map,
  // delivery list and navigation all follow the shortest available road route.
  const { data: optimizedRouteData } = useQuery({
    queryKey: ["farmerRouteOptimizedStops", workflowOrderIds],
    queryFn: () => api.get(`/farmers/me/smart-route${workflowOrderIds ? `?orderIds=${encodeURIComponent(workflowOrderIds)}` : ""}`),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const routeData: RouteData | undefined = data?.data;
  const rawStops: Stop[] = routeData?.route ?? [];
  const optimizedStops: any[] =
    (optimizedRouteData as any)?.stops ??
    (optimizedRouteData as any)?.data?.stops ??
    [];
  const stops: Stop[] = optimizedStops.length
    ? optimizedStops
        .map((optimized) => rawStops.find((stop) =>
          String(stop.orderId) === String(optimized.orderId) ||
          String(stop.id) === String(optimized.orderId) ||
          String(stop.orderNumber) === String(optimized.orderNumber)
        ))
        .filter((stop): stop is Stop => Boolean(stop))
        .concat(rawStops.filter((stop) =>
          !optimizedStops.some((optimized) =>
            String(stop.orderId) === String(optimized.orderId) ||
            String(stop.id) === String(optimized.orderId) ||
            String(stop.orderNumber) === String(optimized.orderNumber)
          )
        ))
    : rawStops;
  const summary = routeData?.summary;
  const farm: Farm = routeData?.farm ?? { name: "My Farm", lat: null, lng: null, address: "" };

  // Group orders by their actual delivery destination. Multiple orders for the
  // same address become one physical stop in the schedule, while each order
  // retains its own status, contact and completion actions.
  const locationGroups = (() => {
    const groups = new globalThis.Map<string, { key: string; location: string; city: string; stops: Stop[] }>();
    for (const stop of stops) {
      const normalizedAddress = String(stop.location || "").trim().toLowerCase().replace(/[.,#]/g, " ").replace(/\\s+/g, " ");
      const normalizedCity = String(stop.city || "").trim().toLowerCase().replace(/[.,#]/g, " ").replace(/\\s+/g, " ");
      const coordinateKey = stop.lat != null && stop.lng != null
        ? `${Number(stop.lat).toFixed(5)},${Number(stop.lng).toFixed(5)}`
        : "";
      const key = normalizedAddress || normalizedCity
        ? `${normalizedAddress}| ${normalizedCity}`
        : coordinateKey || `order:${stop.id}`;
      const existing = groups.get(key);
      if (existing) existing.stops.push(stop);
      else groups.set(key, { key, location: stop.location || "Address unavailable", city: stop.city || "", stops: [stop] });
    }
    return Array.from(groups.values());
  })();

  const doneCount = stops.filter((s) => s.status === "delivered" || s.status === "picked_up").length;
  const progress = stops.length ? Math.round((doneCount / stops.length) * 100) : 0;
  const nextStop = stops.find((s) => s.status !== "delivered" && s.status !== "picked_up") ?? null;

  // Send GPS heartbeat to the authenticated backend while a delivery route
  // is active. Throttle updates to avoid writing every high-frequency GPS fix.
  useEffect(() => {
    if (!started || !userLocation) return;
    const now = Date.now();
    if (now - lastLocationSyncRef.current < 15000) return;
    lastLocationSyncRef.current = now;
    api.post("/farmers/me/route/location", {
      lat: userLocation.lat,
      lng: userLocation.lng,
      recordedAt: new Date(now).toISOString(),
    }).catch(() => {
      // GPS remains visible locally; a transient network issue must not stop navigation.
    });
  }, [started, userLocation]);

  // Detect arrival near the next customer. Delivery is never auto-completed:
  // the farmer must still verify the customer's OTP.
  useEffect(() => {
    if (!started || !nextStop || !userLocation || nextStop.lat == null || nextStop.lng == null) {
      setArrivalStopId(null);
      return;
    }
    const distance = distanceKmBetween(userLocation, { lat: nextStop.lat, lng: nextStop.lng });
    if (distance <= 0.15) {
      setArrivalStopId(nextStop.id);
      if (arrivalAnnouncedRef.current !== nextStop.id) {
        arrivalAnnouncedRef.current = nextStop.id;
        toast.success(`You have arrived near ${nextStop.buyerName}. Verify the customer's OTP to complete delivery.`);
      }
    } else {
      setArrivalStopId(null);
      if (arrivalAnnouncedRef.current === nextStop.id) arrivalAnnouncedRef.current = null;
    }
  }, [started, nextStop?.id, nextStop?.lat, nextStop?.lng, userLocation]);

  const navigationWindowRef = useRef<Window | null>(null);

  const buildGoogleNavigationUrl = (target: Stop, includeRemainingStops = false, completedStopId?: string) => {
    const pendingStops = stops.filter((stop) =>
      stop.id !== completedStopId &&
      stop.status !== "delivered" && stop.status !== "picked_up"
    );
    const targetIndex = pendingStops.findIndex((stop) => stop.id === target.id);
    // Google Maps Directions URLs support up to 9 intermediate waypoints.
    // Continue with the next group after each completed delivery.
    const orderedStops = includeRemainingStops && targetIndex >= 0
      ? pendingStops.slice(targetIndex, targetIndex + 10)
      : [target];

    const toGooglePlace = (stop: Stop) =>
      stop.lat != null && stop.lng != null
        ? `${stop.lat},${stop.lng}`
        : [stop.location, stop.city].filter(Boolean).join(", ");

    // Google Maps uses destination as the FINAL point and waypoints as
    // intermediate points. Preserve the exact sequence shown in the schedule.
    const finalStop = orderedStops[orderedStops.length - 1];
    const params = new URLSearchParams({
      api: "1",
      destination: toGooglePlace(finalStop),
      travelmode: "driving",
      dir_action: "navigate",
    });

    if (userLocation) {
      params.set("origin", `${userLocation.lat},${userLocation.lng}`);
    } else if (farm.lat != null && farm.lng != null) {
      params.set("origin", `${farm.lat},${farm.lng}`);
    } else if (farm.address) {
      params.set("origin", farm.address);
    }

    const waypoints = orderedStops.slice(0, -1).map(toGooglePlace).filter(Boolean);
    if (waypoints.length) params.set("waypoints", waypoints.join("|"));
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  };

  const navigateToStop = (stop: Stop) => {
    window.open(buildGoogleNavigationUrl(stop), "_blank", "noopener,noreferrer");
  };

  // Announce each new destination in the page. Google Maps remains responsible
  // for continuous turn-by-turn voice guidance and live road rerouting.
  useEffect(() => {
    if (!started || !nextStop || !voiceGuidanceEnabled || typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const announcement = new SpeechSynthesisUtterance(
      `Next delivery: ${nextStop.buyerName}. ${[nextStop.location, nextStop.city].filter(Boolean).join(", ")}.`
    );
    announcement.rate = 1;
    window.speechSynthesis.speak(announcement);
    return () => window.speechSynthesis.cancel();
  }, [started, nextStop?.id, voiceGuidanceEnabled]);

  const startMutation = useMutation({
    mutationFn: () => api.put(`/farmers/me/route/start${workflowOrderIds ? `?orderIds=${encodeURIComponent(workflowOrderIds)}` : ""}`),
    onSuccess: (res: any) => {
      const updatedStops = Number(res?.data?.updatedStops ?? res?.updatedStops ?? 0);
      setStarted(true);
      refetch();
      const firstPendingStop = stops.find((stop) =>
        stop.status !== "delivered" && stop.status !== "picked_up"
      );
      if (firstPendingStop) {
        const navigationUrl = buildGoogleNavigationUrl(firstPendingStop, true);
        if (navigationWindowRef.current && !navigationWindowRef.current.closed) {
          navigationWindowRef.current.location.href = navigationUrl;
        } else {
          window.open(navigationUrl, "_blank", "noopener,noreferrer");
        }
      }
      // GPS tracking is already active from page entry; retain the latest
      // location fix for the navigation origin and route-following map.
      if (updatedStops > 0) {
        toast.success("Delivery route started. Live location tracking is active; follow the next-stop guidance on this page.");
      } else {
        toast("Route view started. The server reported no new status changes; verify order statuses before delivery.", { icon: "📍", duration: 6500 });
      }
    },
    onError: () => {
      if (navigationWindowRef.current && !navigationWindowRef.current.closed) {
        navigationWindowRef.current.close();
        navigationWindowRef.current = null;
      }
      toast.error("Could not start the delivery route. Please refresh and try again.");
    },
  });

  const completeMutation = useMutation({
    mutationFn: (stop: Stop) =>
      api.put(`/farmers/me/route/${stop.orderId}/status`, {
        status: stop.deliveryType === "pickup" ? "picked_up" : "delivered",
        note: "Farmer completed stop on route",
      }),
    onSuccess: (_data, stop) => {
      toast.success(`${stop.buyerName} stop completed!`);
      const remainingStops = stops.filter((item) =>
        item.id !== stop.id && item.status !== "delivered" && item.status !== "picked_up"
      );
      const next = remainingStops[0];
      if (next && navigationWindowRef.current && !navigationWindowRef.current.closed) {
        navigationWindowRef.current.location.href = buildGoogleNavigationUrl(next, true, stop.id);
      } else if (!next && navigationWindowRef.current && !navigationWindowRef.current.closed) {
        navigationWindowRef.current.close();
        navigationWindowRef.current = null;
      }
      refetch();
    },
    onError: () => toast.error("Failed to complete stop"),
  });

  const confirmPickupMutation = useMutation({
    mutationFn: ({ orderId, code }: { orderId: string; code: string }) =>
      api.put(`/farmers/me/orders/${orderId}/confirm-pickup`, { code }),
    onSuccess: (_data, vars) => {
      toast.success("Pickup confirmed — order marked as picked up");
      stopScanner();
      setPickupTarget(null);
      setPickupCode("");
      refetch();
    },
    onError: (e: any) => {
      let msg = "Invalid pickup code";
      try {
        const j = JSON.parse(e?.message || "{}");
        msg = j.detail || j.message || msg;
      } catch {}
      toast.error(msg);
    },
  });

  const reportProblemMutation = useMutation({
    mutationFn: ({ orderId, category, note }: { orderId: string; category: string; note?: string }) =>
      api.post(`/farmers/me/route/${orderId}/problem`, { category, note: note || null }),
    onSuccess: () => {
      toast.success("Problem reported. Decide the next step for this order.");
      setProblemTarget(null);
      setProblemNote("");
      refetch();
    },
    onError: (e: any) => {
      let msg = "Failed to report problem";
      try {
        const j = JSON.parse(e?.message || "{}");
        msg = j.detail || j.message || msg;
      } catch {}
      toast.error(msg);
    },
  });

  const stopScanner = () => {
    try {
      scannerRef.current?.stop?.()?.catch?.(() => {});
    } catch {}
    scannerRef.current = null;
    setScanOpen(false);
  };

  const startScanner = async () => {
    try {
      setScanOpen(true);
      const { Html5Qrcode } = await import("html5-qrcode");
      scannerRef.current = new Html5Qrcode("pickup-qr-reader");
      await scannerRef.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decoded: string) => {
          const digits = (decoded || "").replace(/\D/g, "");
          if (digits.length >= 4) {
            stopScanner();
            setPickupCode(digits.slice(-6));
            toast.success("QR scanned — verify and confirm");
          }
        },
        () => {}
      );
    } catch {
      stopScanner();
      toast.error("Camera unavailable — enter the 6-digit code instead");
    }
  };

  const handleStartRoute = () => {
    if (startMutation.isPending || started) return;
    if (!userLocation) {
      toast.error("Waiting for your current GPS location. Allow location access and try again.");
      return;
    }
    if (!stops.some((stop) => stop.status !== "delivered" && stop.status !== "picked_up")) {
      toast("There are no pending delivery stops on this route.", { icon: "📦" });
      return;
    }
    // Open a temporary tab directly from the user's click so popup blockers
    // do not prevent Google Maps navigation after the API confirms route start.
    navigationWindowRef.current = window.open("about:blank", "_blank");
    if (navigationWindowRef.current) {
      navigationWindowRef.current.document.title = "Opening Google Maps navigation…";
      navigationWindowRef.current.document.body.innerHTML =
        "<p style='font:16px Arial,sans-serif;padding:24px'>Starting your delivery route and opening Google Maps…</p>";
    }
    startMutation.mutate();
  };

  const handleComplete = async (stop: Stop) => {
    if (completeMutation.isPending) return;
    if (stop.deliveryType !== "pickup") {
      const otp = window.prompt("Enter the 6-digit delivery OTP shown by the customer.");
      if (!otp) return;
      if (!/^\d{6}$/.test(otp.trim())) {
        toast.error("Enter the customer's 6-digit delivery OTP.");
        return;
      }
      try {
        await api.post("/orders/" + stop.orderId + "/delivery-verification", { code: otp.trim(), method: "otp" });
        toast.success("Customer hand-off verified.");
      } catch (e: any) {
        toast.error(e?.message || "Invalid delivery OTP");
        return;
      }
    }
    completeMutation.mutate(stop);
  };

  const toggleTracking = () => {
    if (tracking) {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setTracking(false);
      return;
    }
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }
    setTracking(true);
    toast.success("Tracking your live location on the map");
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        toast.error("Unable to get your location");
        setTracking(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  };

  const contact = (stop: Stop, via: "phone" | "message") => {
    const phone = stop.customerPhone || "";
    if (via === "phone") {
      if (phone) window.location.href = `tel:${phone}`;
      else toast("No phone number available for this buyer");
      return;
    }
    if (phone) window.open(`https://wa.me/${phone.replace(/\D/g, "")}`, "_blank");
    else toast("No contact number available for this buyer");
  };

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
      <DeliveryWorkflowNav current="route" />
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <DeliveryWorkflowNav current="route" />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Link href="/farmer" className="hover:text-emerald-700">Farmer Workspace</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="font-semibold text-emerald-700">My Delivery Route</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">My Delivery Route</h1>
          <p className="text-sm text-slate-600">Manage your delivery stops, navigate, and complete deliveries</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { icon: Calendar, value: today.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), label: "Today's Route" },
            { icon: MapPin, value: `${locationGroups.length} Locations`, label: `${stops.length} Orders` },
            { icon: Route, value: `${Number(summary?.totalDistance ?? 0).toFixed(1)} km`, label: "Total Distance" },
            { icon: Clock, value: `${Math.floor(Number(summary?.totalDuration ?? 0) / 60)} h ${Math.round(Number(summary?.totalDuration ?? 0) % 60)} min`, label: "Estimated Time" },
          ].map((metric) => (
            <Card key={metric.label} className="min-w-[132px] border-slate-200 shadow-sm">
              <CardContent className="flex items-center gap-2 p-3">
                <metric.icon className="h-5 w-5 shrink-0 text-emerald-700" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{metric.value}</p>
                  <p className="text-[11px] text-slate-500">{metric.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="grid gap-1 p-2 sm:grid-cols-5">
          {[
            ["1", "Order Map", "Select orders", true],
            ["2", "Smart Route", "Optimize route", true],
            ["3", "Delivery Route", "View & navigate", true],
            ["4", "Deliver Orders", "Verify & complete", false],
            ["5", "Route Complete", "All deliveries done", false],
          ].map(([number, label, sub, complete]) => (
            <div key={String(number)} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", number === "3" ? "bg-emerald-700 text-white" : "bg-slate-50 text-slate-700")}>
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold", number === "3" ? "bg-white text-emerald-700" : complete ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600")}>
                {complete && number !== "3" ? <CheckCircle className="h-4 w-4" /> : number}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold">{label}</p>
                <p className={cn("text-[11px]", number === "3" ? "text-emerald-50" : "text-slate-500")}>{sub}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {stops.length === 0 ? (
        <Card className="p-12 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No pending deliveries</h3>
          <p className="mt-2 text-muted-foreground">Orders will appear here once they are ready for delivery or pickup.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild><Link href="/farmer/delivery-calendar">View Delivery Calendar</Link></Button>
            <Button asChild variant="outline"><Link href="/farmer/smart-route">Smart Route</Link></Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr),minmax(0,1.05fr)]">
            <div className="space-y-4">
              <Card className="overflow-hidden border-slate-200 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Navigation className="h-5 w-5 text-emerald-700" />Route Map</CardTitle>
                    <CardDescription>Live farmer location and optimized delivery stops</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={toggleTracking}>
                    <Crosshair className={cn("mr-2 h-4 w-4", tracking && "animate-pulse text-blue-600")} />
                    {tracking ? "Tracking" : "Track Me"}
                  </Button>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <RouteMap
                    farm={farm}
                    stops={stops}
                    started={started || doneCount > 0}
                    nextStop={nextStop}
                    userLocation={userLocation}
                    routePoints={stops.filter((stop) => stop.status !== "delivered" && stop.status !== "picked_up" && stop.lat != null && stop.lng != null).map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number }))}
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs">
                    <span className="flex items-center gap-2 text-emerald-800"><span className={cn("h-2.5 w-2.5 rounded-full", userLocation ? "bg-blue-600" : "bg-amber-500")} />{userLocation ? "Your live location is being tracked" : "Waiting for GPS location permission"}</span>
                    <span className="text-emerald-800">{doneCount} / {stops.length} orders completed · {progress}%</span>
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-[1.2fr,0.8fr]">
                <Card className="border-slate-200 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Route className="h-5 w-5 text-emerald-700" />Route Summary</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      [Package, stops.length, "Total Orders"],
                      [MapPin, locationGroups.length, "Locations"],
                      [Route, `${Number(summary?.totalDistance ?? 0).toFixed(1)} km`, "Total Distance"],
                      [Clock, `${Math.round(Number(summary?.totalDuration ?? 0))} min`, "Estimated Time"],
                    ].map(([Icon, value, label]: any) => (
                      <div key={String(label)} className="rounded-lg border border-slate-200 p-2 text-center">
                        <Icon className="mx-auto h-5 w-5 text-emerald-700" />
                        <p className="mt-1 text-sm font-bold">{value}</p>
                        <p className="text-[10px] text-slate-500">{label}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/60 shadow-sm">
                  <CardHeader className="pb-2"><CardTitle className="text-base">Next Stop</CardTitle></CardHeader>
                  <CardContent>
                    {nextStop ? (
                      <>
                        <p className="flex items-center gap-2 text-sm font-bold"><MapPin className="h-5 w-5 text-emerald-700" />{nextStop.location}</p>
                        <p className="ml-7 text-xs text-slate-600">{nextStop.city}</p>
                        <p className="ml-7 mt-2 text-xs text-slate-600">{nextStop.distance > 0 ? `${nextStop.distance.toFixed(1)} km from farm` : "Next pending destination"}</p>
                        <Button className="mt-3 w-full" size="sm" onClick={() => navigateToStop(nextStop)}><Navigation className="mr-2 h-4 w-4" />Navigate</Button>
                      </>
                    ) : <p className="text-sm text-emerald-800">All delivery orders are completed.</p>}
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-emerald-700" />Pickup &amp; Delivery Schedule</CardTitle>
                  <CardDescription>{locationGroups.length} delivery locations · {stops.length} orders (grouped by location)</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => refetch()}><Route className="mr-2 h-4 w-4" />Refresh</Button>
              </CardHeader>
              <CardContent className="max-h-[690px] space-y-3 overflow-y-auto p-3">
                {locationGroups.map((group, locationIndex) => (
                  <div key={group.key} className="rounded-xl border border-slate-200 bg-white p-2">
                    <div className="mb-2 flex items-center gap-3 rounded-lg bg-slate-50 px-2 py-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">{locationIndex + 1}</span>
                      <MapPin className="h-4 w-4 shrink-0 text-emerald-800" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-900">{group.location}{group.city ? `, ${group.city}` : ""}</p>
                        <p className="text-xs text-slate-500">{group.stops.length} {group.stops.length === 1 ? "order" : "orders"} at this location</p>
                      </div>
                      <Badge variant="secondary">{group.stops.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {group.stops.map((stop) => {
                        const done = stop.status === "delivered" || stop.status === "picked_up";
                        return (
                          <div key={stop.id} className={cn("rounded-lg border p-2.5", done ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200")}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-xs font-bold text-slate-900">#{stop.orderNumber}</p>
                                  {getStatusBadge(stop.status, done)}
                                  {(() => { const pi = priorityInfo(stop.priority); return pi ? <Badge variant="outline" className={cn("text-[10px]", pi.cls)}>{pi.label}</Badge> : null; })()}
                                </div>
                                <p className="mt-1 text-xs text-slate-600">{stop.quantity} {stop.product} · {stop.time}</p>
                                <p className={cn("mt-1 text-[11px] font-semibold", stop.isCOD ? "text-amber-700" : "text-emerald-700")}>{stop.isCOD ? `Collect ${formatPrice(stop.total)} on delivery` : "Paid online"}</p>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Call customer" onClick={() => contact(stop, "phone")}><Phone className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Message customer" onClick={() => contact(stop, "message")}><MessageSquare className="h-4 w-4" /></Button>
                                {!done && <Button size="sm" variant="outline" onClick={() => navigateToStop(stop)}><Navigation className="mr-1.5 h-3.5 w-3.5" />Navigate</Button>}
                                {!done && isPickupStop(stop) ? (
                                  <Button size="sm" onClick={() => { setPickupCode(""); stopScanner(); setPickupTarget(stop); }}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Confirm Pickup</Button>
                                ) : !done ? (
                                  <Button size="sm" onClick={() => handleComplete(stop)} disabled={completeMutation.isPending}><CheckCircle className="mr-1.5 h-3.5 w-3.5" />Complete</Button>
                                ) : null}
                                {!done && <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" title="Report delivery problem" onClick={() => { setProblemCategory(PROBLEM_CATEGORIES[0].value); setProblemNote(""); setProblemTarget(stop); }}><AlertCircle className="h-4 w-4" /></Button>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">
                  <p className="font-semibold text-slate-700">Return to {farm.name}</p>
                  <p>End of route · {doneCount} of {stops.length} orders completed</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-emerald-200 shadow-sm">
            <CardContent className="flex flex-col items-center justify-between gap-3 bg-gradient-to-r from-emerald-700 to-emerald-600 p-4 text-center text-white sm:flex-row sm:text-left">
              <div>
                <p className="text-lg font-bold">{started ? "Delivery route is active" : "Ready to start your delivery route?"}</p>
                <p className="text-sm text-emerald-50">{started ? "Your GPS tracking is active. Follow the next destination in Google Maps." : "Open navigation to the first destination and begin delivery."}</p>
              </div>
              <Button size="lg" variant="secondary" className="min-w-[220px] bg-white font-bold text-emerald-800 hover:bg-emerald-50" onClick={started ? () => nextStop && navigateToStop(nextStop) : handleStartRoute} disabled={startMutation.isPending || (!started && !userLocation)}>
                {startMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />}
                {started ? "Continue Navigation" : "Start Route"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog
        open={!!pickupTarget}
        onOpenChange={(v) => {
          if (!v) {
            stopScanner();
            setPickupTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Confirm farm pickup
            </DialogTitle>
            <DialogDescription>
              Ask the customer for their 6-digit pickup code, or have them show its QR to scan. Only a matching code
              completes the hand-off.
            </DialogDescription>
          </DialogHeader>

          {pickupTarget && (
            <>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{pickupTarget.buyerName}</p>
                  <span className="text-xs text-muted-foreground">#{pickupTarget.orderNumber}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pickupTarget.quantity} {pickupTarget.product}
                </p>
                <p className={cn("mt-2 flex items-center gap-1 text-sm font-medium", pickupTarget.isCOD ? "text-amber-600" : "text-emerald-600")}>
                  <Wallet className="h-4 w-4" />
                  {pickupTarget.isCOD
                    ? `Collect ${formatPrice(pickupTarget.total)} cash on pickup`
                    : "Already paid online — nothing to collect"}
                </p>
              </div>

              <div
                id="pickup-qr-reader"
                className={cn("mx-auto w-full max-w-xs overflow-hidden rounded-lg border", scanOpen ? "" : "hidden")}
              />

              {!scanOpen && (
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter 6-digit pickup code"
                  value={pickupCode}
                  onChange={(e) => setPickupCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center text-lg tracking-[0.5em]"
                />
              )}

              <div className="flex items-center gap-2 pt-1">
                {!scanOpen ? (
                  <Button variant="outline" onClick={startScanner}>
                    <QrCode className="mr-2 h-4 w-4" />
                    Scan QR
                  </Button>
                ) : (
                  <Button variant="outline" onClick={stopScanner}>
                    <XCircle className="mr-2 h-4 w-4" />
                    Stop camera
                  </Button>
                )}
                <Button
                  className="ml-auto"
                  disabled={pickupCode.length < 4 || confirmPickupMutation.isPending}
                  onClick={() =>
                    pickupTarget &&
                    confirmPickupMutation.mutate({ orderId: pickupTarget.orderId, code: pickupCode })
                  }
                >
                  {confirmPickupMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  )}
                  Confirm Pickup
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!problemTarget} onOpenChange={(v) => !v && setProblemTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Report delivery problem
            </DialogTitle>
            <DialogDescription>
              Tell us what went wrong with #{problemTarget?.orderNumber || "this order"}. After reporting you can
              reschedule it on the calendar, open it to partners, deliver yourself, or cancel the request.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROBLEM_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setProblemCategory(c.value)}
                className={cn(
                  "rounded-lg border p-2.5 text-left text-sm transition",
                  problemCategory === c.value
                    ? "border-red-300 bg-red-50 font-medium text-red-700"
                    : "bg-white hover:bg-slate-50"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <Input
            placeholder="Optional note (e.g. customer asked for evening delivery)"
            value={problemNote}
            onChange={(e) => setProblemNote(e.target.value)}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setProblemTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reportProblemMutation.isPending}
              onClick={() =>
                problemTarget &&
                reportProblemMutation.mutate({
                  orderId: problemTarget.orderId,
                  category: problemCategory,
                  note: problemNote,
                })
              }
            >
              {reportProblemMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <AlertCircle className="mr-2 h-4 w-4" />
              )}
              Report Problem
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
