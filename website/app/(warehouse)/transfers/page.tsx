"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Search, CheckCircle, XCircle, Clock, ArrowUpRight, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  completed: { label: "Completed", color: "border-green-200 bg-green-50 text-green-700", icon: CheckCircle },
  in_transit: { label: "In Transit", color: "border-blue-200 bg-blue-50 text-blue-700", icon: ArrowUpRight },
  pending: { label: "Pending", color: "border-yellow-200 bg-yellow-50 text-yellow-700", icon: Clock },
  cancelled: { label: "Cancelled", color: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
};

export default function WarehouseTransfersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ toWarehouseId: "", productId: "", variantId: "", quantity: "1", reason: "" });
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseTransfers", statusFilter],
    queryFn: () => api.get("/warehouse/me/transfers", { params: { status: statusFilter === "all" ? undefined : statusFilter, limit: 100 } }),
  });

  const transfers = useMemo(() => data?.data?.transfers || [], [data]);
  const filtered = useMemo(() => transfers.filter((t: any) => {
    const q = search.toLowerCase();
    return !q || [t.id, t.productName, t.productId, t.reason, t.batchNumber].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  }), [transfers, search]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.toWarehouseId || !form.productId || Number(form.quantity) <= 0 || !form.reason.trim()) {
      toast.error("Destination, product, quantity and reason are required");
      return;
    }
    setSaving(true);
    try {
      await api.post("/warehouse/me/transfers", {
        toWarehouseId: form.toWarehouseId.trim(),
        productId: form.productId.trim(),
        variantId: form.variantId.trim() || undefined,
        quantity: Number(form.quantity),
        reason: form.reason.trim(),
      });
      toast.success("Transfer created");
      setDialogOpen(false);
      setForm({ toWarehouseId: "", productId: "", variantId: "", quantity: "1", reason: "" });
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create transfer");
    } finally {
      setSaving(false);
    }
  };

  const complete = async (id: string) => {
    try {
      await api.put(`/warehouse/me/transfers/${id}/complete`);
      toast.success("Transfer completed");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Failed to complete transfer");
    }
  };

  const active = transfers.filter((t: any) => t.status === "in_transit").length;
  const pending = transfers.filter((t: any) => t.status === "pending").length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Transfers</h1><p className="text-sm text-muted-foreground">Live stock movement between facilities</p></div>
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" /> New Transfer</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{transfers.length}</p><p className="text-xs text-muted-foreground">Loaded Transfers</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-blue-600">{active}</p><p className="text-xs text-muted-foreground">In Transit</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-yellow-600">{pending}</p><p className="text-xs text-muted-foreground">Pending</p></CardContent></Card>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search transfers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" /></div>
        <div className="flex gap-2 overflow-x-auto">{["all","pending","in_transit","completed","cancelled"].map((s) => <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>{s === "in_transit" ? "In Transit" : s[0].toUpperCase()+s.slice(1)}</Button>)}</div>
      </div>
      {isLoading ? <Card><CardContent className="p-8 text-center">Loading transfers…</CardContent></Card> : filtered.length === 0 ? <Card><CardContent className="p-8 text-center">No transfers found.</CardContent></Card> : <div className="space-y-3">{filtered.map((t: any) => { const cfg=statusConfig[t.status]||statusConfig.pending; const Icon=cfg.icon; return <Card key={t.id}><CardContent className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-full bg-slate-100 p-2"><ArrowLeftRight className="h-5 w-5 text-slate-600"/></div><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{t.id}</p><Badge className={cfg.color}><Icon className="mr-1 h-3 w-3"/>{cfg.label}</Badge></div><p className="mt-1 text-sm">{t.productName || t.productId} · {t.quantity}</p><p className="text-xs text-muted-foreground">{t.fromWarehouseName || t.fromWarehouseId} → {t.toWarehouseName || t.toWarehouseId}</p><p className="text-xs text-muted-foreground">{t.reason}</p></div></div><div className="text-right text-sm"><p className="text-muted-foreground">{t.createdAt ? formatDate(t.createdAt) : "—"}</p>{t.status !== "completed" && t.status !== "cancelled" && t.toWarehouseId && <Button variant="outline" size="sm" onClick={() => complete(t.id)}>Mark Received</Button>}</div></div></CardContent></Card>})}</div>}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent><DialogHeader><DialogTitle>Create Transfer</DialogTitle></DialogHeader><form className="space-y-3" onSubmit={submit}><Input placeholder="Destination warehouse ID" value={form.toWarehouseId} onChange={e=>setForm({...form,toWarehouseId:e.target.value})} required/><Input placeholder="Product ID" value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})} required/><Input placeholder="Variant ID (optional)" value={form.variantId} onChange={e=>setForm({...form,variantId:e.target.value})}/><Input type="number" min="1" placeholder="Quantity" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})} required/><Input placeholder="Reason" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} required/><Button type="submit" disabled={saving} className="w-full">{saving ? "Creating…" : "Create Transfer"}</Button></form></DialogContent></Dialog>
    </div>
  );
}
