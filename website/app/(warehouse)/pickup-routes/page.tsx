"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, Plus, CheckCircle2, Users, PackageCheck, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const routeStatusLabel = (value: string) => ({
  offered: "Waiting for partner",
  assigned: "Assigned to partner",
  started: "Pickup in progress",
  arrived_at_farm: "At farm",
  collected: "Collection recorded",
  departed_farm: "All farms departed",
  completed: "Route completed",
  returned_to_warehouse: "Returned to warehouse",
  received: "Received",
  stored: "Stored in inventory",
} as Record<string, string>)[value] || value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const stopStatusLabel = (value: string) => ({
  pending: "Waiting for pickup",
  ready_for_pickup: "Ready for pickup",
  team_assigned: "Team assigned",
  en_route: "On the way",
  started: "Pickup started",
  arrived_at_farm: "Arrived at farm",
  collected: "Collected",
  departed_farm: "Departed farm",
  arrived_warehouse: "At warehouse",
} as Record<string, string>)[value] || value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

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
  const [selectedTeamId, setSelectedTeamId] = React.useState("");

  const selectedTeam = teams.find((team: any) => team.id === selectedTeamId);

  const createRoutes = async () => {
    const capacity = Number(selectedTeam?.capacity || 0);
    if (!selectedTeamId || capacity <= 0) {
      toast.error("Select an approved pickup vehicle with a registered carrying capacity.");
      return;
    }
    try {
      await api.post("/warehouse/me/pickup-routes", { maxWeightKg: capacity });
      toast.success("Pickup route(s) created. Approved partners will receive offers; otherwise eligible delivery partners can pick them up.");
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
              Routes are sized by the selected vehicle capacity. The system adds as many farm stops as that vehicle can carry; there is no fixed stop limit. The first eligible partner to accept wins the route.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="text-xs text-emerald-50">
              <span className="mb-1 flex items-center gap-1"><Truck className="h-3 w-3" /> Planning vehicle</span>
              <select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} className="h-10 min-w-56 rounded-lg border border-white/30 bg-white px-3 text-sm text-slate-900">
                <option value="">Select vehicle</option>
                {teams.map((team: any) => (
                  <option key={team.id} value={team.id} disabled={!team.capacity}>
                    {team.name || "Pickup Partner"} · {team.vehicleType || "Vehicle"} · {team.capacity ? `${team.capacity} kg` : "Capacity not registered"}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" onClick={createRoutes} disabled={!selectedTeamId || !selectedTeam?.capacity}>
              <Plus className="mr-2 h-4 w-4" /> Create & Offer Routes
            </Button>
          </div>
        </div>
      </div>

      {selectedTeam && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><strong>{selectedTeam.name || "Selected vehicle"}</strong> · {selectedTeam.vehicleType || "Vehicle"} · <strong>{selectedTeam.capacity} kg capacity</strong>. Route planning will continue adding farm stops until this capacity is reached.</div>}

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
            <p className="mt-2 text-sm text-muted-foreground">Use Farm Collection to select eligible pickups and plan routes. Route numbers, farm names, addresses and quantities are shown on each route.</p>
          </Card>
        ) : routes.map((r: any) => (
          <Card key={r.id} className="overflow-hidden">
            <CardHeader className="border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">🚚 {r.routeNumber || "Pickup Route"}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{r.totalStops} farms · {r.totalQuantity || 0} kg</p>
                </div>
                <Badge>{routeStatusLabel(String(r.status || "offered"))}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {r.status === "returned_to_warehouse" && (
                <div className="mb-4 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 font-semibold text-blue-900"><PackageCheck className="h-4 w-4" />Ready for Warehouse Receiving</p>
                    <p className="mt-1 text-xs text-blue-800">The pickup partner returned this route. Receive each incoming stock record, complete quality check, then Store it to update warehouse inventory.</p>
                  </div>
                  <Button variant="outline" onClick={() => { window.location.href = "/incoming"; }}>Open Incoming</Button>
                </div>
              )}
              <div className="space-y-3">
                {(r.stops || []).map((s: any, i: number) => (
                  <div key={s.collectionId} className="flex items-start gap-3 rounded-xl border p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i + 1}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.farmerName || "Farmer details unavailable"}</p>
                      <p className="text-sm text-muted-foreground">{s.productName || "Product details unavailable"} · Expected {s.quantity || 0} kg</p>
                      {s.orderNumber && <p className="mt-1 text-xs text-muted-foreground">{s.orderNumber === "Order reference unavailable" ? s.orderNumber : `Order ${s.orderNumber}`}</p>}
                      {s.batchNumber && <p className="mt-1 text-xs text-muted-foreground">Batch / Lot: {s.batchNumber}</p>}
                      {s.actualQuantity != null && <p className="mt-1 text-xs font-semibold text-emerald-700">Actually collected: {s.actualQuantity} kg</p>}
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {s.pickupAddress || "Farm address not provided"}</p>
                    </div>
                    <Badge variant="outline">{stopStatusLabel(String(s.status || "pending"))}</Badge>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {r.deliveryPartnerId ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Users className="h-4 w-4 text-amber-600" />}
                    {r.deliveryPartnerId
                      ? "Route Accepted"
                      : r.assignmentMode === "delivery_marketplace"
                        ? "Open to Delivery Partners"
                        : "Waiting for Pickup Partner Acceptance"}
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
                      {r.assignmentMode === "delivery_marketplace"
                        ? "No approved pickup partner is available. Eligible delivery partners can accept this route based on vehicle capacity and availability."
                        : "All approved pickup partners can see and accept this route. First acceptance wins."}
                    </p>
                  )}
                </div>
                <Badge variant={r.deliveryPartnerId ? "default" : "outline"}>
                  {r.deliveryPartnerId ? "Assigned" : r.assignmentMode === "delivery_marketplace" ? "Delivery Marketplace" : "Open Offer"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
