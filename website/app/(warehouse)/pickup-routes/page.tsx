"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin, Truck, RefreshCw, Search, Package,
  CheckCircle2, Clock3, AlertTriangle, Map as MapIcon,
  Sprout, ChevronRight, Users,
} from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { WarehousePageHeader } from "../../components/warehouse/warehouse-page-header";
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
  const location = job.pickupLocation || job.farmLocation || job.farmAddress || {};
  const farmer = job.farmerProfile || job.farmer || job.profile || {};
  const farmerLocation = farmer.farmLocation || farmer.farmAddress || farmer.address || {};
  const candidates = [
    job.farmVillage, job.village, job.villageName, location.village, farmer.farmVillage, farmer.village,
    job.farmAreaName, job.farmLocality, job.locality, job.area, location.locality, location.area,
    farmer.farmAreaName, farmer.farmLocality, farmer.locality, farmer.area,
    job.farmTaluk, job.taluk, job.subDistrict, location.taluk, location.subDistrict,
    farmer.farmTaluk, farmer.taluk, farmerLocation.village, farmerLocation.locality,
    farmerLocation.taluk, farmerLocation.town,
    job.farmTown, job.town, location.town, farmer.farmTown, farmer.town,
  ];
  const directArea = candidates.find((value) => typeof value === "string" && value.trim() &&
    !["unknown", "n/a", "na", "not available"].includes(value.trim().toLowerCase()) &&
    !isRoadOrAddressLabel(value));
  if (directArea) return String(directArea).trim();

  // Prefer a known locality appearing anywhere in the address over a GPS
  // status or the district/city suffix.
  const address = [
    job.pickupAddress, job.farmAddress, location.address, location.formattedAddress,
    farmer.pickupAddress, farmer.farmAddress, farmerLocation.address, job.address,
  ].find((value) => typeof value === "string" && value.trim());
  if (address) {
    const parts = String(address).split(/[,;|]/).map((part) => part.trim()).filter(Boolean);
    const district = normalizeDistrict(districtOf(job));
    const usable = parts.filter((part) => {
      const normalized = normalizeDistrict(part);
      return normalized && normalized !== district && !/^(road|street|main road|india|tamil nadu)$/i.test(part);
    });
    const candidate = usable.filter((part) => !isRoadOrAddressLabel(part)).at(-1) || "";
    if (candidate) return candidate.replace(/\\s*[-–].*$/, "").trim();
  }
  return "Area not identified";
}
function districtOf(job: Job) {
  const location = job.pickupLocation || job.farmLocation || {};
  return String(job.farmDistrict || job.district || location.district || "").trim();
}
function normalizeDistrict(value: unknown) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    trichy: "tiruchirappalli",
    trichirapalli: "tiruchirappalli",
    tiruchirapalli: "tiruchirappalli",
    tiruchirappalli: "tiruchirappalli",
    kanyakumari: "kanniyakumari",
    pudukottai: "pudukkottai",
    thirunelveli: "tirunelveli",
    thiruvallur: "tiruvallur",
    thiruvannamalai: "tiruvannamalai",
    thiruvarur: "tiruvarur",
    sivagangai: "sivaganga",
    tirupur: "tiruppur",
  };
  return aliases[normalized] || normalized;
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
function isRoadOrAddressLabel(value: unknown) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return !text || /\b(main road|road|street|st\.?|highway|hwy|bypass|cross street|roadways)\b/.test(text) ||
    (/\b(trichy|tiruchirappalli|tiruchirapalli)\b/.test(text) && text.split(" ").length > 1);
}
function areaKey(value: string) { return value.toLowerCase().replace(/\s+/g, " ").trim(); }
function escapeMapText(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\'/g, "&#39;"); }

export default function PickupRoutesPage() {
  const [selectedArea, setSelectedArea] = useState("all");
  const [expandedTaluks, setExpandedTaluks] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [activeFarmId, setActiveFarmId] = useState("");
  const [areaSearch, setAreaSearch] = useState("");

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
  // Pickup Routes is only for farm-stock collection inside this warehouse's
  // configured district. Completed/assigned pickup history is not assignable.
  const districtJobs = allowedDistrictKeys.size
    ? allJobs.filter((job) => {
        const districtKey = normalizeDistrict(districtOf(job));
        if (districtKey) return allowedDistrictKeys.has(districtKey);
        return String(job.districtMatchStatus || "") !== "district_mismatch";
      })
    : [];
  const jobs = districtJobs.filter((job) =>
    READY.has(String(job.status || "").toLowerCase()) && !job.pickupRouteId && !job.collectionTeamId
  );
  const eligibleTeams = teams.filter((team) => Number(team.capacity || team.vehicleCapacity || 0) > 0);
  const selectedTeam = eligibleTeams.find((team) => String(team.id) === teamId);

  const areas = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; areaType?: string; jobs: Job[]; totalOrders: number; readyToAssign: number; collectionIds: string[]; serviceAreas?: string[]; pickupRadiusKm?: number }>();
    const registeredAreas = areasQ.data?.data?.registeredAreas;
    const directoryRows = Array.isArray(registeredAreas) && registeredAreas.length
      ? registeredAreas
      : (areasQ.data?.data?.zones ?? areasQ.data?.data?.areas ?? areasQ.data?.zones ?? areasQ.data?.areas ?? []);
    if (Array.isArray(directoryRows)) {
      directoryRows.forEach((area: Job) => {
        const name = String(area.name || "").trim();
        if (!name) return;
        const key = String(area.key || area.hubId || areaKey(name));
        groups.set(key, {
          key, name, areaType: area.taluk ? ("Village / locality · " + area.taluk) : String(area.areaType || "Registered pickup area"), jobs: [],
          totalOrders: Number(area.totalOrders || 0),
          readyToAssign: Number(area.readyOrders ?? area.readyToAssign ?? 0),
          collectionIds: Array.isArray(area.collectionIds) ? area.collectionIds.map(String) : [],
          serviceAreas: Array.isArray(area.aliases) ? area.aliases : (Array.isArray(area.serviceAreas) ? area.serviceAreas : []),
          pickupRadiusKm: Number(area.pickupRadiusKm || 0),
          registeredFarmCount: Number(area.registeredFarmCount || 0),
        } as any);
      });
    }
    const collectionToZone = new Map<string, string>();
    const areaAliases = new Map<string, string>();
    groups.forEach((area) => {
      area.collectionIds.forEach((id) => collectionToZone.set(id, area.key));
      [area.name, (area as any).taluk, ...(area.serviceAreas || [])].forEach((value) => {
        const normalized = areaKey(String(value || ""));
        if (normalized) areaAliases.set(normalized, area.key);
      });
    });
    jobs.forEach((job) => {
      const id = idOf(job);
      const location = job.pickupLocation || job.farmLocation || {};
      const farmer = job.farmerProfile || job.farmer || job.profile || {};
      const farmerLocation = farmer.farmLocation || farmer.farmAddress || farmer.address || {};
      const explicitAreas = [
        job.farmVillage, job.farmAreaName, job.farmLocality, job.farmTown, job.farmTaluk,
        job.village, job.villageName, job.locality, job.taluk, job.subDistrict, job.town, job.area,
        location.village, location.locality, location.taluk, location.subDistrict, location.town, location.area,
        farmer.farmVillage, farmer.village, farmer.farmAreaName, farmer.farmLocality,
        farmer.locality, farmer.farmTaluk, farmer.taluk, farmer.subDistrict, farmer.farmTown, farmer.town,
        farmerLocation.village, farmerLocation.locality, farmerLocation.taluk, farmerLocation.subDistrict,
        farmerLocation.town, farmerLocation.area,
      ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()) && !isRoadOrAddressLabel(value));
      const address = [
        job.pickupAddress, job.farmAddress, location.address, location.formattedAddress,
        farmer.pickupAddress, farmer.farmAddress, farmerLocation.address, job.address,
      ].filter((value) => typeof value === "string").join(", ");
      const addressParts = address.split(/[,;|]/).map((part) => part.trim()).filter((part) => part && !isRoadOrAddressLabel(part)).map(areaKey);
      const aliasMatches = Array.from(areaAliases.entries())
        .filter(([alias]) => alias.length >= 3 && addressParts.some((part) => part === alias || part.includes(alias) || alias.includes(part)))
        .sort((a, b) => b[0].length - a[0].length);
      const matchedKey = explicitAreas.map((value) => areaAliases.get(areaKey(value))).find(Boolean)
        || addressParts.map((value) => areaAliases.get(value)).find(Boolean)
        || aliasMatches[0]?.[1];
      // GPS is never used to decide the pickup area. If the order has a
      // registered village/taluk/locality that is not yet in the area master,
      // keep it under that actual locality instead of a GPS-verification bucket.
      const inferredArea = areaOf(job);
      const hasInferredArea = inferredArea !== "Area not identified" &&
        normalizeDistrict(inferredArea) !== normalizeDistrict(districtOf(job));
      const key = collectionToZone.get(id) || matchedKey ||
        (hasInferredArea ? "area:" + areaKey(inferredArea) : "district-unassigned");
      if (!groups.has(key)) {
        const name = key === "district-unassigned" ? "Area not identified" : (hasInferredArea ? inferredArea : areaOf(job));
        groups.set(key, { key, name, areaType: key === "district-unassigned" ? "Farm locality not available in profile/address" : "Registered farm locality", jobs: [], totalOrders: 0, readyToAssign: 0, collectionIds: [] });
      }
      const group = groups.get(key)!;
      group.jobs.push(job);
    });
    groups.forEach((group) => {
      group.totalOrders = Math.max(Number(group.totalOrders || 0), group.jobs.length);
      const readyFromJobs = group.jobs.filter((job) => READY.has(String(job.status || "")) && !job.pickupRouteId).length;
      group.readyToAssign = Math.max(Number(group.readyToAssign || 0), readyFromJobs);
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [jobs, areasQ.data]);

  const taluks: Job[] = useMemo(() => {
    const registered = areasQ.data?.data?.registeredAreas;
    if (Array.isArray(registered) && registered.length) return [];
    const rows = areasQ.data?.data?.taluks ?? areasQ.data?.taluks ?? [];
    return Array.isArray(rows) ? rows.filter((item: unknown): item is Job => Boolean(item) && typeof item === "object") : [];
  }, [areasQ.data]);
  const selectedTaluk = taluks.find((taluk) => taluk.key === selectedArea);
  const selectedZone = areas.find((area) => area.key === selectedArea);
  const selectedGroupName = selectedTaluk?.name || selectedZone?.name || "All areas";

  const filtered = useMemo(() => {
    const zone = areas.find((area) => area.key === selectedArea);
    const taluk = taluks.find((item) => item.key === selectedArea);
    const orderIds = new Set(taluk?.collectionIds || zone?.collectionIds || []);
    return jobs.filter((job) => {
      const areaMatch = selectedArea === "all" || orderIds.has(idOf(job)) || zone?.jobs.some((item) => idOf(item) === idOf(job));
      const statusMatch = statusFilter === "all" || String(job.status || "") === statusFilter;
      const term = search.trim().toLowerCase();
      const text = [job.farmerName, job.orderNumber, job.orderId, job.productName, job.pickupAddress, areaOf(job), districtOf(job)].join(" ").toLowerCase();
      return areaMatch && statusMatch && (!term || text.includes(term));
    });
  }, [jobs, areas, taluks, selectedArea, statusFilter, search]);

  const selectedJobs = jobs.filter((job) => selectedIds.includes(idOf(job)));
  const selectedWeight = selectedJobs.reduce((sum, job) => sum + Number(job.quantity || 0), 0);
  const eligibleFiltered = filtered.filter((job) => READY.has(String(job.status || "")) && !job.pickupRouteId && idOf(job));
  const areaSummary = useMemo(() => {
    const source = selectedArea === "all" ? jobs : filtered;
    return {
      total: source.length,
      ready: source.filter((job) => READY.has(String(job.status || "")) && !job.pickupRouteId).length,
      assigned: source.filter((job) => Boolean(job.pickupRouteId || job.collectionTeamId)),
      completed: source.filter((job) => ["arrived_warehouse", "received", "completed"].includes(String(job.status || ""))).length,
    };
  }, [jobs, selectedArea, filtered]);

  const farmMarkers = useMemo(() => filtered.flatMap((job) => {
    const coords = coordinatesOf(job);
    if (!coords) return [];
    return [{
      id: idOf(job),
      lat: coords[0],
      lng: coords[1],
      title: escapeMapText(job.farmerName || "Farm pickup"),
      info: escapeMapText(`${job.orderNumber || job.eventOrderNumber || "Pickup order"} · ${job.productName || "Product"} · ${Number(job.quantity || 0)} kg · ${STATUS_LABEL[String(job.status)] || String(job.status || "Unknown").replace(/_/g, " ")}`),
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

  const searchedAreas = areas.filter((area) => area.name.toLowerCase().includes(areaSearch.trim().toLowerCase()));
  const registeredFarmTotal = areas.reduce((sum, area) => sum + Number((area as any).registeredFarmCount || 0), 0);
  const readyFarmTotal = new Set(jobs.map((job) => String(job.farmerId || job.farmerUserId || job.farmId || idOf(job)))).size;

  return (
    <main className="warehouse-pickup-routes-page w-full space-y-5 pb-8">
      <WarehousePageHeader
        eyebrow="Farm collection"
        title="Area-wise Pickup Routes"
        description="Plan collections by farm area, review pickup locations and assign approved partners to ready farms."
        meta={<span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><MapIcon className="h-3.5 w-3.5"/>{configuredDistricts.length ? `District coverage: ${configuredDistricts.join(", ")}` : "District coverage not configured"}</span>}
        actions={<Button variant="outline" onClick={() => { jobsQ.refetch(); teamsQ.refetch(); areasQ.refetch(); }} disabled={jobsQ.isFetching || areasQ.isFetching} className="h-10 gap-2 rounded-xl"><RefreshCw className={`h-4 w-4 ${jobsQ.isFetching || areasQ.isFetching ? "animate-spin" : ""}`}/>Refresh</Button>}
      />

      {!jobsQ.isLoading && !jobsQ.isError && allowedDistrictKeys.size === 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Farm Collection district coverage is missing. Pickup Routes is intentionally not showing orders from other districts. Configure this warehouse’s district in Warehouse Settings, then refresh.</div>}
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Registered farms", value: registeredFarmTotal, icon: Sprout },
          { label: "Pickup areas in district", value: areas.length, icon: MapIcon },
          { label: "Farms ready for pickup", value: readyFarmTotal, icon: Package },
          { label: "Available pickup partners", value: eligibleTeams.length, icon: Users },
        ].map((item) => <Card key={item.label} className="border-slate-200 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><span className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><item.icon className="h-5 w-5"/></span><div><p className="text-xs text-slate-500">{item.label}</p><p className="text-2xl font-bold tabular-nums text-slate-900">{jobsQ.isError ? "—" : item.value}</p></div></CardContent></Card>)}
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(250px,0.78fr)_minmax(0,2fr)]">
        <Card className="h-fit overflow-hidden border-slate-200 shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-950">Pickup areas</h2><p className="mt-1 text-xs text-slate-500">Areas in this warehouse district</p></div><Badge className="border-emerald-100 bg-emerald-50 text-emerald-800">{areas.length} areas</Badge></div>
            <div className="relative mt-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={areaSearch} onChange={(e) => setAreaSearch(e.target.value)} placeholder="Search pickup area…" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-500 focus:bg-white"/></div>
          </div>
          <div className="max-h-[620px] space-y-2 overflow-y-auto p-3">
            <button
              type="button"
              onClick={() => setSelectedArea("all")}
              className={"w-full rounded-lg border p-3 text-left transition-colors " + (selectedArea === "all" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:bg-slate-50")}
            >
              <span className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-900">
                <span>All farm pickup areas</span><span className="tabular-nums">{areas.reduce((sum, area) => sum + Number((area as any).registeredFarmCount || 0), 0)} farms</span>
              </span>
              <span className="mt-1 block text-xs text-slate-500">{jobs.length} farm pickup records ready for partner assignment</span>
            </button>

            {searchedAreas.length ? searchedAreas.map((area) => {
              const active = selectedArea === area.key;
              const registeredFarmCount = Number((area as any).registeredFarmCount || 0);
              return (
                <button
                  type="button"
                  key={area.key}
                  onClick={() => { setSelectedArea(area.key); setActiveFarmId(""); setSelectedIds([]); }}
                  className={"w-full rounded-xl border p-3 text-left transition " + (active ? "border-emerald-300 bg-emerald-50/70 ring-1 ring-emerald-100" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50")}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{area.name}</span>
                    <span className={"shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums " + (registeredFarmCount > 0 ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>
                      {registeredFarmCount} {registeredFarmCount === 1 ? "farm" : "farms"}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">Registered farms in this pickup area</span>
                  <span className="mt-2 flex items-center justify-between gap-2 text-xs"><span className="text-slate-500">{area.jobs.length} ready for pickup</span><ChevronRight className={"h-4 w-4 " + (active ? "text-emerald-700" : "text-slate-300")}/></span>
                </button>
              );
            }) : (
              <div className="rounded-lg border border-dashed border-slate-300 p-5 text-center">
                <MapPin className="mx-auto h-6 w-6 text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-700">{areasQ.isLoading ? "Loading pickup areas…" : "No pickup areas configured"}</p>
                <p className="mt-1 text-xs text-slate-500">Add active villages and localities to the district pickup area master.</p>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div><h2 className="flex items-center gap-2 font-semibold text-slate-900"><MapPin className="h-4 w-4 text-emerald-700"/> Pickup location map</h2><p className="mt-1 text-xs text-slate-500">{filtered.filter(coordinatesOf).length} located orders · {filtered.filter((job) => !coordinatesOf(job)).length} without coordinates</p></div>
              <Badge variant="outline">{selectedGroupName}</Badge>
            </div>
            {farmMarkers.length ? <SharedMap center={mapCenter} zoom={11} markers={farmMarkers} drawRoute={false} height="300px" className="w-full" onMarkerClick={(marker: any) => setActiveFarmId(String(marker?.id || ""))} /> : <div className="flex h-[260px] flex-col items-center justify-center gap-2 bg-slate-50 text-center"><MapPin className="h-8 w-8 text-slate-400"/><p className="text-sm font-medium text-slate-700">No verified farm coordinates in this area</p><p className="text-xs text-slate-500">Orders remain available below. Add verified GPS coordinates to the farmer's farm profile to show a marker.</p></div>}
            <div className="flex flex-wrap gap-3 border-t bg-slate-50 px-4 py-3 text-xs text-slate-600"><span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/> Each marker represents a farm pickup order</span><span>Only farms in this warehouse district are included</span></div>
          </Card>
          {activeFarmId && (() => {
            const active = filtered.find((job) => idOf(job) === activeFarmId);
            if (!active) return null;
            return <Card className="border-emerald-200 shadow-sm"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Selected farm marker</p><p className="mt-1 font-semibold text-slate-900">{active.farmerName || "Farm"} · {active.orderNumber || active.eventOrderNumber || "Pickup order"}</p><p className="mt-1 text-xs text-slate-600">{active.pickupAddress || "Farm address unavailable"} · {active.productName || "Product"} · {Number(active.quantity || 0)} kg</p></div>
              <Button size="sm" variant="outline" onClick={() => setActiveFarmId("")}>Close</Button>
            </CardContent></Card>;
          })()}

          {filtered.some((job) => !coordinatesOf(job)) && <Card className="border-amber-200 shadow-sm">
            <div className="border-b border-amber-100 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-900"><AlertTriangle className="h-4 w-4 text-amber-600"/> Farms needing location coordinates</h3>
              <p className="mt-1 text-xs text-slate-500">{filtered.filter((job) => !coordinatesOf(job)).length} pickup orders remain visible but cannot be pinned until verified farm GPS coordinates are saved.</p>
            </div>
            <div className="max-h-48 divide-y overflow-y-auto">
              {filtered.filter((job) => !coordinatesOf(job)).map((job) => <div key={idOf(job)} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0"><p className="truncate font-medium text-slate-800">{job.farmerName || "Farmer details unavailable"} · {job.orderNumber || job.eventOrderNumber || "Pickup order"}</p><p className="truncate text-xs text-slate-500">{job.pickupAddress || "No farm pickup address saved"} · {areaOf(job)}</p></div>
                <Badge variant="outline">GPS missing</Badge>
              </div>)}
            </div>
          </Card>}

          <Card className="border-slate-200 shadow-sm">
            <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
              <div><h2 className="font-semibold text-slate-900">Farms ready for collection</h2><p className="mt-1 text-xs text-slate-500">Only farm stock marked Ready for Pickup in this warehouse district is shown for pickup-partner assignment.</p></div>
              <Button variant="outline" size="sm" onClick={selectVisible} disabled={!eligibleFiltered.length}>{eligibleFiltered.length && eligibleFiltered.every((job) => selectedIds.includes(idOf(job))) ? "Clear farm selection" : "Select ready farms"} ({eligibleFiltered.length})</Button>
            </div>
            <div className="grid gap-3 border-b bg-slate-50/70 p-3 md:grid-cols-2">
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="all">All pickup statuses</option>{Object.entries(STATUS_LABEL).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
              <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search farmer, order, product…" className="h-10 w-full rounded-lg border bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-500"/></div>
            </div>
            {jobsQ.isLoading ? <div className="p-10 text-center text-sm text-slate-500">Loading pickup orders…</div> : jobsQ.isError ? <div className="p-8 text-center"><AlertTriangle className="mx-auto h-8 w-8 text-rose-500"/><p className="mt-2 text-sm font-medium">Unable to load pickup orders</p><Button className="mt-3" variant="outline" onClick={() => jobsQ.refetch()}>Try again</Button></div> : filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No orders match the selected filters.</div> : <div className="max-h-[480px] divide-y overflow-y-auto">
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

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><Truck className="h-5 w-5"/></span>
            <div><h2 className="font-semibold text-slate-950">Assign pickup partner</h2><p className="mt-0.5 text-xs text-slate-500">Assign the selected farm collections to an approved partner and vehicle.</p></div>
          </div>
          <Badge variant="outline" className="w-fit">{selectedIds.length} farms selected</Badge>
        </div>
        <CardContent className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)_minmax(180px,0.65fr)_auto] lg:items-end">
          <label className="block min-w-0 space-y-1.5 text-xs font-semibold text-slate-700">Approved pickup partner and vehicle
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"><option value="">Select partner / vehicle</option>{eligibleTeams.map((team) => <option key={team.id} value={team.id}>{team.name || "Pickup partner"} · {team.vehicleType || "Vehicle"} · {team.capacity || team.vehicleCapacity} kg</option>)}</select>
          </label>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <p className="text-xs font-medium text-slate-500">Selected pickup load</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{selectedJobs.length} farms <span className="text-slate-300">·</span> {selectedWeight.toFixed(1)} kg</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{selectedTeam ? `Vehicle capacity: ${selectedTeam.capacity || selectedTeam.vehicleCapacity} kg` : "Select a partner to check capacity"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 px-3.5 py-2.5">
            <p className="text-xs font-medium text-slate-500">Assignment status</p>
            <p className={`mt-1 text-sm font-semibold ${selectedTeam && selectedWeight > Number(selectedTeam.capacity || selectedTeam.vehicleCapacity || 0) ? "text-rose-700" : "text-slate-800"}`}>{selectedTeam && selectedWeight > Number(selectedTeam.capacity || selectedTeam.vehicleCapacity || 0) ? "Capacity exceeded" : selectedIds.length ? "Ready to assign" : "Awaiting farm selection"}</p>
          </div>
          <Button onClick={assignAreaOrders} disabled={assigning || !selectedIds.length || !selectedTeam || selectedWeight > Number(selectedTeam?.capacity || selectedTeam?.vehicleCapacity || 0)} className="h-11 w-full rounded-xl bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 lg:w-auto"><Truck className="mr-2 h-4 w-4"/>{assigning ? "Assigning…" : "Assign pickup route"}</Button>
        </CardContent>
        {selectedTeam && selectedWeight > Number(selectedTeam.capacity || selectedTeam.vehicleCapacity || 0) && <p className="border-t border-rose-100 bg-rose-50 px-5 py-2.5 text-xs text-rose-700">Selected quantity exceeds this vehicle's capacity. Remove farms or select a vehicle with sufficient capacity.</p>}
        {eligibleTeams.length === 0 && <p className="border-t border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-800">No approved pickup partner with registered vehicle capacity is available. Review Pickup Partners first.</p>}
      </Card>

            <p className="text-center text-xs text-slate-400">Pickup Routes is dedicated to farm collection within this warehouse’s configured district. Customer and business delivery destinations are not included.</p>
    </main>
  );
}
