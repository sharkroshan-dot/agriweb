"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw, Clock3, AlertCircle, Send, MapPin, Warehouse, Route, Truck, PackageCheck, CheckCircle2, ArrowRight, MapPinned } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

type RouteKey = "nearby" | "same_district" | "inter_district" | "multi_warehouse" | "route_review" | "needs_location" | "farmer_fulfillment_transfer";
const ROUTES: { key: RouteKey; title: string; subtitle: string; next: string }[] = [
  { key: "nearby", title: "Nearby Delivery", subtitle: "Within 15 km and direct delivery explicitly configured", next: "Warehouse → Delivery Partner → Customer" },
  { key: "same_district", title: "Same-District Warehouse Fulfillment", subtitle: "Beyond 15 km, source and customer in the same district", next: "Warehouse → Local Hub → Delivery Partner → Customer" },
  { key: "inter_district", title: "Inter-District Warehouse Fulfillment", subtitle: "Different source and destination districts", next: "Source Warehouse → Destination Warehouse → Local Hub → Delivery Partner → Customer" },
  { key: "multi_warehouse", title: "Multi-Warehouse Consolidation", subtitle: "Orders that require multiple source warehouses", next: "Source Warehouses → Consolidation → Local Hub → Delivery Partner → Customer" },
  { key: "route_review", title: "Route Review Required", subtitle: "Direct delivery is not configured or the route needs review", next: "Resolve route configuration before dispatch" },
  { key: "needs_location", title: "Needs Location Data", subtitle: "Missing coordinates or district details", next: "Complete location data before dispatch" },
  { key: "farmer_fulfillment_transfer", title: "Farmer Fulfillment Transfers", subtitle: "Farmer-packed orders belong to the dedicated transfer workflow", next: "Continue in Farmer Fulfillment Transfers" },
];
const categoryOf = (item: any): RouteKey => {
  const category = String(item?.routeCategory || item?.farmerFulfillmentRouteType || item?.warehouseRouteCategory || "needs_location");
  return (ROUTES.some((r) => r.key === category) ? category : "needs_location") as RouteKey;
};
const routeReady = (item: any) => ["nearby", "same_district", "inter_district", "multi_warehouse"].includes(categoryOf(item)) && item?.routeDataComplete !== false && item?.routeDistanceKm != null;
const statusLabel = (status: string) => status === "pending" ? "Ready for Dispatch" : status === "packed" ? "Packed" : status === "dispatched" ? "Dispatched" : status || "Unknown";
const normalizePlace = (value: any) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const locationPoint = (value: any): [number, number] | null => {
  if (!value || typeof value !== "object") return null;
  const nested = value.location || value.coordinates || value.geoLocation || value.geo_location || value.position || value;
  if (Array.isArray(nested) && nested.length >= 2) {
    const a = Number(nested[0]); const b = Number(nested[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a) > 90 ? [b, a] : [a, b];
  }
  const lat = Number(nested.latitude ?? nested.lat);
  const lng = Number(nested.longitude ?? nested.lng ?? nested.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
};
const distanceKm = (a: [number, number], b: [number, number]) => {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b[0] - a[0]); const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const isVerifiedActiveHub = (hub: any) => {
  if (hub?.isActive === false || hub?.active === false || hub?.isVerified === false || hub?.verified === false) return false;
  const state = normalizePlace(hub?.verificationStatus || hub?.approvalStatus || hub?.status);
  return !["pending", "pending_verification", "rejected", "inactive", "disabled", "unverified"].includes(state);
};
const addressSearchText = (value: any) => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return [value.addressLine1, value.addressLine2, value.address, value.street, value.locality, value.area, value.village, value.taluk, value.talukName, value.subDistrict, value.tehsil, value.city, value.town, value.district, value.districtName, value.state, value.stateName, value.postalCode, value.pincode, value.country].filter(Boolean).join(", ");
};
const geocodeAddress = async (value: any): Promise<[number, number] | null> => {
  const existing = locationPoint(value);
  if (existing) return existing;
  const query = addressSearchText(value);
  if (!query || query.length < 5) return null;
  try {
    const response = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=" + encodeURIComponent(query), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const results = await response.json();
    if (!Array.isArray(results) || !results[0]) return null;
    const lat = Number(results[0].lat); const lng = Number(results[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  } catch { return null; }
};
const chooseLocalHubForOrder = async (item: any, hubs: any[]) => {
  const destination = item?.deliveryAddress || item?.shippingAddress || item?.customerAddress || item?.destinationAddress || {};
  const customerPoint = locationPoint(destination) || locationPoint(item?.deliveryLocation) || locationPoint(item?.customerLocation) || await geocodeAddress(destination);
  const resolvedHubs = await Promise.all((hubs || []).map(async (hub) => {
    if (locationPoint(hub?.location) || locationPoint(hub?.coordinates) || locationPoint(hub?.address)) return hub;
    const point = await geocodeAddress(hub?.address || {
      addressLine1: hub?.addressLine1, addressLine2: hub?.addressLine2, locality: hub?.locality,
      taluk: hub?.taluk || hub?.talukName, city: hub?.city, district: hub?.district || hub?.districtName,
      state: hub?.state || hub?.stateName, pincode: hub?.pincode || hub?.postalCode, country: "India",
    });
    return point ? { ...hub, location: { latitude: point[0], longitude: point[1] } } : hub;
  }));
  const resolvedItem = customerPoint ? {
    ...item,
    deliveryLocation: { latitude: customerPoint[0], longitude: customerPoint[1] },
    deliveryAddress: { ...(typeof destination === "object" ? destination : {}), location: { latitude: customerPoint[0], longitude: customerPoint[1] } },
  } : item;
  return chooseLocalHub(resolvedItem, resolvedHubs);
};
const chooseLocalHub = (item: any, hubs: any[]) => {
  const eligible = (hubs || []).filter((hub) => hub?.id && isVerifiedActiveHub(hub));
  if (!eligible.length) return null;
  const destination = item?.deliveryAddress || item?.shippingAddress || item?.customerAddress || item?.destinationAddress || {};
  const destinationDistrict = normalizePlace(item?.destinationDistrict || destination?.district || destination?.districtName);
  const destinationTaluk = normalizePlace(item?.destinationTaluk || item?.deliveryTaluk || item?.destinationSubDistrict || destination?.taluk || destination?.talukName || destination?.subDistrict || destination?.tehsil);
  const customerPoint = locationPoint(destination) || locationPoint(item?.deliveryLocation) || locationPoint(item?.customerLocation);
  const scored = eligible.map((hub) => {
    const hubDistrict = normalizePlace(hub?.district || hub?.districtName || hub?.address?.district || hub?.address?.districtName);
    const hubTaluk = normalizePlace(hub?.taluk || hub?.talukName || hub?.subDistrict || hub?.tehsil || hub?.address?.taluk || hub?.address?.talukName || hub?.address?.subDistrict || hub?.address?.tehsil);
    const hubPoint = locationPoint(hub?.location) || locationPoint(hub?.coordinates) || locationPoint(hub?.address);
    const distance = customerPoint && hubPoint ? distanceKm(customerPoint, hubPoint) : null;
    const talukMatch = Boolean(destinationTaluk && hubTaluk && destinationTaluk === hubTaluk);
    const districtMatch = Boolean(destinationDistrict && hubDistrict && destinationDistrict === hubDistrict);
    // Taluk match takes precedence, then same district, then nearest by coordinates.
    const score = (talukMatch ? 100000 : 0) + (districtMatch ? 10000 : 0) + (distance == null ? 0 : Math.max(0, 1000 - distance));
    return { hub, score, distance, talukMatch, districtMatch };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || (!best.talukMatch && !best.districtMatch && best.distance == null)) return null;
  return best.hub;
};

export default function WarehouseOutgoingPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeSection, setActiveSection] = useState<RouteKey>("nearby");
  const hubsQuery = useQuery({ queryKey: ["warehouse-local-hubs-dispatch"], queryFn: () => api.get("/warehouse/me/local-hubs"), retry: 1 });
  const localHubs = hubsQuery.data?.data?.hubs || hubsQuery.data?.hubs || [];
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["warehouseOutgoing", statusFilter],
    queryFn: () => api.get("/warehouse/me/outgoing", { params: { status: statusFilter !== "all" ? statusFilter : undefined, limit: 100 } }),
    refetchInterval: 20000,
  });
  const allOutgoing = data?.data?.outgoing || [];
  const outgoing = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return allOutgoing.filter((item: any) => !q || [item.orderId, item.productId, item.productName, item.batchNumber, item.deliveryPartnerId, item.sourceDistrict, item.destinationDistrict].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [allOutgoing, searchTerm]);
  const grouped = useMemo(() => Object.fromEntries(ROUTES.map((r) => [r.key, outgoing.filter((item: any) => categoryOf(item) === r.key)])) as Record<RouteKey, any[]>, [outgoing]);
  const readyCount = outgoing.filter((item: any) => ["pending", "packed"].includes(String(item.status)) && routeReady(item)).length;

  const processSection = async (section: RouteKey) => {
    const rows = grouped[section] || [];
    if (!rows.length) { toast("There are no orders in this section to process."); return; }
    if (section === "farmer_fulfillment_transfer") { window.location.href = "/farmer-fulfillment"; return; }
    if (section === "route_review" || section === "needs_location") { toast.error("These orders require route/location correction before dispatch. No orders were dispatched."); return; }
    if (section === "multi_warehouse") { window.location.href = "/warehouse/consolidation"; return; }
    const eligible = rows.filter((item: any) => ["pending", "packed"].includes(String(item.status)) && routeReady(item));
    if (!eligible.length) { toast.error("No eligible ready-to-dispatch orders in this section."); return; }
    let succeeded = 0; const failed: string[] = [];
    for (const item of eligible) {
      try {
        if (!item.orderId) throw new Error("Missing customer order");
        const response = await api.get("/warehouse/me/orders/" + item.orderId + "/fulfillment-check");
        const audit = response?.data || response;
        if (!audit?.readyForDispatch) throw new Error("Packing not verified");
        if (section === "inter_district") {
          await api.post("/warehouse/me/outgoing/" + item.id + "/inter-district-dispatch");
          succeeded += 1;
          continue;
        }
        if (section === "same_district") {
          const hub = await chooseLocalHubForOrder(item, localHubs);
          if (!hub?.id) throw new Error("No verified active local hub matches the customer's taluk/district or has usable location data. Verify the local hub and customer delivery address before dispatch.");
          await api.post(`/warehouse/me/local-hubs/${hub.id}/orders/${item.orderId}/dispatch`, {});
          succeeded += 1;
          continue;
        }
        const route = "nearby";
        await api.post("/warehouse/me/outgoing/" + item.id + "/delivery-route", { route, radius: item.nearbyThresholdKm ?? 15 });
        await api.put("/warehouse/me/outgoing/" + item.id + "/status", undefined, { params: { status: "dispatched" } });
        await api.post("/warehouse/me/outgoing/" + item.id + "/delivery-route", { route, radius: item.nearbyThresholdKm ?? 15 });
        succeeded += 1;
      } catch (e: any) { failed.push(String(item.orderNumber || item.orderId || item.id) + (e?.message ? ": " + e.message : "")); }
    }
    if (succeeded) toast.success("Processed " + succeeded + " order(s) in " + (ROUTES.find((r) => r.key === section)?.title || section) + ".");
    if (failed.length) toast.error(failed.length + " order(s) could not be processed. " + failed.slice(0, 2).join("; "));
    await refetch();
  };
  const processDispatch = async (item: any) => {
    const category = categoryOf(item);
    try {
      if (!routeReady(item)) throw new Error("Route review required. Add complete location and district data before dispatch.");
      if (!item.orderId) throw new Error("This shipment is not linked to a customer order.");
      const auditResponse = await api.get(`/warehouse/me/orders/${item.orderId}/fulfillment-check`);
      const audit = auditResponse?.data || auditResponse;
      if (!audit?.readyForDispatch) throw new Error("Packing verification is incomplete. Verify packed quantities before dispatch.");

      if (category === "same_district") {
        const hub = await chooseLocalHubForOrder(item, localHubs);
        if (!hub?.id) throw new Error("No verified active local hub matches the customer's taluk/district or has usable location data. Verify the local hub and customer delivery address before dispatch.");
        await api.post(`/warehouse/me/local-hubs/${hub.id}/orders/${item.orderId}/dispatch`, {});
        toast.success(`Order dispatched to ${hub.name}. The hub manager must confirm receipt before publishing it to delivery partners.`);
        await refetch();
        return;
      }
      if (category === "nearby") {
        // Existing warehouse routing supports direct delivery or a controlled
        // local-hub handoff. The long-distance route keeps partner assignment
        // gated until the hub confirms receipt.
        const route = category === "nearby" ? "nearby" : "long_distance";
        await api.post(`/warehouse/me/outgoing/${item.id}/delivery-route`, { route, radius: item.nearbyThresholdKm ?? 15 });
        await api.put(`/warehouse/me/outgoing/${item.id}/status`, undefined, { params: { status: "dispatched" } });
        await api.post(`/warehouse/me/outgoing/${item.id}/delivery-route`, { route, radius: item.nearbyThresholdKm ?? 15 });
        toast.success(category === "nearby"
          ? "Shipment dispatched to the direct-delivery workflow."
          : "Shipment dispatched into the local-hub handoff workflow. Confirm hub receipt before final-mile assignment.");
        await refetch();
        return;
      }
      if (category === "inter_district") {
        const result = await api.post(`/warehouse/me/outgoing/${item.id}/inter-district-dispatch`);
        const transfer = result?.data?.data || result?.data || {};
        toast.success(`Dispatched to ${transfer.destinationWarehouseName || "destination warehouse"} in ${transfer.destinationDistrict || item.destinationDistrict}. Transfer team: ${transfer.transferTeamName || "assigned"}. Confirm physical receipt at the destination warehouse to continue to the local hub.`);
        await refetch();
        return;
      }
      if (category === "multi_warehouse") {
        window.location.href = "/warehouse/consolidation";
        return;
      }
      throw new Error("This shipment must be resolved in Route Review before dispatch.");
    } catch (e: any) { toast.error(e?.message || "Could not process shipment"); }
  };

  return <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-8">
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-3 text-primary"><Truck className="h-6 w-6"/></div>
        <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight">Outgoing / Dispatch</h1><p className="mt-1 text-sm leading-6 text-muted-foreground">Review packed orders, confirm the route, and complete the correct warehouse handoff.</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="outline">15 km routing threshold</Badge><span>Automatic refresh every 20 seconds</span></div></div>
      </div>
      <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="shrink-0"><RefreshCw className={"mr-2 h-4 w-4 " + (isFetching ? "animate-spin" : "")}/>{isFetching ? "Refreshing…" : "Refresh orders"}</Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card className="rounded-xl"><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Total shipments</span><PackageCheck className="h-5 w-5 text-muted-foreground"/></div><p className="mt-2 text-3xl font-bold tabular-nums">{outgoing.length}</p></CardContent></Card>
      <Card className="rounded-xl"><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Ready for dispatch</span><Send className="h-5 w-5 text-muted-foreground"/></div><p className="mt-2 text-3xl font-bold tabular-nums">{outgoing.filter((x: any) => ["pending","packed"].includes(String(x.status))).length}</p></CardContent></Card>
      <Card className="rounded-xl"><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Route review</span><AlertCircle className="h-5 w-5 text-amber-600"/></div><p className="mt-2 text-3xl font-bold tabular-nums">{grouped.route_review.length + grouped.needs_location.length}</p></CardContent></Card>
      <Card className="rounded-xl"><CardContent className="p-4"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Dispatched</span><CheckCircle2 className="h-5 w-5 text-emerald-600"/></div><p className="mt-2 text-3xl font-bold tabular-nums">{outgoing.filter((x: any) => x.status === "dispatched").length}</p></CardContent></Card>
    </div>

    <Card className="rounded-xl border-primary/15 bg-primary/[0.025]"><CardContent className="flex items-start gap-3 p-4"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Route className="h-5 w-5"/></div><div className="min-w-0 text-sm"><p className="font-semibold">Automatic route classification</p><p className="mt-1 leading-6 text-muted-foreground">Routes use source location, customer address, district and the 15 km threshold. Same-district shipments are matched to an eligible local hub. Orders with missing or ambiguous location data remain visible for correction; Farmer Fulfillment uses its separate transfer workflow.</p></div></CardContent></Card>

    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input className="h-10 pl-9" placeholder="Search order ID, product, district or partner…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}/></div><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-10 w-full sm:w-[220px]"><SelectValue placeholder="Filter status"/></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="pending">Ready for Dispatch</SelectItem><SelectItem value="packed">Packed</SelectItem><SelectItem value="dispatched">Dispatched</SelectItem></SelectContent></Select></div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {ROUTES.map((route) => <button key={route.key} type="button" onClick={() => setActiveSection(route.key)} className={"min-h-[126px] rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md " + (activeSection === route.key ? "border-primary bg-primary/[0.035] ring-2 ring-primary/15" : "border-border/80 hover:border-primary/40")}>
        <div className="flex items-start gap-3"><div className={"rounded-lg p-2 " + (activeSection === route.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{route.key === "nearby" ? <Truck className="h-4 w-4"/> : route.key === "same_district" ? <MapPinned className="h-4 w-4"/> : route.key === "inter_district" ? <Warehouse className="h-4 w-4"/> : route.key === "multi_warehouse" ? <PackageCheck className="h-4 w-4"/> : route.key === "farmer_fulfillment_transfer" ? <Route className="h-4 w-4"/> : <AlertCircle className="h-4 w-4"/>}</div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold leading-5">{route.title}</span><Badge variant={activeSection === route.key ? "default" : "secondary"}>{grouped[route.key].length}</Badge></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{route.subtitle}</p></div></div>
      </button>)}
    </div>

    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><div className="rounded-lg bg-primary/10 p-2.5 text-primary"><Warehouse className="h-5 w-5"/></div><div className="min-w-0"><h2 className="text-lg font-bold leading-6">{ROUTES.find((r) => r.key === activeSection)?.title}</h2><p className="mt-1 text-sm text-muted-foreground">{ROUTES.find((r) => r.key === activeSection)?.next}</p><div className="mt-2 flex flex-wrap gap-2"><Badge variant="secondary">{grouped[activeSection].length} total</Badge><Badge variant="outline">{grouped[activeSection].filter((item: any) => ["pending","packed"].includes(String(item.status))).length} awaiting dispatch</Badge></div></div></div><Button onClick={() => processSection(activeSection)} disabled={isLoading || grouped[activeSection].length === 0} className="shrink-0"><Send className="mr-2 h-4 w-4"/>{activeSection === "route_review" || activeSection === "needs_location" ? "Review orders" : activeSection === "farmer_fulfillment_transfer" ? "Open transfer workflow" : activeSection === "multi_warehouse" ? "Open consolidation" : "Process all orders"}<ArrowRight className="ml-2 h-4 w-4"/></Button></div>

    {isLoading ? <div className="grid gap-3 lg:grid-cols-2">{[1,2,3,4].map((n) => <div key={n} className="h-56 animate-pulse rounded-xl bg-muted"/>)}</div> : grouped[activeSection].length === 0 ? <Card className="rounded-xl border-dashed"><CardContent className="p-10 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"><MapPin className="h-7 w-7 text-muted-foreground"/></div><h3 className="mt-4 font-semibold">No shipments in this section</h3><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Orders appear here when they match this route. If an order is missing, check its packing status, delivery address, coordinates and route classification.</p><Button variant="outline" className="mt-4" onClick={() => refetch()} disabled={isFetching}><RefreshCw className="mr-2 h-4 w-4"/>Refresh shipments</Button></CardContent></Card> : <div className="grid items-start gap-4 xl:grid-cols-2">{grouped[activeSection].map((item: any) => <Card key={item.id} className="min-w-0 overflow-hidden rounded-xl border-border/80 shadow-sm transition-shadow hover:shadow-md"><CardContent className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer order</p><h3 className="mt-1 break-all text-base font-bold leading-6">{item.orderNumber || item.orderId || "Dispatch order"}</h3></div><div className="flex flex-wrap gap-2"><Badge className={item.status === "dispatched" ? "bg-emerald-100 text-emerald-800" : item.status === "packed" ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"}>{statusLabel(item.status)}</Badge></div></div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5"><PackageCheck className="h-4 w-4 shrink-0 text-primary"/><span className="min-w-0 break-words text-sm font-medium">{item.productName || item.productId || "Order package"}</span><span className="ml-auto shrink-0 text-sm text-muted-foreground">{item.quantity ?? 0} units</span></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3"><p className="text-xs font-medium text-muted-foreground">Routing distance</p><p className="mt-1 text-lg font-semibold">{item.routeDistanceKm == null ? "Not calculated" : Number(item.routeDistanceKm).toFixed(1) + " km"}</p><p className="mt-1 text-xs text-muted-foreground">Threshold: {item.nearbyThresholdKm ?? 15} km</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs font-medium text-muted-foreground">Dispatch status</p><p className="mt-1 text-sm font-semibold">{statusLabel(item.status)}</p><p className="mt-1 text-xs text-muted-foreground">{item.dispatchDate ? new Date(item.dispatchDate).toLocaleString() : "Not dispatched yet"}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs font-medium text-muted-foreground">Source district</p><p className="mt-1 break-words text-sm font-medium">{item.sourceDistrict || "Missing"}</p></div>
        <div className="rounded-lg border p-3"><p className="text-xs font-medium text-muted-foreground">Customer delivery district</p><p className="mt-1 break-words text-sm font-medium">{item.destinationDistrict || "Missing"}</p></div>
      </div>
      {item.deliveryPartnerId && <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Delivery partner</p><p className="mt-1 break-words text-sm font-medium">{item.deliveryPartnerId}</p></div>}
      {!routeReady(item) && <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-5 text-amber-950"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0"/><span>{item.routeDecisionReason || "Route data is incomplete. Add valid source/customer coordinates and district data before dispatch."} Dispatch is blocked.</span></div>}
      <div className="border-t pt-3"><div className="flex min-w-0 flex-col gap-2">
        {activeSection === "nearby" && ["pending","packed"].includes(String(item.status)) && <Button className="w-full" disabled={!routeReady(item)} onClick={() => processDispatch(item)}><Send className="mr-2 h-4 w-4"/>Verify & Dispatch to Partner</Button>}
        {activeSection === "same_district" && (() => {
          const destination = item?.deliveryAddress || item?.shippingAddress || item?.customerAddress || item?.destinationAddress || {};
          const selectedHub = chooseLocalHub(item, localHubs);
          const hubStatus = (hub: any) => {
            const value = normalizePlace(hub?.verificationStatus || hub?.approvalStatus || hub?.status);
            if (hub?.isActive === false || hub?.active === false || ["inactive", "disabled"].includes(value)) return "Inactive";
            if (hub?.isVerified === false || hub?.verified === false || ["pending", "pending_verification", "unverified"].includes(value)) return "Awaiting verification";
            if (value === "rejected") return "Rejected";
            return "Verified & active";
          };
          const hubAddress = (hub: any) => [hub?.addressLine1, hub?.addressLine2, hub?.locality, hub?.taluk || hub?.talukName, hub?.district || hub?.districtName, hub?.pincode || hub?.postalCode].filter(Boolean).join(", ") || (typeof hub?.address === "string" ? hub.address : [hub?.address?.locality, hub?.address?.taluk, hub?.address?.district, hub?.address?.pincode].filter(Boolean).join(", ")) || "Address not provided";
          return <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div><p className="font-semibold">Local hub transfer details</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The system matches the customer delivery taluk and district to an eligible verified hub. The hub manager confirms physical receipt before final-mile delivery.</p></div>
            <div className="rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected destination hub</p>{selectedHub ? <Badge className="bg-emerald-100 text-emerald-800">Verified & active</Badge> : <Badge variant="destructive">No matching hub</Badge>}</div>
              {selectedHub ? <div className="mt-2 space-y-2"><p className="break-words text-base font-semibold">{selectedHub.name || "Local hub"}</p><p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0"/>{hubAddress(selectedHub)}</p><div className="grid grid-cols-2 gap-2"><div className="rounded-md bg-muted/60 p-2"><p className="text-[11px] text-muted-foreground">Taluk</p><p className="mt-1 break-words text-sm font-medium">{selectedHub.taluk || selectedHub.talukName || selectedHub.subDistrict || selectedHub.address?.taluk || "Not provided"}</p></div><div className="rounded-md bg-muted/60 p-2"><p className="text-[11px] text-muted-foreground">District</p><p className="mt-1 break-words text-sm font-medium">{selectedHub.district || selectedHub.districtName || selectedHub.address?.district || "Not provided"}</p></div></div><p className="text-xs text-muted-foreground">Hub ID: <span className="break-all font-mono">{selectedHub.id}</span></p></div> : <p className="mt-2 text-xs leading-5 text-amber-800">No verified active hub matches the customer address yet. Check hub verification, taluk/district and address details.</p>}
            </div>
            <div className="rounded-lg border bg-background p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer delivery destination</p><p className="mt-2 break-words text-sm font-medium">{[destination?.addressLine1, destination?.addressLine2, destination?.locality, destination?.village, destination?.taluk || destination?.talukName, destination?.district || destination?.districtName, destination?.state, destination?.pincode || destination?.postalCode].filter(Boolean).join(", ") || (typeof destination === "string" ? destination : "Delivery address details unavailable")}</p><p className="mt-1 text-xs text-muted-foreground">District: {item.destinationDistrict || destination?.district || destination?.districtName || "Not provided"}</p></div>
            <div className="rounded-lg border bg-background p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Eligible local hubs</p>{hubsQuery.isLoading ? <p className="mt-2 text-xs text-muted-foreground">Loading local hubs…</p> : localHubs.length ? <div className="mt-2 space-y-2">{localHubs.map((hub: any) => <div key={hub.id} className="flex min-w-0 items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"><div className="min-w-0"><p className="break-words text-sm font-medium">{hub.name || "Local hub"}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{[hub.taluk || hub.talukName || hub.subDistrict, hub.district || hub.districtName, hub.pincode || hub.postalCode].filter(Boolean).join(", ") || "Location details incomplete"}</p></div><Badge variant={hubStatus(hub) === "Verified & active" ? "secondary" : "outline"}>{hubStatus(hub)}</Badge></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">No local hubs were returned by the local-hub service.</p>}</div>
            <Button className="w-full" disabled={!routeReady(item) || !["pending","packed"].includes(String(item.status)) || hubsQuery.isLoading || !selectedHub} onClick={() => processDispatch(item)}><Send className="mr-2 h-4 w-4"/>Assign hub & dispatch</Button>
          </div>;
        })()}
        {activeSection === "inter_district" && String(item.status || "").toLowerCase() !== "dispatched" && <div className="rounded-lg border bg-muted/20 p-3"><p className="font-semibold">Destination warehouse transfer</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Process the destination warehouse and transfer-team handoff, then confirm receipt.</p><Button className="mt-3 w-full" variant="outline" disabled={!routeReady(item) || !["pending","packed"].includes(String(item.status || "").toLowerCase())} onClick={() => processDispatch(item)}><Warehouse className="mr-2 h-4 w-4"/>Process destination transfer</Button></div>}
        {activeSection === "multi_warehouse" && <div className="rounded-lg border bg-muted/20 p-3"><p className="font-semibold">Consolidation required</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Receive all source portions before the local-hub handoff.</p><Button className="mt-3 w-full" variant="outline" onClick={() => { window.location.href = "/warehouse/consolidation"; }}><Warehouse className="mr-2 h-4 w-4"/>Open consolidation</Button></div>}
        {activeSection === "farmer_fulfillment_transfer" && <Button className="w-full" variant="outline" onClick={() => { window.location.href = "/farmer-fulfillment"; }}>Open Farmer Fulfillment Transfers</Button>}
        {item.status === "dispatched" && <Badge className="w-fit bg-emerald-100 text-emerald-800"><Truck className="mr-1 h-3 w-3"/>Dispatched</Badge>}
      </div></div>
    </CardContent></Card>)}</div>}
  </div>;
}
