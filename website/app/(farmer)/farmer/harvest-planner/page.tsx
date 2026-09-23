"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sprout,
  CalendarDays,
  Wheat,
  Boxes,
  Layers,
  Store,
  Plus,
  XCircle,
  Loader2,
  CheckCircle2,
  Clock,
  Thermometer,
  TrendingUp,
  MapPin,
  Sun,
  Route,
  Truck,
  Navigation,
  ChevronLeft,
  ChevronRight,
  Users,
  BellRing,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, formatPrice, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Map } from "../../../components/shared/map";
import { LocationPicker, LocationValue } from "../../../components/farmer/location-picker";
import toast from "react-hot-toast";

const STAGES = [
  { key: "planned", label: "Planned", icon: Sprout, color: "text-slate-500" },
  { key: "growing", label: "Growing", icon: Wheat, color: "text-emerald-600" },
  { key: "ready", label: "Ready for Harvest", icon: Clock, color: "text-amber-600" },
  { key: "harvested", label: "Harvested", icon: CheckCircle2, color: "text-blue-600" },
  { key: "batched", label: "Batched", icon: Layers, color: "text-violet-600" },
];

const SEASONS = ["kharif", "rabi", "summer"];
const SOIL_TYPES = ["loamy", "clay", "sandy", "black"];

interface CropPlan {
  id: string;
  cropName: string;
  expectedHarvestDate: string;
  expectedQuantityKg: number;
  preOrderPricePerKg?: number;
  status: string;
  preorderCount?: number;
  notifyCount?: number;
  notes?: string;
  fieldName?: string;
  areaAcres?: number;
  season?: string;
  soilType?: string;
  plantingDate?: string;
  storageType?: string;
  location?: any;
  stage?: string;
  preOrderEnabled?: boolean;
  productCreated?: boolean;
}

const planCoords = (loc: any): { lat: number; lng: number } | null => {
  if (!loc) return null;
  if (loc.type === "Point" && Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
    const lng = Number(loc.coordinates[0]);
    const lat = Number(loc.coordinates[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (typeof loc.lat === "number" && typeof loc.lng === "number") {
    return Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;
  }
  return null;
};

const routeCoords = (loc: any): { lat: number; lng: number } | null => {
  if (!loc) return null;
  if (loc.type === "Point" && Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
    const lng = Number(loc.coordinates[0]);
    const lat = Number(loc.coordinates[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (loc.lat != null && loc.lng != null) {
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  return null;
};

export default function FarmerHarvestPlannerPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [stageCursor, setStageCursor] = useState(0);
  const [routeFor, setRouteFor] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routes, setRoutes] = useState<Record<string, any>>({});
  const [form, setForm] = useState({
    cropName: "",
    fieldName: "",
    areaAcres: "2.5",
    soilType: "loamy",
    season: "kharif",
    plantingDate: "",
    expectedHarvestDate: "",
    expectedQuantityKg: "100",
    storageType: "normal",
    preOrderPricePerKg: "",
    preOrderEnabled: true,
    notes: "",
  });

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["farmerHarvestPlans"],
    queryFn: () => api.get("/harvests/farmer/plans", { params: { source: "planner" } }),
  });

  const { data: batchesData } = useQuery({
    queryKey: ["farmerHarvestBatches"],
    queryFn: () => api.get("/batches"),
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post("/harvests/plans", { ...payload, source: "planner" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestPlans"] });
      setShowForm(false);
      setAiResult(null);
      setLocation(null);
      setForm({
        cropName: "",
        fieldName: "",
        areaAcres: "2.5",
        soilType: "loamy",
        season: "kharif",
        plantingDate: "",
        expectedHarvestDate: "",
        expectedQuantityKg: "100",
        storageType: "normal",
        preOrderPricePerKg: "",
        preOrderEnabled: true,
        notes: "",
      });
      toast.success("Harvest plan created! It will appear on your supply calendar.");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create plan"),
  });

  const harvestMutation = useMutation({
    mutationFn: (planId: string) => api.post(`/harvests/plans/${planId}/harvest`),
    onSuccess: (_data, planId) => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestPlans"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestBatches"] });
      const plan = plans.find((p) => p.id === planId);
      const params = new URLSearchParams({
        name: plan?.cropName || "",
        price: plan?.preOrderPricePerKg ? String(plan.preOrderPricePerKg) : "",
        quantity: plan?.expectedQuantityKg != null ? String(plan.expectedQuantityKg) : "",
        unit: "kg",
        harvestDate: plan?.expectedHarvestDate || "",
        fromHarvest: planId,
      });
      router.push(`/farmer/products/new?${params.toString()}`);
      toast.success("Harvest marked! Now finish creating your product.");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to mark harvest"),
  });

  const cancelMutation = useMutation({
    mutationFn: (planId: string) => api.post(`/harvests/plans/${planId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestPlans"] });
      toast.success("Harvest plan cancelled");
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({ planId, action }: { planId: string; action: "next" | "prev" }) =>
      api.post(`/harvests/plans/${planId}/stage`, { action }),
    onSuccess: (res: any, vars) => {
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestPlans"] });
      queryClient.invalidateQueries({ queryKey: ["farmerHarvestBatches"] });
      const { planId, action } = vars;
      toast.success(res?.message || `Lifecycle updated (${planId})`);
      if (action === "next" && res?.data?.stage === 3) {
        const plan = plans.find((p) => p.id === planId);
        const params = new URLSearchParams({
          name: plan?.cropName || "",
          price: plan?.preOrderPricePerKg ? String(plan.preOrderPricePerKg) : "",
          quantity: plan?.expectedQuantityKg != null ? String(plan.expectedQuantityKg) : "",
          unit: "kg",
          harvestDate: plan?.expectedHarvestDate || "",
          fromHarvest: planId,
        });
        router.push(`/farmer/products/new?${params.toString()}`);
        toast.success("Harvest marked! Now finish creating your product.");
      }
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update stage"),
  });

  const plans: CropPlan[] = (plansData?.data?.plans || []).map((p: any) => ({ ...p, id: p._id || p.id }));
  const batches = batchesData?.data?.batches || [];

  const askAi = () => {
    if (!form.cropName.trim() || !form.plantingDate) {
      toast.error("Enter a crop name and planting date to ask AI");
      return;
    }
    setAiLoading(true);
    api
      .post("/ai/smart-harvest", {
        productId: "plan",
        plantingDate: new Date(form.plantingDate).toISOString(),
        expectedYield: Number(form.expectedQuantityKg),
        location: form.fieldName || "Farm",
        cropType: form.cropName,
      })
      .then((res: any) => {
        setAiResult(res);
        if (res?.recommendedDateRange?.end) {
          setForm((f) => ({ ...f, expectedHarvestDate: res.recommendedDateRange.end }));
        }
        toast.success("AI harvest window generated");
      })
      .catch(() => toast.error("AI planner unavailable right now"))
      .finally(() => setAiLoading(false));
  };

  const statusBadge = (s: string) => {
    if (s === "harvested") return <Badge variant="success">Harvested</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
    if (s === "preorder") return <Badge variant="outline">Pre-order open</Badge>;
    return <Badge variant="secondary">Planned</Badge>;
  };

  const growthProgress = (plan: CropPlan) => {
    if (plan.status === "harvested") return 100;
    if (plan.status === "cancelled") return 0;
    const start = plan.plantingDate ? new Date(plan.plantingDate).getTime() : null;
    const end = new Date(plan.expectedHarvestDate).getTime();
    if (!start || isNaN(start) || isNaN(end) || end <= start) return 0;
    const now = Date.now();
    const pct = Math.round(((now - start) / (end - start)) * 100);
    return Math.max(0, Math.min(100, pct));
  };

  const getStageIndex = (plan?: CropPlan): number => {
    if (!plan) return -1;
    if (plan.status === "cancelled") return -1;
    switch (plan.stage) {
      case "planned":
        return 0;
      case "growing":
        return 1;
      case "ready":
        return 2;
      case "batched":
        return 4;
      case "harvested":
        return batches.some((b: any) => b.cropName === plan.cropName) ? 4 : 3;
      default: {
        // Fallback inference for legacy plans without an explicit stage field.
        if (plan.status === "harvested") {
          return batches.some((b: any) => b.cropName === plan.cropName) ? 4 : 3;
        }
        const p = growthProgress(plan);
        if (p >= 100) return 2;
        if (p > 0) return 1;
        return 0;
      }
    }
  };

  const orderedPlans = useMemo(
    () =>
      [...plans].sort((a, b) => {
        const sa = getStageIndex(a);
        const sb = getStageIndex(b);
        if (sa !== sb) return sa - sb;
        return new Date(a.expectedHarvestDate).getTime() - new Date(b.expectedHarvestDate).getTime();
      }),
    [plans, batches]
  );
  const firstActiveIndex = orderedPlans.findIndex((p) => p.status !== "harvested" && p.status !== "cancelled");
  const activeIndex =
    orderedPlans.length === 0
      ? -1
      : firstActiveIndex === -1
        ? Math.max(0, orderedPlans.length - 1)
        : firstActiveIndex;
  const activeStageIndex = activeIndex >= 0 ? getStageIndex(orderedPlans[activeIndex]) : -1;
  const plansInStage = (stageIdx: number) => orderedPlans.filter((p) => getStageIndex(p) === stageIdx);
  const viewedStage = Math.max(0, Math.min(STAGES.length - 1, stageCursor));

  useEffect(() => {
    if (activeStageIndex >= 0) setStageCursor(activeStageIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStageIndex, plans.length]);

  const planMarkers = orderedPlans
    .map((plan, index) => {
      const coords = planCoords(plan.location);
      return coords
        ? {
            id: plan.id,
            lat: coords.lat,
            lng: coords.lng,
            title: `${index + 1}. ${plan.cropName}`,
            info: `${STAGES[getStageIndex(plan)]?.label || "Cancelled"} • Harvest ${formatDate(plan.expectedHarvestDate)}`,
            address: plan.fieldName || plan.cropName,
          }
        : null;
    })
    .filter(Boolean) as Array<{ id: string; lat: number; lng: number; title: string; info: string; address: string }>;
  const planRoute = orderedPlans
    .map((plan) => planCoords(plan.location))
    .filter((c): c is { lat: number; lng: number } => c !== null);

  const generateRoute = async (planId: string) => {
    setRouteLoading(true);
    setRouteFor(planId);
    try {
      const res = await api.post(`/harvests/plans/${planId}/route`);
      setRoutes((prev) => ({ ...prev, [planId]: res?.data }));
      toast.success(res?.message || "Delivery route generated");
    } catch (err: any) {
      const existing = routes[planId];
      if (!existing) {
        try {
          const fetched = await api.get(`/harvests/plans/${planId}/route`);
          setRoutes((prev) => ({ ...prev, [planId]: fetched?.data }));
          toast.success("Loaded the existing route for this harvest");
        } catch {
          toast.error(err?.message || "No pre-orders to route yet");
          setRouteFor(null);
        }
      }
    } finally {
      setRouteLoading(false);
    }
  };

  const closeRoute = () => setRouteFor(null);

  const openGoogleNav = (plan: any) => {
    const origin = routeCoords(routes[routeFor!]?.origin);
    const coords = planCoords(plan.location);
    const originParam = origin ? `&origin=${origin.lat},${origin.lng}` : "";
    const dest = coords ? `${coords.lat},${coords.lng}` : plan.address;
    if (!dest) {
      toast.error("This stop has no navigable location");
      return;
    }
    window.open(
      `https://www.google.com/maps/dir/?api=1${originParam}&destination=${encodeURIComponent(dest)}&travelmode=driving`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Harvest Planner</h1>
          <p className="text-gray-500">
            Field → Crop → Harvest → Batch → Inventory → Marketplace. Plan what you grow and when it will be ready.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? <XCircle className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
          {showForm ? "Cancel" : "Plan a Harvest"}
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.map((stage, i) => {
            const count = plans.filter((p) => getStageIndex(p) === i).length;
            const isActive = viewedStage === i;
            return (
              <div key={stage.key} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStageCursor(i)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-blue-500 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <stage.icon className={cn("h-4 w-4", isActive ? "text-white" : stage.color)} />
                  <span>{stage.label}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-0.5 rounded-full px-1.5 text-[10px] font-bold",
                        isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
                {i < STAGES.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
              </div>
            );
          })}
        </div>
        {activeStageIndex >= 0 && (
          <p className="text-xs text-slate-500">
            Viewing: <span className="font-semibold text-blue-600">{STAGES[viewedStage]?.label} stage</span> —{" "}
            {plansInStage(viewedStage).length} plan(s) here. Your next active plan is at the{" "}
            <span className="font-semibold">{STAGES[activeStageIndex]?.label}</span> stage.
          </p>
        )}
      </div>

      {planMarkers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-5 w-5 text-emerald-600" />
              Field Map — route through your crops
            </CardTitle>
            <CardDescription>Plans are numbered by harvest date. The active plan is highlighted on the cards below.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Map
              center={planMarkers[0] ? { lat: planMarkers[0].lat, lng: planMarkers[0].lng } : { lat: 11.2322, lng: 78.8805 }}
              zoom={13}
              markers={planMarkers}
              route={planRoute}
              height="320px"
            />
          </CardContent>
        </Card>
      )}

      {routeFor && routes[routeFor] && (
        <Card className="border-blue-200">
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-5 w-5 text-blue-600" />
                Delivery Route
              </CardTitle>
              <CardDescription>
                {routes[routeFor]?.waypoints?.length || 0} stops •{" "}
                {routes[routeFor]?.summary?.totalDistanceKm} km • ₹{routes[routeFor]?.summary?.totalValue}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={closeRoute}>
              <XCircle className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const origin = routeCoords(routes[routeFor]?.origin);
              const stops = (routes[routeFor]?.waypoints || []) as any[];
              const markers = [
                ...(origin
                  ? [{
                      id: "farm-origin",
                      lat: origin.lat,
                      lng: origin.lng,
                      title: "Farm",
                      info: "Route starting point",
                      address: "Farm",
                    }]
                  : []),
                ...stops
                  .filter((s: any) => s.lat != null && s.lng != null)
                  .map((s: any) => ({
                    id: String(s.sequence),
                    lat: s.lat,
                    lng: s.lng,
                    title: `${s.sequence}. ${s.customerName}`,
                    info: `${s.address || "Delivery stop"} • ${s.eta || "ETA pending"}`,
                    address: s.address || "Delivery stop",
                  })),
              ];
              const route = [
                ...(origin ? [origin] : []),
                ...stops
                  .filter((s: any) => s.lat != null && s.lng != null)
                  .map((s: any) => ({ lat: s.lat, lng: s.lng })),
              ];
              return (
                <>
                  <Map
                    center={(origin || markers[0]) ? { lat: (origin || markers[0]).lat, lng: (origin || markers[0]).lng } : { lat: 11.2322, lng: 78.8805 }}
                    zoom={12}
                    markers={markers}
                    route={route}
                    height="300px"
                  />
                  <div className="space-y-2">
                    {stops.map((stop: any) => (
                      <div key={stop.preorderId} className="flex items-center gap-3 rounded-lg border-l-4 border-blue-400 bg-blue-50/40 p-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                          {stop.sequence}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{stop.customerName}</p>
                          <p className="truncate text-xs text-gray-500">{stop.address}</p>
                          <p className="text-xs text-gray-400">
                            {stop.quantityKg} kg • ₹{stop.total} • {stop.eta}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => openGoogleNav({ ...stop, location: stop.lat != null ? { lat: stop.lat, lng: stop.lng } : null })}>
                          <Navigation className="mr-1 h-3.5 w-3.5" /> Navigate
                        </Button>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Harvest Plan</CardTitle>
            <CardDescription>
              Tell us about the field and crop. The AI planner can suggest the best harvest window.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Crop name *</label>
                <Input
                  value={form.cropName}
                  onChange={(e) => setForm({ ...form, cropName: e.target.value })}
                  placeholder="e.g. Tomato"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Field name</label>
                <Input
                  value={form.fieldName}
                  onChange={(e) => setForm({ ...form, fieldName: e.target.value })}
                  placeholder="e.g. Field A"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Area (acres)</label>
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={form.areaAcres}
                  onChange={(e) => setForm({ ...form, areaAcres: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Season</label>
                <Select value={form.season} onValueChange={(v) => setForm({ ...form, season: v })}>
                  <SelectContent>
                    {SEASONS.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Soil type</label>
                <Select value={form.soilType} onValueChange={(v) => setForm({ ...form, soilType: v })}>
                  <SelectContent>
                    {SOIL_TYPES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Planting date *</label>
                <Input
                  type="date"
                  value={form.plantingDate}
                  onChange={(e) => setForm({ ...form, plantingDate: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Expected harvest date</label>
                <Input
                  type="date"
                  value={form.expectedHarvestDate}
                  onChange={(e) => setForm({ ...form, expectedHarvestDate: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Expected quantity (kg) *</label>
                <Input
                  type="number"
                  min={1}
                  value={form.expectedQuantityKg}
                  onChange={(e) => setForm({ ...form, expectedQuantityKg: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Pre-order price (₹/kg)</label>
                <Input
                  type="number"
                  min={0}
                  value={form.preOrderPricePerKg}
                  onChange={(e) => setForm({ ...form, preOrderPricePerKg: e.target.value })}
                  placeholder="e.g. 42"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Storage type</label>
                <Select value={form.storageType} onValueChange={(v) => setForm({ ...form, storageType: v })}>
                  <SelectContent>
                    <SelectItem value="normal">Normal / ambient</SelectItem>
                    <SelectItem value="refrigerated">Refrigerated</SelectItem>
                    <SelectItem value="cold_storage">Cold storage</SelectItem>
                    <SelectItem value="frozen">Frozen</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  id="plannerPreorderToggle"
                  checked={form.preOrderEnabled}
                  onChange={(e) => setForm({ ...form, preOrderEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                />
                <label htmlFor="plannerPreorderToggle" className="text-sm text-gray-600">
                  Accept pre-orders (requires a price; opens when the crop is ready)
                </label>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs font-medium text-gray-500">Notes (optional)</label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. Organic, irrigated, expected high yield"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <LocationPicker value={location} onChange={setLocation} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex items-center gap-2 text-sm text-emerald-800">
                <TrendingUp className="h-4 w-4" />
                Get an AI harvest window (uses crop maturity + weather + festival demand)
              </div>
              <Button variant="outline" size="sm" onClick={askAi} disabled={aiLoading}>
                {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sprout className="mr-2 h-4 w-4" />}
                Ask AI Planner
              </Button>
            </div>

            {aiResult && (
              <div className="grid gap-3 rounded-lg border bg-slate-50 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-gray-500 flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Recommended window</p>
                  <p className="font-semibold text-sm mt-0.5">
                    {aiResult.recommendedDateRange?.start} → {aiResult.recommendedDateRange?.end}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 flex items-center gap-1"><Thermometer className="h-3 w-3" /> Market timing</p>
                  <p className="font-semibold text-sm mt-0.5">{(Number(aiResult.marketTimingScore) * 100).toFixed(0)}%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Weather advisory</p>
                  <p className="font-semibold text-sm mt-0.5">{aiResult.weatherAdvisory}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                disabled={!form.cropName || !form.plantingDate || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    cropName: form.cropName,
                    fieldName: form.fieldName || null,
                    areaAcres: Number(form.areaAcres),
                    season: form.season,
                    soilType: form.soilType,
                    expectedHarvestDate: new Date(form.expectedHarvestDate || form.plantingDate).toISOString(),
                    expectedQuantityKg: Number(form.expectedQuantityKg),
                    storageType: form.storageType,
                    preOrderPricePerKg: form.preOrderPricePerKg ? Number(form.preOrderPricePerKg) : null,
                    preOrderEnabled: form.preOrderEnabled,
                    notes: form.notes || null,
                    location: location
                      ? { type: "Point", coordinates: [location.lng, location.lat], address: location.address || null }
                      : null,
                  })
                }
              >
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Plan
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Sprout className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No harvest plans yet</p>
            <p className="text-sm text-gray-400">Plan your first crop to map out the harvest season.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {orderedPlans.length > 0 && (
            <Card className="border-blue-200 bg-blue-50/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Route className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-semibold text-slate-900">
                      Stage {viewedStage + 1} of {STAGES.length} — {STAGES[viewedStage]?.label}
                    </p>
                    <p className="text-xs text-slate-600">
                      {plansInStage(viewedStage).length > 0
                        ? `${plansInStage(viewedStage).map((p) => p.cropName).join(", ")} — ${plansInStage(viewedStage).length} plan(s) in this stage`
                        : "No plans at this stage yet"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={viewedStage === 0}
                    onClick={() => setStageCursor((v) => Math.max(0, v - 1))}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={viewedStage >= STAGES.length - 1}
                    onClick={() => setStageCursor((v) => Math.min(STAGES.length - 1, v + 1))}
                  >
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orderedPlans.map((plan, index) => {
            const progress = growthProgress(plan);
            const planStage = getStageIndex(plan);
            const stage =
              plan.status === "harvested"
                ? { label: "Harvested", icon: CheckCircle2, cls: "bg-blue-100 text-blue-700" }
                : plan.status === "cancelled"
                  ? { label: "Cancelled", icon: XCircle, cls: "bg-red-100 text-red-600" }
                  : progress >= 100
                    ? { label: "Ready for Harvest", icon: Clock, cls: "bg-amber-100 text-amber-700" }
                    : progress > 0
                      ? { label: "Growing", icon: Wheat, cls: "bg-emerald-100 text-emerald-700" }
                      : { label: "Planned", icon: Sprout, cls: "bg-slate-100 text-slate-600" };
            const StageIcon = stage.icon;
            const stopStatus =
              plan.status === "cancelled"
                ? { label: "Cancelled", cls: "border-red-300 bg-red-50 text-red-600" }
                : plan.status === "harvested" || index < activeIndex
                  ? { label: "Done", cls: "border-green-300 bg-green-50 text-green-700" }
                  : index === activeIndex
                    ? { label: "Current", cls: "border-blue-500 bg-blue-600 text-white" }
                    : { label: "Pending", cls: "border-gray-200 bg-white text-gray-500" };
            return (
              <Card key={plan.id} className={cn(planStage === viewedStage && "border-blue-400 ring-2 ring-blue-100")}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                          planStage === viewedStage ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600"
                        )}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <CardTitle className="text-base">{plan.cropName}</CardTitle>
                        <CardDescription className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" /> Harvest: {formatDate(plan.expectedHarvestDate)}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", stopStatus.cls)}>
                        {stopStatus.label}
                      </span>
                      {statusBadge(plan.status)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Farming details */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {plan.fieldName ? (
                      <div className="flex items-center gap-2 text-gray-600">
                        <MapPin className="h-4 w-4 text-emerald-600" />
                        <span className="truncate">{plan.fieldName}</span>
                      </div>
                    ) : null}
                    {plan.areaAcres ? (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Boxes className="h-4 w-4 text-emerald-600" />
                        {plan.areaAcres} acres
                      </div>
                    ) : null}
                    {plan.season ? (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Sun className="h-4 w-4 text-amber-500" />
                        {plan.season.charAt(0).toUpperCase() + plan.season.slice(1)} season
                      </div>
                    ) : null}
                    {plan.soilType ? (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Layers className="h-4 w-4 text-amber-700" />
                        {plan.soilType.charAt(0).toUpperCase() + plan.soilType.slice(1)} soil
                      </div>
                    ) : null}
                  </div>

                  {/* Lifecycle route: Planned → Growing → Ready → Harvested → Batched */}
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-gray-500">
                      <span>Lifecycle route</span>
                      <span className={cn("font-semibold", planStage >= 0 && STAGES[planStage]?.color)}>
                        {planStage >= 0 ? STAGES[planStage]?.label : "Cancelled"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {STAGES.map((stage, i) => (
                        <div key={stage.key} className="flex-1">
                          <div
                            className={cn(
                              "h-1.5 rounded-full transition-colors",
                              planStage >= 0 && i <= planStage ? "bg-blue-500" : "bg-gray-200"
                            )}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] font-medium text-gray-400">
                      {STAGES.map((stage) => (
                        <span key={stage.key}>{stage.label.split(" ")[0]}</span>
                      ))}
                    </div>
                  </div>

                  {/* Planting → Harvest timeline */}
                  {plan.plantingDate && (
                    <div className="rounded-lg border bg-slate-50 p-3">
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                        <span>🌱 {formatDate(plan.plantingDate)}</span>
                        <span>🌾 {formatDate(plan.expectedHarvestDate)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-amber-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <StageIcon className={cn("h-3.5 w-3.5", stage.cls.split(" ")[0])} />
                        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", stage.cls)}>
                          {stage.label}
                        </span>
                        <span className="ml-auto text-xs font-medium text-gray-500">{progress}%</span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Boxes className="h-4 w-4 text-emerald-600" />
                      {plan.expectedQuantityKg} kg expected
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Store className="h-4 w-4 text-emerald-600" />
                      {plan.preOrderPricePerKg ? `${formatPrice(plan.preOrderPricePerKg)}/kg` : "No pre-order price"}
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Users className="h-4 w-4 text-emerald-600" />
                      {plan.preorderCount ?? 0} pre-orders
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <BellRing className="h-4 w-4 text-emerald-600" />
                      {plan.notifyCount ?? 0} notified
                    </div>
                    {plan.storageType ? (
                      <div className="flex items-center gap-2 text-gray-600">
                        <Thermometer className="h-4 w-4 text-blue-500" />
                        {plan.storageType === "cold_storage" ? "Cold storage" : plan.storageType.charAt(0).toUpperCase() + plan.storageType.slice(1)}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-gray-500">Converted to batches</span>
                    <span className="font-medium text-gray-700">{batches.filter((b: any) => b.cropName === plan.cropName).length}</span>
                  </div>
                  {plan.notes ? <p className="text-sm text-gray-500">{plan.notes}</p> : null}
                  {plan.productCreated ? (
                    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-700">
                      Product created — this harvest plan is complete
                    </div>
                  ) : plan.status !== "harvested" && plan.status !== "cancelled" ? (
                    <div className="flex gap-2 pt-1">
                      <Button
                        className="flex-1"
                        size="sm"
                        disabled={harvestMutation.isPending}
                        onClick={() => harvestMutation.mutate(plan.id)}
                      >
                        {harvestMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Mark Harvested
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate(plan.id)}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                  {plan.status === "harvested" && (
                    <Button
                      className="w-full"
                      variant="outline"
                      size="sm"
                      disabled={routeLoading}
                      onClick={() => generateRoute(plan.id)}
                    >
                      {routeLoading && routeFor === plan.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                      {routes[plan.id] ? "View Delivery Route" : "Generate Delivery Route"}
                    </Button>
                  )}
                  <div className="flex items-center gap-2 border-t pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={planStage <= 0 || stageMutation.isPending || Boolean(plan.productCreated)}
                      onClick={() => stageMutation.mutate({ planId: plan.id, action: "prev" })}
                      title={plan.productCreated ? "Product already created for this harvest. The previous step is locked." : undefined}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" /> Prev
                    </Button>
                    <span className="text-xs font-medium text-slate-500">
                      {STAGES[Math.max(0, planStage)]?.label}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={planStage >= STAGES.length - 1 || stageMutation.isPending}
                      onClick={() => stageMutation.mutate({ planId: plan.id, action: "next" })}
                    >
                      Next <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                  {plan.productCreated && (
                    <p className="text-center text-[11px] font-medium text-emerald-600">
                      Product created — previous step locked
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
          </div>
        </>
      )}
    </div>
  );
}
