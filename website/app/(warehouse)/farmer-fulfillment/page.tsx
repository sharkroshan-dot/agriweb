"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Warehouse, PackageCheck, Route, MapPin, Truck, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const STAGES: Record<string,string> = {
  awaiting_farmer_confirmation:"Waiting for Farmer",
  collection_team_assigned:"Collection Team Assigned",
  collection_en_route:"Collection En Route",
  collection_arrived:"At Farm",
  collected:"Collected",
  collection_departed:"In Transit",
  warehouse_arrived:"At Warehouse",
  received:"Received",
  received_transfer:"Received at Warehouse",
  stored:"Stored",
  ready_for_dispatch:"Ready for Local Hub",
  delivery_decision:"Hub Route Selected",
  dispatched:"Dispatched",
};

export default function FarmerFulfillmentWarehousePage() {
  const {data,isLoading,refetch}=useQuery({
    queryKey:["farmerFulfillmentTransfers"],
    queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-transfers"),
    refetchInterval:15000,
  });
  const transfers=data?.data?.transfers||[];
  const {data:consolidationData,refetch:refetchConsolidations}=useQuery({
    queryKey:["farmerFulfillmentConsolidations"],
    queryFn:()=>api.get("/warehouse/me/farmer-fulfillment-consolidations"),
    refetchInterval:15000,
  });
  const consolidations=consolidationData?.data?.consolidations||[];

  const requestReturn=async(orderId:string)=>{
    const reason=window.prompt("Reason for returning this farmer-packed shipment to the farmer:");
    if(!reason?.trim()) return;
    try{
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/return-to-farmer`,{reason:reason.trim()});
      toast.success("Return request sent to farmer");
      await refreshAll();
    }catch(e:any){toast.error(e?.message||"Return request failed");}
  };
  const receive=async(id:string,qty:number)=>{
    try {
      await api.put(`/warehouse/me/incoming/${id}/receive`,{quantity:qty,qualityCheck:"passed",notes:"Farmer-packed fulfillment received at warehouse"});
      toast.success("Farmer-packed shipment received");
      await refetch();
    } catch(e:any){toast.error(e?.message||"Receiving failed");}
  };
  const refreshAll=async()=>{await refetch();await refetchConsolidations();};
  const completeConsolidation=async(id:string)=>{
  const dispatchConsolidation = async (id:string) => {
    try{await api.post(\`/warehouse/me/farmer-fulfillment/\${id}/dispatch-to-consolidation\`);toast.success("Warehouse portion dispatched to consolidation");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Dispatch failed");}
  };
  const receiveConsolidation = async (id:string) => {
    try{await api.post(\`/warehouse/me/farmer-fulfillment/\${id}/receive-at-consolidation\`);toast.success("Portion received at consolidation");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Consolidation receipt failed");}
  };
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/complete-consolidation`);toast.success("All warehouse portions consolidated");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Consolidation failed");}
  };
  const handoffHub=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/handoff-local-hub`);toast.success("Complete order handed to local hub");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Local hub handoff failed");}
  };
  const receiveHub=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/receive-local-hub`);toast.success("Local hub received complete order; one delivery job opened");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Local hub receipt failed");}
  };
  const store=async(id:string)=>{
    try {
      await api.put(`/warehouse/me/incoming/${id}/store`);
      toast.success("Transfer stored and ready for dispatch");
      await refetch();
    } catch(e:any){toast.error(e?.message||"Storage failed");}
  };

  return <div className="space-y-6">
    <div className="rounded-2xl bg-gradient-to-r from-indigo-800 to-slate-800 p-6 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2 text-sm text-indigo-200"><Warehouse className="h-4 w-4"/>Farmer Fulfillment Transfer</div>
        <h1 className="mt-1 text-3xl font-bold">Packed Farmer Orders</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-200">These orders are already packed and verified by the farmer. This warehouse process does not repack the order.</p></div>
        <Button variant="secondary" size="icon" onClick={()=>refetch()}><RefreshCw className="h-4 w-4"/></Button>
      </div>
    </div>

    <Card className="border-indigo-100 bg-indigo-50/60"><CardContent className="p-5">
      <div className="grid gap-4 md:grid-cols-4 text-sm">
        {[
          ["1","Receive","Verify package + quantity"],
          ["2","Store / Hold","Place packed shipment safely"],
          ["3","Route","Warehouse → Local Hub"],
          ["4","Handoff","Local Hub → Delivery Partner → Customer"],
        ].map(([n,title,desc])=><div key={n} className="rounded-xl bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">{n}</span><b>{title}</b></div><p className="mt-2 text-xs text-muted-foreground">{desc}</p></div>)}
      </div>
    </CardContent></Card>

    {isLoading?<div className="h-32 animate-pulse rounded-xl bg-muted"/>:transfers.length===0?
      <Card className="p-12 text-center"><PackageCheck className="mx-auto h-12 w-12 text-muted-foreground"/><h3 className="mt-4 font-semibold">No farmer-packed transfers</h3><p className="mt-2 text-sm text-muted-foreground">Long-distance farmer fulfillment orders routed through this warehouse will appear here.</p></Card>:
      <div className="space-y-4">{transfers.map((o:any)=><Card key={o.id}><CardContent className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">#{o.orderNumber}</h3><Badge variant="outline">{STAGES[o.stage]||o.stage}</Badge><Badge variant="secondary">Farmer Packed</Badge></div>
            <p className="mt-2 text-sm text-muted-foreground">Farmer: {o.farmerName||"Assigned Farmer"} · Warehouse: {o.warehouseName}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3"/>Customer: {[o.deliveryAddress?.addressLine1,o.deliveryAddress?.city,o.deliveryAddress?.state].filter(Boolean).join(", ")||"Address unavailable"}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">{(o.items||[]).map((i:any)=><div key={`${i.productId}-${i.variantId||""}`} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{i.productName}</b><div className="text-muted-foreground">{i.quantity} {i.unit}</div></div>)}</div>
            <div className="mt-4 space-y-2">{(o.incoming||[]).map((x:any)=><div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><div><b>Incoming shipment</b><div className="text-xs text-muted-foreground">Expected {x.expectedQuantity} · Received {x.receivedQuantity||0} · {x.qualityCheck||"quality pending"}</div></div><div className="flex gap-2">{x.status==="pending"&&<Button size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}>Receive + Verify</Button>}{x.status==="received"&&<Button size="sm" onClick={()=>store(x.id)}>Store Packed Shipment</Button>}{x.status==="stored"&&<Badge variant="success"><CheckCircle2 className="mr-1 h-4 w-4"/>Stored</Badge>}
                  {(x.status==="rejected"||x.qualityCheck==="failed")&&<Button size="sm" variant="outline" onClick={()=>requestReturn(o.id)}>Return to Farmer</Button>}</div></div>)}</div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 lg:w-64">
            <div className="rounded-xl border bg-slate-50 p-4 text-sm"><p className="font-semibold">No warehouse packing</p><p className="mt-1 text-xs text-muted-foreground">Farmer has already packed, checked and sealed this order.</p></div>
            {o.logisticsMode === "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" && (()=>{const con=consolidations.find((x:any)=>x.orderId===o.id);const status=con?.consolidationStatus;return <div className="space-y-2">
              {(status==="collecting_from_warehouses"||status==="partial"||(!status&&con?.allWarehousesReceived===false))&&<div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={()=>dispatchConsolidation(o.id)}><Truck className="mr-2 h-4 w-4"/>Dispatch to Consolidation</Button>
                <Button size="sm" variant="outline" onClick={()=>receiveConsolidation(o.id)}><Warehouse className="mr-2 h-4 w-4"/>Receive at Consolidation</Button>
                <Button size="sm" onClick={()=>completeConsolidation(o.id)} disabled={!con?.allWarehousesReceived}><Route className="mr-2 h-4 w-4"/>Complete Consolidation</Button>
              </div>}
              {status==="consolidated"&&<Button size="sm" onClick={()=>handoffHub(o.id)}>Transfer to Local Hub</Button>}
              {status==="hub_handoff_pending"&&<Button size="sm" onClick={()=>receiveHub(o.id)}>Confirm Local Hub Receipt</Button>}
              {["local_hub_ready","partner_pending"].includes(status||"")&&<Badge variant="success" className="justify-center py-2"><Truck className="mr-1 h-4 w-4"/>One Delivery Job Ready</Badge>}
            </div>})()}
            {o.logisticsMode !== "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" && ["ready_for_dispatch","delivery_decision"].includes(o.stage)&&<Button asChild><a href="/outgoing"><Route className="mr-2 h-4 w-4"/>Choose Hub Route</a></Button>}
            {o.stage==="dispatched"&&<Badge variant="success" className="justify-center py-2"><Truck className="mr-1 h-4 w-4"/>Sent to Local Hub</Badge>}
          </div>
        </div>
      </CardContent></Card>)}</div>}
  </div>;
}