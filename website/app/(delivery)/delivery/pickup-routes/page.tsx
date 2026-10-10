"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, CheckCircle2, Navigation, Hand, Warehouse, UserCheck, Lock, Truck, Briefcase } from "lucide-react";
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
    return {
      ...group,
      orders: uniqueOrders,
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
              <Hand className="h-5 w-5" /> Today's Warehouse Pickup Routes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {offers.map((r: any) => {
              const mine = r.claimState === "mine";
              const claimedByOther = r.claimState === "claimed_by_other";
              return (
                <div key={r.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold">🚚 {r.routeNumber}</p>
                      <p className="text-sm text-muted-foreground">{mergeFarmStopsForDisplay(r.stops || []).length} farms · {mergeFarmStopsForDisplay(r.stops || []).reduce((sum: number, stop: any) => sum + (stop.orderCount || stop.orders?.length || 1), 0)} orders · {mergeFarmStopsForDisplay(r.stops || []).reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0)} kg</p>
                    </div>
                    {r.claimState === "open" && (
                      <Button onClick={() => accept(r.id)}>
                        <Hand className="mr-2 h-4 w-4" /> Accept Route
                      </Button>
                    )}
                  </div>

                  {mine && (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="flex items-center gap-2 font-semibold text-emerald-800">
                        <UserCheck className="h-4 w-4" /> Route Accepted
                      </p>
                      <p className="mt-1 text-sm text-emerald-700">You accepted this route.</p>
                      <p className="mt-2 text-xs text-emerald-700">Vehicle: {r.deliveryPartnerVehicleType || "Not specified"} · {r.deliveryPartnerVehicleNumber || "Not specified"}</p>
                    </div>
                  )}

                  {claimedByOther && (
                    <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
                      <p className="flex items-center gap-2 font-semibold text-orange-800">
                        <Lock className="h-4 w-4" /> Route Accepted
                      </p>
                      <p className="mt-2 text-sm text-orange-900">
                        Accepted by: <strong>{r.deliveryPartnerName || "Another pickup partner"}</strong>
                      </p>
                      <p className="mt-1 text-sm text-orange-900">
                        🚚 {r.deliveryPartnerVehicleType || "Vehicle not specified"}
                      </p>
                      <p className="text-sm text-orange-900">
                        {r.deliveryPartnerVehicleNumber || "Vehicle number not specified"}
                      </p>
                      <p className="mt-3 text-sm font-medium text-orange-800">⛔ This route has already been accepted by {r.deliveryPartnerName || "another pickup partner"}.</p>
                      <p className="text-xs text-orange-700">You cannot accept this route.</p>
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    {mergeFarmStopsForDisplay(r.stops || []).map((s: any, i: number) => {
                      const orders = Array.isArray(s.orders) && s.orders.length ? s.orders : [s];
                      return (
                        <div key={s.farmKey || s.collectionId || i} className="rounded-lg border bg-slate-50 p-3">
                          <div className="flex items-start gap-3">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold">{s.farmerName || "Farmer details unavailable"}</p>
                              <p className="text-xs text-muted-foreground">{orders.length} {orders.length === 1 ? "order" : "orders"} · {s.quantity || 0} kg</p>
                              <p className="mt-1 text-xs text-muted-foreground">{s.pickupAddress || "Farm address not provided"}</p>
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
            {offers.length ? "Accept an available route. If another partner accepts first, you will see who accepted it and you will no longer be able to accept it." : "No active pickup routes. Unfinished routes remain visible across days; a route leaves this list only after you mark it returned to the warehouse."}
          </p>
        </Card>
      ) : (
        routes.map((r: any) => (
          <Card key={r.id}>
            <CardHeader className="border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>🚚 {r.routeNumber || "Pickup Route"}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{mergeFarmStopsForDisplay(r.stops || []).length} farm stops · {mergeFarmStopsForDisplay(r.stops || []).reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0)} kg</p>
                  <p className="mt-1 text-xs text-muted-foreground">Destination: {r.warehouseName || "Assigned warehouse"}</p>
                  {routeDayLabel(r) && <p className="mt-1 text-xs text-muted-foreground">Route date: {routeDayLabel(r)}</p>}
                  {isCarryoverRoute(r) && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>Continued from a previous day.</strong> This route stays here until you complete the pickup and mark it returned to the warehouse.</div>}
                </div>
                <Badge><CheckCircle2 className="mr-1 h-3 w-3" /> {routeStatusLabel(String(r.status || "assigned"))}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="mb-5 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                <Warehouse className="h-4 w-4" /> This route is exclusively assigned to you. Other partners cannot accept it.
              </div>
              {r.status === "assigned" && <Button className="mb-5" onClick={() => act(r, "started")}><Navigation className="mr-2 h-4 w-4" /> Start Pickup Route</Button>}
              <div className="space-y-4">
                {mergeFarmStopsForDisplay(r.stops || []).map((s: any, i: number) => {
                  const orders = Array.isArray(s.orders) && s.orders.length ? s.orders : [s];
                  const groupedCustomerOrders = orders.reduce((groups: Record<string, any>, order: any, orderIndex: number) => {
                    const readableOrderNumber = String(order.orderNumber || "").trim();
                    const usableOrderNumber = readableOrderNumber && readableOrderNumber !== "Order reference unavailable";
                    const key = usableOrderNumber
                      ? "order-number:" + readableOrderNumber.toLocaleLowerCase()
                      : order.orderId
                        ? "order-id:" + String(order.orderId)
                        : "collection:" + String(order.collectionId || orderIndex);
                    if (!groups[key]) {
                      groups[key] = { key, orderNumber: usableOrderNumber ? readableOrderNumber : null, items: [] };
                    }
                    groups[key].items.push(order);
                    return groups;
                  }, {});
                  const orderGroups = Object.values(groupedCustomerOrders) as any[];
                  const stopStatus = String(s.status || "pending");
                  const allOrdersCollected = orders.length > 0 && orders.every((order: any) => ["collected", "departed_farm"].includes(String(order.status || "")));
                  const allOrdersDeparted = orders.length > 0 && orders.every((order: any) => String(order.status || "") === "departed_farm");
                  const allQuantitiesValid = orders.length > 0 && orders.every((order: any) => {
                    const orderStatus = String(order.status || "pending");
                    if (["collected", "departed_farm"].includes(orderStatus)) {
                      return Number(order.actualQuantity) > 0;
                    }
                    return orderStatus === "arrived_at_farm" &&
                      Boolean(order.collectionId) &&
                      Boolean(actual[order.collectionId]) &&
                      Number.isFinite(Number(actual[order.collectionId])) &&
                      Number(actual[order.collectionId]) > 0;
                  });
                  const canArriveAtFarm = ["pending", "ready_for_pickup", "team_assigned", "en_route", "started"].includes(stopStatus);
                  return (
                    <div key={s.farmKey || s.collectionId || i} className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
                      <div className="flex flex-col gap-3 bg-emerald-50/70 p-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">{i + 1}</div>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{s.farmerName || "Farmer details unavailable"}</p>
                            <p className="mt-1 text-sm text-slate-600">{orderGroups.length} {orderGroups.length === 1 ? "order" : "orders"}{orders.length !== orderGroups.length ? ` · ${orders.length} collection items` : ""} · Expected {s.quantity || 0} kg</p>
                            <p className="mt-1 flex items-start gap-1 text-xs text-slate-600"><MapPin className="mt-0.5 h-3 w-3 shrink-0" />{s.pickupAddress || "Farm address not provided"}</p>
                          </div>
                        </div>
                        <Badge variant="outline">{stopStatusLabel(stopStatus)}</Badge>
                      </div>

                      <div className="space-y-3 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-800">Orders from this farm</p>
                          <span className="text-xs text-slate-500">{orderGroups.length} {orderGroups.length === 1 ? "order" : "orders"}</span>
                        </div>

                        <div className="divide-y rounded-lg border bg-white">
                          {orderGroups.map((orderGroup: any, orderIndex: number) => (
                            <div key={orderGroup.key} className="p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold text-slate-900">
                                  {orderGroup.orderNumber
                                    ? "Order " + orderGroup.orderNumber
                                    : "Order " + (orderIndex + 1)}
                                </p>
                                {orderGroup.items.length > 1 && (
                                  <span className="text-xs text-slate-500">{orderGroup.items.length} items</span>
                                )}
                              </div>
                              <div className="mt-2 divide-y">
                                {orderGroup.items.map((order: any, itemIndex: number) => (
                                  <div key={order.collectionId || order.orderId || itemIndex} className="flex flex-col gap-2 py-2 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm text-slate-800">{order.productName || "Product details unavailable"}</p>
                                      <p className="mt-0.5 text-xs text-slate-500">
                                        Expected {order.quantity || 0} kg
                                        {order.batchNumber ? " · Batch / Lot: " + order.batchNumber : ""}
                                      </p>
                                      {order.actualQuantity != null && (
                                        <p className="mt-0.5 text-xs font-medium text-emerald-700">Collected {order.actualQuantity} kg</p>
                                      )}
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
                                          onChange={e => setActual({ ...actual, [order.collectionId]: e.target.value })}
                                          aria-label={"Actual quantity for " + (order.orderNumber || order.productName || "order")}
                                        />
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                          {r.status !== "assigned" && canArriveAtFarm && (
                            <Button variant="outline" onClick={() => act(r, "arrived_at_farm", s.collectionId)}>
                              <MapPin className="mr-2 h-4 w-4" /> Arrived at Farm
                            </Button>
                          )}
                          {r.status !== "assigned" && stopStatus === "arrived_at_farm" && !allOrdersCollected && (
                            <Button
                              disabled={!allQuantitiesValid}
                              onClick={() => act(
                                r,
                                "collected",
                                s.collectionId,
                                Object.fromEntries(orders.filter((order: any) => String(order.status || "") === "arrived_at_farm").map((order: any) => [order.collectionId, Number(actual[order.collectionId])]))
                              )}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4" /> Confirm All {orderGroups.length} Orders Collected
                            </Button>
                          )}
                          {r.status !== "assigned" && allOrdersCollected && !allOrdersDeparted && (
                            <Button onClick={() => act(r, "departed_farm", s.collectionId)}>
                              <Truck className="mr-2 h-4 w-4" /> Depart Farm
                            </Button>
                          )}
                          {r.status !== "assigned" && !allOrdersCollected && !canArriveAtFarm && stopStatus !== "arrived_at_farm" && (
                            <p className="text-xs text-slate-500">Confirm the quantities for the outstanding orders before departing this farm.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {r.status === "departed_farm" && <Button className="mt-5" onClick={() => act(r, "completed")}>Complete Pickup Route</Button>}
              {r.status === "completed" && <Button className="mt-5" onClick={() => act(r, "returned_to_warehouse")} >Mark Returned to Warehouse</Button>}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
