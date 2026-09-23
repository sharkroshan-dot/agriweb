"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Truck,
  MapPin,
  Clock,
  DollarSign,
  Star,
  CheckCircle,
  AlertCircle,
  Navigation,
  Phone,
  MessageSquare,
  Play,
  Pause,
  Route,
  Map,
  Globe,
  Package,
  Wallet,
  ArrowUpRight,
  TrendingUp,
  Landmark,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { PodPicker } from "../../../components/delivery/pod-picker";
import { cn } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import { formatPrice, formatTime } from "../../../lib/utils";
import toast from "react-hot-toast";
import { Map as LiveRouteMap } from "../../../components/shared/map";

const MapUnavailable = ({ deliveries }: { deliveries: any[] }) => (
  <div className="flex h-[400px] w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6">
    <div className="max-w-sm text-center">
      <MapPin className="mx-auto h-10 w-10 text-slate-400" />
      <p className="mt-3 font-semibold text-slate-800">Live location is unavailable</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">
        Enable location access or wait for delivery coordinates before starting live route tracking.
        {deliveries.length > 0 ? ` ${deliveries.length} delivery record(s) are loaded.` : ""}
      </p>
    </div>
  </div>
);

const contactCustomer = (phone: string | undefined, type: "call" | "message") => {
  if (!phone) {
    toast.error("Customer phone number is not available");
    return;
  }
  const number = phone.replace(/[^\d+]/g, "");
  window.location.href = type === "call" ? `tel:${number}` : `sms:${number}`;
};

const customerPhone = (delivery: any) =>
  delivery?.customerPhone || delivery?.customer?.phone || delivery?.customer?.phoneNumber
  || delivery?.order?.customerPhone || delivery?.order?.customer?.phone || delivery?.order?.phone
  || delivery?.phone || delivery?.phoneNumber;

type DeliveryMode = "nearby" | "state" | "national";

export default function DeliveryDashboardPage() {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [activeMode, setActiveMode] = useState<DeliveryMode>("nearby");
  const [liveOrigin, setLiveOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (position) => setLiveOrigin({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const { data: deliveries, isLoading, refetch } = useQuery({
    queryKey: ["deliveryToday"],
    queryFn: () => api.get("/delivery/me/today"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ["deliveryStats"],
    queryFn: () => api.get("/delivery/me/stats"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const { data: routeData, isLoading: isRouteLoading } = useQuery({
    queryKey: ["deliveryRoute"],
    queryFn: () => api.get("/delivery/me/route"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  React.useEffect(() => {
    if (stats?.data?.isAvailable !== undefined) {
      setIsAvailable(stats.data.isAvailable);
    } else {
      setIsAvailable(true);
    }
  }, [stats?.data]);

  const deliveryList = deliveries?.data?.deliveries || [];
  const completedCount = deliveryList.filter((d: any) => d.status === "delivered").length;
  const totalEarnings = stats?.data?.totalEarnings || 0;
  const averageRating = stats?.data?.averageRating || 0;
  const totalDeliveries = stats?.data?.totalDeliveries || 0;
  const ratingCount = stats?.data?.ratingCount || 0;
  const ratingSummary = stats?.data?.ratingSummary || {};

  const updateOrderStatus = async (orderId: string, status: string, label: string) => {
    try {
      const res = await api.put(`/orders/${orderId}/status`, { status });
      if (res?.success) {
        toast.success(`Order ${label} successfully!`);
        refetch();
      } else {
        toast.error(res?.detail || `Failed to ${label.toLowerCase()} order`);
      }
    } catch (err: any) {
      toast.error(err?.message || `Failed to ${label.toLowerCase()} order`);
    }
  };

  const podTargetRef = useRef<{ assignmentId: string; orderId: string } | null>(null);
  const [podPickerOpen, setPodPickerOpen] = useState(false);
  const [uploadingPod, setUploadingPod] = useState(false);

  const completeWithoutPod = async (orderId: string) => {
    try {
      await api.put(`/orders/${orderId}/status`, { status: "delivered" });
      toast.success("Delivery completed");
      refetch();
      refetchStats();
    } catch (err: any) {
      toast.error(err?.message || "Failed to complete delivery");
    }
  };

  const handleMarkDelivered = (delivery: any) => {
    const assignmentId = delivery?.assignmentId
      || (delivery.id && delivery.orderId && String(delivery.id) !== String(delivery.orderId) ? String(delivery.id) : "");
    const orderId = String(delivery.orderId || delivery.id || delivery._id || "");
    podTargetRef.current = { assignmentId, orderId };
    if (!assignmentId) {
      void completeWithoutPod(orderId);
      return;
    }
    setPodPickerOpen(true);
  };

  const handlePodFileChange = async (file: File) => {
    const target = podTargetRef.current;
    if (!file || !target) return;
    setUploadingPod(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("recipientName", "Customer");
      form.append("signature", window.prompt("Enter recipient signature/name") || "");
      const res = await fetch(`/api/v1/delivery/assignments/${target.assignmentId}/pod`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      toast.success("Delivery completed with proof of delivery");
      podTargetRef.current = null;
      refetch();
    } catch (err: any) {
      podTargetRef.current = null;
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploadingPod(false);
    }
  };

  const statusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: "Pending",
      confirmed: "Confirmed",
      processing: "Processing",
      ready_for_delivery: "Ready for Delivery",
      dispatched: "Out for Delivery",
      in_transit: "In Transit",
      delivered: "Delivered",
      cancelled: "Cancelled",
    };
    return labels[status] || status;
  };

  const paymentBadge = (method?: string) => {
    const m = (method || "").toLowerCase();
    const cod = m === "cash" || m === "cod" || m === "cash_on_delivery";
    return m || cod ? { label: cod ? "COD" : "Online", cod } : null;
  };

  const formatAddress = (addr: any) => {
    if (!addr) return "";
    if (typeof addr === "string") return addr;
    return [addr.addressLine1, addr.addressLine2, addr.city, addr.state]
      .filter(Boolean)
      .join(", ") || addr.address || "";
  };

  const nearbyDeliveries = useMemo(
    () =>
      deliveryList
        .filter((d: any) => d.type === "nearby")
        .map((d: any) => ({
          id: d._id,
          customerName: d.customerName,
          distance: typeof d.distance === "number" ? `${d.distance} km` : d.distance || "—",
          address: formatAddress(d.address),
          deliveryWindow: d.deliveryWindow,
          status: d.status,
        })),
    [deliveryList]
  );

  const stateDeliveries = useMemo(
    () =>
      deliveryList
        .filter((d: any) => d.type === "state")
        .map((d: any) => ({
          id: d._id,
          destination: d.customerName || formatAddress(d.address).split(",")[0]?.trim() || "Unknown",
          products:
            (d.items || []).map((i: any) => i.name).join(", ") || "Various items",
          weight: `${(d.items || []).reduce((s: number, i: any) => s + (i.quantity || 0), 0)} units`,
          status: d.status,
          trackingId: d._id ? `ST-${d._id.slice(-6).toUpperCase()}` : "NA",
        })),
    [deliveryList]
  );

  const nationalDeliveries = useMemo(
    () =>
      deliveryList
        .filter((d: any) => d.type === "national")
        .map((d: any) => ({
          id: d._id,
          destination:
            formatAddress(d.address).split(",").pop()?.trim() || d.customerName || "Other State",
          products:
            (d.items || []).map((i: any) => i.name).join(", ") || "Various items",
          courier: "Standard Courier",
          tracking: d._id ? d._id.slice(-8).toUpperCase() : "NA",
          status: d.status,
        })),
    [deliveryList]
  );

  const routeStops = useMemo(() => {
    const waypoints = routeData?.data?.waypoints || [];
    if (waypoints.length > 0) {
      return waypoints.map((wp: any, index: number) => ({
        id: wp._id || index,
        address: formatAddress(wp.address),
        status:
          index < completedCount
            ? "completed"
            : index === completedCount
              ? "current"
              : "pending",
      }));
    }
    return deliveryList.map((d: any, index: number) => ({
      id: d._id || index,
      address: formatAddress(d.address) + (d.customerName ? ` (${d.customerName})` : ""),
      status:
        d.status === "delivered"
          ? "completed"
          : d.status === "in_transit"
            ? "current"
            : "pending",
    }));
  }, [routeData, deliveryList, completedCount]);

  const totalDistance = routeData?.data?.totalDistance || 0;
  const estimatedTime = routeData?.data?.estimatedTime || 0;
  const fuelCost = totalDistance ? Math.round(totalDistance * 7.5) : 0;
  const weeklyEarnings = stats?.data?.weeklyEarnings || 0;
  const pendingPayout = stats?.data?.pendingPayout || 0;
  const availableBalance = stats?.data?.availableBalance || totalEarnings || 0;

  const mapMarkers = useMemo(
    () =>
      deliveryList
        .filter((d: any) => d.status !== "cancelled")
        .map((d: any) => {
          const coords = d.deliveryAddress?.location?.coordinates;
          return {
            id: String(d.id || d._id || d.orderId || `delivery-${d.customerName || "stop"}-${formatAddress(d.deliveryAddress)}`),
            lat: coords?.[1],
            lng: coords?.[0],
            title: d.customerName || "Delivery stop",
            info: formatAddress(d.deliveryAddress),
            address: formatAddress(d.deliveryAddress),
          };
        }),
    [deliveryList]
  );

  const mapRoute = useMemo(() => {
    const waypointCoords = (routeData?.data?.waypoints || [])
      .map((w: any) => w.location?.coordinates)
      .filter(Boolean);
    const destinationPoints = waypointCoords.length
      ? waypointCoords.map((c: number[]) => ({ lat: c[1], lng: c[0] }))
      : mapMarkers.filter((m: any) => m.lat != null && m.lng != null);
    return liveOrigin ? [liveOrigin, ...destinationPoints] : [];
  }, [routeData, mapMarkers, liveOrigin]);

  const firstMappedPoint = mapMarkers.find((m: any) => m.lat != null && m.lng != null);\n\n  const liveMapMarkers = useMemo(
    () => liveOrigin
      ? [{ id: "live-origin", ...liveOrigin, title: "Current location", info: "Route starting point" }, ...mapMarkers]
      : mapMarkers,
    [liveOrigin, mapMarkers]
  );


  const formatEstimatedTime = (minutes: number) => {
    if (!minutes) return "—";
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const handleToggleAvailability = async () => {
    if (isAvailable === null || isToggling) return;
    const nextAvailable = !isAvailable;
    setIsToggling(true);
    try {
      await api.put("/delivery/me/availability", { isAvailable: nextAvailable });
      setIsAvailable(nextAvailable);
      toast.success(nextAvailable ? "You are now Online" : "You are now Offline");
      refetch();
      refetchStats();
    } catch (error) {
      toast.error("Failed to update status");
    } finally {
      setIsToggling(false);
    }
  };

  const handleWithdraw = async () => {
    try {
      await api.post("/delivery/me/earnings/withdraw");
      toast.success("Withdrawal request submitted!");
    } catch (err: any) {
      toast.error(err?.message || "Failed to withdraw");
    }
  };

  if (isLoading || isAvailable === null) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Delivery Dashboard</h1>
          <p className="text-muted-foreground">
            {isAvailable ? "Online - Ready for deliveries" : "Offline - Not accepting deliveries"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={isAvailable ? "destructive" : "default"}
            onClick={handleToggleAvailability}
            disabled={isToggling}
          >
            {isAvailable ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
            {isToggling ? (isAvailable ? "Going Offline..." : "Going Online...") : (isAvailable ? "Go Offline" : "Go Online")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Today's Deliveries</p>
                <p className="text-2xl font-bold">{deliveryList.length}</p>
              </div>
              <div className="rounded-full p-2 bg-muted text-blue-600">
                <Truck className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">{completedCount}</p>
              </div>
              <div className="rounded-full p-2 bg-muted text-green-600">
                <CheckCircle className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">{completedCount}/{deliveryList.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Today's Earnings</p>
                <p className="text-2xl font-bold">{formatPrice(totalEarnings)}</p>
              </div>
              <div className="rounded-full p-2 bg-muted text-green-600">
                <DollarSign className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Rating</p>
                <p className="text-2xl font-bold">{averageRating}</p>
              </div>
              <div className="rounded-full p-2 bg-muted text-yellow-600">
                <Star className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {ratingCount} rating{ratingCount === 1 ? "" : "s"} • {totalDeliveries} total deliveries
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance & ratings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 text-yellow-500" /> Performance &amp; Ratings
          </CardTitle>
          <CardDescription>Customer feedback breakdown across your deliveries</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ratingCount === 0 ? (
            <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
              No customer ratings yet. Once customers rate your deliveries, your feedback will appear here.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  { label: "Overall", value: ratingSummary.overallAvg },
                  { label: "On-time", value: ratingSummary.onTimeAvg },
                  { label: "Professionalism", value: ratingSummary.professionalismAvg },
                  { label: "Product handling", value: ratingSummary.handlingAvg },
                  { label: "Communication", value: ratingSummary.communicationAvg },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold text-yellow-600">{item.value || 0}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
                    <div className="mt-2 flex items-center justify-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          className={`h-3 w-3 ${s <= Math.round(item.value || 0) ? "fill-yellow-400 text-yellow-400" : "text-slate-300"}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/40 p-4">
                <div className="flex-1">
                  <p className="text-sm font-medium">On-time percentage</p>
                  <p className="text-xs text-muted-foreground">Share of ratings marking on-time delivery as 4+ stars</p>
                </div>
                <Badge variant="success">{ratingSummary.onTimePercentage ?? 0}%</Badge>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold">Star distribution</h4>
                <div className="space-y-1.5">
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = ratingSummary.distribution?.[String(star)] || 0;
                    const pct = ratingCount ? Math.round((count / ratingCount) * 100) : 0;
                    return (
                      <div key={star} className="flex items-center gap-2 text-sm">
                        <span className="w-3 font-medium">{star}</span>
                        <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-yellow-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-8 text-right text-xs text-muted-foreground">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Delivery Mode Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Delivery Mode</CardTitle>
          <CardDescription>Switch between nearby, state, and national delivery modes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="selection-control mb-6 flex w-fit gap-2 rounded-full border">
            {[
              { key: "nearby", label: "Nearby Delivery", icon: Map },
              { key: "state", label: "State Delivery", icon: Route },
              { key: "national", label: "National Delivery", icon: Globe },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeMode === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveMode(tab.key as DeliveryMode)}
                  className={cn(
                    "selection-item inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium",
                    isActive ? "selection-item-active" : "selection-item-inactive"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeMode === "nearby" && (
            <div className="space-y-6">
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Route className="h-5 w-5 text-primary" />
                  <span className="font-semibold">Route Info</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">Start Time</p>
                    <p className="font-medium">08:30 AM</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Est. Finish</p>
                    <p className="font-medium">03:15 PM</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total Distance</p>
                    <p className="font-medium">{totalDistance ? `${totalDistance} km` : "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Customers</p>
                    <p className="font-medium">{deliveryList.length}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <Button size="sm">
                    <Navigation className="mr-2 h-4 w-4" />
                    Start Nearby Route
                  </Button>
                </div>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : nearbyDeliveries.length === 0 ? (
                <div className="flex justify-center py-8 text-sm text-muted-foreground">
                  No nearby deliveries
                </div>
              ) : (
                <div className="space-y-3">
                  {nearbyDeliveries.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-4 rounded-lg border p-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                        <MapPin className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{d.customerName}</p>
                          <Badge variant={d.status === "delivered" ? "success" : d.status === "in_transit" ? "warning" : "secondary"} className="text-[10px] px-1.5 py-0">
                            {d.status === "in_transit" ? "In Transit" : d.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{d.address}</p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{d.distance}</span>
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{d.deliveryWindow}</span>
                        </div>
                      </div>
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0">
                        <Navigation className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeMode === "state" && (
            <>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : stateDeliveries.length === 0 ? (
                <div className="flex justify-center py-8 text-sm text-muted-foreground">
                  No state deliveries
                </div>
              ) : (
                <div className="space-y-3">
                  {stateDeliveries.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-4 rounded-lg border p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                        <Route className="h-5 w-5 text-orange-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{d.destination}</p>
                          <Badge variant={d.status === "delivered" ? "success" : d.status === "in_transit" ? "warning" : "secondary"}>
                            {d.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{d.products}</p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Package className="h-3 w-3" />{d.weight}</span>
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />ID: {d.trackingId}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        Update Tracking
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {activeMode === "national" && (
            <>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : nationalDeliveries.length === 0 ? (
                <div className="flex justify-center py-8 text-sm text-muted-foreground">
                  No national deliveries
                </div>
              ) : (
                <div className="space-y-3">
                  {nationalDeliveries.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-4 rounded-lg border p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
                        <Globe className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{d.destination}</p>
                          <Badge variant={d.status === "delivered" ? "success" : d.status === "in_transit" ? "warning" : "secondary"}>
                            {d.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{d.products}</p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Truck className="h-3 w-3" />{d.courier}</span>
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{d.tracking}</span>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        <Package className="mr-2 h-4 w-4" />
                        Book Courier
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Today's Route Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="h-5 w-5 text-primary" />
            Today's Route Overview
          </CardTitle>
          <CardDescription>Summary of your delivery route for today</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total Distance</p>
              <p className="mt-1 text-lg font-bold">{totalDistance ? `${totalDistance} km` : "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total Orders</p>
              <p className="mt-1 text-lg font-bold">{deliveryList.length}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Fuel Cost</p>
              <p className="mt-1 text-lg font-bold">{fuelCost ? formatPrice(fuelCost) : "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Expected Income</p>
              <p className="mt-1 text-lg font-bold">{formatPrice(totalEarnings)}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Est. Time</p>
              <p className="mt-1 text-lg font-bold">{formatEstimatedTime(estimatedTime)}</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Deliveries Progress</span>
              <span className="font-medium">{completedCount}/{deliveryList.length} completed</span>
            </div>
            <Progress value={deliveryList.length ? (completedCount / deliveryList.length) * 100 : 0} className="h-2.5" />
          </div>

          {isRouteLoading ? (
            <div className="mt-6 flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : routeStops.length > 0 ? (
            <div className="mt-6">
              <h4 className="mb-3 text-sm font-semibold">Route Stops</h4>
              <div className="space-y-1">
                {routeStops.map((stop: any, index: number) => (
                  <div key={stop.id} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                          stop.status === "completed" && "bg-green-100 text-green-700",
                          stop.status === "current" && "bg-primary text-primary-foreground",
                          stop.status === "pending" && "bg-muted text-muted-foreground"
                        )}
                      >
                        {stop.status === "completed" ? <CheckCircle className="h-3.5 w-3.5" /> : index + 1}
                      </div>
                      {index < routeStops.length - 1 && <div className="h-6 w-0.5 bg-border" />}
                    </div>
                    <div className="flex-1 pb-4">
                      <p className={cn("text-sm", stop.status === "current" && "font-medium text-primary")}>
                        {stop.address}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{stop.status.replace("_", " ")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-6 flex justify-center py-4 text-sm text-muted-foreground">
              No route data available
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Navigation className="h-5 w-5 text-primary" />
              Live Route
            </CardTitle>
            <CardDescription>Real-time tracking of your deliveries</CardDescription>
          </CardHeader>
          <CardContent>
            {deliveryList.length === 0 && mapRoute.length === 0 ? (
              <MapPlaceholder deliveries={deliveryList} />
            ) : (
              <LiveRouteMap
                center={
                  liveOrigin || { lat: 28.7041, lng: 77.1025 }
                }
                trackUserLocation
                userLocation={liveOrigin}
                markers={liveMapMarkers}
                route={mapRoute}
                height="400px"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today's Summary</CardTitle>
            <CardDescription>Your performance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pending</span>
                <span className="font-medium">{deliveryList.filter((d: any) => d.status !== "delivered" && d.status !== "cancelled").length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Completed</span>
                <span className="font-medium">{completedCount}</span>
              </div>
            </div>
            {stats?.data?.onTimeDelivery !== undefined && (
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">On-Time Rate</span>
                  <Badge variant="success">{stats.data.onTimeDelivery}%</Badge>
                </div>
                <div className="mt-2 h-2 w-full rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-green-600" style={{ width: `${stats.data.onTimeDelivery}%` }} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              My Deliveries
            </CardTitle>
            <CardDescription>
              {deliveryList.length} total • {completedCount} completed
            </CardDescription>
          </div>
          <Link href="/delivery/deliveries">
            <Button variant="ghost" size="sm">View All</Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {deliveryList.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
                <p className="mt-2 text-muted-foreground">No orders available for delivery.</p>
              </div>
            ) : (
              deliveryList.map((delivery: any, index: number) => (
                <div key={delivery.id} className="flex items-center gap-4 rounded-lg border p-4 transition-all hover:shadow-md">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{index + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{delivery.customerName}</p>
                      <Badge
                        variant={
                          delivery.status === "delivered"
                            ? "success"
                            : delivery.status === "in_transit"
                            ? "warning"
                            : delivery.status === "ready_for_delivery"
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {statusLabel(delivery.status)}
                      </Badge>
                      {paymentBadge(delivery.paymentMethod) && (
                        <Badge variant="outline" className={paymentBadge(delivery.paymentMethod)?.cod ? "bg-amber-500/10 text-amber-600 border-amber-500/20" : "border-blue-200 text-blue-700"}>
                          {paymentBadge(delivery.paymentMethod)?.label}
                        </Badge>
                      )}
                      {delivery.pickedBy && (
                        <span className="text-xs text-muted-foreground">Picked by {delivery.pickedBy}</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{formatAddress(delivery.deliveryAddress)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{formatAddress(delivery.deliveryAddress)}</span>
                      {delivery.totalAmount && (
                        <span className="flex items-center gap-1"><span className="font-medium text-primary">{formatPrice(delivery.totalAmount)}</span></span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {customerPhone(delivery) && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contactCustomer(customerPhone(delivery), "call")} aria-label="Call customer"><Phone className="h-4 w-4" /></Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contactCustomer(delivery.customerPhone, "message")} aria-label="Message customer"><MessageSquare className="h-4 w-4" /></Button>
                    {delivery.status === "ready_for_delivery" && (
                      <Button size="sm" onClick={() => updateOrderStatus(delivery.orderId || delivery.id, "in_transit", "Accepted")}>
                        <CheckCircle className="mr-2 h-4 w-4" />Accept
                      </Button>
                    )}
                    {delivery.status === "in_transit" && (
                      <Button size="sm" onClick={() => handleMarkDelivered(delivery)} disabled={uploadingPod}>
                        {uploadingPod ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}Mark Delivered
                      </Button>
                    )}
                    {delivery.status !== "delivered" && delivery.status !== "ready_for_delivery" && delivery.status !== "in_transit" && (
                      <Button size="sm"><Navigation className="mr-2 h-4 w-4" />Navigate</Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Earnings Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Earnings Summary
          </CardTitle>
          <CardDescription>Your earnings overview and withdrawals</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-600" />
                <p className="text-sm text-muted-foreground">Today</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-emerald-700">{formatPrice(totalEarnings)}</p>
              <div className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
                <TrendingUp className="h-3 w-3" />
                <span>+12% vs yesterday</span>
              </div>
            </div>

            <div className="rounded-lg border bg-gradient-to-br from-blue-50 to-blue-100/50 p-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-blue-600" />
                <p className="text-sm text-muted-foreground">This Week</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-blue-700">{formatPrice(weeklyEarnings)}</p>
              <div className="mt-1 flex items-center gap-1 text-xs text-blue-600">
                <TrendingUp className="h-3 w-3" />
                <span>+8% vs last week</span>
              </div>
            </div>

            <div className="rounded-lg border bg-gradient-to-br from-amber-50 to-amber-100/50 p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-600" />
                <p className="text-sm text-muted-foreground">Pending Payments</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-amber-700">{formatPrice(pendingPayout)}</p>
              <p className="mt-1 text-xs text-amber-600">{deliveryList.filter((d: any) => d.status !== "delivered").length} deliveries pending</p>
            </div>

            <div className="rounded-lg border bg-gradient-to-br from-primary/5 to-primary/10 p-4 flex flex-col justify-between">
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" />
                <p className="text-sm text-muted-foreground">Available Balance</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-primary">{formatPrice(availableBalance)}</p>
              <Button className="mt-3 w-full" size="sm" onClick={handleWithdraw}>
                <ArrowUpRight className="mr-2 h-4 w-4" />
                Withdraw
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-blue-100 p-3"><Navigation className="h-6 w-6 text-blue-600" /></div>
              <div><p className="font-medium">Optimize Route</p><p className="text-sm text-muted-foreground">Smart route planning</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-green-100 p-3"><CheckCircle className="h-6 w-6 text-green-600" /></div>
              <div><p className="font-medium">Complete Delivery</p><p className="text-sm text-muted-foreground">Mark as delivered</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-yellow-100 p-3"><AlertCircle className="h-6 w-6 text-yellow-600" /></div>
              <div><p className="font-medium">Report Issue</p><p className="text-sm text-muted-foreground">Delivery problems</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <PodPicker
        open={podPickerOpen}
        onOpenChange={setPodPickerOpen}
        uploading={uploadingPod}
        onFile={handlePodFileChange}
      />
    </div>
  );
}
