"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Star, Loader2, RefreshCw, MessageSquare } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
        />
      ))}
    </div>
  );
}

export default function CustomerReviewsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customerReviews"],
    queryFn: () => api.get("/customers/me/reviews", { params: { limit: 100 } }),
  });

  const reviews = useMemo(() => {
    const list = data?.data || (Array.isArray(data) ? data : []);
    return list.map((r: any) => ({
      id: r._id || r.id,
      productId: r.productId,
      productName: r.productName || "Product",
      productImage: r.productImage || "/images/placeholder-product.jpg",
      rating: Number(r.rating) || 0,
      comment: r.comment || "",
      images: r.images || [],
      isVerifiedPurchase: r.isVerifiedPurchase,
      createdAt: r.createdAt,
    }));
  }, [data]);

  const summary = useMemo(() => {
    const total = reviews.length;
    const avg = total ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / total : 0;
    return { total, average: avg };
  }, [reviews]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">My Reviews</h1>
          <p className="text-sm text-muted-foreground">Reviews you have written for products</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {summary.total > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-50 p-2">
                <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Average Rating</p>
                <p className="text-xl font-bold text-slate-900">
                  {summary.average.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ 5</span>
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{summary.total} review{summary.total !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <MessageSquare className="h-10 w-10 text-red-500" />
            <p className="font-medium">Failed to load reviews</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : reviews.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No reviews yet</p>
            <p className="text-sm text-muted-foreground">
              You can rate products from your delivered orders on the order detail page.
            </p>
            <Button asChild>
              <Link href="/orders">View orders</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reviews.map((review: any) => (
            <Card key={review.id}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-3xl bg-slate-100">
                    <img
                      src={review.productImage}
                      alt={review.productName}
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/images/placeholder-product.jpg";
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/product/${review.productId}`}
                        className="font-medium text-slate-900 hover:text-emerald-700"
                      >
                        {review.productName}
                      </Link>
                      <Stars rating={review.rating} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reviewed on {formatDate(review.createdAt)}
                      {review.isVerifiedPurchase && (
                        <Badge variant="secondary" className="ml-2">Verified purchase</Badge>
                      )}
                    </p>
                    {review.comment && (
                      <p className="mt-2 text-sm text-slate-700">{review.comment}</p>
                    )}
                    {review.images.length > 0 && (
                      <div className="mt-3 flex gap-2">
                        {review.images.slice(0, 4).map((img: string, idx: number) => (
                          <img
                            key={idx}
                            src={img}
                            alt=""
                            className="h-14 w-14 rounded-md object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ))}
                      </div>
                    )}
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
