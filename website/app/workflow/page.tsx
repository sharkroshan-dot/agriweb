"use client";

import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ClipboardList, Package, RefreshCw, Warehouse, AlertTriangle, Truck, Boxes } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { api } from "../lib/api/client";
import toast from "react-hot-toast";

const STAGES: Record<string,string> = {
  awaiting_farmer_confirmation: "Waiting for Farmer",
  collection_team_assigned: "Collection Team Assigned",
  collection_en_route: "Collection En Route",
  collection_arrived: "At Farm",
  collected: "Collected",
  collection_departed: "In Transit",
  warehouse_arrived: "At Warehouse",
  received: "Received",
  received_transfer: "Received Transfer",
  stored: "Stored in Inventory",
  ready_for_packing: "Ready for Packing",
  packing_team_assigned: "Packing Team Assigned",
  packing: "Packing",
  shortage_pending: "Shortage Resolution",
  packed: "Packed",
  ready_for_dispatch: "Ready for Dispatch",
  delivery_decision: "Delivery Decision",
  dispatched: "Dispatched",
};

const ORDER_FLOW = [
  ["Farm Collection","/collections","Farmer → Warehouse"],
  ["Receiving","/incoming","Verify quantity + quality"],
  ["Inventory","/stock","Stored stock"],
  ["Customer Orders","/warehouse/orders","Allocate to order"],
  ["Packing","/packing","Pack separately"],
  ["Dispatch","/outgoing","Delivery decision + dispatch"],
  ["Consolidation","/warehouse/consolidation","Multi-farm event readiness"],
];

export default function WarehouseWorkflowPage() {
  const workflow = useQuery({
    queryKey: ["warehouseWorkflow"],
    queryFn: () => api.get("/warehouse/me/workflow"),
    refetchInterval: 15000,
  });
  const orders = useQuery({
    queryKey: ["warehouseCustomerOrders"],
    queryFn: () => api.get("/warehouse/me/customer-orders"),
    refetchInterval: 15000,
  });
  const allocate = useMutation({
    mutationFn: (id: string) => api.post("/warehouse/me/customer-orders/" + id + "/allocate"),
    onSuccess: () => {
      toast.success("Order allocated to warehouse packing");
      void orders.refetch();
      void workflow.refetch();
    },
    onError: (e: any) => toast.error(e?.message || "Allocation failed"),
  });

  const data = workflow.data?.data || {};
  const orderRows = orders.data?.data?.orders || [];
  const activeOrders = useMemo(() => orderRows.filter((o:any) => !["dispatched","delivered","completed","cancelled","refunded"].includes(String(o.warehouseFulfillmentStage))), [orderRows]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-700 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-emerald-100"><Warehouse className="h-4 w-4"/>{data.warehouse?.name || "Warehouse"}</div>
            <h1 className="mt-1 text-3xl font-bold">Warehouse Fulfillment Workflow</h1>
            <p className="mt-2 max-w-3xl text-sm text-emerald-50">Collection → Receiving → Quality → Inventory → Allocation → Picking → Packing → Shortage Resolution → Verification → Dispatch → Delivery.</p>
          </div>
          <Button variant="secondary" size="icon" onClick={() => { void workflow.refetch(); void orders.refetch(); }}><RefreshCw className="h-4 w-4"/></Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Customer Orders",data.counts?.orders,ClipboardList],
          ["Collections",data.counts?.collections,Truck],
          ["Incoming",data.counts?.incoming,ArrowRight],
          ["Packing",data.counts?.packing,Package],
          ["Open Shortages",data.counts?.shortages,AlertTriangle],
        ].map(([label,value,Icon]:any)=><Card key={label}><CardContent className="flex items-center gap-3 p-4"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Icon className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{Number(value||0)}</p></div></CardContent></Card>)}
      </div>

      <Card>
        <CardHeader><CardTitle>Connected Warehouse Process</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {ORDER_FLOW.map(([name,href,desc],i)=><Button key={name} asChild variant="outline" className="h-auto justify-start p-4 text-left">
              <a href={href}><div className="flex w-full items-start gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i+1}</div><div><div className="font-semibold">{name}</div><div className="mt-1 text-xs font-normal text-muted-foreground">{desc}</div></div><ArrowRight className="ml-auto mt-1 h-4 w-4"/></div></a>
            </Button>)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Warehouse Customer Orders</CardTitle></CardHeader>
        <CardContent>
          {orders.isLoading ? <div className="h-24 animate-pulse rounded-lg bg-muted"/> : activeOrders.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No active warehouse-fulfilled customer orders.</div> :
            <div className="space-y-3">{activeOrders.map((order:any)=>{
              const stage=String(order.warehouseFulfillmentStage||"awaiting_farmer_confirmation");
              const canAllocate=["stored","received","received_transfer","warehouse_arrived"].includes(stage);
              return <div key={order.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">#{order.orderNumber}</h3><Badge variant="outline">{STAGES[stage]||stage.replace(/_/g," ")}</Badge>{order.shortageResolutionRequired&&<Badge variant="destructive">Shortage Action</Badge>}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{order.customer?.name||"Customer"} · {order.items?.map((i:any)=>String(i.productName) + " × " + String(i.quantity) + " " + String(i.unit || "kg")).join(" · ")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{order.deliveryAddress?.city||""} {order.deliveryAddress?.state||""}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canAllocate&&<Button size="sm" onClick={()=>allocate.mutate(order.id)} disabled={allocate.isPending}><Boxes className="mr-2 h-4 w-4"/>{allocate.isPending?"Allocating...":"Allocate Stock"}</Button>}
                    {["ready_for_packing","packing","shortage_pending"].includes(stage)&&<Button size="sm" variant="outline" asChild><a href="/packing">Open Packing</a></Button>}
                    {["ready_for_dispatch","delivery_decision"].includes(stage)&&<Button size="sm" variant="outline" asChild><a href="/outgoing">Open Dispatch</a></Button>}
                    {stage==="dispatched"&&<Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Dispatched</Badge>}
                  </div>
                </div>
              </div>
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
