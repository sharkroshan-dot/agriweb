"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, CheckCircle2, Navigation, Hand, Warehouse, UserCheck, Lock, Truck, Briefcase, ChevronDown, Clock } from "lucide-react";
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
  const value = route.routeDate || route.createdAt || route.assignedAt || route.scheduledAt;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const routeDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return routeDay < todayDay;
};

const isPickupCompleted = (item: any) => {
  // Some APIs expose warehouse handover as "received" on the route/order,
  // while older pickup routes use returned_to_warehouse or arrived_warehouse.
  // All of these confirm the partner's work reached the warehouse; "completed"
  // alone is deliberately excluded because it can mean farm collection only.
  const status = String(item?.status || item?.orderStatus || item?.collectionStatus || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  return [
    "received",
    "warehouse_received",
    "received_at_warehouse",
    "arrived_warehouse",
    "returned_to_warehouse",
    "stored",
  ].includes(status);
};

const isTransferCompleted = (item: any) =>
  // Use the driver's actual arrival statuses only. Downstream receipt or a
  // generic "completed" status must not mark this transfer leg complete.
  ["arrived_at_destination", "arrived_at_hub"].includes(String(item?.status || "").toLowerCase());

// Customer last-mile deliveries belong in My Deliveries / Delivery History,
// never in the farm-to-warehouse pickup workspace. Some legacy API responses
// can include delivered customer orders in the pickup route feed, so filter
// by both explicit workflow metadata and terminal delivery statuses.
const isCustomerDeliveryRecord = (item: any) => {
  const workflowFields = [
    item?.workflowType, item?.workflow, item?.assignmentType,
    item?.jobType, item?.deliveryType, item?.fulfillmentType,
  ].map((value) => String(value || "").toLowerCase().replace(/[ -]+/g, "_"));
  if (workflowFields.some((value) => ["customer_delivery", "last_mile_delivery", "business_delivery", "b2b_delivery"].includes(value))) return true;
  const terminalDeliveryStatuses = new Set(["delivered", "delivery_completed", "completed_delivery", "delivered_to_customer", "delivered_to_business"]);
  const routeStatus = String(item?.status || item?.routeStatus || item?.deliveryStatus || "").toLowerCase().replace(/[ -]+/g, "_");
  if (terminalDeliveryStatuses.has(routeStatus)) return true;
  const nestedOrders = (Array.isArray(item?.orders) ? item.orders : []).concat(
    ...(Array.isArray(item?.stops) ? item.stops.map((stop: any) => Array.isArray(stop?.orders) ? stop.orders : [stop]) : [])
  );
  return nestedOrders.length > 0 && nestedOrders.every((order: any) => {
    const status = String(order?.deliveryStatus || order?.status || order?.orderStatus || "").toLowerCase().replace(/[ -]+/g, "_");
    return terminalDeliveryStatuses.has(status);
  });
};

const routeDateValue = (item: any, workflow: "pickup" | "transfer" = "pickup") => {
  if (workflow === "pickup" && isPickupCompleted(item)) {
    return item?.warehouseArrivalAt || item?.arrivedWarehouseAt || item?.warehouseArrivedAt || item?.returnedAt || item?.completedAt || item?.updatedAt || item?.routeDate || item?.createdAt;
  }
  if (workflow === "transfer" && isTransferCompleted(item)) {
    // These names match the timestamps written by the delivery API.
    return item?.arrivedAtDestination || item?.arrivedAtHubAt || item?.arrivedAtHub || item?.arrivedAt || item?.updatedAt || item?.routeDate || item?.createdAt;
  }
  return item?.routeDate || item?.scheduledAt || item?.assignedAt || item?.createdAt || item?.date;
};

const isInDatePeriod = (item: any, period: "today" | "yesterday", workflow: "pickup" | "transfer" = "pickup") => {
  const value = routeDateValue(item, workflow);
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = period === "today"
    ? todayStart
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = period === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    : todayStart;
  return date >= start && date < end;
};

const uniqueById = (items: any[]) => {
  const seen = new Set<string>();
  return (items || []).filter((item: any, index: number) => {
    const id = String(item?.id || item?._id || item?.routeId || item?.jobId || "");
    const key = id || "row:" + index;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
      const orderNumber = String(order.orderNumber || order.orderNo || order.b2bOrderNumber || order.b2bOrderId || order.orderId || "").trim();
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
  const [routeView, setRouteView] = useState<"pickup" | "transfers" | "b2b">("pickup");
  const [selectedRouteId, setSelectedRouteId] = useState<string>("");
  const [datePeriod, setDatePeriod] = useState<"today" | "yesterday">("today");
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
  const hubTransfersQ = useQuery({
    queryKey: ["myFarmerFulfillmentHubTransfers"],
    queryFn: () => api.get("/delivery/me/farmer-fulfillment-hub-transfers"),
    refetchInterval: 5000,
  });
  const warehouseTransfersQ = useQuery({
    queryKey: ["myFarmerFulfillmentWarehouseTransfers"],
    queryFn: () => api.get("/delivery/me/farmer-fulfillment-warehouse-transfers"),
    refetchInterval: 5000,
  });
  const b2bDeliveriesQ = useQuery({
    queryKey: ["myAssignedB2BDeliveries"],
    queryFn: () => api.get("/delivery/me/b2b-delivery-orders"),
    refetchInterval: 5000,
  });
  const [b2bProof, setB2bProof] = useState<Record<string, string>>({});
  const [actual, setActual] = useState<Record<string, string>>({});
  const [expandedFarmStops, setExpandedFarmStops] = useState<Record<string, boolean>>({});
  const marketplaceQ = useQuery({
    queryKey: ["warehousePickupJobs"],
    queryFn: () => api.get("/delivery/me/pickup-jobs"),
    refetchInterval: 5000,
  });
  const allOffers = offersQ.data?.data?.routes || [];
  const allRoutes = routesQ.data?.data?.routes || [];
  const allPickupJobs = marketplaceQ.data?.data?.openJobs || [];
  const allAcceptedPickupJobs = marketplaceQ.data?.data?.acceptedJobs || [];
  const allHubTransfers = hubTransfersQ.data?.data?.transfers || [];
  const allWarehouseTransfers = warehouseTransfersQ.data?.data?.transfers || [];
  const b2bDeliveries = b2bDeliveriesQ.data?.data?.orders || [];

  // Keep unfinished routes from earlier days visible while viewing Today so a
  // delivery partner cannot lose sight of work that still needs handover.
  // Once the warehouse handover is recorded, the farm pickup route leaves
  // the active route workspace and is shown in Pickup History instead.
  const routes = allRoutes.filter((item: any) => {
    if (isCustomerDeliveryRecord(item) || isPickupCompleted(item)) return false;
    return isInDatePeriod(item, datePeriod, "pickup") ||
      (datePeriod === "today" && isCarryoverRoute(item));
  });
  const selectedRoute = routes.find((item: any) => String(item.id || item._id) === selectedRouteId) || routes[0] || null;
  // The offers endpoint can return a stale open copy of an order whose valid route
  // is already assigned and visible in My Routes. Match by route ID AND stable
  // business identifiers because legacy duplicate documents may have different Mongo IDs.
  const normalizeRouteKey = (value: any) => String(value ?? "").trim().toLocaleLowerCase();
  const routeBusinessKeys = (route: any) => {
    const keys = new Set<string>();
    const add = (value: any) => {
      const normalized = normalizeRouteKey(value);
      if (normalized && normalized !== "order reference unavailable" && normalized !== "undefined" && normalized !== "null") {
        keys.add(normalized);
      }
    };
    add(route?.id);
    add(route?._id);
    add(route?.routeNumber);
    add(route?.b2bOrderId);
    add(route?.orderNumber);
    add(route?.orderNo);
    for (const id of route?.orderIds || []) add(id);
    for (const stop of route?.stops || []) {
      add(stop?.b2bOrderId);
      add(stop?.orderNumber);
      add(stop?.orderNo);
      add(stop?.orderId);
      for (const order of stop?.orders || []) {
        add(order?.b2bOrderId);
        add(order?.orderNumber);
        add(order?.orderNo);
        add(order?.orderId);
      }
    }
    return keys;
  };
  const activeRouteKeys = new Set<string>();
  for (const route of allRoutes) {
    // Suppress stale duplicate offers while the same business order is assigned,
    // in progress, completed, or already handed over to the warehouse. Otherwise
    // a returned route can reappear as a new offer and fail capacity checks.
    if (["assigned", "started", "arrived_at_farm", "collected", "departed_farm", "completed", "returned_to_warehouse", "arrived_warehouse", "warehouse_received", "received", "stored"].includes(
      normalizeRouteKey(route?.status)
    )) {
      for (const key of routeBusinessKeys(route)) activeRouteKeys.add(key);
    }
  }
  const offers = allOffers.filter((item: any) => {
    if (isCustomerDeliveryRecord(item) || !isInDatePeriod(item, datePeriod, "pickup")) return false;
    if (normalizeRouteKey(item?.status || "offered") !== "offered") return true;
    const keys = routeBusinessKeys(item);
    return !Array.from(keys).some((key) => activeRouteKeys.has(key));
  });
  const pickupJobs = allPickupJobs.filter((item: any) => !isCustomerDeliveryRecord(item) && isInDatePeriod(item, datePeriod, "pickup"));
  const acceptedPickupJobs = allAcceptedPickupJobs.filter((item: any) =>
    !isCustomerDeliveryRecord(item) && !isPickupCompleted(item) && (
      isInDatePeriod(item, datePeriod, "pickup") ||
      (datePeriod === "today" && isCarryoverRoute(item))
    )
  );
  const hubTransfers = allHubTransfers.filter((item: any) => isInDatePeriod(item, datePeriod, "transfer"));
  const warehouseTransfers = allWarehouseTransfers.filter((item: any) => isInDatePeriod(item, datePeriod, "transfer"));

  // The same route can appear in both "My Routes" and the offers feed.
  // Count each actual route once; pickup jobs are stops/orders within routes,
  // not additional routes, so they must not inflate these summary totals.
  // Offers can include routes already claimed by another partner. Only count
  // offers still open to claim, plus the routes assigned to this partner.
  const openOffers = offers.filter((item: any) => String(item?.status || "offered").toLowerCase() === "offered");
  const summaryPickupRoutes = uniqueById([...routes, ...openOffers]).filter((item: any) =>
    isInDatePeriod(item, datePeriod, "pickup") ||
    (datePeriod === "today" && isCarryoverRoute(item) && !isPickupCompleted(item))
  );
  const isPickupInProgress = (item: any) =>
    ["started", "arrived_at_farm", "collected", "departed_farm", "pickup_in_progress"].includes(normalizeRouteKey(item?.status));
  const pickupInProgressCount = summaryPickupRoutes.filter(isPickupInProgress).length;
  const pickupCompletedCount = summaryPickupRoutes.filter(isPickupCompleted).length;
  const pickupPendingCount = Math.max(0, summaryPickupRoutes.length - pickupInProgressCount - pickupCompletedCount);

  // Count each transfer once across the two route categories and use the
  // driver's arrival state, not a downstream warehouse/hub receipt state.
  const summaryTransfers = uniqueById([...warehouseTransfers, ...hubTransfers]);
  const isTransferInProgress = (item: any) =>
    ["started", "picked_up", "collected", "departed_source", "in_transit", "transfer_in_progress", "out_for_delivery"].includes(normalizeRouteKey(item?.status));
  const transferInProgressCount = summaryTransfers.filter(isTransferInProgress).length;
  const transferCompletedCount = summaryTransfers.filter(isTransferCompleted).length;
  const transferPendingCount = Math.max(0, summaryTransfers.length - transferInProgressCount - transferCompletedCount);
  // B2B deliveries have their own lifecycle and are counted separately from
  // farm pickups and warehouse transfers.
  const b2bCompletedCount = b2bDeliveries.filter((order: any) =>
    ["delivered", "completed", "delivered_to_business"].includes(String(order.status || "").toLowerCase())
  ).length;
  const b2bInProgressCount = b2bDeliveries.filter((order: any) =>
    ["in_transit", "out_for_delivery", "delivery_started"].includes(String(order.status || "").toLowerCase()) ||
    Boolean(order.finalDeliveryStartedAt)
  ).length;
  const b2bPendingCount = Math.max(0, b2bDeliveries.length - b2bCompletedCount - b2bInProgressCount);
  const overduePickupCount = datePeriod === "today"
    ? allRoutes.filter((item: any) => isCarryoverRoute(item) && !isPickupCompleted(item) && !isInDatePeriod(item, "today")).length
    : 0;

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

  const actOnWarehouseTransfer = async (transfer:any,status:"started"|"arrived_at_destination") => {
    try {
      await api.put("/delivery/me/farmer-fulfillment-warehouse-transfers/"+transfer.id+"/status", undefined, {params:{status}});
      toast.success(status==="started"?"Warehouse-to-warehouse transfer started":"Arrival at destination warehouse recorded. Warehouse staff must confirm receipt.");
      await warehouseTransfersQ.refetch();
    } catch(e:any) {
      toast.error(e?.message || "Unable to update warehouse transfer");
    }
  };

  const actOnB2BDelivery = async (order:any,status:"started"|"delivered") => {
    try {
      const proof = String(b2bProof[order.id] || "").trim();
      if (status === "delivered" && !proof) {
        toast.error("Enter delivery proof or recipient handoff notes before completing this B2B delivery.");
        return;
      }
      await api.put("/delivery/me/b2b-delivery-orders/"+order.id+"/status", undefined, {
        params: { status, ...(status === "delivered" ? { proof } : {}) },
      });
      toast.success(status === "started" ? "B2B delivery started" : "B2B order delivered to business");
      await b2bDeliveriesQ.refetch();
    } catch (e:any) {
      toast.error(e?.message || "Unable to update B2B delivery");
    }
  };

  const actOnHubTransfer = async (transfer:any,status:"started"|"arrived_at_hub") => {
    try {
      await api.put("/delivery/me/farmer-fulfillment-hub-transfers/"+transfer.id+"/status", undefined, {params:{status}});
      toast.success(status==="started"?"Warehouse-to-hub transfer started":"Arrival at local hub recorded. Hub staff must confirm receipt.");
      await hubTransfersQ.refetch();
    } catch(e:any) {
      toast.error(e?.message || "Unable to update local-hub transfer");
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
      <header className="relative isolate min-h-[150px] overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-sky-50 to-emerald-50 shadow-sm sm:min-h-[172px]">
        <div aria-hidden="true" className="absolute inset-y-0 right-0 -z-10 w-full bg-cover bg-center opacity-95 sm:w-[72%]" style={{ backgroundImage: "url('/images/farm-pickup-routes-banner.svg')" }} />
        <div className="absolute inset-0 -z-0 bg-gradient-to-r from-white via-white/90 to-white/10" />
        <div className="relative z-10 flex min-h-[150px] flex-col justify-center gap-4 px-5 py-5 sm:min-h-[172px] sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex min-w-0 items-center gap-4">
            <div className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white shadow-md sm:flex"><Route className="h-9 w-9" /></div>
            <div className="max-w-2xl min-w-0">
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.13em] text-emerald-800 sm:text-sm">Delivery Partner Operations</p>
              <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl">{routeView === "pickup" ? "Farm Pickup Routes" : routeView === "transfers" ? "Warehouse Transfer Routes" : "B2B Business Deliveries"}</h1>
              <p className="mt-2 max-w-xl text-sm leading-5 text-slate-700 sm:text-base sm:leading-6">
                {routeView === "pickup" ? "Collect packed orders from farms and deliver sealed shipments to the assigned warehouse." : routeView === "transfers" ? "Move sealed shipments between warehouses or from a warehouse to the assigned local hub." : "Deliver assigned business orders and record the recipient handover."}
              </p>
            </div>
          </div>
        </div>
      </header>



      <section aria-labelledby="route-activity-heading" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 bg-gradient-to-r from-white to-emerald-50/60 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <h2 id="route-activity-heading" className="text-lg font-bold tracking-tight text-slate-950">Route Activity</h2>
              <p className="mt-1 text-sm text-slate-600">Track pending and completed work across your pickup and transfer routes.</p>
            </div>
          </div>
          <div className="inline-flex w-fit items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <Button type="button" size="sm" variant={datePeriod === "today" ? "default" : "ghost"} className={datePeriod === "today" ? "rounded-lg bg-emerald-700 px-4 text-white shadow-sm hover:bg-emerald-800" : "rounded-lg px-4 text-slate-600"} onClick={() => setDatePeriod("today")} aria-pressed={datePeriod === "today"}>Today</Button>
            <Button type="button" size="sm" variant={datePeriod === "yesterday" ? "default" : "ghost"} className={datePeriod === "yesterday" ? "rounded-lg bg-emerald-700 px-4 text-white shadow-sm hover:bg-emerald-800" : "rounded-lg px-4 text-slate-600"} onClick={() => setDatePeriod("yesterday")} aria-pressed={datePeriod === "yesterday"}>Yesterday</Button>
          </div>
        </div>

        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3">
          <article className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
            <div className="flex items-center justify-between gap-3 bg-emerald-50/80 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm"><Route className="h-5 w-5" /></div>
                <div><h3 className="text-sm font-bold text-emerald-950">Farm Pickup Routes</h3><p className="text-xs text-emerald-800">Farm to assigned warehouse</p></div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">Pickup</span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                <div className="flex items-center gap-1.5 text-amber-700"><Clock className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">Pending</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{pickupPendingCount}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                <div className="flex items-center gap-1.5 text-blue-700"><Truck className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">In progress</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{pickupInProgressCount}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                <div className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">Completed</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{pickupCompletedCount}</p>
              </div>
            </div>
            {overduePickupCount > 0 && datePeriod === "today" && <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"><Clock className="mt-0.5 h-4 w-4 shrink-0"/><span>{overduePickupCount} unfinished route(s) from earlier days remain visible below.</span></div>}
          </article>

          <article className="overflow-hidden rounded-xl border border-blue-200 bg-white">
            <div className="flex items-center justify-between gap-3 bg-blue-50/80 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm"><Truck className="h-5 w-5" /></div>
                <div><h3 className="text-sm font-bold text-blue-950">Warehouse Transfer Routes</h3><p className="text-xs text-blue-800">Warehouse to warehouse / local hub</p></div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 ring-1 ring-blue-200">Transfer</span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                <div className="flex items-center gap-1.5 text-amber-700"><Clock className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">Pending</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{transferPendingCount}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                <div className="flex items-center gap-1.5 text-blue-700"><Truck className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">In progress</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{transferInProgressCount}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                <div className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">Completed</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{transferCompletedCount}</p>
              </div>
            </div>
          </article>

          <article className="overflow-hidden rounded-xl border border-violet-200 bg-white">
            <div className="flex items-center justify-between gap-3 bg-violet-50/80 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-violet-700 shadow-sm"><Briefcase className="h-5 w-5" /></div>
                <div><h3 className="text-sm font-bold text-violet-950">B2B Business Deliveries</h3><p className="text-xs text-violet-800">Warehouse to business buyer</p></div>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 ring-1 ring-violet-200">B2B</span>
            </div>
            <div className="grid grid-cols-3 gap-2 p-4">
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                <div className="flex items-center gap-1.5 text-amber-700"><Clock className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">Pending</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{b2bPendingCount}</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
                <div className="flex items-center gap-1.5 text-blue-700"><Truck className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">In progress</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{b2bInProgressCount}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                <div className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4"/><span className="text-[11px] font-semibold uppercase tracking-wide">Completed</span></div>
                <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{b2bCompletedCount}</p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        <Button
          type="button"
          variant={routeView === "pickup" ? "default" : "outline"}
          className={routeView === "pickup" ? "h-12 rounded-xl bg-emerald-700 text-sm font-semibold shadow-sm hover:bg-emerald-800 sm:text-base" : "h-12 rounded-xl border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-emerald-50 sm:text-base"}
          onClick={() => setRouteView("pickup")}
          aria-pressed={routeView === "pickup"}
        >
          <Route className="mr-2 h-5 w-5" /> Farm Pickup Routes
          <Badge className="ml-2" variant={routeView === "pickup" ? "secondary" : "outline"}>{pickupJobs.length + acceptedPickupJobs.length + offers.length + routes.length}</Badge>
        </Button>
        <Button
          type="button"
          variant={routeView === "transfers" ? "default" : "outline"}
          className={routeView === "transfers" ? "h-12 rounded-xl bg-emerald-700 text-sm font-semibold shadow-sm hover:bg-emerald-800 sm:text-base" : "h-12 rounded-xl border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-emerald-50 sm:text-base"}
          onClick={() => setRouteView("transfers")}
          aria-pressed={routeView === "transfers"}
        >
          <Truck className="mr-2 h-5 w-5" /> Warehouse Transfer Routes
          <Badge className="ml-2" variant={routeView === "transfers" ? "secondary" : "outline"}>{warehouseTransfers.length + hubTransfers.length}</Badge>
        </Button>
        <Button
          type="button"
          variant={routeView === "b2b" ? "default" : "outline"}
          className={routeView === "b2b" ? "h-12 rounded-xl bg-emerald-700 text-sm font-semibold shadow-sm hover:bg-emerald-800 sm:text-base" : "h-12 rounded-xl border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-emerald-50 sm:text-base"}
          onClick={() => setRouteView("b2b")}
          aria-pressed={routeView === "b2b"}
        >
          <Truck className="mr-2 h-5 w-5" /> B2B Business Deliveries
          <Badge className="ml-2" variant={routeView === "b2b" ? "secondary" : "outline"}>{b2bDeliveries.length}</Badge>
        </Button>
      </div>

      {routeView === "b2b" && (
        <section className="space-y-4">
          <Card className="border-emerald-200">
            <CardHeader className="border-b bg-emerald-50/70">
              <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-5 w-5"/>B2B Business Deliveries</CardTitle>
              <p className="text-sm text-muted-foreground">Only B2B orders assigned to your delivery-partner account appear here. Farm pickups and warehouse transfers remain in their own sections.</p>
            </CardHeader>
            <CardContent className="space-y-3 p-5">
              {b2bDeliveriesQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading assigned B2B deliveries…</p>
              ) : b2bDeliveries.length === 0 ? (
                <div className="py-8 text-center">
                  <Truck className="mx-auto h-9 w-9 text-slate-400"/>
                  <h3 className="mt-3 font-semibold">No assigned B2B business deliveries</h3>
                  <p className="mt-1 text-sm text-muted-foreground">When a warehouse assigns and dispatches a B2B order to you, it will appear here.</p>
                  <Button className="mt-4" variant="outline" onClick={() => void b2bDeliveriesQ.refetch()}>Refresh B2B Deliveries</Button>
                </div>
              ) : b2bDeliveries.map((order:any) => (
                <div key={order.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="font-semibold">Order {order.orderNumber || order.id}</p>
                      <p className="text-sm text-muted-foreground">{order.productName || "B2B order"} · {order.quantityKg ?? "—"} kg</p>
                      <p className="text-sm text-muted-foreground">Business: {order.businessName || "Business buyer"}</p>
                      <p className="text-sm text-muted-foreground">Delivery address: {typeof order.deliveryAddress === "string" ? order.deliveryAddress : [order.deliveryAddress?.addressLine1, order.deliveryAddress?.address_line1, order.deliveryAddress?.street, order.deliveryAddress?.city, order.deliveryAddress?.district, order.deliveryAddress?.state, order.deliveryAddress?.pincode].filter(Boolean).join(", ") || "Address not recorded"}</p>
                      <p className="text-sm">Status: <span className="font-medium">{String(order.status || "in_transit").replace(/_/g," ")}</span></p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {order.status === "in_transit" && !order.finalDeliveryStartedAt && <Button onClick={() => actOnB2BDelivery(order,"started")}><Truck className="mr-2 h-4 w-4"/>Start Delivery</Button>}
                      {order.status === "in_transit" && <Button variant="outline" onClick={() => void b2bDeliveriesQ.refetch()}>Refresh Status</Button>}
                      {order.status === "delivered" && <Badge variant="outline">Delivered</Badge>}
                    </div>
                  </div>
                  {order.status === "in_transit" && (
                    <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
                      <label className="block text-sm font-medium">Delivery proof / recipient handoff notes</label>
                      <Input value={b2bProof[order.id] || ""} onChange={e => setB2bProof(previous => ({...previous,[order.id]:e.target.value}))} placeholder="Recipient name, handoff notes, proof reference"/>
                      <Button onClick={() => actOnB2BDelivery(order,"delivered")}><CheckCircle2 className="mr-2 h-4 w-4"/>Confirm Delivered to Business</Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {routeView === "transfers" && (
        <>
      {warehouseTransfers.length === 0 && hubTransfers.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Truck className="mx-auto h-10 w-10 text-slate-400" />
            <h3 className="mt-3 font-semibold text-slate-900">No transfers for {datePeriod}</h3>
            <p className="mt-1 text-sm text-muted-foreground">Transfers assigned to your delivery-partner account appear here. Check Today/Yesterday or confirm that the warehouse assigned the transfer to your account.</p>
            <Button className="mt-4" variant="outline" onClick={() => { void Promise.all([warehouseTransfersQ.refetch(), hubTransfersQ.refetch()]); }}>Refresh transfers</Button>
          </CardContent>
        </Card>
      )}

      {warehouseTransfers.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="border-b bg-amber-50/70">
            <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-5 w-5"/>Warehouse → Destination Warehouse Transfers</CardTitle>
            <p className="text-sm text-muted-foreground">Start the assigned inter-district route and confirm physical arrival. The destination warehouse must then confirm receipt before the order can move to the local hub.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {warehouseTransfers.map((transfer:any)=>(
              <div key={transfer.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold">Order {transfer.orderNumber || transfer.orderId}</p>
                    <p className="text-sm text-muted-foreground">From: {transfer.sourceWarehouseName || "Source warehouse"}</p>
                    <p className="text-sm text-muted-foreground">To: {transfer.destinationWarehouseName || "Destination warehouse"}</p>
                    <p className="text-sm text-muted-foreground">Status: {String(transfer.status||"assigned").replace(/_/g," ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {transfer.status==="assigned"&&<Button onClick={()=>actOnWarehouseTransfer(transfer,"started")}><Navigation className="mr-2 h-4 w-4"/>Start Transfer</Button>}
                    {transfer.status==="in_transit"&&<Button onClick={()=>actOnWarehouseTransfer(transfer,"arrived_at_destination")}><MapPin className="mr-2 h-4 w-4"/>Arrived at Destination Warehouse</Button>}
                    {transfer.status==="arrived_at_destination"&&<Badge variant="outline">Waiting for warehouse receipt</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {hubTransfers.length > 0 && (
        <Card className="border-indigo-200">
          <CardHeader className="border-b bg-indigo-50/70">
            <CardTitle className="flex items-center gap-2 text-base"><Warehouse className="h-5 w-5"/>Warehouse → Local Hub Transfers</CardTitle>
            <p className="text-sm text-muted-foreground">Transport the sealed order to its assigned local hub. Record departure and physical arrival; the hub must separately confirm receipt.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {hubTransfers.map((transfer:any)=>(
              <div key={transfer.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold">Order {transfer.orderNumber || transfer.orderId}</p>
                    <p className="text-sm text-muted-foreground">Destination: {transfer.localHubName || "Assigned local hub"}</p>
                    <p className="text-sm text-muted-foreground">Quantity: {transfer.quantity ?? "See sealed manifest"} · Status: {String(transfer.status||"assigned").replace(/_/g," ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {transfer.status==="assigned"&&<Button onClick={()=>actOnHubTransfer(transfer,"started")}><Navigation className="mr-2 h-4 w-4"/>Start Transfer</Button>}
                    {["in_transit","started"].includes(String(transfer.status))&&<Button onClick={()=>actOnHubTransfer(transfer,"arrived_at_hub")}><MapPin className="mr-2 h-4 w-4"/>Arrived at Local Hub</Button>}
                    {transfer.status==="arrived_at_hub"&&<Badge variant="outline">Waiting for hub receipt</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

        </>
      )}

      {routeView === "pickup" && (
        <>
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
                              <p className="text-sm font-medium">{order.orderNumber || order.orderNo || order.b2bOrderNumber ? "Order " + (order.orderNumber || order.orderNo || order.b2bOrderNumber) : order.b2bOrderId || order.orderId ? "B2B Order " + String(order.b2bOrderId || order.orderId).slice(-8).toUpperCase() : "Order " + (orderIndex + 1)}</p>
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
        <Card className="border-dashed border-emerald-200 bg-white">
          <CardContent className="px-6 py-14 text-center">
            <Route className="mx-auto h-12 w-12 text-emerald-700" />
            <h2 className="mt-4 text-lg font-bold text-slate-900">{offers.length ? "No route assigned yet" : "No pickup route assigned"}</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{offers.length ? "Accept an available route to add it to your pickup workspace." : "New routes assigned by the warehouse will appear here. Unfinished routes remain visible until warehouse handover is complete."}</p>
            <Button className="mt-5 bg-emerald-700 hover:bg-emerald-800" onClick={() => { void Promise.all([routesQ.refetch(), offersQ.refetch()]); }}>Refresh Routes</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="h-fit overflow-hidden border-slate-200">
            <CardHeader className="border-b bg-white px-4 py-4">
              <div className="flex items-center justify-between"><CardTitle className="text-base">My Farm Pickup Routes</CardTitle><Badge variant="outline">{routes.length} active</Badge></div>
              <p className="text-xs text-slate-500">Choose a route to view its map, farms and collection details</p>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              {routes.map((route: any) => {
                const stops = mergeFarmStopsForDisplay(route.stops || []);
                const qty = stops.reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0);
                const orders = stops.reduce((sum: number, stop: any) => sum + (stop.orderCount || stop.orders?.length || 1), 0);
                const active = String(selectedRoute?.id || selectedRoute?._id) === String(route.id || route._id);
                return (
                  <button key={route.id || route._id} type="button" onClick={() => setSelectedRouteId(String(route.id || route._id))} aria-pressed={active}
                    className={"w-full rounded-xl border p-4 text-left transition " + (active ? "border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-200" : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 gap-2.5"><span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg " + (active ? "bg-emerald-700 text-white" : "bg-emerald-50 text-emerald-700")}><MapPin className="h-4 w-4"/></span>
                        <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{route.routeName || route.routeNumber || "Farm Pickup Route"}</p><p className="mt-1 truncate text-xs text-slate-500">{route.routeNumber || route.id || "Assigned route"}</p></div></div>
                      <Badge variant={route.status === "assigned" ? "success" : "outline"}>{routeStatusLabel(String(route.status || "assigned"))}</Badge>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-200 py-3">
                      <div><p className="text-[11px] text-slate-500">Farms</p><p className="text-sm font-bold">{stops.length}</p></div>
                      <div><p className="text-[11px] text-slate-500">Orders</p><p className="text-sm font-bold">{orders}</p></div>
                      <div><p className="text-[11px] text-slate-500">Load</p><p className="text-sm font-bold">{qty} kg</p></div>
                    </div>
                    <p className="mt-3 flex items-center gap-1.5 truncate text-xs text-slate-600"><Warehouse className="h-3.5 w-3.5 text-emerald-700"/>{route.warehouseName || "Assigned warehouse"}</p>
                    {routeDayLabel(route) && <p className="mt-2 text-[11px] text-slate-500">Route date: {routeDayLabel(route)}</p>}
                    {isCarryoverRoute(route) && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">Continued from an earlier day</p>}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {selectedRoute && (() => {
            const r = selectedRoute;
            const farmStops = mergeFarmStopsForDisplay(r.stops || []);
            const totalOrders = farmStops.reduce((sum: number, stop: any) => sum + (stop.orderCount || stop.orders?.length || 1), 0);
            const totalQuantity = farmStops.reduce((sum: number, stop: any) => sum + Number(stop.quantity || 0), 0);
            const addresses = farmStops.map((stop: any) => stop.pickupAddress).filter((v: any) => typeof v === "string" && v.trim());
            const wh = r.warehouseAddress || r.destinationAddress || r.warehouseLocation?.address || r.warehouseLocation;
            const destination = typeof wh === "string" ? wh : wh?.address || wh?.formattedAddress || "";
            const locations = [...addresses, ...(destination ? [destination] : [])];
            const mapUrl = locations.length > 1 ? "https://www.google.com/maps?output=embed&saddr=" + encodeURIComponent(locations[0]) + "&daddr=" + encodeURIComponent(locations[locations.length - 1]) + (locations.length > 2 ? "&waypoints=" + encodeURIComponent(locations.slice(1, -1).join("|")) : "") : "";
            const dateValue = r.scheduledAt || r.routeDate || r.collectionDate || r.createdAt;
            const scheduleDate = dateValue && !Number.isNaN(new Date(dateValue).getTime()) ? new Intl.DateTimeFormat("en-IN", {day:"2-digit",month:"short",year:"numeric"}).format(new Date(dateValue)) : routeDayLabel(r);
            return (
              <Card className="min-w-0 overflow-hidden border-slate-200">
                <CardHeader className="border-b bg-white px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-xl">{r.routeName || r.routeNumber || "Farm Pickup Route"}</CardTitle><Badge variant={r.status === "assigned" ? "success" : "outline"}>{routeStatusLabel(String(r.status || "assigned"))}</Badge></div>
                      <p className="mt-1 text-sm text-slate-500">Route ID: {r.routeNumber || r.id || r._id}</p><p className="mt-2 flex items-center gap-1.5 text-sm text-slate-600"><Warehouse className="h-4 w-4 text-emerald-700"/>{r.warehouseName || "Assigned warehouse"}</p></div>
                    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => window.location.assign("/delivery/orders")}><Briefcase className="mr-2 h-4 w-4"/>View Orders</Button>{r.warehousePhone && <Button size="sm" variant="outline" onClick={() => window.location.href = "tel:" + r.warehousePhone}><Warehouse className="mr-2 h-4 w-4"/>Contact Warehouse</Button>}</div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3"><p className="text-xs text-emerald-800">Farm stops</p><p className="mt-1 text-xl font-extrabold">{farmStops.length}</p></div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3"><p className="text-xs text-blue-800">Orders</p><p className="mt-1 text-xl font-extrabold">{totalOrders}</p></div>
                    <div className="rounded-xl border border-violet-100 bg-violet-50/70 p-3"><p className="text-xs text-violet-800">Total collection</p><p className="mt-1 text-xl font-extrabold">{totalQuantity} kg</p></div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-600">Route distance</p><p className="mt-1 text-xl font-extrabold">{r.distanceKm != null ? Number(r.distanceKm).toFixed(1) + " km" : "—"}</p></div>
                  </div>
                  <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
                    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3"><div><h3 className="text-sm font-bold">Route map</h3><p className="text-xs text-slate-500">Farm stops and assigned warehouse</p></div>{mapUrl && <a className="text-xs font-semibold text-emerald-700 hover:underline" href={mapUrl.replace("output=embed&","")} target="_blank" rel="noreferrer">Open in Maps</a>}</div>
                      {mapUrl ? <iframe title="Farm pickup route map" src={mapUrl} className="h-[300px] w-full border-0 sm:h-[370px]" loading="lazy" referrerPolicy="no-referrer-when-downgrade"/> :
                        <div className="flex h-[300px] flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-sky-50 px-6 text-center sm:h-[370px]"><MapPin className="h-9 w-9 text-emerald-700"/><p className="mt-3 text-sm font-semibold">Map locations are not available yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Farm addresses and the warehouse destination will appear here when location details are available.</p></div>}
                      <div className="grid grid-cols-3 divide-x border-t bg-white"><div className="p-3 text-center"><p className="text-sm font-bold">{r.distanceKm != null ? Number(r.distanceKm).toFixed(1) + " km" : "—"}</p><p className="text-[11px] text-slate-500">Total distance</p></div><div className="p-3 text-center"><p className="text-sm font-bold">{r.estimatedDuration || r.estimatedTime || "—"}</p><p className="text-[11px] text-slate-500">Est. travel</p></div><div className="p-3 text-center"><p className="text-sm font-bold">{totalQuantity} kg</p><p className="text-[11px] text-slate-500">Total collection</p></div></div>
                    </section>
                    <section className="min-w-0 space-y-3">
                      <div className="overflow-hidden rounded-xl border border-slate-200"><div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3"><h3 className="text-sm font-bold">Pickup Stops ({farmStops.length})</h3><span className="text-xs text-slate-500">{totalOrders} orders</span></div>
                        <div className="divide-y">
                          {farmStops.map((stop: any, i: number) => {
                            const orders = Array.isArray(stop.orders) && stop.orders.length ? stop.orders : [stop];
                            const status = String(stop.status || "pending");
                            const key = String(r.id || r.routeNumber || "route") + ":" + String(stop.farmKey || stop.collectionId || i);
                            const expanded = Boolean(expandedFarmStops[key]);
                            const panelId = "farm-orders-" + i + "-" + String(r.id || "").replace(/[^a-zA-Z0-9_-]/g,"");
                            const collected = orders.length > 0 && orders.every((o: any) => ["collected","departed_farm"].includes(String(o.status || "")));
                            const departed = orders.length > 0 && orders.every((o: any) => String(o.status || "") === "departed_farm");
                            const entries = orders.filter((o: any) => String(o.status || "") === "arrived_at_farm");
                            const manual = entries.filter((o: any) => String(o.collectionType || "") !== "packed_orders_transfer");
                            const allPacked = entries.length > 0 && entries.every((o: any) => String(o.collectionType || "") === "packed_orders_transfer");
                            const valid = entries.length > 0 && entries.every((o: any) => String(o.collectionType || "") === "packed_orders_transfer" ? Number(o.actualQuantity ?? o.quantity ?? 0) > 0 : Boolean(actual[o.collectionId]) && Number.isFinite(Number(actual[o.collectionId])) && Number(actual[o.collectionId]) > 0);
                            const canArrive = ["pending","ready_for_pickup","team_assigned","en_route","started"].includes(status);
                            return <div key={stop.farmKey || stop.collectionId || i} className="p-3 sm:p-4"><div className="flex items-start gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white">{i+1}</span><div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-bold">{stop.farmerName || "Farmer details unavailable"}</p><Badge variant="outline">{stopStatusLabel(status)}</Badge></div>
                              <p className="mt-1 text-xs text-slate-500">{orders.length} {orders.length===1?"order":"orders"} · Expected {stop.quantity || 0} kg</p><p className="mt-1 flex items-start gap-1 text-xs text-slate-600"><MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-700"/>{stop.pickupAddress || "Farm address not provided"}</p>
                              {stop.farmerPhone && <p className="mt-1 text-xs text-slate-600">Contact: <a className="font-medium text-emerald-700" href={"tel:"+stop.farmerPhone}>{stop.farmerPhone}</a></p>}
                              <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setExpandedFarmStops(prev => ({...prev,[key]:!prev[key]}))} aria-expanded={expanded}>{expanded?"Hide orders":"View orders"}<ChevronDown className={"ml-1 h-3.5 w-3.5 "+(expanded?"rotate-180":"")}/></Button>
                                {r.status!=="assigned" && canArrive && <Button size="sm" variant="outline" onClick={() => act(r,"arrived_at_farm",stop.collectionId)}><MapPin className="mr-1 h-3.5 w-3.5"/>Arrived</Button>}
                                {r.status!=="assigned" && status==="arrived_at_farm" && !collected && allPacked && <Button size="sm" onClick={() => act(r,"collected",stop.collectionId,{})}><CheckCircle2 className="mr-1 h-3.5 w-3.5"/>Mark Collected</Button>}
                                {r.status!=="assigned" && status==="arrived_at_farm" && !collected && !allPacked && !expanded && <Button size="sm" variant="outline" onClick={() => setExpandedFarmStops(prev => ({...prev,[key]:true}))}>Enter quantities</Button>}
                                {r.status!=="assigned" && expanded && entries.length>0 && !allPacked && <Button size="sm" disabled={!valid} onClick={() => act(r,"collected",stop.collectionId,Object.fromEntries(manual.map((o:any)=>[o.collectionId,Number(actual[o.collectionId])])))}><CheckCircle2 className="mr-1 h-3.5 w-3.5"/>Confirm collection</Button>}
                                {r.status!=="assigned" && collected && !departed && <Button size="sm" onClick={() => act(r,"departed_farm",stop.collectionId)}><Truck className="mr-1 h-3.5 w-3.5"/>Depart farm</Button>}</div>
                              {expanded && <div id={panelId} className="mt-3 divide-y rounded-lg border bg-slate-50">{orders.map((o:any,oi:number)=><div key={o.collectionId||o.orderId||oi} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold">{o.orderNumber?"Order "+o.orderNumber:"Order "+(oi+1)}</p><p className="text-xs text-slate-500">{o.productName||"Product details unavailable"} · {o.quantity||0} kg</p>{o.actualQuantity!=null&&<p className="text-xs font-semibold text-emerald-700">Collected: {o.actualQuantity} kg</p>}</div>{r.status!=="assigned"&&o.status==="arrived_at_farm"&&String(o.collectionType||"")!=="packed_orders_transfer"&&<div className="flex items-center gap-2 sm:w-48"><label className="text-xs">Actual kg</label><Input className="h-9" type="number" min="0.01" step="0.01" value={actual[o.collectionId]||""} onChange={e=>setActual(prev=>({...prev,[o.collectionId]:e.target.value}))} placeholder="Enter kg"/></div>}</div>)}</div>}
                            </div></div></div>;
                          })}
                        </div>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"><div className="flex items-center gap-2 text-emerald-900"><Clock className="h-4 w-4"/><p className="text-sm font-bold">Collection Schedule</p></div><p className="mt-2 text-sm font-semibold">{scheduleDate || "Schedule set by warehouse"}</p><p className="mt-1 text-sm text-slate-700">Farm collection window: 8:00 PM – 6:00 AM IST</p><p className="mt-2 text-xs leading-5 text-slate-600">Review your assigned route in advance. Begin farm collection during the scheduled collection window.</p></div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><Truck className="h-4 w-4 text-emerald-700"/><p className="text-sm font-bold">My Vehicle</p></div><p className="mt-2 text-sm font-semibold">{r.deliveryPartnerVehicleNumber || r.vehicleNumber || "Vehicle not specified"}</p><p className="mt-1 text-xs text-slate-500">{r.deliveryPartnerVehicleType || r.vehicleType || "Vehicle type not specified"}</p>{r.vehicleCapacity!=null&&<p className="mt-2 text-xs text-slate-600">Capacity: {r.vehicleCapacity} kg · Planned load: {totalQuantity} kg</p>}</div>
                    </section>
                  </div>
                  <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">Assigned to your account · Other partners cannot accept this route</p><div className="flex flex-wrap gap-2">
                    {r.status==="assigned"&&<Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => act(r,"started")}><Navigation className="mr-2 h-4 w-4"/>Start Collection (8 PM – 6 AM)</Button>}
                    {r.status==="departed_farm"&&<Button onClick={() => act(r,"completed")}>Complete Pickup Route</Button>}
                    {r.status==="completed"&&<Button onClick={() => act(r,"returned_to_warehouse")}><Warehouse className="mr-2 h-4 w-4"/>Arrived at Warehouse</Button>}
                    {r.status==="returned_to_warehouse"&&<Badge variant="outline">Waiting for warehouse receipt</Badge>}
                  </div></div>
                  {r.status==="completed"&&<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">All farm pickups are complete. Record warehouse arrival only when the vehicle and produce physically reach the assigned warehouse. Warehouse staff must still confirm receipt, inspect quality and store the stock.</div>}
                  {r.status==="returned_to_warehouse"&&<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900">Warehouse arrival has been recorded. The warehouse team must now confirm receipt, inspect quality and store the stock in Incoming Stock.</div>}
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}
        </>
      )}
      {routeView === "transfers" && warehouseTransfers.length === 0 && hubTransfers.length === 0 && (
        <Card className="p-10 text-center">
          <Truck className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">No warehouse transfer routes for {datePeriod === "today" ? "today" : "yesterday"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Assigned warehouse-to-warehouse and warehouse-to-local-hub transfers will appear here. Farm collections remain under Farm Pickup Routes.</p>
        </Card>
      )}
    </div>
  );
}
