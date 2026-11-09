"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Layers,
  MapPinned,
  Route,
  Package,
  PackageCheck,
  RefreshCw,
  ShoppingCart,
  Truck,
  Warehouse,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";

function readList(response: any, keys: string[]): any[] {
  const roots = [response, response?.data, response?.data?.data];
  for (const root of roots) {
    for (const key of keys) {
      if (Array.isArray(root?.[key])) return root[key];
    }
  }
  return Array.isArray(response) ? response : [];
}

function orderStatus(order: any): string {
  return String(order?.status || order?.orderStatus || order?.fulfillmentStatus || "").toLowerCase();
}

function activeStatus(status: string): boolean {
  return !["delivered", "picked_up", "completed", "cancelled", "refunded"].includes(status);
}

const workflows = [
  {
    title: "Customer Orders",
    description: "Review new orders, confirm or cancel requests, update processing status and open complete order activity.",
    href: "/farmer/orders",
    action: "Manage orders",
    icon: ShoppingCart,
    tone: "bg-blue-50 text-blue-700",
    tags: ["Confirm orders", "Order details", "Activity history"],
  },
  {
    title: "Packing & Checking",
    description: "Record actual packed quantities for each item, review shortages, confirm packing and print delivery labels.",
    href: "/farmer/packing",
    action: "Open packing queue",
    icon: PackageCheck,
    tone: "bg-emerald-50 text-emerald-700",
    tags: ["Actual quantities", "Shortage handling", "Pickup readiness"],
  },
  {
    title: "Quality Inspection",
    description: "Track batch inspection requests, submit evidence and review quality decisions before listing produce.",
    href: "/farmer/quality",
    action: "Open quality checks",
    icon: FlaskConical,
    tone: "bg-violet-50 text-violet-700",
    tags: ["Inspection queue", "Evidence", "Quality decision"],
  },
  {
    title: "Batches & Traceability",
    description: "Create lots from completed harvests, monitor shelf life and link approved batches to marketplace products.",
    href: "/farmer/batches",
    action: "Manage batches",
    icon: Layers,
    tone: "bg-amber-50 text-amber-700",
    tags: ["Lot numbers", "Expiry monitoring", "Product inventory"],
  },
  {
    title: "Farmer Order Map",
    description: "Review packed orders, select multiple eligible orders and plan farmer delivery or warehouse handover.",
    href: "/farmer/order-map",
    action: "Open order map",
    icon: MapPinned,
    tone: "bg-cyan-50 text-cyan-700",
    tags: ["Radius and route", "Multiple selection", "Delivery decision"],
  },
  {
    title: "Delivery Calendar & Routes",
    description: "Review delivery schedules and organize confirmed orders into practical delivery routes.",
    href: "/farmer/delivery-calendar",
    action: "View delivery calendar",
    icon: CalendarDays,
    tone: "bg-indigo-50 text-indigo-700",
    tags: ["Delivery schedule", "Time slots", "Route planning"],
  },
  {
    title: "Bulk & B2B Orders",
    description: "Manage business orders, farmer preparation, weighing, quality checks and farm pickup readiness.",
    href: "/farmer/bulk-orders",
    action: "Manage B2B orders",
    icon: Boxes,
    tone: "bg-rose-50 text-rose-700",
    tags: ["Bulk orders", "Business orders", "Farm pickup"],
  },
  {
    title: "B2B Supply Workspace",
    description: "Review awarded business supply contracts and the farmer's recurring supply commitments.",
    href: "/farmer/b2b/contracts",
    action: "Open supply workspace",
    icon: Warehouse,
    tone: "bg-teal-50 text-teal-700",
    tags: ["Supply contracts", "Recurring supply", "Preparation"],
  },
  {
    title: "Smart Route",
    description: "Optimize selected delivery stops and review the planned sequence before dispatch.",
    href: "/farmer/smart-route",
    action: "Optimize route",
    icon: Route,
    tone: "bg-indigo-50 text-indigo-700",
    tags: ["Stop sequence", "Route planning", "Delivery efficiency"],
  },
  {
    title: "Delivery Slots",
    description: "Review delivery slot availability and manage the farmer's delivery schedule.",
    href: "/farmer/delivery-slots",
    action: "Manage delivery slots",
    icon: CalendarDays,
    tone: "bg-sky-50 text-sky-700",
    tags: ["Availability", "Time slots", "Scheduling"],
  },
  {
    title: "Farm Route",
    description: "Review assigned farmer routes and the operational status of active delivery runs.",
    href: "/farmer/route",
    action: "Open farm route",
    icon: Route,
    tone: "bg-slate-50 text-slate-700",
    tags: ["Assigned route", "Delivery progress", "Handover"],
  },
  {
    title: "Warehouse Returns",
    description: "Review produce returned from warehouse handling and follow the available return actions.",
    href: "/farmer/warehouse-returns",
    action: "Review returns",
    icon: Package,
    tone: "bg-orange-50 text-orange-700",
    tags: ["Returned stock", "Inspection", "Resolution"],
  },
];

export function FarmerOperationsOverview() {
  const ordersQuery = useQuery({
    queryKey: ["farmerOrderOperations", "retailOrders"],
    queryFn: () => api.get("/farmers/me/orders", { params: { limit: 500 } }),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const b2bQuery = useQuery({
    queryKey: ["farmerOrderOperations", "b2bOrders"],
    queryFn: () => api.get("/b2b/orders"),
    refetchInterval: 20000,
    retry: 1,
  });
  const bulkQuery = useQuery({
    queryKey: ["farmerOrderOperations", "bulkOrders"],
    queryFn: () => api.get("/bulk-orders/orders"),
    refetchInterval: 20000,
    retry: 1,
  });
  const batchesQuery = useQuery({
    queryKey: ["farmerOrderOperations", "batches"],
    queryFn: () => api.get("/batches"),
    refetchInterval: 30000,
    retry: 1,
  });

  const retailOrders = useMemo(() => readList(ordersQuery.data, ["orders"]), [ordersQuery.data]);
  const b2bOrders = useMemo(() => readList(b2bQuery.data, ["orders"]), [b2bQuery.data]);
  const bulkOrders = useMemo(() => readList(bulkQuery.data, ["orders"]), [bulkQuery.data]);
  const batches = useMemo(() => readList(batchesQuery.data, ["batches"]), [batchesQuery.data]);

  const pendingOrders = retailOrders.filter((order) => ["pending", "confirmed"].includes(orderStatus(order))).length;
  const packingOrders = retailOrders.filter((order) => {
    const status = orderStatus(order);
    const stage = String(order?.fulfillmentStage || "").toLowerCase();
    return status === "processing" && stage !== "packed";
  }).length;
  const readyForPickup = retailOrders.filter((order) =>
    orderStatus(order) === "ready_for_pickup" ||
    String(order?.fulfillmentStage || "").toLowerCase() === "ready_for_pickup"
  ).length;
  const pendingQuality = batches.filter((batch) =>
    !["approved", "rejected"].includes(String(batch?.qualityStatus || "").toLowerCase())
  ).length;
  const activeBusinessOrders = b2bOrders.filter((order) => activeStatus(orderStatus(order))).length;
  const activeBulkOrders = bulkOrders.filter((order) => activeStatus(orderStatus(order))).length;
  const loading = ordersQuery.isLoading || b2bQuery.isLoading || bulkQuery.isLoading || batchesQuery.isLoading;
  const hasError = ordersQuery.isError && b2bQuery.isError && bulkQuery.isError && batchesQuery.isError;

  const refreshAll = () => {
    void ordersQuery.refetch();
    void b2bQuery.refetch();
    void bulkQuery.refetch();
    void batchesQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <Activity className="h-4 w-4" /> FARMER WORKSPACE
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Farmer Order Operations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            One place to monitor and open every stage of customer, bulk and business order fulfillment — from order confirmation and packing to quality checks, pickup and delivery.
          </p>
        </div>
        <Button variant="outline" onClick={refreshAll} disabled={loading} className="shrink-0">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh status
        </Button>
      </div>

      {hasError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Some operation totals could not be loaded. Open the relevant workflow below to retry its data.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Orders to review", value: pendingOrders, hint: "Pending / confirmed", icon: ClipboardList, tone: "text-blue-700 bg-blue-50" },
          { label: "Packing in progress", value: packingOrders, hint: "Retail fulfillment", icon: Package, tone: "text-emerald-700 bg-emerald-50" },
          { label: "Ready for pickup", value: readyForPickup, hint: "Farm or warehouse handover", icon: Truck, tone: "text-amber-700 bg-amber-50" },
          { label: "Quality checks pending", value: pendingQuality, hint: "Harvest batches", icon: FlaskConical, tone: "text-violet-700 bg-violet-50" },
          { label: "Active B2B / bulk", value: activeBusinessOrders + activeBulkOrders, hint: `${activeBusinessOrders} B2B · ${activeBulkOrders} bulk`, icon: Boxes, tone: "text-rose-700 bg-rose-50" },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${stat.tone}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-950">{loading ? "—" : stat.value}</p>
                <p className="truncate text-[11px] text-slate-500">{stat.hint}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Order fulfillment workspace</h2>
          <p className="mt-1 text-sm text-slate-500">Choose the operation you need. Each workspace keeps its existing order actions and validation.</p>
        </div>
        <Badge variant="secondary">{workflows.length} workspaces</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {workflows.map((workflow, index) => (
          <Card key={workflow.href} className="group flex h-full flex-col border-slate-200 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${workflow.tone}`}>
                  <workflow.icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold text-slate-400">0{index + 1}</span>
              </div>
              <CardTitle className="pt-2 text-base text-slate-950">{workflow.title}</CardTitle>
              <CardDescription className="min-h-[60px] text-sm leading-5">{workflow.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {workflow.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-600">{tag}</span>
                ))}
              </div>
              <Button asChild className="w-full justify-between bg-emerald-700 hover:bg-emerald-800">
                <Link href={workflow.href}>{workflow.action}<ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-5 w-5 text-emerald-700" /> Recommended operating sequence</CardTitle>
          <CardDescription>Follow the sequence that matches the order's fulfillment method. Not every order needs every step.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["01", "Receive & confirm", "Review the order and confirm availability."],
              ["02", "Prepare & pack", "Check each item and record the actual packed quantity."],
              ["03", "Quality & handover", "Complete required quality checks and mark the order ready for pickup."],
              ["04", "Route & deliver", "Use the order map, delivery calendar or assigned pickup workflow."],
            ].map(([number, title, description]) => (
              <div key={number} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-xs font-bold text-emerald-700">{number}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Status totals refresh automatically. If a total is unavailable, the underlying workspace remains available for a direct retry.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FarmerOrderOperationsPage() {
  return <FarmerOperationsOverview />;
}
