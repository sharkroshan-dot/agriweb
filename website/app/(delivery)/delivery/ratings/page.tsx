"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Award, CalendarDays, CheckCircle2, Clock3, MessageSquare, PackageCheck, RefreshCw, Star, ThumbsUp, TrendingUp, Truck, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { api } from "../../../lib/api/client";

const Stars = ({ value }: { value: number }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
    {[1,2,3,4,5].map((n)=><Star key={n} className={`h-4 w-4 ${n <= Math.round(Number(value)||0) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`}/>)}
  </span>
);

const RatingBar = ({ star, count, total }: { star: number; count: number; total: number }) => {
  const percent = total ? Math.round((count / total) * 100) : 0;
  return <div className="flex items-center gap-3 text-sm"><span className="w-3 font-semibold text-slate-700">{star}</span><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400"/><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{width:`${percent}%`}}/></div><span className="w-16 text-right text-xs tabular-nums text-slate-600">{percent}% ({count})</span></div>;
};

const metric = (value: any) => Number(value || 0).toFixed(1);

export default function DeliveryMyRatingsPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["deliveryMyRatings"],
    queryFn: () => api.get("/delivery-ratings/partner/me", { params: { limit: 50 } }),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const result = useMemo(() => data?.data || {}, [data]);
  const ratings: any[] = result.ratings || [];
  const summary: any = result.summary || {};
  const total = Number(result.pagination?.total ?? summary.count ?? ratings.length);
  const distribution = summary.distribution || {};
  const positiveCount = Number(distribution["4"] || 0) + Number(distribution["5"] || 0);
  const positivePercent = total ? Math.round((positiveCount / total) * 100) : 0;
  const reviewsThisMonth = ratings.filter((r:any) => {
    if (!r.createdAt) return false;
    const d = new Date(r.createdAt); const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const categories = [
    { label: "On-time delivery", value: summary.onTimeAvg, icon: Clock3 },
    { label: "Product handling", value: summary.handlingAvg, icon: PackageCheck },
    { label: "Behaviour & service", value: summary.professionalismAvg, icon: UserRound },
    { label: "Communication", value: summary.communicationAvg, icon: MessageSquare },
  ].filter((item)=>item.value != null);

  return (
    <div className="space-y-5 pb-6">
      <header className="relative isolate flex min-h-[132px] items-center overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-[#f2fbe9] via-[#f4fbe9] to-[#dff5c9] px-5 py-5 shadow-sm sm:px-7 lg:min-h-[144px]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[48%] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[#f2fbe9] via-[#eaf8d8]/70 to-transparent"/>
          <div className="absolute -bottom-16 right-[-3%] h-36 w-[78%] rounded-[50%] bg-gradient-to-b from-[#c9eaa5] to-[#9ed47b] opacity-75"/>
          <div className="absolute -bottom-20 right-[8%] h-32 w-[62%] rotate-[-7deg] rounded-[50%] border-t-[14px] border-white/80"/>
          <div className="absolute bottom-0 right-0 h-20 w-32 rounded-tl-[100%] bg-gradient-to-br from-emerald-300/40 to-green-600/30"/>
          <div className="absolute bottom-2 right-[5%] rounded-full bg-white/70 p-3 text-emerald-700 shadow-sm"><Truck className="h-12 w-12 sm:h-14 sm:w-14"/></div>
        </div>
        <div className="relative z-10 flex min-w-0 items-center gap-4 sm:gap-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md sm:h-[76px] sm:w-[76px]"><Star className="h-9 w-9 fill-white sm:h-11 sm:w-11"/></div>
          <div className="h-14 w-px shrink-0 bg-emerald-700/60 sm:h-16"/>
          <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800 sm:text-xs">Delivery performance</p><h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-[28px]">My Ratings</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-700 sm:text-sm">View your customer ratings, feedback and delivery performance.</p></div>
        </div>
      </header>

      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={()=>void refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}/>Refresh ratings</Button></div>

      {isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[1,2,3,4,5].map(i=><div key={i} className="h-24 animate-pulse rounded-xl bg-muted"/>)}</div>
      : isError ? <Card><CardContent className="py-12 text-center"><p className="font-semibold">Unable to load your ratings</p><p className="mt-1 text-sm text-muted-foreground">Please try again in a moment.</p><Button className="mt-4" variant="outline" onClick={()=>void refetch()}>Try again</Button></CardContent></Card>
      : <>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-amber-100 p-3 text-amber-600"><Star className="h-5 w-5 fill-amber-400"/></div><div><p className="text-xs text-muted-foreground">Average rating</p><p className="text-2xl font-bold">{metric(summary.overallAvg)} <span className="text-sm font-medium text-muted-foreground">/ 5</span></p><Stars value={summary.overallAvg}/></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-emerald-100 p-3 text-emerald-700"><UserRound className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">Total reviews</p><p className="text-2xl font-bold">{total}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-green-100 p-3 text-green-700"><TrendingUp className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">On-time score</p><p className="text-2xl font-bold">{summary.onTimePercentage != null ? `${Math.round(summary.onTimePercentage)}%` : summary.onTimeAvg != null ? metric(summary.onTimeAvg) + " / 5" : "—"}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-blue-100 p-3 text-blue-700"><CalendarDays className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">Reviews this month</p><p className="text-2xl font-bold">{reviewsThisMonth}</p></div></CardContent></Card>
          <Card><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-emerald-100 p-3 text-emerald-700"><ThumbsUp className="h-5 w-5"/></div><div><p className="text-xs text-muted-foreground">Positive reviews (4–5★)</p><p className="text-2xl font-bold">{total ? `${positivePercent}%` : "—"}</p></div></CardContent></Card>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.15fr_1fr_0.95fr]">
          <Card className="overflow-hidden"><CardHeader className="border-b pb-3"><CardTitle className="text-base">Rating breakdown</CardTitle><p className="text-xs text-muted-foreground">{total} customer ratings</p></CardHeader><CardContent className="space-y-4 p-5">{total ? [5,4,3,2,1].map(star=><RatingBar key={star} star={star} count={Number(distribution[String(star)]||0)} total={total}/>) : <p className="py-8 text-center text-sm text-muted-foreground">Your star distribution will appear after customers rate completed deliveries.</p>}</CardContent></Card>
          <Card className="overflow-hidden"><CardHeader className="border-b pb-3"><CardTitle className="text-base">Category ratings</CardTitle><p className="text-xs text-muted-foreground">Average scores from customer feedback</p></CardHeader><CardContent className="divide-y p-4">{categories.length ? categories.map(({label,value,icon:Icon}:any)=><div key={label} className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"><div className="flex items-center gap-3"><span className="rounded-full bg-emerald-50 p-2 text-emerald-700"><Icon className="h-4 w-4"/></span><span className="text-sm font-medium">{label}</span></div><span className="flex items-center gap-1.5 text-sm font-bold">{metric(value)} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400"/></span></div>) : <p className="py-8 text-center text-sm text-muted-foreground">Category scores are not available yet.</p>}</CardContent></Card>
          <Card className="overflow-hidden"><CardHeader className="border-b pb-3"><CardTitle className="flex items-center gap-2 text-base"><Award className="h-5 w-5 text-emerald-700"/>Performance insights</CardTitle></CardHeader><CardContent className="space-y-3 p-4"><div className="rounded-xl bg-emerald-50 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-4 w-4 shrink-0"/>Your current average is {metric(summary.overallAvg)} / 5</p><p className="mt-1 text-xs text-emerald-800">Based on ratings recorded for your deliveries.</p></div>{summary.onTimeAvg != null && <div className="flex gap-2 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>On-time delivery score: {metric(summary.onTimeAvg)} / 5.</div>}{summary.handlingAvg != null && <div className="flex gap-2 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>Product handling score: {metric(summary.handlingAvg)} / 5.</div>}{summary.professionalismAvg != null && <div className="flex gap-2 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>Professionalism score: {metric(summary.professionalismAvg)} / 5.</div>}{!total && <p className="text-sm text-muted-foreground">Complete deliveries and invite customers to share feedback to build your performance profile.</p>}</CardContent></Card>
        </section>

        <Card className="overflow-hidden"><CardHeader className="flex flex-row items-center justify-between border-b"><div><CardTitle className="text-base">Customer reviews</CardTitle><p className="mt-1 text-xs text-muted-foreground">Latest feedback on your completed deliveries</p></div><Badge variant="secondary">{ratings.length} shown</Badge></CardHeader><CardContent className="divide-y p-0">{ratings.length ? ratings.map((r:any,index:number)=><div key={r.id || r._id || r.orderId || index} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-5"><div className="flex min-w-0 gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-800">{String(r.customerName || "C").trim().charAt(0).toUpperCase()}</div><div className="min-w-0"><p className="font-semibold text-slate-900">{r.customerName || "Customer"}</p><div className="mt-1 flex flex-wrap items-center gap-2"><Stars value={Number(r.overallRating)||0}/><span className="text-xs text-muted-foreground">{r.orderNumber || (r.orderId ? `Order ${String(r.orderId).slice(-6)}` : "Delivery review")}</span></div>{r.feedback ? <p className="mt-2 text-sm leading-6 text-slate-600">“{r.feedback}”</p> : <p className="mt-2 text-xs italic text-muted-foreground">No written comment provided.</p>}</div></div><div className="shrink-0 text-xs text-muted-foreground">{r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "Date not recorded"}</div></div>) : <div className="py-12 text-center"><MessageSquare className="mx-auto h-9 w-9 text-slate-300"/><p className="mt-3 font-semibold">No customer reviews yet</p><p className="mt-1 text-sm text-muted-foreground">Your ratings and feedback will appear here after customers review completed deliveries.</p></div>}</CardContent></Card>
      </>}
    </div>
  );
}
