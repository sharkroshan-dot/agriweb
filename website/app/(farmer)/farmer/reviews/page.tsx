"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Star,
  ThumbsUp,
  Loader2,
  Award,
  Users,
  MessageSquare,
  ShoppingBag,
  CheckCircle2,
  CalendarDays,
  Search,
  RefreshCw,
  Package,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Progress } from "../../../components/ui/progress";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";

interface Review {
  id?: string;
  rating: number;
  comment?: string;
  customerName?: string;
  productName?: string;
  isVerifiedPurchase?: boolean;
  createdAt?: string;
}

function Stars({ value, className, size = "sm" }: { value: number; className?: string; size?: "sm" | "lg" }) {
  return (
    <div className={cn("flex items-center gap-0.5", className)} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <Star
          key={index}
          className={cn(
            size === "lg" ? "h-5 w-5" : "h-4 w-4",
            index <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-slate-200"
          )}
        />
      ))}
    </div>
  );
}

function getInitials(name?: string) {
  const parts = String(name || "Customer").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "C";
}

export default function FarmerReviewsPage() {
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [ratingFilter, setRatingFilter] = useState("all");
  const limit = 20;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["farmerReviews", page],
    queryFn: () => api.get("/farmers/me/reviews", { params: { page, limit } }),
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const summary = data?.data?.summary;
  const pagination = data?.data?.pagination;
  const reviews: Review[] = (data?.data?.reviews || []).map((review: any) => ({
    id: review.id || review._id,
    rating: Number(review.rating || 0),
    comment: review.comment || "",
    customerName: review.customerName || review.customer_name || "Customer",
    productName: review.productName || review.product_name || "Product",
    isVerifiedPurchase: review.isVerifiedPurchase ?? review.is_verified_purchase ?? false,
    createdAt: review.createdAt || review.created_at,
  }));
  const products = data?.data?.products || [];

  const visibleReviews = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return reviews.filter((review) => {
      const matchesQuery = !query || [
        review.customerName,
        review.productName,
        review.comment,
      ].some((value) => String(value || "").toLowerCase().includes(query));
      const matchesRating = ratingFilter === "all" || review.rating === Number(ratingFilter);
      return matchesQuery && matchesRating;
    });
  }, [reviews, searchQuery, ratingFilter]);

  const totalReviews = Number(summary?.totalReviews ?? pagination?.total ?? 0);
  const averageRating = Number(summary?.averageRating ?? 0);
  const verifiedOnPage = reviews.filter((review) => review.isVerifiedPurchase).length;

  const distribution = (rating: number) => {
    if (!reviews.length) return 0;
    return Math.round((reviews.filter((review) => Math.round(review.rating) === rating).length / reviews.length) * 100);
  };

  const pageCount = Math.max(1, Number(pagination?.totalPages || 1));
  const pageStart = totalReviews === 0 ? 0 : (page - 1) * limit + 1;
  const pageEnd = Math.min(page * limit, totalReviews);

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Customer feedback"
        title="Ratings & Reviews"
        description="Track product ratings, read customer feedback and understand what customers value about your produce."
      >
        <Button
          type="button"
          variant="outline"
          className="h-10 border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </FarmerPageHeader>

      {isLoading ? (
        <div className="space-y-4" aria-label="Loading customer reviews">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
          </div>
          <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      ) : isError ? (
        <Card className="border-red-200 shadow-sm">
          <CardContent className="flex flex-col items-center px-5 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <MessageCircle className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-base font-semibold text-slate-900">Unable to load ratings and reviews</h2>
            <p className="mt-1 max-w-lg text-sm text-slate-600">
              {(error as any)?.response?.data?.detail || (error as any)?.message || "Check your connection and try again."}
            </p>
            <Button className="mt-4 bg-emerald-700 hover:bg-emerald-800" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              { label: "Average rating", value: averageRating.toFixed(1), icon: Star, tone: "bg-amber-50 text-amber-700" },
              { label: "Total reviews", value: totalReviews, icon: MessageSquare, tone: "bg-blue-50 text-blue-700" },
              { label: "Rated products", value: products.length, icon: Package, tone: "bg-emerald-50 text-emerald-700" },
              { label: "Verified on this page", value: verifiedOnPage, icon: CheckCircle2, tone: "bg-violet-50 text-violet-700" },
            ].map((stat) => (
              <Card key={stat.label} className="border-slate-200 shadow-sm">
                <CardContent className="flex min-w-0 items-center justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                    <p className="mt-1 truncate text-2xl font-bold tracking-tight text-slate-950">{stat.value}</p>
                    {stat.label === "Verified on this page" ? <p className="mt-0.5 text-[11px] text-slate-400">Of {reviews.length} loaded reviews</p> : null}
                  </div>
                  <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", stat.tone)}>
                    <stat.icon className="h-5 w-5" />
                  </span>
                </CardContent>
              </Card>
            ))}
          </section>

          {products.length > 0 ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 via-white to-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm">
                    <ShoppingBag className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold tracking-tight text-slate-950">Ratings by product</h2>
                    <p className="mt-0.5 text-sm text-slate-500">Compare customer feedback across each product in your catalogue.</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="h-8 border-emerald-200 bg-white px-3 text-emerald-800">
                    {products.length} rated {products.length === 1 ? "product" : "products"}
                  </Badge>
                  <Badge variant="secondary" className="h-8 px-3">
                    {products.reduce((sum: number, product: any) => sum + Number(product.count || 0), 0)} customer ratings
                  </Badge>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {products.map((product: any, index: number) => {
                  const average = Math.max(0, Math.min(5, Number(product.average || 0)));
                  const reviewCount = Number(product.count || 0);
                  const ratingWidth = `${(average / 5) * 100}%`;
                  return (
                    <article
                      key={product.productId}
                      className="grid min-w-0 gap-4 px-4 py-4 transition-colors hover:bg-emerald-50/30 sm:grid-cols-[minmax(0,1fr)_minmax(150px,0.7fr)_minmax(125px,0.55fr)] sm:items-center sm:px-5 sm:py-5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700">
                          <Package className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-bold text-slate-950 sm:text-base">{product.productName || "Product"}</h3>
                            {index === 0 ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800">Highest rated</Badge> : null}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Product rating summary</p>
                        </div>
                      </div>

                      <div className="flex min-w-0 items-center gap-3 sm:justify-center">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-600">Average rating</span>
                            <span className="text-xs font-bold tabular-nums text-slate-800">{average.toFixed(1)} / 5</span>
                          </div>
                          <div
                            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                            role="progressbar"
                            aria-label={`Average rating for ${product.productName || "product"}`}
                            aria-valuemin={0}
                            aria-valuemax={5}
                            aria-valuenow={average}
                          >
                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700" style={{ width: ratingWidth }} />
                          </div>
                          <Stars value={average} className="mt-2" />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 sm:justify-end sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
                        <div className="flex items-center gap-2 text-slate-500">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm sm:bg-slate-100 sm:shadow-none">
                            <MessageSquare className="h-4 w-4" />
                          </span>
                          <span className="text-xs font-medium">Customer reviews</span>
                        </div>
                        <span className="text-lg font-bold tabular-nums text-slate-950">
                          {reviewCount}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Customer reviews</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {visibleReviews.length} shown · {reviews.length} loaded on this page
                  </p>
                </div>
                <div className="relative w-full sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search customer, product or comment..."
                    aria-label="Search loaded customer reviews"
                    className="h-10 w-full bg-white pl-9 text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Rating</span>
                {["all", "5", "4", "3", "2", "1"].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    aria-pressed={ratingFilter === rating}
                    onClick={() => setRatingFilter(rating)}
                    className={cn(
                      "inline-flex h-8 items-center rounded-lg border px-3 text-xs font-semibold transition-colors",
                      ratingFilter === rating
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50"
                    )}
                  >
                    {rating === "all" ? "All ratings" : `${rating} stars`}
                  </button>
                ))}
              </div>

              <div className="space-y-3 p-4 sm:p-5">
                {visibleReviews.length === 0 ? (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-12 text-center">
                    <Search className="h-8 w-8 text-slate-300" />
                    <h3 className="mt-3 text-sm font-semibold text-slate-900">No matching reviews</h3>
                    <p className="mt-1 text-sm text-slate-500">Try another search or rating filter.</p>
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => { setSearchQuery(""); setRatingFilter("all"); }}>Clear filters</Button>
                  </div>
                ) : (
                  visibleReviews.map((review, index) => (
                    <article key={review.id || `${review.customerName}-${review.createdAt}-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-emerald-200 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-sm font-bold text-emerald-800">
                            {getInitials(review.customerName)}
                          </span>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-slate-900">{review.customerName}</h3>
                            <p className="mt-0.5 truncate text-xs text-slate-500">{review.productName}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <Stars value={review.rating} />
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{review.rating}/5</Badge>
                          {review.isVerifiedPurchase ? (
                            <Badge variant="success" className="gap-1"><ThumbsUp className="h-3 w-3" />Verified purchase</Badge>
                          ) : null}
                        </div>
                      </div>
                      {review.comment ? (
                        <blockquote className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                          “{review.comment}”
                        </blockquote>
                      ) : (
                        <p className="mt-4 text-sm italic text-slate-400">No written comment was provided.</p>
                      )}
                      {review.createdAt ? (
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                          <CalendarDays className="h-3.5 w-3.5" />{formatDate(review.createdAt)}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>

              {pageCount > 1 ? (
                <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <p className="text-xs text-slate-500">Showing {pageStart}–{pageEnd} of {totalReviews} reviews</p>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={page <= 1 || isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                      <ChevronLeft className="mr-1 h-4 w-4" />Previous
                    </Button>
                    <span className="min-w-20 text-center text-xs font-semibold text-slate-600">Page {page} of {pageCount}</span>
                    <Button type="button" size="sm" variant="outline" disabled={page >= pageCount || isFetching} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                      Next<ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="space-y-4">
              <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-5">
                  <p className="text-sm font-semibold text-slate-900">Overall rating</p>
                  <div className="mt-3 flex items-end gap-2">
                    <span className="text-4xl font-bold tracking-tight text-slate-950">{averageRating.toFixed(1)}</span>
                    <span className="pb-1 text-sm text-slate-500">/ 5</span>
                  </div>
                  <Stars value={averageRating} size="lg" className="mt-2" />
                  <p className="mt-3 text-xs text-slate-500">Based on {totalReviews} customer reviews across your rated products.</p>
                </CardContent>
              </Card>

              <Card className="border-slate-200 shadow-sm">
                <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Award className="h-4 w-4" /></span>
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">Rating breakdown</h2>
                      <p className="text-xs text-slate-500">Current loaded review page</p>
                    </div>
                  </div>
                </div>
                <CardContent className="space-y-3 p-5">
                  {[5, 4, 3, 2, 1].map((rating) => (
                    <div key={rating} className="flex items-center gap-2.5">
                      <span className="w-8 shrink-0 text-xs font-semibold text-slate-600">{rating} <Star className="inline h-3 w-3 fill-amber-400 text-amber-400" /></span>
                      <Progress value={distribution(rating)} className="h-2 flex-1" />
                      <span className="w-9 text-right text-xs font-semibold tabular-nums text-slate-500">{distribution(rating)}%</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-950">Build customer confidence</p>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">Consistent quality, accurate product details and reliable delivery help strengthen customer ratings.</p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
