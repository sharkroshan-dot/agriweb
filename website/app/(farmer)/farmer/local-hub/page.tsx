"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api/client";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Badge } from "../../../components/ui/badge";
import { MapPin, Warehouse, Thermometer, Clock3, ShieldCheck } from "lucide-react";

const initialForm = {
  name: "", addressLine: "", city: "", state: "", postalCode: "",
  latitude: "", longitude: "", storageCapacity: "", coldStorageAvailable: false,
  coldStorageCapacity: "", supportedProducts: "", openingTime: "06:00",
  closingTime: "20:00", handlingInstructions: "", qualityVerificationRequired: true,
};

export default function LocalHubPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["farmer-local-hubs"],
    queryFn: () => api.get("/fulfillment/hubs/mine"),
  });
  const hubs = (data as any)?.data?.hubs || [];
  const editing = useMemo(() => hubs.find((h: any) => String(h.id || h._id) === editingId), [hubs, editingId]);

  const save = useMutation({
    mutationFn: async () => {
      const lat = Number(form.latitude), lng = Number(form.longitude), capacity = Number(form.storageCapacity);
      if (!form.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || capacity <= 0) {
        throw new Error("Enter hub name, storage capacity and valid latitude/longitude.");
      }
      const payload = {
        name: form.name.trim(),
        location: { lat, lng },
        address: { line1: form.addressLine.trim(), city: form.city.trim(), state: form.state.trim(), postalCode: form.postalCode.trim() },
        storageCapacity: capacity,
        availableCapacity: editing ? Number(editing.availableCapacity ?? capacity) : capacity,
        coldStorageAvailable: form.coldStorageAvailable,
        coldStorageCapacity: form.coldStorageAvailable ? Number(form.coldStorageCapacity || 0) : 0,
        supportedProducts: form.supportedProducts.split(",").map(x => x.trim()).filter(Boolean),
        operatingHours: { open: form.openingTime, close: form.closingTime },
        handlingInstructions: form.handlingInstructions.trim(),
        qualityVerificationRequired: form.qualityVerificationRequired,
        isActive: true,
      };
      return editingId
        ? api.put(`/fulfillment/hubs/${editingId}`, payload)
        : api.post("/fulfillment/hubs/opt-in", payload);
    },
    onSuccess: () => {
      setMessage(editingId ? "Hub changes submitted for approval." : "Hub submitted for admin approval.");
      setEditingId(null); setForm(initialForm);
      qc.invalidateQueries({ queryKey: ["farmer-local-hubs"] });
    },
    onError: (e: any) => setMessage(e?.response?.data?.detail || e?.message || "Unable to save hub."),
  });

  function startEdit(h: any) {
    const loc = h.location || {}, addr = h.address || {};
    setEditingId(String(h.id || h._id));
    setForm({
      name: h.name || "", addressLine: addr.line1 || addr.address || "", city: addr.city || "",
      state: addr.state || "", postalCode: addr.postalCode || "",
      latitude: String(loc.lat ?? loc.latitude ?? ""), longitude: String(loc.lng ?? loc.longitude ?? ""),
      storageCapacity: String(h.storageCapacity ?? ""), coldStorageAvailable: Boolean(h.coldStorageAvailable),
      coldStorageCapacity: String(h.coldStorageCapacity ?? ""), supportedProducts: (h.supportedProducts || []).join(", "),
      openingTime: h.operatingHours?.open || "06:00", closingTime: h.operatingHours?.close || "20:00",
      handlingInstructions: h.handlingInstructions || "", qualityVerificationRequired: h.qualityVerificationRequired !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Local Fulfillment Hub</h1>
        <p className="text-sm text-muted-foreground">Opt your farm into AgriConnect's controlled local-hub network. Local hubs are used only for warehouse-to-nearby-customer fulfillment.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>{editingId ? "Update hub" : "Register your farm as a hub"}</CardTitle><CardDescription>Admin approval is required before receiving transferred stock.</CardDescription></CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2"><Label>Hub / farm name</Label><Input value={form.name} onChange={e => setForm({...form,name:e.target.value})} /></div>
          <div className="space-y-2"><Label>Address</Label><Input value={form.addressLine} onChange={e => setForm({...form,addressLine:e.target.value})} /></div>
          <div className="space-y-2"><Label>City</Label><Input value={form.city} onChange={e => setForm({...form,city:e.target.value})} /></div>
          <div className="space-y-2"><Label>State</Label><Input value={form.state} onChange={e => setForm({...form,state:e.target.value})} /></div>
          <div className="space-y-2"><Label>Postal code</Label><Input value={form.postalCode} onChange={e => setForm({...form,postalCode:e.target.value})} /></div>
          <div className="space-y-2"><Label>Latitude</Label><Input type="number" step="any" value={form.latitude} onChange={e => setForm({...form,latitude:e.target.value})} /></div>
          <div className="space-y-2"><Label>Longitude</Label><Input type="number" step="any" value={form.longitude} onChange={e => setForm({...form,longitude:e.target.value})} /></div>
          <div className="space-y-2"><Label>Total storage capacity (kg)</Label><Input type="number" min="1" value={form.storageCapacity} onChange={e => setForm({...form,storageCapacity:e.target.value})} /></div>
          <div className="space-y-2"><Label>Supported products</Label><Input value={form.supportedProducts} onChange={e => setForm({...form,supportedProducts:e.target.value})} placeholder="Tomato, Onion, Carrot" /></div>
          <label className="flex items-center gap-3 rounded-lg border p-3"><input type="checkbox" checked={form.coldStorageAvailable} onChange={e => setForm({...form,coldStorageAvailable:e.target.checked})} /><span className="text-sm">Cold storage available</span></label>
          <div className="space-y-2"><Label>Cold storage capacity (kg)</Label><Input type="number" min="0" disabled={!form.coldStorageAvailable} value={form.coldStorageCapacity} onChange={e => setForm({...form,coldStorageCapacity:e.target.value})} /></div>
          <div className="space-y-2"><Label>Opening time</Label><Input type="time" value={form.openingTime} onChange={e => setForm({...form,openingTime:e.target.value})} /></div>
          <div className="space-y-2"><Label>Closing time</Label><Input type="time" value={form.closingTime} onChange={e => setForm({...form,closingTime:e.target.value})} /></div>
          <div className="space-y-2 md:col-span-2"><Label>Handling instructions</Label><textarea className="min-h-24 w-full rounded-md border p-3 text-sm" value={form.handlingInstructions} onChange={e => setForm({...form,handlingInstructions:e.target.value})} /></div>
          <label className="flex items-center gap-3 md:col-span-2"><input type="checkbox" checked={form.qualityVerificationRequired} onChange={e => setForm({...form,qualityVerificationRequired:e.target.checked})} /><span className="text-sm">Require quality verification for inbound transfers</span></label>
          {message && <p className="text-sm md:col-span-2">{message}</p>}
          <div className="flex gap-2 md:col-span-2"><Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving..." : editingId ? "Save changes" : "Submit for approval"}</Button>{editingId && <Button variant="outline" onClick={() => {setEditingId(null);setForm(initialForm);}}>Cancel</Button>}</div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {isLoading ? <Card><CardContent className="p-6">Loading...</CardContent></Card> : hubs.length === 0 ? <Card><CardContent className="p-6 text-sm text-muted-foreground">No local hub application yet.</CardContent></Card> : hubs.map((hub:any) => (
          <Card key={hub.id || hub._id}><CardHeader><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2 text-lg"><Warehouse className="h-5 w-5" />{hub.name}</CardTitle><Badge>{hub.approvalStatus || "pending"}</Badge></div></CardHeader>
          <CardContent className="space-y-3 text-sm"><div className="grid grid-cols-2 gap-2"><div><p className="text-muted-foreground">Capacity</p><p className="font-semibold">{hub.storageCapacity} kg</p></div><div><p className="text-muted-foreground">Available</p><p className="font-semibold">{hub.availableCapacity} kg</p></div></div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{hub.address?.city || "Location saved"}</span><span className="flex items-center gap-1"><Thermometer className="h-3.5 w-3.5" />{hub.coldStorageAvailable ? "Cold storage" : "Ambient storage"}</span><span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{hub.operatingHours?.open || "—"}–{hub.operatingHours?.close || "—"}</span></div>
          <p className="flex items-center gap-2 text-xs"><ShieldCheck className="h-4 w-4" />{hub.isActive ? "Active" : "Waiting for approval"}</p><Button variant="outline" size="sm" onClick={() => startEdit(hub)}>Edit</Button></CardContent></Card>
        ))}
      </div>
    </div>
  );
}
