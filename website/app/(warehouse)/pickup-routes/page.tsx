"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, Plus, CheckCircle2, Users, PackageCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

export default function PickupRoutesPage() {
  const routesQ = useQuery({
    queryKey: ["warehousePickupRoutes"],
    queryFn: () => api.get("/warehouse/me/pickup-routes"),
    refetchInterval: 10000,
  });
  const teamsQ = useQuery({
    queryKey: ["warehousePickupTeams"],
    queryFn: () => api.get("/warehouse/me/pickup-team/members"),
    refetchInterval: 15000,
  });

  const routes = routesQ.data?.data?.routes || [];
  const teams = teamsQ.data?.data?.members || [];

  const createRoutes = async () => {
    try {
      await api.post("/warehouse/me/pickup-routes", { maxStops: 8, maxWeightKg: 0 });
      toast.success("Pickup route offer(s) sent to all approved pickup partners");
      await routesQ.refetch();
    } catch (e: any) {
      toast.error(e?.message || "No ready farms available");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-100 text-sm">
              <Route className="h-4 w-4" /> Daily pickup planning
            </div>
            <h1 className="mt-2 text-3xl font-bold">Pickup Routes</h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50">
              Each route is offered to every approved pickup partner. The first partner to accept claims the entire route.
            </p>
          </div>
          <Button variant="secondary" onClick={createRoutes}>
            <Plus className="mr-2 h-4 w-4" /> Create & Offer Routes
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-xs text-muted-foreground">Today's Routes</p><p className="text-2xl font-bold">{routes.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs text-muted-foreground">Farm Stops</p><p className="text-2xl font-bold">{routes.reduce((n: number, r: any) => n + (r.totalStops || 0), 0)}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs text-muted-foreground">Approved Pickup Partners</p><p className="text-2xl font-bold">{teams.length}</p></CardContent></Card>
      </div>

      <div className="space-y-4">
        {routes.length === 0 ? (
          <Card className="p-12 text-center">
            <Route className="mx-auto h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 font-semibold">No pickup routes today</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create routes from collections that are READY FOR PICKUP.</p>
          </Card>
        ) : routes.map((r: any) => (
          <Card key={r.id} className="overflow-hidden">
            <CardHeader className="border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">🚚 {r.routeNumber || "Pickup Route"}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{r.totalStops} farms · {r.totalQuantity || 0} kg</p>
                </div>
                <Badge>{String(r.status || "offered").replace(/_/g, " ")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {r.status === "arrived_warehouse" && (
                <div className="mb-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-blue-900"><PackageCheck className="h-4 w-4" />Ready for Warehouse Receiving</p>
                    <p className="mt-1 text-xs text-blue-800">The pickup partner returned this route. Receive and quality-check each incoming stock record, then Store it to update warehouse inventory.</p>
                  </div>
                  <Button variant="outline" onClick={() => { window.location.href = "/incoming"; }}>Open Incoming</Button>
                </div>
              )}
              <div className="space-y-3">
                {(r.stops || []).map((s: any, i: number) => (
                  <div key={s.collectionId} className="flex items-start gap-3 rounded-xl border p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.farmerName}</p>
                      <p className="text-sm text-muted-foreground">{s.productName} · {s.quantity} kg</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> Pickup location</p>
                    </div>
                    <Badge variant="outline">{String(s.status || "pending").replace(/_/g, " ")}</Badge>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {r.deliveryPartnerId ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Users className="h-4 w-4 text-amber-600" />}
                    {r.deliveryPartnerId ? "Route Accepted" : "Waiting for pickup partner acceptance"}
                  </p>
                  {r.deliveryPartnerId ? (
                    <div className="mt-2 space-y-1 text-sm">
                      <p><span className="font-medium">Accepted by:</span> {r.deliveryPartnerName || "Pickup Partner"}</p>
                      <p className="text-muted-foreground">
                        🚚 {r.deliveryPartnerVehicleType || "Vehicle not specified"} · {r.deliveryPartnerVehicleNumber || "Vehicle number not specified"}
                      </p>
                      <p className="text-xs font-medium text-emerald-700">This route is now assigned exclusively to this pickup partner.</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      All approved pickup partners can see and accept this route. First acceptance wins.
                    </p>
                  )}
                </div>
                <Badge variant={r.deliveryPartnerId ? "default" : "outline"}>
                  {r.deliveryPartnerId ? "Assigned" : "Open Offer"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
