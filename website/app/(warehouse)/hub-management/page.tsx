"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { api } from "../../lib/api/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Warehouse, PackageCheck, Truck, Plus, RefreshCw, Copy, CheckCircle2, ArrowRight, Clock3, MapPin, ClipboardCheck, CircleCheck } from "lucide-react";
import toast from "react-hot-toast";

const unwrap = (value: any) => value?.data?.data ?? value?.data ?? value ?? {};
const readableStatus = (value: string) => String(value || "pending").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function LocalHubManagementPage() {
  const { data: session } = useSession();
  const isHubManager = (session?.user as any)?.facilityType === "local_hub";
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", district: "", state: "Tamil Nadu", address: "", capacity: "5000", managerName: "", username: "", email: "" });
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
    mutationFn: async () => unwrap(await api.post("/warehouse/me/local-hubs", { ...form, capacity: Number(form.capacity) })),
    onSuccess: (result) => {
      setCreatedCredentials(result);
      setForm({ name: "", district: "", state: "Tamil Nadu", address: "", capacity: "5000", managerName: "", username: "", email: "" });
      qc.invalidateQueries({ queryKey: ["warehouse-local-hubs"] });
      toast.success(result?.data?.emailSent ? "Local hub created; login credentials emailed to the manager" : "Local hub created, but credential email failed. Copy the temporary password below.");
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || "Could not create local hub"),
  });
  const resendLogin = useMutation({
    mutationFn: (id: string) => api.post(`/warehouse/me/local-hubs/${id}/resend-login`, {}),
    onSuccess: (response: any) => {
      const data = unwrap(response);
      toast.success(data?.message || "New temporary login details emailed to the manager");
      qc.invalidateQueries({ queryKey: ["warehouse-local-hubs"] });
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || "Could not email login details. Check backend SMTP settings."),
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
  const canCreate = Boolean(form.name.trim() && form.district.trim() && form.state.trim() && form.address.trim() && Number(form.capacity) > 0 && form.managerName.trim() && form.username.trim() && form.email.trim());

  return <div className="mx-auto max-w-6xl space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-medium text-emerald-700">Local Hub Operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight">{isHubManager ? (hub.name || "Local Hub Dashboard") : "Local Hub Management"}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{isHubManager ? "Receive warehouse shipments, confirm physical receipt, then publish eligible orders to delivery partners." : "Create a local hub and provision its manager account. Hub managers use the same warehouse role but are restricted to their assigned hub."}</p></div>
      <Button variant="outline" onClick={() => hubsQuery.refetch()} disabled={hubsQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>

    {isHubManager ? <>
      {result.mustChangePassword && <Card className="rounded-xl border-amber-300"><CardHeader><CardTitle>Change temporary password</CardTitle><CardDescription>Set a new password before processing shipments.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); changePassword.mutate(); }}><div className="space-y-1.5"><label className="text-sm font-medium">Temporary password</label><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required minLength={8} /></div><div className="space-y-1.5"><label className="text-sm font-medium">New password</label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></div><div className="sm:col-span-2"><Button type="submit" disabled={changePassword.isPending || currentPassword.length < 8 || newPassword.length < 8}>{changePassword.isPending ? "Updating…" : "Save new password"}</Button></div></form></CardContent></Card>}
      {!result.mustChangePassword && <>
        <Card className="overflow-hidden rounded-xl border-primary/15 bg-gradient-to-r from-primary/[0.06] to-transparent shadow-sm"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Warehouse className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your assigned facility</p><h2 className="mt-1 text-xl font-bold">{hub.name || "Local hub"}</h2><p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0"/>{[hub.address, hub.taluk, hub.district, hub.state].filter(Boolean).join(", ") || "Add or verify your hub location with the warehouse manager."}</p></div></div><Badge variant="outline" className="w-fit">Local Hub Manager</Badge></CardContent></Card>
        <div className="grid gap-3 sm:grid-cols-3">
          {[["Incoming", (result.counts || {}).incoming ?? 0, "Awaiting physical receipt", PackageCheck], ["Received", (result.counts || {}).received ?? 0, "Receipt confirmed", ClipboardCheck], ["Published", (result.counts || {}).published ?? 0, "Available to delivery partners", Truck]].map(([label, value, hint, Icon]: any) => <Card key={String(label)} className="rounded-xl shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2.5"><Icon className="h-5 w-5 text-primary"/></div><div className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{hint}</p></div></CardContent></Card>)}
        </div>
        <Card className="rounded-xl shadow-sm"><CardHeader className="border-b bg-muted/20 pb-4"><CardTitle>Shipment processing</CardTitle><CardDescription>Follow these steps for every order arriving from the warehouse.</CardDescription><div className="grid gap-2 pt-2 sm:grid-cols-3"><div className="flex items-center gap-2 rounded-lg border bg-background p-3"><div className="rounded-full bg-amber-100 p-1.5 text-amber-800"><PackageCheck className="h-4 w-4"/></div><div><p className="text-xs font-semibold">1. Receive shipment</p><p className="text-xs text-muted-foreground">Confirm physical arrival</p></div></div><div className="flex items-center gap-2 rounded-lg border bg-background p-3"><div className="rounded-full bg-blue-100 p-1.5 text-blue-800"><ClipboardCheck className="h-4 w-4"/></div><div><p className="text-xs font-semibold">2. Check receipt status</p><p className="text-xs text-muted-foreground">Only after goods arrive</p></div></div><div className="flex items-center gap-2 rounded-lg border bg-background p-3"><div className="rounded-full bg-emerald-100 p-1.5 text-emerald-800"><Truck className="h-4 w-4"/></div><div><p className="text-xs font-semibold">3. Publish for delivery</p><p className="text-xs text-muted-foreground">After receipt is confirmed</p></div></div></div></CardHeader><CardContent className="p-4 sm:p-5">
          {hubsQuery.isLoading ? <div className="space-y-3">{[1,2].map((n) => <div key={n} className="h-36 animate-pulse rounded-xl bg-muted"/>)}</div> : orders.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted"><PackageCheck className="h-6 w-6 text-muted-foreground"/></div><p className="mt-3 font-semibold">No incoming shipments</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">When the warehouse dispatches an order to this hub, it will appear here. Refresh to check for new transfers.</p><Button className="mt-4" variant="outline" onClick={() => hubsQuery.refetch()} disabled={hubsQuery.isFetching}><RefreshCw className={"mr-2 h-4 w-4 " + (hubsQuery.isFetching ? "animate-spin" : "")}/>Refresh shipments</Button></div> : <div className="space-y-4">{orders.map((order: any) => {
            const transferStatus = String(order.status || "").toLowerCase();
            const receivedStatus = ["received", "ready_for_delivery"].includes(transferStatus);
            const isPublished = Boolean(order.published);
            return <div key={order.transferId} className="overflow-hidden rounded-xl border shadow-sm">
              <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Incoming shipment</p><h3 className="mt-1 break-words text-base font-bold">{order.orderNumber || "Order reference unavailable"}</h3><p className="mt-1 text-sm text-muted-foreground">{order.productSummary || "Order items"} <span className="px-1">·</span> Quantity: <span className="font-semibold text-foreground">{order.quantity ?? "—"}</span></p></div><Badge className={"w-fit " + (isPublished ? "bg-emerald-100 text-emerald-800" : receivedStatus ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800")}>{isPublished ? "Published to delivery" : receivedStatus ? "Received at hub" : readableStatus(order.status || "dispatched")}</Badge></div>
              <div className="grid gap-3 p-4 sm:grid-cols-2"><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Order status</p><p className="mt-1 text-sm font-semibold">{readableStatus(order.orderStatus)}</p></div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Transfer status</p><p className="mt-1 text-sm font-semibold">{readableStatus(order.status)}</p></div></div>
              <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Clock3 className="mt-0.5 h-4 w-4 shrink-0"/>{isPublished ? "This order has been published to delivery partners." : receivedStatus ? "Receipt is confirmed. You can publish this order for final-mile delivery." : "Confirm only after the shipment has physically arrived and been checked."}</div><div className="flex flex-col gap-2 sm:min-w-[220px]">{!receivedStatus && <Button onClick={() => receive.mutate(order.transferId)} disabled={receive.isPending} className="w-full"><PackageCheck className="mr-2 h-4 w-4"/>{receive.isPending ? "Confirming receipt…" : "Confirm physical receipt"}</Button>}<Button variant={receivedStatus && !isPublished ? "default" : "outline"} onClick={() => publish.mutate(order.orderId)} disabled={publish.isPending || isPublished || transferStatus !== "received"} className="w-full"><Truck className="mr-2 h-4 w-4"/>{isPublished ? "Published to delivery partners" : "Publish for delivery"}</Button></div></div>
            </div>;
          })}</div>}
        </CardContent></Card>
      </>}
    </> : <>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" />Create Local Hub and Manager</CardTitle><CardDescription>Creates a hub under your warehouse and a manager login with the existing warehouse role. The manager's temporary login credentials are emailed to the registered address. Email delivery requires valid SMTP settings.</CardDescription></CardHeader><CardContent>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); createHub.mutate(); }}>
          <div className="space-y-1"><label className="text-sm font-medium">Hub name</label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Coimbatore Local Hub" required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">District</label><Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">State</label><Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Capacity (project units)</label><Input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} required /></div>
          <div className="space-y-1 md:col-span-2"><label className="text-sm font-medium">Full address</label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, area, landmark or pincode" required /><p className="text-xs text-muted-foreground">Map coordinates are generated automatically from this address. Enter an accurate address so distance and routing workflows use the correct location.</p></div>
          <div className="space-y-1"><label className="text-sm font-medium">Manager name</label><Input value={form.managerName} onChange={(e) => setForm({ ...form, managerName: e.target.value })} required /></div>
          <div className="space-y-1"><label className="text-sm font-medium">Username</label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" required /></div>
          <div className="space-y-1 md:col-span-2"><label className="text-sm font-medium">Manager email (used to sign in)</label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
          <div className="md:col-span-2"><Button type="submit" disabled={!canCreate || createHub.isPending}><Warehouse className="mr-2 h-4 w-4" />{createHub.isPending ? "Creating…" : "Create Hub and Manager Account"}</Button></div>
        </form>
      </CardContent></Card>
      {credentialData?.temporaryPassword && <Card className="border-emerald-300"><CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-700" />Hub Created Successfully</CardTitle><CardDescription>{credentialData.emailSent ? `Login credentials were emailed to ${credentialData.manager?.email}.` : "The credential email was not sent. Check SMTP settings and securely share the temporary password below."} Ask the manager to change the password after signing in.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="rounded-lg bg-muted p-3 text-sm"><p><strong>Hub:</strong> {credentialData.hub?.name}</p><p><strong>Username:</strong> {credentialData.manager?.username}</p><p><strong>Sign-in email:</strong> {credentialData.manager?.email}</p><p className="mt-2 break-all"><strong>Temporary password:</strong> {credentialData.temporaryPassword}</p></div><Button variant="outline" onClick={() => { const c = credentialData; navigator.clipboard.writeText(`Hub: ${c.hub?.name}\nUsername: ${c.manager?.username}\nEmail: ${c.manager?.email}\nTemporary password: ${c.temporaryPassword}`); toast.success("Temporary credentials copied"); }}><Copy className="mr-2 h-4 w-4" />Copy credentials</Button></CardContent></Card>}
      <Card><CardHeader><CardTitle>Managed Local Hubs</CardTitle><CardDescription>Hubs created under your warehouse.</CardDescription></CardHeader><CardContent>
        {hubsQuery.isLoading ? <p className="py-6 text-sm text-muted-foreground">Loading local hubs…</p> : hubs.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No local hubs created yet.</p> : <div className="space-y-3">{hubs.map((item: any) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-semibold">{item.name}</p><p className="text-sm text-muted-foreground">{item.district}, {item.state}</p><p className="mt-1 text-xs text-muted-foreground">Manager: {item.manager?.name || "—"} · {item.manager?.email || "No email"}</p></div><div className="flex items-center gap-2"><Badge variant="outline">{readableStatus(item.status)}</Badge><Button size="sm" variant="outline" disabled={resendLogin.isPending || !item.manager?.email || !item.manager?.username} onClick={() => { if (window.confirm(`Generate a new temporary password and email it to ${item.manager?.email}? The manager current password will be replaced only if the email is sent successfully.`)) resendLogin.mutate(String(item.id || item._id)); }}><RefreshCw className="mr-2 h-4 w-4" />{resendLogin.isPending ? "Sending…" : "Resend Login Details"}</Button></div></div>)}</div>}
      </CardContent></Card>
    </>}
  </div>;
}
