"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  MapPin,
  Package,
  RefreshCw,
  Route,
  Truck,
  UserRound,
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

const NEXT: Record<string, string | undefined> = {
  team_assigned: "en_route",
  en_route: "arrived_at_farm",
  arrived_at_farm: "collected",
  collected: "departed_farm",
  departed_farm: "arrived_warehouse",
};

const label = (value: string) => STATUS.find(([key]) => key === value)?.[1] || value.replace(/_/g, " ");

export default function WarehouseCollectionsPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { data: warehouseData } = useQuery({
    queryKey: ["warehouseCollectionsIdentity"],
    queryFn: () => api.get("/warehouse/me"),
    staleTime: 60000,
  });
  const warehouseName = warehouseData?.name || "Warehouse";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseCollectionsPage"],
    queryFn: () => api.get("/warehouse/me/collections", { params: { status: "all" } }),
    refetchInterval: 15000,
  });

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
      ready: source.filter((x: any) => x.status === "ready_for_pickup").length,
      waiting: source.filter((x: any) => x.status === "scheduled").length,
      active: source.filter((x: any) => !["ready_for_pickup", "arrived_warehouse"].includes(x.status)).length,
      warehouse: source.filter((x: any) => x.status === "arrived_warehouse").length,
    };
  }, [data]);

  const advance = async (job: any) => {
    const next = NEXT[job.status];
    if (!next) return;
    try {
      await api.put(`/warehouse/me/collections/${job.id}/status`, undefined, { params: { status: next } });
      toast.success(label(next));
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update collection");
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
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50">One queue for every farm pickup. Bulk harvest goes into warehouse fulfillment; already-packed long-distance orders pass through the warehouse without repacking.</p>
          </div>
          <Button variant="secondary" size="icon" onClick={() => refetch()} aria-label="Refresh collection queue"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Total Jobs", counts.total, Package],
          ["Ready for Pickup", counts.ready, Clock3],
          ["Active Collection", counts.active, Truck],
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
                        <Badge className={isPackedTransfer ? "bg-blue-600 text-white" : "bg-emerald-600 text-white"}>{isPackedTransfer ? "Packed Order Transfer" : "Bulk Harvest Pickup"}</Badge>
                        <Badge variant="outline">{label(job.status)}</Badge>
                      </div>
                      <CardTitle className="mt-2 text-base">{job.productName || job.productId || "Farm Product"}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">Farmer: {job.farmerName || job.farmerId || "—"} {job.orderId ? <>· Order #{String(job.orderId).slice(-8)}</> : ""}</p>
                      {job.batchId && <p className="mt-1 text-xs text-muted-foreground">Batch: {String(job.batchId).slice(-12)}</p>}
                    </div>
                    <div className="rounded-xl border bg-white px-4 py-3 text-right"><p className="text-xs text-muted-foreground">Quantity</p><p className="text-lg font-bold">{job.quantity || 0} kg</p><p className="text-xs text-muted-foreground">{job.packageCount || 1} package(s)</p></div>
                  </div>
                </CardHeader>
                <CardContent className="p-5">
                  <div className="mb-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Pickup</p><p className="mt-1 flex items-center gap-1 text-sm font-medium"><MapPin className="h-3.5 w-3.5 text-emerald-600" /> Farm location</p></div>
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Collection Team</p><p className="mt-1 flex items-center gap-1 text-sm font-medium"><UserRound className="h-3.5 w-3.5 text-emerald-600" /> {job.collectionTeamId || "Not assigned"}</p></div>
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
                      {job.status === "ready_for_pickup" && <Button onClick={() => window.location.href="/warehouse/pickup-routes"}><Route className="mr-2 h-4 w-4" />Plan Pickup Routes</Button>}
                      {NEXT[job.status] && <Button variant={job.status === "arrived_at_farm" ? "default" : "outline"} onClick={() => advance(job)}>{isPackedTransfer && job.status === "arrived_at_farm" ? "Receive Transfer" : label(NEXT[job.status] || "")}<ArrowRight className="ml-2 h-4 w-4" /></Button>}
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
