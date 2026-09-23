"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Loader2, Star, ShieldCheck, MapPin, Package, Search, TrendingUp } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";

export default function SuppliersPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["b2b", "suppliers"],
    queryFn: () => api.get("/b2b/suppliers"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const suppliers = (data?.data?.suppliers ?? []).filter((s: any) =>
    !search.trim() || (s.farmName || "").toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">My Suppliers</h1>
      </div>

      <Input
        className="max-w-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search suppliers…"
      />

      {suppliers.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <Users className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">No suppliers yet.</p>
            <p className="text-sm text-gray-400">
              {search.trim() ? "Try a different search." : "Farmers you buy from will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {suppliers.map((s: any) => (
            <Card key={s.farmerId}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{s.farmName}</p>
                      {s.isVerified ? (
                        <Badge variant="success" className="gap-1"><ShieldCheck className="h-3 w-3" /> Verified</Badge>
                      ) : null}
                    </div>
                    {s.city ? (
                      <p className="flex items-center gap-1 text-xs text-gray-500">
                        <MapPin className="h-3 w-3" /> {s.city}{s.state ? `, ${s.state}` : ""}
                      </p>
                    ) : null}
                  </div>
                  {s.rating ? (
                    <span className="flex items-center gap-1 rounded-lg bg-yellow-50 px-2 py-1 text-sm font-semibold text-yellow-700">
                      <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" /> {Number(s.rating).toFixed(1)}
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-lg font-bold text-emerald-600">{formatPrice(s.totalSpend)}</p>
                    <p className="text-[11px] text-gray-400">Total procurement</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-lg font-bold">{s.orders}</p>
                    <p className="text-[11px] text-gray-400">Orders</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    <p className="text-lg font-bold text-blue-600">{s.onTimeRate}%</p>
                    <p className="text-[11px] text-gray-400">On-time</p>
                  </div>
                </div>

                <div>
                  <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-gray-400">
                    <Package className="h-3 w-3" /> Products
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(s.products ?? []).map((p: string) => (
                      <Badge key={p} variant="outline">{p}</Badge>
                    ))}
                  </div>
                </div>

                {s.lastOrderDate ? (
                  <p className="flex items-center gap-1 text-xs text-gray-400">
                    <TrendingUp className="h-3 w-3" /> Last order {new Date(s.lastOrderDate).toLocaleDateString()}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
