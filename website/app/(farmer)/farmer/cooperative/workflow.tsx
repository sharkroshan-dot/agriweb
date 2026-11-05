"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users2, Plus, Loader2, CheckCircle2, MapPin, Sprout, Package, ShoppingCart, Truck, Wallet, BarChart3, UserPlus, ClipboardList, Warehouse, ArrowRight, X, QrCode, MessageCircle, LayoutDashboard } from "lucide-react";
import CooperativeChat from "./chat";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

type Stage = "overview" | "chat" | "setup" | "members" | "production" | "inventory" | "orders" | "distribution" | "earnings" | "reports";
const stages: {key:Stage;title:string;icon:any}[] = [
  {key:"setup",title:"Create Cooperative",icon:Users2},{key:"members",title:"Add / Approve Farmers",icon:UserPlus},{key:"production",title:"Collective Production",icon:Sprout},{key:"inventory",title:"Collective Inventory",icon:Warehouse},{key:"orders",title:"Orders / Bulk Orders",icon:ShoppingCart},{key:"distribution",title:"Distribution",icon:Truck},{key:"earnings",title:"Sales & Earnings",icon:Wallet},{key:"reports",title:"Cooperative Reports",icon:BarChart3}
];

export default function FarmerCooperativePage(){
 const qc=useQueryClient();
 const searchParams=useSearchParams();
 const [stage,setStage]=useState<Stage>("overview");
 const [selectedCoopId,setSelectedCoopId]=useState("");
 const [showCreate,setShowCreate]=useState(false); const [showJoin,setShowJoin]=useState(false); const [showInvite,setShowInvite]=useState(false); const [showQr,setShowQr]=useState(false); const [showQrJoin,setShowQrJoin]=useState(false); const [qrInviteCode,setQrInviteCode]=useState("");
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
    const code=searchParams.get("invite");
    if(code && code !== qrInviteCode){ const normalized=code.toUpperCase(); setQrInviteCode(normalized); setInviteCode(normalized); setShowQrJoin(true); }
  }, [searchParams, qrInviteCode]);
  const {data:qrInviteData,isLoading:qrInviteLoading}=useQuery({queryKey:["cooperativeQrInvite",qrInviteCode],queryFn:()=>api.get("/cooperatives/invite/"+encodeURIComponent(qrInviteCode)),enabled:Boolean(qrInviteCode)&&showQrJoin,retry:1});
  const qrCooperative=qrInviteData?.data?.data;
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
    enabled: Boolean(coop?.id) && (stage === "inventory" || stage === "overview"),
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
 const [farmerSearch,setFarmerSearch]=useState("");
 const {data:farmerSearchData,isLoading:farmerSearchLoading}=useQuery({queryKey:["cooperativeFarmerSearch",farmerSearch],queryFn:()=>api.get("/cooperatives/farmers/search?search="+encodeURIComponent(farmerSearch)),enabled:showInvite&&coop?.role==="manager",retry:1});
 const availableFarmers=farmerSearchData?.data?.farmers||[];
 const invite=useMutation({mutationFn:(farmerId:string)=>api.post("/cooperatives/"+coop.id+"/invitations",{farmerId}),onSuccess:()=>{setFarmerSearch("");setShowInvite(false);toast.success("Invitation sent to the farmer")},onError:(e:any)=>toast.error(e?.message||"Could not send invitation")});
 const allocate=useMutation({mutationFn:()=>api.post("/cooperatives/"+coop.id+"/b2b-allocation",Object.entries(allocations).filter(([,q])=>q>0).map(([key,q])=>{const [farmerId,productId]=key.split("|");return {farmerId,productId,quantityKg:q}})),onSuccess:()=>{qc.invalidateQueries({queryKey:["cooperativeDashboard",coop?.id]});qc.invalidateQueries({queryKey:["cooperativeSupply",coop?.id]});setAllocations({});toast.success("B2B allocation recorded")},onError:(e:any)=>toast.error(e?.message||"Allocation failed")});
 const {data:discoveryData,isLoading:discoveryLoading}=useQuery({queryKey:["cooperativeDiscovery",search,location,crop],queryFn:()=>api.get("/cooperatives/discover?search="+encodeURIComponent(search)+"&location="+encodeURIComponent(location)+"&crop="+encodeURIComponent(crop)),enabled:showJoin,retry:1});
 const discovered=discoveryData?.data?.cooperatives||[];
 if(isLoading)return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin"/></div>;
 const idx=stages.findIndex(x=>x.key===stage); const next=stages[Math.min(idx+1,stages.length-1)]?.key;
 return <div className="space-y-6">
  <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm"><div className="bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-700 px-5 py-6 text-white sm:px-7"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">AgriConnect · Farmer network</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">{coop?.name||"Your Cooperative Workspace"}</h1><p className="mt-1 text-sm text-emerald-50">{coop ? "Manage your members, supply, orders and conversations in one place." : "Create or join a cooperative to work together."}</p></div><div className="flex flex-wrap gap-2"><Button className="bg-white text-emerald-800 hover:bg-emerald-50" onClick={()=>setStage("setup")}><Plus className="mr-2 h-4 w-4"/>Create cooperative</Button><Button variant="outline" className="border-white/50 bg-white/10 text-white hover:bg-white/20" onClick={()=>setShowJoin(true)}><UserPlus className="mr-2 h-4 w-4"/>Find a cooperative</Button></div></div><div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-emerald-50"><span className="rounded-full bg-white/15 px-3 py-1">{coop?.role==="manager"?"Cooperative manager":"Cooperative member"}</span><span className="rounded-full bg-white/15 px-3 py-1">{coop?.memberCount||0} members</span><span className="rounded-full bg-white/15 px-3 py-1">Private workspace</span></div></div></section>
  {cooperatives.length>0&&<Card><CardContent className="flex flex-wrap items-center gap-3 p-4"><div className="flex-1 min-w-[240px]"><p className="text-xs font-semibold uppercase text-slate-500">My Cooperatives</p><select className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm" value={coop?.id||""} onChange={e=>{setSelectedCoopId(e.target.value);setStage("members")}}>{cooperatives.map((x:any)=><option key={x.id} value={x.id}>{x.name+" — "+(x.role==="manager"?"Manager":"Member")}</option>)}</select></div><Badge variant="outline">{coop?.role==="manager"?"Manager controls enabled":"Member view"}</Badge></CardContent></Card>}
  <nav className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">{[{key:"overview",title:"Overview",icon:LayoutDashboard},{key:"chat",title:"Group chat",icon:MessageCircle},...stages].map((s:any)=>{const I=s.icon;return <button key={s.key} onClick={()=>setStage(s.key)} className={"flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition "+(stage===s.key?"bg-emerald-700 text-white shadow-sm":"text-slate-600 hover:bg-emerald-50 hover:text-emerald-800")}><I className="h-4 w-4"/>{s.key==="setup"?"Create":s.key==="members"?"Members":s.key==="production"?"Production":s.key==="inventory"?"Inventory":s.key==="orders"?"Orders":s.key==="distribution"?"Distribution":s.key==="earnings"?"Earnings":s.key==="reports"?"Reports":s.title}</button>})}</nav>
  {stage==="overview"&&<div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_350px]">
    <div className="min-w-0 space-y-4">
      {dashLoading?<Card><CardContent className="py-12"><Loader2 className="mx-auto h-7 w-7 animate-spin"/></CardContent></Card>:<>
        <div className="grid gap-3 grid-cols-2 xl:grid-cols-3">
          <Metric icon={Users2} label="Active members" value={coop?.memberCount||0}/>
          <Metric icon={Sprout} label="Crops" value={coop?.crops?.length||dash.production?.plans?.length||0}/>
          <Metric icon={Warehouse} label="Available stock" value={Number(dash.inventory?.availableKg||0).toLocaleString()+" kg"}/>
          <Metric icon={ShoppingCart} label="Active orders" value={dash.orders?.summary?.total||0}/>
          <Metric icon={Wallet} label="Total sales" value={"₹"+Number(dash.earnings?.grossSales||0).toLocaleString("en-IN")}/>
          <Metric icon={ClipboardList} label="Supply contracts" value={dash.contracts?.total||dash.supplyContracts?.total||0}/>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.9fr]">
          <Card className="min-w-0"><CardHeader className="pb-3"><div className="flex items-center justify-between gap-2"><div><CardTitle className="flex items-center gap-2 text-base"><Sprout className="h-5 w-5 text-emerald-700"/>Production plan</CardTitle><CardDescription>Current cooperative harvest progress</CardDescription></div><Button size="sm" variant="ghost" onClick={()=>setStage("production")}>View details <ArrowRight className="ml-1 h-4 w-4"/></Button></div></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className="pb-2 font-medium">Crop</th><th className="pb-2 font-medium">Planned</th><th className="pb-2 font-medium">Harvested</th><th className="pb-2 font-medium">Progress</th></tr></thead><tbody>{(dash.production?.plans||[]).slice(0,5).map((p:any)=><tr key={p.id} className="border-b last:border-0"><td className="py-3 font-medium">{p.cropName||p.productName||"Crop"}</td><td className="py-3">{Number(p.expectedQuantityKg||0).toLocaleString()} kg</td><td className="py-3">{Number(p.actualQuantityKg||0).toLocaleString()} kg</td><td className="py-3"><div className="flex items-center gap-2"><div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600" style={{width:(Number(p.expectedQuantityKg)>0?Math.min(100,Number(p.actualQuantityKg||0)/Number(p.expectedQuantityKg)*100):0)+"%"}}/></div><span className="text-xs text-slate-500">{Number(p.expectedQuantityKg)>0?Math.round(Number(p.actualQuantityKg||0)/Number(p.expectedQuantityKg)*100):0}%</span></div></td></tr>)}</tbody></table>{!(dash.production?.plans||[]).length&&<p className="py-6 text-center text-sm text-slate-500">No production plans have been added yet.</p>}</div></CardContent></Card>
          <Card className="min-w-0"><CardHeader className="pb-3"><div className="flex items-center justify-between gap-2"><div><CardTitle className="flex items-center gap-2 text-base"><Warehouse className="h-5 w-5 text-emerald-700"/>Collective inventory</CardTitle><CardDescription>Available member stock</CardDescription></div><Button size="sm" variant="ghost" onClick={()=>setStage("inventory")}>View inventory <ArrowRight className="ml-1 h-4 w-4"/></Button></div></CardHeader><CardContent><div className="space-y-2">{supply.slice(0,5).map((p:any)=><div key={p.farmerId+"|"+p.productId} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50/70 px-3 py-2.5"><span className="min-w-0 truncate text-sm font-medium">{p.productName||"Product"}</span><span className="shrink-0 text-sm font-semibold">{Number(p.availableKg||0).toLocaleString()} kg</span></div>)}{!supply.length&&<p className="py-6 text-center text-sm text-slate-500">No available inventory to display.</p>}</div></CardContent></Card>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.9fr]">
          <Card><CardHeader className="pb-3"><div className="flex items-center justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-5 w-5 text-emerald-700"/>Orders & fulfillment</CardTitle><CardDescription>Cooperative order progress</CardDescription></div><Button size="sm" variant="ghost" onClick={()=>setStage("orders")}>View orders <ArrowRight className="ml-1 h-4 w-4"/></Button></div></CardHeader><CardContent><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><StatusTile label="Confirmed" value={dash.orders?.summary?.confirmed||0} tone="violet"/><StatusTile label="Preparing" value={dash.orders?.summary?.preparing||dash.orders?.summary?.processing||0} tone="amber"/><StatusTile label="In transit" value={dash.orders?.summary?.inTransit||0} tone="blue"/><StatusTile label="Delivered" value={dash.orders?.summary?.completed||0} tone="green"/></div></CardContent></Card>
          <Card><CardHeader className="pb-3"><div className="flex items-center justify-between"><div><CardTitle className="flex items-center gap-2 text-base"><Wallet className="h-5 w-5 text-emerald-700"/>Sales & earnings</CardTitle><CardDescription>Completed cooperative sales</CardDescription></div><Button size="sm" variant="ghost" onClick={()=>setStage("earnings")}>View earnings <ArrowRight className="ml-1 h-4 w-4"/></Button></div></CardHeader><CardContent><div className="grid grid-cols-2 gap-3"><div><p className="text-xl font-bold">₹{Number(dash.earnings?.grossSales||0).toLocaleString("en-IN")}</p><p className="text-xs text-slate-500">Gross sales</p></div><div><p className="text-xl font-bold">₹{Number(dash.earnings?.totalEarnings||0).toLocaleString("en-IN")}</p><p className="text-xs text-slate-500">Total earnings</p></div></div></CardContent></Card>
        </div>
        <Card><CardHeader className="pb-3"><CardTitle className="text-base">Quick actions</CardTitle><CardDescription>Common cooperative tasks</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4"><QuickAction icon={ClipboardList} label="Create supply plan" onClick={()=>setStage("production")}/><QuickAction icon={Sprout} label="Plan production" onClick={()=>setStage("production")}/><QuickAction icon={Package} label="Record inventory" onClick={()=>setStage("inventory")}/><QuickAction icon={Truck} label="Manage pickup" onClick={()=>setStage("distribution")}/></CardContent></Card>
      </>}
    </div>
    <div className="min-w-0 2xl:sticky 2xl:top-4">{coop?.id?<CooperativeChat cooperativeId={coop.id} cooperativeName={coop.name||"Cooperative"} memberCount={coop.memberCount||0}/>:<Card><CardContent className="py-12 text-center"><MessageCircle className="mx-auto h-9 w-9 text-emerald-700"/><p className="mt-3 font-semibold">Cooperative chat</p><p className="mt-1 text-sm text-slate-500">Create or join a cooperative to start messaging.</p></CardContent></Card>}</div>
  </div>}
  {stage==="chat"&&coop?.id&&<CooperativeChat cooperativeId={coop.id} cooperativeName={coop.name||"Cooperative"} memberCount={coop.memberCount||0}/>}
  {stage==="chat"&&!coop?.id&&<WorkflowCard title="Cooperative group chat" description="Create or join a cooperative to start a private group conversation."><Notice text="You must be an active cooperative member to access its group chat."/></WorkflowCard>}

  {stage==="setup"&&<WorkflowCard title="Create Cooperative" description="Register the cooperative."><div className="grid gap-3 md:grid-cols-2"><Field label="Name" value={form.name} onChange={v=>setForm({...form,name:v})}/><Field label="Location" value={form.location} onChange={v=>setForm({...form,location:v})}/><Field label="Crops" value={form.crops} onChange={v=>setForm({...form,crops:v})}/><Field label="Description" value={form.description} onChange={v=>setForm({...form,description:v})}/></div><Button className="mt-4" disabled={!form.name||!form.location||create.isPending} onClick={()=>create.mutate()}>{create.isPending?"Creating...":"Create Cooperative"}</Button></WorkflowCard>}
  {stage==="members"&&<WorkflowCard title="Add / Approve Farmers" description="Manage membership for the selected cooperative."><div className="grid gap-4 md:grid-cols-2"><Metric icon={Users2} label="Members" value={coop?.memberCount||0}/><Metric icon={UserPlus} label="Your role" value={coop?.role==="manager"?"Manager":"Member"}/></div>{coop?.role==="manager"?<div className="mt-4 space-y-3"><div className="rounded-xl border p-4"><p className="font-semibold">Pending requests</p>{reqLoading?<Loader2 className="my-4 h-5 w-5 animate-spin"/>:requests.length?requests.map((r:any)=><div key={r.userId} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3"><span>{r.name} <span className="text-xs text-slate-500">{r.email||""}</span></span><span className="flex gap-2"><Button size="sm" onClick={()=>approve.mutate(r.userId)}>Approve</Button><Button size="sm" variant="outline" onClick={()=>reject.mutate(r.userId)}>Reject</Button></span></div>):<p className="mt-2 text-sm text-slate-500">No pending requests.</p>}</div><div className="rounded-xl border p-4"><p className="font-semibold">Invite Farmer</p><p className="mt-1 text-sm text-slate-500">Select another farmer and send the invitation directly in AgriConnect.</p><Button size="sm" className="mt-2" onClick={()=>setShowInvite(true)}><UserPlus className="mr-2 h-4 w-4"/>Invite Farmer</Button><Button size="sm" variant="outline" className="ml-2 mt-2" onClick={()=>setShowQr(true)}><QrCode className="mr-2 h-4 w-4"/>Show QR</Button></div></div>:<Notice text="Member access is limited to cooperative contribution and operational views. Manager approval controls are hidden."/>}</WorkflowCard>}
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
  {stage!=="reports"&&stage!=="chat"&&stage!=="overview"&&<div className="flex justify-end"><Button variant="outline" onClick={()=>setStage(next)}>Continue to {stages.find(x=>x.key===next)?.title}<ArrowRight className="ml-2 h-4 w-4"/></Button></div>}
  {showJoin&&<Modal title="Find a Cooperative" onClose={()=>setShowJoin(false)}><p className="text-sm text-slate-500">Search by name, location or crop.</p><div className="mt-3 grid gap-2"><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cooperative name"/><Input value={location} onChange={e=>setLocation(e.target.value)} placeholder="Location"/><Input value={crop} onChange={e=>setCrop(e.target.value)} placeholder="Crop"/></div><div className="mt-4 space-y-2">{discoveryLoading?<Loader2 className="mx-auto h-6 w-6 animate-spin"/>:discovered.map((x:any)=><div key={x.id} className="rounded-xl border p-3"><p className="font-semibold">{x.name}</p><p className="text-xs text-slate-500"><MapPin className="mr-1 inline h-3 w-3"/>{x.location} · {x.memberCount} members</p>{x.joinStatus==="available"&&<Button className="mt-2 w-full" onClick={()=>join.mutate(x.id)}>Request to Join</Button>}<Badge variant="outline">{x.joinStatus}</Badge></div>)}</div><Button variant="outline" className="mt-3 w-full" onClick={()=>{setShowJoin(false);setShowInvite(true)}}>Have invite code?</Button></Modal>}
  {showInvite&&<Modal title="Invite Farmer" onClose={()=>{setShowInvite(false);setFarmerSearch("")}}><p className="text-sm text-slate-500">Search for the farmer by name, phone, or email.</p><Input className="mt-3" value={farmerSearch} onChange={e=>setFarmerSearch(e.target.value)} placeholder="Search farmer"/><div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{farmerSearchLoading?<Loader2 className="mx-auto my-5 h-6 w-6 animate-spin"/>:availableFarmers.length?availableFarmers.map((farmer:any)=><div key={farmer.id} className="flex items-center justify-between rounded-xl border p-3"><div><p className="font-medium">{farmer.name}</p><p className="text-xs text-slate-500">{farmer.phone||farmer.email||"Farmer"}</p></div><Button size="sm" disabled={invite.isPending} onClick={()=>invite.mutate(farmer.id)}>Send Invitation</Button></div>):<p className="py-5 text-center text-sm text-slate-500">No farmers found.</p>}</div></Modal>}
  <InvitationInbox />
  {showQrJoin&&<Modal title="Cooperative Invitation" onClose={()=>setShowQrJoin(false)}>{qrInviteLoading?<Loader2 className="mx-auto my-8 h-7 w-7 animate-spin"/>:qrCooperative?<div className="space-y-4"><div className="rounded-xl border p-4"><p className="font-semibold">{qrCooperative.name}</p><p className="text-sm text-slate-500">{qrCooperative.location} · {qrCooperative.memberCount} members</p><p className="mt-2 text-sm">{qrCooperative.description||"Join this farmer cooperative through AgriConnect."}</p></div><Button className="w-full" disabled={join.isPending||qrCooperative.status!=="available"} onClick={()=>join.mutate(undefined)}>{join.isPending?"Sending...":qrCooperative.status==="member"?"Already a member":qrCooperative.status==="manager"?"You manage this cooperative":"Join Cooperative"}</Button></div>:<p className="text-sm text-red-600">This cooperative invitation is invalid or unavailable.</p>}</Modal>}
  {showQr&&<Modal title="Join Cooperative with QR" onClose={()=>setShowQr(false)}><div className="flex flex-col items-center text-center"><div className="rounded-2xl border bg-white p-4"><QRCodeSVG value={typeof window!=="undefined"?window.location.origin+"/farmer/cooperative?invite="+encodeURIComponent(coop?.inviteCode||""):""} size={240} includeMargin /></div><p className="mt-4 font-semibold">{coop?.name}</p><p className="mt-1 text-sm text-slate-500">Another farmer can scan this QR code to open the cooperative invitation.</p></div></Modal>}
  {showInvite&&false&&<Modal title="Join with Invite Code" onClose={()=>setShowInvite(false)}><Input value={inviteCode} onChange={e=>setInviteCode(e.target.value.toUpperCase())} placeholder="AGR-AB12CD34"/><Button className="mt-3 w-full" disabled={!inviteCode.trim()} onClick={()=>join.mutate(undefined)}>Request to Join</Button></Modal>}
 </div>
}

function StatusTile({label,value,tone}:{label:string;value:any;tone:"violet"|"amber"|"blue"|"green"}){const styles={violet:"bg-violet-50 text-violet-800",amber:"bg-amber-50 text-amber-800",blue:"bg-sky-50 text-sky-800",green:"bg-emerald-50 text-emerald-800"};return <div className={"rounded-xl px-3 py-3 "+styles[tone]}><p className="text-xl font-bold">{value}</p><p className="text-xs font-medium">{label}</p></div>}
function QuickAction({icon:Icon,label,onClick}:{icon:any;label:string;onClick:()=>void}){return <button onClick={onClick} className="flex min-h-16 items-center gap-2 rounded-xl border border-slate-200 p-3 text-left text-sm font-medium transition hover:border-emerald-300 hover:bg-emerald-50"><Icon className="h-5 w-5 shrink-0 text-emerald-700"/><span>{label}</span></button>}

function WorkflowCard({title,description,children}:{title:string;description:string;children:ReactNode}){return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>}
function Field({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <div><label className="text-xs font-medium text-slate-600">{label}</label><Input value={value} onChange={e=>onChange(e.target.value)} /></div>}
function Metric({icon:Icon,label,value}:{icon:any;label:string;value:any}){return <div className="rounded-xl border bg-slate-50 p-4"><Icon className="h-5 w-5 text-emerald-600"/><p className="mt-2 text-xl font-bold">{value}</p><p className="text-xs text-slate-500">{label}</p></div>}
function Notice({text}:{text:string}){return <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{text}</div>}
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><Card className="w-full max-w-md"><CardHeader><div className="flex items-center justify-between"><CardTitle>{title}</CardTitle><Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4"/></Button></div></CardHeader><CardContent>{children}</CardContent></Card></div>}

function InvitationInbox(){
 const qc=useQueryClient();
 const {data,isLoading}=useQuery({queryKey:["cooperativeInvitations"],queryFn:()=>api.get("/cooperatives/invitations/mine"),refetchInterval:30000});
 const invitations=data?.data?.invitations||[];
 const accept=useMutation({mutationFn:(id:string)=>api.post("/cooperatives/invitations/"+id+"/accept"),onSuccess:()=>{qc.invalidateQueries({queryKey:["cooperativeInvitations"]});qc.invalidateQueries({queryKey:["farmerCooperatives"]});toast.success("Cooperative invitation accepted")},onError:(e:any)=>toast.error(e?.message||"Could not accept invitation")});
 const reject=useMutation({mutationFn:(id:string)=>api.post("/cooperatives/invitations/"+id+"/reject"),onSuccess:()=>{qc.invalidateQueries({queryKey:["cooperativeInvitations"]});toast.success("Cooperative invitation rejected")},onError:(e:any)=>toast.error(e?.message||"Could not reject invitation")});
 if(isLoading || !invitations.length)return null;
 return <Card className="border-emerald-200 bg-emerald-50/40"><CardHeader><CardTitle className="text-base">Cooperative Invitations</CardTitle><CardDescription>Accept or reject direct farmer invitations.</CardDescription></CardHeader><CardContent className="space-y-2">{invitations.map((x:any)=><div key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3"><div><p className="font-semibold">{x.cooperativeName}</p><p className="text-xs text-slate-500">{x.location}</p></div><div className="flex gap-2"><Button size="sm" disabled={accept.isPending||reject.isPending} onClick={()=>accept.mutate(x.id)}>Accept</Button><Button size="sm" variant="outline" disabled={accept.isPending||reject.isPending} onClick={()=>reject.mutate(x.id)}>Reject</Button></div></div>)}</CardContent></Card>;
}
