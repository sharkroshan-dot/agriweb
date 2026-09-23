"use client";

import { useQuery } from "@tanstack/react-query";
import { Star, ThumbsUp, Loader2, Award, Users, MessageSquare } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";

interface Review {
  rating: number;
  comment?: string;
  customerName?: string;
  productName?: string;
  isVerifiedPurchase?: boolean;
  createdAt?: string;
}

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("flex gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("h-4 w-4", i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-gray-300")} />
      ))}
    </div>
  );
}

export default function FarmerReviewsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["farmerReviews"],
    queryFn: () => api.get("/farmers/me/reviews"),
    retry: 1,
  });

  const summary = data?.data?.summary;
  const reviews: Review[] = (data?.data?.reviews || []).map((r: any) => ({
    rating: r.rating,
    comment: r.comment,
    customerName: r.customerName || r.customer_name || "Customer",
    productName: r.productName || r.product_name,
    isVerifiedPurchase: r.isVerifiedPurchase ?? r.is_verified_purchase,
    createdAt: r.createdAt || r.created_at,
  }));
  const products = data?.data?.products || [];

  const dist = (n: number) => {
    if (!reviews.length) return 0;
    return Math.round((reviews.filter((r) => r.rating === n).length / reviews.length) * 100);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ratings &amp; Reviews</h1>
        <p className="text-gray-500">See what customers think about your produce and build trust.</p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 flex items-center gap-1"><Star className="h-3 w-3 text-amber-500" /> Average rating</p>
                <div className="mt-1 flex items-center gap-2">
                  <p className="text-3xl font-bold">{summary?.averageRating?.toFixed?.(1) ?? "—"}</p>
                  <Stars value={summary?.averageRating ?? 0} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Total reviews</p>
                <p className="mt-1 text-3xl font-bold">{summary?.totalReviews ?? reviews.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-xs text-gray-500 flex items-center gap-1"><Award className="h-3 w-3" /> Rated products</p>
                <p className="mt-1 text-3xl font-bold">{products.length}</p>
              </CardContent>
            </Card>
          </div>

          {reviews.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Recent reviews</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {reviews.map((r, i) => (
                    <div key={i} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                            {(r.customerName || "C").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{r.customerName}</p>
                            <p className="text-xs text-gray-400">{r.productName || "Product"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Stars value={r.rating} />
                          {r.isVerifiedPurchase && (
                            <Badge variant="success" className="gap-1 px-1.5 text-[10px]">
                              <ThumbsUp className="h-3 w-3" /> Verified purchase
                            </Badge>
                          )}
                        </div>
                      </div>
                      {r.comment && <p className="mt-3 text-sm text-gray-600">{r.comment}</p>}
                      {r.createdAt && <p className="mt-2 text-[11px] text-gray-400">{formatDate(r.createdAt)}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-1"><Users className="h-4 w-4" /> Rating breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <div key={n} className="flex items-center gap-2">
                      <span className="w-8 text-sm text-gray-500">{n}★</span>
                      <Progress value={dist(n)} className="h-2 flex-1" />
                      <span className="w-8 text-right text-xs text-gray-400">{dist(n)}%</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {reviews.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center py-16 text-center">
                <Star className="h-10 w-10 text-gray-300" />
                <p className="mt-3 font-medium text-gray-600">No reviews yet</p>
                <p className="text-sm text-gray-400">Once customers rate your produce, reviews will appear here.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}