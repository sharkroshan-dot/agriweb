"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  MapPin,
  Package,
  RefreshCw,
  Route,
  Truck,
  User,
  Warehouse,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const STATUS = [
  ["scheduled", "Waiting for Farmer"],
  ["ready_for_pickup", "Ready for Pickup"],
  ["team_assigned", "Team Assigned"],
  ["en_route", "En Route"],
  ["arrived_at_farm", "At Farm"],
  ["collected", "Collected"],
  ["departed_farm", "Departed"],
  ["arrived_warehouse", "At Warehouse"],
] as const;

const label = (value: string) => STATUS.find(([key]) => key === value)?.[1] || value.replace(/_/g, " ");

export default function WarehouseCollectionsPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<"auto_assign" | "offer" | "assign_team">("auto_assign");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [planning, setPlanning] = useState(false);
  const { data: warehouseData } = useQuery({
    queryKey: ["warehouseCollectionsIdentity"],
    queryFn: () => api.get("/warehouse/me"),
    staleTime: 60000,
  });
  const warehouseName = warehouseData?.name || "Warehouse";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseCollectionsPage"],
    queryFn: () => api.get("/warehouse/me/collections", { params: { status: "all" } }),
    // Delivery partners own route progress. Poll frequently so every farm card
    // reflects their latest stop update without a manual page refresh.
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const { data: teamsData, refetch: refetchTeams } = useQuery({
    queryKey: ["warehouseCollectionPickupTeams"],
    queryFn: () => api.get("/warehouse/me/pickup-team/members"),
    refetchInterval: 30000,
  });
  const pickupTeams = teamsData?.data?.members || [];
  const eligibleTeams = pickupTeams.filter((team: any) => Number(team.capacity) > 0);
  const selectedTeam = eligibleTeams.find((team: any) => team.id === selectedTeamId);

  const jobs = useMemo(() => {
    const source = data?.data?.collections || [];
    const q = search.trim().toLowerCase();
    return source.filter((job: any) => {
      const typeOk = filter === "all" || job.collectionType === filter;
      const text = [job.farmerName, job.farmerId, job.orderId, job.productName, job.productId, job.status].filter(Boolean).join(" ").toLowerCase();
      return typeOk && (!q || text.includes(q));
    });
  }, [data, filter, search]);

  const counts = useMemo(() => {
    const source = data?.data?.collections || [];
    return {
      total: source.length,
      ready: source.filter((x: any) => ["ready_for_pickup", "team_assigned"].includes(x.status) && !x.pickupRouteId).length,
      planned: new Set(source.filter((x: any) => Boolean(x.pickupRouteId) && x.status !== "arrived_warehouse").map((x: any) => String(x.pickupRouteId))).size,
      waiting: source.filter((x: any) => x.status === "scheduled").length,
      active: source.filter((x: any) => !["ready_for_pickup", "arrived_warehouse"].includes(x.status)).length,
      warehouse: source.filter((x: any) => x.status === "arrived_warehouse").length,
    };
  }, [data]);

  const readyVisibleJobs = jobs.filter((job: any) => ["ready_for_pickup", "team_assigned"].includes(job.status) && !job.pickupRouteId);
  const selectedVisibleIds = readyVisibleJobs.map((job: any) => String(job.id || job._id));
  const allVisibleSelected = selectedVisibleIds.length > 0 && selectedVisibleIds.every((id: string) => selectedCollectionIds.includes(id));

  const toggleVisibleSelection = () => {
    setSelectedCollectionIds((current) => allVisibleSelected
      ? current.filter((id) => !selectedVisibleIds.includes(id))
      : Array.from(new Set([...current, ...selectedVisibleIds])));
  };

  const toggleCollectionSelection = (id: string, checked: boolean) => {
    setSelectedCollectionIds((current) => checked
      ? Array.from(new Set([...current, id]))
      : current.filter((item) => item !== id));
  };

  const planSelectedPickups = async () => {
    if (selectedCollectionIds.length === 0) {
      toast.error("Select at least one Ready for Pickup job.");
      return;
    }
    if (!selectedTeam || Number(selectedTeam.capacity) <= 0) {
      toast.error("Select a pickup vehicle with a registered carrying capacity.");
      return;
    }
    if (assignmentMode === "assign_team" && !selectedTeam.deliveryPartnerId) {
      toast.error("The selected pickup team has no linked delivery partner.");
      return;
    }
    setPlanning(true);
    try {
      const response = await api.post("/warehouse/me/pickup-routes", {
        collectionIds: selectedCollectionIds,
        maxWeightKg: Number(selectedTeam.capacity),
        assignmentMode,
        ...(assignmentMode === "assign_team" ? { deliveryPartnerId: selectedTeam.deliveryPartnerId } : {}),
      });
      const message = response?.message || response?.data?.message || `Pickup planning completed for ${selectedCollectionIds.length} selected job(s).`;
      toast.success(message);
      setSelectedCollectionIds([]);
      await Promise.all([refetch(), refetchTeams()]);
    } catch (e: any) {
      toast.error(e?.message || "Failed to plan the selected pickups");
    } finally {
      setPlanning(false);
    }
  };



  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-emerald-100"><Truck className="h-4 w-4" /> Farm logistics control center</div>
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5" />
              <span className="text-sm font-semibold text-emerald-100">{warehouseName}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Farm Collection</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50">Select multiple ready farm pickups and plan capacity-safe routes in one action.</p>
          </div>
          <Button variant="secondary" size="icon" onClick={() => refetch()} aria-label="Refresh collection queue"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Total Jobs", counts.total, Package],
          ["Available for Planning", counts.ready, Clock3],
          ["Selected", selectedCollectionIds.length, CheckCircle2],
          ["Routes Planned", counts.planned, Route],
          ["At Warehouse", counts.warehouse, Warehouse],
        ].map(([title, value, Icon]: any) => (
          <Card key={title} className="border-slate-200 shadow-sm"><CardContent className="flex items-center gap-4 p-5"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></div><div><p className="text-xs font-medium text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold">{value}</p></div></CardContent></Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <Input className="flex-1" placeholder="Search farmer, order, product or team..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-full sm:w-[260px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Collection Types</SelectItem><SelectItem value="bulk_harvest">Bulk Harvest · Warehouse Fulfillment</SelectItem><SelectItem value="packed_orders_transfer">Packed Orders · Long Distance</SelectItem></SelectContent></Select>
        </CardContent>
      </Card>

      <Card className="border-emerald-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Bulk Actions</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Select available jobs once, then plan routes and assign the pickup work in one action.</p>
            </div>
            <Button type="button" variant="outline" onClick={toggleVisibleSelection} disabled={readyVisibleJobs.length === 0}>
              {allVisibleSelected ? "Clear visible selection" : "Select all visible"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-muted-foreground">Available for planning</p>
              <p className="mt-1 text-2xl font-bold">{counts.ready}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-muted-foreground">Selected</p>
              <p className="mt-1 text-2xl font-bold">{selectedCollectionIds.length}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <p className="text-xs text-muted-foreground">Routes planned</p>
              <p className="mt-1 text-2xl font-bold">{counts.planned}</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
            <label className="space-y-1.5 text-sm font-medium">
              Assignment Method
              <select value={assignmentMode} onChange={(e) => setAssignmentMode(e.target.value as "auto_assign" | "offer" | "assign_team")} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-normal">
                <option value="auto_assign">Auto-plan routes and assign teams</option>
                <option value="offer">Auto-plan routes and offer to approved pickup partners</option>
                <option value="assign_team">Assign selected jobs to one team</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Vehicle carrying capacity
              <select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm font-normal">
                <option value="">Select pickup vehicle</option>
                {eligibleTeams.map((team: any) => (
                  <option key={team.id} value={team.id}>{team.name || "Pickup Team"} · {team.vehicleType || "Vehicle"} · {team.capacity} kg</option>
                ))}
              </select>
              {selectedTeam && <span className="block text-xs font-normal text-muted-foreground">{selectedTeam.name || "Selected team"} · {selectedTeam.vehicleType || "Vehicle"} · {selectedTeam.capacity} kg</span>}
              {eligibleTeams.length === 0 && <span className="block text-xs font-normal text-amber-700">No approved team with a registered capacity. Approve a pickup team and add its vehicle capacity first.</span>}
            </label>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Selected jobs are grouped into capacity-safe routes. Jobs already on an open route cannot be planned twice.</p>
            <Button onClick={planSelectedPickups} disabled={planning || selectedCollectionIds.length === 0 || !selectedTeam}>
              <Route className="mr-2 h-4 w-4" />{planning ? "Planning pickups..." : "Plan Selected Pickups"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div> : jobs.length === 0 ? (
        <Card className="p-12 text-center"><Truck className="mx-auto h-12 w-12 text-muted-foreground" /><h2 className="mt-4 font-semibold">No collection jobs</h2><p className="mt-2 text-sm text-muted-foreground">New jobs appear automatically when a farmer confirms a warehouse pickup or a long-distance farmer order needs warehouse transfer.</p></Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job: any) => {
            const isPackedTransfer = job.collectionType === "packed_orders_transfer";
            const currentIndex = STATUS.findIndex(([key]) => key === job.status);
            return (
              <Card key={job.id} className="overflow-hidden shadow-sm">
                <CardHeader className="border-b bg-slate-50/70 p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {["ready_for_pickup", "team_assigned"].includes(job.status) && !job.pickupRouteId && <label className="mr-1 inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                          <input
                            type="checkbox"
                            aria-label={`Select ${job.farmerName || job.orderId || "collection job"}`}
                            checked={selectedCollectionIds.includes(String(job.id || job._id))}
                            onChange={(event) => toggleCollectionSelection(String(job.id || job._id), event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                          />
                          Select
                        </label>}
                        <Badge className={isPackedTransfer ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}>{isPackedTransfer ? "Packed Order Transfer" : "Bulk Harvest Pickup"}</Badge>
                        <Badge variant="outline">{label(job.status)}</Badge>
                        {job.pickupRouteId && job.status !== "arrived_warehouse" && <Badge className="bg-violet-100 text-violet-800">Route Planned</Badge>}
                      </div>
                      <CardTitle className="mt-2 text-base">{job.productName || job.productId || "Farm Product"}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">Farmer: {job.farmerName || job.farmerId || "—"} {job.orderId ? <>· Order #{String(job.orderId).slice(-8)}</> : ""}</p>
                      {job.batchId && <p className="mt-1 text-xs text-muted-foreground">Batch: {String(job.batchId).slice(-12)}</p>}
                    </div>
                    <div className="rounded-xl border bg-white px-4 py-3 text-right">
                      <p className="text-xs text-muted-foreground">Expected Quantity</p>
                      <p className="text-lg font-bold">{job.quantity || 0} kg</p>
                      {job.actualCollectedQuantity != null && <p className="mt-1 text-xs font-semibold text-emerald-700">Collected: {job.actualCollectedQuantity} kg</p>}
                      <p className="text-xs text-muted-foreground">{job.packageCount || 1} package(s)</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="mb-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Pickup</p><p className="mt-1 flex items-center gap-1 text-sm font-medium"><MapPin className="h-3.5 w-3.5 text-emerald-600" /> Farm location</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Collection Team</p><p className="mt-1 flex items-center gap-1 text-sm font-medium"><User className="h-3.5 w-3.5 text-emerald-600" /> {job.collectionTeamId || "Not assigned"}</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Next destination</p><p className="mt-1 flex items-center gap-1 text-sm font-medium"><Warehouse className="h-3.5 w-3.5 text-emerald-600" /> {warehouseName}</p></div>
                  </div>

                  <div className="mb-5 overflow-x-auto pb-2">
                    <div className="flex min-w-[760px] items-center">
                      {STATUS.map(([key, title], index) => {
                        const done = currentIndex >= index;
                        return <div key={key} className="flex flex-1 items-center"><div className="flex min-w-0 flex-col items-center"><div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-400"}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs">{index + 1}</span>}</div><span className={`mt-2 text-center text-[11px] ${done ? "font-semibold text-emerald-700" : "text-slate-400"}`}>{title}</span></div>{index < STATUS.length - 1 && <div className={`mx-2 h-0.5 flex-1 ${currentIndex > index ? "bg-emerald-500" : "bg-slate-200"}`} />}</div>;
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm">
                      <p className="font-medium">{isPackedTransfer ? "Already-packed customer order" : "Bulk warehouse fulfillment stock"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{isPackedTransfer ? "Packing Verified: " + (job.packingVerified ? "Complete" : "Pending") + " · Warehouse Packing Required: No" : "Packing Required: Yes · Farmer Verification: " + (job.packingVerified ? "Complete" : "Pending")}</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {job.pickupRouteId ? (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 sm:max-w-[420px]">
                          Tracking is read-only here. The assigned pickup partner updates En Route, At Farm, Collected and Departed from Delivery Partner → Pickup Routes. Warehouse arrival is recorded when the partner returns the route.
                        </div>
                      ) : job.collectionTeamId ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:max-w-[420px]">
                          This older assignment has no pickup route yet. Select this job in Bulk Actions to create its route and move tracking to the pickup partner.
                        </div>
                      ) : ["ready_for_pickup", "team_assigned"].includes(job.status) ? (
                        <p className="text-xs text-muted-foreground">Select this job above, then use Bulk Actions to plan and assign its pickup route.</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Collection progress is shown here for monitoring.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
