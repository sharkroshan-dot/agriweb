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
 const [formErrors,setFormErrors]=useState<Record<string,string>>({});
 const [submitting,setSubmitting]=useState(false);
 const update=(k:string,v:string)=> {
  setForm((current:any)=>({...current,[k]:v}));
  setFormErrors((current)=>({...current,[k]:""}));
 };
 const warehouses=w.data?.warehouses||w.data?.data?.warehouses||[];
 const memberships=q.data?.memberships||q.data?.data?.memberships||[];
 const applications=q.data?.applications||q.data?.data?.applications||[];
 const submit=async()=>{
  const errors:Record<string,string>={};
  if(!String(form.warehouseId||"").trim()) errors.warehouseId="Please choose a warehouse from the dropdown.";
  if(!String(form.vehicleNumber||"").trim()) errors.vehicleNumber="Enter your vehicle registration number.";
  if(form.capacity!==""&&(!Number.isFinite(Number(form.capacity))||Number(form.capacity)<=0)) errors.capacity="Enter a carrying capacity greater than 0 kg.";
  if(Object.keys(errors).length){setFormErrors(errors);toast.error(Object.values(errors)[0]);return;}
  setSubmitting(true);
  try{
   await api.post("/delivery/me/pickup-team/apply",{
    warehouseId:String(form.warehouseId).trim(),
    vehicleType:String(form.vehicleType||"van").trim(),
    vehicleNumber:String(form.vehicleNumber).trim().toUpperCase(),
    vehicleModel:String(form.vehicleModel||"").trim()||undefined,
    capacity:form.capacity!==""?Number(form.capacity):undefined,
    fuelType:String(form.fuelType||"").trim()||undefined,
    notes:String(form.notes||"").trim()||undefined,
   });
   toast.success("Application submitted for warehouse approval");
   setFormErrors({});
   await Promise.all([q.refetch(),w.refetch()]);
  }catch(e:any){toast.error(e?.message||"Application failed");}
  finally{setSubmitting(false);}
 };
 return <div className="space-y-6">
  <div className="rounded-2xl bg-gradient-to-r from-slate-800 to-emerald-700 p-6 text-white"><p className="text-sm text-emerald-100">Delivery Partner</p><h1 className="mt-1 text-3xl font-bold">Warehouse Pickup Partner</h1><p className="mt-2 text-sm text-slate-200">Apply to collect products from multiple farms for a warehouse. The warehouse must verify and approve you before you can receive pickup routes.</p></div>
  {memberships.length>0&&<Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600"/>Approved Warehouse Partnerships</CardTitle></CardHeader><CardContent className="space-y-3">{memberships.map((m:any)=><div key={m.id} className="rounded-xl border p-4"><p className="font-semibold">🟢 Warehouse Pickup Partner</p><p className="text-sm text-muted-foreground">Vehicle: {m.vehicleType} · {m.vehicleNumber}</p></div>)}</CardContent></Card>}
  <Card><CardHeader><CardTitle>Apply for a Warehouse Pickup Partner</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
   <div className="space-y-1.5">
    <label htmlFor="pickup-warehouse" className="text-sm font-medium">Warehouse <span className="text-red-600">*</span></label>
    <Select id="pickup-warehouse" title="Choose the warehouse you want to work with" className={formErrors.warehouseId?"border-red-500 focus:border-red-500":""} value={form.warehouseId} onValueChange={v=>update("warehouseId",v)} disabled={w.isLoading||warehouses.length===0}>
     <SelectContent>
      <SelectItem value="">{w.isLoading?"Loading warehouses...":warehouses.length?"Select warehouse":"No active warehouses available"}</SelectItem>
      {warehouses.map((x:any)=><SelectItem key={x.id} value={String(x.id)}>{x.name||x.warehouseName||"Warehouse"}{x.address?.city ? " · "+x.address.city : ""}</SelectItem>)}
     </SelectContent>
    </Select>
    {formErrors.warehouseId&&<p className="text-xs text-red-600">{formErrors.warehouseId}</p>}
    {!w.isLoading&&!w.isError&&warehouses.length===0&&<p className="text-xs text-amber-700">No selectable warehouses were returned. Refresh the page or ask the warehouse administrator to check the active warehouse records.</p>}
    {w.isError&&<p className="text-xs text-red-600">Could not load warehouses. Refresh and try again.</p>}
   </div>
   <div className="space-y-1.5">
    <label htmlFor="pickup-vehicle-type" className="text-sm font-medium">Vehicle type <span className="text-red-600">*</span></label>
    <Select id="pickup-vehicle-type" value={form.vehicleType} onValueChange={v=>update("vehicleType",v)}>
     <SelectContent>{["bike","car","van","truck","tempo"].map(x=><SelectItem key={x} value={x}>{x.charAt(0).toUpperCase()+x.slice(1)}</SelectItem>)}</SelectContent>
    </Select>
   </div>
   <div className="space-y-1.5">
    <label htmlFor="pickup-vehicle-number" className="text-sm font-medium">Vehicle number <span className="text-red-600">*</span></label>
    <Input id="pickup-vehicle-number" placeholder="e.g. TN 45 AB 1234" value={form.vehicleNumber} aria-invalid={Boolean(formErrors.vehicleNumber)} className={formErrors.vehicleNumber?"border-red-500":""} onChange={e=>update("vehicleNumber",e.target.value.toUpperCase())}/>
    {formErrors.vehicleNumber&&<p className="text-xs text-red-600">{formErrors.vehicleNumber}</p>}
   </div>
   <div className="space-y-1.5">
    <label htmlFor="pickup-vehicle-model" className="text-sm font-medium">Vehicle model</label>
    <Input id="pickup-vehicle-model" placeholder="e.g. Tata Ace Gold" value={form.vehicleModel} onChange={e=>update("vehicleModel",e.target.value)}/>
   </div>
   <div className="space-y-1.5">
    <label htmlFor="pickup-capacity" className="text-sm font-medium">Carrying capacity (kg)</label>
    <Input id="pickup-capacity" placeholder="Capacity in kilograms" type="number" min="1" value={form.capacity} aria-invalid={Boolean(formErrors.capacity)} className={formErrors.capacity?"border-red-500":""} onChange={e=>update("capacity",e.target.value)}/>
    {formErrors.capacity&&<p className="text-xs text-red-600">{formErrors.capacity}</p>}
   </div>
   <div className="space-y-1.5">
    <label htmlFor="pickup-fuel" className="text-sm font-medium">Fuel type</label>
    <Input id="pickup-fuel" placeholder="e.g. Diesel, Petrol, CNG, Electric" value={form.fuelType} onChange={e=>update("fuelType",e.target.value)}/>
   </div>
   <div className="space-y-1.5 md:col-span-2">
    <label htmlFor="pickup-notes" className="text-sm font-medium">Additional details</label>
    <Input id="pickup-notes" placeholder="Additional details for warehouse verification" value={form.notes} onChange={e=>update("notes",e.target.value)}/>
   </div>
   <Button className="md:col-span-2" onClick={submit} disabled={submitting||w.isLoading||warehouses.length===0}>
    {submitting?"Submitting application...":"Submit for Warehouse Approval"}
   </Button>
  </CardContent></Card>
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5"/>Application Status</CardTitle></CardHeader><CardContent className="space-y-3">{applications.length===0?<p className="text-sm text-muted-foreground">No applications yet.</p>:applications.map((a:any)=><div key={a.id} className="flex items-center justify-between rounded-xl border p-4"><div><p className="font-medium">{a.vehicleNumber}</p><p className="text-xs text-muted-foreground">Warehouse ID: {a.warehouseId}</p></div><span className="text-sm font-semibold">{a.status}</span></div>)}</CardContent></Card>
 </div>
}