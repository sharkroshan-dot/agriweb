"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgePercent, CalendarDays, Users, Loader2, Tag } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import toast from "react-hot-toast";

interface Coupon {
  id: string;
  code: string;
  description: string;
  discountPercent?: number;
  discountAmount?: number;
  minOrderAmount?: number;
  maxDiscount?: number;
  validUntil?: string;
  applicableCategories?: string[];
  active?: boolean;
}

export default function FarmerCouponsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["farmerCoupons"],
    queryFn: () => api.get("/coupons/available"),
    retry: 1,
  });

  const coupons: Coupon[] = (data?.data?.coupons || data?.data || []).map((c: any) => ({
    id: c.id || c._id,
    code: c.code,
    description: c.description,
    discountPercent: c.discount_percent ?? c.discountPercent,
    discountAmount: c.discount_amount ?? c.discountAmount,
    minOrderAmount: c.min_order_amount ?? c.minOrderAmount,
    maxDiscount: c.max_discount ?? c.maxDiscount,
    validUntil: c.valid_until ?? c.validUntil,
    applicableCategories: c.applicable_categories ?? c.applicableCategories,
    active: c.active ?? c.is_active,
  }));

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code);
    toast.success(`Copied ${code}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Offers &amp; Coupons</h1>
        <p className="text-gray-500">
          Platform offers and coupons your customers can use on your products.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1"><BadgePercent className="h-3 w-3" /> Active offers</Badge>
        <Badge variant="outline" className="gap-1"><Tag className="h-3 w-3" /> Coupons</Badge>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : coupons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <BadgePercent className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No coupons available right now</p>
            <p className="text-sm text-gray-400">When admin publishes offers, they'll show up here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coupons.map((c) => (
            <Card key={c.id} className="overflow-hidden">
              <div className="h-1.5 bg-gradient-to-r from-emerald-400 to-teal-500" />
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold uppercase tracking-wide text-emerald-700">{c.code}</p>
                    <p className="mt-1 text-sm text-gray-600">{c.description}</p>
                  </div>
                  <Badge variant="success">
                    {c.discountPercent ? `${c.discountPercent}% off` : c.discountAmount ? `Rs ${c.discountAmount} off` : "Offer"}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1 text-xs text-gray-500">
                  {c.minOrderAmount != null && (
                    <p className="flex items-center gap-1"><Tag className="h-3 w-3" /> Min order Rs {c.minOrderAmount}</p>
                  )}
                  {c.maxDiscount != null && (
                    <p className="flex items-center gap-1">Max discount Rs {c.maxDiscount}</p>
                  )}
                  {c.validUntil && (
                    <p className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" /> Valid till {formatDate(c.validUntil)}
                    </p>
                  )}
                  {c.applicableCategories?.length ? (
                    <p className="flex flex-wrap gap-1 pt-1">
                      {c.applicableCategories.map((cat) => (
                        <span key={cat} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{cat}</span>
                      ))}
                    </p>
                  ) : (
                    <p className="flex items-center gap-1"><Users className="h-3 w-3" /> All categories</p>
                  )}
                </div>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => copy(c.code)}>
                  <BadgePercent className="mr-2 h-4 w-4" /> Copy code
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className={cn("border-dashed border-gray-300 bg-slate-50/50")}>
        <CardHeader>
          <CardTitle className="text-base">Create your own offer</CardTitle>
          <CardDescription>Farmer-created coupons are coming soon. Until then, run discounts from your product page.</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/farmer/products">
            <Button size="sm">Go to Products</Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}