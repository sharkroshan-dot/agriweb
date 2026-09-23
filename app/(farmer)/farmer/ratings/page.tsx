"use client";

import { useQuery } from "@tanstack/react-query";
import { Star, MessageSquare, Package, ShoppingBag, CalendarDays, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { api } from "../../../lib/api/client";

export default function FarmerRatingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["farmerRatings"],
    queryFn: () => api.get("/farmers/me/reviews"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  const d = data?.data;
  const products = d?.products || [];
  const reviews = d?.reviews || [];
  const summary = d?.summary || { totalReviews: 0, averageRating: 0.0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ratings &amp; Reviews</h1>
          <p className="text-sm text-gray-500">Every customer rating across all your products</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-yellow-100">
              <Star className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {summary.averageRating ? Number(summary.averageRating).toFixed(1) : "—"}
              </p>
              <p className="text-xs text-gray-500">Overall average rating</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100">
              <MessageSquare className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{summary.totalReviews}</p>
              <p className="text-xs text-gray-500">Total customer ratings</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100">
              <Package className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{products.length}</p>
              <p className="text-xs text-gray-500">Rated products</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {products.length > 0 && (
        <Card>
          <CardHeader className="border-b bg-gray-50/50">
            <CardTitle className="text-base">Ratings by product</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="divide-y">
              {products.map((p: any) => (
                <div key={p.productId} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <ShoppingBag className="h-4 w-4 text-gray-400" />
                    <span className="font-medium">{p.productName}</span>
                    <Badge variant="outline" className="text-xs">{p.count} ratings</Badge>
                  </div>
                  <div className="flex items-center gap-1 text-sm">
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    <span className="font-semibold">{Number(p.average).toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {reviews.length === 0 ? (
        <Card className="p-12 text-center">
          <Star className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold">No ratings yet</h3>
          <p className="mt-2 text-gray-500">Customer ratings and reviews will appear here once customers rate your products.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {reviews.map((r: any) => (
            <Card key={r.id} className="overflow-hidden">
              <CardHeader className="border-b bg-gray-50/50 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
                      <Star className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">{r.customerName}</CardTitle>
                      <p className="text-xs text-gray-500">{r.productName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`h-4 w-4 ${s <= r.rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
                      />
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <p className="text-sm text-gray-700">{r.comment || "No comment"}</p>
                <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                  {r.isVerifiedPurchase && (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verified purchase
                    </span>
                  )}
                  {r.createdAt && (
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
