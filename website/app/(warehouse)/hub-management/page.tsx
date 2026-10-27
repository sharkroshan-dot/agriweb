"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
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
const displayLocation = (value: any): string => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(displayLocation).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const parts = [
      value.addressLine1, value.addressLine2, value.address, value.street,
      value.locality, value.village, value.town, value.city, value.area,
      value.taluk, value.subDistrict, value.tehsil, value.district,
      value.state, value.pincode, value.postalCode, value.zipCode,
    ].map(displayLocation).filter(Boolean);
    return [...new Set(parts)].join(", ");
  }
  return "";
};

export default function LocalHubManagementPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const isIncomingView = searchParams.get("view") === "incoming";
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
  const bulkProcess = useMutation({
    mutationFn: async () => {
      const pendingReceipt = orders.filter((order: any) => !["received", "ready_for_delivery"].includes(String(order.status || "").toLowerCase()));
      const pendingPublish = orders.filter((order: any) => ["received", "ready_for_delivery"].includes(String(order.status || "").toLowerCase()) && !order.published);
      const failed: string[] = [];
      let receivedCount = 0;
      let publishedCount = 0;
      // Receive first; publish only after the API confirms receipt.
      for (const order of pendingReceipt) {
        try {
          await api.post(`/hub/me/transfers/${order.transferId}/receive`, {});
          receivedCount += 1;
        } catch (error: any) {
          failed.push(`${order.orderNumber || order.transferId}: ${error?.response?.data?.detail || error?.message || "receipt failed"}`);
        }
      }
      // Refresh server state before publishing so only confirmed receipts are published.
      const refreshed: any = unwrap(await api.get("/hub/me/dashboard"));
      const refreshedOrders = refreshed.orders || refreshed.data?.orders || [];
      const publishable = refreshedOrders.filter((order: any) => ["received", "ready_for_delivery"].includes(String(order.status || "").toLowerCase()) && !order.published);
      for (const order of publishable) {
        try {
          await api.post(`/hub/me/orders/${order.orderId}/publish`, {});
          publishedCount += 1;
        } catch (error: any) {
          failed.push(`${order.orderNumber || order.orderId}: ${error?.response?.data?.detail || error?.message || "publish failed"}`);
        }
      }
      return { receivedCount, publishedCount, failed };
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["warehouse-local-hubs"] });
      if (result.failed.length) toast.error(`Processed with ${result.failed.length} issue(s). Check the order cards and retry.`);
      else toast.success(`Completed: ${result.receivedCount} shipment(s) received and ${result.publishedCount} order(s) published for delivery.`);
    },
    onError: (error: any) => toast.error(error?.response?.data?.detail || error?.message || "Could not process incoming orders"),
  });
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
      <div><p className="text-sm font-medium text-emerald-700">Local Hub Operations</p><h1 className="mt-1 text-2xl font-bold tracking-tight">{isHubManager ? (isIncomingView ? "Incoming Orders" : (hub.name || "Local Hub Dashboard")) : "Local Hub Management"}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{isHubManager ? (isIncomingView ? "Process shipments sent to your hub: confirm physical receipt, then publish eligible orders for final-mile delivery." : "Monitor your hub activity and incoming shipment totals. Open Incoming Orders to process transfers.") : "Create a local hub and provision its manager account. Hub managers use the same warehouse role but are restricted to their assigned hub."}</p></div>
      <Button variant="outline" onClick={() => hubsQuery.refetch()} disabled={hubsQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>

    {isHubManager ? <>
      {result.mustChangePassword && <Card className="rounded-xl border-amber-300"><CardHeader><CardTitle>Change temporary password</CardTitle><CardDescription>Set a new password before processing shipments.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); changePassword.mutate(); }}><div className="space-y-1.5"><label className="text-sm font-medium">Temporary password</label><Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required minLength={8} /></div><div className="space-y-1.5"><label className="text-sm font-medium">New password</label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} /></div><div className="sm:col-span-2"><Button type="submit" disabled={changePassword.isPending || currentPassword.length < 8 || newPassword.length < 8}>{changePassword.isPending ? "Updating…" : "Save new password"}</Button></div></form></CardContent></Card>}
      {!result.mustChangePassword && !isIncomingView && <>
        <Card className="overflow-hidden rounded-xl border-primary/15 bg-gradient-to-r from-primary/[0.06] to-transparent shadow-sm"><CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Warehouse className="h-6 w-6"/></div><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your assigned facility</p><h2 className="mt-1 text-xl font-bold">{hub.name || "Local hub"}</h2><p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0"/>{[displayLocation(hub.address), displayLocation(hub.taluk), displayLocation(hub.district), displayLocation(hub.state)].filter(Boolean).join(", ") || "Hub location details are not available. Ask the warehouse manager to update the hub address."}</p></div></div><Badge variant="outline" className="w-fit">Local Hub Manager</Badge></CardContent></Card>
        <div className="grid gap-3 sm:grid-cols-3">
          {[["Incoming", (result.counts || {}).incoming ?? 0, "Awaiting physical receipt", PackageCheck], ["Received", (result.counts || {}).received ?? 0, "Receipt confirmed", ClipboardCheck], ["Published", (result.counts || {}).published ?? 0, "Available to delivery partners", Truck]].map(([label, value, hint, Icon]: any) => <Card key={String(label)} className="rounded-xl shadow-sm"><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-muted p-2.5"><Icon className="h-5 w-5 text-primary"/></div><div className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{hint}</p></div></CardContent></Card>)}
        </div>
      </>}
      {!result.mustChangePassword && searchParams.get("view") === "delivery" && <Card className="rounded-xl shadow-sm"><CardHeader className="border-b bg-muted/20"><CardTitle>Delivery Status</CardTitle><CardDescription>Track the orders sent to delivery partners, see the assigned partner when available, and check whether each order is delivered.</CardDescription></CardHeader><CardContent className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Orders in hub workflow</p><p className="mt-1 text-2xl font-bold">{orders.length}</p></div><div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Published / in progress</p><p className="mt-1 text-2xl font-bold">{orders.filter((order: any) => Boolean(order.published) && !["delivered","completed","proof_of_delivery","pod_submitted"].includes(String(order.deliveryStatus || order.jobStatus || order.orderStatus || order.status || "").toLowerCase())).length}</p></div><div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Delivered</p><p className="mt-1 text-2xl font-bold">{orders.filter((order: any) => ["delivered","completed","proof_of_delivery","pod_submitted"].includes(String(order.deliveryStatus || order.jobStatus || order.orderStatus || order.status || "").toLowerCase())).length}</p></div></div>
        {hubsQuery.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading delivery status…</p> : orders.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center"><PackageCheck className="mx-auto mb-2 h-8 w-8 text-muted-foreground"/><p className="font-semibold">No orders to track yet</p><p className="mt-1 text-sm text-muted-foreground">Orders routed through this hub will appear here.</p></div> : orders.map((order: any) => {
          const status = String(order.deliveryStatus || order.jobStatus || order.orderStatus || order.status || "pending").toLowerCase();
          const delivered = ["delivered","completed","proof_of_delivery","pod_submitted"].includes(status);
          const published = Boolean(order.published) || ["published","assigned","out_for_delivery","in_transit"].includes(status);
          const partner = order.deliveryPartnerName || order.partnerName || order.assignedPartnerName || order.deliveryPartner?.name || order.partner?.name || order.deliveryPersonName || order.driverName;
          const address = order.deliveryAddress || order.customerAddress || order.destinationAddress || order.address;
          return <div key={order.transferId || order.orderId || order.orderNumber} className="overflow-hidden rounded-xl border"><div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/20 p-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer order</p><p className="mt-1 break-all font-semibold">{order.orderNumber || order.orderId || "Order reference unavailable"}</p><p className="mt-1 text-sm text-muted-foreground">{order.productSummary || "Order items"} · Quantity: {order.quantity ?? "—"}</p></div><Badge className={delivered ? "bg-emerald-100 text-emerald-800" : published ? "bg-blue-100 text-blue-800" : ""}>{delivered ? "Delivered" : published ? "Published / in progress" : readableStatus(status)}</Badge></div><div className="grid gap-3 p-4 md:grid-cols-3"><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Delivery status</p><p className="mt-1 font-semibold">{delivered ? "Delivered" : readableStatus(order.deliveryStatus || order.jobStatus || order.status)}</p><p className="mt-1 text-xs text-muted-foreground">{delivered ? "Delivery marked complete." : "Not confirmed delivered yet."}</p></div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Delivery partner</p><p className="mt-1 break-words font-semibold">{partner || (published ? "Assignment details unavailable" : "Not assigned yet")}</p><p className="mt-1 text-xs text-muted-foreground">{order.deliveryPartnerPhone || order.partnerPhone || order.deliveryPartner?.phone || ""}</p></div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Customer destination</p><p className="mt-1 break-words text-sm font-medium">{displayLocation(address) || "Customer delivery address is not available"}</p></div></div></div>;
        })}
      </CardContent></Card>}
      {!result.mustChangePassword && isIncomingView && <Card className="rounded-xl shadow-sm"><CardHeader className="border-b bg-muted/20 pb-4"><CardTitle>Shipment processing</CardTitle><CardDescription>Follow these steps for every order arriving from the warehouse.</CardDescription><div className="grid gap-2 pt-2 sm:grid-cols-3"><div className="flex items-center gap-2 rounded-lg border bg-background p-3"><div className="rounded-full bg-amber-100 p-1.5 text-amber-800"><PackageCheck className="h-4 w-4"/></div><div><p className="text-xs font-semibold">1. Receive shipment</p><p className="text-xs text-muted-foreground">Confirm physical arrival</p></div></div><div className="flex items-center gap-2 rounded-lg border bg-background p-3"><div className="rounded-full bg-blue-100 p-1.5 text-blue-800"><ClipboardCheck className="h-4 w-4"/></div><div><p className="text-xs font-semibold">2. Check receipt status</p><p className="text-xs text-muted-foreground">Only after goods arrive</p></div></div><div className="flex items-center gap-2 rounded-lg border bg-background p-3"><div className="rounded-full bg-emerald-100 p-1.5 text-emerald-800"><Truck className="h-4 w-4"/></div><div><p className="text-xs font-semibold">3. Publish for delivery</p><p className="text-xs text-muted-foreground">After receipt is confirmed</p></div></div></div></CardHeader><CardContent className="p-4 sm:p-5">
          {orders.length > 0 && <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Bulk order processing</p><p className="text-xs leading-5 text-muted-foreground">Confirm receipt for pending shipments, then publish every successfully received, unpublished order for delivery.</p></div><Button onClick={() => bulkProcess.mutate()} disabled={bulkProcess.isPending || hubsQuery.isLoading} className="shrink-0">{bulkProcess.isPending ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin"/>Processing all orders…</> : <><Truck className="mr-2 h-4 w-4"/>Process all orders</>}</Button></div>}
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
        </CardContent></Card>}
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
