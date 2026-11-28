"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../../lib/api/client";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";

type Area = { id: string; district: string; name: string; taluk?: string | null; aliases: string[]; isActive: boolean };
const empty = { district: "", name: "", taluk: "", aliases: "" };

export default function AdminPickupAreasPage() {
  const qc = useQueryClient();
  const [district, setDistrict] = useState("");
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["adminPickupAreaMaster", district],
    queryFn: () => api.get("/admin/pickup-area-master", { params: district ? { district } : {} }),
  });
  const rows: Area[] = useMemo(() => {
    const list = (data as any)?.data?.areas || (data as any)?.areas || [];
    return Array.isArray(list) ? list : [];
  }, [data]);
  const save = useMutation({
    mutationFn: () => {
      const body = { district: form.district.trim(), name: form.name.trim(), taluk: form.taluk.trim() || null, aliases: form.aliases.split(",").map(x => x.trim()).filter(Boolean), isActive: true };
      return editing ? api.put("/admin/pickup-area-master/" + editing, body) : api.post("/admin/pickup-area-master", body);
    },
    onSuccess: () => { toast.success(editing ? "Pickup area updated" : "Pickup area added"); setShowForm(false); setEditing(null); setForm(empty); qc.invalidateQueries({ queryKey: ["adminPickupAreaMaster"] }); },
    onError: (e: any) => toast.error(e?.message || "Unable to save pickup area"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete("/admin/pickup-area-master/" + id),
    onSuccess: () => { toast.success("Pickup area removed"); qc.invalidateQueries({ queryKey: ["adminPickupAreaMaster"] }); },
    onError: (e: any) => toast.error(e?.message || "Unable to remove pickup area"),
  });
  const openEdit = (area: Area) => { setEditing(area.id); setForm({ district: area.district, name: area.name, taluk: area.taluk || "", aliases: (area.aliases || []).join(", ") }); setShowForm(true); };
  const openCreate = () => { setEditing(null); setForm({ ...empty, district }); setShowForm(true); };
  return <main className="space-y-5 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">District Pickup Area Master</h1><p className="mt-1 text-sm text-slate-600">Maintain the official villages, towns and localities used by warehouse pickup planning.</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Refresh</Button><Button onClick={openCreate}><Plus className="mr-2 h-4 w-4"/>Add pickup area</Button></div>
    </header>
    <Card><CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(220px,360px)_1fr] md:items-end">
      <label className="text-sm font-medium text-slate-700">Filter by district<Input className="mt-1" value={district} onChange={e => setDistrict(e.target.value)} placeholder="e.g. Tiruchirappalli"/></label>
      <p className="text-xs text-slate-500">Add one record per locality. Include alternate spellings as comma-separated aliases so farm profiles can match consistently.</p>
    </CardContent></Card>
    {showForm && <Card><CardContent className="space-y-3 p-4">
      <h2 className="font-semibold">{editing ? "Edit pickup area" : "Add pickup area"}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">District<Input value={form.district} onChange={e => setForm(v => ({...v,district:e.target.value}))} placeholder="Tiruchirappalli"/></label>
        <label className="text-xs font-semibold text-slate-600">Village / town / locality<Input value={form.name} onChange={e => setForm(v => ({...v,name:e.target.value}))} placeholder="Manachanallur"/></label>
        <label className="text-xs font-semibold text-slate-600">Taluk (optional)<Input value={form.taluk} onChange={e => setForm(v => ({...v,taluk:e.target.value}))} placeholder="Manachanallur"/></label>
        <label className="text-xs font-semibold text-slate-600">Alternate names / spellings<Input value={form.aliases} onChange={e => setForm(v => ({...v,aliases:e.target.value}))} placeholder="Manachanallur, Manachanalur"/></label>
      </div>
      <div className="flex gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending || !form.district.trim() || !form.name.trim()}>{save.isPending ? "Saving…" : "Save area"}</Button><Button variant="outline" onClick={() => {setShowForm(false);setEditing(null);setForm(empty)}}>Cancel</Button></div>
    </CardContent></Card>}
    <Card><CardContent className="p-0">
      {isLoading ? <p className="p-6 text-sm text-slate-500">Loading area directory…</p> : isError ? <p className="p-6 text-sm text-rose-600">Unable to load pickup area master.</p> : rows.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No master areas yet. Add the first district locality.</p> : <div className="divide-y">
        {rows.map(area => <div key={area.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0"><p className="flex items-center gap-2 font-semibold text-slate-900"><MapPin className="h-4 w-4 text-emerald-700"/>{area.name}</p><p className="mt-1 text-xs text-slate-500">{area.district}{area.taluk ? " · " + area.taluk + " taluk" : ""}</p><p className="mt-1 text-xs text-slate-400">Aliases: {(area.aliases || []).join(", ") || "None"}</p></div>
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openEdit(area)}><Pencil className="mr-1 h-3.5 w-3.5"/>Edit</Button><Button size="sm" variant="outline" onClick={() => {if (window.confirm("Remove " + area.name + " from the active pickup area directory?")) remove.mutate(area.id)}} disabled={remove.isPending}><Trash2 className="mr-1 h-3.5 w-3.5"/>Remove</Button></div>
        </div>)}
      </div>}
    </CardContent></Card>
  </main>;
}
