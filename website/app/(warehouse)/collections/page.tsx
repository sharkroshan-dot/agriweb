"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
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

const getFarmProgress = (farmJobs: any[]) => {
  const statusRank = new Map<string, number>(STATUS.map(([key], index) => [key, index] as [string, number]));
  const rankedJobs = farmJobs.map((job) => {
    const status = String(job.status || job.pickupRouteStatus || "scheduled");
    return { status, rank: statusRank.get(status) ?? 0 };
  });
  const currentRank = rankedJobs.length ? Math.min(...rankedJobs.map((job) => job.rank)) : 0;
  const currentCount = rankedJobs.filter((job) => job.rank === currentRank).length;
  return {
    currentStage: STATUS[currentRank]?.[1] || "Waiting for Farmer",
    currentCount,
    total: rankedJobs.length,
    mixed: new Set(rankedJobs.map((job) => job.status)).size > 1,
  };
};

export default function WarehouseCollectionsPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [expandedFarmCards, setExpandedFarmCards] = useState<Record<string, boolean>>({});
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

  const farmGroups = useMemo(() => {
    const groups = new Map<string, { key: string; farmerName: string; pickupAddress: string; jobs: any[] }>();
    for (const job of jobs) {
      const farmerName = String(job.farmerName || "Farmer details unavailable").trim();
      const pickupAddress = String(job.pickupAddress || "").trim();
      const normalizedName = farmerName.toLowerCase().replace(/[\s,.-]+/g, " ").trim();
      const normalizedAddress = pickupAddress && pickupAddress !== "Farm address not provided"
        ? pickupAddress.toLowerCase().replace(/[\s,.-]+/g, " ").trim()
        : "";
      const farmerId = String(job.farmerId || "").trim();
      const key = normalizedAddress
        ? "farm:" + (normalizedName || farmerId || "unknown") + "|" + normalizedAddress
        : farmerId
          ? "farmer:" + farmerId
          : "farmer-name:" + (normalizedName || String(job.id || job._id));
      if (!groups.has(key)) {
        groups.set(key, { key, farmerName, pickupAddress: pickupAddress || "Farm address not provided", jobs: [] });
      }
      groups.get(key)!.jobs.push(job);
    }
    return Array.from(groups.values()).map((farm) => ({
      ...farm,
      totalQuantity: farm.jobs.reduce((total, job) => total + Number(job.quantity || 0), 0),
      readyCount: farm.jobs.filter((job) => ["ready_for_pickup", "team_assigned"].includes(job.status) && !job.pickupRouteId).length,
      selectedCount: farm.jobs.filter((job) => selectedCollectionIds.includes(String(job.id || job._id))).length,
      routeCount: new Set(farm.jobs.map((job) => job.pickupRouteId).filter(Boolean).map(String)).size,
      statuses: Array.from(new Set(farm.jobs.map((job) => job.status))),
    }));
  }, [jobs, selectedCollectionIds]);

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
      <div className="rounded-2xl bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-700 p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-base font-medium text-emerald-50"><Truck className="h-4 w-4" /> Farm logistics control center</div>
            <div className="flex items-center gap-2">
              <Warehouse className="h-5 w-5" />
              <span className="text-base font-semibold text-white">{warehouseName}</span>
            </div>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">Farm Collection</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-white sm:text-lg">Select eligible farm pickups, then plan routes and assign collection teams.</p>
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
          <Card key={title} className="border-slate-200 shadow-sm"><CardContent className="flex items-center gap-4 p-5"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"><Icon className="h-6 w-6" /></div><div><p className="text-sm font-semibold text-slate-700">{title}</p><p className="mt-1 text-3xl font-extrabold text-slate-950">{value}</p></div></CardContent></Card>
        ))}
      </div>

      <Card className="shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <Input className="h-12 flex-1 text-base placeholder:text-base" placeholder="Search farmer, order, product or team..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={filter} onValueChange={setFilter}><SelectTrigger className="h-12 w-full text-base sm:w-[280px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Collection Types</SelectItem><SelectItem value="bulk_harvest">Bulk Harvest · Warehouse Fulfillment</SelectItem><SelectItem value="packed_orders_transfer">Packed Orders · Long Distance</SelectItem></SelectContent></Select>
        </CardContent>
      </Card>

      <Card className="border-emerald-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl font-bold sm:text-2xl">Bulk Actions</CardTitle>
              <p className="mt-2 text-base leading-6 text-slate-700">Select available orders, choose how pickups should be assigned, and plan the routes in one action.</p>
            </div>
            <Button className="min-h-11 px-4 text-base font-semibold" type="button" variant="outline" onClick={toggleVisibleSelection} disabled={readyVisibleJobs.length === 0}>
              {allVisibleSelected ? "Clear visible selection" : "Select all visible"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-slate-50 p-4">
              <p className="text-base font-semibold text-slate-800">Available for planning</p>
              <p className="mt-1 text-3xl font-extrabold text-slate-950">{counts.ready}</p>
            </div>
            <div className="rounded-xl border bg-slate-50 p-4">
              <p className="text-base font-semibold text-slate-800">Selected</p>
              <p className="mt-1 text-3xl font-extrabold text-slate-950">{selectedCollectionIds.length}</p>
            </div>
            <div className="rounded-xl border bg-slate-50 p-4">
              <p className="text-base font-semibold text-slate-800">Routes planned</p>
              <p className="mt-1 text-3xl font-extrabold text-slate-950">{counts.planned}</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <label className="space-y-2 text-base font-semibold text-slate-800">
              Assignment Method
              <select value={assignmentMode} onChange={(e) => setAssignmentMode(e.target.value as "auto_assign" | "offer" | "assign_team")} className="h-12 w-full rounded-md border border-input bg-background px-3 text-base font-normal">
                <option value="auto_assign">Auto-plan routes and assign teams</option>
                <option value="offer">Auto-plan routes and offer to approved pickup partners</option>
                <option value="assign_team">Assign selected jobs to one team</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Vehicle carrying capacity
              <select value={selectedTeamId} onChange={(e) => setSelectedTeamId(e.target.value)} className="h-12 w-full rounded-md border border-input bg-background px-3 text-base font-normal">
                <option value="">Select pickup vehicle</option>
                {eligibleTeams.map((team: any) => (
                  <option key={team.id} value={team.id}>{team.name || "Pickup Team"} · {team.vehicleType || "Vehicle"} · {team.capacity} kg</option>
                ))}
              </select>
              {selectedTeam && <span className="mt-1 block text-sm font-medium leading-6 text-slate-700">{selectedTeam.name || "Selected team"} · {selectedTeam.vehicleType || "Vehicle"} · {selectedTeam.capacity} kg</span>}
              {eligibleTeams.length === 0 && <span className="mt-1 block text-sm font-medium leading-6 text-amber-800">No approved team with a registered capacity. Approve a pickup team and add its vehicle capacity first.</span>}
            </label>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base leading-6 text-slate-700">Selected jobs are grouped into capacity-safe routes. Orders already on an open route cannot be planned twice.</p>
            <Button className="min-h-12 px-5 text-base font-semibold" onClick={planSelectedPickups} disabled={planning || selectedCollectionIds.length === 0 || !selectedTeam}>
              <Route className="mr-2 h-4 w-4" />{planning ? "Planning pickups..." : "Plan Selected Pickups"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : jobs.length === 0 ? (
        <Card className="p-12 text-center">
          <Truck className="mx-auto h-12 w-12 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">No collection jobs</h2>
          <p className="mt-2 text-base leading-7 text-slate-700">New jobs appear automatically when a farmer confirms a warehouse pickup or a long-distance farmer order needs warehouse transfer.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {farmGroups.map((farm: any) => {
            const expanded = Boolean(expandedFarmCards[farm.key]);
            const expandableId = "farm-orders-" + farm.key.replace(/[^a-zA-Z0-9_-]/g, "-");
            const progress = getFarmProgress(farm.jobs);
            return (
              <Card key={farm.key} className="overflow-hidden border-2 border-emerald-200 shadow-sm">
                <CardHeader className="border-b bg-emerald-50 p-6 sm:p-7">
                  <div className="grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.75fr)] xl:grid-cols-[minmax(0,1fr)_280px_minmax(0,1fr)] xl:items-center xl:gap-8">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-emerald-800 px-3 py-1 text-sm font-bold text-white"><MapPin className="mr-1 h-4 w-4" /> FARM</Badge>
                        {farm.readyCount > 0 && <Badge variant="outline" className="px-3 py-1 text-sm font-semibold">{farm.readyCount} ready for planning</Badge>}
                        {farm.routeCount > 0 && <Badge className="bg-violet-100 px-3 py-1 text-sm font-semibold text-violet-900">{farm.routeCount === 1 ? "Route planned" : farm.routeCount + " routes planned"}</Badge>}
                      </div>
                      <CardTitle className="mt-3 text-2xl font-extrabold leading-tight text-slate-950 sm:text-3xl">{farm.farmerName}</CardTitle>
                      <p className="mt-2 flex items-start gap-2 text-base font-medium leading-7 text-slate-800">
                        <MapPin className="mt-1 h-5 w-5 shrink-0 text-emerald-800" />
                        <span>{farm.pickupAddress}</span>
                      </p>
                      <p className="mt-3 text-lg font-bold leading-7 text-slate-950">
                        {farm.jobs.length} {farm.jobs.length === 1 ? "order / collection" : "orders / collections"} · {farm.totalQuantity.toLocaleString()} kg expected
                      </p>
                      {farm.selectedCount > 0 && <p className="mt-2 text-sm font-bold text-emerald-900">{farm.selectedCount} selected for route planning</p>}

                    </div>
                    <div className="flex w-full items-center justify-center lg:col-start-2 lg:row-start-1 xl:col-auto xl:row-auto xl:justify-self-center">
                      <div className="flex w-full max-w-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-4 text-center shadow-sm">
                        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
                          <Clock3 className="h-4 w-4 text-emerald-800" />
                          Current status
                        </div>
                        <Badge className="bg-emerald-800 px-4 py-1.5 text-sm font-bold text-white">{progress.currentStage}</Badge>
                        {progress.mixed && progress.currentCount < progress.total && (
                          <p className="text-sm font-medium leading-5 text-slate-700">
                            {progress.currentCount} of {progress.total} orders at this stage
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-start lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1 xl:justify-end">
                      <Button
                        className="min-h-12 shrink-0 px-5 text-base font-bold"
                        type="button"
                        variant={expanded ? "default" : "outline"}
                        aria-expanded={expanded}
                        aria-controls={expandableId}
                        onClick={() => setExpandedFarmCards((previous) => ({ ...previous, [farm.key]: !previous[farm.key] }))}
                      >
                        {expanded ? "Hide orders" : "View " + farm.jobs.length + (farm.jobs.length === 1 ? " order" : " orders")}
                        <ChevronDown className={"ml-2 h-4 w-4 transition-transform " + (expanded ? "rotate-180" : "")} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {expanded && (
                  <CardContent id={expandableId} className="space-y-5 bg-slate-50/50 p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-lg font-bold text-slate-950">All orders from {farm.farmerName}</p>
                      <p className="text-sm leading-6 text-slate-700">Select eligible orders below for bulk pickup planning.</p>
                    </div>

                    {farm.jobs.map((job: any) => {
                      const isPackedTransfer = job.collectionType === "packed_orders_transfer";
                      const currentIndex = STATUS.findIndex(([key]) => key === job.status);
                      return (
                        <Card key={job.id || job._id} className="overflow-hidden border border-slate-200 shadow-sm">
                          <CardHeader className="border-b bg-white p-5">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  {["ready_for_pickup", "team_assigned"].includes(job.status) && !job.pickupRouteId && (
                                    <label className="mr-1 inline-flex cursor-pointer items-center gap-3 text-base font-semibold text-slate-800">
                                      <input
                                        type="checkbox"
                                        aria-label={"Select " + (job.orderNumber || job.productName || "collection job")}
                                        checked={selectedCollectionIds.includes(String(job.id || job._id))}
                                        onChange={(event) => toggleCollectionSelection(String(job.id || job._id), event.target.checked)}
                                        className="h-5 w-5 rounded border-slate-300 accent-emerald-600"
                                      />
                                      Select for pickup
                                    </label>
                                  )}
                                  <Badge className={isPackedTransfer ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}>
                                    {isPackedTransfer ? "Packed Order Transfer" : "Bulk Harvest Pickup"}
                                  </Badge>
                                  <Badge variant="outline" className="px-3 py-1 text-sm font-semibold">{label(job.status)}</Badge>
                                  {job.pickupRouteId && job.status !== "arrived_warehouse" && (
                                    <Badge className="bg-violet-100 text-violet-800">{job.routeNumber ? "Route " + job.routeNumber : "Route planned"}</Badge>
                                  )}
                                </div>
                                <CardTitle className="mt-3 text-lg font-bold text-slate-950">{job.orderNumber ? (job.orderNumber === "Order reference unavailable" ? job.orderNumber : "Order " + job.orderNumber) : "Order details unavailable"}</CardTitle>
                                <p className="mt-2 text-base font-medium leading-6 text-slate-800">{job.productName || "Product details unavailable"} · Farmer: {job.farmerName || "Farmer details unavailable"}</p>
                                {job.batchNumber && <p className="mt-2 text-sm text-slate-700">Batch / Lot: {job.batchNumber}</p>}
                              </div>
                              <div className="rounded-xl border bg-slate-50 px-5 py-4 text-right">
                                <p className="text-sm font-semibold text-slate-700">Expected quantity</p>
                                <p className="text-2xl font-extrabold text-slate-950">{job.quantity || 0} kg</p>
                                {job.actualCollectedQuantity != null && <p className="mt-2 text-sm font-bold text-emerald-800">Collected: {job.actualCollectedQuantity} kg</p>}
                                <p className="mt-1 text-sm text-slate-700">{job.packageCount || 1} package(s)</p>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-5 p-5">
                            <div className="grid gap-4 sm:grid-cols-3">
                              <div className="rounded-lg bg-slate-50 p-3">
                                <p className="text-sm font-semibold text-slate-700">Pickup location</p>
                                <p className="mt-2 flex items-start gap-2 text-base font-semibold leading-6 text-slate-900"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {job.pickupAddress || "Farm address not provided"}</p>
                              </div>
                              <div className="rounded-lg bg-slate-50 p-3">
                                <p className="text-sm font-semibold text-slate-700">Collection team</p>
                                <p className="mt-1 flex items-start gap-1 text-sm font-medium"><User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {job.collectionTeamName || (job.collectionTeamId ? "Assigned pickup partner" : "Not assigned")}{job.collectionTeamVehicleNumber ? " · " + job.collectionTeamVehicleNumber : ""}</p>
                              </div>
                              <div className="rounded-lg bg-slate-50 p-3">
                                <p className="text-sm font-semibold text-slate-700">Next destination</p>
                                <p className="mt-1 flex items-start gap-1 text-sm font-medium"><Warehouse className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {job.warehouseName || warehouseName || "Assigned warehouse"}</p>
                              </div>
                            </div>

                            <div className="overflow-x-auto pb-2">
                              <div className="flex min-w-[760px] items-center">
                                {STATUS.map(([key, title], index) => {
                                  const done = currentIndex >= index;
                                  return (
                                    <div key={key} className="flex flex-1 items-center">
                                      <div className="flex min-w-0 flex-col items-center">
                                        <div className={"flex h-9 w-9 items-center justify-center rounded-full border-2 " + (done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-400")}>
                                          {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs">{index + 1}</span>}
                                        </div>
                                        <span className={"mt-2 max-w-24 text-center text-sm leading-5 " + (done ? "font-bold text-emerald-800" : "font-medium text-slate-600")}>{title}</span>
                                      </div>
                                      {index < STATUS.length - 1 && <div className={"mx-2 h-0.5 flex-1 " + (currentIndex > index ? "bg-emerald-500" : "bg-slate-200")} />}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="text-sm">
                                <p className="text-base font-bold text-slate-900">{isPackedTransfer ? "Already-packed customer order" : "Bulk warehouse fulfillment stock"}</p>
                                <p className="mt-2 text-sm leading-6 text-slate-700">
                                  {isPackedTransfer
                                    ? "Packing verified: " + (job.packingVerified ? "Complete" : "Pending") + " · Warehouse packing required: No"
                                    : "Packing required: Yes · Farmer verification: " + (job.packingVerified ? "Complete" : "Pending")}
                                </p>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                {job.pickupRouteId ? (
                                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 sm:max-w-[480px]">
                                    Tracking is read-only here. The assigned pickup partner updates En Route, At Farm, Collected and Departed from Delivery Partner → Pickup Routes. Warehouse arrival is recorded when the partner returns the route.
                                  </div>
                                ) : job.collectionTeamId ? (
                                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 sm:max-w-[480px]">
                                    This older assignment has no pickup route yet. Select this job above to create its route.
                                  </div>
                                ) : ["ready_for_pickup", "team_assigned"].includes(job.status) ? (
                                  <p className="text-base leading-6 text-slate-700">Select this job above, then use Bulk Actions to plan and assign its pickup route.</p>
                                ) : (
                                  <p className="text-base leading-6 text-slate-700">Collection progress is shown here for monitoring.</p>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
