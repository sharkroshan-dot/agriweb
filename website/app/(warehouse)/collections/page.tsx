"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
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

const getFarmRouteKey = (job: any): string => {
  for (const field of ["farmId", "farmProfileId", "sourceFarmId"]) {
    const farmId = String(job?.[field] || "").trim();
    if (farmId) return "farm:" + farmId.toLowerCase();
  }

  const location = job?.pickupLocation && typeof job.pickupLocation === "object" ? job.pickupLocation : {};
  const address = location.formattedAddress || location.address || location.farmAddress || job?.pickupAddress;
  if (address && String(address).trim()) {
    return "address:" + String(address).trim().toLowerCase().split(/\s+/).join(" ");
  }

  const farmerId = String(job?.farmerId || "").trim();
  if (farmerId) return "farmer:" + farmerId.toLowerCase();

  const farmerName = String(job?.farmerName || job?.farmName || "").trim();
  if (farmerName && !["farmer", "farm", "unknown farmer"].includes(farmerName.toLowerCase())) {
    return "name:" + farmerName.toLowerCase().split(/\s+/).join(" ");
  }

  const coordinates = location.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lat = Number(coordinates[1]);
    const lng = Number(coordinates[0]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return "location:" + lng.toFixed(4) + ":" + lat.toFixed(4);
    }
  }
  return "collection:" + String(job?.id || job?._id || "unknown");
};

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
  const [routePlanningMode, setRoutePlanningMode] = useState<"automatic" | "manual">("automatic");
  const [manualFarmOrder, setManualFarmOrder] = useState<string[]>([]);
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
      // Keep the UI farm grouping aligned with the backend route builder.
      const key = getFarmRouteKey(job);
      if (!groups.has(key)) {
        groups.set(key, { key, farmerName, pickupAddress: pickupAddress || "Farm address not provided", jobs: [] });
      }
      groups.get(key)!.jobs.push(job);
    }
    return Array.from(groups.values()).map((farm) => {
      const readyJobs = farm.jobs.filter((job) =>
        ["ready_for_pickup", "team_assigned"].includes(job.status) && !job.pickupRouteId
      );
      const readyJobIds = readyJobs.map((job) => String(job.id || job._id));
      const selectedReadyCount = readyJobIds.filter((id) => selectedCollectionIds.includes(id)).length;
      return {
        ...farm,
        totalQuantity: farm.jobs.reduce((total, job) => total + Number(job.quantity || 0), 0),
        readyCount: readyJobs.length,
        readyJobIds,
        selectedCount: selectedReadyCount,
        allReadySelected: readyJobIds.length > 0 && selectedReadyCount === readyJobIds.length,
        partiallySelected: selectedReadyCount > 0 && selectedReadyCount < readyJobIds.length,
        routeCount: new Set(farm.jobs.map((job) => job.pickupRouteId).filter(Boolean).map(String)).size,
        statuses: Array.from(new Set(farm.jobs.map((job) => job.status))),
      };
    });
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

  // Build the editable route sequence from the full queue, not only the current
  // search/filter view, so selected jobs stay represented if filters are changed.
  const selectedFarmStops = useMemo(() => {
    const selected = new Set(selectedCollectionIds);
    const source = data?.data?.collections || [];
    const groups = new Map<string, { key: string; farmerName: string; pickupAddress: string; jobIds: string[]; quantity: number; hasCoordinates: boolean }>();
    for (const job of source) {
      const id = String(job.id || job._id || "");
      if (!selected.has(id) || !["ready_for_pickup", "team_assigned"].includes(job.status) || job.pickupRouteId) continue;
      const key = getFarmRouteKey(job);
      if (!groups.has(key)) {
        const location = job.pickupLocation && typeof job.pickupLocation === "object" ? job.pickupLocation : {};
        const coordinates = location.coordinates;
        groups.set(key, {
          key,
          farmerName: String(job.farmerName || "Farmer details unavailable").trim(),
          pickupAddress: String(job.pickupAddress || location.formattedAddress || location.address || location.farmAddress || "Farm address not provided"),
          jobIds: [],
          quantity: 0,
          hasCoordinates: Array.isArray(coordinates) && coordinates.length >= 2 && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1])),
        });
      }
      const group = groups.get(key)!;
      group.jobIds.push(id);
      group.quantity += Number(job.quantity || 0);
    }
    return Array.from(groups.values());
  }, [data, selectedCollectionIds]);

  const orderedManualFarmStops = useMemo(() => {
    const byKey = new Map(selectedFarmStops.map((farm) => [farm.key, farm]));
    const ordered = manualFarmOrder.filter((key) => byKey.has(key)).map((key) => byKey.get(key)!);
    for (const farm of selectedFarmStops) {
      if (!manualFarmOrder.includes(farm.key)) ordered.push(farm);
    }
    return ordered;
  }, [selectedFarmStops, manualFarmOrder]);

  const moveManualFarmStop = (farmKey: string, direction: -1 | 1) => {
    const currentOrder = orderedManualFarmStops.map((farm) => farm.key);
    const currentIndex = currentOrder.indexOf(farmKey);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) return;
    [currentOrder[currentIndex], currentOrder[nextIndex]] = [currentOrder[nextIndex], currentOrder[currentIndex]];
    setManualFarmOrder(currentOrder);
  };

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

  const toggleFarmSelection = (eligibleCollectionIds: string[], checked: boolean) => {
    setSelectedCollectionIds((current) => checked
      ? Array.from(new Set([...current, ...eligibleCollectionIds]))
      : current.filter((id) => !eligibleCollectionIds.includes(id)));
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
        ...(routePlanningMode === "manual" ? { manualStopOrder: orderedManualFarmStops.map((farm) => farm.key) } : {}),
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
              <p className="mt-2 text-base leading-6 text-slate-700">Select farms for pickup. All eligible orders at each selected farm will be grouped into farm-based routes.</p>
            </div>
            <Button className="min-h-11 px-4 text-base font-semibold" type="button" variant="outline" onClick={toggleVisibleSelection} disabled={readyVisibleJobs.length === 0}>
              {allVisibleSelected ? "Clear visible farms" : "Select all visible farms"}
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
              Route Planning Mode
              <select
                value={routePlanningMode}
                onChange={(e) => setRoutePlanningMode(e.target.value as "automatic" | "manual")}
                className="h-12 w-full rounded-md border border-input bg-background px-3 text-base font-normal"
              >
                <option value="automatic">Automatic · optimize farm stop order</option>
                <option value="manual">Manual · choose farm stop order</option>
              </select>
              <span className="block text-sm font-normal leading-6 text-slate-600">
                {routePlanningMode === "manual"
                  ? "Arrange the farms below in the exact visit order. The route will still be checked against vehicle capacity."
                  : "The system chooses a suitable stop sequence based on farm locations and vehicle capacity."}
              </span>
            </label>
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
          {routePlanningMode === "manual" && (
            <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <div>
                <h3 className="text-base font-bold text-slate-950">Manual pickup route order</h3>
                <p className="mt-1 text-sm leading-6 text-slate-700">
                  Use the arrows to set the order the pickup partner should visit each selected farm. Farms with no saved coordinates can still be ordered manually, but map distance and ETA will be unavailable.
                </p>
              </div>
              {orderedManualFarmStops.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">Select one or more farms above to build the manual route sequence.</p>
              ) : (
                <ol className="space-y-2">
                  {orderedManualFarmStops.map((farm, index) => (
                    <li key={farm.key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-extrabold text-emerald-900">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-950">{farm.farmerName}</p>
                        <p className="truncate text-xs text-slate-600">{farm.pickupAddress}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-700">{farm.jobIds.length} {farm.jobIds.length === 1 ? "order" : "orders"} · {farm.quantity.toLocaleString()} kg</p>
                        {!farm.hasCoordinates && <p className="mt-1 text-xs font-semibold text-amber-800">Location coordinates missing · manual sequence only</p>}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button type="button" variant="outline" size="icon" aria-label={"Move " + farm.farmerName + " earlier"} disabled={index === 0} onClick={() => moveManualFarmStop(farm.key, -1)}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="outline" size="icon" aria-label={"Move " + farm.farmerName + " later"} disabled={index === orderedManualFarmStops.length - 1} onClick={() => moveManualFarmStop(farm.key, 1)}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base leading-6 text-slate-700">
              {routePlanningMode === "manual"
                ? "The numbered farm sequence will be sent to the server and preserved across routes. Capacity and duplicate-route checks remain active."
                : "Selected farms are grouped into farm-based routes. The system chooses the stop order automatically, subject to vehicle capacity. Orders already on an open route cannot be planned twice."}
            </p>
            <Button className="min-h-12 px-5 text-base font-semibold" onClick={planSelectedPickups} disabled={planning || selectedCollectionIds.length === 0 || !selectedTeam || (routePlanningMode === "manual" && orderedManualFarmStops.length === 0)}>
              <Route className="mr-2 h-4 w-4" />{planning ? "Planning pickups..." : routePlanningMode === "manual" ? "Create Manual Route & Assign" : "Plan Selected Pickups"}
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
                      <div className="flex flex-wrap items-center gap-3">
                        <label className={"inline-flex min-h-11 items-center gap-3 rounded-lg border-2 px-3 py-2 text-base font-bold " + (farm.readyJobIds.length > 0 ? "cursor-pointer border-emerald-300 bg-white text-slate-900 hover:bg-emerald-50" : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500")}>
                          <input
                            type="checkbox"
                            aria-label={"Select " + farm.farmerName + " for pickup"}
                            checked={farm.allReadySelected}
                            disabled={farm.readyJobIds.length === 0}
                            onChange={(event) => toggleFarmSelection(farm.readyJobIds, event.target.checked)}
                            className="h-5 w-5 rounded border-slate-300 accent-emerald-700"
                          />
                          <span>{farm.allReadySelected ? "Farm selected" : "Select farm for pickup"}</span>
                        </label>
                        <Badge className="bg-emerald-800 px-3 py-1 text-sm font-bold text-white"><MapPin className="mr-1 h-4 w-4" /> FARM</Badge>
                        {farm.readyCount > 0 && <Badge variant="outline" className="px-3 py-1 text-sm font-semibold">{farm.readyCount} orders available</Badge>}
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
                      {farm.selectedCount > 0 && <p className="mt-2 text-sm font-bold text-emerald-900">{farm.selectedCount} of {farm.readyCount} available orders selected for route planning</p>}
                      {farm.readyCount === 0 && <p className="mt-2 text-sm font-medium text-slate-600">No orders available to plan. Orders already assigned to an open route cannot be selected again.</p>}
                      {farm.partiallySelected && <p className="mt-2 text-sm font-medium text-amber-800">Some orders at this farm are selected. Use the farm checkbox to select all available orders.</p>}

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
