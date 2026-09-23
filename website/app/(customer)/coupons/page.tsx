"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ticket, Loader2, Copy, Check, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { formatPrice, formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";

export default function CustomerCouponsPage() {
  const [copied, setCopied] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customerCoupons"],
    queryFn: () => api.get("/coupons/available"),
  });

  const coupons = useMemo(() => {
    const list = data?.coupons || data?.data?.coupons || (Array.isArray(data) ? data : []);
    return list.map((c: any) => ({
      id: c._id || c.id,
      code: c.code || "",
      description: c.description || "",
      discountType: c.discountType || "percentage",
      discountValue: c.discountValue || 0,
      minOrderValue: c.minOrderValue || 0,
      maxDiscount: c.maxDiscount,
      usageLimit: c.usageLimit,
      usedCount: c.usedCount || 0,
      expiresAt: c.expiresAt,
    }));
  }, [data]);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  const discountLabel = (c: any) =>
    c.discountType === "percentage" ? `${c.discountValue}% OFF` : `${formatPrice(c.discountValue)} OFF`;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Coupons</h1>
          <p className="text-sm text-muted-foreground">Deals and discounts available for you</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Ticket className="h-10 w-10 text-red-500" />
            <p className="font-medium">Failed to load coupons</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : coupons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Ticket className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No coupons available right now</p>
            <p className="text-sm text-muted-foreground">Check back soon for seasonal offers.</p>
            <Button asChild>
              <Link href="/nearby">Browse products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {coupons.map((coupon: any) => (
            <Card key={coupon.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex items-stretch">
                  <div className="flex w-24 flex-col items-center justify-center gap-1 border-r border-dashed bg-emerald-50 p-3 text-center">
                    <span className="text-lg font-bold leading-tight text-emerald-700">
                      {discountLabel(coupon)}
                    </span>
                    {coupon.maxDiscount != null && (
                      <span className="text-[10px] text-emerald-600">
                        up to {formatPrice(coupon.maxDiscount)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-sm font-bold text-slate-800">
                          {coupon.code}
                        </code>
                        <Badge variant="secondary" className="capitalize">{coupon.discountType}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{coupon.description}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        Min order {formatPrice(coupon.minOrderValue)}
                        {coupon.expiresAt && <> · Valid till {formatDate(coupon.expiresAt)}</>}
                      </span>
                      {coupon.usageLimit != null && (
                        <span>{coupon.usedCount}/{coupon.usageLimit} used</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="mt-3"
                      variant={copied === coupon.code ? "outline" : "default"}
                      onClick={() => handleCopy(coupon.code)}
                    >
                      {copied === coupon.code ? (
                        <>
                          <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy code
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
