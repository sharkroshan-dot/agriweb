"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Truck, Warehouse, Clock3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

export default function PickupTeamApplicationPage(){
 const q=useQuery({queryKey:["myPickupTeam"],queryFn:()=>api.get("/delivery/me/pickup-team")});
 const w=useQuery({queryKey:["pickupWarehouses"],queryFn:()=>api.get("/delivery/me/pickup-team/warehouses")});
 const [form,setForm]=useState<any>({warehouseId:"",vehicleType:"van",vehicleNumber:"",vehicleModel:"",capacity:"",fuelType:"diesel",notes:""});
 const update=(k:string,v:string)=>setForm({...form,[k]:v});
 const submit=async()=>{if(!form.warehouseId||!form.vehicleNumber)return toast.error("Select a warehouse and enter vehicle number");try{await api.post("/delivery/me/pickup-team/apply",{...form,capacity:form.capacity?Number(form.capacity):undefined});toast.success("Application submitted for warehouse approval");await q.refetch()}catch(e:any){toast.error(e?.message||"Application failed")}};
 const memberships=q.data?.data?.memberships||[]; const applications=q.data?.data?.applications||[];
 return <div className="space-y-6">
  <div className="rounded-2xl bg-gradient-to-r from-slate-800 to-emerald-700 p-6 text-white"><p className="text-sm text-emerald-100">Delivery Partner</p><h1 className="mt-1 text-3xl font-bold">Warehouse Pickup Partner</h1><p className="mt-2 text-sm text-slate-200">Apply to collect products from multiple farms for a warehouse. The warehouse must verify and approve you before you can receive pickup routes.</p></div>
  {memberships.length>0&&<Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600"/>Approved Warehouse Partnerships</CardTitle></CardHeader><CardContent className="space-y-3">{memberships.map((m:any)=><div key={m.id} className="rounded-xl border p-4"><p className="font-semibold">🟢 Warehouse Pickup Partner</p><p className="text-sm text-muted-foreground">Vehicle: {m.vehicleType} · {m.vehicleNumber}</p></div>)}</CardContent></Card>}
  <Card><CardHeader><CardTitle>Apply for a Warehouse Pickup Partner</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
   <Select value={form.warehouseId} onValueChange={v=>update("warehouseId",v)}><SelectTrigger><SelectValue placeholder="Select warehouse"/></SelectTrigger><SelectContent>{(w.data?.data?.warehouses||[]).map((x:any)=><SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
   <Select value={form.vehicleType} onValueChange={v=>update("vehicleType",v)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["bike","car","van","truck","tempo"].map(x=><SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
   <Input placeholder="Vehicle number" value={form.vehicleNumber} onChange={e=>update("vehicleNumber",e.target.value)}/><Input placeholder="Vehicle model" value={form.vehicleModel} onChange={e=>update("vehicleModel",e.target.value)}/><Input placeholder="Capacity (kg)" type="number" value={form.capacity} onChange={e=>update("capacity",e.target.value)}/><Input placeholder="Fuel type" value={form.fuelType} onChange={e=>update("fuelType",e.target.value)}/>
   <Input className="md:col-span-2" placeholder="Additional details for warehouse verification" value={form.notes} onChange={e=>update("notes",e.target.value)}/>
   <Button className="md:col-span-2" onClick={submit}>Submit for Warehouse Approval</Button>
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5"/>Application Status</CardTitle></CardHeader><CardContent className="space-y-3">{applications.length===0?<p className="text-sm text-muted-foreground">No applications yet.</p>:applications.map((a:any)=><div key={a.id} className="flex items-center justify-between rounded-xl border p-4"><div><p className="font-medium">{a.vehicleNumber}</p><p className="text-xs text-muted-foreground">Warehouse ID: {a.warehouseId}</p></div><span className="text-sm font-semibold">{a.status}</span></div>)}</CardContent></Card>
 </div>
}