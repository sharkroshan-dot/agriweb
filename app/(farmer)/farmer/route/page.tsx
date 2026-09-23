"use client";

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
}: {
  farm: Farm;
  stops: Stop[];
  started: boolean;
  nextStop: Stop | null;
  userLocation: { lat: number; lng: number } | null;
}) {
  const completedIds = new Set(
    stops.filter((s) => s.status === "delivered" || s.status === "picked_up").map((s) => s.id)
  );

  const locatedStops = stops.filter(
    (s): s is Stop & { lat: number; lng: number } => s.lat != null && s.lng != null
  );
  const hasFarmCoords = farm.lat != null && farm.lng != null;

  const markers = [
    ...(hasFarmCoords
      ? [
          {
            id: "farm",
            lat: farm.lat as number,
            lng: farm.lng as number,
            title: farm.name,
            color: "#7c3aed",
            label: "F",
            info: farm.address || "Start & end of the route",
          },
        ]
      : []),
    ...locatedStops.map((stop, i) => {
      const done = completedIds.has(stop.id);
      const isNext = started && stop.id === nextStop?.id;
      return {
        id: stop.id,
        lat: stop.lat,
        lng: stop.lng,
        title: `${done ? "✓ " : ""}${i + 1}. ${stop.buyerName}`,
        color: done ? "#10b981" : isNext ? "#3b82f6" : "#059669",
        label: done ? "✓" : String(i + 1),
        info: `${stop.location || "No address"} · ${stop.product} · ${stop.quantity}`,
      };
    }),
  ];

  const center = hasFarmCoords
    ? { lat: farm.lat as number, lng: farm.lng as number }
    : locatedStops.length > 0
      ? { lat: locatedStops[0].lat, lng: locatedStops[0].lng }
      : undefined;

  if (!center) {
    return (
      <div className="flex h-[420px] w-full flex-col items-center justify-center rounded-lg border border-dashed text-center">
        <Navigation className="h-8 w-8 text-gray-300" />
        <p className="mt-2 text-sm font-medium text-gray-500">No mapped locations yet</p>
        <p className="text-xs text-gray-400">
          Add a location to your farm profile or orders to see today&apos;s route on the map.
        </p>
      </div>
    );
  }

  return (
    <Map
      center={center}
      zoom={farm.lat != null ? 10 : 5}
      height="420px"
      markers={markers}
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
  const [started, setStarted] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const watchRef = useRef<number | null>(null);
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
    queryKey: ["farmerRoute"],
    queryFn: () => api.get("/farmers/me/route"),
    enabled: Boolean(accessToken),
  });

  const routeData: RouteData | undefined = data?.data;
  const stops: Stop[] = routeData?.route ?? [];
  const summary = routeData?.summary;
  const farm: Farm = routeData?.farm ?? { name: "My Farm", lat: null, lng: null, address: "" };

  const doneCount = stops.filter((s) => s.status === "delivered" || s.status === "picked_up").length;
  const progress = stops.length ? Math.round((doneCount / stops.length) * 100) : 0;
  const nextStop = stops.find((s) => s.status !== "delivered" && s.status !== "picked_up") ?? null;

  const navigateToStop = (stop: Stop) => {
    if (stop.lat != null && stop.lng != null) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`,
        "_blank"
      );
    } else {
      const query = encodeURIComponent(
        `${stop.location}${stop.city ? `, ${stop.city}` : ""}`
      );
      window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, "_blank");
    }
  };

  const startMutation = useMutation({
    mutationFn: () => api.put("/farmers/me/route/start"),
    onSuccess: () => {
      setStarted(true);
      toast.success("Route started! Stops are marked as self-delivery.");
    },
    onError: () => toast.error("Failed to start route"),
  });

  const completeMutation = useMutation({
    mutationFn: (stop: Stop) =>
      api.put(`/farmers/me/route/${stop.orderId}/status`, {
        status: stop.deliveryType === "pickup" ? "picked_up" : "delivered",
        note: "Farmer completed stop on route",
      }),
    onSuccess: (_data, stop) => {
      toast.success(`${stop.buyerName} stop completed!`);
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
    if (!startMutation.isPending) startMutation.mutate();
  };

  const handleComplete = (stop: Stop) => {
    if (!completeMutation.isPending) completeMutation.mutate(stop);
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Route Planning</h1>
          <p className="text-muted-foreground">{dateStr}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/farmer/delivery-calendar">
              <Calendar className="mr-2 h-4 w-4" />
              Delivery Calendar
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/farmer/smart-route">
              <Sparkles className={cn("mr-2 h-4 w-4", completeMutation.isPending && "animate-pulse")} />
              Optimize with AI
            </Link>
          </Button>
          <Button size="sm" onClick={handleStartRoute} disabled={started || startMutation.isPending}>
            <Play className="mr-2 h-4 w-4" />
            {started ? "Route Started" : "Start Route"}
          </Button>
        </div>
      </div>

      {stops.length === 0 ? (
        <Card className="p-12 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No pending deliveries</h3>
          <p className="mt-2 text-muted-foreground">
            Orders will appear here once buyers purchase your products and they are ready for delivery or pickup.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link href="/farmer/delivery-calendar">View Delivery Calendar</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/farmer/smart-route">Smart Route</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Card>
              <CardContent className="p-4 text-center">
                <Route className="mx-auto h-5 w-5 text-emerald-600" />
                <p className="mt-2 text-2xl font-bold">{summary?.totalDistance ?? 0} km</p>
                <p className="text-xs text-muted-foreground">Total Distance</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Clock className="mx-auto h-5 w-5 text-amber-600" />
                <p className="mt-2 text-2xl font-bold">{Math.round(summary?.totalDuration ?? 0)} min</p>
                <p className="text-xs text-muted-foreground">Est. Duration</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Package className="mx-auto h-5 w-5 text-purple-600" />
                <p className="mt-2 text-2xl font-bold">{summary?.totalQuantity ?? 0} kg</p>
                <p className="text-xs text-muted-foreground">Total Quantity</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <DollarSign className="mx-auto h-5 w-5 text-orange-600" />
                <p className="mt-2 text-2xl font-bold">{formatPrice(summary?.totalRevenue)}</p>
                <p className="text-xs text-muted-foreground">Expected Revenue</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Truck className="mx-auto h-5 w-5 text-blue-600" />
                <p className="mt-2 text-2xl font-bold">{summary?.totalStops ?? 0}</p>
                <p className="text-xs text-muted-foreground">Orders</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <Users className="mx-auto h-5 w-5 text-indigo-600" />
                <p className="mt-2 text-2xl font-bold">
                  {new Set(stops.map((s) => s.buyerName)).size}
                </p>
                <p className="text-xs text-muted-foreground">Customers</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Navigation className="h-5 w-5 text-primary" />
                    Route Map
                  </CardTitle>
                  <CardDescription>
                    {farm.name} · {stops.length} stops on today&apos;s route
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={toggleTracking}>
                  <Crosshair className={cn("mr-2 h-4 w-4", tracking && "animate-pulse text-blue-500")} />
                  {tracking ? "Stop Tracking" : "Track Me"}
                </Button>
              </CardHeader>
              <CardContent className="relative">
                <RouteMap
                  farm={farm}
                  stops={stops}
                  started={started || doneCount > 0}
                  nextStop={nextStop}
                  userLocation={userLocation}
                />
                {started && nextStop && (
                  <div className="absolute left-4 right-4 top-4 z-[1000] flex items-center justify-between gap-3 rounded-xl border bg-white/95 p-3 shadow-lg backdrop-blur">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
                        Next Stop · {stops.indexOf(nextStop) + 1} of {stops.length}
                        {(() => {
                          const pi = priorityInfo(nextStop.priority);
                          return pi ? (
                            <span className={cn("rounded border px-1.5 py-0.5 normal-case", pi.cls)}>{pi.label}</span>
                          ) : null;
                        })()}
                      </p>
                      <p className="truncate font-semibold">{nextStop.buyerName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {nextStop.location}
                        {nextStop.distance > 0 ? ` · ${nextStop.distance} km · ${nextStop.time}` : " · At farm"}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {(() => {
                          const c = nextStop.lat != null && nextStop.lng != null ? { lat: nextStop.lat, lng: nextStop.lng } : null;
                          if (userLocation && c) {
                            const liveKm = distanceKmBetween(userLocation, c);
                            const etaMin = Math.max(1, Math.round((liveKm / 25) * 60));
                            return (
                              <>
                                <span className="font-medium text-blue-600">
                                  ETA ~{etaMin} min ({liveKm.toFixed(1)} km from you)
                                </span>
                                <span className="text-gray-300">·</span>
                              </>
                            );
                          }
                          return null;
                        })()}
                        <span
                          className={cn(
                            "flex items-center gap-1 font-medium",
                            nextStop.isCOD ? "text-amber-600" : "text-emerald-600"
                          )}
                        >
                          <Wallet className="h-3 w-3" />
                          {nextStop.isCOD ? `Collect ${formatPrice(nextStop.total)}` : "Paid online"}
                        </span>
                      </p>
                    </div>
                    <Button size="sm" onClick={() => navigateToStop(nextStop)} className="shrink-0">
                      <Navigation className="mr-2 h-4 w-4" />
                      Navigate
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <WeatherCard farm={farm} />

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-emerald-600" />
                    Route Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {doneCount} of {stops.length} stops completed
                    </span>
                    <span className="font-bold text-emerald-600">{progress}%</span>
                  </div>
                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5">
                      <Home className="h-4 w-4 text-emerald-600" />
                      Start &amp; end at {farm.name}
                    </p>
                    <p className="mt-1">
                      {Math.round(summary?.totalDuration ?? 0)} min estimated at 25 km/h with 10 min per stop.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-primary" />
                  Pickup &amp; Delivery Schedule
                </CardTitle>
                <CardDescription>{stops.length} orders in route sequence</CardDescription>
              </div>
              <Button size="sm" onClick={handleStartRoute} disabled={started || startMutation.isPending}>
                <Play className="mr-2 h-4 w-4" />
                Start Route
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start gap-4 pb-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                    <Home className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-medium">{farm.name}</p>
                    <p className="text-xs text-muted-foreground">Starting point</p>
                  </div>
                </div>

                {stops.map((stop, index) => {
                  const done = stop.status === "delivered" || stop.status === "picked_up";
                  return (
                    <div
                      key={stop.id}
                      className={cn(
                        "flex items-center gap-4 rounded-lg border p-4 transition-all",
                        done ? "bg-emerald-50/60" : "hover:shadow-md"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                          done ? "bg-emerald-600 text-white" : "bg-primary/10 text-primary"
                        )}
                      >
                        {done ? <CheckCircle className="h-5 w-5" /> : index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{stop.buyerName}</p>
                          {getStatusBadge(stop.status, done)}
                          {(() => {
                            const pi = priorityInfo(stop.priority);
                            return pi ? (
                              <Badge variant="outline" className={cn("text-xs", pi.cls)}>
                                {pi.label}
                              </Badge>
                            ) : null;
                          })()}
                          <span className="text-xs text-muted-foreground">#{stop.orderNumber}</span>
                        </div>
                        <p className="truncate text-sm text-muted-foreground">
                          {stop.location}
                          {stop.city ? `, ${stop.city}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {stop.time}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {stop.distance > 0 ? `${stop.distance} km away` : "At farm"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Package className="h-3 w-3" />
                            {stop.quantity} {stop.product}
                          </span>
                          <span className={cn("flex items-center gap-1 font-medium", stop.isCOD ? "text-amber-600" : "text-emerald-600")}>
                            <Wallet className="h-3 w-3" />
                            {stop.isCOD ? `Collect ${formatPrice(stop.total)} on delivery` : "Paid online"}
                          </span>
                        </div>
                        {stop.items.length > 1 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {stop.items.map((item, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px]">
                                {item.name} ({item.quantity})
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contact(stop, "phone")}>
                          <Phone className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contact(stop, "message")}>
                          <MessageSquare className="h-4 w-4" />
                        </Button>
                        {!done && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-600"
                            title="Report delivery problem"
                            onClick={() => {
                              setProblemCategory(PROBLEM_CATEGORIES[0].value);
                              setProblemNote("");
                              setProblemTarget(stop);
                            }}
                          >
                            <AlertCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {!done && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigateToStop(stop)}
                          >
                            <Navigation className="mr-2 h-4 w-4" />
                            Navigate
                          </Button>
                        )}
                        {!done && isPickupStop(stop) ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setPickupCode("");
                              stopScanner();
                              setPickupTarget(stop);
                            }}
                          >
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Confirm Pickup
                          </Button>
                        ) : (
                          !done && (
                            <Button
                              size="sm"
                              onClick={() => handleComplete(stop)}
                              disabled={completeMutation.isPending}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Complete
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-start gap-4 pt-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                    <Navigation className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-medium">Return to {farm.name}</p>
                    <p className="text-xs text-muted-foreground">End of route</p>
                  </div>
                  <div className="ml-auto flex items-center gap-1 text-sm font-medium text-emerald-600">
                    <Link href="/farmer/smart-route" className="flex items-center">
                      Smart Route <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
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
