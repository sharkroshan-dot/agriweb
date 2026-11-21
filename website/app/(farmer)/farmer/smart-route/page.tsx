"use client";
import { DeliveryWorkflowNav } from "../../../components/farmer/delivery-workflow-nav";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  MapPin,
  Navigation,
  Clock,
  Truck,
  DollarSign,
  Route,
  RotateCw,
  Home,
  Flag,
  Package,
  Users,
  TrendingDown,
  TrendingUp,
  Sparkles,
  Wallet,
  ArrowRight,
  Play,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { cn, formatPrice } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { Map } from "../../../components/shared/map";
import toast from "react-hot-toast";

interface Stop {
  orderId: string;
  orderNumber: string;
  customerName: string;
  address: string;
  landmark?: string;
  city: string;
  lat: number | null;
  lng: number | null;
  deliveryType: string;
  timeSlot: string;
  status: string;
  items: { name: string; quantity: number }[];
  total: number;
  distance: number | null;
  legDurationMinutes?: number | null;
  deliveryWindow: string;
  priority?: number;
  priorityLabel?: string;
  priorityReason?: string;
}

interface Summary {
  totalStops: number;
  totalOrders: number;
  totalDistance: number;
  naiveDistance: number;
  estimatedTime: number;
  fuelCost: number;
  expectedIncome: number;
  netIncome: number;
  customersCount: number;
  savings: { distance: number; time: number; fuel: number };
  algorithm: string;
  distanceMethod?: "road_network" | "straight_line_estimate";
  unlocatedStops?: number;
  profitability?: {
    revenue: number;
    fuelCost: number;
    selfNet: number;
    partnerFeeEstimate: number;
    partnerNet: number;
    advantage: number;
    recommendation: string;
  };
}

interface Origin {
  name: string;
  lat: number | null;
  lng: number | null;
  address: string;
}

function SequenceBar({ stops }: { stops: Stop[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-gray-50 p-3">
      <div className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5">
        <Home className="h-4 w-4 text-emerald-600" />
        <span className="text-xs font-medium text-emerald-700">Farm</span>
      </div>
      {stops.map((stop, index) => (
        <div key={stop.orderId} className="flex items-center gap-2">
          <ArrowRight className="h-4 w-4 text-gray-300" />
          <div className="flex flex-col items-center rounded-full bg-white border px-3 py-1.5">
            <span className="text-xs font-bold text-emerald-600">{index + 1}</span>
            <span className="max-w-[90px] truncate text-[10px] text-gray-600">
              {stop.customerName}
            </span>
          </div>
        </div>
      ))}
      <ArrowRight className="h-4 w-4 text-gray-300" />
      <div className="flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1.5">
        <Flag className="h-4 w-4 text-blue-600" />
        <span className="text-xs font-medium text-blue-700">Return</span>
      </div>
    </div>
  );
}

export default function SmartRoutePage() {
  const searchParams = useSearchParams();
  const orderIds = searchParams.get("orderIds") || "";
  const routeQuery = orderIds ? `?orderIds=${encodeURIComponent(orderIds)}` : "";
  const { data: routeData, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["smartRoute", orderIds],
    queryFn: () => api.get(`/farmers/me/smart-route${routeQuery}`),
    retry: 1,
  });

  const { data: aiInsightsData } = useQuery({
    queryKey: ["farmerAiInsightsRoute"],
    queryFn: () => api.get("/ai/farmer/insights"),
    retry: 1,
  });

  const stops = ((routeData as any)?.stops ?? []) as Stop[];
  const summary = (routeData as any)?.summary as Summary | undefined;
  const origin = (routeData as any)?.origin as Origin | undefined;
  const aiInsights = (aiInsightsData as any)?.data ?? {};
  const riskyByOrder: Record<string, any> = {};
  ((aiInsights.delivery ?? {}).riskyOrders ?? []).forEach((r: any) => {
    riskyByOrder[String(r.orderId)] = r;
  });
  const highRiskCount = ((aiInsights.delivery ?? {}).highRisk ?? 0);
  const communityGroup = aiInsights.community ?? {};

  const locatedStops = stops.filter((s) => s.lat != null && s.lng != null);
  const unlocatedCount = stops.length - locatedStops.length;
  const hasOriginCoords = origin?.lat != null && origin?.lng != null;
  const mapCenter = hasOriginCoords
    ? { lat: origin!.lat as number, lng: origin!.lng as number }
    : locatedStops.length > 0
      ? { lat: locatedStops[0].lat as number, lng: locatedStops[0].lng as number }
      : undefined;
  const routePath = [
    ...(hasOriginCoords ? [{ lat: origin!.lat as number, lng: origin!.lng as number }] : []),
    ...locatedStops.map((stop) => ({ lat: stop.lat as number, lng: stop.lng as number })),
    ...(hasOriginCoords && locatedStops.length ? [{ lat: origin!.lat as number, lng: origin!.lng as number }] : []),
  ];
  // Combine stops at the same physical location into one map pin.
  // A 50 m radius handles small geocoding/GPS differences without merging
  // genuinely different nearby delivery addresses.
  const groupedLocatedStops: { lat: number; lng: number; stops: { stop: Stop; sequence: number }[] }[] = [];
  const distanceBetweenMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  locatedStops.forEach((stop) => {
    const sequence = stops.findIndex((item) => item.orderId === stop.orderId) + 1;
    const existingGroup = groupedLocatedStops.find(
      (group) => distanceBetweenMeters(group, { lat: stop.lat as number, lng: stop.lng as number }) <= 50
    );
    if (existingGroup) {
      existingGroup.stops.push({ stop, sequence });
    } else {
      groupedLocatedStops.push({
        lat: stop.lat as number,
        lng: stop.lng as number,
        stops: [{ stop, sequence }],
      });
    }
  });

  const mapMarkers = [
    ...(hasOriginCoords
      ? [{
          id: "origin",
          lat: origin!.lat as number,
          lng: origin!.lng as number,
          title: origin?.name ?? "Farm",
          color: "#059669",
          label: "F",
          info: origin?.address || "Route start & end point",
        }]
      : []),
    ...groupedLocatedStops.map((group) => {
      const orderNumbers = group.stops.map(({ sequence }) => sequence);
      const firstStop = group.stops[0].stop;
      const orderLabel = orderNumbers.join(", ");
      const details = group.stops.map(({ stop, sequence }) =>
        `#${sequence} ${stop.customerName} — ${stop.address}${stop.city ? `, ${stop.city}` : ""} — ${formatPrice(stop.total)}`
      );
      const landmark = firstStop.landmark || firstStop.address || firstStop.city || "Delivery location";
      return {
        id: group.stops.map(({ stop }) => stop.orderId).join(","),
        lat: group.lat,
        lng: group.lng,
        title: group.stops.length > 1
          ? `${group.stops.length} customer orders · ${landmark}`
          : `${orderNumbers[0]}. ${firstStop.customerName}`,
        color: "#10B981",
        label: orderLabel,
        displayLabel: `${landmark} · Orders: ${orderLabel}`,
        info: details.join("\\n"),
      };
    }),
  ];

  const handleOptimize = () => {
    toast.promise(refetch(), {
      loading: "Recomputing optimal route with AI 2-opt…",
      success: "Route re-optimized!",
      error: "Failed to optimize route",
    });
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
      <DeliveryWorkflowNav current="smart-route" hideCalendar />
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-lg bg-gray-200" />
        <div className="h-80 animate-pulse rounded-lg bg-gray-200" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-4">
        <DeliveryWorkflowNav current="smart-route" hideCalendar />
        <Card className="border-red-200">
          <CardHeader><CardTitle className="text-red-700">Could not calculate your Smart Route</CardTitle><CardDescription>{(error as Error)?.message || "The route service or order data could not be loaded."}</CardDescription></CardHeader>
          <CardContent><Button onClick={() => refetch()} disabled={isFetching}><RotateCw className="mr-2 h-4 w-4" /> Try again</Button></CardContent>
        </Card>
      </div>
    );
  }

  if (!stops.length) {
    return (
      <div className="space-y-4">
        <DeliveryWorkflowNav current="smart-route" hideCalendar />
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Sparkles className="h-3.5 w-3.5" /> DELIVERY OPTIMIZATION</div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Smart Route Planner</h1>
            <p className="mt-1 text-sm text-slate-500">{dateStr} · Plan and review your farmer self-delivery route.</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <Sparkles className="h-12 w-12 text-gray-300" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900">No route to optimize</h3>
          <p className="mt-2 text-sm text-gray-500">
            Confirm farmer self-delivery for packed orders in Order Map. Eligible orders appear here automatically. Partner-assigned, pickup and completed orders are not included.
          </p>
          <div className="mt-4 flex flex-wrap gap-3"><Button asChild variant="outline"><Link href="/farmer/order-map">Back to Order Map</Link></Button><Button asChild><Link href="/farmer/route">Open Delivery Route</Link></Button></div>
        </div>
      </div>
    );
  }

  const savings = summary?.savings;
  const savedSomething = (savings?.distance ?? 0) > 0;

  return (
    <div className="space-y-6">
      <DeliveryWorkflowNav current="smart-route" hideCalendar />
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Smart delivery planning</Badge>
              <Badge variant="outline" className="text-slate-500">{dateStr}</Badge>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Smart Route Planner</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Review the optimized stop sequence, travel estimate and delivery earnings before starting your route.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={handleOptimize} disabled={isLoading}><RotateCw className="mr-2 h-4 w-4" /> Re-optimize</Button>
            <Button asChild disabled={stops.length === 0} className="bg-emerald-600 hover:bg-emerald-700"><Link href={`/farmer/route?orderIds=${encodeURIComponent(stops.map((stop) => stop.orderId).join(","))}`}><Play className="mr-2 h-4 w-4" /> Start delivery</Link></Button>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-blue-50 p-3"><Route className="h-5 w-5 text-blue-600" /></div><div><p className="text-xl font-bold text-slate-900">{summary?.totalDistance ?? 0} km</p><p className="text-xs text-slate-500">Total round-trip distance</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-amber-50 p-3"><Clock className="h-5 w-5 text-amber-600" /></div><div><p className="text-xl font-bold text-slate-900">{Math.round(summary?.estimatedTime ?? 0)} min</p><p className="text-xs text-slate-500">Driving + stop time</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-orange-50 p-3"><Wallet className="h-5 w-5 text-orange-600" /></div><div><p className="text-xl font-bold text-slate-900">{formatPrice(summary?.fuelCost)}</p><p className="text-xs text-slate-500">Estimated fuel cost</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-emerald-50 p-3"><DollarSign className="h-5 w-5 text-emerald-600" /></div><div><p className="text-xl font-bold text-slate-900">{formatPrice(summary?.expectedIncome)}</p><p className="text-xs text-slate-500">Expected income</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-green-50 p-3"><TrendingUp className="h-5 w-5 text-green-600" /></div><div><p className="text-xl font-bold text-slate-900">{formatPrice(summary?.netIncome)}</p><p className="text-xs text-slate-500">Net profit</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-indigo-50 p-3"><Users className="h-5 w-5 text-indigo-600" /></div><div><p className="text-xl font-bold text-slate-900">{summary?.customersCount ?? 0}</p><p className="text-xs text-slate-500">Customers</p></div>
          </CardContent>
        </Card>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="outline">{summary.distanceMethod === "road_network" ? "Road-network distances" : "Straight-line estimate"}</Badge>
          <span className="text-slate-500">{summary.algorithm}</span>
          {(summary.unlocatedStops ?? unlocatedCount) > 0 && <Badge variant="warning">{summary.unlocatedStops ?? unlocatedCount} stop(s) need location details</Badge>}
        </div>
      )}

      {savings && (
        <Card
          className={cn(
            "border-emerald-200 bg-gradient-to-r",
            savedSomething ? "from-emerald-50 to-teal-50" : "from-gray-50 to-gray-50"
          )}
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <TrendingDown
                className={cn("h-8 w-8", savedSomething ? "text-emerald-600" : "text-gray-400")}
              />
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {savedSomething ? "Optimization savings vs original order" : "Route already optimal"}
                </p>
                <p className="text-xs text-gray-500">
                  {summary?.algorithm} · original route: {summary?.naiveDistance ?? 0} km
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="rounded-lg bg-white px-4 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-emerald-600">{savings.distance} km</p>
                <p className="text-[10px] text-gray-500">Distance saved</p>
              </div>
              <div className="rounded-lg bg-white px-4 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-emerald-600">{Math.round(savings.time)} min</p>
                <p className="text-[10px] text-gray-500">Time saved</p>
              </div>
              <div className="rounded-lg bg-white px-4 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-emerald-600">{formatPrice(savings.fuel)}</p>
                <p className="text-[10px] text-gray-500">Fuel saved</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {summary?.profitability && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" />
              Self Delivery vs Partner Handoff
            </CardTitle>
            <CardDescription>
              Is driving this route yourself actually worth it? Partner cost uses the same fee model as marketplace jobs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg border bg-slate-50/60 p-3 text-center">
                <p className="text-[11px] font-medium text-muted-foreground">Delivery revenue</p>
                <p className="mt-1 text-xl font-bold">{formatPrice(summary.profitability.revenue)}</p>
              </div>
              <div className="rounded-lg border bg-slate-50/60 p-3 text-center">
                <p className="text-[11px] font-medium text-muted-foreground">Fuel (self)</p>
                <p className="mt-1 text-xl font-bold text-orange-600">-{formatPrice(summary.profitability.fuelCost)}</p>
              </div>
              <div className="rounded-lg border bg-slate-50/60 p-3 text-center">
                <p className="text-[11px] font-medium text-muted-foreground">Partner fees</p>
                <p className="mt-1 text-xl font-bold text-blue-600">-{formatPrice(summary.profitability.partnerFeeEstimate)}</p>
              </div>
              <div className={cn("rounded-lg border p-3 text-center", summary.profitability.advantage >= 0 ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50")}>
                <p className="text-[11px] font-medium text-muted-foreground">
                  {summary.profitability.advantage >= 0 ? "Self delivery nets more by" : "Partners would net more by"}
                </p>
                <p className={cn("mt-1 text-xl font-bold", summary.profitability.advantage >= 0 ? "text-emerald-600" : "text-blue-600")}>
                  {formatPrice(Math.abs(summary.profitability.advantage))}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50/60 p-3 text-sm">
              <span className="font-medium">
                Self net <span className="text-emerald-600">{formatPrice(summary.profitability.selfNet)}</span>
                <span className="mx-2 text-gray-300">·</span>
                Partner net <span className="text-blue-600">{formatPrice(summary.profitability.partnerNet)}</span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                {summary.profitability.recommendation}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {highRiskCount > 0 && (
        <Card className="border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {highRiskCount} high-risk deliver{highRiskCount > 1 ? "ies" : "y"} on this route
                </p>
                <p className="text-xs text-amber-700">
                  Consider handing these to a delivery partner or scheduling an earlier slot.
                </p>
              </div>
            </div>
            {communityGroup.customerCount > 1 && (
              <div className="rounded-lg bg-white px-4 py-2 text-center shadow-sm">
                <p className="text-lg font-bold text-violet-600">{communityGroup.customerCount}</p>
                <p className="text-[10px] text-gray-500">batchable customers</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {mapMarkers.length > 0 && (
        <Card>
          <CardHeader className="border-b bg-white py-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Navigation className="h-5 w-5 text-emerald-600" />
              Route overview
            </CardTitle>
            <CardDescription>
              Optimized driving order from {origin?.name ?? "your farm"} — follow the blue line.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mapCenter ? (
              <Map
                center={mapCenter}
                zoom={12}
                height="420px"
                markers={mapMarkers}
                route={routePath}
                className="rounded-xl border"
              />
            ) : (
              <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-dashed text-center">
                <Navigation className="h-8 w-8 text-gray-300" />
                <p className="mt-2 text-sm font-medium text-gray-500">No mapped locations yet</p>
                <p className="text-xs text-gray-400">
                  Add location details to your orders to see the route on a map.
                </p>
              </div>
            )}
            {unlocatedCount > 0 && (
              <p className="mt-3 flex items-start gap-1 text-xs text-gray-500">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                {unlocatedCount} stop{unlocatedCount > 1 ? "s" : ""} could not be placed on the map
                (missing coordinates) but {unlocatedCount > 1 ? "are" : "is"} still included in the
                plan below.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {stops.length > 0 && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            AI Route Recommendation
          </CardTitle>
          <CardDescription>
            A heuristic suggestion (nearest-neighbour + 2-opt), not a guaranteed optimum — adjust the order to fit your
            time windows and vehicle capacity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SequenceBar stops={stops} />
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3 text-purple-600" />
              {summary?.totalOrders} orders · {summary?.totalStops} stops
            </span>
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-blue-600" />
              ~25 km/h with 10 min per stop
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-emerald-600" />
              Fuel estimated at {formatPrice(4.5)}/km
            </span>
          </div>
        </CardContent>
      </Card>
      )}

      {stops.length > 0 && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Navigation className="h-5 w-5 text-emerald-600" />
            Optimized Stop Plan
          </CardTitle>
          <CardDescription>
            {stops.length} stop{stops.length > 1 ? "s" : ""} in sequence with leg distances
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-0">
            <div className="flex items-start gap-4 pb-6">
              <div className="flex flex-col items-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                  <Home className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="mt-1 h-full w-0.5 bg-emerald-200" />
              </div>
              <div className="pt-1">
                <p className="text-sm font-medium">{origin?.name ?? "Farm Location"}</p>
                <p className="text-xs text-gray-500">{origin?.address || "Starting Point"}</p>
              </div>
            </div>

            {stops.map((stop, index) => (
              <div key={stop.orderId} className="flex items-start gap-4 pb-6">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  {index < stops.length - 1 && <div className="mt-1 h-full w-0.5 bg-emerald-200" />}
                </div>
                <div className="flex-1 rounded-lg border p-3 transition-colors hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{stop.customerName}</p>
                      <span className="text-[10px] text-gray-400">#{stop.orderNumber}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {riskyByOrder[stop.orderId]?.riskLevel === "HIGH" && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertTriangle className="mr-1 h-3 w-3" /> High risk
                        </Badge>
                      )}
                      {riskyByOrder[stop.orderId]?.riskLevel === "MEDIUM" && (
                        <Badge variant="warning" className="text-xs">Medium risk</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {stop.distance == null ? "Distance unavailable" : `+${stop.distance} km`}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {stop.address}
                    {stop.city ? `, ${stop.city}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(stop.items || []).map((p, pi) => (
                      <Badge key={pi} variant="secondary" className="text-xs">
                        {p.name} ({p.quantity})
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-emerald-600">
                      <Clock className="h-3 w-3" />
                      {stop.deliveryWindow}
                    </span>
                    {stop.legDurationMinutes != null && <span className="text-slate-500">{stop.legDurationMinutes} min from previous stop</span>}
                    {stop.priorityLabel && stop.priorityLabel !== "normal" && <Badge variant="outline">{stop.priorityLabel} priority</Badge>}
                    <span className="font-medium text-gray-700">{formatPrice(stop.total)}</span>
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-start gap-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
                <Flag className="h-4 w-4 text-blue-600" />
              </div>
              <div className="pt-1">
                <p className="text-sm font-medium">Return to {origin?.name ?? "Farm"}</p>
                <p className="text-xs text-gray-500">End of route</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button asChild>
              <Link href={`/farmer/route?orderIds=${encodeURIComponent(stops.map((stop) => stop.orderId).join(","))}`}>
                <Play className="mr-2 h-4 w-4" />
                Start delivery
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>}
    </div>
  );
}
