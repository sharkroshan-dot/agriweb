"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, Warehouse, CheckCircle2, Navigation } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

export default function DeliveryPickupRoutesPage(){
 const q=useQuery({queryKey:["myPickupRoutes"],queryFn:()=>api.get("/delivery/me/pickup-routes"),refetchInterval:10000});
 const [actual,setActual]=useState<Record<string,string>>({});
 const routes=q.data?.data?.routes||[];
 const act=async(route:any,status:string,collectionId?:string)=>{try{await api.put("/delivery/me/pickup-routes/"+route.id+"/status",undefined,{params:{status,collectionId,actualQuantity:collectionId?Number(actual[collectionId]||0):undefined}});toast.success(status.replace(/_/g," "));await q.refetch()}catch(e:any){toast.error(e?.message||"Unable to update pickup route")}};
 return <div className="space-y-6">
  <div className="rounded-2xl bg-gradient-to-r from-emerald-700 to-teal-600 p-6 text-white"><p className="text-sm text-emerald-100">Warehouse pickup operations</p><h1 className="mt-1 text-3xl font-bold">My Pickup Routes</h1><p className="mt-2 text-sm text-emerald-50">Your warehouse-approved routes show the farms to visit in order. Update each stop as you collect it.</p></div>
  {routes.length===0?<Card className="p-12 text-center"><Route className="mx-auto h-12 w-12 text-muted-foreground"/><h2 className="mt-4 font-semibold">No pickup route assigned</h2><p className="mt-2 text-sm text-muted-foreground">The warehouse will send a route after approving you as a pickup team member.</p></Card>:routes.map((r:any)=><Card key={r.id}><CardHeader className="border-b bg-slate-50/70"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>🚚 {r.routeNumber}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{r.totalStops} farms · {r.totalQuantity||0} kg</p></div><Badge>{String(r.status).replace(/_/g," ")}</Badge></div></CardHeader><CardContent className="p-5">
   {r.status==="assigned"&&<Button className="mb-5" onClick={()=>act(r,"started")}><Navigation className="mr-2 h-4 w-4"/> Start Pickup Route</Button>}
   <div className="space-y-3">{(r.stops||[]).map((s:any,i:number)=>{const active=s.status==="pending"||s.status==="started";return <div key={s.collectionId} className="rounded-xl border p-4"><div className="flex gap-3"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700">{i+1}</div><div className="min-w-0 flex-1"><p className="font-semibold">{s.farmerName}</p><p className="text-sm text-muted-foreground">{s.productName} · Expected {s.quantity} kg</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3"/> Farm pickup location</p></div><Badge variant="outline">{String(s.status||"pending").replace(/_/g," ")}</Badge></div>{r.status!=="assigned"&&active&&<div className="mt-4 flex flex-col gap-2 sm:flex-row">{s.status==="pending"&&<Button variant="outline" onClick={()=>act(r,"arrived_at_farm",s.collectionId)}>Arrived at Farm</Button>}{s.status==="arrived_at_farm"&&<><Input className="sm:w-40" type="number" placeholder="Actual kg" value={actual[s.collectionId]||""} onChange={e=>setActual({...actual,[s.collectionId]:e.target.value})}/><Button onClick={()=>act(r,"collected",s.collectionId)}><CheckCircle2 className="mr-2 h-4 w-4"/> Confirm Collection</Button></>}{s.status==="collected"&&<Button onClick={()=>act(r,"departed_farm",s.collectionId)}>Depart Farm</Button>}</div>}</div>})}</div>
   {r.status==="departed_farm"&&<Button className="mt-5" onClick={()=>act(r,"completed")}>Complete Pickup Route</Button>}{r.status==="completed"&&<Button className="mt-5" onClick={()=>act(r,"returned_to_warehouse")}>Mark Returned to Warehouse</Button>}
  </CardContent></Card>)}
 </div>
}