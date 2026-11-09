"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import Image from "next/image";
import {
  Plus, Search, Trash2, Edit, Eye, MoreVertical, Package,
  AlertCircle, Boxes, CheckCircle2, AlertTriangle, X, RefreshCw,
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

  const { data: productsData, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["farmerProducts", searchTerm, filterStatus],
    queryFn: () => api.get("/farmers/me/products", {
      params: { search: searchTerm || undefined, status: filterStatus !== "all" ? filterStatus : undefined, limit: 50 },
    }),
    retry: 1,
  });

  const products = productsData?.data?.products || [];
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
        title="Products & listings"
        description="Manage your produce, monitor stock and keep your marketplace listings up to date."
        actionHref="/farmer/products/new"
        actionLabel="Add product"
        actionIcon="plus"
      />

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
