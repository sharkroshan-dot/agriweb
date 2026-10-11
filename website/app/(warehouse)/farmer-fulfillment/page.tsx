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
  destination_warehouse_in_transit:"In Transit to Destination",
  destination_warehouse_received:"Received at Destination",
  source_portion_in_transit:"In Transit to Consolidation",
  source_portion_received_at_consolidation:"Received at Consolidation",
  consolidation_in_transit:"Consolidation Transfer in Transit",
  consolidation_portions_received:"All Portions Received",
  consolidation_waiting_for_sources:"Waiting for Warehouse Portions",
  consolidated:"Consolidated — Ready for Local Hub",
  hub_handoff_pending:"In Transit to Local Hub",
  local_hub_ready:"Local Hub Received — Delivery Job Ready",
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
      await api.put(`/warehouse/me/incoming/${id}/receive`,undefined,{params:{quantity:qty,quality_check:"passed",usableQuantity:qty,notes:"Farmer-packed fulfillment received at warehouse"}});
      toast.success("Farmer-packed shipment received");
      await refetch();
    } catch(e:any){toast.error(e?.message||"Receiving failed");}
  };
  const refreshAll=async()=>{await refetch();await refetchConsolidations();};
  const completeConsolidation=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/complete-consolidation`);toast.success("All warehouse portions consolidated");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Consolidation failed");}
  };
  const dispatchConsolidation=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/dispatch-to-consolidation`);toast.success("Warehouse portion dispatched to consolidation");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Dispatch failed");}
  };
  const receiveConsolidation=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/receive-at-consolidation`);toast.success("Portion received at consolidation");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Consolidation receipt failed");}
  };
  const dispatchDestination=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/dispatch-to-destination`);toast.success("Order dispatched to destination warehouse");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Destination dispatch failed");}
  };
  const receiveDestination=async(id:string)=>{
    try{await api.post(`/warehouse/me/farmer-fulfillment/${id}/receive-at-destination`);toast.success("Destination warehouse receipt confirmed");await refreshAll();}
    catch(e:any){toast.error(e?.message||"Destination receipt failed");}
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

    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-bold">Warehouse workflow</h2>
        <p className="text-sm text-muted-foreground">Choose the route that matches the order. The next-action buttons appear on each order card when its prerequisites are met.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="border-blue-200">
          <CardContent className="space-y-3 p-4">
            <Badge variant="outline">Route 1 · Same district</Badge>
            <h3 className="font-semibold">Farm → Warehouse → Local Hub → Delivery Partner → Customer</h3>
            <ol className="space-y-2 text-sm">
              {["Receive + verify farmer-packed order","Store / hold sealed package","Transfer complete order to the local hub","Confirm local-hub receipt","One final delivery job is opened"].map((step,i)=><li key={step} className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">{i+1}</span><span>{step}</span></li>)}
            </ol>
          </CardContent>
        </Card>
        <Card className="border-violet-200">
          <CardContent className="space-y-3 p-4">
            <Badge variant="outline">Route 2 · Inter-district</Badge>
            <h3 className="font-semibold">Farm → Source Warehouse → Destination Warehouse → Local Hub → Delivery Partner → Customer</h3>
            <ol className="space-y-2 text-sm">
              {["Receive + verify at source warehouse","Dispatch to destination warehouse","Destination confirms physical receipt","Transfer complete order to the local hub","Confirm hub receipt; one delivery job opens"].map((step,i)=><li key={step} className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-800">{i+1}</span><span>{step}</span></li>)}
            </ol>
          </CardContent>
        </Card>
        <Card className="border-emerald-200">
          <CardContent className="space-y-3 p-4">
            <Badge variant="outline">Route 3 · Multi-warehouse</Badge>
            <h3 className="font-semibold">Multiple Farms / Warehouses → Consolidation → Local Hub → Delivery Partner → Customer</h3>
            <ol className="space-y-2 text-sm">
              {["Receive each allocated packed portion","Each source warehouse dispatches its portion","Consolidation warehouse receives all portions","Complete consolidation of the original order","Transfer to local hub; confirm receipt; one job opens"].map((step,i)=><li key={step} className="flex gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{i+1}</span><span>{step}</span></li>)}
            </ol>
          </CardContent>
        </Card>
      </div>
    </section>

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
            {(() => {
              const mode = String(o.logisticsMode || "").toLowerCase();
              const multi = mode === "farmer_to_multiple_warehouses_to_consolidation_to_local_hub_to_delivery_partner" ||
                mode.includes("multiple_warehouses") || Number(o.warehouseCount || 0) > 1 ||
                (Array.isArray(o.warehouseAllocations) && o.warehouseAllocations.length > 1);
              const interDistrict = !multi && (mode === "farmer_to_source_warehouse_to_destination_warehouse_to_local_hub_to_delivery_partner" ||
                mode.includes("destination_warehouse") || Boolean(o.destinationWarehouseId));
              const sameDistrict = !multi && !interDistrict && (
                mode === "farmer_to_warehouse_to_local_hub_to_delivery_partner" ||
                mode === "farmer_to_warehouse" || Boolean(o.warehouseId)
              );
              const con = consolidations.find((x:any)=>x.orderId===o.id);
              const conStatus = o.consolidationStatus || con?.consolidationStatus || "";
              const transferStatus = o.transferStatus || "";
              const incomingRows = o.incoming || [];
              const receiptComplete = incomingRows.length > 0 && incomingRows.every((x:any) =>
                ["received","stored"].includes(x.status) && Number(x.receivedQuantity || 0) + 1e-9 >= Number(x.expectedQuantity || 0)
              );
              const storedComplete = incomingRows.length > 0 && incomingRows.every((x:any) => x.status === "stored");
              const sourceRole = o.currentWarehouseRole === "source" || (o.sourceWarehouseId && o.sourceWarehouseId === o.warehouseId);
              const destinationRole = o.currentWarehouseRole === "destination" || (o.destinationWarehouseId && o.destinationWarehouseId === o.warehouseId);
              const consolidationRole = o.currentWarehouseRole === "consolidation" || (o.consolidationWarehouseId && o.consolidationWarehouseId === o.warehouseId);
              const canReceiveAtSource = incomingRows.some((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status));
              const nextAction = multi
                ? (conStatus === "consolidated" ? "Transfer the complete order to the local hub" : "Receive every warehouse portion, then dispatch each portion to consolidation")
                : interDistrict
                  ? (transferStatus === "destination_warehouse_in_transit" ? "Confirm physical receipt at destination" : transferStatus === "destination_warehouse_received" ? "Transfer the complete order to the local hub" : "Receive at source, then dispatch to destination")
                  : (["hub_handoff_pending"].includes(transferStatus) ? "Confirm the local hub physically received the order" : transferStatus === "local_hub_ready" ? "One final delivery job is ready" : "Receive the packed order, then transfer it to the local hub");
              return <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Process this order</p>
                    <p className="mt-1 text-xs text-muted-foreground">{multi ? "Multiple warehouses → Consolidation → Local Hub → One Delivery Partner → Customer" : interDistrict ? "Farm → Source Warehouse → Destination Warehouse → Local Hub → One Delivery Partner → Customer" : "Farm → Warehouse → Local Hub → One Delivery Partner → Customer"}</p>
                  </div>
                  <Badge variant="outline">{STAGES[o.stage] || o.stage || "Awaiting warehouse action"}</Badge>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs font-medium text-muted-foreground">NEXT STEP</p>
                  <p className="mt-1 text-sm font-semibold">{nextAction}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!multi && !interDistrict && <>
                    {incomingRows.filter((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status)).map((x:any)=><Button key={x.id} size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}><PackageCheck className="mr-2 h-4 w-4"/>Receive + Verify</Button>)}
                    {incomingRows.filter((x:any)=>x.status === "received").map((x:any)=><Button key={x.id} size="sm" variant="outline" onClick={()=>store(x.id)}>Store / Hold Packed Shipment</Button>)}
                    <Button size="sm" onClick={()=>handoffHub(o.id)} disabled={!receiptComplete || !["received","stored"].every((s:string)=>incomingRows.some((x:any)=>["received","stored"].includes(x.status))) || ["hub_handoff_pending","local_hub_ready"].includes(transferStatus)}><Route className="mr-2 h-4 w-4"/>Transfer to Local Hub</Button>
                    {transferStatus === "hub_handoff_pending" && <Button size="sm" onClick={()=>receiveHub(o.id)}><MapPin className="mr-2 h-4 w-4"/>Confirm Local Hub Receipt</Button>}
                  </>}
                  {interDistrict && <>
                    {sourceRole && incomingRows.filter((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status)).map((x:any)=><Button key={x.id} size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}><PackageCheck className="mr-2 h-4 w-4"/>Receive + Verify</Button>)}
                    {sourceRole && incomingRows.filter((x:any)=>x.status === "received").map((x:any)=><Button key={x.id} size="sm" variant="outline" onClick={()=>store(x.id)}>Store Packed Shipment</Button>)}
                    {sourceRole && <Button size="sm" onClick={()=>dispatchDestination(o.id)} disabled={!receiptComplete || !o.destinationWarehouseId || ["destination_warehouse_in_transit","destination_warehouse_received","hub_handoff_pending","local_hub_ready"].includes(transferStatus)}><Truck className="mr-2 h-4 w-4"/>Dispatch to Destination</Button>}
                    {destinationRole && <Button size="sm" onClick={()=>receiveDestination(o.id)} disabled={transferStatus !== "destination_warehouse_in_transit"}><Warehouse className="mr-2 h-4 w-4"/>Confirm Destination Receipt</Button>}
                    {destinationRole && <Button size="sm" onClick={()=>handoffHub(o.id)} disabled={transferStatus !== "destination_warehouse_received"}><Route className="mr-2 h-4 w-4"/>Transfer to Local Hub</Button>}
                    {transferStatus === "hub_handoff_pending" && <Button size="sm" onClick={()=>receiveHub(o.id)}><MapPin className="mr-2 h-4 w-4"/>Confirm Local Hub Receipt</Button>}
                  </>}
                  {multi && <>
                    {!consolidationRole && incomingRows.filter((x:any)=>["pending","scheduled","in_transit","ready_for_pickup"].includes(x.status)).map((x:any)=><Button key={x.id} size="sm" onClick={()=>receive(x.id,x.expectedQuantity)}><PackageCheck className="mr-2 h-4 w-4"/>Receive + Verify Portion</Button>)}
                    {!consolidationRole && incomingRows.filter((x:any)=>x.status === "received").map((x:any)=><Button key={x.id} size="sm" variant="outline" onClick={()=>store(x.id)}>Store Packed Portion</Button>)}
                    {con?.canDispatchToConsolidation && <Button size="sm" variant="outline" onClick={()=>dispatchConsolidation(o.id)} disabled={!storedComplete || Boolean(con?.sourceTransfer?.dispatched)}><Truck className="mr-2 h-4 w-4"/>Dispatch Portion to Consolidation</Button>}
                    {consolidationRole && <Button size="sm" variant="outline" onClick={()=>receiveConsolidation(o.id)} disabled={!con?.consolidation?.inTransitLegs && !con?.inTransitLegCount && Boolean(con?.allConsolidationLegsReceived)}><Warehouse className="mr-2 h-4 w-4"/>Receive Portions at Consolidation</Button>}
                    {consolidationRole && <Button size="sm" onClick={()=>completeConsolidation(o.id)} disabled={!con?.allWarehousesReceived || !con?.allConsolidationLegsReceived || ["consolidated","hub_handoff_pending","local_hub_ready"].includes(conStatus)}><CheckCircle2 className="mr-2 h-4 w-4"/>Complete Consolidation</Button>}
                    {consolidationRole && <Button size="sm" variant="outline" onClick={()=>handoffHub(o.id)} disabled={conStatus !== "consolidated"}><Route className="mr-2 h-4 w-4"/>Transfer Complete Order to Local Hub</Button>}
                    {consolidationRole && <Button size="sm" variant="outline" onClick={()=>receiveHub(o.id)} disabled={conStatus !== "hub_handoff_pending"}><MapPin className="mr-2 h-4 w-4"/>Confirm Local Hub Receipt</Button>}
                  </>}
                </div>
                {multi && <div className="grid gap-2 sm:grid-cols-3 text-xs">
                  <div className="rounded-lg bg-white p-3"><p className="text-muted-foreground">Warehouse portions</p><p className="mt-1 font-semibold">{con?.storedCount ?? 0}/{con?.incomingCount ?? 0} received + stored</p></div>
                  <div className="rounded-lg bg-white p-3"><p className="text-muted-foreground">Consolidation receipts</p><p className="mt-1 font-semibold">{con?.receivedConsolidationLegCount ?? (con?.allConsolidationLegsReceived ? "All received" : "Pending")}</p></div>
                  <div className="rounded-lg bg-white p-3"><p className="text-muted-foreground">Local hub</p><p className="mt-1 font-semibold">{o.localHubName || "Assigned local hub"}</p></div>
                </div>}
                {!multi && !interDistrict && !receiptComplete && <p className="text-xs text-amber-700">Receive and verify the full packed quantity first. The local-hub transfer remains disabled until the shipment is physically received.</p>}
                {interDistrict && !o.destinationWarehouseId && <p className="text-xs text-amber-700">A destination warehouse has not been assigned yet. Dispatch is unavailable until the route assignment is complete.</p>}
                {multi && !con?.allWarehousesReceived && <p className="text-xs text-amber-700">Waiting for all allocated farmer-packed portions to be received at their assigned warehouses.</p>}
                {transferStatus === "local_hub_ready" && <p className="text-sm font-medium text-emerald-700">✓ Local hub receipt confirmed. The backend should expose one final delivery job for this original customer order.</p>}
              </div>;
            })()}
            {o.stage==="dispatched"&&<Badge variant="success" className="justify-center py-2"><Truck className="mr-1 h-4 w-4"/>Sent to Local Hub</Badge>}
          </div>
        </div>
      </CardContent></Card>)}</div>}
  </div>;
}