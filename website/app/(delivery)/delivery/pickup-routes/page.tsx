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

  const act = async (route: any, status: string, collectionId?: string) => {
    try {
      await api.put(
        "/delivery/me/pickup-routes/" + route.id + "/status",
        undefined,
        { params: { status, collectionId, actualQuantity: collectionId ? Number(actual[collectionId] || 0) : undefined } }
      );
      toast.success(status.replace(/_/g, " "));
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
                      {job.totalStops || job.farmStops?.length || 0} farm stops · {job.totalQuantity || job.weightKg || 0} kg · {job.distanceKm || 0} km route
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
                  {(job.farmStops || []).map((stop: any, i: number) => (
                    <div key={stop.collectionId || i} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{stop.farmerName || "Farm"}</p>
                        <p className="text-xs text-muted-foreground">{stop.productName || "Farm Product"} · {stop.quantity || 0} kg</p>
                      </div>
                    </div>
                  ))}
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
                    <p className="text-sm text-muted-foreground">{job.totalStops || 0} farms · {job.totalQuantity || job.weightKg || 0} kg → {job.warehouseName || "Warehouse"}</p>
                  </div>
                  <Badge variant="success">Accepted</Badge>
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
                      <p className="text-sm text-muted-foreground">{r.totalStops} farm stops · {r.totalQuantity || 0} kg</p>
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
                    {(r.stops || []).map((s: any, i: number) => (
                      <div key={s.collectionId} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i + 1}</span>
                        <div>
                          <p className="text-sm font-medium">{s.farmerName}</p>
                          <p className="text-xs text-muted-foreground">{s.productName} · {s.quantity} kg</p>
                        </div>
                      </div>
                    ))}
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
            {offers.length ? "Accept an available route. If another partner accepts first, you will see who accepted it and you will no longer be able to accept it." : "The warehouse will offer routes when farms are ready for pickup."}
          </p>
        </Card>
      ) : (
        routes.map((r: any) => (
          <Card key={r.id}>
            <CardHeader className="border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>🚚 {r.routeNumber}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{r.totalStops} farms · {r.totalQuantity || 0} kg</p>
                </div>
                <Badge><CheckCircle2 className="mr-1 h-3 w-3" /> {String(r.status).replace(/_/g, " ")}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              <div className="mb-5 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                <Warehouse className="h-4 w-4" /> This route is exclusively assigned to you. Other partners cannot accept it.
              </div>
              {r.status === "assigned" && <Button className="mb-5" onClick={() => act(r, "started")}><Navigation className="mr-2 h-4 w-4" /> Start Pickup Route</Button>}
              <div className="space-y-3">
                {(r.stops || []).map((s: any, i: number) => {
                  const active = s.status === "pending" || s.status === "started";
                  return (
                    <div key={s.collectionId} className="rounded-xl border p-4">
                      <div className="flex gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">{i + 1}</div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{s.farmerName}</p>
                          <p className="text-sm text-muted-foreground">{s.productName} · Expected {s.quantity} kg</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> Farm pickup location</p>
                        </div>
                        <Badge variant="outline">{String(s.status || "pending").replace(/_/g, " ")}</Badge>
                      </div>
                      {r.status !== "assigned" && active && (
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          {s.status === "pending" && <Button variant="outline" onClick={() => act(r, "arrived_at_farm", s.collectionId)}>Arrived at Farm</Button>}
                          {s.status === "arrived_at_farm" && <><Input className="sm:w-40" type="number" placeholder="Actual kg" value={actual[s.collectionId] || ""} onChange={e => setActual({ ...actual, [s.collectionId]: e.target.value })} /><Button onClick={() => act(r, "collected", s.collectionId)}><CheckCircle2 className="mr-2 h-4 w-4" /> Confirm Collection</Button></>}
                          {s.status === "collected" && <Button onClick={() => act(r, "departed_farm", s.collectionId)}>Depart Farm</Button>}
                        </div>
                      )}
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
