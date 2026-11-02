"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Package, AlertTriangle, Loader2, CheckCircle2, ChevronRight } from "lucide-react";
import { api } from "../../../lib/api/client";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

interface StockItem {
  product_id: string;
  product_name?: string;
  product_slug?: string;
  images?: string[];
  price?: number;
  total_stock?: number;
  available_stock?: number;
  reserved_stock?: number;
  sold_stock?: number;
  unit?: string;
  is_out_of_stock?: boolean;
}

export default function FarmerRestockPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["farmerInventorySummary"],
    queryFn: () => api.get("/inventory/farmer/summary"),
  });

  const items: StockItem[] = (data?.data?.products || []).map((p: any) => ({
    ...p,
    total_stock: p.total_stock ?? p.available_stock,
  }));


  // Always show products from the lowest available stock to the highest.
  // Use numeric coercion so API strings/null values sort correctly.
  const sortedItems = [...items].sort(
    (a, b) => Number(a.available_stock ?? a.total_stock ?? 0) - Number(b.available_stock ?? b.total_stock ?? 0)
  );

  const placeholderImage = "/images/placeholder-product.jpg";

  const summary = data?.data;

  const restockMutation = useMutation({
    mutationFn: (payload: { productId: string; quantity: number }) =>
      api.put(`/products/${payload.productId}/inventory`, {
        quantity: payload.quantity,
        operation: "restock",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerInventorySummary"] });
      toast.success("Stock updated");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to update stock"),
  });

  const doRestock = (item: StockItem) => {
    const q = Number(qty[item.product_id]);
    if (!q || q <= 0) return toast.error("Enter a quantity to add");
    restockMutation.mutate({ productId: item.product_id, quantity: q });
  };

  const lowStock = items.filter((i) => (i.available_stock ?? 0) <= 5);
  const out = items.filter((i) => i.is_out_of_stock && (i.available_stock ?? 0) > 5);

  return (
    <div className="farmer-restock-page w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader title="Inventory health" description="Monitor available stock and act early on low or out-of-stock products." actionHref="/farmer/products" actionLabel="Manage products" />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div className="space-y-1.5"><p className="flex items-center gap-2 text-sm font-medium text-slate-600"><Package className="h-4 w-4 text-slate-500" />Total products</p><p className="text-2xl font-bold tracking-tight text-slate-950">{summary?.total_products ?? items.length}</p></div>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Package className="h-5 w-5" /></span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div className="space-y-1.5"><p className="flex items-center gap-2 text-sm font-medium text-slate-600"><CheckCircle2 className="h-4 w-4 text-emerald-600" />Total stock</p><p className="text-2xl font-bold tracking-tight text-slate-950">{summary?.total_stock ?? "—"} kg</p></div>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Package className="h-5 w-5" /></span>
          </CardContent>
        </Card>
        <Card className={cn(out.length > 0 && "border-red-200 bg-red-50/40")}>
          <CardContent className="flex items-center justify-between p-5">
            <div className="space-y-1.5"><p className="flex items-center gap-2 text-sm font-medium text-slate-600"><AlertTriangle className="h-4 w-4 text-amber-600" />Low / out of stock</p><p className="text-2xl font-bold tracking-tight text-amber-700">{lowStock.length + out.length}</p></div>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><AlertTriangle className="h-5 w-5" /></span>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <PackagePlus className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No inventory yet</p>
            <p className="text-sm text-gray-400">List a product first, then manage its stock here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <CardTitle className="text-lg font-semibold text-slate-900">Stock levels</CardTitle>
            <CardDescription className="mt-1 text-sm text-slate-500">Review available inventory and add quantities when needed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4 sm:p-5">
            {sortedItems.map((item) => (
              <div key={item.product_id} className="group flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-emerald-300 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  onClick={() => router.push(`/farmer/products/${item.product_id}/edit`)}
                  className="group flex min-w-0 w-full flex-1 items-center gap-4 rounded-lg text-left"
                  title="Open product page"
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.images?.[0] || placeholderImage}
                      alt={item.product_name || "Product"}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-semibold text-slate-900 transition-colors group-hover:text-emerald-700">
                        {item.product_name || item.product_id}
                      </p>
                      {item.is_out_of_stock ? (
                        <Badge variant="destructive" className="px-1.5 text-[10px]">Out of stock</Badge>
                      ) : (item.available_stock ?? 0) <= 5 ? (
                        <Badge variant="warning" className="px-1.5 text-[10px]">Low stock</Badge>
                      ) : (
                        <Badge variant="success" className="px-1.5 text-[10px]">In stock</Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                      <span>
                        Available:{" "}
                        <b className="ml-1 font-semibold text-slate-900">{item.available_stock ?? 0} {item.unit || "kg"}</b>
                      </span>
                      <span>Reserved <b className="ml-1 font-semibold text-slate-800">{item.reserved_stock ?? 0} {item.unit || "kg"}</b></span>
                      <span>Sold <b className="ml-1 font-semibold text-slate-800">{item.sold_stock ?? 0} {item.unit || "kg"}</b></span>
                      {typeof item.price === "number" && (
                        <span className="font-semibold text-emerald-700">₹{item.price}/{item.unit || "kg"}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition-colors group-hover:text-emerald-600" />
                </button>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    placeholder="Qty to add"
                    aria-label={`Quantity to add for ${item.product_name || "product"}`}
                    className="h-10 min-w-0 flex-1 text-sm sm:w-32 sm:flex-none"
                    value={qty[item.product_id] ?? ""}
                    onChange={(e) => setQty({ ...qty, [item.product_id]: e.target.value })}
                  />
                  <Button
                    size="default"
                    className="h-10 shrink-0 px-4 text-sm font-semibold"
                    disabled={restockMutation.isPending}
                    onClick={() => doRestock(item)}
                  >
                    {restockMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}
                    Restock
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
