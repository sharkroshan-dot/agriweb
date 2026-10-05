"use client";
import { useQuery } from "@tanstack/react-query";
import { Users, CheckCircle2, XCircle, Truck, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

export default function PickupTeamPage(){
 const q=useQuery({queryKey:["pickupTeamApplications"],queryFn:()=>api.get("/warehouse/me/pickup-team/applications"),refetchInterval:15000});
 const apps=q.data?.data?.applications||[];
 const review=async(id:string,decision:"approve"|"reject")=>{try{await api.put(`/warehouse/me/pickup-team/applications/${id}`,undefined,{params:{decision}});toast.success(decision==="approve"?"Member added to pickup team":"Application rejected");await q.refetch()}catch(e:any){toast.error(e?.message||"Review failed")}};
 return <div className="space-y-6">
  <div className="rounded-2xl bg-gradient-to-r from-slate-800 to-emerald-700 p-6 text-white"><div className="flex items-center gap-2 text-emerald-100 text-sm"><Users className="h-4 w-4"/> Warehouse-controlled team</div><h1 className="mt-2 text-3xl font-bold">Pickup Team</h1><p className="mt-2 text-sm text-slate-200">Delivery partners apply themselves, but only the warehouse can approve and add them to its pickup team.</p></div>
  <div className="grid gap-4 md:grid-cols-2">{apps.length===0?<Card className="p-10 text-center md:col-span-2"><ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground"/><p className="mt-3 font-semibold">No pickup team applications</p></Card>:apps.map((a:any)=><Card key={a.id}><CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">{a.vehicleNumber || "Delivery Partner"}</CardTitle><Badge>{a.status}</Badge></div></CardHeader><CardContent><div className="space-y-2 text-sm"><p className="flex items-center gap-2"><Truck className="h-4 w-4"/> {a.vehicleType} · {a.vehicleModel||"Vehicle"}</p><p>Capacity: {a.capacity || "—"} kg</p><p>Fuel: {a.fuelType || "—"}</p><p className="text-xs text-muted-foreground">Application ID: {a.id}</p></div>{a.status==="pending"&&<div className="mt-5 flex gap-2"><Button className="flex-1" onClick={()=>review(a.id,"approve")}><CheckCircle2 className="mr-2 h-4 w-4"/> Approve & Add</Button><Button variant="outline" onClick={()=>review(a.id,"reject")}><XCircle className="mr-2 h-4 w-4"/> Reject</Button></div>}</CardContent></Card>)}</div>
 </div>
}
