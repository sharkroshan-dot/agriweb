"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin, Route, Truck, Warehouse, RefreshCw, Plus, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

export default function PickupRoutesPage() {
  const [selectedTeam, setSelectedTeam] = useState<Record<string,string>>({});
  const routesQ = useQuery({ queryKey:["warehousePickupRoutes"], queryFn:()=>api.get("/warehouse/me/pickup-routes"), refetchInterval:15000 });
  const teamsQ = useQuery({ queryKey:["warehousePickupTeams"], queryFn:()=>api.get("/warehouse/me/pickup-team/members") });
  const routes = routesQ.data?.data?.routes || [];
  const teams = teamsQ.data?.data?.members || [];

  const createRoutes = async () => {
    try { await api.post("/warehouse/me/pickup-routes", { maxStops: 8, maxWeightKg: 0 }); toast.success("Smart pickup route(s) created"); await routesQ.refetch(); }
    catch(e:any){ toast.error(e?.message || "No ready farms available"); }
  };
  const assign = async (routeId:string) => {
    const partnerId=selectedTeam[routeId];
    if(!partnerId) return toast.error("Select an approved pickup team member");
    try { await api.put(`/warehouse/me/pickup-routes/${routeId}/assign`,{deliveryPartnerId:partnerId}); toast.success("Pickup route assigned"); await routesQ.refetch(); }
    catch(e:any){ toast.error(e?.message || "Failed to assign route"); }
  };

  return <div className="space-y-6">
    <div className="rounded-2xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 p-6 text-white shadow-sm sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="flex items-center gap-2 text-emerald-100 text-sm"><Route className="h-4 w-4"/> Daily pickup planning</div><h1 className="mt-2 text-3xl font-bold">Pickup Routes</h1><p className="mt-2 max-w-2xl text-sm text-emerald-50">Group ready farms into efficient routes, then assign each route to an approved warehouse pickup team member.</p></div>
        <Button variant="secondary" onClick={createRoutes}><Plus className="mr-2 h-4 w-4"/> Create Smart Routes</Button>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-5"><p className="text-xs text-muted-foreground">Today's Routes</p><p className="text-2xl font-bold">{routes.length}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-xs text-muted-foreground">Farm Stops</p><p className="text-2xl font-bold">{routes.reduce((n:any,r:any)=>n+(r.totalStops||0),0)}</p></CardContent></Card><Card><CardContent className="p-5"><p className="text-xs text-muted-foreground">Approved Team</p><p className="text-2xl font-bold">{teams.length}</p></CardContent></Card></div>
    <div className="space-y-4">{routes.length===0 ? <Card className="p-12 text-center"><Route className="mx-auto h-12 w-12 text-muted-foreground"/><h2 className="mt-4 font-semibold">No pickup routes today</h2><p className="mt-2 text-sm text-muted-foreground">Create routes from collections that are READY FOR PICKUP.</p></Card> : routes.map((r:any)=><Card key={r.id} className="overflow-hidden"><CardHeader className="border-b bg-slate-50/70"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">🚚 {r.routeNumber || "Pickup Route"}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{r.totalStops} farms · {r.totalQuantity || 0} kg</p></div><Badge>{String(r.status||"planned").replace(/_/g," ")}</Badge></div></CardHeader><CardContent className="p-5">
      <div className="space-y-3">{(r.stops||[]).map((s:any,i:number)=><div key={s.collectionId} className="flex items-start gap-3 rounded-xl border p-3"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">{i+1}</div><div className="min-w-0 flex-1"><p className="font-medium">{s.farmerName}</p><p className="text-sm text-muted-foreground">{s.productName} · {s.quantity} kg</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3"/> Pickup location</p></div><Badge variant="outline">{String(s.status||"pending").replace(/_/g," ")}</Badge></div>)}</div>
      <div className="mt-5 flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">{r.deliveryPartnerId ? "Assigned pickup team" : "Assign approved pickup team"}</p><p className="text-xs text-muted-foreground">Only warehouse-approved delivery partners can receive this route.</p></div>{r.deliveryPartnerId ? <Badge className="bg-emerald-600 text-white"><CheckCircle2 className="mr-1 h-3 w-3"/> Assigned</Badge> : <div className="flex gap-2"><Select value={selectedTeam[r.id]||""} onValueChange={v=>setSelectedTeam({...selectedTeam,[r.id]:v})}><SelectTrigger className="w-56"><SelectValue placeholder="Select team member"/></SelectTrigger><SelectContent>{teams.map((t:any)=><SelectItem key={t.deliveryPartnerId} value={t.deliveryPartnerId}>{t.name || t.vehicleNumber || t.deliveryPartnerId}</SelectItem>)}</SelectContent></Select><Button onClick={()=>assign(r.id)}>Assign Route</Button></div>}</div>
    </CardContent></Card>)}</div>
  </div>;
}
