"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import {
  Plus, Search, Trash2, Edit, Eye, MoreVertical, Package,
  AlertCircle, Boxes, CheckCircle2, AlertTriangle, X, RefreshCw,
  PackagePlus, Layers, RotateCcw, ChevronRight, Loader2,
} from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../../components/ui/dialog";
import { cn, formatPrice } from "../../../lib/utils";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";

const statusFilters = [
  { value: "all", label: "All products" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "pending_review", label: "Pending review" },
];

export default function FarmerProductsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"products" | "stock" | "restocking">("products");
  const [restockQty, setRestockQty] = useState<Record<string, string>>({});
  const [restockSearch, setRestockSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: productsData, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["farmerProducts", searchTerm, filterStatus],
    queryFn: () => api.get("/farmers/me/products", {
      params: { search: searchTerm || undefined, status: filterStatus !== "all" ? filterStatus : undefined, limit: 50 },
    }),
    retry: 1,
  });

  const products = productsData?.data?.products || [];
  const { data: inventoryData, isLoading: inventoryLoading, refetch: refetchInventory } = useQuery({
    queryKey: ["farmerInventorySummary"],
    queryFn: () => api.get("/inventory/farmer/summary"),
  });
  const inventory = inventoryData?.data;
  const inventoryItems = (inventory?.products || []).map((item: any) => ({
    ...item,
    total_stock: item.total_stock ?? item.available_stock ?? 0,
    available_stock: item.available_stock ?? 0,
    reserved_stock: item.reserved_stock ?? 0,
    sold_stock: item.sold_stock ?? 0,
  })).sort((a: any, b: any) => Number(a.available_stock) - Number(b.available_stock));
  const filteredRestockItems = inventoryItems.filter((item: any) => {
    const query = restockSearch.trim().toLocaleLowerCase();
    if (!query) return true;
    return [item.product_name, item.product_id, item.product_slug]
      .some((value) => String(value || "").toLocaleLowerCase().includes(query));
  });
  const restockMutation = useMutation({
    mutationFn: (payload: { productId: string; quantity: number }) => api.put(`/products/${payload.productId}/inventory`, { quantity: payload.quantity, operation: "restock" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerInventorySummary"] });
      queryClient.invalidateQueries({ queryKey: ["farmerProducts"] });
      toast.success("Stock updated successfully");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update stock"),
  });
  const submitRestock = (productId: string) => {
    const quantity = Number(restockQty[productId]);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Enter a quantity greater than zero");
      return;
    }
    restockMutation.mutate({ productId, quantity });
  };
  const inventorySummary = useMemo(() => ({
    total: products.length,
    active: products.filter((p: any) => p.status === "active").length,
    lowStock: products.filter((p: any) => Number(p.availableQuantity ?? p.quantity ?? 0) > 0 && Number(p.availableQuantity ?? p.quantity ?? 0) <= 10).length,
    outOfStock: products.filter((p: any) => p.status === "out_of_stock" || Number(p.availableQuantity ?? p.quantity ?? 0) <= 0).length,
  }), [products]);

  const handleDeleteProduct = async () => {
    if (!selectedProduct) return;
    try {
      await api.delete(`/products/${selectedProduct.id}`);
      toast.success("Product deleted successfully");
      setShowDeleteDialog(false);
      setSelectedProduct(null);
      refetch();
    } catch {
      toast.error("Failed to delete product");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge variant="success">Active</Badge>;
      case "inactive": return <Badge variant="secondary">Inactive</Badge>;
      case "out_of_stock": return <Badge variant="destructive">Out of stock</Badge>;
      case "pending_review": return <Badge variant="warning">Pending review</Badge>;
      default: return <Badge variant="outline">{status?.replaceAll("_", " ") || "Unknown"}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <div key={i} className="h-80 animate-pulse rounded-2xl bg-slate-100" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 pb-8">
      <FarmerPageHeader
        title="Products & Inventory"
        description="Manage product listings, monitor available stock and restock your produce from one workspace."
        actionHref="/farmer/products/new"
        actionLabel="Add product"
        actionIcon="plus"
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Products and inventory sections">
          {([
            { id: "products", label: "Products", icon: Package, hint: "Manage listings" },
            { id: "stock", label: "Stock", icon: Layers, hint: "Monitor inventory" },
            { id: "restocking", label: "Restocking", icon: RotateCcw, hint: "Add new stock" },
          ] as const).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => setActiveTab(tab.id)} className={cn("flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition", active ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
              <Icon className="h-4 w-4 shrink-0" /><span>{tab.label}</span><span className={cn("hidden text-xs font-normal md:inline", active ? "text-emerald-100" : "text-slate-400")}>{tab.hint}</span>
            </button>;
          })}
        </div>
      </section>

      {activeTab === "products" && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Product overview">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-slate-100 p-3 text-slate-700"><Boxes className="h-5 w-5" /></div>
            <div><p className="text-xs font-medium text-slate-500">Products shown</p><p className="text-2xl font-semibold tracking-tight text-slate-900">{inventorySummary.total}</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></div>
            <div><p className="text-xs font-medium text-slate-500">Active listings</p><p className="text-2xl font-semibold tracking-tight text-slate-900">{inventorySummary.active}</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-amber-50 p-3 text-amber-700"><AlertTriangle className="h-5 w-5" /></div>
            <div><p className="text-xs font-medium text-slate-500">Low stock (10 or less)</p><p className="text-2xl font-semibold tracking-tight text-slate-900">{inventorySummary.lowStock}</p></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-rose-50 p-3 text-rose-700"><Package className="h-5 w-5" /></div>
            <div><p className="text-xs font-medium text-slate-500">Out of stock</p><p className="text-2xl font-semibold tracking-tight text-slate-900">{inventorySummary.outOfStock}</p></div>
          </CardContent>
        </Card>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
          <div className="relative min-w-0 flex-1 2xl:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-10 focus:bg-white"
            />
            {searchTerm && <button type="button" onClick={() => setSearchTerm("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="h-4 w-4" /></button>}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2" role="group" aria-label="Filter products by status">
            {statusFilters.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                variant={filterStatus === filter.value ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus(filter.value)}
                className={cn("h-9 shrink-0 rounded-full px-3", filterStatus === filter.value && "bg-emerald-700 text-white hover:bg-emerald-800")}
              >
                {filter.label}
              </Button>
            ))}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 pt-2 2xl:border-0 2xl:pt-0">
            <p className="whitespace-nowrap text-xs text-slate-500">{products.length} found</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-9 rounded-xl">
              <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} /> Refresh
            </Button>
          </div>
        </div>
      </section>

      {isError ? (
        <Card className="border-rose-200 p-10 text-center shadow-sm">
          <AlertCircle className="mx-auto h-10 w-10 text-rose-500" />
          <h3 className="mt-3 text-lg font-semibold text-slate-900">Couldn't load your products</h3>
          <p className="mt-1 text-sm text-slate-500">{(error as any)?.message || "Please check your connection and try again."}</p>
          <Button className="mt-4 rounded-xl" onClick={() => refetch()}>Try again</Button>
        </Card>
      ) : products.length === 0 ? (
        <Card className="border-dashed border-slate-300 p-10 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Package className="h-7 w-7" /></div>
          <h3 className="mt-4 text-lg font-semibold text-slate-900">{searchTerm || filterStatus !== "all" ? "No matching products" : "Your product catalogue is empty"}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{searchTerm || filterStatus !== "all" ? "Try another search or choose a different status filter." : "Add your first product to start selling directly to customers."}</p>
          {searchTerm || filterStatus !== "all" ? (
            <Button variant="outline" className="mt-4 rounded-xl" onClick={() => { setSearchTerm(""); setFilterStatus("all"); }}>Clear filters</Button>
          ) : (
            <Button asChild className="mt-4 rounded-xl bg-emerald-700 hover:bg-emerald-800"><Link href="/farmer/products/new"><Plus className="mr-2 h-4 w-4" />Add your first product</Link></Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {products.map((product: any) => {
            const quantity = Number(product.availableQuantity ?? product.quantity ?? 0);
            const isOutOfStock = product.status === "out_of_stock" || quantity <= 0;
            const isLowStock = !isOutOfStock && quantity <= 10;
            return (
              <Card key={product.id} className="group overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md">
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                  <Image
                    src={product.images?.[0] || "/images/placeholder-product.jpg"}
                    alt={product.name || "Product image"}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
                    className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="absolute left-3 top-3">{getStatusBadge(product.status)}</div>
                  {product.isOrganic && <div className="absolute right-3 top-3"><Badge className="border border-white/70 bg-white/95 text-emerald-800 shadow-sm">🌿 Organic</Badge></div>}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent p-3 pt-10 opacity-0 transition-opacity group-hover:opacity-100">
                    <Link href={`/farmer/products/${product.id}`} className="text-sm font-medium text-white underline-offset-4 hover:underline">View product details</Link>
                  </div>
                </div>
                <CardContent className="space-y-4 p-4">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-slate-900" title={product.name}>{product.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{product.category || "Uncategorized"}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${product.name}`} className="-mr-2 -mt-2 h-9 w-9 shrink-0 rounded-full text-slate-500 hover:bg-slate-100"><MoreVertical className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild><Link href={`/farmer/products/${product.id}`}><Eye className="mr-2 h-4 w-4" />View details</Link></DropdownMenuItem>
                        <DropdownMenuItem asChild><Link href={`/farmer/products/${product.id}/edit`}><Edit className="mr-2 h-4 w-4" />Edit product</Link></DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => { setSelectedProduct(product); setShowDeleteDialog(true); }}><Trash2 className="mr-2 h-4 w-4" />Delete product</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Selling price</p>
                      <p className="mt-0.5 text-xl font-bold tracking-tight text-emerald-700">{formatPrice(product.price)}<span className="ml-1 text-xs font-medium text-slate-500">/ {product.unit}</span></p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Available stock</p>
                      <p className={cn("mt-0.5 text-sm font-semibold", isOutOfStock ? "text-rose-600" : isLowStock ? "text-amber-600" : "text-slate-800")}>{quantity} {product.unit || "units"}</p>
                    </div>
                  </div>

                  {isLowStock && <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800"><AlertTriangle className="h-4 w-4 shrink-0" />Low stock — consider restocking</div>}
                  {isOutOfStock && <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" />Unavailable — update stock to sell</div>}

                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">★ <strong className="font-semibold text-slate-700">{product.ratings?.average ? Number(product.ratings.average).toFixed(1) : "No rating"}</strong></span>
                    <span className="inline-flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />{product.orders ?? 0} orders</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      </>}

      {activeTab === "stock" && <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-medium text-slate-500">Products tracked</p><p className="mt-1 text-2xl font-semibold text-slate-900">{inventory?.total_products ?? inventoryItems.length}</p></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-medium text-slate-500">Total stock</p><p className="mt-1 text-2xl font-semibold text-slate-900">{inventory?.total_stock ?? "—"} kg</p></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-medium text-slate-500">Reserved stock</p><p className="mt-1 text-2xl font-semibold text-slate-900">{inventoryItems.reduce((n: number, i: any) => n + Number(i.reserved_stock || 0), 0)} kg</p></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardContent className="p-4"><p className="text-xs font-medium text-slate-500">Low / unavailable</p><p className="mt-1 text-2xl font-semibold text-amber-700">{inventoryItems.filter((i: any) => Number(i.available_stock) <= 5).length}</p></CardContent></Card>
        </div>
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardContent className="p-0">
            <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-slate-900">Stock levels</h3><p className="mt-1 text-xs text-slate-500">Available, reserved and sold quantities for each product</p></div><Button variant="outline" size="sm" onClick={() => refetchInventory()} disabled={inventoryLoading}><RefreshCw className={cn("mr-2 h-4 w-4", inventoryLoading && "animate-spin")} />Refresh stock</Button></div>
            {inventoryLoading ? <div className="p-10 text-center text-sm text-slate-500">Loading inventory…</div> : inventoryItems.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No inventory records available yet.</div> : <div className="divide-y divide-slate-100">
              {inventoryItems.map((item: any) => <div key={item.product_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3"><div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.images?.[0] || "/images/placeholder-product.jpg"} alt={item.product_name || "Product"} className="h-full w-full object-cover" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.product_name || item.product_id}</p><Badge variant={Number(item.available_stock) <= 0 ? "destructive" : Number(item.available_stock) <= 5 ? "warning" : "success"}>{Number(item.available_stock) <= 0 ? "Out of stock" : Number(item.available_stock) <= 5 ? "Low stock" : "In stock"}</Badge></div></div>
                <div className="grid grid-cols-3 gap-4 text-right text-xs sm:min-w-[330px]"><div><p className="text-slate-400">Available</p><p className="mt-1 font-semibold text-slate-900">{item.available_stock} {item.unit || "kg"}</p></div><div><p className="text-slate-400">Reserved</p><p className="mt-1 font-semibold text-slate-900">{item.reserved_stock} {item.unit || "kg"}</p></div><div><p className="text-slate-400">Sold</p><p className="mt-1 font-semibold text-slate-900">{item.sold_stock} {item.unit || "kg"}</p></div></div>
              </div>)}
            </div>}
          </CardContent>
        </Card>
      </section>}

      {activeTab === "restocking" && <section className="space-y-4">
        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4"><div className="flex items-start gap-3"><PackagePlus className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" /><div><h3 className="text-sm font-semibold text-blue-950">Restock your products</h3><p className="mt-1 text-sm text-blue-800">Enter the additional quantity harvested or received. Stock is updated after the server confirms the restock.</p></div></div></div>
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="font-semibold text-slate-900">Products needing attention</h3><p className="mt-1 text-xs text-slate-500">Sorted by available stock: lowest to highest</p></div>
              <div className="relative w-full sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={restockSearch} onChange={(e) => setRestockSearch(e.target.value)} placeholder="Search product name or ID..." aria-label="Search products to restock" className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-9 focus:bg-white" />
                {restockSearch && <button type="button" onClick={() => setRestockSearch("")} aria-label="Clear restock search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="h-4 w-4" /></button>}
              </div>
            </div>
            <div className="px-4 pt-3 text-xs text-slate-500">{filteredRestockItems.length} of {inventoryItems.length} products · lowest stock first</div>
            {inventoryLoading ? <div className="p-10 text-center text-sm text-slate-500">Loading products…</div> : inventoryItems.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No products available to restock.</div> : filteredRestockItems.length === 0 ? <div className="p-10 text-center"><Search className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-medium text-slate-800">No matching products</p><p className="mt-1 text-xs text-slate-500">Try another product name or ID.</p><Button variant="outline" size="sm" className="mt-3" onClick={() => setRestockSearch("")}>Clear search</Button></div> : <div className="divide-y divide-slate-100">
              {filteredRestockItems.map((item: any) => <div key={item.product_id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-3"><div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.images?.[0] || "/images/placeholder-product.jpg"} alt={item.product_name || "Product"} className="h-full w-full object-cover" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.product_name || item.product_id}</p><p className="mt-1 text-xs text-slate-500">Current available: <strong className="text-slate-800">{item.available_stock} {item.unit || "kg"}</strong></p></div></div>
                <div className="flex w-full items-center gap-2 lg:w-auto"><Input type="number" min="0.01" step="0.01" placeholder="Quantity to add" aria-label={`Restock quantity for ${item.product_name || "product"}`} value={restockQty[item.product_id] || ""} onChange={(e) => setRestockQty((prev) => ({ ...prev, [item.product_id]: e.target.value }))} className="h-10 min-w-0 lg:w-44" /><Button className="h-10 shrink-0 bg-emerald-700 hover:bg-emerald-800" disabled={restockMutation.isPending} onClick={() => submitRestock(item.product_id)}>{restockMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}Add stock</Button></div>
              </div>)}
            </div>}
          </CardContent>
        </Card>
      </section>}

            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
            <DialogDescription>Are you sure you want to delete "{selectedProduct?.name}"? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>Keep product</Button>
            <Button variant="destructive" onClick={handleDeleteProduct}>Delete product</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
