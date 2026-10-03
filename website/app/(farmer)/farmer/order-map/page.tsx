"use client";
import { DeliveryWorkflowNav } from "../../../components/farmer/delivery-workflow-nav";

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
  ListChecks,
  Phone,
  RefreshCw,
  Settings2,
  Sparkles,
  Star,
  Timer,
  Truck,
  Users,
  UserCheck,
  CalendarDays,
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

// Orders with the same delivery coordinates are grouped only for map display.
// Their order IDs remain independent so each order can be selected/assigned separately.
const getLocationGroupKey = (stop: any) => {
  const coordinates = getCoordinates(stop);
  if (!coordinates) return "";
  return `${coordinates.lat.toFixed(6)},${coordinates.lng.toFixed(6)}`;
};

// Customer/member identity is used only to describe grouped map stops.
// Orders are never merged: every order keeps its own ID and selection state.
const getCustomerIdentityKey = (stop: any) => {
  const raw =
    stop?.customerId ?? stop?.customer_id ??
    stop?.memberId ?? stop?.member_id ??
    stop?.buyerId ?? stop?.buyer_id ??
    stop?.customer?.id ?? stop?.customer?.userId ?? stop?.customer?.user_id ??
    stop?.member?.id ?? stop?.member?.userId ?? stop?.member?.user_id;
  return raw == null || raw === "" ? "" : String(raw);
};

const getCustomerDisplayName = (stop: any) =>
  String(stop?.buyerName ?? stop?.customerName ?? stop?.customer?.name ?? stop?.memberName ?? stop?.member?.name ?? "Customer");

const getProductIdentityKey = (stop: any) => {
  const raw =
    stop?.productId ?? stop?.product_id ??
    stop?.product?.id ?? stop?.product?.productId ??
    stop?.variantId ?? stop?.variant_id;
  if (raw != null && raw !== "") return String(raw);
  const name = stop?.product ?? stop?.productName ?? stop?.itemName ?? stop?.cropName ?? stop?.name;
  return name == null || name === "" ? "" : String(name).trim().toLowerCase();
};

const getProductDisplayName = (stop: any) =>
  String(stop?.product ?? stop?.productName ?? stop?.itemName ?? stop?.cropName ?? "Items");

const getLocationGroupMeta = (orders: any[]) => {
  const customerKeys = orders.map(getCustomerIdentityKey).filter(Boolean);
  const sameCustomer = orders.length > 1 && customerKeys.length === orders.length && new Set(customerKeys).size === 1;
  const productKeys = orders.map(getProductIdentityKey).filter(Boolean);
  const sameProduct = orders.length > 1 && productKeys.length === orders.length && new Set(productKeys).size === 1;
  const productNames = Array.from(new Set(orders.map(getProductDisplayName).filter(Boolean)));
  const totalWeight = orders.reduce((sum, order) => sum + Number(order?.quantityKg ?? order?.quantity ?? 0), 0);
  return {
    sameCustomer,
    sameProduct,
    customerName: sameCustomer ? getCustomerDisplayName(orders[0]) : "",
    productName: sameProduct ? getProductDisplayName(orders[0]) : "",
    customerNames: Array.from(new Set(orders.map(getCustomerDisplayName).filter(Boolean))),
    productNames,
    totalWeight,
    totalValue: orders.reduce((sum, order) => sum + Number(order?.total ?? 0), 0),
  };
};

const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const distanceToRouteKm = (point: { lat: number; lng: number }, route: { lat: number; lng: number }[]) => {
  if (route.length < 2) return { distanceKm: Infinity, position: 0 };
  let best = { distanceKm: Infinity, position: 0 };
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i];
    const b = route[i + 1];
    const latScale = 111.32;
    const lngScale = 111.32 * Math.cos((point.lat * Math.PI) / 180);
    const ax = a.lng * lngScale, ay = a.lat * latScale;
    const bx = b.lng * lngScale, by = b.lat * latScale;
    const px = point.lng * lngScale, py = point.lat * latScale;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const cx = ax + t * dx, cy = ay + t * dy;
    const distanceKm = Math.hypot(px - cx, py - cy);
    const position = i + t;
    if (distanceKm < best.distanceKm) best = { distanceKm, position };
  }
  return best;
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
  const [selfDeliveryMethod, setSelfDeliveryMethod] = useState<"route" | "radius">("radius");
  const [mapFilterMode, setMapFilterMode] = useState<"all" | "radius" | "route">("all");
  const [deliveredWindow, setDeliveredWindow] = useState<string>("today");
  const [liveLocation, setLiveLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(false);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedLocationGroupKey, setSelectedLocationGroupKey] = useState<string | null>(null);
  // Optional route-planning selection. This is UI-only and does not change order assignment or fulfillment state.
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>([]);
  const [routeStart, setRouteStart] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [routeStartText, setRouteStartText] = useState("");
  const [routeStartSearchResults, setRouteStartSearchResults] = useState<any[]>([]);
  const [routeStartSearching, setRouteStartSearching] = useState(false);
  const [routeDestination, setRouteDestination] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [routeDestinationText, setRouteDestinationText] = useState("");
  const [routeSearchResults, setRouteSearchResults] = useState<any[]>([]);
  const [routeSearching, setRouteSearching] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routePickMode, setRoutePickMode] = useState(false);
  const [routeGeometry, setRouteGeometry] = useState<{ lat: number; lng: number }[]>([]);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationMinutes: number } | null>(null);
  const [routeMatches, setRouteMatches] = useState<any[]>([]);

  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [partnerDecisionOpen, setPartnerDecisionOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"marketplace" | "manual" | "ai">("marketplace");
  const [selfSwitchTarget, setSelfSwitchTarget] = useState<any>(null);
  const [partnerPickerTarget, setPartnerPickerTarget] = useState<any>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>("auto");
  const [manualPartnerIds, setManualPartnerIds] = useState<Record<string, string>>({});
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [capacityEditorOpen, setCapacityEditorOpen] = useState(false);
  const [capacityDraft, setCapacityDraft] = useState({ maxOrders: "20", maxWeightKg: "100", maxRouteMinutes: "180" });
  const [lastPlanResult, setLastPlanResult] = useState<any>(null);

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
  // The authenticated map query already refreshes every 30 seconds.
  // Browser EventSource cannot attach this app's Bearer token, so using it here
  // caused repeated 401 responses from /farmers/me/delivery-map/events.
  useEffect(() => {
    setRealtimeConnected(Boolean(mapQuery.data));
  }, [mapQuery.data]);

  // Resolve the farm origin before any memoized map/radius/route calculations.
  // Keeping this above those hooks avoids a temporal-dead-zone runtime error.
  const farmCoordinates =
    farm?.lat != null && farm?.lng != null
      ? { lat: Number(farm.lat), lng: Number(farm.lng) }
      : null;

  // Delivery selection starts from every packed Farmer Fulfillment order
  // returned by the delivery-map endpoint. "withinRadius" and "outsideRadius"
  // are backend reporting buckets, not initial UI filters. Both are merged
  // here so the initial map always starts in "All" mode.
  // Delivered orders are intentionally excluded from this delivery-planning
  // workspace; they belong to tracking/history, not delivery selection.
  const packedOrders = useMemo(() => {
    return [...within, ...outside, ...unlocated]
      .filter((stop) => !isDone(stop))
      .map((stop) => ({ ...stop, mapCoordinates: getCoordinates(stop) }))
      .sort((a, b) => (a.distance ?? 9999) - (b.distance ?? 9999));
  }, [within, outside, unlocated]);

  const selectedStop =
    packedOrders.find((stop) => getStopId(stop) === selectedStopId) || packedOrders[0] || null;

  // The delivery-map API is the single source of truth for packed Farmer
  // Fulfillment orders. It applies the same packed criteria as Packing &
  // Checking and performs address -> coordinates geocoding when coordinates
  // are missing. Do not repeat fulfillment/stage filtering here: doing so can
  // silently hide valid packed orders created by older checkout versions.
  //
  // Keep located and unlocated orders together for the workflow/list. Only
  // located orders can become map markers; unlocated orders are shown in the
  // Unlocated section with the reason instead of being silently discarded.
  // The Order Map is the only delivery-selection workspace.
  // Only packed Farmer Fulfillment orders that are still awaiting a delivery
  // decision are selectable here. Once the farmer confirms the plan, the
  // assigned order leaves the selection map and remains visible through the
  // normal order/delivery tracking surfaces.
  const routeCandidates = useMemo(
    () =>
      packedOrders.filter(
        (stop) =>
          !isDone(stop) &&
          String(stop?.assignment || "unassigned").toLowerCase() === "unassigned" &&
          !stop?.deliveryPartnerId &&
          !stop?.partnerRequested &&
          !stop?.selfDelivery
      ),
    [packedOrders]
  );

  // Initial state shows every packed Farmer Fulfillment order waiting for
  // delivery selection. Radius and Route only filter the visible set; they
  // never assign orders.
  const mapOrders = useMemo(() => {
    if (mapFilterMode === "radius") {
      const center = farmCoordinates || liveLocation;
      if (!center) return routeCandidates;
      return routeCandidates.filter((stop) => {
        const coordinates = getCoordinates(stop);
        return coordinates ? haversineKm(center, coordinates) <= radiusKm : false;
      });
    }
    if (mapFilterMode === "route") {
      const ids = new Set(routeMatches.map((stop) => getStopId(stop)));
      return routeCandidates.filter((stop) => ids.has(getStopId(stop)));
    }
    return routeCandidates;
  }, [routeCandidates, farmCoordinates, liveLocation, mapFilterMode, radiusKm, routeMatches]);

  const selectedRouteOrders = useMemo(
    () =>
      routeCandidates
        .filter((stop) => selectedRouteIds.includes(getStopId(stop)))
        .sort((a, b) => Number(a.distance ?? 9999) - Number(b.distance ?? 9999)),
    [routeCandidates, selectedRouteIds]
  );

  const routePlanStats = useMemo(() => {
    const weight = selectedRouteOrders.reduce((sum, stop) => sum + Number(stop.quantityKg || 0), 0);
    const distance = routeInfo?.distanceKm ?? selectedRouteOrders.reduce((sum, stop) => sum + Number(stop.distance || 0), 0);
    const minutes = routeInfo?.durationMinutes ?? selectedRouteOrders.reduce(
      (sum, stop) => sum + (Number(stop.distance || 0) / 25) * 60 + 10,
      0
    );
    return {
      count: selectedRouteOrders.length,
      physicalStops: new Set(selectedRouteOrders.map((stop) => stop?.physicalStopKey || getLocationGroupKey(stop)).filter(Boolean)).size || selectedRouteOrders.length,
      weight: Math.round(weight * 10) / 10,
      distance: Math.round(distance * 10) / 10,
      minutes: Math.round(minutes),
    };
  }, [selectedRouteOrders, routeInfo]);

  const selectSelfDeliveryMethod = (method: "route" | "radius") => {
    setSelfDeliveryMethod(method);
    setSelectedRouteIds([]);
    setRouteMatches([]);
    setMapFilterMode("all");
    if (method === "radius") {
      setRouteDestination(null);
      setRouteGeometry([]);
      setRouteInfo(null);
    }
  };

  const applyRadiusFilter = (distance: number) => {
    setRadiusKm(distance);
    setMapFilterMode("radius");
    setSelectedRouteIds([]);
    setSelectedStopId(null);
    toast.success(`Showing orders within ${distance} km of the farm`);
  };

  const showAllMapOrders = () => {
    setMapFilterMode("all");
    setSelectedRouteIds([]);
    setSelectedStopId(null);
  };

  const toggleSelectedOrder = (orderId: string) => {
    setSelectedRouteIds((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]
    );
  };

  const selectVisibleOrdersForSelfDelivery = () => {
    const eligible = mapOrders
      .filter((stop) => !isDone(stop) && stop?.assignment === "unassigned")
      .map((stop) => getStopId(stop))
      .filter(Boolean);
    setSelectedRouteIds(eligible);
    toast.success(eligible.length + " order" + (eligible.length === 1 ? "" : "s") + " selected for self delivery");
  };

  const toggleRouteOrder = toggleSelectedOrder;

  const chooseRouteStart = (lat: number, lng: number, label: string) => {
    setRouteStart({ lat, lng, label });
    setRouteStartText(label);
    setRouteStartSearchResults([]);
  };

  const useFarmAsRouteStart = () => {
    if (!farmCoordinates) return toast.error("Your farm location is not available");
    chooseRouteStart(farmCoordinates.lat, farmCoordinates.lng, farm?.address || farm?.name || "My Farm");
  };

  const useLiveLocationAsRouteStart = () => {
    if (!liveLocation) {
      requestLiveLocation();
      toast("Getting your current location…", { icon: "📍" });
      return;
    }
    chooseRouteStart(liveLocation.lat, liveLocation.lng, "My current location");
  };

  const searchRouteStart = async () => {
    const query = routeStartText.trim();
    if (!query) return toast.error("Enter a start location first");
    setRouteStartSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
        { headers: { "Accept-Language": "en", "User-Agent": "agriconnect-farmer-route/1.0" } }
      );
      if (!response.ok) throw new Error("Start location search failed");
      const results = await response.json();
      setRouteStartSearchResults(Array.isArray(results) ? results : []);
      if (!results?.length) toast.error("Start location not found. Try a more specific place or address.");
    } catch (e: any) {
      toast.error(e?.message || "Could not search the start location");
    } finally {
      setRouteStartSearching(false);
    }
  };

  const chooseRouteDestination = (lat: number, lng: number, label: string) => {
    setRouteDestination({ lat, lng, label });
    setRouteDestinationText(label);
    setRouteSearchResults([]);
    setRoutePickMode(false);
  };

  const searchRouteDestination = async () => {
    const query = routeDestinationText.trim();
    if (!query) return toast.error("Enter a destination first");
    setRouteSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`,
        { headers: { "Accept-Language": "en", "User-Agent": "agriconnect-farmer-route/1.0" } }
      );
      if (!response.ok) throw new Error("Destination search failed");
      const results = await response.json();
      setRouteSearchResults(Array.isArray(results) ? results : []);
      if (!results?.length) toast.error("Destination not found. Try a more specific place or address.");
    } catch (e: any) {
      toast.error(e?.message || "Could not search destination");
    } finally {
      setRouteSearching(false);
    }
  };

  const findOrdersAlongRoute = async () => {
    if (!routeDestination) return toast.error("Choose a destination first");
    const origin = routeStart || (farmCoordinates ? { ...farmCoordinates, label: farm?.address || farm?.name || "My Farm" } : liveLocation ? { ...liveLocation, label: "My current location" } : null);
    if (!origin) return toast.error("Choose a start location or use your current location");
    setRouteLoading(true);
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${routeDestination.lng},${routeDestination.lat}?overview=full&geometries=geojson&steps=false`
      );
      if (!response.ok) throw new Error("Route service unavailable");
      const payload = await response.json();
      const route = payload?.routes?.[0];
      const geometry = route?.geometry?.coordinates;
      if (!route || !Array.isArray(geometry) || geometry.length < 2) {
        throw new Error("Could not calculate a road route to that destination");
      }
      const points = geometry.map((c: number[]) => ({ lat: Number(c[1]), lng: Number(c[0]) }));
      setRouteGeometry(points);
      setRouteInfo({
        distanceKm: Math.round((Number(route.distance || 0) / 1000) * 10) / 10,
        durationMinutes: Math.max(1, Math.round(Number(route.duration || 0) / 60)),
      });
      const matches = routeCandidates
        .map((stop) => {
          const coordinates = getCoordinates(stop);
          if (!coordinates) return null;
          const match = distanceToRouteKm(coordinates, points);
          return {
            ...stop,
            routeDistanceKm: Math.round(match.distanceKm * 10) / 10,
            routePosition: match.position,
            routeCategory: match.distanceKm <= 1.5 ? "along_route" : "small_detour",
          };
        })
        .filter((stop): stop is any => Boolean(stop) && Number(stop.routeDistanceKm) <= 3)
        .sort((a, b) => Number(a.routePosition) - Number(b.routePosition));
      setRouteMatches(matches);
      setMapFilterMode("route");
      setSelectedRouteIds([]);
      if (!matches.length) toast("No eligible packed orders were found within 3 km of this route.", { icon: "🗺️" });
      else toast.success(`${matches.length} eligible order${matches.length === 1 ? "" : "s"} found along your route`);
    } catch (e: any) {
      setRouteGeometry([]);
      setRouteInfo(null);
      setRouteMatches([]);
      toast.error(e?.message || "Could not calculate the route");
    } finally {
      setRouteLoading(false);
    }
  };

  const deliverSelectedMutation = useMutation({
    mutationFn: async () => {
      const orderIds = selectedRouteIds;
      return api.post("/farmers/me/delivery-map/self-delivery-plan", {
        method: selfDeliveryMethod,
        orderIds,
        radius: radiusKm,
        destination: routeDestination ? { lat: routeDestination.lat, lng: routeDestination.lng, label: routeDestination.label } : null,
      });
    },
    onSuccess: (res: any) => {
      const result = res?.data || {};
      const selfCount = Number(result.selfDeliveryCount ?? selectedRouteIds.length);
      const partnerCount = Number(result.partnerCount ?? 0);
      const nearbyCount = Number(result.nearbyCount ?? 0);
      const longDistanceCount = Number(result.longDistanceCount ?? 0);
      setLastPlanResult({ selfCount, partnerCount, nearbyCount, longDistanceCount, skipped: result.skipped || [] });
      toast.success(`Delivery plan confirmed: ${selfCount} self · ${nearbyCount} nearby partner · ${longDistanceCount} long-distance`);
      setSelectedRouteIds([]);
      refreshAll();
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const deliverSelected = () => {
    const ids = selectedRouteIds;
    if (!ids.length) {
      toast.error(selfDeliveryMethod === "route" ? "Select at least one order along your route" : `Select at least one order within ${radiusKm} km`);
      return;
    }
    deliverSelectedMutation.mutate();
  };

  const autoRouteRemainingMutation = useMutation({
    mutationFn: () =>
      api.post("/farmers/me/delivery-map/self-delivery-plan", {
        method: selfDeliveryMethod,
        orderIds: [],
        radius: radiusKm,
        destination: routeDestination
          ? { lat: routeDestination.lat, lng: routeDestination.lng, label: routeDestination.label }
          : null,
      }),
    onSuccess: (res: any) => {
      const partnerCount = Number(res?.data?.partnerCount ?? 0);
      const nearbyCount = Number(res?.data?.nearbyCount ?? 0);
      const longDistanceCount = Number(res?.data?.longDistanceCount ?? 0);
      toast.success(
        `${partnerCount} remaining order${partnerCount === 1 ? "" : "s"} automatically assigned: ${nearbyCount} nearby · ${longDistanceCount} long distance`
      );
      refreshAll();
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const continueToCalendar = () => {
    const ids = selectedRouteIds.length ? selectedRouteIds : selectedRouteOrders.map((stop) => getStopId(stop));
    if (!ids.length) {
      toast.error("Select at least one self-delivery order before opening the Delivery Calendar.");
      return;
    }
    window.location.href = `/farmer/delivery-calendar?orderIds=${encodeURIComponent(ids.join(","))}`;
  };

  const openPlannedRoute = () => {
    if (!selectedRouteOrders.length) {
      toast.error("Select at least one order for the route");
      return;
    }
    const points = Array.from(
      new globalThis.Map(
        selectedRouteOrders
          .map((stop) => getCoordinates(stop))
          .filter(Boolean)
          .map((point) => {
            const p = point as { lat: number; lng: number };
            return [`${p.lat.toFixed(6)},${p.lng.toFixed(6)}`, p] as const;
          })
      ).values()
    ) as { lat: number; lng: number }[];
    const origin = farmCoordinates || liveLocation || points[0];
    const destination = routeDestination || points[points.length - 1];
    const waypoints = points.map((p) => `${p.lat},${p.lng}`).join("|");
    const params = new URLSearchParams({
      api: "1",
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      travelmode: "driving",
    });
    if (waypoints) params.set("waypoints", waypoints);
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, "_blank");
  };

  const mapCenter =
    selectedStop?.mapCoordinates || liveLocation || farmCoordinates || FALLBACK_CENTER;

  const locationGroups = useMemo(() => {
    const groups = new globalThis.Map<string, any[]>();
    mapOrders.forEach((stop) => {
      const key = getLocationGroupKey(stop);
      if (!key) return;
      const current = groups.get(key) || [];
      current.push(stop);
      groups.set(key, current);
    });
    return Array.from(groups.entries()).map(([key, orders]) => ({ key, orders, meta: getLocationGroupMeta(orders) }));
  }, [mapOrders]);

  const selectedLocationGroup = useMemo(
    () => locationGroups.find((group) => group.key === selectedLocationGroupKey) || null,
    [locationGroups, selectedLocationGroupKey]
  );

  const mapMarkers = useMemo(() => {
    const markers: any[] = [];
    if (routeStart && (!farmCoordinates || routeStart.lat !== farmCoordinates.lat || routeStart.lng !== farmCoordinates.lng)) {
      markers.push({
        id: "route-start",
        lat: routeStart.lat,
        lng: routeStart.lng,
        title: `Route Start: ${routeStart.label}`,
        info: `<strong>Route Start</strong><br/>${routeStart.label}`,
        color: "#2563EB",
        label: "S",
      });
    }
    if (routeDestination) {
      markers.push({
        id: "route-destination",
        lat: routeDestination.lat,
        lng: routeDestination.lng,
        title: `Route End: ${routeDestination.label}`,
        info: `<strong>Route End</strong><br/>${routeDestination.label}`,
        color: "#EF4444",
        label: "E",
      });
    }
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

    locationGroups.forEach((group, groupIndex) => {
      const first = group.orders[0];
      const coordinates = getCoordinates(first);
      if (!coordinates) return;

      if (group.orders.length === 1) {
        const stop = first;
        const state = getDeliveryState(stop);
        const isDelivered = state === "delivered";
        const distText = stop.distance != null ? ` - ${stop.distance} km` : "";
        const partnerText = state === "partner_assigned" && stop.deliveryPartnerName ? ` · ${stop.deliveryPartnerName}` : "";
        const statusText = isDelivered ? "Delivered" : getStatus(stop).replace(/_/g, " ");
        const id = getStopId(stop);
        const productName = getProductDisplayName(stop);
        const customerName = getCustomerDisplayName(stop);
        const markerLabel = productName && customerName && customerName !== "Customer"
          ? `${customerName} · ${productName}`
          : productName
            ? `${productName} · 1 Order`
            : customerName && customerName !== "Customer"
              ? `${customerName} · 1 Order`
              : "1 Order";
        markers.push({
          id,
          lat: coordinates.lat,
          lng: coordinates.lng,
          title: markerLabel,
          info: `<strong>${markerLabel}</strong><br/>${formatAddress(stop)}${distText}<br/>Order #${stop.orderNumber || id}<br/>${productName}<br/>${stop.quantityKg ?? stop.quantity ?? 0} kg · ${formatPrice(stop.total)}<br/>${DELIVERY_STATE_LABEL[state] || state}${partnerText}<br/>${statusText}<br/><em>1 business order · 1 physical stop</em>`,
          address: formatAddress(stop),
          color: "#8B5CF6",
          label: "O",
        });
        return;
      }

      const selectedCount = group.orders.filter((order) => selectedRouteIds.includes(getStopId(order))).length;
      const groupMeta = group.meta || getLocationGroupMeta(group.orders);
      const customerLabel = groupMeta.sameCustomer && groupMeta.sameProduct
        ? `${groupMeta.customerName} · ${group.orders.length} ${groupMeta.productName} Orders`
        : groupMeta.sameProduct
          ? `${group.orders.length} ${groupMeta.productName} Orders`
          : groupMeta.sameCustomer
            ? `${groupMeta.customerName} · ${group.orders.length} Orders`
            : `${group.orders.length} Orders`;
      const customerSummary = groupMeta.sameCustomer
        ? `<strong>${groupMeta.customerName}</strong><br/><span>Same customer/member · same delivery address</span>`
        : `<span>Customers: ${groupMeta.customerNames.join(", ") || "Multiple customers"}</span>`;
      const productSummary = groupMeta.sameProduct
        ? `<span>Same product: ${groupMeta.productName}</span>`
        : `<span>Products: ${groupMeta.productNames.join(", ") || "Multiple products"}</span>`;
      const orderLines = group.orders
        .map((order) => {
          const id = getStopId(order);
          const checked = selectedRouteIds.includes(id);
          return `${checked ? "✓" : "○"} #${order.orderNumber || id} · ${getCustomerDisplayName(order)} · ${order.quantityKg ?? order.quantity ?? 0} kg`;
        })
        .join("<br/>");

      markers.push({
        id: `location-group:${group.key}`,
        lat: coordinates.lat,
        lng: coordinates.lng,
        title: customerLabel,
        displayLabel: customerLabel,
        info: `<strong>${customerLabel}</strong><br/>${customerSummary}<br/>${productSummary}<br/>${formatAddress(first)}<br/><span>${group.orders.length} separate orders · ${groupMeta.totalWeight} kg · ${formatPrice(groupMeta.totalValue)}</span><br/>${orderLines}<br/><em>${selectedCount} selected</em><br/>One physical stop · click the marker to select individual orders.`,
        color: "#8B5CF6",
        label: "O",
      });
    });

    return markers;
  }, [locationGroups, farm, farmCoordinates, routeStart, routeDestination, selectedRouteIds]);

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

  const partnerRouteMutation = useMutation({
    mutationFn: ({ route, orderIds }: { route: "nearby" | "long_distance"; orderIds: string[] }) =>
      api.post("/farmers/me/delivery-map/partner-route", { route, orderIds, radius: radiusKm }),
    onSuccess: (res: any) => {
      toast.success(res?.message || "Delivery partner route selected");
      refreshAll();
    },
    onError: (e: any) => toast.error(getApiError(e)),
  });

  const assignSelectedPartnerMutation = useMutation({
    mutationFn: async () => {
      const orderIds = selectedRouteIds;
      const [nearby, longDistance] = await Promise.all([
        api.post("/farmers/me/delivery-map/partner-route", { route: "nearby", orderIds, radius: radiusKm }),
        api.post("/farmers/me/delivery-map/partner-route", { route: "long_distance", orderIds, radius: radiusKm }),
      ]);
      return { nearby, longDistance };
    },
    onSuccess: (res: any) => {
      const nearbyCount = Number(res?.nearby?.data?.processed ?? 0);
      const longCount = Number(res?.longDistance?.data?.processed ?? 0);
      toast.success((nearbyCount + longCount) + " selected order" + (nearbyCount + longCount === 1 ? "" : "s") + " routed to delivery partners");
      setPartnerDecisionOpen(false);
      setSelectedRouteIds([]);
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
  const mapLoadError = mapQuery.isError ? getApiError(mapQuery.error) : "";
  const pendingCount = packedOrders.length;
  const assignableOutside = outsideUnassigned;

  return (
    <div className="min-h-full space-y-5 bg-slate-50/40 pb-8">
      <DeliveryWorkflowNav current="order-map" />
      {mapLoadError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-red-800">Unable to load delivery orders</p>
              <p className="mt-1 text-sm text-red-700">{mapLoadError}</p>
              <p className="mt-1 text-xs text-red-600">Make sure the AgriConnect backend is running and your farmer session is valid.</p>
            </div>
            <Button variant="outline" onClick={() => mapQuery.refetch()} disabled={mapQuery.isFetching}>
              {mapQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  <Navigation className="mr-1.5 h-3.5 w-3.5" /> Delivery Planning
                </Badge>
                <Badge variant={realtimeConnected ? "success" : "outline"} className="gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${realtimeConnected ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {realtimeConnected ? "Auto refresh · 30s" : "Waiting for data"}
                </Badge>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Farmer Order Map</h1>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                All eligible packed Farmer Fulfillment orders appear initially. Radius and Route only filter visible orders. The farmer must explicitly select orders and then choose Self Delivery or Delivery Partner.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={requestLiveLocation} disabled={locationLoading}>
                {locationLoading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crosshair className="mr-1.5 h-4 w-4" />}
                {liveLocation ? "My Location" : "Locate Me"}
              </Button>
              <Button size="sm" variant="outline" onClick={refreshAll} disabled={mapQuery.isFetching}>
                {mapQuery.isFetching ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">1. Select delivery planning mode</p>
              <p className="mt-0.5 text-xs text-slate-500">All eligible packed orders are shown initially. Radius filters by farm distance; Route uses the selected start and end points to show orders along that road route.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
                <span className="px-2 text-xs font-medium text-slate-500">Mode</span>
                <Button size="sm" variant={selfDeliveryMethod === "radius" ? "default" : "ghost"} onClick={() => selectSelfDeliveryMethod("radius")}>
                  <Crosshair className="mr-1.5 h-3.5 w-3.5" /> Radius
                </Button>
                <Button size="sm" variant={selfDeliveryMethod === "route" ? "default" : "ghost"} onClick={() => selectSelfDeliveryMethod("route")}>
                  <Navigation className="mr-1.5 h-3.5 w-3.5" /> Route
                </Button>
              </div>
              {selfDeliveryMethod === "radius" && (
                <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
                  <span className="px-2 text-xs font-medium text-slate-500">Radius</span>
                  {RADIUS_OPTIONS.map((distance) => (
                    <Button key={distance} size="sm" variant={mapFilterMode === "radius" && radiusKm === distance ? "default" : "ghost"} onClick={() => applyRadiusFilter(distance)}>
                      {distance} km
                    </Button>
                  ))}
                </div>
              )}
              <Select value={deliveredWindow} onValueChange={setDeliveredWindow}>
                <SelectTrigger className="h-9 w-[120px] bg-white text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERED_WINDOWS.map((w) => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {selfDeliveryMethod === "radius" && (
                <>
                  <Button size="sm" variant={mapFilterMode === "all" ? "default" : "outline"} onClick={showAllMapOrders}>
                    <ListChecks className="mr-1.5 h-3.5 w-3.5" /> All Orders
                  </Button>
                  <Button size="sm" variant="outline" onClick={selectVisibleOrdersForSelfDelivery} disabled={!withinUnassigned.length}>
                    <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Select All Visible
                  </Button>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={deliverSelected} disabled={deliverSelectedMutation.isPending || !selectedRouteIds.length}>
                    {deliverSelectedMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserCheck className="mr-1.5 h-3.5 w-3.5" />}
                    Confirm Delivery Plan
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-blue-900">
              <span className="font-semibold">{selectedRouteIds.length} selected</span> for delivery.
              <span className="ml-1 text-blue-700">Radius and Route only filter the candidates. Nothing is assigned until you choose a delivery action.</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={selectVisibleOrdersForSelfDelivery} disabled={!mapOrders.length}>
                <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Select Visible
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedRouteIds([])} disabled={!selectedRouteIds.length}>Clear</Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {(() => {
        const deferredOrders = packedOrders.filter(
          (stop) =>
            stop?.readyForFarmerRoute === true &&
            !stop?.deliveryPartnerId &&
            !stop?.selfDelivery &&
            !stop?.deliveryResponsibility
        );
        if (!deferredOrders.length) return null;
        return (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-900">
                <Truck className="h-5 w-5" />
                Automatic Delivery Routing
              </CardTitle>
              <CardDescription className="text-emerald-800">
                {deferredOrders.length} farmer-fulfilled order{deferredOrders.length === 1 ? "" : "s"} packed and ready for delivery decision.
                Select the orders you will deliver yourself; every remaining order is automatically assigned to a delivery partner and classified by distance:
                ≤ {radiusKm} km → Nearby, &gt; {radiusKm} km → Long Distance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {deferredOrders.map((stop) => (
                <div key={getStopId(stop)} className="flex flex-col gap-3 rounded-lg border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">#{stop.orderNumber || "Order"}</p>
                    <p className="text-xs text-muted-foreground">{formatAddress(stop)}</p>
                    <Badge variant="outline" className="mt-1">Packed · Delivery decision not selected</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => document.getElementById("delivery-route-selection")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      <Navigation className="mr-1.5 h-4 w-4" />
                      Select Self Delivery
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedStopId(getStopId(stop))}
                    >
                      View Order
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}

      <Card className="border-emerald-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-emerald-600" />
            Complete Farmer Fulfillment Delivery Workflow
          </CardTitle>
          <CardDescription>
            Everything after Packing &amp; Checking is completed from this page. Orders stay separate even when several orders share one physical delivery stop.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-5">
            {[
              ["1", "Packed", "Packing & Checking complete"],
              ["2", "Filter", "All / Radius / Route"],
              ["3", "Select", "Select individual orders"],
              ["4", "Confirm", "Self delivery selection"],
              ["5", "Auto Route", "Remaining → Partner by distance"],
            ].map(([step, title, detail], index) => (
              <div key={step} className="relative rounded-xl border bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">{step}</span>
                  <p className="text-sm font-semibold text-slate-900">{title}</p>
                </div>
                <p className="mt-2 text-xs text-slate-600">{detail}</p>
                {index < 4 && <span className="absolute -right-2 top-1/2 hidden text-slate-300 md:block">→</span>}
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
              <strong className="text-emerald-900">Farmer Self Delivery</strong>
              <p className="mt-1 text-emerald-800">Selected orders → Dispatch → Farmer → Customer</p>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
              <strong className="text-blue-900">Nearby Partner</strong>
              <p className="mt-1 text-blue-800">Remaining orders → Dispatch → Local Hub → Delivery Partner → Customer</p>
            </div>
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs">
              <strong className="text-violet-900">Long Distance</strong>
              <p className="mt-1 text-violet-800">Remaining orders → Dispatch → Warehouse → Local Hub → Delivery Partner → Customer</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {lastPlanResult && (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-emerald-900">Delivery Plan Confirmed</CardTitle>
            <CardDescription className="text-emerald-800">
              The selected orders were assigned to Farmer Self Delivery. Every remaining packed order was processed by the distance decision.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryStat label="Self Delivery" value={String(lastPlanResult.selfCount)} tone="emerald" />
              <SummaryStat label="Partner Route" value={String(lastPlanResult.partnerCount)} tone="blue" />
              <SummaryStat label="Nearby" value={String(lastPlanResult.nearbyCount)} tone="blue" />
              <SummaryStat label="Long Distance" value={String(lastPlanResult.longDistanceCount)} tone="violet" />
            </div>
            {lastPlanResult.skipped?.length > 0 && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {lastPlanResult.skipped.length} order{lastPlanResult.skipped.length === 1 ? "" : "s"} could not be routed automatically. Review the order location or logistics resources and retry.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Delivery Overview</CardTitle>
              <CardDescription>
                {liveLocation ? "Distances are measured from your current location." : "Distances are measured from your farm."} · Showing {DELIVERED_WINDOWS.find((w) => w.value === deliveredWindow)?.label.toLowerCase()} completed orders.
              </CardDescription>
            </div>
            <Badge variant="outline" className="w-fit">{pendingCount} orders on map</Badge>
          </div>
          {summary.deliveryProblem > 0 && (
            <Badge variant="destructive" className="gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> {summary.deliveryProblem} delivery problem{summary.deliveryProblem > 1 ? "s" : ""}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
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

      <Card id="delivery-route-selection" className="scroll-mt-20 border-emerald-200 bg-gradient-to-r from-emerald-50/60 to-violet-50/60">
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600" />
              3. Delivery Decision
            </CardTitle>
            <CardDescription>
              This page is the complete Farmer Fulfillment delivery-decision workspace: select your orders for self delivery, then confirm once. Every remaining packed order is automatically routed by distance.
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

      <Card className="border-emerald-200 bg-emerald-50/30">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-emerald-900">Automatic distance-based delivery decision</p>
            <p className="text-xs text-emerald-800">
              After self-delivery orders are selected, every remaining packed order is routed automatically.
              The system calculates farm-to-customer distance. Self delivery follows Dispatch → Farmer → Customer. Partner delivery follows:
              ≤ {radiusKm} km → Dispatch → Nearby → Local Hub → Delivery Partner → Customer;
              &gt; {radiusKm} km → Dispatch → Long Distance → Warehouse → Local Hub → Delivery Partner → Customer.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => autoRouteRemainingMutation.mutate()}
              disabled={autoRouteRemainingMutation.isPending}
            >
              {autoRouteRemainingMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              Retry Automatic Routing
            </Button>
            <Button size="sm" variant="outline" title="Edit delivery capacity" onClick={openCapacityEditor}>
              <Settings2 className="mr-2 h-4 w-4" /> Delivery Capacity
            </Button>
          </div>
        </CardContent>
      </Card>

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


      {selfDeliveryMethod === "route" && (
<Card className="border-blue-200 bg-blue-50/30">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-blue-600" />
              I'm Going This Way
            </CardTitle>
            <CardDescription>
              Enter where you are going. AgriConnect calculates the road route from your farm/current location and finds eligible packed customer orders near that route.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {routeMatches.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setSelectedRouteIds(routeMatches.map((stop) => getStopId(stop)))}>
                Select All Route Orders
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelectedRouteIds([])} disabled={!selectedRouteIds.length}>
              Clear
            </Button>
            <Button size="sm" variant="outline" onClick={continueToCalendar} disabled={!selectedRouteOrders.length}>
              <CalendarDays className="mr-1.5 h-4 w-4" />
              Delivery Calendar
            </Button>
            <Button size="sm" onClick={openPlannedRoute} disabled={!selectedRouteOrders.length}>
              <Navigation className="mr-1.5 h-4 w-4" />
              Preview Route
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={deliverSelected} disabled={deliverSelectedMutation.isPending || !selectedRouteOrders.length}>
              {deliverSelectedMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserCheck className="mr-1.5 h-4 w-4" />}
              Confirm Delivery Plan
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <label className="text-xs font-semibold text-slate-700">Start location</label>
              <p className="mt-0.5 text-[11px] text-slate-500">Choose where your route begins.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Input
                  className="min-w-[220px] flex-1 bg-white"
                  value={routeStartText}
                  onChange={(e) => setRouteStartText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      searchRouteStart();
                    }
                  }}
                  placeholder="Search farm, village, town or address"
                />
                <Button variant="outline" onClick={searchRouteStart} disabled={routeStartSearching || !routeStartText.trim()}>
                  {routeStartSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  <span className="ml-1.5">Search</span>
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant={routeStart?.label === "My current location" ? "default" : "outline"} onClick={useLiveLocationAsRouteStart}>
                  <Crosshair className="mr-1.5 h-3.5 w-3.5" /> Use My Location
                </Button>
                <Button size="sm" variant={routeStart?.label !== "My current location" && Boolean(farmCoordinates && routeStart?.lat === farmCoordinates.lat && routeStart?.lng === farmCoordinates.lng) ? "default" : "outline"} onClick={useFarmAsRouteStart} disabled={!farmCoordinates}>
                  <Navigation className="mr-1.5 h-3.5 w-3.5" /> Use My Farm
                </Button>
              </div>
              {routeStartSearchResults.length > 0 && (
                <div className="mt-2 divide-y rounded-lg border bg-white">
                  {routeStartSearchResults.map((result, index) => (
                    <button
                      key={`start-${result.place_id || index}`}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => chooseRouteStart(Number(result.lat), Number(result.lon), String(result.display_name || routeStartText))}
                    >
                      {result.display_name}
                    </button>
                  ))}
                </div>
              )}
              {routeStart && <div className="mt-2"><Badge variant="outline">Start: {routeStart.label}</Badge></div>}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <label className="text-xs font-semibold text-slate-700">Destination</label>
              <p className="mt-0.5 text-[11px] text-slate-500">Where you want the route to finish.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Input
                  className="min-w-[220px] flex-1 bg-white"
                  value={routeDestinationText}
                  onChange={(e) => setRouteDestinationText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      searchRouteDestination();
                    }
                  }}
                  placeholder="Search destination, market, town or address"
                />
                <Button onClick={searchRouteDestination} disabled={routeSearching || !routeDestinationText.trim()}>
                  {routeSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                  <span className="ml-1.5">Search</span>
                </Button>
                <Button variant={routePickMode ? "default" : "outline"} onClick={() => setRoutePickMode((v) => !v)}>
                  <Crosshair className="mr-1.5 h-4 w-4" /> Select on Map
                </Button>
              </div>
              {routePickMode && <p className="mt-1 text-xs text-blue-700">Click the map below to choose the destination.</p>}
              {routeSearchResults.length > 0 && (
                <div className="mt-2 divide-y rounded-lg border bg-white">
                  {routeSearchResults.map((result, index) => (
                    <button
                      key={`destination-${result.place_id || index}`}
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => chooseRouteDestination(Number(result.lat), Number(result.lon), String(result.display_name || routeDestinationText))}
                    >
                      {result.display_name}
                    </button>
                  ))}
                </div>
              )}
              {routeDestination && <div className="mt-2"><Badge variant="success">Destination: {routeDestination.label}</Badge></div>}
            </div>
          </div>
          {routeDestination && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">Start: {routeStart?.label || (farmCoordinates ? "My Farm" : liveLocation ? "My Location" : "Not selected")}</Badge>
              <Badge variant="success">Destination: {routeDestination.label}</Badge>
              {routeInfo && <Badge variant="secondary">{routeInfo.distanceKm} km · {routeInfo.durationMinutes} min</Badge>}
            </div>
          )}
          <div className="flex justify-end">
            <Button
              size="lg"
              className="w-full sm:w-auto"
              onClick={findOrdersAlongRoute}
              disabled={!routeDestination || routeLoading || !(routeStart || farmCoordinates || liveLocation)}
            >
              {routeLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Navigation className="mr-2 h-4 w-4" />}
              Find Orders Along My Route
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat label="Selected Orders" value={String(routePlanStats.count)} tone="blue" />
            <SummaryStat label="Physical Stops" value={String(routePlanStats.physicalStops)} tone="violet" />
            <SummaryStat label="Product Weight" value={`${routePlanStats.weight} KG`} tone="amber" />
            <SummaryStat label="Distance" value={`${routePlanStats.distance} KM`} tone="violet" />
            <SummaryStat label="Est. Travel + Stops" value={`${routePlanStats.minutes} min`} tone="blue" />
          </div>
          {routeMatches.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-white p-4 text-center text-sm text-muted-foreground">
              {routeDestination ? "Calculate the route to see eligible packed orders within 3 km of it." : "Choose a destination to find customer orders along your route."}
            </p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {routeMatches.map((stop, index) => {
                const id = getStopId(stop);
                const checked = selectedRouteIds.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setSelectedStopId(id);
                      toggleRouteOrder(id);
                    }}
                    className={`rounded-lg border p-3 text-left transition ${checked ? "border-blue-500 bg-blue-50" : "bg-white hover:bg-slate-50"}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300"}`}>
                        {checked ? "✓" : index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{stop.buyerName || stop.orderNumber || "Delivery order"}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{formatAddress(stop)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {stop.routeDistanceKm} km from route · {stop.quantityKg ?? stop.quantity ?? 0} kg
                        </p>
                        <Badge variant={stop.routeCategory === "along_route" ? "success" : "warning"} className="mt-2">
                          {stop.routeCategory === "along_route" ? "Along Route" : "Small Detour"}
                        </Badge>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.8fr)]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b bg-white py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Delivery Order Locations</CardTitle>
              <CardDescription>
                Green = self delivery · Blue = delivery partner · Yellow = pending assignment · Red = delivery problem · Black = delivered · Purple = farm
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#10B981" }} /> Self
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#3B82F6" }} /> Partner
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#F59E0B" }} /> Pending
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#EF4444" }} /> Problem
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#111827" }} /> Completed
              <span className="ml-2 inline-block h-3 w-3 rounded-full" style={{ background: "#8B5CF6" }} /> Farm
            </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="h-[560px] animate-pulse rounded-b-lg bg-muted" />
            ) : (
              <div className="relative">
                <Map
                  center={mapCenter}
                  zoom={12}
                  markers={mapMarkers}
                  route={routeGeometry}
                  trackUserLocation
                  userLocation={liveLocation}
                  height="560px"
                  circle={farmCoordinates ? { center: farmCoordinates, radiusKm } : undefined}
                  onMarkerClick={(marker) => {
                    if (marker.id === "farm" || marker.id === "route-start" || marker.id === "route-destination") return;
                    const markerId = String(marker.id);
                    if (markerId.startsWith("location-group:")) {
                      const groupKey = markerId.slice("location-group:".length);
                      const group = locationGroups.find((item) => item.key === groupKey);
                      setSelectedLocationGroupKey(groupKey);
                      if (group?.orders?.length) setSelectedStopId(getStopId(group.orders[0]));
                      return;
                    }
                    setSelectedLocationGroupKey(null);
                    setSelectedStopId(markerId);
                  }}
                  onMapClick={(coords) => {
                    if (routePickMode) chooseRouteDestination(coords.lat, coords.lng, coords.lat.toFixed(5) + ", " + coords.lng.toFixed(5));
                  }}
                />
                {packedOrders.length === 0 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
                    <div className="rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-center shadow-lg backdrop-blur">
                      <p className="text-sm font-semibold text-slate-800">No orders to route yet</p>
                      <p className="mt-1 text-xs text-slate-500">The map is ready. Packed Farmer Fulfillment orders will appear here automatically.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selectedLocationGroup && (
            <Card className="border-blue-200 bg-blue-50/40 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {selectedLocationGroup.meta?.sameCustomer
                        ? `${selectedLocationGroup.meta.customerName} · ${selectedLocationGroup.orders.length} Orders`
                        : `${selectedLocationGroup.orders.length} Orders at This Location`}
                    </CardTitle>
                    <CardDescription>
                      {selectedLocationGroup.meta?.sameCustomer
                        ? "Same customer/member and same delivery address. These remain separate orders and can be selected independently."
                        : "Same delivery location, separate orders. Select each order individually."}
                    </CardDescription>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedLocationGroupKey(null)}>
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-blue-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        {selectedLocationGroup.meta?.sameCustomer
                          ? `📍 ${selectedLocationGroup.meta.customerName}`
                          : "📍 Same Delivery Location"}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {selectedLocationGroup.meta?.sameCustomer
                          ? "Same customer · Same address"
                          : `${selectedLocationGroup.meta?.customerNames?.length || selectedLocationGroup.orders.length} customers · ${selectedLocationGroup.orders.length} orders`}
                      </p>
                    </div>
                    <Badge variant="secondary">1 physical stop</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">
                      {selectedLocationGroup.orders.length} {selectedLocationGroup.meta?.sameProduct ? `${selectedLocationGroup.meta.productName} Orders` : "Orders"}
                    </Badge>
                    <Badge variant="outline">{selectedLocationGroup.meta?.totalWeight ?? 0} kg</Badge>
                    <Badge variant="outline">{formatPrice(selectedLocationGroup.meta?.totalValue ?? 0)}</Badge>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    The marker and route represent the physical location. Each order below remains a separate business record.
                  </p>
                </div>

                <div className="space-y-2">
                  {selectedLocationGroup.orders.map((order) => {
                    const orderId = getStopId(order);
                    const checked = selectedRouteIds.includes(orderId);
                    return (
                      <button
                        key={orderId}
                        type="button"
                        onClick={() => {
                          setSelectedStopId(orderId);
                          toggleSelectedOrder(orderId);
                        }}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          checked ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${
                            checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-400"
                          }`}>
                            {checked ? "✓" : ""}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-slate-900">#{order.orderNumber || orderId}</p>
                              {getStatusBadge(order)}
                            </div>
                            <p className="mt-1 text-xs font-medium text-slate-700">{getCustomerDisplayName(order)}</p>
                            <p className="mt-1 text-xs text-slate-600">{order.product || "Items"} · {order.quantityKg ?? order.quantity ?? 0} kg · {formatPrice(order.total)}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">
                      Selected: {selectedLocationGroup.orders.filter((order) => selectedRouteIds.includes(getStopId(order))).length} / {selectedLocationGroup.orders.length}
                    </span>
                    <span className="text-slate-500">1 route stop</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">Selecting an order does not create another route stop. Orders at this location are delivered during the same physical visit.</p>
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button size="sm" variant="outline" onClick={() => {
                    const ids = selectedLocationGroup.orders.map((order) => getStopId(order)).filter(Boolean);
                    setSelectedRouteIds(ids);
                  }}>Select All Orders</Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    const ids = selectedLocationGroup.orders.map((order) => getStopId(order)).filter(Boolean);
                    setSelectedRouteIds((current) => current.filter((id) => !ids.includes(id)));
                  }}>Clear This Location</Button>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={!selectedLocationGroup.orders.some((order) => selectedRouteIds.includes(getStopId(order)))} onClick={() => {
                    const selectedCount = selectedLocationGroup.orders.filter((order) => selectedRouteIds.includes(getStopId(order))).length;
                    toast.success(`Selection confirmed: ${selectedCount} order${selectedCount === 1 ? "" : "s"} at this physical stop`);
                  }}><CheckCircle className="mr-1.5 h-3.5 w-3.5" />Confirm Selection</Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card className="border-emerald-200 bg-emerald-50/30 shadow-sm">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-emerald-950">{selectedRouteIds.length} order{selectedRouteIds.length === 1 ? "" : "s"} selected</p>
              <p className="mt-1 text-xs text-emerald-800">Filter selection does not assign orders. Choose a delivery action only when the selection is final.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={deliverSelected} disabled={!selectedRouteIds.length || deliverSelectedMutation.isPending}>
                  {deliverSelectedMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="mr-1.5 h-3.5 w-3.5" />}
                  Confirm Delivery Plan
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedRouteIds([])} disabled={!selectedRouteIds.length}>Clear Selection</Button>
              </div>
            </CardContent>
          </Card>
          <Card className="xl:sticky xl:top-4 border-slate-200 shadow-sm">
            <CardHeader className="border-b bg-white py-4">
              <CardTitle className="text-base">Order Details</CardTitle>
              <CardDescription>Review the selected customer order and choose its delivery method.</CardDescription>
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
                    <>
                      <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-blue-900">Delivery selection</p>
                            <p className="text-[11px] text-blue-700">Select this packed order only if you will deliver it yourself.</p>
                          </div>
                          <Button
                            size="sm"
                            variant={selectedRouteIds.includes(getStopId(selectedStop)) ? "default" : "outline"}
                            onClick={() => toggleSelectedOrder(getStopId(selectedStop))}
                          >
                            {selectedRouteIds.includes(getStopId(selectedStop)) ? "Selected for Self Delivery" : "Select for Self Delivery"}
                          </Button>
                        </div>
                      </div>
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
                    </>
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

      <Card className="border-indigo-200 bg-indigo-50/40 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div><p className="text-xs font-bold uppercase tracking-wide text-indigo-700">1. FILTER</p><p className="mt-1 text-sm font-semibold text-slate-900">Radius / Route only filters orders</p><p className="mt-1 text-xs text-slate-600">10 KM shows eligible packed orders inside 10 KM. Nothing is assigned.</p></div>
            <div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">2. SELECT ORDERS</p><p className="mt-1 text-sm font-semibold text-slate-900">Farmer explicitly selects orders</p><p className="mt-1 text-xs text-slate-600">Select individual orders or Select All Visible. Selected map markers turn green.</p></div>
            <div><p className="text-xs font-bold uppercase tracking-wide text-blue-700">3. DELIVERY DECISION</p><p className="mt-1 text-sm font-semibold text-slate-900">Self Delivery or Delivery Partner</p><p className="mt-1 text-xs text-slate-600">Only selected orders enter the chosen delivery workflow.</p></div>
          </div>
        </CardContent>
      </Card>

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
                    Orders in this group are candidates for your self-delivery selection. After you finalize the selection, all remaining packed orders are routed automatically.
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
                          selected={selectedRouteIds.includes(getStopId(stop))}
                          onSelect={() => setSelectedStopId(getStopId(stop))}
                          onSwitch={(v) => onSwitchSelect(stop, v)}
                          deliverySelected={selectedRouteIds.includes(getStopId(stop))}
                          onToggleDelivery={() => toggleSelectedOrder(getStopId(stop))}
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
                          selected={selectedRouteIds.includes(getStopId(stop))}
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
            <CardDescription>Orders outside the selected radius are automatically routed through the long-distance logistics flow after you finalize self-delivery selection.</CardDescription>
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
                    These orders are not selected for self delivery. The system automatically calculates distance and sends them through Nearby or Long Distance partner routing.
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
                          selected={selectedRouteIds.includes(getStopId(stop))}
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
                          selected={selectedRouteIds.includes(getStopId(stop))}
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
                selected={selectedRouteIds.includes(getStopId(stop))}
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

      <Dialog open={partnerDecisionOpen} onOpenChange={(v) => !v && setPartnerDecisionOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign selected orders to Delivery Partner?</DialogTitle>
            <DialogDescription>
              {selectedRouteIds.length} selected order{selectedRouteIds.length === 1 ? "" : "s"} will be routed by distance. Nearby orders use the Local Hub flow; long-distance orders use Warehouse → Local Hub before Delivery Partner.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span>Selected orders</span><strong>{selectedRouteIds.length}</strong></div>
            <p className="mt-2 text-xs text-slate-600">Orders merely visible because of the radius filter remain unassigned.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPartnerDecisionOpen(false)}>Cancel</Button>
            <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => assignSelectedPartnerMutation.mutate()} disabled={assignSelectedPartnerMutation.isPending || !selectedRouteIds.length}>
              {assignSelectedPartnerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              Confirm Delivery Partner
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={assignDialogOpen} onOpenChange={(v) => !v && setAssignDialogOpen(false)} wide>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign long-distance orders to delivery partners</DialogTitle>
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
  deliverySelected = false,
  onToggleDelivery,
  readOnly = false,
}: {
  stop: any;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onSwitch: (value: string) => void;
  deliverySelected?: boolean;
  onToggleDelivery?: () => void;
  readOnly?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3.5 shadow-sm transition ${
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
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border bg-slate-50 p-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggleDelivery?.(); }} className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <span className={`flex h-5 w-5 items-center justify-center rounded border ${deliverySelected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white"}`}>{deliverySelected ? "✓" : ""}</span>
            Select this order
          </button>
          {deliverySelected && <Badge className="bg-emerald-600 text-white">Selected</Badge>}
        </div>
      )}
    </div>
  );
}
