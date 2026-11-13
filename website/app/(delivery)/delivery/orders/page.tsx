"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { CheckCircle2, AlertTriangle, PackageCheck, Truck } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";
import DeliveryOrderMapPage from "../order-map/page";

const asArray = (value: any): any[] => Array.isArray(value) ? value : [];

export default function DeliveryOrdersWorkspacePage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken;
  const { data: todayData } = useQuery({
    queryKey: ["deliveryToday"],
    queryFn: () => api.get("/delivery/me/today"),
    enabled: Boolean(accessToken),
  });
  const { data: assignmentsData } = useQuery({
    queryKey: ["deliveryAssignments"],
    queryFn: () => api.get("/delivery/assignments", { params: { status: "all", limit: 100 } }),
    enabled: Boolean(accessToken),
  });

  const orders = useMemo(() => {
    const today = asArray(todayData?.data?.deliveries || todayData?.deliveries || todayData?.data);
    const assignments = asArray(assignmentsData?.data?.assignments || assignmentsData?.data?.deliveries || assignmentsData?.assignments || assignmentsData?.data);
    const merged = new Map<string, any>();
    [...today, ...assignments].forEach((order: any) => {
      const id = String(order?.orderId || order?.order?.id || order?.id || order?._id || "");
      if (id && !merged.has(id)) merged.set(id, order);
    });
    return [...merged.values()];
  }, [todayData, assignmentsData]);

  const counts = useMemo(() => ({
    assigned: orders.filter((o) => ["assigned", "ready_for_delivery", "accepted"].includes(String(o.status || o.orderStatus || "").toLowerCase())).length,
    pickup: orders.filter((o) => ["picked_up", "dispatched"].includes(String(o.status || o.orderStatus || "").toLowerCase())).length,
    transit: orders.filter((o) => String(o.status || o.orderStatus || "").toLowerCase() === "in_transit").length,
    delivered: orders.filter((o) => ["delivered", "completed"].includes(String(o.status || o.orderStatus || "").toLowerCase())).length,
    failed: orders.filter((o) => ["failed", "cancelled", "returned"].includes(String(o.status || o.orderStatus || "").toLowerCase())).length,
  }), [orders]);

  const summary = [
    { label: "Assigned Orders", value: counts.assigned, hint: "Assigned and accepted", icon: PackageCheck, tone: "emerald" },
    { label: "Pickup / Dispatch", value: counts.pickup, hint: "Collected from pickup point", icon: Truck, tone: "blue" },
    { label: "In Transit", value: counts.transit, hint: "On the way to customers", icon: Truck, tone: "violet" },
    { label: "Delivered", value: counts.delivered, hint: "Completed deliveries", icon: CheckCircle2, tone: "green" },
    { label: "Failed / Return", value: counts.failed, hint: "Needs attention", icon: AlertTriangle, tone: "rose" },
  ];

  return (
    <div className="space-y-5">
      <div className="delivery-page-header flex flex-col gap-2">
        <p className="text-sm font-medium text-emerald-700">Delivery partner workspace</p>
        <h1 className="delivery-page-title text-3xl font-semibold tracking-tight">Order Map &amp; My Deliveries</h1>
        <p className="text-sm text-muted-foreground">Find nearby orders and manage the complete customer delivery lifecycle from the same map, order list and details panel.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {summary.map((item) => {
          const Icon = item.icon;
          const tone = item.tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : item.tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-800"
            : item.tone === "violet" ? "border-violet-200 bg-violet-50 text-violet-800"
            : item.tone === "green" ? "border-green-200 bg-green-50 text-green-800"
            : "border-rose-200 bg-rose-50 text-rose-800";
          return (
            <Card key={item.label} className={`border shadow-sm ${tone}`}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-full bg-white/80 p-2.5"><Icon className="h-5 w-5" /></div>
                <div className="min-w-0">
                  <p className="text-xs font-medium opacity-80">{item.label}</p>
                  <p className="text-2xl font-bold leading-tight tabular-nums">{item.value}</p>
                  <p className="truncate text-[11px] opacity-75">{item.hint}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section aria-label="Live order map, nearby orders and selected order">
        <DeliveryOrderMapPage compact />
      </section>


    </div>
  );
}
