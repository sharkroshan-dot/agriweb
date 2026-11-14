"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  ArrowRight, CheckCircle2, Clock3, Headphones,
  MapPin, MapPinned, PackageCheck, RefreshCw, Route, Truck,
  Wallet, Warehouse, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import toast from "react-hot-toast";

const completedPickupStatuses = new Set([
  "received", "warehouse_received", "received_at_warehouse",
  "arrived_warehouse", "returned_to_warehouse", "stored",
]);
const activePickupStatuses = new Set([
  "assigned", "started", "arrived_at_farm", "collected",
  "departed_farm", "en_route", "team_assigned",
]);

const getStatus = (item: any) =>
  String(item?.status || item?.orderStatus || item?.collectionStatus || "")
    .trim().toLowerCase().replace(/[ -]+/g, "_");

const getPickupDestination = (item: any) =>
  item?.warehouseName || item?.destinationWarehouseName ||
  item?.warehouse?.name || item?.destinationWarehouse?.name || "Destination warehouse";

const getPickupOrigin = (item: any) =>
  item?.farmerName || item?.farmName || item?.pickupAddress ||
  item?.stops?.[0]?.farmerName || item?.stops?.[0]?.farmName || "Assigned farm collection";

const formatDate = () => new Intl.DateTimeFormat("en-IN", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
}).format(new Date());

export default function DeliveryDashboardPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const statsQuery = useQuery({
    queryKey: ["deliveryStats"],
    queryFn: () => api.get("/delivery/me/stats"),
    enabled: Boolean(accessToken),
    retry: 1,
  });
  const customerQuery = useQuery({
    queryKey: ["deliveryToday"],
    queryFn: () => api.get("/delivery/me/today"),
    enabled: Boolean(accessToken),
    retry: 1,
  });
  const pickupQuery = useQuery({
    queryKey: ["myPickupRoutes"],
    queryFn: () => api.get("/delivery/me/pickup-routes"),
    enabled: Boolean(accessToken),
    retry: 1,
    refetchInterval: 30000,
  });

  const stats = statsQuery.data?.data || {};
  const customerDeliveries = customerQuery.data?.data?.deliveries || [];
  const pickupRoutes = pickupQuery.data?.data?.routes || [];

  useEffect(() => {
    if (stats.isAvailable !== undefined) setIsAvailable(Boolean(stats.isAvailable));
    else if (statsQuery.isSuccess || statsQuery.isError) setIsAvailable(true);
  }, [stats.isAvailable, statsQuery.isSuccess, statsQuery.isError]);

  const customerCompleted = customerDeliveries.filter((item: any) => item.status === "delivered").length;
  const customerActive = customerDeliveries.filter((item: any) =>
    ["in_transit", "dispatched", "picked_up", "accepted", "processing"].includes(String(item.status || "").toLowerCase())
  ).length;
  const customerPending = customerDeliveries.filter((item: any) =>
    !["delivered", "cancelled"].includes(String(item.status || "").toLowerCase())
  ).length;
  const pickupCompleted = pickupRoutes.filter((item: any) => completedPickupStatuses.has(getStatus(item))).length;
  const pickupActive = pickupRoutes.filter((item: any) => activePickupStatuses.has(getStatus(item))).length;
  const pickupPending = pickupRoutes.filter((item: any) =>
    !completedPickupStatuses.has(getStatus(item)) &&
    !["cancelled", "rejected"].includes(getStatus(item))
  ).length;
  const allTasks = pickupRoutes.length + customerDeliveries.length;
  const completedTasks = pickupCompleted + customerCompleted;
  const progress = allTasks ? Math.round((completedTasks / allTasks) * 100) : 0;

  const nextPickup = pickupRoutes.find((item: any) =>
    activePickupStatuses.has(getStatus(item)) || ["offered", "assigned"].includes(getStatus(item))
  );
  const nextCustomerDelivery = customerDeliveries.find((item: any) =>
    !["delivered", "cancelled"].includes(String(item.status || "").toLowerCase())
  );
  const showPickupNext = Boolean(nextPickup);
  const nextTask = showPickupNext ? nextPickup : nextCustomerDelivery;
  const nextTaskType = showPickupNext ? "Warehouse pickup" : "Customer delivery";
  const nextTaskTitle = showPickupNext ? getPickupOrigin(nextPickup) : (nextCustomerDelivery?.customerName || "Customer delivery");
  const nextTaskAddress = showPickupNext
    ? getPickupDestination(nextPickup)
    : (typeof nextCustomerDelivery?.deliveryAddress === "string"
      ? nextCustomerDelivery.deliveryAddress
      : [
          nextCustomerDelivery?.deliveryAddress?.addressLine1,
          nextCustomerDelivery?.deliveryAddress?.area,
          nextCustomerDelivery?.deliveryAddress?.city,
        ].filter(Boolean).join(", "));
  const totalEarnings = stats.totalEarnings ?? 0;
  const weeklyEarnings = stats.weeklyEarnings;
  const availableBalance = stats.availableBalance;

  const refreshAll = async () => {
    await Promise.all([statsQuery.refetch(), customerQuery.refetch(), pickupQuery.refetch()]);
  };

  const toggleAvailability = async () => {
    if (isAvailable === null || isToggling) return;
    const next = !isAvailable;
    setIsToggling(true);
    try {
      await api.put("/delivery/me/availability", { isAvailable: next });
      setIsAvailable(next);
      toast.success(next ? "You are now online" : "You are now offline");
      await statsQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || "Could not update availability");
    } finally {
      setIsToggling(false);
    }
  };

  if (statsQuery.isLoading || customerQuery.isLoading || pickupQuery.isLoading || isAvailable === null) {
    return (
      <div className="space-y-5">
        <div className="h-36 animate-pulse rounded-2xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-muted" />)}</div>
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const displayName = session?.user?.name?.trim().split(/\s+/)[0] || "there";

  return (
    <div className="w-full space-y-6 pb-10 text-[15px] leading-relaxed">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[15px] font-medium text-emerald-700">Delivery Partner Workspace</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-[16px] text-slate-600">Your delivery overview and today's priorities.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={isAvailable ? "success" : "secondary"} className="min-h-12 rounded-xl px-5 py-3 text-base font-bold shadow-sm">
            <span className={`mr-2 inline-block h-3 w-3 rounded-full ${isAvailable ? "bg-emerald-500" : "bg-slate-400"}`} />
            {isAvailable ? "Online" : "Offline"}
          </Badge>
          <Button variant="outline" size="lg" className="h-12 min-w-[132px] rounded-xl px-6 text-base font-semibold shadow-sm" onClick={refreshAll} disabled={statsQuery.isFetching || customerQuery.isFetching || pickupQuery.isFetching}>
            <RefreshCw className={`mr-2 h-5 w-5 ${statsQuery.isFetching || customerQuery.isFetching || pickupQuery.isFetching ? "animate-spin" : ""}`} />
            {statsQuery.isFetching || customerQuery.isFetching || pickupQuery.isFetching ? "Refreshing..." : "Refresh"}
          </Button>
          <Button size="lg" className="h-12 min-w-[142px] rounded-xl px-6 text-base font-semibold shadow-sm" variant={isAvailable ? "outline" : "default"} onClick={toggleAvailability} disabled={isToggling}>
            {isToggling ? "Updating..." : isAvailable ? "Go offline" : "Go online"}
          </Button>
        </div>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-900 bg-gradient-to-r from-emerald-950 via-emerald-800 to-green-700 px-5 py-7 text-white shadow-md sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full border-[32px] border-white/5" />
        <div className="pointer-events-none absolute bottom-0 right-28 h-40 w-40 rounded-full bg-lime-300/10 blur-2xl" />
        <div className="relative">
          <div className="max-w-2xl">
            <p className="text-[15px] font-medium text-emerald-100">{formatDate()}</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight !text-white sm:text-4xl">Good day, {displayName}!</h2>
            <p className="mt-3 max-w-2xl text-base leading-7 !text-emerald-50">
              Your work is split into two independent operations. Check your farm pickups and customer deliveries separately, then focus on your next assigned task.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge className="border border-white/30 bg-white/15 px-3 py-1.5 text-sm font-semibold !text-white hover:bg-white/20"><Warehouse className="mr-1.5 h-3.5 w-3.5" /> Warehouse pickup</Badge>
              <Badge className="border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-semibold !text-white hover:bg-white/10"><Truck className="mr-1.5 h-3.5 w-3.5" /> Customer delivery</Badge>
            </div>
          </div>

       </div>
      </section>

      <section aria-label="Workflow overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/delivery/pickup-team" className="group">
          <Card className="h-full border-emerald-200 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="flex items-center justify-between gap-3 p-5">
              <div>
                <p className="text-[15px] font-medium text-muted-foreground">Pickup assignments</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{pickupPending}</p>
                <p className="mt-1 text-[15px] text-muted-foreground">Farm collection jobs</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><Warehouse className="h-6 w-6" /></div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/delivery/deliveries" className="group">
          <Card className="h-full border-blue-100 transition-shadow hover:shadow-md">
            <CardContent className="flex items-center justify-between gap-3 p-5">
              <div>
                <p className="text-[15px] font-medium text-muted-foreground">My deliveries</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">{customerPending}</p>
                <p className="mt-1 text-[15px] text-muted-foreground">Customer orders awaiting delivery</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-3 text-blue-700"><PackageCheck className="h-6 w-6" /></div>
            </CardContent>
          </Card>
        </Link>
        <Card className="border-violet-200 shadow-sm">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-[15px] font-medium text-muted-foreground">In progress</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{pickupActive + customerActive}</p>
              <p className="mt-1 text-[15px] text-muted-foreground">Pickup and delivery tasks</p>
            </div>
            <div className="rounded-xl bg-violet-50 p-3 text-violet-700"><Truck className="h-6 w-6" /></div>
          </CardContent>
        </Card>
        <Card className="border-teal-200 shadow-sm">
          <CardContent className="flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-[15px] font-medium text-muted-foreground">Completed today</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{completedTasks}</p>
              <p className="mt-1 text-[15px] text-muted-foreground">Warehouse handovers + deliveries</p>
            </div>
            <div className="rounded-xl bg-teal-50 p-3 text-teal-700"><CheckCircle2 className="h-6 w-6" /></div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><CardTitle>Today's progress</CardTitle><CardDescription>Pickup and customer delivery progress are tracked separately.</CardDescription></div>
              <span className="text-[15px] font-semibold text-emerald-700">{completedTasks} / {allTasks} completed</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex justify-between text-[15px]"><span className="font-medium">Overall tasks</span><span className="text-muted-foreground">{progress}%</span></div>
              <Progress value={progress} className="h-3" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-[15px] font-semibold"><Warehouse className="h-4 w-4 text-emerald-700" /> Warehouse pickup</span><span className="text-[15px] font-bold">{pickupCompleted}/{pickupRoutes.length}</span></div>
                <Progress value={pickupRoutes.length ? pickupCompleted / pickupRoutes.length * 100 : 0} className="mt-3 h-2" />
                <p className="mt-2 text-[15px] text-muted-foreground">{pickupPending} remaining · {pickupActive} active</p>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-[15px] font-semibold"><Truck className="h-4 w-4 text-blue-700" /> Customer delivery</span><span className="text-[15px] font-bold">{customerCompleted}/{customerDeliveries.length}</span></div>
                <Progress value={customerDeliveries.length ? customerCompleted / customerDeliveries.length * 100 : 0} className="mt-3 h-2" />
                <p className="mt-2 text-[15px] text-muted-foreground">{customerPending} remaining · {customerActive} active</p>
              </div>
            </div>
            {!allTasks && <p className="rounded-lg bg-muted/50 p-3 text-[15px] text-muted-foreground">No pickup or customer delivery tasks are currently available. Stay online for new assignments.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-emerald-700" /> Earnings overview</CardTitle><CardDescription>Based on your recorded earnings data.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div><p className="text-[15px] text-muted-foreground">Total earnings</p><p className="mt-1 text-3xl font-bold">{formatPrice(totalEarnings)}</p></div>
            {weeklyEarnings !== undefined && <div className="rounded-xl bg-emerald-50 p-3"><p className="text-[15px] text-emerald-800">This week</p><p className="mt-1 text-xl font-semibold text-emerald-900">{formatPrice(weeklyEarnings)}</p></div>}
            {availableBalance !== undefined && <div className="flex items-center justify-between border-t pt-3"><span className="text-[15px] text-muted-foreground">Available balance</span><span className="font-semibold">{formatPrice(availableBalance)}</span></div>}
            <Link href="/delivery/earnings" className="inline-flex items-center text-[15px] font-semibold text-emerald-700 hover:text-emerald-800">View earnings <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div><CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-emerald-700" /> Next task</CardTitle><CardDescription>Your next available assignment, not the full order list.</CardDescription></div>
              {nextTask && <Badge variant="outline">{nextTaskType}</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {!nextTask ? (
              <div className="rounded-xl border border-dashed p-7 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
                <p className="mt-2 font-semibold">You're all caught up</p>
                <p className="mt-1 text-[15px] text-muted-foreground">There are no pending pickup or customer delivery tasks right now.</p>
              </div>
            ) : (
              <div className="rounded-xl border bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-[15px] font-semibold uppercase tracking-wide text-emerald-700">{nextTaskType}</p><p className="mt-1 text-lg font-semibold">{nextTaskTitle}</p><p className="mt-1 text-[15px] text-muted-foreground">{nextTaskAddress || "Location details are not available yet."}</p></div>
                  <Badge variant="warning">{getStatus(nextTask).replace(/_/g, " ") || "Assigned"}</Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild><Link href={showPickupNext ? "/delivery/pickup-routes" : "/delivery/deliveries"}>Open assignment <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
                  <Button asChild variant="outline"><Link href={showPickupNext ? "/delivery/pickup-routes" : "/delivery/order-map"}><MapPinned className="mr-2 h-4 w-4" /> Open map</Link></Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Quick actions</CardTitle><CardDescription>Shortcuts to your daily tools.</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Link href="/delivery/pickup-routes" className="rounded-xl border p-4 text-center transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"><Route className="mx-auto h-6 w-6 text-emerald-700" /><span className="mt-2 block text-[15px] font-medium">Pickup routes</span></Link>
            <Link href="/delivery/order-map" className="rounded-xl border p-4 text-center transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"><MapPinned className="mx-auto h-6 w-6 text-emerald-700" /><span className="mt-2 block text-[15px] font-medium">Open order map</span></Link>
            <Link href="/delivery/messages" className="rounded-xl border p-4 text-center transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"><Headphones className="mx-auto h-6 w-6 text-emerald-700" /><span className="mt-2 block text-[15px] font-medium">Contact support</span></Link>
            <Link href="/delivery/support" className="rounded-xl border p-4 text-center transition-colors hover:border-emerald-300 hover:bg-emerald-50/50"><AlertCircle className="mx-auto h-6 w-6 text-emerald-700" /><span className="mt-2 block text-[15px] font-medium">Report an issue</span></Link>
          </CardContent>
        </Card>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
        <div className="flex items-center gap-3"><div className="rounded-lg bg-slate-100 p-2"><Clock3 className="h-5 w-5 text-slate-600" /></div><div><p className="text-[15px] font-semibold">Need the full assignment list?</p><p className="text-[15px] text-muted-foreground">Open the dedicated page to manage, accept and update individual jobs.</p></div></div>
        <div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link href="/delivery/pickup-team">Pickup assignments</Link></Button><Button asChild size="sm"><Link href="/delivery/deliveries">My deliveries</Link></Button></div>
      </div>
    </div>
  );
}
