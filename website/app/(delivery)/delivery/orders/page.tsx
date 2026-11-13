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
      <header className="relative isolate flex min-h-[132px] items-center overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-[#f2fbe9] via-[#f4fbe9] to-[#dff5c9] px-5 py-5 shadow-sm sm:px-7 lg:min-h-[144px]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[48%] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[#f2fbe9] via-[#eaf8d8]/70 to-transparent" />
          <div className="absolute -bottom-16 right-[-3%] h-36 w-[78%] rounded-[50%] bg-gradient-to-b from-[#c9eaa5] to-[#9ed47b] opacity-75" />
          <div className="absolute -bottom-20 right-[8%] h-32 w-[62%] rotate-[-7deg] rounded-[50%] border-t-[14px] border-white/80 bg-transparent" />
          <div className="absolute bottom-5 right-[12%] h-2 w-28 rotate-[-7deg] rounded-full bg-white/70" />
          <div className="absolute bottom-0 right-0 h-20 w-32 rounded-tl-[100%] bg-gradient-to-br from-emerald-300/40 to-green-600/30" />
          <div className="absolute bottom-3 right-[34%] h-10 w-20 rounded-t-full bg-emerald-500/15 blur-sm" />
          <div className="absolute bottom-2 right-[5%] rounded-full bg-white/70 p-3 text-emerald-700 shadow-sm">
            <Truck className="h-12 w-12 sm:h-14 sm:w-14" strokeWidth={1.8} />
          </div>
        </div>
        <div className="relative z-10 flex min-w-0 items-center gap-4 sm:gap-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md sm:h-[76px] sm:w-[76px]">
            <Truck className="h-9 w-9 sm:h-11 sm:w-11" strokeWidth={1.9} />
          </div>
          <div className="h-14 w-px shrink-0 bg-emerald-700/60 sm:h-16" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800 sm:text-xs">Delivery operations</p>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-[28px]">Order Map &amp; My Deliveries</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-700 sm:text-sm">Find nearby orders and manage the complete customer delivery lifecycle from the same map, order list and details panel.</p>
          </div>
        </div>
      </header>

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
