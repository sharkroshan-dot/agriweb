"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, RefreshCw, PackageCheck, Truck, AlertTriangle, MapPin } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const STAGES: Record<string,string> = {
  awaiting_farmer_confirmation:"Waiting for Farmer", collection_team_assigned:"Collection Team Assigned",
  collection_en_route:"Collection En Route", collection_arrived:"At Farm", collected:"Collected",
  collection_departed:"In Transit", warehouse_arrived:"At Warehouse", received:"Received",
  received_transfer:"Received Transfer", stored:"Stored", ready_for_packing:"Ready for Packing",
  packing_team_assigned:"Packing Team Assigned", packing:"Packing", shortage_pending:"Shortage Resolution",
  packed:"Packed", ready_for_dispatch:"Ready for Dispatch", delivery_decision:"Delivery Decision", dispatched:"Dispatched"
};

export default function WarehouseOrdersPage() {
  const [stage,setStage]=useState("");
  const {data,isLoading,refetch}=useQuery({
    queryKey:["warehouseCustomerOrders",stage],
    queryFn:()=>api.get("/warehouse/me/customer-orders",{params:{stage:stage||undefined}}),
    refetchInterval:15000,
  });
  const orders=data?.data?.orders||[];

  const allocate=async(id:string)=>{
    try{await api.post(`/warehouse/me/customer-orders/${id}/allocate`);toast.success("Stock allocated to packing");await refetch();}
    catch(e:any){toast.error(e?.message||"Allocation failed");}
  };

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-3xl font-bold">Customer Orders</h1><p className="text-muted-foreground">Warehouse-fulfilled orders only. Allocate stored stock before packing.</p></div>
      <Button variant="outline" size="icon" onClick={()=>refetch()}><RefreshCw className="h-4 w-4"/></Button>
    </div>
    <Card><CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
      <Input placeholder="Stage filter (e.g. stored, ready_for_packing)" value={stage} onChange={e=>setStage(e.target.value)}/>
      <Button variant="outline" onClick={()=>setStage("")}>All Stages</Button>
    </CardContent></Card>
    {isLoading?<div className="h-32 animate-pulse rounded-xl bg-muted"/>:orders.length===0?
      <Card className="p-12 text-center"><Boxes className="mx-auto h-12 w-12 text-muted-foreground"/><h3 className="mt-4 font-semibold">No warehouse orders</h3><p className="mt-2 text-sm text-muted-foreground">Orders appear here after the customer chooses warehouse fulfillment.</p></Card>:
      <div className="space-y-4">{orders.map((o:any)=><Card key={o.id}><CardContent className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">#{o.orderNumber}</h3><Badge variant="outline">{STAGES[o.warehouseFulfillmentStage]||o.warehouseFulfillmentStage}</Badge>{o.shortageResolutionRequired&&<Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3"/>Shortage</Badge>}</div>
            <p className="mt-2 text-sm">{o.customer?.name||"Customer"} · {o.customer?.phone||"No phone"}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3"/>{[o.deliveryAddress?.addressLine1,o.deliveryAddress?.city,o.deliveryAddress?.state,o.deliveryAddress?.zipCode].filter(Boolean).join(", ")||"Address unavailable"}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{(o.items||[]).map((i:any)=><div key={`${i.productId}-${i.variantId||""}`} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{i.productName}</b><div className="text-muted-foreground">{i.quantity} {i.unit||"kg"} × ₹{i.unitPrice}</div></div>)}</div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 lg:min-w-[190px]">
            {["stored","received","received_transfer","warehouse_arrived"].includes(o.warehouseFulfillmentStage)&&<Button onClick={()=>allocate(o.id)}><Boxes className="mr-2 h-4 w-4"/>Allocate Stock</Button>}
            {["ready_for_packing","packing","shortage_pending"].includes(o.warehouseFulfillmentStage)&&<Button variant="outline" asChild><a href="/packing"><PackageCheck className="mr-2 h-4 w-4"/>Packing</a></Button>}
            {["ready_for_dispatch","delivery_decision"].includes(o.warehouseFulfillmentStage)&&<Button variant="outline" asChild><a href="/outgoing"><Truck className="mr-2 h-4 w-4"/>Dispatch</a></Button>}
          </div>
        </div>
      </CardContent></Card>)}</div>}
  </div>;
}