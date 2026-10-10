"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, CheckCircle2, Navigation, Hand, Warehouse, UserCheck, Lock, Truck, Briefcase, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";
import { useState } from "react";

const routeStatusLabel = (value: string) => ({
  offered: "Waiting for partner",
  assigned: "Assigned to you",
  started: "Pickup in progress",
  departed_farm: "All farms departed",
  completed: "Route completed",
  returned_to_warehouse: "Returned to warehouse",
} as Record<string, string>)[value] || value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const routeDayLabel = (route: any) => {
  const value = route.routeDate || route.createdAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
};

const isCarryoverRoute = (route: any) => {
  const value = route.routeDate || route.createdAt;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const routeDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return routeDay < todayDay;
};

const mergeFarmStopsForDisplay = (input: any[]) => {
  const groups: Record<string, any> = {};
  const statusRank: Record<string, number> = {
    pending: 0,
    ready_for_pickup: 1,
    team_assigned: 2,
    en_route: 3,
    started: 3,
    arrived_at_farm: 4,
    collected: 5,
    departed_farm: 6,
    arrived_warehouse: 7,
  };
  for (const source of input || []) {
    const name = String(source.farmerName || "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const address = String(source.pickupAddress || "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const farmId = String(source.farmId || source.farmProfileId || "").trim();
    const key = name && address && !address.includes("farm address not provided")
      ? "farm:" + name + "|" + address
      : farmId
        ? "farm-id:" + farmId
        : name
          ? "farmer:" + name
          : String(source.farmKey || source.collectionId || Object.keys(groups).length);
    if (!groups[key]) {
      groups[key] = {
        ...source,
        farmKey: key,
        orders: [],
        collectionIds: [],
      };
    }
    const group = groups[key];
    const knownCollections = new Set(group.collectionIds.map((value: any) => String(value)));
    const sourceOrders = Array.isArray(source.orders) && source.orders.length ? source.orders : [source];
    for (const order of sourceOrders) {
      const collectionId = String(order.collectionId || "");
      if (collectionId && knownCollections.has(collectionId)) continue;
      group.orders.push(order);
      if (collectionId) {
        group.collectionIds.push(collectionId);
        knownCollections.add(collectionId);
      }
    }
    group.collectionId = group.collectionId || source.collectionId;
    
    group.pickupAddress = group.pickupAddress || source.pickupAddress;
  }

  return Object.values(groups).map((group: any) => {
    const orders = group.orders || [];
    const seen = new Set<string>();
    const uniqueOrders = orders.filter((order: any, index: number) => {
      const id = String(order.collectionId || "");
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const rankValues = uniqueOrders.map((order: any) => statusRank[String(order.status || "pending")] ?? 0);
    const farmStatus = rankValues.length ? uniqueOrders[rankValues.indexOf(Math.min(...rankValues))]?.status || group.status : group.status;
    const customerOrderKeys = new Set(uniqueOrders.map((order: any, index: number) => {
      const orderNumber = String(order.orderNumber || "").trim();
      if (orderNumber && orderNumber !== "Order reference unavailable") return "number:" + orderNumber.toLocaleLowerCase();
      if (order.orderId) return "id:" + String(order.orderId);
      return "collection:" + String(order.collectionId || index);
    }));
    return {
      ...group,
      orders: uniqueOrders,
      orderCount: customerOrderKeys.size,
      collectionIds: uniqueOrders.map((order: any) => order.collectionId).filter(Boolean),
      collectionId: uniqueOrders.find((order: any) => order.collectionId)?.collectionId || group.collectionId,
      orderCount: uniqueOrders.length,
      quantity: uniqueOrders.reduce((sum: number, order: any) => sum + Number(order.quantity || 0), 0),
      actualQuantity: uniqueOrders.reduce((sum: number, order: any) => sum + Number(order.actualQuantity || 0), 0),
      status: farmStatus,
    };
  });
};

const stopStatusLabel = (value: string) => ({
  pending: "Waiting for pickup",
  ready_for_pickup: "Ready for pickup",
  team_assigned: "Assigned to pickup partner",
  en_route: "On the way to farm",
  started: "Pickup started",
  arrived_at_farm: "Arrived at farm",
  collected: "Collected",
  departed_farm: "Departed farm",
  arrived_warehouse: "At warehouse",
} as Record<string, string>)[value] || value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function DeliveryPickupRoutesPage() {
  const offersQ = useQuery({
    queryKey: ["myPickupOffers"],
    queryFn: () => api.get("/delivery/me/pickup-offers"),
    refetchInterval: 5000,
  });
  const routesQ = useQuery({
    queryKey: ["myPickupRoutes"],
    queryFn: () => api.get("/delivery/me/pickup-routes"),
    refetchInterval: 10000,
  });
  const [actual, setActual] = useState<Record<string, string>>({});
  const [expandedFarmStops, setExpandedFarmStops] = useState<Record<string, boolean>>({});
  const marketplaceQ = useQuery({
    queryKey: ["warehousePickupJobs"],
    queryFn: () => api.get("/delivery/me/pickup-jobs"),
    refetchInterval: 5000,
  });
  const offers = offersQ.data?.data?.routes || [];
  const routes = routesQ.data?.data?.routes || [];
  const pickupJobs = marketplaceQ.data?.data?.openJobs || [];
  const acceptedPickupJobs = marketplaceQ.data?.data?.acceptedJobs || [];

  const accept = async (routeId: string) => {
    try {
      await api.post("/delivery/me/pickup-offers/" + routeId + "/accept");
      toast.success("Route accepted. You are now the pickup partner for this route.");
      await Promise.all([offersQ.refetch(), routesQ.refetch()]);
    } catch (e: any) {
      if (e?.response?.status === 409 || e?.status === 409) {
        toast.error("This route was accepted by another partner. Refreshing the accepted-by details.");
      } else {
        toast.error(e?.response?.data?.detail?.message || e?.message || "This route is no longer available");
      }
      await offersQ.refetch();
    }
  };

  const acceptMarketplaceJob = async (jobId: string) => {
    try {
      await api.post("/delivery/jobs/" + jobId + "/accept");
      toast.success("Warehouse pickup job accepted. The full farm route is now assigned to you.");
      await Promise.all([marketplaceQ.refetch(), routesQ.refetch()]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || "This pickup job is no longer available");
      await marketplaceQ.refetch();
      await routesQ.refetch();
    }
  };

  const act = async (
    route: any,
    status: string,
    collectionId?: string,
    actualQuantities?: Record<string, number>,
  ) => {
    try {
      await api.put(
        "/delivery/me/pickup-routes/" + route.id + "/status",
        actualQuantities,
        { params: { status, collectionId, actualQuantity: actualQuantities ? undefined : collectionId ? Number(actual[collectionId] || 0) : undefined } }
      );
      toast.success(status === "collected" && actualQuantities ? "All orders at this farm marked collected" : status.replace(/_/g, " "));
      await routesQ.refetch();
    } catch (e: any) {
      toast.error(e?.message || "Unable to update pickup route");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-emerald-700 to-teal-600 p-6 text-white">
        <p className="text-sm text-emerald-100">Warehouse pickup operations</p>
        <h1 className="mt-1 text-3xl font-bold">Pickup Routes</h1>
        <p className="mt-2 text-sm text-emerald-50">
          Open routes are offered to every approved pickup partner. The first partner to accept gets the route.
        </p>
      </div>

      {pickupJobs.length > 0 && (
        <Card className="border-blue-200">
          <CardHeader className="border-b bg-blue-50/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-5 w-5" /> Warehouse Pickup Jobs
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              No approved pickup partner was available for these routes. They are open to eligible delivery partners based on availability and remaining vehicle capacity.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {pickupJobs.map((job: any) => (
              <div key={job.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold"><Truck className="mr-2 inline h-4 w-4" />{job.routeNumber || job.orderNumber}</p>
                    <p className="text-sm text-muted-foreground">
                      {mergeFarmStopsForDisplay(job.farmStops || []).length} farms · {mergeFarmStopsForDisplay(job.farmStops || []).reduce((sum: number, stop: any) => sum + (stop.orderCount || stop.orders?.length || 1), 0)} orders · {mergeFarmStopsForDisplay(job.farmStops || []).reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0)} kg · {job.distanceKm || 0} km route
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Farms → {job.warehouseName || "Warehouse"}
                    </p>
                  </div>
                  <Button onClick={() => acceptMarketplaceJob(job.id)}>
                    <Hand className="mr-2 h-4 w-4" /> Accept Pickup Job
                  </Button>
                </div>
                <div className="mt-4 space-y-2">
                  {mergeFarmStopsForDisplay(job.farmStops || []).map((stop: any, i: number) => {
                    const orders = Array.isArray(stop.orders) && stop.orders.length ? stop.orders : [stop];
                    return (
                      <div key={stop.farmKey || stop.collectionId || i} className="rounded-lg border bg-slate-50 p-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{i + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">{stop.farmerName || "Farmer details unavailable"}</p>
                            <p className="text-xs text-muted-foreground">{orders.length} {orders.length === 1 ? "order" : "orders"} · {stop.quantity || 0} kg</p>
                            <p className="mt-1 text-xs text-muted-foreground">{stop.pickupAddress || "Farm address not provided"}</p>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2 border-t pt-3">
                          {orders.map((order: any, orderIndex: number) => (
                            <div key={order.collectionId || order.orderId || orderIndex} className="rounded-md bg-white p-2">
                              <p className="text-sm font-medium">{order.orderNumber ? "Order " + order.orderNumber : "Order " + (orderIndex + 1)}</p>
                              <p className="text-xs text-muted-foreground">{order.productName || "Product details unavailable"} · {order.quantity || 0} kg</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {acceptedPickupJobs.length > 0 && (
        <Card className="border-emerald-200">
          <CardHeader className="border-b bg-emerald-50/70">
            <CardTitle>My Warehouse Pickup Jobs</CardTitle>
            <p className="text-sm text-muted-foreground">Accepted marketplace pickup routes are now being processed in the same pickup workflow below.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {acceptedPickupJobs.map((job: any) => (
              <div key={job.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{job.routeNumber || job.orderNumber}</p>
                    <p className="text-sm text-muted-foreground">{mergeFarmStopsForDisplay(job.farmStops || []).length} farms · {mergeFarmStopsForDisplay(job.farmStops || []).reduce((sum: number, stop: any) => sum + (stop.orderCount || stop.orders?.length || 1), 0)} orders · {mergeFarmStopsForDisplay(job.farmStops || []).reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0)} kg → {job.warehouseName || "Warehouse"}</p>
                  </div>
                  <Badge variant="success">Accepted</Badge>
                </div>
              <div className="mt-4 space-y-2">
                {mergeFarmStopsForDisplay(job.farmStops || []).map((stop: any, index: number) => {
                  const orders = Array.isArray(stop.orders) && stop.orders.length ? stop.orders : [stop];
                  return (
                    <div key={stop.farmKey || stop.collectionId || index} className="rounded-lg border bg-slate-50 p-3">
                      <p className="font-semibold">{stop.farmerName || "Farmer details unavailable"}</p>
                      <p className="text-xs text-muted-foreground">{orders.length} {orders.length === 1 ? "order" : "orders"} · {stop.quantity || 0} kg</p>
                      <p className="mt-1 text-xs text-muted-foreground">{stop.pickupAddress || "Farm address not provided"}</p>
                      <div className="mt-3 space-y-2 border-t pt-3">
                        {orders.map((order: any, orderIndex: number) => (
                          <div key={order.collectionId || order.orderId || orderIndex} className="rounded-md bg-white p-2">
                            <p className="text-sm font-medium">{order.orderNumber ? "Order " + order.orderNumber : "Order " + (orderIndex + 1)}</p>
                            <p className="text-xs text-muted-foreground">{order.productName || "Product details unavailable"} · {order.quantity || 0} kg</p>
                            {order.actualQuantity != null && <p className="mt-1 text-xs font-medium text-emerald-700">Collected: {order.actualQuantity} kg</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {offers.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="border-b bg-amber-50/70">
            <CardTitle className="flex items-center gap-2 text-base">
              <Hand className="h-5 w-5" /> Available Warehouse Pickup Routes
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Review the farms and orders before accepting. The first eligible partner to accept a route gets it.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {offers.map((r: any) => {
              const mine = r.claimState === "mine";
              const claimedByOther = r.claimState === "claimed_by_other";
              const offerStops = mergeFarmStopsForDisplay(r.stops || []);
              return (
                <div key={r.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold">🚚 {r.routeNumber || "Pickup Route"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {offerStops.length} farms · {offerStops.reduce((sum: number, stop: any) => sum + (stop.orderCount || stop.orders?.length || 1), 0)} orders · {offerStops.reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0)} kg
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Destination: {r.warehouseName || "Assigned warehouse"}</p>
                    </div>
                    {r.claimState === "open" && (
                      <Button onClick={() => accept(r.id)}>
                        <Hand className="mr-2 h-4 w-4" /> Accept Route
                      </Button>
                    )}
                  </div>

                  {mine && (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      <p className="font-semibold"><UserCheck className="mr-2 inline h-4 w-4" /> Route accepted by you</p>
                      <p className="mt-1 text-xs">Vehicle: {r.deliveryPartnerVehicleType || "Not specified"} · {r.deliveryPartnerVehicleNumber || "Not specified"}</p>
                    </div>
                  )}
                  {claimedByOther && (
                    <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                      <p className="font-semibold"><Lock className="mr-2 inline h-4 w-4" /> Already accepted by {r.deliveryPartnerName || "another pickup partner"}</p>
                      <p className="mt-1 text-xs">Vehicle: {r.deliveryPartnerVehicleType || "Not specified"} · {r.deliveryPartnerVehicleNumber || "Not specified"}</p>
                    </div>
                  )}

                  <div className="mt-4 space-y-3">
                    {offerStops.map((stop: any, index: number) => {
                      const orders = Array.isArray(stop.orders) && stop.orders.length ? stop.orders : [stop];
                      return (
                        <div key={stop.farmKey || stop.collectionId || index} className="rounded-lg border bg-slate-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold">{stop.farmerName || "Farmer details unavailable"}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{orders.length} orders · Expected {stop.quantity || 0} kg</p>
                              <p className="mt-1 text-xs text-muted-foreground">{stop.pickupAddress || "Farm address not provided"}</p>
                            </div>
                            <Badge variant="outline">{stopStatusLabel(String(stop.status || "pending"))}</Badge>
                          </div>
                          <div className="mt-3 divide-y rounded-md border bg-white">
                            {orders.map((order: any, orderIndex: number) => (
                              <div key={order.collectionId || order.orderId || orderIndex} className="p-3">
                                <p className="text-sm font-medium">{order.orderNumber ? "Order " + order.orderNumber : "Order " + (orderIndex + 1)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{order.productName || "Product details unavailable"} · {order.quantity || 0} kg</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {routes.length === 0 ? (
        <Card className="p-12 text-center">
          <Route className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{offers.length ? "No route assigned yet" : "No pickup route assigned"}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {offers.length
              ? "Accept an available route. If another partner accepts first, the route will become unavailable to you."
              : "No active pickup routes. Unfinished routes remain visible until they are returned to the warehouse."}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {routes.map((r: any) => {
            const farmStops = mergeFarmStopsForDisplay(r.stops || []);
            return (
              <Card key={r.id}>
                <CardHeader className="border-b bg-slate-50/70">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>🚚 {r.routeNumber || "Pickup Route"}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {farmStops.length} farms · {farmStops.reduce((sum: number, stop: any) => sum + (stop.orderCount || stop.orders?.length || 1), 0)} orders · {farmStops.reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0)} kg
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Destination: {r.warehouseName || "Assigned warehouse"}</p>
                      {routeDayLabel(r) && <p className="mt-1 text-xs text-muted-foreground">Route date: {routeDayLabel(r)}</p>}
                      {isCarryoverRoute(r) && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          <strong>Continued from a previous day.</strong> This route stays here until pickup and warehouse handover are complete.
                        </div>
                      )}
                    </div>
                    <Badge><CheckCircle2 className="mr-1 h-3 w-3" /> {routeStatusLabel(String(r.status || "assigned"))}</Badge>
                  </div>
                </CardHeader>

                <CardContent className="p-5">
                  <div className="mb-5 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                    <Warehouse className="h-4 w-4" /> This route is assigned to you. Other partners cannot accept it.
                  </div>
                  {r.status === "assigned" && (
                    <Button className="mb-5" onClick={() => act(r, "started")}>
                      <Navigation className="mr-2 h-4 w-4" /> Start Pickup Route
                    </Button>
                  )}

                  <div className="space-y-4">
                    {farmStops.map((stop: any, stopIndex: number) => {
                      const orders = Array.isArray(stop.orders) && stop.orders.length ? stop.orders : [stop];
                      const groupedOrderMap = orders.reduce((groups: Record<string, any>, order: any, orderIndex: number) => {
                        const orderNumber = String(order.orderNumber || "").trim();
                        const hasOrderNumber = orderNumber && orderNumber !== "Order reference unavailable";
                        const key = hasOrderNumber
                          ? "order-number:" + orderNumber.toLocaleLowerCase()
                          : order.orderId
                            ? "order-id:" + String(order.orderId)
                            : "collection:" + String(order.collectionId || orderIndex);
                        if (!groups[key]) groups[key] = { key, orderNumber: hasOrderNumber ? orderNumber : null, items: [] };
                        groups[key].items.push(order);
                        return groups;
                      }, {});
                      const orderGroups = Object.values(groupedOrderMap) as any[];
                      const stopStatus = String(stop.status || "pending");
                      const expansionKey = String(r.id || r.routeNumber || "route") + ":" + String(stop.farmKey || stop.collectionId || stopIndex);
                      const expanded = Boolean(expandedFarmStops[expansionKey]);
                      const panelId = "farm-orders-" + stopIndex + "-" + String(r.id || "").replace(/[^a-zA-Z0-9_-]/g, "");
                      const allCollected = orders.length > 0 && orders.every((order: any) => ["collected", "departed_farm"].includes(String(order.status || "")));
                      const allDeparted = orders.length > 0 && orders.every((order: any) => String(order.status || "") === "departed_farm");
                      const quantityEntries = orders.filter((order: any) => String(order.status || "") === "arrived_at_farm");
                      const quantitiesValid = quantityEntries.length > 0 && quantityEntries.every((order: any) =>
                        Boolean(actual[order.collectionId]) &&
                        Number.isFinite(Number(actual[order.collectionId])) &&
                        Number(actual[order.collectionId]) > 0
                      );
                      const canArrive = ["pending", "ready_for_pickup", "team_assigned", "en_route", "started"].includes(stopStatus);

                      return (
                        <section key={stop.farmKey || stop.collectionId || stopIndex} className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
                          <div className="flex flex-col gap-3 bg-emerald-50/70 p-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">{stopIndex + 1}</div>
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-slate-900">{stop.farmerName || "Farmer details unavailable"}</p>
                                <p className="mt-1 text-sm text-slate-600">{orderGroups.length} {orderGroups.length === 1 ? "order" : "orders"} · Expected {stop.quantity || 0} kg</p>
                                <p className="mt-1 flex items-start gap-1 text-xs text-slate-600"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /><span>{stop.pickupAddress || "Farm address not provided"}</span></p>
                                {stop.farmerPhone && <p className="mt-1 text-xs text-slate-600">Farm contact: <a className="font-medium text-emerald-800 underline" href={"tel:" + stop.farmerPhone}>{stop.farmerPhone}</a></p>}
                              </div>
                            </div>
                            <Badge variant="outline">{stopStatusLabel(stopStatus)}</Badge>
                          </div>

                          <div className="p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-800">Order details</p>
                                <p className="mt-0.5 text-xs text-slate-500">Expand when you are ready to check the orders and record quantities.</p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                aria-expanded={expanded}
                                aria-controls={panelId}
                                onClick={() => setExpandedFarmStops((previous) => ({ ...previous, [expansionKey]: !previous[expansionKey] }))}
                              >
                                {expanded ? "Hide orders" : "View all " + orderGroups.length + (orderGroups.length === 1 ? " order" : " orders")}
                                <ChevronDown className={"ml-2 h-4 w-4 transition-transform " + (expanded ? "rotate-180" : "")} />
                              </Button>
                            </div>

                            {expanded && (
                              <div id={panelId} className="mt-3 divide-y rounded-lg border bg-white">
                                {orderGroups.map((orderGroup: any, orderIndex: number) => (
                                  <div key={orderGroup.key} className="p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="font-semibold text-slate-900">{orderGroup.orderNumber ? "Order " + orderGroup.orderNumber : "Order " + (orderIndex + 1)}</p>
                                      {orderGroup.items.length > 1 && <span className="text-xs text-slate-500">{orderGroup.items.length} collection items</span>}
                                    </div>
                                    {orderGroup.items.map((order: any, itemIndex: number) => (
                                      <div key={order.collectionId || order.orderId || itemIndex} className="flex flex-col gap-3 border-t py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-medium text-slate-800">{order.productName || "Product details unavailable"}</p>
                                          <p className="mt-1 text-xs text-slate-600">Expected quantity: {order.quantity || 0} kg</p>
                                          {order.batchNumber && <p className="mt-1 text-xs text-slate-600">Batch / Lot: {order.batchNumber}</p>}
                                          {order.qualityGrade && <p className="mt-1 text-xs text-slate-600">Quality grade: {order.qualityGrade}</p>}
                                          {order.collectionType && <p className="mt-1 text-xs text-slate-600">Pickup type: {String(order.collectionType).replace(/_/g, " ")}</p>}
                                          {order.storageType && <p className="mt-1 text-xs text-slate-600">Storage: {String(order.storageType).replace(/_/g, " ")}</p>}
                                          <p className="mt-1 text-xs text-slate-600">Status: {stopStatusLabel(String(order.status || "pending"))}</p>
                                          {order.actualQuantity != null && <p className="mt-1 text-xs font-semibold text-emerald-700">Actual collected: {order.actualQuantity} kg</p>}
                                        </div>
                                        {r.status !== "assigned" && order.status === "arrived_at_farm" && (
                                          <div className="flex items-center gap-2 sm:w-56">
                                            <label className="shrink-0 text-xs text-slate-600">Actual kg</label>
                                            <Input
                                              className="h-9"
                                              type="number"
                                              min="0.01"
                                              step="0.01"
                                              placeholder="Enter kg *"
                                              value={actual[order.collectionId] || ""}
                                              onChange={(e) => setActual({ ...actual, [order.collectionId]: e.target.value })}
                                              aria-label={"Actual collected quantity for " + (order.orderNumber || order.productName || "order")}
                                            />
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                              {r.status !== "assigned" && canArrive && (
                                <Button variant="outline" onClick={() => act(r, "arrived_at_farm", stop.collectionId)}>
                                  <MapPin className="mr-2 h-4 w-4" /> Arrived at Farm
                                </Button>
                              )}
                              {r.status !== "assigned" && stopStatus === "arrived_at_farm" && !allCollected && !expanded && (
                                <Button variant="outline" onClick={() => setExpandedFarmStops((previous) => ({ ...previous, [expansionKey]: true }))}>
                                  <ChevronDown className="mr-2 h-4 w-4" /> View orders to enter quantities
                                </Button>
                              )}
                              {r.status !== "assigned" && expanded && quantityEntries.length > 0 && (
                                <Button
                                  disabled={!quantitiesValid}
                                  onClick={() => act(
                                    r,
                                    "collected",
                                    stop.collectionId,
                                    Object.fromEntries(quantityEntries.map((order: any) => [order.collectionId, Number(actual[order.collectionId])]))
                                  )}
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm All {orderGroups.length} Orders Collected
                                </Button>
                              )}
                              {r.status !== "assigned" && allCollected && !allDeparted && (
                                <Button onClick={() => act(r, "departed_farm", stop.collectionId)}>
                                  <Truck className="mr-2 h-4 w-4" /> Depart Farm
                                </Button>
                              )}
                              {r.status !== "assigned" && !allCollected && !canArrive && stopStatus !== "arrived_at_farm" && (
                                <p className="text-xs text-slate-500">Confirm quantities for all outstanding orders before departing this farm.</p>
                              )}
                            </div>
                          </div>
                        </section>
                      );
                    })}
                  </div>

                  {r.status === "departed_farm" && (
                    <Button className="mt-5" onClick={() => act(r, "completed")}>Complete Pickup Route</Button>
                  )}
                  {r.status === "completed" && (
                    <Button className="mt-5" onClick={() => act(r, "returned_to_warehouse")}>Mark Returned to Warehouse</Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
