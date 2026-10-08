"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ClipboardList, Package, RefreshCw, Warehouse, AlertTriangle, Truck, Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { api } from "../../../lib/api/client";

const steps = [
  ["Farm Collection", "/collections", "Farmer → Warehouse"],
  ["Receiving", "/incoming", "Verify quantity + quality"],
  ["Inventory", "/stock", "Store verified stock"],
  ["Customer Orders", "/warehouse/orders", "Allocate stock"],
  ["Packing", "/packing", "Pack customer orders"],
  ["Dispatch", "/outgoing", "Choose route and dispatch"],
  ["Farmer Transfers", "/warehouse/farmer-fulfillment", "Receive packed farmer orders"],
  ["Consolidation", "/warehouse/consolidation", "Combine multi-warehouse portions"],
] as const;

export default function WarehouseWorkflowPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseWorkflow"],
    queryFn: () => api.get("/warehouse/me/workflow"),
    refetchInterval: 15000,
  });

  const payload = data?.data || {};
  const counts = payload.counts || {};
  const warehouse = payload.warehouse || {};
  const shortages = Number(counts.shortages || 0);
  const capacity = Number(warehouse.totalCapacity || 0) > 0
    ? Math.round((Number(warehouse.usedCapacity || 0) / Number(warehouse.totalCapacity || 0)) * 100)
    : null;

  return (
    <div className="space-y-7">
      <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-emerald-300"><Warehouse className="h-4 w-4" />{warehouse.name || "Warehouse"}</div>
            <h1 className="mt-2 text-3xl font-bold">Warehouse Control Center</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Complete the next warehouse task from one place. Normal Warehouse Fulfillment and Farmer Fulfillment Transfers are always separated.</p>
          </div>
          <Button variant="secondary" size="icon" onClick={() => refetch()}><RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Customer Orders", counts.orders, ClipboardList],
            ["Farm Collections", counts.collections, Truck],
            ["Receiving", counts.incoming, ArrowRight],
            ["Packing", counts.packing, Package],
            ["Open Shortages", counts.shortages, AlertTriangle],
          ].map(([label, value, Icon]: any) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-bold">{isLoading ? "—" : Number(value || 0)}</p>
            </div>
          ))}
        </div>
      </section>

      {shortages > 0 && (
        <Card className="border-red-200 bg-red-50/70">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div><p className="font-semibold text-red-900">{shortages} shortage case{shortages === 1 ? "" : "s"} need attention</p><p className="mt-1 text-sm text-red-800">Resolve shortages before dispatch.</p></div>
            </div>
            <Button asChild variant="outline"><Link href="/packing">Open shortage workflow</Link></Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Normal Warehouse Fulfillment</CardTitle><p className="text-sm text-slate-500">Bulk farmer stock is received, stored, allocated and then packed for each customer order.</p></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {steps.slice(0, 6).map(([title, href, description], index) => (
              <Link key={title} href={href} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-300 hover:shadow-sm">
                <div className="flex items-center justify-between"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">{index + 1}</span><ArrowRight className="h-4 w-4 text-slate-400" /></div>
                <p className="mt-3 font-semibold text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-indigo-100 bg-indigo-50/40">
          <CardHeader><CardTitle>Farmer Fulfillment Transfer</CardTitle><p className="text-sm text-indigo-900/70">These shipments are already packed by the farmer. Warehouse only receives, verifies, stores and transfers them.</p></CardHeader>
          <CardContent><Button asChild className="w-full"><Link href="/warehouse/farmer-fulfillment">Open Farmer Fulfillment Transfers<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardContent>
        </Card>
        <Card className="border-violet-100 bg-violet-50/40">
          <CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="h-5 w-5 text-violet-600" />Multi-Warehouse Consolidation</CardTitle><p className="text-sm text-violet-900/70">Each warehouse dispatches its stored portion independently. One complete order is then sent to the local hub.</p></CardHeader>
          <CardContent><Button asChild variant="outline" className="w-full"><Link href="/warehouse/consolidation">Open Consolidation<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold">Warehouse capacity</p><p className="text-sm text-slate-500">Calculated from actual used and total capacity records.</p></div>
          <div className="text-left sm:text-right"><p className="text-2xl font-bold">{capacity === null ? "—" : capacity + "%"}</p><p className="text-xs text-slate-500">{Number(warehouse.usedCapacity || 0).toLocaleString()} / {Number(warehouse.totalCapacity || 0).toLocaleString()} used</p></div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Completing an action updates the next responsible queue automatically.</div>
    </div>
  );
}
