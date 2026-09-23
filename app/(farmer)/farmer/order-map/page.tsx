"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle,
  Crosshair,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Settings2,
  Sparkles,
  Star,
  Timer,
  Truck,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Map } from "../../../components/shared/map";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";

const RADIUS_OPTIONS = [2, 5, 10, 20, 50] as const;
const FALLBACK_CENTER = { lat: 11.1271, lng: 78.6569 };

// Map markers follow the delivery state of each order:
//   🟢 Self Delivery        green
//   🔵 Delivery Partner     blue
//   🟡 Pending Assignment   amber (unassigned or waiting for a partner)
//   🔴 Delivery Problem     red
//   ⚫ Completed            black
const DELIVERY_STATE_COLOR: Record<string, string> = {
  self_delivery: "#10B981",
  partner_assigned: "#3B82F6",
  partner_assignment_pending: "#F59E0B",
  pending_assignment: "#F59E0B",
  problem: "#EF4444",
  delivered: "#111827",
};

const DELIVERY_STATE_LABEL: Record<string, string> = {
  self_delivery: "Self Delivery",
  partner_assigned: "Delivery Partner",
  partner_assignment_pending: "Partner Pending",
  pending_assignment: "Pending Assignment",
  problem: "Delivery Problem",
  delivered: "Completed",
};

const DELIVERED_WINDOWS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
] as const;

const formatRelativeTime = (iso?: string) => {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const mins = Math.floor((Date.now() - time) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const asArray = (value: any): any[] => (Array.isArray(value) ? value : []);

const getStopId = (stop: any) => String(stop?.orderId || stop?.id || stop?._id || "");

const getStatus = (stop: any) => String(stop?.status || "").toLowerCase();

const getDeliveryState = (stop: any): string => {
  const state = String(stop?.deliveryState || "").toLowerCase();
  if (state && DELIVERY_STATE_COLOR[state]) return state;
  if (isDone(stop)) return "delivered";
  const assignment = String(stop?.assignment || "").toLowerCase();
  if (assignment === "self") return "self_delivery";
  if (assignment === "partner") return "partner_assigned";
  return "pending_assignment";
};

const stateBadgeClass = (stop: any) => {
  const state = getDeliveryState(stop);
  if (state === "self_delivery") return "border-emerald-500 text-emerald-600";
  if (state === "partner_assigned") return "border-blue-500 text-blue-600";
  if (state === "problem") return "border-red-500 text-red-600";
  if (state === "delivered") return "border-slate-500 text-slate-600";
  return "border-amber-500 text-amber-600";
};

const stateLabel = (stop: any) =>
  DELIVERY_STATE_LABEL[getDeliveryState(stop)] || getDeliveryState(stop);

const isDone = (stop: any) => ["delivered", "picked_up"].includes(getStatus(stop));

const priorityBadge = (stop: any) => {
  const v = Number(stop?.priority ?? 1);
  if (v >= 3) return <Badge variant="destructive" className="text-[10px]">Critical</Badge>;
  if (v === 2) return <Badge variant="warning" className="text-[10px]">High priority</Badge>;
  if (v <= 0) return <Badge variant="outline" className="text-[10px] text-emerald-600">Low</Badge>;
  return null;
};

const isPickup = (stop: any) => String(stop?.deliveryType || "").toLowerCase() === "pickup";

const formatAddress = (stop: any) =>
  [stop?.location, stop?.city].filter(Boolean).join(", ") || "Address unavailable";

const isValidCoordinate = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const getCoordinates = (stop: any): { lat: number; lng: number } | null => {
  const lat = Number(stop?.lat);
  const lng = Number(stop?.lng);
  return isValidCoordinate(lat, lng) ? { lat, lng } : null;
};

const getStatusBadge = (stop: any) => {
  if (isDone(stop)) return <Badge variant="success">Completed</Badge>;
  switch (getStatus(stop)) {
    case "in_transit":
    case "dispatched":
      return <Badge variant="warning">In Progress</Badge>;
    case "ready_for_delivery":
      return <Badge variant="default">Ready to Deliver</Badge>;
    case "ready_for_pickup":
      return <Badge variant="default">Ready for Pickup</Badge>;
    case "confirmed":
      return <Badge variant="secondary">Confirmed</Badge>;
    case "processing":
      return <Badge variant="secondary">Processing</Badge>;
    case "pending":
      return <Badge variant="secondary">Pending</Badge>;
    default:
      return <Badge variant="outline">{getStatus(stop).replace(/_/g, " ") || "unknown"}</Badge>;
  }
};

const getApiError = (e: any) => {
  try {
    const parsed = JSON.parse(e?.message || "{}");
    return parsed?.detail || parsed?.error?.message || parsed?.message || "Something went wrong";
  } catch {
    return e?.message || "Something went wrong";
  }
};

const PENDING_QUERY_KEYS = [
  ["farmerDeliveries"],
  ["smartRoute"],
  ["farmerSmartRoute"],
  ["deliveryCalendar"],
  ["farmerDeliveryCalendar"],
  ["farmerOrders"],
  ["farmerDeliveryRoutes"],
  ["farmerRoute"],
  ["farmerTodaySummary"],
  ["farmerOrderCount"],
  ["farmerMarketplaceJobs"],
];

export default function FarmerOrderMapPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;

  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [deliveredWindow, setDeliveredWindow] = useState<string>("today");
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"marketplace" | "manual" | "ai">("marketplace");
  const [selfSwitchTarget, setSelfSwitchTarget] = useState<any>(null);
  const [partnerPickerTarget, setPartnerPickerTarget] = useState<any>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("auto");
  const [manualPartnerIds, setManualPartnerIds] = useState<Record<string, string>>({});
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [capacityEditorOpen, setCapacityEditorOpen] = useState(false);
  const [capacityDraft, setCapacityDraft] = useState({ maxOrders: "20", maxWeightKg: "100", maxRouteMinutes: "180" });

  const mapQuery = useQuery({
    queryKey: ["farmerDeliveryMap", radiusKm, deliveredWindow],
    queryFn: () => api.get(`/farmers/me/delivery-map?radius=${radiusKm}&delivered=${deliveredWindow}`),
    enabled: Boolean(accessToken),
    retry: 1,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const aiInsightsQuery = useQuery({
    queryKey: ["farmerAiInsightsMap"],
    queryFn: () => api.get("/ai/farmer/insights"),
    enabled: Boolean(accessToken),
    refetchInterval: 60000,
  });
  const capacityQuery = useQuery({
    queryKey: ["farmerDeliveryCapacity"],
    queryFn: () => api.get("/farmers/me/delivery-capacity"),
    enabled: Boolean(accessToken),
  });
  const jobsQuery = useQuery({
    queryKey: ["farmerMarketplaceJobs"],
    queryFn: () => api.get("/farmers/me/delivery-map/jobs"),
    enabled: Boolean(accessToken),
    refetchInterval: 15000,
  });
  const mapInsights = (aiInsightsQuery.data as any)?.data ?? {};
  const deliveryInsight = mapInsights.delivery ?? {};
  const communityInsight = mapInsights.community ?? {};
  const data = mapQuery.data?.data;
  const within: any[] = asArray(data?.withinRadius);
  const outside: any[] = asArray(data?.outsideRadius);
  const unlocated: any[] = asArray(data?.unlocated);
  const delivered: any[] = asArray(data?.delivered);
  const summary = data?.summary || {};
  const farm = data?.farm;
  const partners: any[] = asArray(data?.partners);
  const availablePartners = partners.filter((p) => p.isAvailable && p.isVerified);

  // Aggregates for the Order Summary panel and the bulk-action confirm dialogs.
  const confirmStats = (orders: any[]) => {
    const count = orders.length;
    const value = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const weight = orders.reduce((sum, o) => sum + Number(o.quantityKg || 0), 0);
    const distance = orders.reduce((sum, o) => sum + Number(o.distance || 0), 0) * 2;
    return { count, value, weight, distance };
  };

  // Split each radius bucket into unassigned (still actionable) vs already
  // assigned so the farmer can see at a glance which orders still need a
  // delivery method - especially the far "risky" ones awaiting a partner.
  const withinUnassigned = within.filter((o) => o.assignment === "unassigned");
  const withinAssigned = within.filter((o) => o.assignment !== "unassigned");
  const outsideUnassigned = outside.filter((o) => o.assignment === "unassigned");
  const outsideAssigned = outside.filter((o) => o.assignment !== "unassigned");
  const withinActionStats = confirmStats(withinUnassigned);
  const outsideActionStats = confirmStats(outsideUnassigned);

  // ---- Delivery capacity decision engine ---------------------------------
  // Mirrors the server-side nearest-first fill so the farmer can preview how
  // many of the nearby orders fit before accepting anything.
  const capacity = capacityQuery.data?.data;
  const capacityStats = useMemo(() => {
    const maxOrders = Number(capacity?.maxOrders ?? 20);
    const maxWeightKg = Number(capacity?.maxWeightKg ?? 100);
    const maxRouteMinutes = Number(capacity?.maxRouteMinutes ?? 180);
    let count = 0;
    let weight = 0;
    let minutes = 0;
    const sorted = [...withinUnassigned].sort(
      (a, b) => (a.distance ?? 9999) - (b.distance ?? 9999)
    );
    for (const o of sorted) {
      const w = Number(o.quantityKg || 0);
      const leg = (Number(o.distance || 0) / 25) * 60 + 10;
      if (count + 1 > maxOrders || weight + w > maxWeightKg || minutes + leg > maxRouteMinutes) {
        break;
      }
      count += 1;
      weight += w;
      minutes += leg;
    }
    return {
      maxOrders,
      maxWeightKg,
      maxRouteMinutes,
      fitsCount: count,
      fitsWeight: Math.round(weight * 10) / 10,
      fitsMinutes: Math.round(minutes),
      overCapacity: withinUnassigned.length - count,
      nearbyWeight: Math.round(withinActionStats.weight * 10) / 10,
      nearbyMinutes: Math.round(((Number(summary.withinDistance ?? 0) || 0) / 25) * 60),
    };
  }, [capacity, withinUnassigned, withinActionStats.weight, summary.withinDistance]);

  // ---- Marketplace job board ---------------------------------------------
  const jobs: any[] = asArray(jobsQuery.data?.data?.jobs);
  const activeJobs = jobs.filter((j) => j.status === "open" || j.status === "accepted");
  const stuckJobs = jobs.filter((j) => j.status === "no_partner_found" || j.status === "expired");
  const waitingForPartner = activeJobs.filter((j) => j.status === "open").length;

  const refreshAll = async () => {
    mapQuery.refetch();
    PENDING_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
  };

  const updateLivePosition = (position: GeolocationPosition) => {
    setLiveLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
    setLocationError(false);
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

  // Real-time updates: listen for order.accepted / order.assigned /
  // order.updated / order.delivered events pushed by the backend over SSE and
  // refresh the map without a full page reload. Auto-reconnects on drop and the
  // 30s polling interval above remains as a fallback.
  useEffect(() => {
    if (!accessToken) return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
    const prefix = apiBase
      ? apiBase.endsWith("/api/v1")
        ? apiBase
        : `${apiBase.replace(/\/+$/, "")}/api/v1`
      : "/api/v1";
    let retryTimer: number | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      try {
        const es = new EventSource(`${prefix}/farmers/me/delivery-map/events`);
        es.onopen = () => setRealtimeConnected(true);
        es.onmessage = () => {
          if (disposed) return;
          queryClient.invalidateQueries({ queryKey: ["farmerDeliveryMap"] });
          PENDING_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
        };
        es.onerror = () => {
          es.close();
          if (disposed) return;
          setRealtimeConnected(false);
          if (retryTimer) window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(connect, 5000);
        };
      } catch {
        setRealtimeConnected(false);
      }
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      setRealtimeConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const allOrders = useMemo(() => {
    const active = [...within, ...outside, ...unlocated]
      .map((stop) => ({ ...stop, mapCoordinates: getCoordinates(stop) }))
      .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
    const done = delivered
      .map((stop) => ({ ...stop, mapCoordinates: getCoordinates(stop) }))
      .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
    return [...active, ...done];
  }, [within, outside, unlocated, delivered]);

  const selectedStop =
    allOrders.find((stop) => getStopId(stop) === selectedStopId) || allOrders[0] || null;

  const farmCoordinates =
    farm?.lat != null && farm?.lng != null ? { lat: Number(farm.lat), lng: Number(farm.lng) } : null;

  const mapCenter =
    selectedStop?.mapCoordinates || liveLocation || farmCoordinates || FALLBACK_CENTER;

  const mapMarkers = useMemo(() => {
    const markers: any[] = [];
    if (farmCoordinates) {
      markers.push({
        id: "farm",
        lat: farmCoordinates.lat,
        lng: farmCoordinates.lng,
        title: `${farm?.name || "My Farm"} (Farm)`,
        info: `<strong>${farm?.name || "My Farm"}</strong><br/>${farm?.address || "Your farm"}<br/><em>Delivery origin</em>`,
        address: farm?.address,
        color: "#8B5CF6",
        label: "F",
      });
    }
    allOrders.forEach((stop, index) => {
      const c = stop.mapCoordinates;
      if (!c) return;
      const state = getDeliveryState(stop);
      const isDelivered = state === "delivered";
      const distText = stop.distance != null ? ` - ${stop.distance} km` : "";
      const partnerText = state === "partner_assigned" && stop.deliveryPartnerName ? ` · ${stop.deliveryPartnerName}` : "";
      const statusText = isDelivered ? "Delivered" : getStatus(stop).replace(/_/g, " ");
      markers.push({
        id: getStopId(stop),
        lat: c.lat,
        lng: c.lng,
        title: `${index + 1}. ${stop.buyerName || stop.orderNumber || "Delivery order"}`,
        info: `<strong>${index + 1}. ${stop.buyerName || "Customer"}</strong><br/>${formatAddress(stop)}${distText}<br/>${DELIVERY_STATE_LABEL[state] || state}${partnerText}<br/>${statusText} · ${formatPrice(stop.total)}`,
        address: formatAddress(stop),
        color: DELIVERY_STATE_COLOR[state] || "#F59E0B",
        label: String(index + 1),
      });
    });
    return markers;
  }, [allOrders, farm, farmCoordinates]);

  const acceptWithinMutation = useMutation({
    mutationFn: () => api.put("/farmers/me/delivery-map/accept-within", { radius: radiusKm }),
    onSuccess: (res: any) => {
      toast.success(res?.message || `Orders accepted for self-delivery within ${radiusKm} km`);
      const over = Number(res?.data?.overCapacity ?? 0);
      if (over > 0) {
        toast(
          `${over} order${over > 1 ? "s" : ""} exceeded your capacity and stayed unassigned — use "Open for Partners" to send them to the marketplace.`,
          { icon: "🚚", duration: 6000 }
        );
      }
      setAcceptDialogOpen(false);
      refreshAll();
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const saveCapacityMutation = useMutation({
    mutationFn: (payload: { maxOrders: number; maxWeightKg: number; maxRouteMinutes: number }) =>
      api.put("/farmers/me/delivery-capacity", payload),
    onSuccess: () => {
      toast.success("Delivery capacity updated");
      setCapacityEditorOpen(false);
      queryClient.invalidateQueries({ queryKey: ["farmerDeliveryCapacity"] });
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const openCapacityEditor = () => {
    if (capacity) {
      setCapacityDraft({
        maxOrders: String(capacity.maxOrders ?? 20),
        maxWeightKg: String(capacity.maxWeightKg ?? 100),
        maxRouteMinutes: String(capacity.maxRouteMinutes ?? 180),
      });
    }
    setCapacityEditorOpen(true);
  };

  const extendJobMutation = useMutation({
    mutationFn: ({ orderId, minutes }: { orderId: string; minutes?: number }) =>
      api.post(`/farmers/me/delivery-map/jobs/${orderId}/extend`, { minutes: minutes || 120 }),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Job extended");
      refreshAll();
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const closeJobMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/farmers/me/delivery-map/jobs/${orderId}/close`),
    onSuccess: () => {
      toast.success("Marketplace job closed");
      refreshAll();
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const assignOutsideMutation = useMutation({
    mutationFn: ({ mode, partnerIds }: { mode: "marketplace" | "manual" | "ai"; partnerIds?: Record<string, string> }) =>
      api.post("/farmers/me/delivery-map/assign-outside", { radius: radiusKm, mode, partnerIds }),
    onSuccess: (res: any) => {
      if (res?.data?.mode === "marketplace") {
        toast.success(res?.message || `Orders posted for all delivery partners to accept`);
      } else {
        toast.success(res?.message || "Orders assigned to delivery partners");
      }
      setAssignDialogOpen(false);
      setManualPartnerIds({});
      refreshAll();
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const switchMutation = useMutation({
    mutationFn: ({ orderId, mode, partnerId }: { orderId: string; mode: string; partnerId?: string }) =>
      api.put(`/farmers/me/delivery-map/orders/${orderId}/assignment`, { mode, partnerId }),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Order assignment updated");
      setSelfSwitchTarget(null);
      setPartnerPickerTarget(null);
      refreshAll();
    },
    onError: (e: any) => {
      toast.error(getApiError(e));
      setSelfSwitchTarget(null);
      setPartnerPickerTarget(null);
    },
  });

  const completeMutation = useMutation({
    mutationFn: (stop: any) =>
      api.put(`/farmers/me/route/${getStopId(stop)}/status`, {
        status: isPickup(stop) ? "picked_up" : "delivered",
        note: "Farmer completed stop from order map",
      }),
    onSuccess: (_data, stop) => {
      toast.success(`${stop.buyerName || "Order"} completed!`);
      refreshAll();
    },
    onError: () => toast.error("Failed to complete stop"),
  });

  const handleComplete = (stop: any) => {
    if (!completeMutation.isPending) completeMutation.mutate(stop);
  };

  const navigateToStop = (stop: any) => {
    const coordinates = getCoordinates(stop);
    if (coordinates) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${coordinates.lat},${coordinates.lng}`,
        "_blank"
      );
    } else {
      const query = encodeURIComponent(formatAddress(stop));
      window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, "_blank");
    }
  };

  const contactBuyer = (stop: any) => {
    const phone = stop.customerPhone || "";
    if (!phone) {
      toast.error("Buyer phone number is not available");
      return;
    }
    window.location.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
  };

  const onSwitchSelect = (order: any, value: string) => {
    if (value === "self") {
      setSelfSwitchTarget(order);
    } else if (value === "partner") {
      setSelectedPartnerId("auto");
      setPartnerPickerTarget(order);
    }
  };

  const confirmSwitchToSelf = () => {
    if (selfSwitchTarget) {
      switchMutation.mutate({ orderId: getStopId(selfSwitchTarget), mode: "self" });
    }
  };

  const confirmAssignPartner = () => {
    if (!partnerPickerTarget) return;
    switchMutation.mutate({
      orderId: getStopId(partnerPickerTarget),
      mode: "partner",
      partnerId: selectedPartnerId === "auto" ? undefined : selectedPartnerId,
    });
  };

  const isLoading = mapQuery.isLoading;
  const pendingCount = allOrders.length;
  const assignableOutside = outsideUnassigned;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Self-delivery workbench</p>
          <h1 className="text-3xl font-semibold tracking-tight">Order Map</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan deliveries by radius. Accept nearby orders for self-delivery or hand far orders to delivery partners. The time filter in the header applies to every panel on this page.
          </p>
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
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {DELIVERED_WINDOWS.map((w) => (
            <Button
              key={w.value}
              size="sm"
              variant={deliveredWindow === w.value ? "default" : "outline"}
              onClick={() => setDeliveredWindow(w.value)}
            >
              {w.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={requestLiveLocation} disabled={locationLoading}>
            {locationLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crosshair className="mr-1.5 h-4 w-4" />}
            {liveLocation ? "Use My Location" : "Locate Me"}
          </Button>
          <Badge
            variant={realtimeConnected ? "success" : "outline"}
            className="h-8 gap-1.5 px-2.5"
          >
            <span className={`h-2 w-2 rounded-full ${realtimeConnected ? "bg-emerald-500" : "bg-amber-500"}`} />
            {realtimeConnected ? "Live" : "Connecting"}
          </Badge>
          <Button size="sm" variant="outline" onClick={refreshAll} disabled={mapQuery.isFetching}>
            {mapQuery.isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Order Overview</CardTitle>
            <CardDescription>
              Delivery radius {radiusKm} km measured from {liveLocation ? "your current location" : "the farm"} · {DELIVERED_WINDOWS.find((w) => w.value === deliveredWindow)?.label} window.
            </CardDescription>
          </div>
          {summary.deliveryProblem > 0 && (
            <Badge variant="destructive" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> {summary.deliveryProblem} delivery problem{summary.deliveryProblem > 1 ? "s" : ""}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-8 2xl:grid-cols-10">
            <SummaryStat label="Total Orders" value={String(summary.totalOrders ?? 0)} />
            <SummaryStat label={`Within ${radiusKm} KM`} value={String(summary.withinRadius ?? 0)} tone="emerald" />
            <SummaryStat label={`Outside ${radiusKm} KM`} value={String(summary.outsideRadius ?? 0)} tone="orange" />
            <SummaryStat label="Self Delivery" value={String(summary.selfDelivery ?? 0)} tone="emerald" />
            <SummaryStat label="Partner Assigned" value={String(summary.partnerAssigned ?? 0)} tone="blue" />
            <SummaryStat label="Unassigned" value={String(summary.unassigned ?? 0)} tone="amber" />
            <SummaryStat label="Delivered" value={String(summary.delivered ?? 0)} />
            <SummaryStat label="Order Value" value={formatPrice(summary.totalValue ?? 0)} tone="emerald" />
            <SummaryStat label="Product Weight" value={`${summary.totalWeight ?? 0} KG`} tone="amber" />
            <SummaryStat label="Est. Distance" value={`${summary.estimatedDistance ?? 0} KM`} tone="violet" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50/60 to-violet-50/60">
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600" />
              AI Delivery Insight
            </CardTitle>
            <CardDescription>
              Predicted delivery risk and grouping opportunities from your active orders.
            </CardDescription>
          </div>
          {deliveryInsight.highRisk > 0 && (
            <Badge variant="destructive" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> {deliveryInsight.highRisk} high risk
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-white p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Delivery Risk Split</p>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-sm font-semibold">{deliveryInsight.lowRisk ?? 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  <span className="text-sm font-semibold">{deliveryInsight.mediumRisk ?? 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span className="text-sm font-semibold">{deliveryInsight.highRisk ?? 0}</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{deliveryInsight.totalOrders ?? 0} active orders assessed</p>
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Community Delivery Opportunity</p>
              {communityInsight.customerCount > 1 ? (
                <>
                  <p className="mt-1 text-sm font-semibold">
                    {communityInsight.customerCount} customers · {communityInsight.totalWeight} KG
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Batch these orders into one delivery to save distance.
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No batchable group detected yet.</p>
              )}
            </div>
            <div className="rounded-lg border bg-white p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Recommended</p>
              {deliveryInsight.highRisk > 0 ? (
                <p className="mt-1 text-sm text-amber-700">
                  Assign the {deliveryInsight.highRisk} high-risk order{deliveryInsight.highRisk > 1 ? "s" : ""} to a delivery partner, or deliver in an earlier slot.
                </p>
              ) : (
                <p className="mt-1 text-sm text-emerald-700">No high-risk orders — proceed with current assignments.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Button
          size="lg"
          variant="success"
          className="h-auto flex-col items-start gap-0.5 py-3 text-left"
          onClick={() => setAcceptDialogOpen(true)}
          disabled={capacityStats.fitsCount === 0 || acceptWithinMutation.isPending}
        >
          <span className="flex items-center">
            {acceptWithinMutation.isPending ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle className="mr-2 h-5 w-5" />
            )}
            Accept {Math.min(capacityStats.fitsCount, withinUnassigned.length)} Nearby Orders
            {capacityStats.overCapacity > 0 ? ` of ${withinUnassigned.length}` : ""}
          </span>
          <span className="pl-7 text-[11px] font-normal opacity-80">
            Self Delivery · fits your capacity ({capacityStats.maxOrders} orders / {capacityStats.maxWeightKg} kg)
          </span>
        </Button>
        <div className="flex gap-2">
          <Button
            size="lg"
            variant="warning"
            className="h-auto flex-1 flex-col items-start gap-0.5 py-3 text-left"
            onClick={() => {
              setAssignMode("marketplace");
              setManualPartnerIds({});
              setAssignDialogOpen(true);
            }}
            disabled={outsideUnassigned.length === 0 || assignOutsideMutation.isPending}
          >
            <span className="flex items-center">
              {assignOutsideMutation.isPending ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Truck className="mr-2 h-5 w-5" />
              )}
              Open {outsideUnassigned.length} Outside Orders for Partners
            </span>
            <span className="pl-7 text-[11px] font-normal opacity-80">
              Delivery Marketplace · first partner to accept wins
            </span>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-auto self-stretch px-3"
            title="Edit delivery capacity"
            onClick={openCapacityEditor}
          >
            <Settings2 className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {(activeJobs.length > 0 || stuckJobs.length > 0) && (
        <Card>
          <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-600" />
                Delivery Marketplace
              </CardTitle>
              <CardDescription>
                Jobs opened for delivery partners. The first eligible partner to accept wins —
                atomic claim means two partners can never take the same order.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="warning" className="gap-1.5">
                <Timer className="h-3.5 w-3.5" /> {waitingForPartner} waiting
              </Badge>
              {stuckJobs.length > 0 && (
                <Badge variant="destructive" className="gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> {stuckJobs.length} expired
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="max-h-[360px] space-y-3 overflow-y-auto">
            {[...activeJobs, ...stuckJobs].map((job) => {
              const isStuck = job.status === "no_partner_found" || job.status === "expired";
              const isAccepted = job.status === "accepted";
              return (
                <div key={job.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">#{job.orderNumber || "Order"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {job.distanceKm != null ? `${job.distanceKm} km` : "—"} · {job.weightKg ?? 0} kg ·{" "}
                        {formatPrice(job.earnings)} earnings · {job.eligibleCount ?? 0} partner
                        {(job.eligibleCount ?? 0) === 1 ? "" : "s"} notified
                      </p>
                      {isAccepted && job.partnerName && (
                        <p className="mt-1 text-xs font-medium text-emerald-700">
                          Partner: {job.partnerName}
                          {job.partnerPhone ? ` · ${job.partnerPhone}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!isAccepted && !isStuck && <JobCountdown expiresAt={job.expiresAt} />}
                      {isAccepted && <Badge variant="success">Partner Assigned</Badge>}
                      {isStuck && <Badge variant="destructive">No Partner Found</Badge>}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isStuck && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={switchMutation.isPending}
                          onClick={() =>
                            switchMutation.mutate({ orderId: job.orderId, mode: "self" })
                          }
                        >
                          <CheckCircle className="mr-1 h-3.5 w-3.5" /> Self Deliver
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={extendJobMutation.isPending}
                          onClick={() => extendJobMutation.mutate({ orderId: job.orderId })}
                        >
                          <Timer className="mr-1 h-3.5 w-3.5" /> Reopen for Partners
                        </Button>
                      </>
                    )}
                    {job.status === "open" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={extendJobMutation.isPending}
                          onClick={() => extendJobMutation.mutate({ orderId: job.orderId })}
                        >
                          <Timer className="mr-1 h-3.5 w-3.5" /> Extend 2h
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={closeJobMutation.isPending}
                          onClick={() => closeJobMutation.mutate(job.orderId)}
                        >
                          Close
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.85fr)]">
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Delivery Order Locations</CardTitle>
              <CardDescription>
                Green = self delivery · Blue = delivery partner · Yellow = pending assignment · Red = delivery problem · Black = delivered · Purple = farm
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#10B981" }} /> Self
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#3B82F6" }} /> Partner
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#F59E0B" }} /> Pending
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#EF4444" }} /> Problem
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#111827" }} /> Completed
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#8B5CF6" }} /> Farm
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="h-[560px] animate-pulse rounded-b-lg bg-muted" />
            ) : allOrders.length === 0 ? (
              <div className="flex h-[420px] flex-col items-center justify-center gap-3 rounded-b-lg border-t bg-muted/20 p-6 text-center">
                <MapPin className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">No pending orders on the map</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    New orders will appear here once buyers place them.
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
                circle={farmCoordinates ? { center: farmCoordinates, radiusKm } : undefined}
                onMarkerClick={(marker) => {
                  if (marker.id !== "farm") setSelectedStopId(String(marker.id));
                }}
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Selected Order</CardTitle>
              <CardDescription>Switch the assignment or take an action on this order.</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedStop ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Select an order from the map or lists.</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">{selectedStop.buyerName || selectedStop.orderNumber || "Delivery order"}</p>
                      {getStatusBadge(selectedStop)}
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{formatAddress(selectedStop)}</p>
                    {selectedStop.distance != null && (
                      <p className="mt-2 text-sm font-medium text-emerald-700">
                        {selectedStop.distance} km from farm
                      </p>
                    )}
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedStop.quantity || "0"} · {selectedStop.product || "Items"} · {formatPrice(selectedStop.total)}
                    </p>
                    {selectedStop.time && (
                      <p className="mt-1 text-sm text-muted-foreground">Slot: {selectedStop.time}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={selectedStop.isCOD ? "warning" : "default"}>
                        {selectedStop.isCOD ? "COD" : "Paid"}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={stateBadgeClass(selectedStop)}
                      >
                        {stateLabel(selectedStop)}
                      </Badge>
                    </div>
                  </div>
                  {selectedStop.deliveredAt && (
                    <p className="text-xs text-slate-500">
                      Delivered {formatRelativeTime(selectedStop.deliveredAt)} ({new Date(selectedStop.deliveredAt).toLocaleString()})
                    </p>
                  )}
                  {!isDone(selectedStop) && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Assignment</p>
                      <Select
                        value={selectedStop.assignment === "unassigned" ? "unassigned" : selectedStop.assignment}
                        onValueChange={(v) => onSwitchSelect(selectedStop, v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose assignment" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="self">Self Delivery</SelectItem>
                          <SelectItem value="partner">Delivery Partner</SelectItem>
                          <SelectItem value="unassigned">
                            Unassigned
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {!isDone(selectedStop) && selectedStop.canComplete !== false && (
                      <Button
                        className="flex-1"
                        onClick={() => handleComplete(selectedStop)}
                        disabled={completeMutation.isPending}
                      >
                        {completeMutation.isPending ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle className="mr-1.5 h-4 w-4" />
                        )}
                        {isPickup(selectedStop) ? "Mark Picked Up" : "Mark Delivered"}
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => navigateToStop(selectedStop)}>
                      <Navigation className="mr-1.5 h-4 w-4" />
                      Navigate
                    </Button>
                    <Button variant="outline" onClick={() => contactBuyer(selectedStop)}>
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
              <CardTitle>Available Partners</CardTitle>
              <CardDescription>
                {availablePartners.length > 0
                  ? `${availablePartners.length} verified partner(s) ready to accept outside deliveries.`
                  : "No verified partners available right now."}
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[320px] space-y-3 overflow-y-auto">
              {availablePartners.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No partners available.</p>
              ) : (
                availablePartners.map((p) => (
                  <div key={p.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.vehicleType} · {p.vehicleNumber}
                        </p>
                      </div>
                      <Badge variant="success">Available</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 text-amber-500" /> {p.rating ?? 0}
                      </span>
                      <span>{p.activeLoad ?? 0} active</span>
                      {p.distanceKm != null && <span>{p.distanceKm} km away</span>}
                      {p.capacity != null && <span>capacity {p.capacity} kg</span>}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-emerald-700">
              Within {radiusKm} km <span className="text-muted-foreground">({within.length})</span>
            </CardTitle>
            <CardDescription>Orders near your farm - good candidates for self delivery.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[520px] space-y-4 overflow-y-auto">
            {within.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No orders within {radiusKm} km.</p>
            ) : (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-emerald-700">
                      Ready for Self Delivery ({withinUnassigned.length})
                    </p>
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Unassigned orders that will be claimed when you accept within {radiusKm} km.
                  </p>
                  {withinUnassigned.length === 0 ? (
                    <p className="rounded-lg border border-dashed py-3 text-center text-sm text-muted-foreground">
                      All within-radius orders are already assigned.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {withinUnassigned.map((stop, index) => (
                        <OrderCard
                          key={getStopId(stop)}
                          stop={stop}
                          index={index + 1}
                          selected={getStopId(stop) === selectedStopId}
                          onSelect={() => setSelectedStopId(getStopId(stop))}
                          onSwitch={(v) => onSwitchSelect(stop, v)}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {withinAssigned.length > 0 && (
                  <div>
                    <p className="mb-3 text-sm font-semibold text-slate-500">
                      Already Assigned ({withinAssigned.length})
                    </p>
                    <div className="space-y-3">
                      {withinAssigned.map((stop, index) => (
                        <OrderCard
                          key={getStopId(stop)}
                          stop={stop}
                          index={index + 1}
                          selected={getStopId(stop) === selectedStopId}
                          onSelect={() => setSelectedStopId(getStopId(stop))}
                          onSwitch={(v) => onSwitchSelect(stop, v)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-orange-700">
              Outside {radiusKm} km <span className="text-muted-foreground">({outside.length})</span>
            </CardTitle>
            <CardDescription>Far orders - assign these to delivery partners to save time.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[520px] space-y-4 overflow-y-auto">
            {outside.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">All orders are within {radiusKm} km.</p>
            ) : (
              <>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                      <AlertTriangle className="h-4 w-4" /> Needs Partner Assignment ({outsideUnassigned.length})
                    </p>
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Unassigned far orders. These are handed to partners when you confirm{" "}
                    &quot;Assign All Outside {radiusKm} km&quot;.
                  </p>
                  {outsideUnassigned.length === 0 ? (
                    <p className="rounded-lg border border-dashed py-3 text-center text-sm text-muted-foreground">
                      All outside orders are already assigned to self or a partner.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {outsideUnassigned.map((stop, index) => (
                        <OrderCard
                          key={getStopId(stop)}
                          stop={stop}
                          index={index + 1}
                          selected={getStopId(stop) === selectedStopId}
                          onSelect={() => setSelectedStopId(getStopId(stop))}
                          onSwitch={(v) => onSwitchSelect(stop, v)}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {outsideAssigned.length > 0 && (
                  <div>
                    <p className="mb-3 text-sm font-semibold text-slate-500">
                      Already Assigned ({outsideAssigned.length})
                    </p>
                    <div className="space-y-3">
                      {outsideAssigned.map((stop, index) => (
                        <OrderCard
                          key={getStopId(stop)}
                          stop={stop}
                          index={index + 1}
                          selected={getStopId(stop) === selectedStopId}
                          onSelect={() => setSelectedStopId(getStopId(stop))}
                          onSwitch={(v) => onSwitchSelect(stop, v)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {unlocated.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-blue-700">Unlocated ({unlocated.length})</CardTitle>
            <CardDescription>These orders could not be placed on the map yet - add their delivery location.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[320px] space-y-3 overflow-y-auto">
            {unlocated.map((stop, index) => (
              <OrderCard
                key={getStopId(stop)}
                stop={stop}
                index={index + 1}
                selected={false}
                onSelect={() => {}}
                onSwitch={(v) => onSwitchSelect(stop, v)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-slate-600">
              Delivered{" "}
              <span className="text-muted-foreground">({delivered.length})</span>{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · {DELIVERED_WINDOWS.find((w) => w.value === deliveredWindow)?.label}
              </span>
            </CardTitle>
            <CardDescription>
              Orders already delivered within the selected time window. Use the filter in the header to change the window for the whole page.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="max-h-[320px] space-y-3 overflow-y-auto">
          {delivered.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No delivered orders in this window yet.
            </p>
          ) : (
            delivered.map((stop, index) => (
              <OrderCard
                key={getStopId(stop)}
                stop={stop}
                index={index + 1}
                selected={getStopId(stop) === selectedStopId}
                onSelect={() => setSelectedStopId(getStopId(stop))}
                onSwitch={(v) => onSwitchSelect(stop, v)}
                readOnly
              />
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={acceptDialogOpen} onOpenChange={(v) => !v && setAcceptDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept {Math.min(capacityStats.fitsCount, withinUnassigned.length)} nearby orders for Self Delivery?</DialogTitle>
            <DialogDescription>
              {capacityStats.fitsCount === withinUnassigned.length ? (
                <>
                  All {withinUnassigned.length} unassigned order{withinUnassigned.length === 1 ? "" : "s"} within {radiusKm} km fit your delivery
                  capacity. They appear in your Route, Delivery Calendar and Smart Route immediately.
                </>
              ) : (
                <>
                  Your capacity fits {capacityStats.fitsCount} of {withinUnassigned.length} unassigned orders (nearest
                  first). The remaining {capacityStats.overCapacity} stay unassigned — open them for partners afterwards.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Orders</p>
              <p className="text-xl font-bold">
                {Math.min(capacityStats.fitsCount, withinUnassigned.length)}
                <span className="text-xs font-normal text-muted-foreground"> /{capacityStats.maxOrders}</span>
              </p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Weight</p>
              <p className="text-xl font-bold">
                {capacityStats.fitsWeight}
                <span className="text-xs font-normal text-muted-foreground"> /{capacityStats.maxWeightKg} kg</span>
              </p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Est. route time</p>
              <p className="text-xl font-bold">
                {Math.floor(capacityStats.fitsMinutes / 60)}h {capacityStats.fitsMinutes % 60}m
                <span className="text-xs font-normal text-muted-foreground"> /{capacityStats.maxRouteMinutes}m</span>
              </p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Order value</p>
              <p className="text-xl font-bold">{formatPrice(withinActionStats.value)}</p>
            </div>
          </div>
          {capacityStats.overCapacity > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {capacityStats.overCapacity} order{capacityStats.overCapacity > 1 ? "s" : ""} exceed your capacity. After
              accepting, use “Open Outside Orders for Partners” (or jobs → Reopen) to send them to the marketplace.
            </p>
          )}
          <div className="rounded-lg border bg-slate-50 p-3 text-sm">
            <p className="flex items-center justify-between gap-2 text-muted-foreground">
              <span>Capacity limits</span>
              <button type="button" className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" onClick={openCapacityEditor}>
                <Settings2 className="h-3.5 w-3.5" /> Edit
              </button>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Nearest orders are claimed first until any limit is reached.
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setAcceptDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" onClick={() => acceptWithinMutation.mutate()} disabled={acceptWithinMutation.isPending}>
              {acceptWithinMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Yes, Accept {Math.min(capacityStats.fitsCount, withinUnassigned.length)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={capacityEditorOpen} onOpenChange={(v) => !v && setCapacityEditorOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delivery Capacity</DialogTitle>
            <DialogDescription>
              Bulk self-delivery acceptance stops at these limits. Used by the Order Map and profitability estimates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Maximum orders per run</label>
              <Input
                type="number"
                min={1}
                value={capacityDraft.maxOrders}
                onChange={(e) => setCapacityDraft({ ...capacityDraft, maxOrders: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Maximum weight (kg)</label>
              <Input
                type="number"
                min={1}
                value={capacityDraft.maxWeightKg}
                onChange={(e) => setCapacityDraft({ ...capacityDraft, maxWeightKg: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500">Maximum route time (minutes)</label>
              <Input
                type="number"
                min={30}
                step={15}
                value={capacityDraft.maxRouteMinutes}
                onChange={(e) => setCapacityDraft({ ...capacityDraft, maxRouteMinutes: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setCapacityEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                saveCapacityMutation.mutate({
                  maxOrders: Math.max(1, Number(capacityDraft.maxOrders) || 20),
                  maxWeightKg: Math.max(1, Number(capacityDraft.maxWeightKg) || 100),
                  maxRouteMinutes: Math.max(30, Number(capacityDraft.maxRouteMinutes) || 180),
                })
              }
              disabled={saveCapacityMutation.isPending}
            >
              {saveCapacityMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
              Save Capacity
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={assignDialogOpen} onOpenChange={(v) => !v && setAssignDialogOpen(false)} wide>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign outside orders to delivery partners</DialogTitle>
            <DialogDescription>
              {outsideActionStats.count} unassigned order{outsideActionStats.count === 1 ? "" : "s"} are outside {radiusKm} km.
              Choose how they should be handled. Nothing is assigned until you confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Orders</p>
              <p className="text-xl font-bold">{outsideActionStats.count}</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Total value</p>
              <p className="text-xl font-bold">{formatPrice(outsideActionStats.value)}</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Total weight</p>
              <p className="text-xl font-bold">{outsideActionStats.weight} KG</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-center">
              <p className="text-xs text-muted-foreground">Estimated distance</p>
              <p className="text-xl font-bold">{outsideActionStats.distance.toFixed(1)} KM</p>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setAssignMode("marketplace")}
              className={`w-full rounded-lg border p-3 text-left transition ${assignMode === "marketplace" ? "border-primary bg-primary/5" : "bg-white hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                <p className="font-semibold">Post to All Delivery Partners (recommended)</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                These orders are shown to every eligible delivery partner. The first partner to accept wins -
                once accepted the order moves to in-transit and other partners can no longer take it, so two or
                more partners can never accept the same order.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setAssignMode("ai")}
              className={`w-full rounded-lg border p-3 text-left transition ${assignMode === "ai" ? "border-primary bg-primary/5" : "bg-white hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="font-semibold">AI Auto Assign</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Scores each partner by rating, remaining capacity, workload, time slot and proximity to balance the
                deliveries automatically.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setAssignMode("manual")}
              className={`w-full rounded-lg border p-3 text-left transition ${assignMode === "manual" ? "border-primary bg-primary/5" : "bg-white hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <p className="font-semibold">Manual Assignment</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a partner for every order yourself. Fine-tune any order later from the map.
              </p>
            </button>
          </div>

          {assignMode === "manual" && (
            <div className="max-h-[300px] space-y-2 overflow-y-auto rounded-lg border p-3">
              {assignableOutside.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  All outside orders are already assigned.
                </p>
              ) : (
                assignableOutside.map((order) => {
                  const oid = getStopId(order);
                  const partnerId = manualPartnerIds[oid] || "auto";
                  return (
                    <div key={oid} className="flex flex-col gap-2 rounded-md border bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          #{order.orderNumber || "Order"} · {order.buyerName || "Customer"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.distance != null ? `${order.distance} km` : "—"} · {order.quantityKg ?? 0} kg · {formatPrice(order.total)}
                        </p>
                      </div>
                      <Select
                        value={partnerId}
                        onValueChange={(v) =>
                          setManualPartnerIds((prev) => ({ ...prev, [oid]: v === "auto" ? "auto" : v }))
                        }
                      >
                        <SelectTrigger className="h-8 w-full sm:w-52">
                          <SelectValue placeholder="Choose partner" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto - best available</SelectItem>
                          {availablePartners.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.rating}★ · {p.activeLoad ?? 0} active)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {availablePartners.length === 0 && assignMode !== "marketplace" && (
            <p className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" /> No verified partners are available right now. Posting to all
              partners still works - jobs stay open for any partner to accept.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                assignOutsideMutation.mutate(
                  assignMode === "manual"
                    ? { mode: "manual", partnerIds: manualPartnerIds }
                    : { mode: assignMode }
                )
              }
              disabled={assignOutsideMutation.isPending || assignableOutside.length === 0}
            >
              {assignOutsideMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              {assignMode === "marketplace"
                ? `Post ${assignableOutside.length} Orders to All Partners`
                : `Assign ${assignableOutside.length} Orders`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selfSwitchTarget} onOpenChange={(v) => !v && setSelfSwitchTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to self delivery</DialogTitle>
            <DialogDescription>
              Take order #{selfSwitchTarget?.orderNumber || ""} for your own delivery? It will leave the partner queue
              and appear in your Route immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-slate-50 p-3 text-sm">
            <p>
              <strong>{selfSwitchTarget?.buyerName || "Customer"}</strong> · {formatAddress(selfSwitchTarget)} ·{" "}
              {formatPrice(selfSwitchTarget?.total)}
            </p>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setSelfSwitchTarget(null)}>
              Cancel
            </Button>
            <Button variant="success" onClick={confirmSwitchToSelf} disabled={switchMutation.isPending}>
              {switchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Yes, Deliver Myself
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!partnerPickerTarget} onOpenChange={(v) => !v && setPartnerPickerTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign to delivery partner</DialogTitle>
            <DialogDescription>
              Choose a partner for order #{partnerPickerTarget?.orderNumber || ""} or let the system pick the best match.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[360px] space-y-2 overflow-y-auto">
            <button
              type="button"
              onClick={() => setSelectedPartnerId("auto")}
              className={`w-full rounded-lg border p-3 text-left transition ${selectedPartnerId === "auto" ? "border-primary bg-primary/5" : "bg-white hover:bg-slate-50"}`}
            >
              <p className="text-sm font-semibold">Auto - best available partner</p>
              <p className="text-xs text-muted-foreground">Nearest / least-loaded verified partner.</p>
            </button>
            {availablePartners.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPartnerId(p.id)}
                className={`w-full rounded-lg border p-3 text-left transition ${selectedPartnerId === p.id ? "border-primary bg-primary/5" : "bg-white hover:bg-slate-50"}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{p.name}</p>
                  <Badge variant="success">Available</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.vehicleType} · {p.rating}★ · {p.activeLoad ?? 0} active{p.distanceKm != null ? ` · ${p.distanceKm} km` : ""}
                </p>
              </button>
            ))}
            {availablePartners.length === 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4" /> No verified partners are available right now.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setPartnerPickerTarget(null)}>
              Cancel
            </Button>
            <Button onClick={confirmAssignPartner} disabled={switchMutation.isPending || availablePartners.length === 0}>
              {switchMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              Assign
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JobCountdown({ expiresAt }: { expiresAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return <Badge variant="destructive">Expired</Badge>;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const label =
    hours > 0
      ? `${hours}h ${String(minutes).padStart(2, "0")}m`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;
  const urgent = totalSeconds < 15 * 60;
  return (
    <span
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${
        urgent ? "border-red-300 bg-red-50 text-red-600" : "border-amber-300 bg-amber-50 text-amber-700"
      }`}
    >
      <Timer className="h-3 w-3" />
      {label}
    </span>
  );
}

function SummaryStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "orange" | "blue" | "amber" | "violet";
}) {
  const tones: Record<string, string> = {
    default: "text-slate-700",
    emerald: "text-emerald-600",
    orange: "text-orange-600",
    blue: "text-blue-600",
    amber: "text-amber-600",
    violet: "text-violet-600",
  };
  return (
    <div className="rounded-lg border bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-lg font-bold ${tones[tone] || tones.default}`}>{value}</p>
    </div>
  );
}

function OrderCard({
  stop,
  index,
  selected,
  onSelect,
  onSwitch,
  readOnly = false,
}: {
  stop: any;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onSwitch: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 transition ${
        readOnly
          ? selected
            ? "border-slate-500 bg-slate-100"
            : "border-slate-200 bg-slate-50"
          : selected
            ? "border-emerald-500 bg-emerald-50"
            : "bg-white hover:bg-slate-50"
      }`}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {index}. {stop.buyerName || stop.orderNumber || "Delivery order"}
            </p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{formatAddress(stop)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stop.quantity} · {stop.product || "Items"} · {formatPrice(stop.total)}
              {stop.distance != null ? ` · ${stop.distance} km` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {priorityBadge(stop)}
            {getStatusBadge(stop)}
            <Badge
              variant="outline"
              className={stateBadgeClass(stop)}
            >
              {stateLabel(stop)}
            </Badge>
          </div>
        </div>
      </button>
      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <Select
            value={stop.assignment === "unassigned" ? "unassigned" : stop.assignment}
            onValueChange={onSwitch}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder="Switch assignment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">Self Delivery</SelectItem>
              <SelectItem value="partner">Delivery Partner</SelectItem>
              <SelectItem value="unassigned">
                Unassigned
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
          >
            <Navigation className="mr-1 h-3.5 w-3.5" />
            View
          </Button>
        </div>
      )}
    </div>
  );
}
