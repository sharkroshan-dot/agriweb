"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { api } from "../../lib/api/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Warehouse, PackageCheck, Truck, Plus, RefreshCw, Copy, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";

const unwrap = (value: any) => value?.data?.data ?? value?.data ?? value ?? {};
const readableStatus = (value: string) => String(value || "pending").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function LocalHubManagementPage() {
  const { data: session } = useSession();
  const isHubManager = (session?.user as any)?.facilityType === "local_hub";
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", district: "", state: "Tamil Nadu", address: "", capacity: "5000", latitude: "", longitude: "", managerName: "", username: "", email: "" });
  const [createdCredentials, setCreatedCredentials] = useState<any>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const hubsQuery = useQuery({
    queryKey: ["warehouse-local-hubs"],
    queryFn: async () => unwrap(await api.get(isHubManager ? "/hub/me/dashboard" : "/warehouse/me/local-hubs")),
    enabled: Boolean(session?.user),
    refetchInterval: 30000,
    retry: 1,
  });
  const createHub = useMutation({
    mutationFn: async () => unwrap(await api.post("/warehouse/me/local-hubs", { ...form, capacity: Number(form.capacity), latitude: Number(form.latitude), longitude: Number(form.longitude) })),
    onSuccess: (result) => {
      setCreatedCredentials(result);
      setForm({ name: "", district: "", state: "Tamil Nadu", address: "", capacity: "5000", latitude: "", longitude: "", managerName: "", username: "", email: "" });
      qc.invalidateQueries({ queryKey: ["warehouse-local-hubs"] });
      toast.success("Local hub and manager account created");
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || "Could not create local hub"),
  });
  const receive = useMutation({
    mutationFn: (id: string) => api.post(`/hub/me/transfers/${id}/receive`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouse-local-hubs"] }); toast.success("Physical receipt confirmed"); },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || "Could not confirm receipt"),
  });
  const changePassword = useMutation({ mutationFn: () => api.post("/hub/me/change-password", { currentPassword, newPassword }), onSuccess: () => { setCurrentPassword(""); setNewPassword(""); qc.invalidateQueries({ queryKey: ["warehouse-local-hubs"] }); toast.success("Password changed successfully"); }, onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || "Could not change password") });
  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/hub/me/orders/${id}/publish`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["warehouse-local-hubs"] }); toast.success("Order published to delivery partners"); },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || "Could not publish order"),
  });
  const result = hubsQuery.data || {};
  const hubs = result.hubs || result.data?.hubs || [];
  const orders = result.orders || result.data?.orders || [];
  const hub = result.hub || result.data?.hub || {};
  const credentialData = createdCredentials?.data || createdCredentials;
  const canCreate = Boolean(form.name.trim() && form.district.trim() && form.state.trim() && form.address.trim() && Number(form.capacity) > 0 && form.latitude.trim() !== "" && Number(form.latitude) >= -90 && Number(form.latitude) <= 90 && form.longitude.trim() !== "" && Number(form.longitude) >= -180 && Number(form.longitude) <= 180 && form.managerName.trim() && form.username.trim() && form.email.trim());

  return <div className="mx-auto max-w-6xl space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-medium text-emerald-700">Local Hub Operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight">{isHubManager ? (hub.name || "Local Hub Dashboard") : "Local Hub Management"}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{isHubManager ? "Receive warehouse shipments, confirm physical receipt, then publish eligible orders to delivery partners." : "Create a local hub and provision its manager account. Hub managers use the same warehouse role but are restricted to their assigned hub."}</p></div>
      <Button variant="outline" onClick={() => hubsQuery.refetch()} disabled={hubsQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>

    {isHubManager ? <>
      {result.mustChangePassword && <Card className="border-amber-300"><CardHeader><CardTitle>Change Temporary Password</CardTitle><CardDescription>Set a new password before processing shipments.</CardDescription></CardHeader><CardContent><form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); changePassword.mutate(); }}><div className="space-y-1"><label className="text-sm font-medium">Temporary password</label><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required minLength={8} /></div><div className="space-y-1"><label className="text-sm font-medium">New password</label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></div><div className="sm:col-span-2"><Button type="submit" disabled={changePassword.isPending || currentPassword.length < 8 || newPassword.length < 8}>{changePassword.isPending ? "Updating…" : "Change Password"}</Button></div></form></CardContent></Card>}
      {!result.mustChangePassword && <div className="grid gap-3 sm:grid-cols-3">
        {[["Incoming", (result.counts || {}).incoming ?? 0], ["Received", (result.counts || {}).received ?? 0], ["Published", (result.counts || {}).published ?? 0]].map(([label, value]) => <Card key={String(label)}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></CardContent></Card>)}
      </div>}
      {!result.mustChangePassword && <Card><CardHeader><CardTitle>Incoming and Delivery Orders</CardTitle><CardDescription>Confirm physical receipt before making an order available to delivery partners.</CardDescription></CardHeader><CardContent>
        {hubsQuery.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading hub orders…</p> : orders.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center"><PackageCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground" /><p className="font-medium">No incoming orders</p><p className="mt-1 text-sm text-muted-foreground">Orders dispatched to this hub will appear here.</p></div> : <div className="space-y-3">{orders.map((order: any) => <div key={order.transferId} className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">Order {order.orderNumber}</p><p className="mt-1 text-sm text-muted-foreground">{order.productSummary} · Qty {order.quantity}</p><p className="mt-1 text-xs text-muted-foreground">Order status: {readableStatus(order.orderStatus)} · Transfer: {readableStatus(order.status)}</p></div><Badge variant="outline">{order.published ? readableStatus(order.jobStatus) : readableStatus(order.status)}</Badge></div><div className="mt-3 flex flex-wrap gap-2">{!["received", "ready_for_delivery"].includes(String(order.status).toLowerCase()) && <Button size="sm" onClick={() => receive.mutate(order.transferId)} disabled={receive.isPending}><PackageCheck className="mr-2 h-4 w-4" />Confirm Receipt</Button>}<Button size="sm" variant="outline" onClick={() => publish.mutate(order.orderId)} disabled={publish.isPending || order.published || String(order.status).toLowerCase() !== "received"}><Truck className="mr-2 h-4 w-4" />{order.published ? "Published to Partners" : "Publish for Delivery"}</Button></div></div>)}</div>}
      </CardContent></Card>}
    </> : <>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />Create Local Hub and Manager</CardTitle><CardDescription>Creates a hub under your warehouse and a manager login with the existing warehouse role. The generated temporary password is shown only once.</CardDescription></CardHeader><CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createHub.mutate(); }}>
          <div className="space-y-1"><label className="text-sm font-medium">Hub name</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Coimbatore Local Hub" required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">District</label><Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">State</label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Capacity (project units)</label><Input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} required /></div><div className="space-y-1"><label className="text-sm font-medium">Latitude</label><Input type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="e.g. 11.0168" required /></div><div className="space-y-1"><label className="text-sm font-medium">Longitude</label><Input type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="e.g. 76.9558" required /></div>
          <div className="space-y-1 md:col-span-2"><label className="text-sm font-medium">Full address</label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Manager name</label><Input value={form.managerName} onChange={(e) => setForm({ ...form, managerName: e.target.value })} required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Username</label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" required /></div>
          <div className="space-y-1 md:col-span-2"><label className="text-sm font-medium">Manager email (used to sign in)</label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div className="md:col-span-2"><Button type="submit" disabled={!canCreate || createHub.isPending}><Warehouse className="mr-2 h-4 w-4" />{createHub.isPending ? "Creating…" : "Create Hub and Manager Account"}</Button></div>
        </form>
      </CardContent></Card>
      {credentialData?.temporaryPassword && <Card className="border-emerald-300"><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-700" />Hub Created Successfully</CardTitle><CardDescription>Share this temporary credential securely. Ask the manager to change it immediately after signing in.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="rounded-lg bg-muted p-3 text-sm"><p><strong>Hub:</strong> {credentialData.hub?.name}</p><p><strong>Username:</strong> {credentialData.manager?.username}</p><p><strong>Sign-in email:</strong> {credentialData.manager?.email}</p><p className="mt-2 break-all"><strong>Temporary password:</strong> {credentialData.temporaryPassword}</p></div><Button variant="outline" onClick={() => { const c = credentialData; navigator.clipboard.writeText(`Hub: ${c.hub?.name}\nUsername: ${c.manager?.username}\nEmail: ${c.manager?.email}\nTemporary password: ${c.temporaryPassword}`); toast.success("Temporary credentials copied"); }}><Copy className="mr-2 h-4 w-4" />Copy credentials</Button></CardContent></Card>}
      <Card><CardHeader><CardTitle>Managed Local Hubs</CardTitle><CardDescription>Hubs created under your warehouse.</CardDescription></CardHeader><CardContent>
        {hubsQuery.isLoading ? <p className="py-6 text-sm text-muted-foreground">Loading local hubs…</p> : hubs.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No local hubs created yet.</p> : <div className="space-y-3">{hubs.map((item: any) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-semibold">{item.name}</p><p className="text-sm text-muted-foreground">{item.district}, {item.state}</p><p className="mt-1 text-xs text-muted-foreground">Manager: {item.manager?.name || "—"} · {item.manager?.email || "No email"}</p></div><Badge variant="outline">{readableStatus(item.status)}</Badge></div>)}</div>}
      </CardContent></Card>
    </>}
  </div>;
}
