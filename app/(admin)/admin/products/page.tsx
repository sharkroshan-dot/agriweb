"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Eye, Search, RefreshCw, Edit3, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { api } from "../../../lib/api/client";

const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

export default function AdminProductsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["adminProducts", query, status, page],
    queryFn: () =>
      api.get("/admin/products", {
        params: {
          page,
          limit: 50,
          ...(query ? { search: query } : {}),
          ...(status === "active" ? { isActive: true } : {}),
          ...(status === "inactive" ? { isActive: false } : {}),
        },
      }),
  });

  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.pages ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Products</h1>
          <p className="text-sm text-muted-foreground">Monitor product listings, stock levels, and farmer supply.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button asChild><Link href="/admin/reports">Generate report</Link></Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products..." className="pl-9" />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listings</CardTitle>
          <CardDescription>{total} products found</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : products.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No products found.</p>
          ) : (
            products.map((product) => (
              <div key={product.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium">{product.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {product.farmName || product.farmerName || "Farmer listing"} • {product.quantity ?? 0} {product.unit || "units"} in stock
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={product.isActive ? "success" : "secondary"}>
                    {product.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <p className="font-semibold">{inr(product.price)}{product.unit ? `/${product.unit}` : ""}</p>
                  <Button variant="outline" size="sm"><Eye className="mr-2 h-4 w-4" />View</Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
        {totalPages > 1 && (
          <CardContent className="flex items-center justify-between border-t pt-4">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
