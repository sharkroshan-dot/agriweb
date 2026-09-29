"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users2, Plus, Loader2, CheckCircle2, MapPin, Phone, Mail,
  Sprout, Package, ShoppingCart, Truck, Wallet, BarChart3,
  UserPlus, ClipboardList, Warehouse, ArrowRight, X
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

type Stage = "setup" | "members" | "production" | "inventory" | "orders" | "distribution" | "earnings" | "reports";

const stages: { key: Stage; title: string; icon: any }[] = [
  { key: "setup", title: "Create Cooperative", icon: Users2 },
  { key: "members", title: "Add / Approve Farmers", icon: UserPlus },
  { key: "production", title: "Collective Production", icon: Sprout },
  { key: "inventory", title: "Collective Inventory", icon: Warehouse },
  { key: "orders", title: "Orders / Bulk Orders", icon: ShoppingCart },
  { key: "distribution", title: "Distribution", icon: Truck },
  { key: "earnings", title: "Sales & Earnings", icon: Wallet },
  { key: "reports", title: "Cooperative Reports", icon: BarChart3 },
];

export default function FarmerCooperativePage() {
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>("setup");
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [coopSearch, setCoopSearch] = useState("");
  const [coopLocation, setCoopLocation] = useState("");
  const [coopCrop, setCoopCrop] = useState("");
  const [selectedCoopId, setSelectedCoopId] = useState<string>("");
  const [form, setForm] = useState({
    name: "", registrationDetails: "", location: "", contactName: "",
    contactPhone: "", contactEmail: "", description: "", crops: ""
  });

  const { data, isLoading } = useQuery({
    queryKey: ["farmerCooperatives"],
    queryFn: () => api.get("/cooperatives/me"),
    retry: 1,
  });

  const cooperatives = data?.data?.cooperatives || [];
  useEffect(() => {
    if (cooperatives.length && !cooperatives.some((item: any) => item.id === selectedCoopId)) {
      setSelectedCoopId(cooperatives[0].id);
    }
  }, [cooperatives, selectedCoopId]);
  const coop = cooperatives.find((item: any) => item.id === selectedCoopId) || cooperatives[0];

  const { data: discoveryData, isLoading: discoveryLoading } = useQuery({
    queryKey: ["cooperativeDiscovery", coopSearch, coopLocation, coopCrop],
    queryFn: () => api.get(`/cooperatives/discover?search=${encodeURIComponent(coopSearch)}&location=${encodeURIComponent(coopLocation)}&crop=${encodeURIComponent(coopCrop)}`),
    enabled: showJoin,
    retry: 1,
  });
  const discoveredCooperatives = discoveryData?.data?.cooperatives || [];

  const { data: requestData, isLoading: requestsLoading } = useQuery({
    queryKey: ["cooperativeJoinRequests", coop?.id],
    queryFn: () => api.get(`/cooperatives/${coop.id}/join-requests`),
    enabled: Boolean(coop?.id && coop?.role === "manager" && stage === "members"),
    retry: 1,
  });
  const joinRequests = (requestData?.data?.requests || []).filter((item: any) => item.status === "pending");

  const approveMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/cooperatives/${coop.id}/join-requests/approve`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["farmerCooperatives"] });
      qc.invalidateQueries({ queryKey: ["cooperativeJoinRequests", coop?.id] });
      toast.success("Farmer approved and added to the cooperative");
    },
    onError: (e: any) => toast.error(e?.message || "Could not approve farmer"),
  });

  const rejectMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/cooperatives/${coop.id}/join-requests/reject`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cooperativeJoinRequests", coop?.id] });
      toast.success("Join request rejected");
    },
    onError: (e: any) => toast.error(e?.message || "Could not reject request"),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/cooperatives", {
      name: form.name,
      location: form.location,
      description: [
        form.registrationDetails && `Registration: ${form.registrationDetails}`,
        form.contactName && `Contact: ${form.contactName}`,
        form.contactPhone && `Phone: ${form.contactPhone}`,
        form.contactEmail && `Email: ${form.contactEmail}`,
        form.description
      ].filter(Boolean).join(" | "),
      crops: form.crops.split(",").map(x => x.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["farmerCooperatives"] });
      setShowCreate(false);
      setForm({ name:"", registrationDetails:"", location:"", contactName:"", contactPhone:"", contactEmail:"", description:"", crops:"" });
      toast.success("Cooperative created successfully");
      setStage("members");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to create cooperative"),
  });

  const joinMutation = useMutation({
    mutationFn: (cooperativeId?: string) => cooperativeId
      ? api.post(`/cooperatives/${cooperativeId}/join-request`, {})
      : api.post("/cooperatives/join", { inviteCode: inviteCode.trim().toUpperCase() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["farmerCooperatives"] });
      setShowJoin(false); setInviteCode(""); setStage("members");
      qc.invalidateQueries({ queryKey: ["cooperativeDiscovery"] });
      toast.success("Join request sent. Waiting for manager approval.");

    },
    onError: (e: any) => toast.error(e?.message || "Could not send join request"),
  });

  const currentIndex = Math.max(0, stages.findIndex(x => x.key === stage));
  const next = stages[Math.min(currentIndex + 1, stages.length - 1)]?.key;

  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700">COOPERATIVE WORKFLOW</p>
              <CardTitle className="mt-1 text-2xl">{coop?.name || "Build your farmer cooperative"}</CardTitle>
              <CardDescription className="mt-1">
                {coop ? `You are a ${coop.role === "manager" ? "manager" : "member"} of this cooperative. Your other cooperative memberships remain separate.` : "Create a cooperative or join an existing one."}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setShowCreate(true)}><Plus className="mr-2 h-4 w-4" />Create Cooperative</Button>
              <Button variant="outline" onClick={() => setShowJoin(true)}><UserPlus className="mr-2 h-4 w-4" />Join</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {cooperatives.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-[220px] flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">My Cooperatives</p>
              <select
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                value={coop?.id || ""}
                onChange={e => { setSelectedCoopId(e.target.value); setStage("members"); }}
              >
                {cooperatives.map((item: any) => (
                  <option key={item.id} value={item.id}>{item.name} — {item.role === "manager" ? "Manager" : "Member"}</option>
                ))}
              </select>
            </div>
            <Badge variant="outline">{coop?.role === "manager" ? "Manager controls enabled" : "Member view"}</Badge>
            <p className="max-w-xl text-xs text-slate-500">
              You can manage one cooperative and also belong to another. Switching here changes which cooperative's workflow and permissions you are viewing.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
        {stages.map((s, i) => {
          const Icon = s.icon;
          const active = s.key === stage;
          return (
            <button key={s.key} onClick={() => setStage(s.key)}
              className={`rounded-xl border p-3 text-left transition ${active ? "border-emerald-500 bg-emerald-50 shadow-sm" : "bg-white hover:border-emerald-300"}`}>
              <div className="flex items-center gap-2">
                <div className={`rounded-lg p-2 ${active ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}><Icon className="h-4 w-4" /></div>
                <span className="text-xs font-semibold">{i + 1}</span>
              </div>
              <p className="mt-2 text-xs font-semibold leading-4">{s.title}</p>
            </button>
          );
        })}
      </div>

      {stage === "setup" && (
        <WorkflowCard title="Create Cooperative" description="Register the cooperative with the information needed for members, buyers and operations.">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Cooperative name *" value={form.name} onChange={v => setForm({...form,name:v})} placeholder="Coimbatore Vegetable Farmers Cooperative" />
            <Field label="Registration / details" value={form.registrationDetails} onChange={v => setForm({...form,registrationDetails:v})} placeholder="Registration number or legal details" />
            <Field label="Location *" value={form.location} onChange={v => setForm({...form,location:v})} placeholder="District, State" />
            <Field label="Contact person" value={form.contactName} onChange={v => setForm({...form,contactName:v})} placeholder="Manager / contact person" />
            <Field label="Contact phone" value={form.contactPhone} onChange={v => setForm({...form,contactPhone:v})} placeholder="+91..." />
            <Field label="Contact email" value={form.contactEmail} onChange={v => setForm({...form,contactEmail:v})} placeholder="cooperative@example.com" />
            <Field label="Main crops" value={form.crops} onChange={v => setForm({...form,crops:v})} placeholder="Tomato, Onion, Potato" />
            <Field label="Description" value={form.description} onChange={v => setForm({...form,description:v})} placeholder="Purpose and operating details" />
          </div>
          <div className="mt-5 flex justify-end">
            <Button disabled={!form.name || !form.location || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create Cooperative
            </Button>
          </div>
        </WorkflowCard>
      )}

      {stage === "members" && (
        <WorkflowCard title="Add / Approve Farmers" description="Build the cooperative membership before collective operations begin.">
          <div className="grid gap-4 md:grid-cols-2">
            <Metric icon={Users2} label="Cooperative members" value={coop?.memberCount ?? 0} />
            <Metric icon={UserPlus} label="Your role" value={coop?.role === "manager" ? "Manager" : "Member"} />
          </div>

          {coop?.role === "manager" ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border p-4">
                <p className="font-semibold">Pending Join Requests</p>
                <p className="mt-1 text-sm text-slate-500">Farmers can discover this cooperative and request membership. Approve them here.</p>
                {requestsLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : joinRequests.length ? (
                  <div className="mt-3 space-y-2">
                    {joinRequests.map((request: any) => (
                      <div key={request.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50 p-3">
                        <div>
                          <p className="font-medium">{request.name}</p>
                          <p className="text-xs text-slate-500">{request.email || request.phone || "Farmer"} · Pending request</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(request.userId)}>Approve</Button>
                          <Button size="sm" variant="outline" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate(request.userId)}>Reject</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">No pending requests.</p>}
              </div>

              <div className="rounded-xl border p-4">
                <p className="font-semibold">Cooperative Members</p>
                <p className="mt-1 text-sm text-slate-500">Share the private invite code when you already know a farmer. Discovery-based joining is also supported.</p>
                {coop?.inviteCode && <div className="mt-3 flex flex-wrap items-center gap-2"><Badge variant="outline">{coop.inviteCode}</Badge><Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(coop.inviteCode); toast.success("Invite code copied"); }}>Copy code</Button><Button size="sm" variant="outline" onClick={() => setShowInvite(true)}>Share code</Button></div>}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-xl border bg-slate-50 p-4">
              <p className="font-semibold">You are a cooperative member</p>
              <p className="mt-1 text-sm text-slate-500">You can contribute production and inventory to this cooperative. Manager-only approval, allocation and membership controls are hidden.</p>
            </div>
          )}
        </WorkflowCard>
      )}

      {stage === "production" && (
        <WorkflowCard title="Collective Production" description="Bring member crop plans and harvest schedules together so the cooperative can see expected supply.">
          <div className="grid gap-4 md:grid-cols-3">
            <Metric icon={Sprout} label="Crops" value={(coop?.crops || []).length} />
            <Metric icon={ClipboardList} label="Expected quantity" value="From member harvest plans" />
            <Metric icon={CheckCircle2} label="Harvest schedules" value="Track by member" />
          </div>
          <Notice text="Production is coordinated from individual farmer harvest plans. The cooperative view combines member supply without replacing each farmer's traceability." />
        </WorkflowCard>
      )}

      {stage === "inventory" && (
        <WorkflowCard title="Collective Inventory" description="View the combined available stock contributed by active cooperative members.">
          <div className="grid gap-4 md:grid-cols-4">
            <Metric icon={Package} label="Products" value={coop?.productCount ?? 0} />
            <Metric icon={Warehouse} label="Available" value={`${coop?.availableKg ?? coop?.combinedStock ?? 0} kg`} />
            <Metric icon={Package} label="Your contribution" value={`${coop?.myContributionKg ?? 0} kg`} />
            <Metric icon={ClipboardList} label="Stock status" value="Live" />
          </div>
        </WorkflowCard>
      )}

      {stage === "orders" && (
        <WorkflowCard title="Orders / Bulk Orders" description="Use the combined cooperative supply for marketplace and B2B demand.">
          <div className="grid gap-4 md:grid-cols-2">
            <ActionBox icon={ShoppingCart} title="Marketplace orders" text="Cooperative-eligible member products can fulfil customer marketplace demand." />
            <ActionBox icon={BriefcaseIcon} title="B2B orders" text="Managers can allocate member supply to larger business requirements." />
          </div>
        </WorkflowCard>
      )}

      {stage === "distribution" && (
        <WorkflowCard title="Distribution" description="Move confirmed cooperative orders through preparation, dispatch and delivery.">
          <div className="grid gap-3 md:grid-cols-4">
            {["Pending", "Preparing", "In Transit", "Delivered"].map(x => <div key={x} className="rounded-xl border bg-white p-4 text-center"><Truck className="mx-auto h-5 w-5 text-emerald-600" /><p className="mt-2 text-sm font-semibold">{x}</p></div>)}
          </div>
          <Notice text="Distribution uses the existing delivery workflow so cooperative orders retain order, farmer and delivery traceability." />
        </WorkflowCard>
      )}

      {stage === "earnings" && (
        <WorkflowCard title="Sales & Earnings" description="Track cooperative sales and member contribution before settlements.">
          <div className="grid gap-4 md:grid-cols-3">
            <Metric icon={Wallet} label="Marketplace sales" value="Live order data" />
            <Metric icon={Wallet} label="B2B sales" value="Live order data" />
            <Metric icon={BarChart3} label="Member settlements" value="Based on contribution" />
          </div>
        </WorkflowCard>
      )}

      {stage === "reports" && (
        <WorkflowCard title="Cooperative Reports" description="Review production, inventory, orders, distribution, sales and member contribution.">
          <div className="grid gap-3 md:grid-cols-3">
            {["Production Report", "Inventory Report", "Orders Report", "Distribution Report", "Sales & Earnings", "Member Contribution"].map(x =>
              <div key={x} className="rounded-xl border p-4"><BarChart3 className="h-5 w-5 text-emerald-600" /><p className="mt-2 text-sm font-semibold">{x}</p><p className="mt-1 text-xs text-slate-500">Available from cooperative activity data.</p></div>
            )}
          </div>
        </WorkflowCard>
      )}

      {stage !== "reports" && next && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setStage(next)}>
            Continue to {stages.find(x => x.key === next)?.title}<ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      )}

      {showCreate && <Modal title="Create Cooperative" onClose={() => setShowCreate(false)}><p className="text-sm text-slate-500">Use the workflow's Create Cooperative step to register the group.</p><Button className="mt-4 w-full" onClick={() => { setShowCreate(false); setStage("setup"); }}>Open Setup</Button></Modal>}
      {showJoin && <Modal title="Find a Cooperative" onClose={() => setShowJoin(false)}>
        <p className="text-sm text-slate-500">You do not need to know another farmer. Search for a cooperative by name, location or crop and send a join request.</p>
        <div className="mt-4 grid gap-2"><Input value={coopSearch} onChange={e => setCoopSearch(e.target.value)} placeholder="Cooperative name" /><Input value={coopLocation} onChange={e => setCoopLocation(e.target.value)} placeholder="Village / district / location" /><Input value={coopCrop} onChange={e => setCoopCrop(e.target.value)} placeholder="Crop, e.g. Tomato" /></div>
        <div className="mt-4 space-y-3">{discoveryLoading ? <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" /></div> : discoveredCooperatives.length ? discoveredCooperatives.map((item: any) => <div key={item.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.name}</p><p className="mt-1 text-xs text-slate-500"><MapPin className="mr-1 inline h-3 w-3" />{item.location} · {item.memberCount} members</p><p className="mt-2 text-sm text-slate-500">{item.crops?.join(" · ") || "Multiple crops"}</p></div><Badge variant="outline">{item.joinStatus === "pending" ? "Request pending" : item.joinStatus === "member" ? "Member" : "Available"}</Badge></div>{item.joinStatus === "available" && <Button className="mt-3 w-full" disabled={joinMutation.isPending} onClick={() => joinMutation.mutate(item.id)}>{joinMutation.isPending ? "Sending..." : "Request to Join"}</Button>}</div>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No cooperatives found. Try another location or crop.</p>}</div>
        <div className="mt-4 border-t pt-4"><Button variant="outline" className="w-full" onClick={() => { setShowJoin(false); setShowInvite(true); }}>Have an invite code?</Button></div>
      </Modal>}
      {showInvite && <Modal title="Join with Invite Code" onClose={() => setShowInvite(false)}><p className="text-sm text-slate-500">Use this only when a cooperative manager has privately shared an invite code with you.</p><Input className="mt-4" value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())} placeholder="AGR-AB12CD34" /><Button className="mt-3 w-full" disabled={!inviteCode.trim() || joinMutation.isPending} onClick={() => joinMutation.mutate()}>{joinMutation.isPending ? "Sending..." : "Request to Join"}</Button></Modal>}
    </div>
  );
}

function WorkflowCard({title,description,children}:{title:string;description:string;children:ReactNode}) {
  return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>;
}
function Field({label,value,onChange,placeholder}:{label:string;value:string;onChange:(v:string)=>void;placeholder:string}) {
  return <div className="space-y-1"><label className="text-xs font-medium text-slate-600">{label}</label><Input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></div>;
}
function Metric({icon:Icon,label,value}:{icon:any;label:string;value:any}) {
  return <div className="rounded-xl border bg-slate-50 p-4"><Icon className="h-5 w-5 text-emerald-600"/><p className="mt-2 text-xl font-bold">{value}</p><p className="text-xs text-slate-500">{label}</p></div>;
}
function ActionBox({icon:Icon,title,text}:{icon:any;title:string;text:string}) {
  return <div className="rounded-xl border p-5"><Icon className="h-6 w-6 text-emerald-600"/><p className="mt-2 font-semibold">{title}</p><p className="mt-1 text-sm text-slate-500">{text}</p></div>;
}
function Notice({text}:{text:string}) { return <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{text}</div>; }
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><Card className="w-full max-w-md"><CardHeader><div className="flex items-center justify-between"><CardTitle>{title}</CardTitle><Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4"/></Button></div></CardHeader><CardContent>{children}</CardContent></Card></div>;
}
function BriefcaseIcon({className}:{className?:string}) { return <ShoppingCart className={className}/>; }
