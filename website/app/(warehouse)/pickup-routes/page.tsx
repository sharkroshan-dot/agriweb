"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin, Truck, RefreshCw, Search, Package,
  CheckCircle2, Clock3, AlertTriangle, Map as MapIcon,
} from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import { Map as SharedMap } from "../../components/shared/map";
import toast from "react-hot-toast";

type Job = Record<string, any>;
const READY = new Set(["ready_for_pickup"]);
const STATUS_LABEL: Record<string, string> = {
  scheduled: "Waiting for farmer", ready_for_pickup: "Ready for pickup",
  team_assigned: "Partner assigned", en_route: "En route", arrived_at_farm: "At farm",
  collected: "Collected", departed_farm: "Departed farm", arrived_warehouse: "At warehouse",
  completed: "Pickup completed", received: "Received at warehouse", cancelled: "Cancelled",
};

function idOf(job: Job) { return String(job.id || job._id || ""); }
function areaOf(job: Job) {
  const location = job.pickupLocation || job.farmLocation || {};
  const directArea =
    job.farmAreaName || job.farmVillage || job.village || location.village ||
    job.farmTown || job.town || location.town ||
    job.farmCity || job.city || location.city ||
    job.locality || location.locality || job.area || location.area;
  if (directArea && String(directArea).trim()) return String(directArea).trim();

  // The collections API can have legacy records with empty pickupLocation and
  // null farmVillage/farmTown/farmCity, while still returning pickupAddress.
  // Use the most local address segment instead of grouping every such order
  // under "Area not identified".
  const address = [
    job.pickupAddress, job.farmAddress, location.address,
    location.formattedAddress, job.address,
  ].find((value) => typeof value === "string" && value.trim());
  if (address) {
    const parts = String(address).split(",").map((part) => part.trim()).filter(Boolean);
    const district = normalizeDistrict(districtOf(job));
    const last = parts[parts.length - 1] || "";
    const lastIsDistrict = district && normalizeDistrict(last) === district;
    const candidate = lastIsDistrict ? (parts[parts.length - 2] || last) : last;
    if (candidate) return candidate;
  }
  return "Area not identified";
}
function districtOf(job: Job) {
  const location = job.pickupLocation || job.farmLocation || {};
  return String(job.farmDistrict || job.district || location.district || "").trim();
}
function normalizeDistrict(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function coordinatesOf(job: Job): [number, number] | null {
  const location = job.pickupLocation || job.farmLocation || {};
  const raw = location.coordinates || location.coords;
  let lat: number, lng: number;
  if (Array.isArray(raw) && raw.length >= 2) { lng = Number(raw[0]); lat = Number(raw[1]); }
  else if (raw && typeof raw === "object") { lat = Number(raw.lat ?? raw.latitude); lng = Number(raw.lng ?? raw.longitude ?? raw.lon); }
  else { lat = Number(location.lat ?? location.latitude ?? job.latitude); lng = Number(location.lng ?? location.longitude ?? job.longitude); }
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}
function areaKey(value: string) { return value.toLowerCase().replace(/\s+/g, " ").trim(); }

export default function PickupRoutesPage() {
  const [selectedArea, setSelectedArea] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const jobsQ = useQuery({
    queryKey: ["warehousePickupAreaPlanning"],
    queryFn: () => api.get("/warehouse/me/collections", { params: { status: "all" } }),
    refetchInterval: 10000,
    staleTime: 0,
  });
  const teamsQ = useQuery({
    queryKey: ["warehousePickupAreaTeams"],
    queryFn: () => api.get("/warehouse/me/pickup-team/members"),
    refetchInterval: 15000,
  });

  const areasQ = useQuery({
    queryKey: ["warehousePickupAreaDirectory"],
    queryFn: () => api.get("/warehouse/me/pickup-areas"),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Accept both direct API payloads and { data: ... } response envelopes.
  // Guard arrays so malformed/alternate responses cannot crash page rendering.
  const rawJobs = jobsQ.data?.data?.collections ?? jobsQ.data?.collections ?? jobsQ.data?.orders ?? jobsQ.data?.data?.orders;
  const rawTeams = teamsQ.data?.data?.members ?? teamsQ.data?.members ?? teamsQ.data?.teams ?? teamsQ.data?.data?.teams;
  const allJobs: Job[] = Array.isArray(rawJobs) ? rawJobs.filter((job: unknown): job is Job => Boolean(job) && typeof job === "object") : [];
  const teams: Job[] = Array.isArray(rawTeams) ? rawTeams.filter((team: unknown): team is Job => Boolean(team) && typeof team === "object") : [];
  // Use the same district coverage returned by Farm Collection. The backend
  // defaults this to the warehouse Settings location district when no explicit
  // Farm Collection district coverage has been configured.
  const configuredDistricts: string[] = Array.isArray(jobsQ.data?.data?.configuredFarmCollectionDistricts)
    ? jobsQ.data.data.configuredFarmCollectionDistricts
    : Array.isArray(jobsQ.data?.configuredFarmCollectionDistricts)
      ? jobsQ.data.configuredFarmCollectionDistricts
      : [];
  const allowedDistrictKeys = new Set(configuredDistricts.map(normalizeDistrict).filter(Boolean));
  // The API already scopes this collection list to the signed-in warehouse.
  // Keep its assigned/in-progress/completed pickup jobs visible even when an
  // older farmer profile has no district field serialized on the collection.
  // Explicit district mismatches remain excluded from this warehouse's plan.
  const jobs = allowedDistrictKeys.size
    ? allJobs.filter((job) => {
        const districtKey = normalizeDistrict(districtOf(job));
        if (districtKey) return allowedDistrictKeys.has(districtKey);
        return String(job.districtMatchStatus || "") !== "district_mismatch";
      })
    : [];
  const eligibleTeams = teams.filter((team) => Number(team.capacity || team.vehicleCapacity || 0) > 0);
  const selectedTeam = eligibleTeams.find((team) => String(team.id) === teamId);

  const areas = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; jobs: Job[]; totalOrders: number; readyToAssign: number }>();
    const directoryRows = areasQ.data?.data?.areas ?? areasQ.data?.areas ?? areasQ.data?.data?.data?.areas ?? [];
    if (Array.isArray(directoryRows)) {
      directoryRows.forEach((area: Job) => {
        const name = String(area.name || "").trim();
        if (!name) return;
        const key = areaKey(name);
        groups.set(key, {
          key, name, jobs: [],
          totalOrders: Number(area.totalOrders || 0),
          readyToAssign: Number(area.readyToAssign || 0),
        });
      });
    }
    jobs.forEach((job) => {
      const name = areaOf(job); const key = areaKey(name);
      if (!groups.has(key)) groups.set(key, { key, name, jobs: [], totalOrders: 0, readyToAssign: 0 });
      const group = groups.get(key)!;
      group.jobs.push(job);
      // Use API directory counts when present; otherwise count the warehouse-scoped jobs.
      if (!directoryRows?.length) {
        group.totalOrders += 1;
        if (READY.has(String(job.status || "")) && !job.pickupRouteId) group.readyToAssign += 1;
      }
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs, areasQ.data]);

  const filtered = useMemo(() => jobs.filter((job) => {
    const areaMatch = selectedArea === "all" || areaKey(areaOf(job)) === selectedArea;
    const statusMatch = statusFilter === "all" || String(job.status || "") === statusFilter;
    const term = search.trim().toLowerCase();
    const text = [job.farmerName, job.orderNumber, job.orderId, job.productName, job.pickupAddress, areaOf(job)].join(" ").toLowerCase();
    return areaMatch && statusMatch && (!term || text.includes(term));
  }), [jobs, selectedArea, statusFilter, search]);

  const selectedJobs = jobs.filter((job) => selectedIds.includes(idOf(job)));
  const selectedWeight = selectedJobs.reduce((sum, job) => sum + Number(job.quantity || 0), 0);
  const eligibleFiltered = filtered.filter((job) => READY.has(String(job.status || "")) && !job.pickupRouteId && idOf(job));
  const areaSummary = useMemo(() => {
    const source = selectedArea === "all" ? jobs : jobs.filter((job) => areaKey(areaOf(job)) === selectedArea);
    return {
      total: source.length,
      ready: source.filter((job) => READY.has(String(job.status || "")) && !job.pickupRouteId).length,
      assigned: source.filter((job) => Boolean(job.pickupRouteId || job.collectionTeamId)),
      completed: source.filter((job) => ["arrived_warehouse", "received", "completed"].includes(String(job.status || ""))).length,
    };
  }, [jobs, selectedArea]);

  const farmMarkers = useMemo(() => filtered.flatMap((job) => {
    const coords = coordinatesOf(job);
    if (!coords) return [];
    return [{
      id: idOf(job),
      lat: coords[0],
      lng: coords[1],
      title: job.farmerName || "Farm pickup",
      info: `${job.orderNumber || job.eventOrderNumber || "Pickup order"} · ${job.productName || "Product"} · ${Number(job.quantity || 0)} kg · ${STATUS_LABEL[String(job.status)] || String(job.status || "Unknown").replace(/_/g, " ")}`,
    }];
  }), [filtered]);
  const mapCenter = useMemo(() => farmMarkers.length
    ? { lat: farmMarkers.reduce((sum, marker) => sum + marker.lat, 0) / farmMarkers.length, lng: farmMarkers.reduce((sum, marker) => sum + marker.lng, 0) / farmMarkers.length }
    : { lat: 10.7905, lng: 78.7047 }, [farmMarkers]);

  const toggleOrder = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  const selectVisible = () => setSelectedIds((current) => {
    const ids = eligibleFiltered.map(idOf);
    return ids.every((id) => current.includes(id)) ? current.filter((id) => !ids.includes(id)) : Array.from(new Set([...current, ...ids]));
  });

  const assignAreaOrders = async () => {
    if (!selectedIds.length) { toast.error("Select eligible pickup orders first."); return; }
    if (!selectedTeam) { toast.error("Select an approved pickup partner with registered vehicle capacity."); return; }
    if (!selectedTeam.deliveryPartnerId) { toast.error("The selected pickup team has no linked delivery partner."); return; }
    if (selectedWeight > Number(selectedTeam.capacity || selectedTeam.vehicleCapacity || 0)) {
      toast.error(`Selected orders total ${selectedWeight.toFixed(1)} kg, above this vehicle's capacity.`); return;
    }
    const invalid = selectedJobs.filter((job) => !READY.has(String(job.status || "")) || job.pickupRouteId);
    if (invalid.length) { toast.error("Some selected orders are no longer eligible. Refresh and select again."); return; }
    setAssigning(true);
    try {
      const result = await api.post("/warehouse/me/pickup-routes", {
        collectionIds: selectedIds,
        maxWeightKg: Number(selectedTeam.capacity || selectedTeam.vehicleCapacity),
        assignmentMode: "assign_team",
        deliveryPartnerId: selectedTeam.deliveryPartnerId,
      });
      toast.success(result?.message || result?.data?.message || "Selected area pickups assigned successfully.");
      setSelectedIds([]);
      await Promise.all([jobsQ.refetch(), teamsQ.refetch(), areasQ.refetch()]);
    } catch (error: any) {
      toast.error(error?.message || "Unable to assign selected pickups.");
    } finally { setAssigning(false); }
  };

  const openLocation = (job: Job) => {
    const coords = coordinatesOf(job);
    const query = coords ? `${coords[0]},${coords[1]}` : job.pickupAddress || areaOf(job);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="warehouse-pickup-routes-page w-full space-y-6 pb-8">
      <section className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-600 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700"><MapIcon className="h-4 w-4" /> Geographical pickup planning</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Area-wise Pickup Routes</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Plan farm pickups only within this warehouse’s configured district coverage. Orders are grouped into villages, towns and local areas inside that district.</p>
            <p className="mt-2 text-xs font-medium text-emerald-700">{configuredDistricts.length ? `District coverage: ${configuredDistricts.join(", ")}` : "District coverage is not configured. Set the warehouse district in Settings before planning pickups."}</p>
          </div>
          <Button variant="outline" onClick={() => { jobsQ.refetch(); teamsQ.refetch(); areasQ.refetch(); }} disabled={jobsQ.isFetching} className="gap-2 self-start"><RefreshCw className={`h-4 w-4 ${jobsQ.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>
      </section>

      {!jobsQ.isLoading && !jobsQ.isError && allowedDistrictKeys.size === 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Farm Collection district coverage is missing. Pickup Routes is intentionally not showing orders from other districts. Configure this warehouse’s district in Warehouse Settings, then refresh.</div>}
      <section className="grid gap-3 grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Farm pickup orders", value: areaSummary.total, icon: Package },
          { label: "Pickup areas", value: areas.length, icon: MapIcon },
          { label: "Ready to assign", value: areaSummary.ready, icon: Clock3 },
          { label: "Already assigned", value: areaSummary.assigned.length, icon: Truck },
          { label: "Pickup completed", value: areaSummary.completed, icon: CheckCircle2 },
        ].map((item) => <Card key={item.label} className="border-slate-200 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><item.icon className="h-5 w-5"/></span><div><p className="text-xs text-slate-500">{item.label}</p><p className="text-2xl font-bold tabular-nums text-slate-900">{jobsQ.isError ? "—" : item.value}</p></div></CardContent></Card>)}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(250px,0.75fr)_minmax(0,2fr)]">
        <Card className="h-fit border-slate-200 shadow-sm">
          <div className="border-b p-4"><h2 className="font-semibold text-slate-900">Pickup areas</h2><p className="mt-1 text-xs text-slate-500">Select an area to view its orders and locations.</p></div>
          <div className="max-h-[620px] space-y-2 overflow-y-auto p-3">
            <button onClick={() => setSelectedArea("all")} className={`w-full rounded-lg border p-3 text-left ${selectedArea === "all" ? "border-emerald-300 bg-emerald-50" : "border-transparent hover:bg-slate-50"}`}>
              <span className="flex items-center justify-between text-sm font-semibold">All areas <span className="tabular-nums">{jobs.length}</span></span>
              <span className="mt-1 block text-xs text-slate-500">{areaSummary.ready} ready for assignment</span>
            </button>
            {areas.map((area) => {
              const ready = area.readyToAssign;
              return <button key={area.key} onClick={() => setSelectedArea(area.key)} className={`w-full rounded-lg border p-3 text-left ${selectedArea === area.key ? "border-emerald-300 bg-emerald-50" : "border-transparent hover:bg-slate-50"}`}>
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800"><span className="truncate">{area.name}</span><span className="tabular-nums">{area.totalOrders}</span></span>
                <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500"><span>{ready} ready for pickup</span></span>
              </button>;
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div><h2 className="flex items-center gap-2 font-semibold text-slate-900"><MapPin className="h-4 w-4 text-emerald-700"/> Pickup location map</h2><p className="mt-1 text-xs text-slate-500">{filtered.filter(coordinatesOf).length} located orders · {filtered.filter((job) => !coordinatesOf(job)).length} without coordinates</p></div>
              <Badge variant="outline">{selectedArea === "all" ? "All areas" : areas.find((a) => a.key === selectedArea)?.name || "Selected area"}</Badge>
            </div>
            {farmMarkers.length ? <SharedMap center={mapCenter} zoom={11} markers={farmMarkers} drawRoute={false} height="340px" className="w-full" /> : <div className="flex h-[260px] flex-col items-center justify-center gap-2 bg-slate-50 text-center"><MapPin className="h-8 w-8 text-slate-400"/><p className="text-sm font-medium text-slate-700">No verified farm coordinates in this area</p><p className="text-xs text-slate-500">Orders remain available below. Add verified GPS coordinates to the farmer's farm profile to show a marker.</p></div>}
            <div className="flex flex-wrap gap-3 border-t bg-slate-50 px-4 py-3 text-xs text-slate-600"><span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/> Each marker represents a farm pickup order</span><span>Only farms in this warehouse district are included</span></div>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
              <div><h2 className="font-semibold text-slate-900">Orders by selected area</h2><p className="mt-1 text-xs text-slate-500">Only Ready for Pickup orders that are not already route-assigned can be selected.</p></div>
              <Button variant="outline" size="sm" onClick={selectVisible} disabled={!eligibleFiltered.length}>{eligibleFiltered.length && eligibleFiltered.every((job) => selectedIds.includes(idOf(job))) ? "Clear eligible selection" : "Select eligible orders"} ({eligibleFiltered.length})</Button>
            </div>
            <div className="grid gap-3 border-b bg-slate-50/70 p-3 md:grid-cols-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="all">All pickup statuses</option>{Object.entries(STATUS_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
              <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search farmer, order, product…" className="h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500"/></div>
            </div>
            {jobsQ.isLoading ? <div className="p-10 text-center text-sm text-slate-500">Loading pickup orders…</div> : jobsQ.isError ? <div className="p-8 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-rose-500"/><p className="mt-2 text-sm font-medium">Unable to load pickup orders</p><Button className="mt-3" variant="outline" onClick={() => jobsQ.refetch()}>Try again</Button></div> : filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No orders match the selected filters.</div> : <div className="max-h-[540px] divide-y overflow-y-auto">
              {filtered.map((job) => {
                const id = idOf(job); const canAssign = READY.has(String(job.status || "")) && !job.pickupRouteId; const coords = coordinatesOf(job);
                return <div key={id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <input type="checkbox" aria-label={`Select order ${job.orderNumber || id}`} checked={selectedIds.includes(id)} disabled={!canAssign} onChange={() => toggleOrder(id)} className="mt-1 h-4 w-4 accent-emerald-700 disabled:opacity-40"/>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">{job.orderNumber || job.eventOrderNumber || "Pickup order"}</span><Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">Farm pickup</Badge><Badge variant="outline">{STATUS_LABEL[String(job.status)] || String(job.status || "Unknown").replace(/_/g, " ")}</Badge></div>
                    <p className="mt-1 text-sm text-slate-700">{job.farmerName || "Farmer details unavailable"} · {job.productName || "Product details unavailable"}</p>
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0"/>{job.pickupAddress || "Farm address not provided"} · {areaOf(job)}</p>
                    <p className="mt-1 text-xs text-slate-500">{Number(job.quantity || 0)} kg {job.collectionTeamName && `· ${job.collectionTeamName}`}</p>
                    {job.districtMatchStatus && job.districtMatchStatus !== "matched" && <p className="mt-2 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5"/>{job.districtMatchMessage || "Verify farm district before assignment."}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2"><span className={`text-xs font-medium ${canAssign ? "text-emerald-700" : "text-slate-400"}`}>{canAssign ? "Eligible" : "Not assignable"}</span><Button size="sm" variant="outline" onClick={() => openLocation(job)} disabled={!coords && !job.pickupAddress}>Map</Button></div>
                </div>;
              })}
            </div>}
          </Card>
        </div>
      </section>

      <Card className="border-emerald-200 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-900">Assign pickup partner by area</h2><p className="mt-1 text-xs text-slate-500">Assign farm pickup orders to an approved pickup partner. The same assignment is reflected in Farm Collection.</p></div><Badge variant="outline">{selectedIds.length} selected</Badge></div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <label className="space-y-1.5 text-sm font-medium text-slate-700">Approved pickup partner and vehicle
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-11 w-full rounded-lg border bg-white px-3 font-normal"><option value="">Select partner / vehicle</option>{eligibleTeams.map((team) => <option key={team.id} value={team.id}>{team.name || "Pickup partner"} · {team.vehicleType || "Vehicle"} · {team.capacity || team.vehicleCapacity} kg</option>)}</select>
            </label>
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="text-slate-500">Selected pickup load</p><p className="mt-1 font-semibold text-slate-900">{selectedJobs.length} orders · {selectedWeight.toFixed(1)} kg</p><p className="mt-1 text-xs text-slate-500">{selectedTeam ? `Vehicle capacity: ${selectedTeam.capacity || selectedTeam.vehicleCapacity} kg` : "Choose a partner to validate capacity"}</p></div>
            <Button onClick={assignAreaOrders} disabled={assigning || !selectedIds.length || !selectedTeam} className="h-11 bg-emerald-700 hover:bg-emerald-800"><Truck className="mr-2 h-4 w-4"/>{assigning ? "Assigning…" : "Assign selected orders"}</Button>
          </div>
          {selectedTeam && selectedWeight > Number(selectedTeam.capacity || selectedTeam.vehicleCapacity || 0) && <p className="text-sm text-rose-700">Selected quantity exceeds the selected vehicle capacity. Remove orders or choose a larger vehicle.</p>}
          {eligibleTeams.length === 0 && <p className="text-sm text-amber-700">No approved pickup partner with registered vehicle capacity is available. Review Pickup Partners first.</p>}
        </CardContent>
      </Card>
      <p className="text-center text-xs text-slate-400">Order and assignment status refresh automatically. Farm Collection remains the source of truth for pickup execution and its existing rules.</p>
    </main>
  );
}
