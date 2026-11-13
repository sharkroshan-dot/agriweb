"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, CalendarDays, CheckCircle2, ClipboardList, Clock3, HelpCircle,
  MapPin, Package, PlusCircle, ShieldCheck, Truck, Warehouse, Weight,
  ArrowRight, Info, Headphones, RefreshCw, Route,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Badge } from "../../../components/ui/badge";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const statusTone = (value: string) => {
  const status = String(value || "").toLowerCase().replace(/[ -]+/g, "_");
  if (["completed", "received", "warehouse_received", "returned_to_warehouse", "stored"].includes(status)) return "success";
  if (["pending", "offered", "pending_approval"].includes(status)) return "warning";
  if (["assigned", "accepted", "started", "in_progress"].includes(status)) return "info";
  if (["rejected", "cancelled", "failed"].includes(status)) return "destructive";
  return "secondary";
};

const statusLabel = (value: string) =>
  String(value || "Status unavailable").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const dateLabel = (value: any) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
};

const firstValue = (...values: any[]) => values.find((value) => value !== undefined && value !== null && value !== "");

export default function PickupTeamApplicationPage() {
  const q = useQuery({ queryKey: ["myPickupTeam"], queryFn: () => api.get("/delivery/me/pickup-team") });
  const w = useQuery({ queryKey: ["pickupWarehouses"], queryFn: () => api.get("/delivery/me/pickup-team/warehouses") });
  const offersQ = useQuery({ queryKey: ["myPickupOffers"], queryFn: () => api.get("/delivery/me/pickup-offers"), refetchInterval: 15000 });
  const routesQ = useQuery({ queryKey: ["myPickupRoutes"], queryFn: () => api.get("/delivery/me/pickup-routes"), refetchInterval: 15000 });
  const jobsQ = useQuery({ queryKey: ["warehousePickupJobs"], queryFn: () => api.get("/delivery/me/pickup-jobs"), refetchInterval: 15000 });

  const [form, setForm] = useState<any>({ warehouseId: "", vehicleType: "van", vehicleNumber: "", vehicleModel: "", capacity: "", fuelType: "diesel", notes: "" });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showApplicationForm, setShowApplicationForm] = useState(false);

  const update = (key: string, value: string) => {
    setForm((current: any) => ({ ...current, [key]: value }));
    setFormErrors((current) => ({ ...current, [key]: "" }));
  };

  const warehouses = w.data?.warehouses || w.data?.data?.warehouses || [];
  const memberships = q.data?.memberships || q.data?.data?.memberships || [];
  const applications = q.data?.applications || q.data?.data?.applications || [];
  const openJobs = jobsQ.data?.data?.openJobs || [];
  const acceptedJobs = jobsQ.data?.data?.acceptedJobs || [];
  const offers = offersQ.data?.data?.routes || [];
  const routes = routesQ.data?.data?.routes || [];

  const assignments = useMemo(() => {
    const all = [...openJobs, ...acceptedJobs, ...offers, ...routes];
    const seen = new Set<string>();
    return all.filter((item: any, index: number) => {
      const key = String(item?.id || item?._id || item?.routeId || item?.jobId || item?.routeNumber || item?.orderNumber || "row-" + index);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [openJobs, acceptedJobs, offers, routes]);

  const pendingApplications = applications.filter((item: any) => ["pending", "submitted", "under_review"].includes(String(item.status || "").toLowerCase())).length;
  const approvedWarehouses = memberships.filter((item: any) => ["approved", "active"].includes(String(item.status || "approved").toLowerCase())).length;
  const completedPickups = routes.filter((item: any) => ["received", "warehouse_received", "received_at_warehouse", "arrived_warehouse", "returned_to_warehouse", "stored"].includes(String(item.status || item.orderStatus || item.collectionStatus || "").toLowerCase().replace(/[ -]+/g, "_"))).length;

  const submit = async () => {
    const errors: Record<string, string> = {};
    if (!String(form.warehouseId || "").trim()) errors.warehouseId = "Please choose a warehouse from the dropdown.";
    if (!String(form.vehicleNumber || "").trim()) errors.vehicleNumber = "Enter your vehicle registration number.";
    if (form.capacity !== "" && (!Number.isFinite(Number(form.capacity)) || Number(form.capacity) <= 0)) errors.capacity = "Enter a carrying capacity greater than 0 kg.";
    if (Object.keys(errors).length) { setFormErrors(errors); toast.error(Object.values(errors)[0]); return; }
    setSubmitting(true);
    try {
      await api.post("/delivery/me/pickup-team/apply", {
        warehouseId: String(form.warehouseId).trim(),
        vehicleType: String(form.vehicleType || "van").trim(),
        vehicleNumber: String(form.vehicleNumber).trim().toUpperCase(),
        vehicleModel: String(form.vehicleModel || "").trim() || undefined,
        capacity: form.capacity !== "" ? Number(form.capacity) : undefined,
        fuelType: String(form.fuelType || "").trim() || undefined,
        notes: String(form.notes || "").trim() || undefined,
      });
      toast.success("Application submitted for warehouse approval");
      setFormErrors({});
      setShowApplicationForm(false);
      await Promise.all([q.refetch(), w.refetch()]);
    } catch (error: any) {
      toast.error(error?.message || "Application failed");
    } finally {
      setSubmitting(false);
    }
  };

  const primaryMembership = memberships.find((item: any) => ["approved", "active"].includes(String(item.status || "approved").toLowerCase())) || memberships[0];
  const vehicleLabel = primaryMembership
    ? [primaryMembership.vehicleType, primaryMembership.vehicleNumber].filter(Boolean).join(" · ")
    : "Vehicle details are shown after approval";
  const assignmentStatus = (item: any) => firstValue(item.status, item.assignmentStatus, item.routeStatus, item.orderStatus, "assigned");
  const warehouseName = (item: any) => firstValue(item.warehouseName, item.destinationWarehouseName, item.warehouse?.name, item.destinationWarehouse?.name, "Warehouse details unavailable");
  const pickupArea = (item: any) => firstValue(item.pickupArea, item.areaName, item.district, item.stops?.[0]?.area, item.stops?.[0]?.pickupAddress, "Area not provided");
  const farmCount = (item: any) => firstValue(item.farmCount, item.stops?.length, item.farms?.length, item.stopCount, 0);
  const orderCount = (item: any) => firstValue(item.orderCount, item.orders?.length, item.totalOrders, item.ordersCount, 0);
  const quantity = (item: any) => firstValue(item.expectedQuantity, item.totalQuantity, item.quantity, item.totalWeight, null);
  const schedule = (item: any) => firstValue(item.scheduledAt, item.pickupDate, item.routeDate, item.scheduledDate, item.createdAt);
  const assignmentId = (item: any, index: number) => firstValue(item.assignmentNumber, item.routeNumber, item.jobNumber, item.orderNumber, item.id, item._id, "Pickup " + (index + 1));

  return (
    <div className="min-w-0 space-y-6 pb-8">
      <header className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-sky-50 px-6 py-7 shadow-sm sm:px-8">
        <div className="pointer-events-none absolute -right-8 -top-12 h-52 w-52 rounded-full border-[24px] border-emerald-100/70" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-800"><Warehouse className="h-4 w-4" /> Warehouse Pickup Workspace</div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Pickup Assignments</h1>
            <p className="mt-2 text-base leading-7 text-slate-600">Manage your warehouse partnerships and review farm pickup work assigned to you.</p>
          </div>
          <Button onClick={() => setShowApplicationForm((value) => !value)} className="bg-emerald-700 text-white hover:bg-emerald-800">
            <PlusCircle className="mr-2 h-4 w-4" /> Apply for Partnership
          </Button>
        </div>
      </header>

      <section aria-label="Pickup assignment summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-emerald-200 bg-emerald-50/60 shadow-sm"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-semibold text-emerald-900">Assigned Pickups</p><p className="mt-2 text-3xl font-bold tabular-nums text-slate-950">{jobsQ.isLoading || routesQ.isLoading ? "—" : acceptedJobs.length + routes.length}</p><p className="mt-1 text-sm text-slate-600">Jobs assigned to you</p></div><div className="rounded-xl bg-white p-3 text-emerald-700"><Package className="h-6 w-6" /></div></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/60 shadow-sm"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-semibold text-amber-900">Pending Approval</p><p className="mt-2 text-3xl font-bold tabular-nums text-slate-950">{q.isLoading ? "—" : pendingApplications}</p><p className="mt-1 text-sm text-slate-600">Partnership applications</p></div><div className="rounded-xl bg-white p-3 text-amber-700"><Clock3 className="h-6 w-6" /></div></CardContent></Card>
        <Card className="border-blue-200 bg-blue-50/60 shadow-sm"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-semibold text-blue-900">Approved Warehouses</p><p className="mt-2 text-3xl font-bold tabular-nums text-slate-950">{q.isLoading ? "—" : approvedWarehouses}</p><p className="mt-1 text-sm text-slate-600">Active partnerships</p></div><div className="rounded-xl bg-white p-3 text-blue-700"><Building2 className="h-6 w-6" /></div></CardContent></Card>
        <Card className="border-violet-200 bg-violet-50/60 shadow-sm"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-semibold text-violet-900">Completed Pickups</p><p className="mt-2 text-3xl font-bold tabular-nums text-slate-950">{routesQ.isLoading ? "—" : completedPickups}</p><p className="mt-1 text-sm text-slate-600">Warehouse handovers recorded</p></div><div className="rounded-xl bg-white p-3 text-violet-700"><CheckCircle2 className="h-6 w-6" /></div></CardContent></Card>
      </section>

      {showApplicationForm && (
        <Card id="partnership-application" className="border-emerald-200 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div><CardTitle className="flex items-center gap-2 text-slate-900"><PlusCircle className="h-5 w-5 text-emerald-700" /> Apply for Warehouse Partnership</CardTitle><CardDescription>Submit your vehicle details for warehouse verification and approval.</CardDescription></div>
            <Button variant="ghost" size="sm" onClick={() => setShowApplicationForm(false)}>Close</Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pickup-warehouse" className="text-sm font-semibold text-slate-700">Warehouse <span className="text-red-600">*</span></label>
              <Select id="pickup-warehouse" title="Choose the warehouse you want to work with" value={form.warehouseId} onValueChange={(value) => update("warehouseId", value)} disabled={w.isLoading || warehouses.length === 0}>
                <SelectTrigger className={formErrors.warehouseId ? "border-red-500" : ""}><SelectValue placeholder={w.isLoading ? "Loading warehouses..." : "Select warehouse"} /></SelectTrigger>
                <SelectContent>{warehouses.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.name || item.warehouseName || "Warehouse"}{item.address?.city ? " · " + item.address.city : ""}</SelectItem>)}</SelectContent>
              </Select>
              {formErrors.warehouseId && <p className="text-sm text-red-600">{formErrors.warehouseId}</p>}
              {w.isError && <p className="text-sm text-red-600">Could not load warehouses. Refresh and try again.</p>}
              {!w.isLoading && !w.isError && warehouses.length === 0 && <p className="text-sm text-amber-700">No active warehouses are currently available for applications.</p>}
            </div>
            <div className="space-y-1.5"><label htmlFor="pickup-vehicle-type" className="text-sm font-semibold text-slate-700">Vehicle type *</label><Select id="pickup-vehicle-type" value={form.vehicleType} onValueChange={(value) => update("vehicleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["bike", "car", "van", "truck", "tempo"].map((value) => <SelectItem key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><label htmlFor="pickup-vehicle-number" className="text-sm font-semibold text-slate-700">Vehicle number *</label><Input id="pickup-vehicle-number" placeholder="e.g. TN 45 AB 1234" value={form.vehicleNumber} aria-invalid={Boolean(formErrors.vehicleNumber)} onChange={(event) => update("vehicleNumber", event.target.value.toUpperCase())} />{formErrors.vehicleNumber && <p className="text-sm text-red-600">{formErrors.vehicleNumber}</p>}</div>
            <div className="space-y-1.5"><label htmlFor="pickup-vehicle-model" className="text-sm font-semibold text-slate-700">Vehicle model</label><Input id="pickup-vehicle-model" placeholder="e.g. Tata Ace Gold" value={form.vehicleModel} onChange={(event) => update("vehicleModel", event.target.value)} /></div>
            <div className="space-y-1.5"><label htmlFor="pickup-capacity" className="text-sm font-semibold text-slate-700">Carrying capacity (kg)</label><Input id="pickup-capacity" type="number" min="1" placeholder="Capacity in kilograms" value={form.capacity} aria-invalid={Boolean(formErrors.capacity)} onChange={(event) => update("capacity", event.target.value)} />{formErrors.capacity && <p className="text-sm text-red-600">{formErrors.capacity}</p>}</div>
            <div className="space-y-1.5"><label htmlFor="pickup-fuel" className="text-sm font-semibold text-slate-700">Fuel type</label><Input id="pickup-fuel" placeholder="Diesel, Petrol, CNG, Electric" value={form.fuelType} onChange={(event) => update("fuelType", event.target.value)} /></div>
            <div className="space-y-1.5 md:col-span-2"><label htmlFor="pickup-notes" className="text-sm font-semibold text-slate-700">Additional details</label><Input id="pickup-notes" placeholder="Additional details for warehouse verification" value={form.notes} onChange={(event) => update("notes", event.target.value)} /></div>
            <div className="flex flex-wrap justify-end gap-2 md:col-span-2"><Button variant="outline" onClick={() => setShowApplicationForm(false)}>Cancel</Button><Button onClick={submit} disabled={submitting || w.isLoading || warehouses.length === 0} className="bg-emerald-700 text-white hover:bg-emerald-800">{submitting ? "Submitting..." : "Submit for Warehouse Approval"}</Button></div>
          </CardContent>
        </Card>
      )}

      <section className="grid items-start gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b bg-white">
            <div><CardTitle className="flex items-center gap-2 text-lg text-slate-950"><ClipboardList className="h-5 w-5 text-emerald-700" /> Recent Pickup Assignments</CardTitle><CardDescription>Review work assigned by your approved warehouse partners.</CardDescription></div>
            <Button asChild variant="outline" size="sm"><Link href="/delivery/pickup-routes">View All Routes <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {(jobsQ.isLoading || offersQ.isLoading || routesQ.isLoading) ? <div className="space-y-3 p-5"><div className="h-14 animate-pulse rounded-lg bg-muted" /><div className="h-14 animate-pulse rounded-lg bg-muted" /></div>
              : jobsQ.isError && offersQ.isError && routesQ.isError ? <div className="p-8 text-center"><p className="font-medium text-slate-800">Pickup assignments could not be loaded.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => { jobsQ.refetch(); offersQ.refetch(); routesQ.refetch(); }}><RefreshCw className="mr-2 h-4 w-4" /> Try again</Button></div>
              : assignments.length === 0 ? <div className="p-9 text-center"><Package className="mx-auto h-9 w-9 text-slate-400" /><p className="mt-3 font-semibold text-slate-800">No pickup assignments yet</p><p className="mt-1 text-sm text-slate-600">New work from approved warehouses will appear here.</p><Button asChild variant="outline" size="sm" className="mt-4"><Link href="/delivery/pickup-routes">Open Pickup Routes</Link></Button></div>
              : <div className="divide-y divide-slate-100">
                {assignments.slice(0, 5).map((item: any, index: number) => {
                  const status = assignmentStatus(item);
                  const qty = quantity(item);
                  return <div key={String(item.id || item._id || assignmentId(item, index))} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_auto] md:items-center">
                    <div className="min-w-0"><p className="font-semibold text-slate-900">{assignmentId(item, index)}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600"><CalendarDays className="h-3.5 w-3.5 shrink-0" /> {dateLabel(schedule(item))}</p></div>
                    <div className="min-w-0"><p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Warehouse className="h-4 w-4 shrink-0 text-emerald-700" /> <span className="truncate">{warehouseName(item)}</span></p><p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{pickupArea(item)} · {farmCount(item)} farms</span></p><p className="mt-1 text-sm text-slate-600">{orderCount(item)} orders{qty !== null ? " · " + qty + " kg" : ""}</p></div>
                    <div className="flex items-center justify-between gap-3 md:justify-end"><Badge variant={statusTone(status) as any}>{statusLabel(status)}</Badge><Button asChild size="sm" className="bg-emerald-700 text-white hover:bg-emerald-800"><Link href="/delivery/pickup-routes">View Route <ArrowRight className="ml-1.5 h-4 w-4" /></Link></Button></div>
                  </div>;
                })}
              </div>}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-emerald-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3"><CardTitle className="flex items-center gap-2 text-lg text-slate-950"><ShieldCheck className="h-5 w-5 text-emerald-700" /> Warehouse Partnership</CardTitle><Badge variant={approvedWarehouses > 0 ? "success" : "secondary"}>{approvedWarehouses > 0 ? "Approved" : "No approval yet"}</Badge></CardHeader>
            <CardContent className="space-y-4">
              {q.isLoading ? <div className="h-20 animate-pulse rounded-lg bg-muted" /> : memberships.length === 0 ? <div className="rounded-xl border border-dashed p-4 text-center"><Warehouse className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-2 font-semibold text-slate-800">No approved partnerships</p><p className="mt-1 text-sm text-slate-600">Apply to a warehouse to start receiving pickup assignments.</p><Button size="sm" className="mt-3 bg-emerald-700 text-white hover:bg-emerald-800" onClick={() => setShowApplicationForm(true)}>Apply for Partnership</Button></div>
                : <div className="space-y-3">{memberships.slice(0, 2).map((membership: any, index: number) => <div key={membership.id || membership.warehouseId || index} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-2"><p className="font-semibold text-slate-900">{membership.warehouseName || membership.name || "Approved warehouse"}</p><Badge variant={statusTone(membership.status || "approved") as any}>{statusLabel(membership.status || "approved")}</Badge></div><p className="mt-1 text-sm text-slate-600">{membership.warehouseAddress || membership.address || membership.city || "Location details not available"}</p><p className="mt-2 flex items-center gap-2 text-sm text-slate-700"><Truck className="h-4 w-4 text-emerald-700" /> {[membership.vehicleType, membership.vehicleNumber].filter(Boolean).join(" · ") || "Vehicle details unavailable"}</p>{membership.capacity && <p className="mt-1 flex items-center gap-2 text-sm text-slate-700"><Weight className="h-4 w-4 text-emerald-700" /> Carrying capacity: {membership.capacity} kg</p>}</div>)}</div>}
              <div className="grid grid-cols-2 gap-2"><Button asChild variant="outline" size="sm"><Link href="#partnership-application" onClick={() => setShowApplicationForm(true)}>Apply for Partnership</Link></Button><Button variant="outline" size="sm" onClick={() => q.refetch()}>Refresh Status</Button></div>
            </CardContent>
          </Card>

          <Card className="border-sky-200 bg-sky-50/50 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-lg text-slate-950"><HelpCircle className="h-5 w-5 text-sky-700" /> Quick Info / Help</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex gap-3"><div className="rounded-lg bg-white p-2 text-emerald-700"><Info className="h-5 w-5" /></div><div><p className="font-semibold text-slate-900">What is a pickup assignment?</p><p className="mt-1 leading-5 text-slate-600">A warehouse assigns farm collection work to an approved pickup partner.</p></div></div>
              <div className="flex gap-3"><div className="rounded-lg bg-white p-2 text-emerald-700"><Route className="h-5 w-5" /></div><div><p className="font-semibold text-slate-900">What should I do?</p><p className="mt-1 leading-5 text-slate-600">Open Pickup Routes to accept and complete farm collection and warehouse handover steps.</p></div></div>
              <div className="flex gap-3"><div className="rounded-lg bg-white p-2 text-emerald-700"><Headphones className="h-5 w-5" /></div><div><p className="font-semibold text-slate-900">Need help?</p><p className="mt-1 leading-5 text-slate-600">Contact your warehouse or AgriConnect support if an assignment needs attention.</p></div></div>
              <Button asChild variant="outline" className="w-full border-sky-300 bg-white text-slate-800 hover:bg-sky-100"><Link href="/delivery/support"><Headphones className="mr-2 h-4 w-4" /> Contact Support</Link></Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {applications.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-5 w-5 text-amber-600" /> Partnership Application Status</CardTitle><CardDescription>Track applications submitted to warehouses.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">{applications.map((application: any, index: number) => <div key={application.id || application._id || index} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="font-semibold text-slate-900">{application.warehouseName || "Warehouse application"}</p><p className="mt-1 text-sm text-slate-600">{application.vehicleNumber || "Vehicle details unavailable"}</p></div><Badge variant={statusTone(application.status) as any}>{statusLabel(application.status)}</Badge></div>)}</CardContent>
        </Card>
      )}
    </div>
  );
}
