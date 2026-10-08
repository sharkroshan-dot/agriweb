"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Package,
  PackageCheck,
  RefreshCw,
  Truck,
  Warehouse,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";

type ActionCardProps = {
  title: string;
  description: string;
  count: number;
  action: string;
  href: string;
  icon: any;
  tone?: "blue" | "amber" | "green" | "indigo" | "red";
};

const tones = {
  blue: "border-blue-100 bg-blue-50/60 text-blue-700",
  amber: "border-amber-100 bg-amber-50/60 text-amber-700",
  green: "border-emerald-100 bg-emerald-50/60 text-emerald-700",
  indigo: "border-indigo-100 bg-indigo-50/60 text-indigo-700",
  red: "border-red-100 bg-red-50/60 text-red-700",
};

function ActionCard({ title, description, count, action, href, icon: Icon, tone = "blue" }: ActionCardProps) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${tones[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
          <Badge variant={count > 0 ? "default" : "secondary"}>{count}</Badge>
        </div>
        <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 min-h-10 text-sm leading-5 text-slate-500">{description}</p>
        <Button asChild size="sm" className="mt-4 w-full" variant={count > 0 ? "default" : "outline"}>
          <Link href={href}>
            {action}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const workflowSteps = [
  { n: "1", title: "Farm Collection", text: "Collect bulk farmer stock for normal warehouse fulfillment.", href: "/collections", icon: Truck },
  { n: "2", title: "Receiving", text: "Verify incoming stock quantity and quality before storage.", href: "/incoming", icon: ArrowDown },
  { n: "3", title: "Inventory", text: "Store stock and keep physical, reserved and available quantities accurate.", href: "/stock", icon: Package },
  { n: "4", title: "Customer Orders", text: "Allocate warehouse stock to customer orders.", href: "/warehouse/orders", icon: ClipboardCheck },
  { n: "5", title: "Packing", text: "Pack only normal Warehouse Fulfillment customer orders.", href: "/packing", icon: PackageCheck },
  { n: "6", title: "Dispatch", text: "Choose Nearby or Long Distance and dispatch the complete order.", href: "/outgoing", icon: ArrowUp },
];

export default function WarehouseWorkflowPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseWorkflow"],
    queryFn: () => api.get("/warehouse/me/workflow"),
    refetchInterval: 15000,
  });

  const payload = data?.data || {};
  const counts = payload.counts || {};
  const stages = payload.stages || {};
  const warehouse = payload.warehouse || {};

  const activeNormalOrders = Number(counts.orders || 0);
  const collections = Number(counts.collections || 0);
  const incoming = Number(counts.incoming || 0);
  const packing = Number(counts.packing || 0);
  const outgoing = Number(counts.outgoing || 0);
  const shortages = Number(counts.shortages || 0);
  const capacity = Number(warehouse.totalCapacity || 0) > 0
    ? Math.round((Number(warehouse.usedCapacity || 0) / Number(warehouse.totalCapacity || 0)) * 100)
    : null;

  return (
    <div className="space-y-7">
      <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-6 text-white shadow-sm sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
              <Warehouse className="h-4 w-4" />
              Warehouse Control Center
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Today’s Work</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Complete the next available warehouse task. Normal Warehouse Fulfillment and Farmer Fulfillment Transfers are kept separate.
            </p>
          </div>
          <Button variant="secondary" size="icon" onClick={() => refetch()} aria-label="Refresh workflow">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Normal Orders", activeNormalOrders],
            ["Farm Collections", collections],
            ["Receiving", incoming],
            ["Packing", packing],
            ["Dispatch", outgoing],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className="mt-1 text-2xl font-bold">{isLoading ? "—" : value}</p>
            </div>
          ))}
        </div>
      </section>

      {shortages > 0 && (
        <Card className="border-red-200 bg-red-50/70">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div>
                <p className="font-semibold text-red-900">{shortages} shortage case{shortages === 1 ? "" : "s"} need attention</p>
                <p className="mt-1 text-sm text-red-800">Resolve the shortage before the affected order can complete dispatch.</p>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link href="/packing">Open shortage workflow</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-slate-900">Next Actions</h2>
          <p className="mt-1 text-sm text-slate-500">Open the queue that currently needs warehouse action.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ActionCard title="Farm Collections" description="Collect bulk stock from farmers and bring it into the warehouse." count={collections} action="Open collections" href="/collections" icon={Truck} tone="blue" />
          <ActionCard title="Receiving" description="Verify quantity and quality. Do not store unverified stock." count={incoming} action="Open receiving" href="/incoming" icon={ArrowDown} tone="amber" />
          <ActionCard title="Order Packing" description="Pack customer orders created from Warehouse Fulfillment inventory." count={packing} action="Open packing" href="/packing" icon={PackageCheck} tone="green" />
          <ActionCard title="Outgoing / Dispatch" description="Select the delivery route only after the complete order is verified." count={outgoing} action="Open dispatch" href="/outgoing" icon={ArrowUp} tone="indigo" />
        </div>
      </section>

      <section>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-emerald-600" />
              Normal Warehouse Fulfillment
            </CardTitle>
            <p className="text-sm text-slate-500">This is the standard process where the warehouse receives bulk stock and packs the customer order.</p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 lg:grid-cols-6">
              {workflowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.n} className="relative">
                    <Link href={step.href} className="block h-full rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-300 hover:shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">{step.n}</span>
                        <Icon className="h-4 w-4 text-slate-400" />
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-900">{step.title}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{step.text}</p>
                    </Link>
                    {index < workflowSteps.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-slate-300 xl:block" />}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="border-indigo-100 bg-indigo-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-indigo-950"><Boxes className="h-5 w-5 text-indigo-600" />Farmer Fulfillment Transfer</CardTitle>
            <p className="text-sm text-indigo-900/70">Already-packed farmer orders. Warehouse receives, verifies, stores and transfers — never repacks.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl bg-white p-4 text-sm shadow-sm">
              <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                <span>Farmer Packed</span><ArrowRight className="h-4 w-4 text-slate-300" /><span>Warehouse Receive</span><ArrowRight className="h-4 w-4 text-slate-300" /><span>Verify</span><ArrowRight className="h-4 w-4 text-slate-300" /><span>Store</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">Single warehouse: continue to Local Hub. Multiple warehouses: continue to Consolidation.</p>
            </div>
            <Button asChild className="w-full"><Link href="/warehouse/farmer-fulfillment">Open Farmer Fulfillment Transfers <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>

        <Card className="border-violet-100 bg-violet-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-violet-950"><Boxes className="h-5 w-5 text-violet-600" />Multi-Warehouse Consolidation</CardTitle>
            <p className="text-sm text-violet-900/70">Each warehouse can dispatch its stored portion independently. Final delivery opens only after the complete order is consolidated.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              {["Warehouse A", "Warehouse B", "Warehouse C"].map((name) => (
                <div key={name} className="rounded-lg bg-white p-3 text-center text-xs font-medium text-slate-700 shadow-sm">{name}<div className="mt-1 text-slate-400">Receive → Store → Dispatch</div></div>
              ))}
            </div>
            <Button asChild variant="outline" className="w-full"><Link href="/warehouse/consolidation">Open Consolidation <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      </section>

      <Card className="border-slate-200">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold text-slate-900">Warehouse capacity</p>
            <p className="mt-1 text-sm text-slate-500">Calculated from actual warehouse capacity and used capacity records.</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-2xl font-bold text-slate-900">{capacity === null ? "—" : `${capacity}%`}</p>
            <p className="text-xs text-slate-500">{Number(warehouse.usedCapacity || 0).toLocaleString()} / {Number(warehouse.totalCapacity || 0).toLocaleString()} used</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-100 bg-emerald-50/50">
        <CardContent className="flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold text-emerald-950">One rule for every action</p>
            <p className="mt-1 text-sm leading-6 text-emerald-900/80">
              When you complete an action, the backend updates the order or shipment state and the next responsible warehouse/team sees it in their queue. You should not manually move the same order between pages.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Refresh all queues</Button>
      </div>
    </div>
  );
}
