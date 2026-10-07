"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Route, Truck } from "lucide-react";
import { api } from "../../lib/api/client";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import toast from "react-hot-toast";

const next: Record<string,string> = { team_assigned:"en_route", en_route:"arrived_at_farm", arrived_at_farm:"collected", collected:"departed_farm", departed_farm:"arrived_warehouse" };

export default function WarehouseCollectionsPage() {
 const qc=useQueryClient();
 const {data,isLoading,refetch}=useQuery({queryKey:["warehouse","collections"],queryFn:()=>api.get("/warehouse/me/collections?status=all")});
 const update=useMutation({mutationFn:({id,status}:{id:string;status:string})=>api.put(`/warehouse/me/collections/${id}/status?status=${status}`),onSuccess:()=>{toast.success("Collection updated.");qc.invalidateQueries({queryKey:["warehouse","collections"]});},onError:(e:any)=>toast.error(e?.message||"Update failed")});
 const rows=data?.data?.collections||[];
 return <div className="space-y-5"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">Farm Collection</h1><p className="text-sm text-slate-500">Collect packed event and weekly basket fulfillments through approved pickup routes.</p></div><Button variant="outline" size="icon" onClick={()=>refetch()}><RefreshCw className="h-4 w-4"/></Button></div>
 {isLoading?<div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin"/></div>:rows.length===0?<Card><CardContent className="py-12 text-center text-sm text-slate-500">No farm collection jobs.</CardContent></Card>:<div className="space-y-3">{rows.map((x:any)=>{const n=next[x.status];return <Card key={x.id}><CardContent className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex gap-2"><Badge variant="outline"><Route className="mr-1 h-3.5 w-3.5"/>Collection</Badge><Badge>{String(x.status||"").replace(/_/g," ")}</Badge></div><p className="mt-2 font-semibold">{x.productName||"Farm Product"} · {x.quantity||0} kg</p><p className="text-sm text-slate-500">{x.pickupLocation?.address||x.farmerName||"Farm pickup"}</p></div>{n?<Button size="sm" disabled={update.isPending} onClick={()=>update.mutate({id:x.id,status:n})}><Truck className="mr-1.5 h-4 w-4"/>Mark {n.replace(/_/g," ")}</Button>:null}</div></CardContent></Card>})}</div>}</div>;
}
