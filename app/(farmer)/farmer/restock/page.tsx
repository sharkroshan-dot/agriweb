"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Package, AlertTriangle, Loader2, CheckCircle2, ChevronRight } from "lucide-react";
import { api } from "../../../lib/api/client";
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Restock &amp; Inventory</h1>
        <p className="text-gray-500">Monitor stock levels and quickly restock low items.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-gray-500 flex items-center gap-1"><Package className="h-3 w-3" /> Total products</p>
            <p className="text-2xl font-bold">{summary?.total_products ?? items.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-gray-500 flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Total stock</p>
            <p className="text-2xl font-bold">{summary?.total_stock ?? "—"} kg</p>
          </CardContent>
        </Card>
        <Card className={cn(out.length > 0 && "border-red-200 bg-red-50/40")}>
          <CardContent className="p-5">
            <p className="text-xs text-gray-500 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /> Low / out of stock</p>
            <p className="text-2xl font-bold text-amber-600">{lowStock.length + out.length}</p>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock levels</CardTitle>
            <CardDescription>Add quantity to restock a product.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item) => (
              <div key={item.product_id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <button
                  type="button"
                  onClick={() => router.push(`/farmer/products/${item.product_id}/edit`)}
                  className="group flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                  title="Open product page"
                >
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.images?.[0] || placeholderImage}
                      alt={item.product_name || "Product"}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium group-hover:text-emerald-700 group-hover:underline">
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
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        Available:{" "}
                        <b className="text-slate-700">{item.available_stock ?? 0} {item.unit || "kg"}</b>
                      </span>
                      <span>Reserved: {item.reserved_stock ?? 0} {item.unit || "kg"}</span>
                      <span>Sold: {item.sold_stock ?? 0} {item.unit || "kg"}</span>
                      {typeof item.price === "number" && (
                        <span className="text-emerald-700">₹{item.price}/{item.unit || "kg"}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-emerald-600" />
                </button>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    placeholder="qty"
                    className="h-9 w-24"
                    value={qty[item.product_id] ?? ""}
                    onChange={(e) => setQty({ ...qty, [item.product_id]: e.target.value })}
                  />
                  <Button
                    size="sm"
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