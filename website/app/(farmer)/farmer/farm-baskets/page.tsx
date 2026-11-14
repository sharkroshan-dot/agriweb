"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ShoppingBasket,
  Plus,
  Pencil,
  Trash2,
  X,
  Users,
  PackageCheck,
  Leaf,
  Star,
  Bell,
  CalendarDays,
  Package,
  Search,
} from "lucide-react";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { api } from "../../../lib/api/client";
import { cn, formatPrice, formatDate } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import toast from "react-hot-toast";

interface BasketItem {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

interface BasketPlan {
  id: string;
  name: string;
  description?: string;
  cadence: string;
  day: string;
  price: number;
  items: BasketItem[];
  farmerId: string;
  farmerName: string;
  maxSubscribers: number;
  subscriberCount: number;
  deliveryMode: "delivery" | "pickup";
  status: "active" | "disabled";
  rating?: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  unit?: string;
  isBasketOnly?: boolean;
}

const WEEKDAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const FALLBACK_CATEGORIES = [
  { id: "vegetables", name: "Vegetables" },
  { id: "fruits", name: "Fruits" },
  { id: "dairy", name: "Dairy" },
  { id: "grains", name: "Grains" },
  { id: "spices", name: "Spices" },
  { id: "herbs", name: "Herbs" },
  { id: "poultry", name: "Poultry" },
  { id: "meat", name: "Meat" },
  { id: "seafood", name: "Seafood" },
  { id: "nuts-seeds", name: "Nuts & Seeds" },
  { id: "beverages", name: "Beverages" },
  { id: "organic", name: "Organic" },
];

const PRODUCT_UNITS = ["kg", "g", "piece", "bunch", "liter", "ml", "dozen"];

const emptyForm = {
  name: "",
  description: "",
  cadence: "weekly",
  day: "Saturday",
  price: "",
  maxSubscribers: "50",
  deliveryMode: "delivery" as "delivery" | "pickup",
};

export default function FarmerFarmBasketsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"baskets" | "create" | "subscribers" | "orders">("baskets");
  const [basketSearch, setBasketSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [adjustPlanId, setAdjustPlanId] = useState<string | null>(null);
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustPrice, setAdjustPrice] = useState("");
  const [showManualProduct, setShowManualProduct] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [manualProduct, setManualProduct] = useState({ name: "", categoryId: "vegetables", price: "", unit: "kg" });
  const [hiddenFromBasket, setHiddenFromBasket] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("basketHiddenProducts") : null;
      return raw ? new Set<string>(JSON.parse(raw)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const persistHidden = (next: Set<string>) => {
    setHiddenFromBasket(next);
    try {
      window.localStorage.setItem("basketHiddenProducts", JSON.stringify([...next]));
    } catch {
      // ignore storage failures
    }
  };

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ["farmerBasketPlans"],
    queryFn: () => api.get("/subscriptions/plans/my"),
  });

  const { data: productsData } = useQuery({
    queryKey: ["farmerProductsForBasket"],
    queryFn: () => api.get("/farmers/me/products", { params: { limit: 100, includeBasketOnly: true } }),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["productCategoriesForBasket"],
    queryFn: () => api.get("/products/categories"),
  });

  const { data: subsData, isLoading: subsLoading } = useQuery({
    queryKey: ["basketSubscribers", selectedPlanId],
    queryFn: () => api.get(`/subscriptions/plans/${selectedPlanId}/subscribers`),
    enabled: Boolean(selectedPlanId),
  });

  const { data: ordersData, isLoading: ordersLoading } = useQuery({
    queryKey: ["farmerBasketOrders"],
    queryFn: () => api.get("/subscriptions/plans/my/orders", { params: { limit: 50 } }),
  });

  const plans: BasketPlan[] = useMemo(() => plansData?.data?.plans || [], [plansData]);
  const products: Product[] = useMemo(
    () => (productsData?.data?.products || []).filter((p: Product) => !hiddenFromBasket.has(p.id)),
    [productsData, hiddenFromBasket]
  );
  const categories = useMemo(() => {
    const list = Array.isArray(categoriesData) ? categoriesData : categoriesData?.data || [];
    return Array.isArray(list) && list.length > 0 ? list : FALLBACK_CATEGORIES;
  }, [categoriesData]);
  const subscribers = useMemo(() => subsData?.data?.subscribers || [], [subsData]);
  const orders = useMemo(() => ordersData?.data?.orders || [], [ordersData]);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const activePlans = plans.filter((plan) => plan.status === "active");
  const totalSubscribers = plans.reduce((sum, plan) => sum + Number(plan.subscriberCount || 0), 0);
  const totalBasketProducts = new Set(plans.flatMap((plan) => plan.items.map((item) => item.productId))).size;
  const visiblePlans = plans.filter((plan) => {
    const query = basketSearch.trim().toLowerCase();
    if (!query) return true;
    return [plan.name, plan.description, plan.cadence, plan.day, ...plan.items.map((item) => item.name)]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
  const editingPlan = plans.find((p) => p.id === editingId);
  const displayProducts: Product[] = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    if (editingPlan) {
      editingPlan.items.forEach((it) => {
        if (!map.has(it.productId)) {
          map.set(it.productId, {
            id: it.productId,
            name: it.name,
            price: it.unitPrice,
            unit: it.unit,
            isBasketOnly: true,
          });
        }
      });
    }
    return [...map.values()];
  }, [products, editingPlan]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["farmerBasketPlans"] });
    queryClient.invalidateQueries({ queryKey: ["basketSubscribers"] });
    queryClient.invalidateQueries({ queryKey: ["farmerBasketOrders"] });
  };

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/subscriptions/plans", body),
    onSuccess: () => {
      toast.success("Basket created");
      resetForm();
      invalidate();
      setTab("baskets");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to create basket"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.put(`/subscriptions/plans/${id}`, body),
    onSuccess: () => {
      toast.success("Basket updated");
      resetForm();
      invalidate();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update basket"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/subscriptions/plans/${id}`),
    onSuccess: () => {
      toast.success("Basket deleted");
      resetForm();
      invalidate();
      setTab("baskets");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to delete basket"),
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, note, price }: { id: string; note: string; price?: string }) =>
      api.post(`/subscriptions/plans/${id}/weekly-adjust`, {
        note,
        ...(price ? { priceAdjustment: Number(price) } : {}),
      }),
    onSuccess: () => {
      toast.success("Subscribers notified");
      setAdjustPlanId(null);
      setAdjustNote("");
      setAdjustPrice("");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to notify subscribers"),
  });

  function resetForm() {
    setForm(emptyForm);
    setSelectedItems({});
    setEditingId(null);
  }

  async function handleManualCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = manualProduct.name.trim();
    const price = parseFloat(manualProduct.price);
    if (!name || !price || price <= 0) {
      toast.error("Enter a product name and a valid price");
      return;
    }
    setCreatingProduct(true);
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const res: any = await api.post("/products/", {
        name,
        slug: slug || "product",
        categoryId: manualProduct.categoryId,
        price,
        unit: manualProduct.unit,
        quantity: 1,
        description: "",
        isActive: true,
        isBasketOnly: true,
      });
      const created = res?.data || res;
      const newId = created?.id || created?._id;
      await queryClient.invalidateQueries({ queryKey: ["farmerProductsForBasket"] });
      toast.success("Product created");
      setManualProduct({ name: "", categoryId: "vegetables", price: "", unit: "kg" });
      setShowManualProduct(false);
      if (newId) {
        setSelectedItems((prev) => ({ ...prev, [newId]: "1" }));
      }
    } catch (err: any) {
      const message = err?.message || "Failed to create product";
      toast.error(message.replace(/^"|"$/g, "").slice(0, 160));
    } finally {
      setCreatingProduct(false);
    }
  }

  function handleRemoveFromBasket(id: string) {
    setSelectedItems((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast.success("Removed from basket");
  }

  async function handleDeleteProduct(id: string) {
    try {
      const allPlans: BasketPlan[] = plansData?.data?.plans || [];
      for (const plan of allPlans) {
        if (plan.items.some((i) => i.productId === id)) {
          const next = plan.items.filter((i) => i.productId !== id);
          try {
            await api.put(`/subscriptions/plans/${plan.id}`, { items: next });
          } catch (e) {
            // keep going even if one plan update fails
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["farmerProductsForBasket"] });
      await queryClient.invalidateQueries({ queryKey: ["farmerBasketPlans"] });
      setSelectedItems((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      persistHidden(new Set([...hiddenFromBasket, id]));
      toast.success("Product removed from all baskets");
    } catch (err: any) {
      const message = err?.message || "Failed to remove product from baskets";
      toast.error(message.replace(/^"|"$/g, "").slice(0, 160));
    }
  }

  function openEdit(plan: BasketPlan) {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      description: plan.description || "",
      cadence: plan.cadence,
      day: plan.day,
      price: String(plan.price),
      maxSubscribers: String(plan.maxSubscribers),
      deliveryMode: plan.deliveryMode,
    });
    const sel: Record<string, string> = {};
    plan.items.forEach((it) => (sel[it.productId] = String(it.quantity)));
    setSelectedItems(sel);
    setTab("create");
  }

  function handleSubmit() {
    const items: BasketItem[] = Object.entries(selectedItems)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([productId, qty]) => {
        const p = displayProducts.find((x) => x.id === productId);
        return {
          productId,
          name: p?.name || "Item",
          quantity: Number(qty),
          unit: p?.unit || "kg",
          unitPrice: p?.price || 0,
        };
      });
    if (items.length === 0) {
      toast.error("Add at least one product with a quantity");
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      cadence: form.cadence,
      day: form.day,
      price: Number(form.price),
      maxSubscribers: Number(form.maxSubscribers),
      deliveryMode: form.deliveryMode,
      items,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const tabs = [
    { key: "baskets" as const, label: "My Baskets", icon: ShoppingBasket },
    { key: "create" as const, label: editingId ? "Edit Basket" : "Create Basket", icon: Plus },
    { key: "subscribers" as const, label: "Subscribers", icon: Users },
    { key: "orders" as const, label: "Basket Orders", icon: PackageCheck },
  ];

  const itemLabel = (i: BasketItem) =>
    `${i.name} · ${i.quantity} ${i.unit}`;

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Subscriptions & recurring produce"
        title="Farm Baskets"
        description="Create recurring produce baskets, manage subscribers and track scheduled basket orders."
      >
        <Button className="h-10 bg-emerald-700 shadow-sm hover:bg-emerald-800" onClick={() => { resetForm(); setTab("create"); }}>
          <Plus className="mr-2 h-4 w-4" />Create Basket
        </Button>
      </FarmerPageHeader>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Total baskets", value: plans.length, icon: ShoppingBasket, tone: "bg-slate-100 text-slate-700" },
          { label: "Active baskets", value: activePlans.length, icon: Leaf, tone: "bg-emerald-50 text-emerald-700" },
          { label: "Subscribers", value: totalSubscribers, icon: Users, tone: "bg-blue-50 text-blue-700" },
          { label: "Basket products", value: totalBasketProducts, icon: Package, tone: "bg-amber-50 text-amber-700" },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-200 shadow-sm">
            <CardContent className="flex items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{plansLoading ? "—" : stat.value}</p>
              </div>
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", stat.tone)}>
                <stat.icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <nav aria-label="Farm basket sections" className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
              tab === t.key ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800"
            )}
          >
            <t.icon className="h-4 w-4 shrink-0" />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {tab === "baskets" && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="text-base font-semibold text-slate-900">Your basket plans</h2><p className="mt-1 text-sm text-slate-500">{visiblePlans.length} of {plans.length} baskets</p></div>
            <div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={basketSearch} onChange={(event) => setBasketSearch(event.target.value)} placeholder="Search baskets or products..." aria-label="Search farm baskets" className="h-10 w-full bg-white pl-9 text-sm" /></div>
          </div>
          {plansLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : plans.length === 0 ? (
            <Card className="border-dashed border-slate-300 shadow-none">
              <CardContent className="flex flex-col items-center py-14 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><ShoppingBasket className="h-7 w-7" /></span>
                <p className="mt-4 text-base font-semibold text-slate-900">No farm baskets yet</p>
                <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">Create your first recurring basket to offer subscribers a regular selection of fresh farm produce.</p>
                <Button className="mt-5 bg-emerald-700 hover:bg-emerald-800" onClick={() => setTab("create")}><Plus className="mr-2 h-4 w-4" />Create Basket</Button>
              </CardContent>
            </Card>
          ) : visiblePlans.length === 0 ? (
            <Card className="border-dashed border-slate-300 shadow-none"><CardContent className="flex flex-col items-center py-12 text-center"><Search className="h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-semibold text-slate-800">No matching baskets</p><p className="mt-1 text-sm text-slate-500">Try another basket or product name.</p><Button className="mt-3" size="sm" variant="outline" onClick={() => setBasketSearch("")}>Clear search</Button></CardContent></Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {visiblePlans.map((p) => (
                <Card key={p.id} className="overflow-hidden rounded-2xl border-slate-200 shadow-sm transition-all hover:border-emerald-200 hover:shadow-md">
                  <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                          <ShoppingBasket className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-lg font-bold tracking-tight text-slate-950">{p.name}</CardTitle>
                          <CardDescription className="mt-1 flex flex-wrap items-center gap-1.5 text-xs capitalize"><CalendarDays className="h-3.5 w-3.5" />{p.cadence} · {p.day}</CardDescription>
                        </div>
                      </div>
                      <Badge variant={p.status === "active" ? "success" : "secondary"}>
                        {p.status === "active" ? "Active" : "Disabled"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 p-5">
                    {p.description && <p className="text-sm leading-5 text-slate-600">{p.description}</p>}
                    <div className="flex items-end justify-between gap-3 rounded-xl bg-emerald-50/70 p-3">
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Basket price</p><p className="mt-1 text-2xl font-bold tracking-tight text-emerald-900">{formatPrice(p.price)}</p><p className="text-xs capitalize text-emerald-800">per {p.cadence === "weekly" ? "week" : p.cadence === "biweekly" ? "two weeks" : "month"}</p></div>
                      <Badge variant={p.deliveryMode === "pickup" ? "secondary" : "outline"} className="border-emerald-200 bg-white text-emerald-800">{p.deliveryMode === "pickup" ? "Farm pickup" : "Farm delivery"}</Badge>
                    </div>
                    <div className="space-y-1.5">
                      {p.items.map((i) => (
                        <div key={i.productId} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
                          <span className="truncate">{itemLabel(i)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
                      <span className="text-slate-600">
                        <Users className="mr-1 inline h-4 w-4" />
                        {p.subscriberCount} / {p.maxSubscribers} subscribers
                      </span>
                      {p.rating ? (
                        <span className="flex items-center gap-1 text-yellow-600">
                          <Star className="h-4 w-4 fill-current" /> {p.rating.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSelectedPlanId(p.id); setTab("subscribers"); }}
                        >
                          <Users className="mr-1.5 h-3.5 w-3.5" /> Subscribers
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-emerald-600"
                          onClick={() => { setAdjustPlanId(p.id); setAdjustNote(""); setAdjustPrice(""); }}
                        >
                          <Bell className="mr-1.5 h-3.5 w-3.5" /> Adjust & Notify
                        </Button>
                      </div>
                      </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "create" && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle>{editingId ? "Edit Basket" : "Create Farm Basket"}</CardTitle>
              <CardDescription>Define the basket schedule, price and contents.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Basket Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Weekly Fresh Farm Basket" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Seasonal veggies straight from the farm"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Frequency</label>
                  <Select value={form.cadence} onValueChange={(v) => setForm({ ...form, cadence: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Bi-weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Delivery Day</label>
                  <Select value={form.day} onValueChange={(v) => setForm({ ...form, day: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                      <SelectItem value="1st of month">1st of month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Price (Rs)</label>
                  <Input type="number" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="699" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Max Subscribers</label>
                  <Input type="number" min="1" value={form.maxSubscribers} onChange={(e) => setForm({ ...form, maxSubscribers: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Delivery</label>
                  <Select value={form.deliveryMode} onValueChange={(v) => setForm({ ...form, deliveryMode: v as "delivery" | "pickup" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delivery">Farm Delivery</SelectItem>
                      <SelectItem value="pickup">Farm Pickup</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Basket Products</CardTitle>
                  <CardDescription>Select your products and set quantities per delivery.</CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowManualProduct(!showManualProduct)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Manually add product
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {showManualProduct && (
                <form onSubmit={handleManualCreate} className="space-y-3 rounded-lg border border-dashed border-emerald-300 bg-emerald-50/50 p-3">
                  <p className="text-xs font-medium text-emerald-700">Create a new product to include in this basket — it will be visible only to subscribers, not on the public product page.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Product Name *</label>
                      <Input value={manualProduct.name} onChange={(e) => setManualProduct({ ...manualProduct, name: e.target.value })} placeholder="e.g. Organic Spinach" required />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Category *</label>
                      <select value={manualProduct.categoryId} onChange={(e) => setManualProduct({ ...manualProduct, categoryId: e.target.value })} className="w-full rounded-md border px-3 py-2 text-sm">
                        {categories.map((c: any) => (
                          <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Price per unit (Rs) *</label>
                      <Input type="number" min="0.01" step="0.01" value={manualProduct.price} onChange={(e) => setManualProduct({ ...manualProduct, price: e.target.value })} placeholder="40" required />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-500">Unit</label>
                      <select value={manualProduct.unit} onChange={(e) => setManualProduct({ ...manualProduct, unit: e.target.value })} className="w-full rounded-md border px-3 py-2 text-sm">
                        {PRODUCT_UNITS.map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowManualProduct(false)}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={creatingProduct}>
                      {creatingProduct ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Leaf className="mr-1.5 h-4 w-4" />}
                      {creatingProduct ? "Creating..." : "Create & Add to Basket"}
                    </Button>
                  </div>
                </form>
              )}
              {displayProducts.length === 0 ? (
                <p className="text-sm text-slate-500">No products listed yet. Add products first or create one above.</p>
              ) : (
                displayProducts.map((p) => (
                  <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-200 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {p.name}
                        {p.isBasketOnly && (
                          <Badge variant="secondary" className="ml-2 align-middle text-[10px]">
                            Subscribers only
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">{formatPrice(p.price)}{p.unit ? ` / ${p.unit}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        className="h-10 w-24 text-sm"
                        placeholder="0 kg"
                        value={selectedItems[p.id] || ""}
                        onChange={(e) => setSelectedItems({ ...selectedItems, [p.id]: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove from basket"
                        aria-label={`Remove ${p.name} from basket`}
                        onClick={() => handleRemoveFromBasket(p.id)}
                      >
                        <X className="h-4 w-4 text-slate-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove from all baskets"
                        aria-label={`Remove ${p.name} from all baskets`}
                        onClick={() => {
                          if (window.confirm(`Remove "${p.name}" from all baskets? It stays on the product page.`)) {
                            handleDeleteProduct(p.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <div className="xl:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex gap-2">
              {editingId && (
                <Button
                  variant="outline"
                  className="text-red-500 hover:bg-red-50"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete "${form.name}"? This permanently deletes this basket and its subscription plan.`)) {
                      deleteMutation.mutate(editingId);
                    }
                  }}
                >
                  {deleteMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
                  Delete Basket
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !form.name || !form.price}
              >
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Leaf className="mr-2 h-4 w-4" />}
                {editingId ? "Update Basket" : "Create Basket"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {tab === "subscribers" && (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-lg font-semibold text-slate-900">Subscribers</CardTitle>
              <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select a basket" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {selectedPlan && (
              <CardDescription>
                {selectedPlan.subscriberCount} / {selectedPlan.maxSubscribers} subscribed · {formatPrice(selectedPlan.price)}/{selectedPlan.cadence}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {!selectedPlanId ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Select a basket to view its subscribers.</div>
            ) : subsLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : subscribers.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">No active subscribers yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-3 font-medium">Customer</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Week</th>
                      <th className="px-6 py-3 font-medium">Next Delivery</th>
                      <th className="px-6 py-3 font-medium">Subscribed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map((s: any) => (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-emerald-50/40">
                        <td className="px-6 py-4 font-medium">{s.customerName}</td>
                        <td className="px-6 py-4">
                          <Badge variant={s.status === "active" ? "success" : "secondary"}>
                            <span className="capitalize">{s.status}</span>
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-slate-600">Week {s.weekNumber}</td>
                        <td className="px-6 py-4 text-slate-600">{s.nextDelivery ? formatDate(s.nextDelivery) : "—"}</td>
                        <td className="px-6 py-4 text-slate-600">{s.createdAt ? formatDate(s.createdAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "orders" && (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50">
            <CardTitle className="text-lg font-semibold text-slate-900">Basket Orders</CardTitle>
            <CardDescription>Recurring orders generated from your baskets.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {ordersLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : orders.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                No basket orders yet. Orders are generated automatically on each delivery day.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-3 font-medium">Order</th>
                      <th className="px-6 py-3 font-medium">Delivery Date</th>
                      <th className="px-6 py-3 font-medium">Total</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Payment</th>
                      <th className="px-6 py-3 font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o: any) => (
                      <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-emerald-50/40">
                        <td className="px-6 py-4 font-medium">{o.orderNumber}</td>
                        <td className="px-6 py-4 text-slate-600">{o.deliveryDate ? formatDate(o.deliveryDate) : "—"}</td>
                        <td className="px-6 py-4 font-medium">{formatPrice(o.totalAmount)}</td>
                        <td className="px-6 py-4"><Badge variant="secondary" className="capitalize">{o.orderStatus}</Badge></td>
                        <td className="px-6 py-4 text-slate-600 capitalize">{o.paymentStatus}</td>
                        <td className="px-6 py-4 text-slate-600 capitalize">{o.deliveryType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!adjustPlanId} onOpenChange={(open) => { if (!open) { setAdjustPlanId(null); setAdjustNote(""); setAdjustPrice(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust This Week's Basket</DialogTitle>
            <DialogDescription>
              Notify subscribers about availability changes. Your message is delivered to every active subscriber.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Optional price adjustment (Rs)</label>
              <Input type="number" min="0" value={adjustPrice} onChange={(e) => setAdjustPrice(e.target.value)} placeholder="e.g. 649" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Message to subscribers</label>
              <textarea
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="e.g. Lower tomato availability this week — basket adjusted with extra carrots."
                rows={3}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setAdjustPlanId(null); setAdjustNote(""); setAdjustPrice(""); }}>Cancel</Button>
              <Button
                disabled={adjustMutation.isPending || adjustNote.trim().length < 5}
                onClick={() => adjustPlanId && adjustMutation.mutate({ id: adjustPlanId, note: adjustNote, price: adjustPrice || undefined })}
              >
                {adjustMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
                Notify Subscribers
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}