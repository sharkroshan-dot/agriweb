"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { CalendarDays, CheckCircle2, MapPin, PackageCheck, Warehouse } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";

const WAREHOUSE_RECEIVED_STATUSES = new Set([
  "received",
  "warehouse_received",
  "received_at_warehouse",
  "arrived_warehouse",
  "returned_to_warehouse",
  "stored",
]);

const formatDate = (value: any) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export default function PickupHistoryPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["myPickupHistory"],
    queryFn: () => api.get("/delivery/me/pickup-routes"),
    enabled: Boolean(accessToken),
  });

  const routes = data?.data?.routes || [];
  const completedRoutes = routes.filter((route: any) =>
    WAREHOUSE_RECEIVED_STATUSES.has(
      String(route?.status || route?.orderStatus || route?.collectionStatus || "")
        .trim()
        .toLowerCase()
        .replace(/[ -]+/g, "_")
    )
  );

  return (
    <div className="space-y-6">
      <div className="delivery-page-header">
        <p className="text-sm font-medium text-primary">Warehouse pickup archive</p>
        <h1 className="delivery-page-title text-3xl font-semibold tracking-tight">Pickup History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review farm pickup routes that have reached and been received by their destination warehouse.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><PackageCheck className="h-5 w-5" /></div>
            <div><p className="text-sm text-muted-foreground">Completed pickup routes</p><p className="text-2xl font-semibold">{isLoading ? "—" : completedRoutes.length}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <div className="rounded-xl bg-slate-100 p-3 text-slate-700"><Warehouse className="h-5 w-5" /></div>
            <div><p className="text-sm text-muted-foreground">Warehouse handovers</p><p className="text-2xl font-semibold">{isLoading ? "—" : completedRoutes.length}</p></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Completed farm pickups</CardTitle>
            <CardDescription>Only pickups with a warehouse-received or handover status appear here.</CardDescription>
          </div>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : isError ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">Could not load pickup history.</p>
              <button type="button" onClick={() => refetch()} className="mt-3 text-sm font-medium text-primary">Try again</button>
            </div>
          ) : completedRoutes.length === 0 ? (
            <div className="py-10 text-center">
              <PackageCheck className="mx-auto h-9 w-9 text-muted-foreground" />
              <p className="mt-3 font-medium">No completed pickups yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Completed farm pickups will appear after the destination warehouse records receipt.</p>
            </div>
          ) : completedRoutes.map((route: any, index: number) => {
            const id = route.id || route._id || route.routeNumber || index;
            const stops = Array.isArray(route.stops) ? route.stops : [];
            const completedAt = route.warehouseArrivalAt || route.arrivedWarehouseAt || route.warehouseArrivedAt || route.returnedAt || route.completedAt || route.updatedAt || route.routeDate || route.createdAt;
            const status = String(route.status || route.orderStatus || route.collectionStatus || "received").replace(/_/g, " ");
            return (
              <div key={id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{route.routeNumber || route.orderNumber || `Pickup route ${index + 1}`}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{route.warehouseName || route.destinationWarehouseName || "Destination warehouse"}</p>
                  </div>
                  <Badge variant="success"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Warehouse received</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(completedAt)}</span>
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{stops.length || route.stopCount || route.farmCount || 0} farm stops</span>
                </div>
                {route.vehicleNumber && <p className="mt-2 text-xs text-muted-foreground">Vehicle: {route.vehicleNumber}</p>}
                <p className="mt-2 text-xs capitalize text-muted-foreground">Recorded status: {status}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
