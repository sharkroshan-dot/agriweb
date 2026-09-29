"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users2, Plus, Loader2, CheckCircle2, MapPin, Sprout, Package, ShoppingCart, Truck, Wallet, BarChart3, UserPlus, ClipboardList, Warehouse, ArrowRight, X } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

type Stage = "setup" | "members" | "production" | "inventory" | "orders" | "distribution" | "earnings" | "reports";
const stages: {key:Stage;title:string;icon:any}[] = [
  {key:"setup",title:"Create Cooperative",icon:Users2},{key:"members",title:"Add / Approve Farmers",icon:UserPlus},{key:"production",title:"Collective Production",icon:Sprout},{key:"inventory",title:"Collective Inventory",icon:Warehouse},{key:"orders",title:"Orders / Bulk Orders",icon:ShoppingCart},{key:"distribution",title:"Distribution",icon:Truck},{key:"earnings",title:"Sales & Earnings",icon:Wallet},{key:"reports",title:"Cooperative Reports",icon:BarChart3}
];

export default function FarmerCooperativePage(){
 const qc=useQueryClient();
 const [stage,setStage]=useState<Stage>("setup");
 const [selectedCoopId,setSelectedCoopId]=useState("");
 const [showCreate,setShowCreate]=useState(false); const [showJoin,setShowJoin]=useState(false); const [showInvite,setShowInvite]=useState(false);
 const [inviteCode,setInviteCode]=useState(""); const [search,setSearch]=useState(""); const [location,setLocation]=useState(""); const [crop,setCrop]=useState("");
 const [form,setForm]=useState({name:"",location:"",description:"",crops:""});
 const [allocations,setAllocations]=useState<Record<string,number>>({});
  const { data, isLoading } = useQuery({
    queryKey: ["farmerCooperatives"],
    queryFn: () => api.get("/cooperatives/me"),
    retry: 1,
  });
  const cooperatives = data?.data?.cooperatives || [];
  useEffect(() => {
    if (cooperatives.length && !cooperatives.some((x: any) => x.id === selectedCoopId)) {
      setSelectedCoopId(cooperatives[0].id);
    }
  }, [cooperatives, selectedCoopId]);
  const coop = cooperatives.find((x: any) => x.id === selectedCoopId) || cooperatives[0];
  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: ["cooperativeDashboard", coop?.id],
    queryFn: () => api.get(`/cooperatives/dashboard/${coop?.id}`),
    enabled: Boolean(coop?.id),
    retry: 1,
  });
  const dash = dashData?.data?.data || dashData?.data || {};
  const { data: supplyData, isLoading: supplyLoading } = useQuery({
    queryKey: ["cooperativeSupply", coop?.id],
    queryFn: () => api.get(`/cooperatives/${coop?.id}/supply`),
    enabled: Boolean(coop?.id) && stage === "inventory",
    retry: 1,
  });
  const supply = supplyData?.data?.products || [];
  const { data: reqData, isLoading: reqLoading } = useQuery({
    queryKey: ["cooperativeJoinRequests", coop?.id],
    queryFn: () => api.get(`/cooperatives/${coop?.id}/join-requests`),
    enabled: Boolean(coop?.id) && coop?.role === "manager" && stage === "members",
    retry: 1,
  });
  const requests = (reqData?.data?.requests || []).filter((x: any) => x.status === "pending");
 const create=useMutation({mutationFn:()=>api.post("/cooperatives",{name:form.name,location:form.location,description:form.description,crops:form.crops.split(",").map(x=>x.trim()).filter(Boolean)}),onSuccess:()=>{qc.invalidateQueries({queryKey:["farmerCooperatives"]});setShowCreate(false);setForm({name:"",location:"",description:"",crops:""});setStage("members");toast.success("Cooperative created successfully")},onError:(e:any)=>toast.error(e?.message||"Failed to create cooperative")});
 const join=useMutation({mutationFn:(id?:string)=>id?api.post("/cooperatives/"+id+"/join-request",{}):api.post("/cooperatives/join",{inviteCode:inviteCode.trim().toUpperCase()}),onSuccess:()=>{qc.invalidateQueries({queryKey:["farmerCooperatives"]});qc.invalidateQueries({queryKey:["cooperativeDiscovery"]});setShowJoin(false);setShowInvite(false);setInviteCode("");toast.success("Join request sent. Waiting for manager approval.")},onError:(e:any)=>toast.error(e?.message||"Could not send join request")});
 const approve=useMutation({mutationFn:(userId:string)=>api.post("/cooperatives/"+coop.id+"/join-requests/approve",{userId}),onSuccess:()=>{qc.invalidateQueries({queryKey:["farmerCooperatives"]});qc.invalidateQueries({queryKey:["cooperativeJoinRequests",coop?.id]});toast.success("Farmer approved")},onError:(e:any)=>toast.error(e?.message||"Approval failed")});
 const reject=useMutation({mutationFn:(userId:string)=>api.post("/cooperatives/"+coop.id+"/join-requests/reject",{userId}),onSuccess:()=>{qc.invalidateQueries({queryKey:["cooperativeJoinRequests",coop?.id]});toast.success("Request rejected")},onError:(e:any)=>toast.error(e?.message||"Rejection failed")});
 const allocate=useMutation({mutationFn:()=>api.post("/cooperatives/"+coop.id+"/b2b-allocation",Object.entries(allocations).filter(([,q])=>q>0).map(([key,q])=>{const [farmerId,productId]=key.split("|");return {farmerId,productId,quantityKg:q}})),onSuccess:()=>{qc.invalidateQueries({queryKey:["cooperativeDashboard",coop?.id]});qc.invalidateQueries({queryKey:["cooperativeSupply",coop?.id]});setAllocations({});toast.success("B2B allocation recorded")},onError:(e:any)=>toast.error(e?.message||"Allocation failed")});
 const {data:discoveryData,isLoading:discoveryLoading}=useQuery({queryKey:["cooperativeDiscovery",search,location,crop],queryFn:()=>api.get("/cooperatives/discover?search="+encodeURIComponent(search)+"&location="+encodeURIComponent(location)+"&crop="+encodeURIComponent(crop)),enabled:showJoin,retry:1});
 const discovered=discoveryData?.data?.cooperatives||[];
 if(isLoading)return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin"/></div>;
 const idx=stages.findIndex(x=>x.key===stage); const next=stages[Math.min(idx+1,stages.length-1)]?.key;
 return <div className="space-y-6">
  <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium text-emerald-700">COOPERATIVE WORKFLOW</p><CardTitle className="mt-1 text-2xl">{coop?.name||"Build your farmer cooperative"}</CardTitle><CardDescription>{coop?"You are "+(coop.role==="manager"?"Manager":"Member")+" of this cooperative.": "Create or join a cooperative."}</CardDescription></div><div className="flex gap-2"><Button onClick={()=>setStage("setup")}><Plus className="mr-2 h-4 w-4"/>Create</Button><Button variant="outline" onClick={()=>setShowJoin(true)}><UserPlus className="mr-2 h-4 w-4"/>Join</Button></div></div></CardHeader></Card>
  {cooperatives.length>0&&<Card><CardContent className="flex flex-wrap items-center gap-3 p-4"><div className="flex-1 min-w-[240px]"><p className="text-xs font-semibold uppercase text-slate-500">My Cooperatives</p><select className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm" value={coop?.id||""} onChange={e=>{setSelectedCoopId(e.target.value);setStage("members")}}>{cooperatives.map((x:any)=><option key={x.id} value={x.id}>{x.name+" — "+(x.role==="manager"?"Manager":"Member")}</option>)}</select></div><Badge variant="outline">{coop?.role==="manager"?"Manager controls enabled":"Member view"}</Badge></CardContent></Card>}
  <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">{stages.map((s,i)=>{const I=s.icon;return <button key={s.key} onClick={()=>setStage(s.key)} className={"rounded-xl border p-3 text-left "+(stage===s.key?"border-emerald-500 bg-emerald-50":"bg-white")}><div className="flex items-center gap-2"><I className="h-4 w-4"/><span className="text-xs">{i+1}</span></div><p className="mt-2 text-xs font-semibold">{s.title}</p></button>})}</div>
  {stage==="setup"&&<WorkflowCard title="Create Cooperative" description="Register the cooperative."><div className="grid gap-3 md:grid-cols-2"><Field label="Name" value={form.name} onChange={v=>setForm({...form,name:v})}/><Field label="Location" value={form.location} onChange={v=>setForm({...form,location:v})}/><Field label="Crops" value={form.crops} onChange={v=>setForm({...form,crops:v})}/><Field label="Description" value={form.description} onChange={v=>setForm({...form,description:v})}/></div><Button className="mt-4" disabled={!form.name||!form.location||create.isPending} onClick={()=>create.mutate()}>{create.isPending?"Creating...":"Create Cooperative"}</Button></WorkflowCard>}
  {stage==="members"&&<WorkflowCard title="Add / Approve Farmers" description="Manage membership for the selected cooperative."><div className="grid gap-4 md:grid-cols-2"><Metric icon={Users2} label="Members" value={coop?.memberCount||0}/><Metric icon={UserPlus} label="Your role" value={coop?.role==="manager"?"Manager":"Member"}/></div>{coop?.role==="manager"?<div className="mt-4 space-y-3"><div className="rounded-xl border p-4"><p className="font-semibold">Pending requests</p>{reqLoading?<Loader2 className="my-4 h-5 w-5 animate-spin"/>:requests.length?requests.map((r:any)=><div key={r.userId} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"><span>{r.name} <span className="text-xs text-slate-500">{r.email||""}</span></span><span className="flex gap-2"><Button size="sm" onClick={()=>approve.mutate(r.userId)}>Approve</Button><Button size="sm" variant="outline" onClick={()=>reject.mutate(r.userId)}>Reject</Button></span></div>):<p className="mt-2 text-sm text-slate-500">No pending requests.</p>}</div><div className="rounded-xl border p-4"><p className="font-semibold">Invite code</p><p className="mt-1 text-sm text-slate-500">{coop?.inviteCode||"Not available"}</p><Button size="sm" variant="outline" className="mt-2" onClick={()=>{navigator.clipboard?.writeText(coop?.inviteCode||"");toast.success("Invite code copied")}}>Copy code</Button></div></div>:<Notice text="Member access is limited to cooperative contribution and operational views. Manager approval controls are hidden."/>}</WorkflowCard>}
  {stage === "production" && (
    <WorkflowCard title="Collective Production" description="Live production from all active members.">
      {dashLoading ? (
        <Loader2 className="mx-auto my-8 h-7 w-7 animate-spin" />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Metric icon={Sprout} label="Expected" value={`${Number(dash.production?.expectedKg || 0).toFixed(2)} kg`} />
            <Metric icon={CheckCircle2} label="Harvested" value={`${Number(dash.production?.harvestedKg || 0).toFixed(2)} kg`} />
            <Metric icon={ClipboardList} label="Plans" value={dash.production?.plans?.length || 0} />
          </div>
          <div className="mt-4 space-y-2">
            {(dash.production?.plans || []).map((plan: any) => (
              <div key={plan.id} className="flex flex-wrap justify-between gap-2 rounded-xl border p-3">
                <span>{plan.cropName}</span>
                <span>{plan.actualQuantityKg}/{plan.expectedQuantityKg} kg</span>
                <Badge variant="outline">{plan.status}</Badge>
              </div>
            ))}
          </div>
        </>
      )}
    </WorkflowCard>
  )}
  {stage==="inventory"&&<WorkflowCard title="Collective Inventory" description="Live combined stock and B2B allocation.">{supplyLoading?<Loader2 className="mx-auto my-8 h-7 w-7 animate-spin"/>:<><div className="grid gap-4 md:grid-cols-4"><Metric icon={Package} label="Products" value={dash.inventory?.productCount||0}/><Metric icon={Warehouse} label="Available" value={Number(dash.inventory?.availableKg||0).toFixed(2)+" kg"}/><Metric icon={Package} label="Reserved" value={Number(dash.inventory?.reservedKg||0).toFixed(2)+" kg"}/><Metric icon={ClipboardList} label="Sold" value={Number(dash.inventory?.soldKg||0).toFixed(2)+" kg"}/></div><div className="mt-4 space-y-2">{supply.map((p:any)=>{const k=p.farmerId+"|"+p.productId;return <div key={k} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><b>{p.productName}</b><p className="text-xs text-slate-500">{p.availableKg} kg · ₹{p.price}</p></div><Input className="w-28" type="number" min="0" max={p.availableKg} value={allocations[k]||""} onChange={e=>setAllocations({...allocations,[k]:Math.min(Number(e.target.value||0),Number(p.availableKg||0))})} placeholder="B2B kg"/></div>})}</div>{coop?.role==="manager"&&<Button className="mt-4" disabled={allocate.isPending||!Object.values(allocations).some(x=>x>0)} onClick={()=>allocate.mutate()}>{allocate.isPending?"Saving...":"Record B2B Allocation"}</Button>}</>}</WorkflowCard>}
  {stage==="orders"&&<WorkflowCard title="Orders / Bulk Orders" description="Live cooperative order activity.">{dashLoading?<Loader2 className="mx-auto my-8 h-7 w-7 animate-spin"/>:<div className="grid gap-4 md:grid-cols-5"><Metric icon={ShoppingCart} label="Total" value={dash.orders?.summary?.total||0}/><Metric icon={ClipboardList} label="Pending" value={dash.orders?.summary?.pending||0}/><Metric icon={Package} label="Processing" value={dash.orders?.summary?.processing||0}/><Metric icon={Truck} label="In transit" value={dash.orders?.summary?.inTransit||0}/><Metric icon={CheckCircle2} label="Completed" value={dash.orders?.summary?.completed||0}/></div>}</WorkflowCard>}
  {stage==="distribution"&&<WorkflowCard title="Distribution" description="Live delivery status for cooperative orders.">{dashLoading?<Loader2 className="mx-auto my-8 h-7 w-7 animate-spin"/>:<div className="grid gap-4 md:grid-cols-5"><Metric icon={Truck} label="Assignments" value={dash.distribution?.total||0}/><Metric icon={UserPlus} label="Assigned" value={dash.distribution?.assigned||0}/><Metric icon={Package} label="Picked up" value={dash.distribution?.pickedUp||0}/><Metric icon={Truck} label="In transit" value={dash.distribution?.inTransit||0}/><Metric icon={CheckCircle2} label="Delivered" value={dash.distribution?.delivered||0}/></div>}</WorkflowCard>}
  {stage==="earnings"&&<WorkflowCard title="Sales & Earnings" description="Live completed sales.">{dashLoading?<Loader2 className="mx-auto my-8 h-7 w-7 animate-spin"/>:<div className="grid gap-4 md:grid-cols-3"><Metric icon={Wallet} label="Gross completed sales" value={"₹"+Number(dash.earnings?.grossSales||0).toFixed(2)}/><Metric icon={ShoppingCart} label="Completed orders" value={dash.orders?.summary?.completed||0}/><Metric icon={BarChart3} label="B2B allocated" value={Number(dash.earnings?.allocatedB2BKg||0).toFixed(2)+" kg"}/></div>}</WorkflowCard>}
  {stage==="reports"&&<WorkflowCard title="Cooperative Reports" description="Live operational summary.">{dashLoading?<Loader2 className="mx-auto my-8 h-7 w-7 animate-spin"/>:<div className="grid gap-3 md:grid-cols-3">{[["Members",dash.reports?.members],["Production plans",dash.reports?.productionPlans],["Batches",dash.reports?.batches],["Products",dash.reports?.products],["Orders",dash.reports?.orders],["Deliveries",dash.reports?.deliveries]].map(([a,b])=><Metric key={String(a)} icon={BarChart3} label={String(a)} value={b||0}/>)}</div>}</WorkflowCard>}
  {stage!=="reports"&&<div className="flex justify-end"><Button variant="outline" onClick={()=>setStage(next)}>Continue to {stages.find(x=>x.key===next)?.title}<ArrowRight className="ml-2 h-4 w-4"/></Button></div>}
  {showJoin&&<Modal title="Find a Cooperative" onClose={()=>setShowJoin(false)}><p className="text-sm text-slate-500">Search by name, location or crop.</p><div className="mt-3 grid gap-2"><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cooperative name"/><Input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Location"/><Input value={crop} onChange={e=>setCrop(e.target.value)} placeholder="Crop"/></div><div className="mt-4 space-y-2">{discoveryLoading?<Loader2 className="mx-auto h-6 w-6 animate-spin"/>:discovered.map((x:any)=><div key={x.id} className="rounded-xl border p-3"><p className="font-semibold">{x.name}</p><p className="text-xs text-slate-500"><MapPin className="mr-1 inline h-3 w-3"/>{x.location} · {x.memberCount} members</p>{x.joinStatus==="available"&&<Button className="mt-2 w-full" onClick={()=>join.mutate(x.id)}>Request to Join</Button>}<Badge variant="outline">{x.joinStatus}</Badge></div>)}</div><Button variant="outline" className="mt-3 w-full" onClick={()=>{setShowJoin(false);setShowInvite(true)}}>Have invite code?</Button></Modal>}
  {showInvite&&<Modal title="Join with Invite Code" onClose={()=>setShowInvite(false)}><Input value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())} placeholder="AGR-AB12CD34"/><Button className="mt-3 w-full" disabled={!inviteCode.trim()} onClick={()=>join.mutate(undefined)}>Request to Join</Button></Modal>}
 </div>
}

function WorkflowCard({title,description,children}:{title:string;description:string;children:ReactNode}){return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>}
function Field({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <div><label className="text-xs font-medium text-slate-600">{label}</label><Input value={value} onChange={e=>onChange(e.target.value)} /></div>}
function Metric({icon:Icon,label,value}:{icon:any;label:string;value:any}){return <div className="rounded-xl border bg-slate-50 p-4"><Icon className="h-5 w-5 text-emerald-600"/><p className="mt-2 text-xl font-bold">{value}</p><p className="text-xs text-slate-500">{label}</p></div>}
function Notice({text}:{text:string}){return <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{text}</div>}
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><Card className="w-full max-w-md"><CardHeader><div className="flex items-center justify-between"><CardTitle>{title}</CardTitle><Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4"/></Button></div></CardHeader><CardContent>{children}</CardContent></Card></div>}