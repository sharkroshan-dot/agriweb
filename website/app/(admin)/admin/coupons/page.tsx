"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, RefreshCw, Pencil, Trash2, Copy, ToggleLeft, ToggleRight } from "lucide-react";
import toast from "react-hot-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { api } from "../../../lib/api/client";
import { formatPrice, formatDate, cn } from "../../../lib/utils";

type DiscountType = "percentage" | "fixed";
type CouponStatus = "active" | "expired" | "disabled";

interface Coupon {
  id: number;
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderValue: number;
  maxDiscount?: number;
  usageLimit?: number;
  usedCount: number;
  status: CouponStatus;
  expiresAt: string;
  createdAt?: string;
}

interface CouponForm {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: string;
  minOrderValue: string;
  maxDiscount: string;
  usageLimit: string;
  expiresAt: string;
}

const emptyForm: CouponForm = {
  code: "",
  description: "",
  discountType: "percentage",
  discountValue: "",
  minOrderValue: "0",
  maxDiscount: "",
  usageLimit: "",
  expiresAt: "",
};

const statusConfig: Record<CouponStatus, { label: string; variant: "success" | "destructive" | "secondary" }> = {
  active: { label: "Active", variant: "success" },
  expired: { label: "Expired", variant: "destructive" },
  disabled: { label: "Disabled", variant: "secondary" },
};

export default function AdminCouponsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CouponForm>(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["coupons", "admin"],
    queryFn: () =>
      api.get<{ coupons: Coupon[]; total: number }>("/coupons", {
        params: { limit: 100 },
      }),
  });

  const allCoupons: Coupon[] = useMemo(() => {
    const list = (data as any)?.coupons || (data as any)?.data?.coupons || (Array.isArray(data) ? data : []);
    return list.map((c: any) => ({
      id: c._id || c.id,
      code: c.code || "",
      description: c.description || "",
      discountType: c.discountType || c.discount_type || "percentage",
      discountValue: Number(c.discountValue ?? c.discount_value ?? 0),
      minOrderValue: Number(c.minOrderValue ?? c.min_order_value ?? 0),
      maxDiscount: c.maxDiscount != null ? Number(c.maxDiscount) : c.max_discount != null ? Number(c.max_discount) : undefined,
      usageLimit: c.usageLimit != null ? Number(c.usageLimit) : c.usage_limit != null ? Number(c.usage_limit) : undefined,
      usedCount: Number(c.usedCount ?? c.used_count ?? 0),
      status: c.status || "active",
      expiresAt: c.expiresAt || c.expires_at || "",
      createdAt: c.createdAt || c.created_at,
    }));
  }, [data]);

  const coupons = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCoupons;
    return allCoupons.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q)
    );
  }, [allCoupons, query]);

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/coupons", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["customerCoupons"] });
      closeDialog();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create coupon"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api.put(`/coupons/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["customerCoupons"] });
      closeDialog();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update coupon"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/coupons/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coupons", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["customerCoupons"] });
      setDeleteConfirm(null);
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: CouponStatus }) => api.put(`/coupons/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["coupons", "admin"] }),
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(true);
  }

  function openEdit(coupon: Coupon) {
    setForm({
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: String(coupon.discountValue),
      minOrderValue: String(coupon.minOrderValue),
      maxDiscount: coupon.maxDiscount != null ? String(coupon.maxDiscount) : "",
      usageLimit: coupon.usageLimit != null ? String(coupon.usageLimit) : "",
      expiresAt: coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : "",
    });
    setEditingId(coupon.id);
    setDialogOpen(true);
  }

  function handleSubmit() {
    const body: Record<string, unknown> = {
      code: form.code.toUpperCase(),
      description: form.description,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      minOrderValue: Number(form.minOrderValue) || 0,
    };
    if (form.maxDiscount) body.maxDiscount = Number(form.maxDiscount);
    if (form.usageLimit) body.usageLimit = Number(form.usageLimit);
    if (form.expiresAt) body.expiresAt = form.expiresAt;

    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  }

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
    } catch { /* ignore */ }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Coupons</h1>
          <p className="text-sm text-muted-foreground">Create, manage, and monitor promotional coupon codes.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ["coupons", "admin"] })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Create Coupon
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or description..."
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>All Coupons</CardTitle>
          <CardDescription>{coupons.length} coupon{coupons.length !== 1 ? "s" : ""} found</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading coupons...</div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <p className="text-sm text-red-500">Failed to load coupons. Check the backend / network.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : coupons.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">No coupons found. Create one to get started.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-6 py-3 font-medium">Code</th>
                    <th className="px-6 py-3 font-medium">Description</th>
                    <th className="px-6 py-3 font-medium">Type</th>
                    <th className="px-6 py-3 font-medium">Value</th>
                    <th className="px-6 py-3 font-medium">Min Order</th>
                    <th className="px-6 py-3 font-medium">Usage</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Expires</th>
                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => {
                    const statusConf = statusConfig[coupon.status] || statusConfig.active;
                    const isExpired = coupon.expiresAt ? new Date(coupon.expiresAt) < new Date() : false;
                    return (
                      <tr key={coupon.id} className="border-b last:border-0 hover:bg-slate-50/50">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-800">
                              {coupon.code}
                            </code>
                            <button
                              onClick={() => handleCopyCode(coupon.code)}
                              className="text-muted-foreground hover:text-slate-700"
                              title="Copy code"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        <td className="max-w-[200px] truncate px-6 py-4 text-slate-600">{coupon.description || "—"}</td>
                        <td className="px-6 py-4 capitalize">{coupon.discountType}</td>
                        <td className="px-6 py-4 font-medium">
                          {coupon.discountType === "percentage" ? `${coupon.discountValue}%` : formatPrice(coupon.discountValue)}
                        </td>
                        <td className="px-6 py-4 text-slate-600">{formatPrice(coupon.minOrderValue)}</td>
                        <td className="px-6 py-4 text-slate-600">
                          {coupon.usedCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant={statusConf.variant}>{statusConf.label}</Badge>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-600">
                          {coupon.expiresAt ? formatDate(coupon.expiresAt) : "No expiry"}
                          {isExpired && <span className="ml-1 text-red-500">(expired)</span>}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(coupon)}
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                toggleStatusMutation.mutate({
                                  id: coupon.id,
                                  status: coupon.status === "active" ? "disabled" : "active",
                                })
                              }
                              title={coupon.status === "active" ? "Disable" : "Activate"}
                            >
                              {coupon.status === "active" ? (
                                <ToggleRight className="h-4 w-4 text-emerald-600" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(coupon.id)}
                              title="Delete"
                              className="text-red-500 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Coupon" : "Create Coupon"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Update the coupon details below." : "Fill in the details to create a new coupon code."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Code</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="SUMMER20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Discount Type</label>
                <Select
                  value={form.discountType}
                  onValueChange={(v) => setForm({ ...form, discountType: v as DiscountType })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Seasonal discount on produce"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Discount Value {form.discountType === "percentage" ? "(%)" : "(Rs)"}
                </label>
                <Input
                  type="number"
                  min="0"
                  value={form.discountValue}
                  onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                  placeholder="20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Min Order Value (Rs)</label>
                <Input
                  type="number"
                  min="0"
                  value={form.minOrderValue}
                  onChange={(e) => setForm({ ...form, minOrderValue: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Max Discount (Rs)</label>
                <Input
                  type="number"
                  min="0"
                  value={form.maxDiscount}
                  onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                  placeholder="Unlimited"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Usage Limit</label>
                <Input
                  type="number"
                  min="0"
                  value={form.usageLimit}
                  onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                  placeholder="Unlimited"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Expiry Date</label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={isSubmitting || !form.code || !form.discountValue}>
                {isSubmitting ? "Saving..." : editingId ? "Update Coupon" : "Create Coupon"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Coupon</DialogTitle>
            <DialogDescription>Are you sure you want to delete this coupon? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}