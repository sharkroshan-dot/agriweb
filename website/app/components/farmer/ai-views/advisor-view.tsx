"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Bot, Loader2, TrendingUp, Package, Wallet, Truck, Info, Sparkles, RefreshCw, MessageCircle, Send } from "lucide-react";
import Link from "next/link";
import { api } from "../../../lib/api/client";
import { cn, formatPrice } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";

const PERIODS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "year", label: "Last 12 months" },
];

const trendStyles = { up: "text-emerald-600", down: "text-red-600", steady: "text-gray-500" };
const statusStyles: Record<string, string> = {
  shortage: "bg-amber-100 text-amber-700 border-amber-300",
  overstock: "bg-blue-100 text-blue-700 border-blue-300",
  balanced: "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)} t` : `${Math.round(n).toLocaleString()} kg`;

export function AdvisorView() {
  const [period, setPeriod] = useState("30d");
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState("english");
  const [messages, setMessages] = useState<Array<{role: "user" | "assistant"; content: string}>>([]);
  const chat = useMutation({ mutationFn: (message: string) => api.post("/ai/chatbot", { message, language }), onSuccess: (response: any) => { const payload = response?.data ?? response; setMessages((old) => [...old, { role: "assistant", content: payload?.reply || "No answer returned." }]); }, onError: () => setMessages((old) => [...old, { role: "assistant", content: "The advisory service is unavailable. Please try again." }]) });
  const ask = () => { const message = question.trim(); if (!message || chat.isPending) return; setMessages((old) => [...old, { role: "user", content: message }]); setQuestion(""); chat.mutate(message); };

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["farmerAdvisor", period],
    queryFn: () => api.get("/farmers/me/advisor", { params: { period } }),
  });

  const raw = data as any;
  const report = raw?.data ?? raw;
  const what = report?.whatHappened || {};
  const why: any[] = report?.why || [];
  const forecast: any[] = report?.forecast || [];
  const recs: any[] = report?.recommendations || [];
  const priceInsight: any[] = report?.priceInsight || [];
  const wallet = report?.wallet || {};
  const delivery = report?.delivery || {};

  const upDown = (v: number) =>
    v > 0 ? <span className="text-emerald-600">▲ {Math.round(v)}%</span>
      : v < 0 ? <span className="text-red-600">▼ {Math.abs(Math.round(v))}%</span>
      : <span className="text-gray-400">—</span>;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-7 pb-8">
      <div className="flex flex-col gap-4 rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-emerald-50/70 to-teal-50/60 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            <Bot className="h-6 w-6 text-emerald-600" /> AI Farm Advisor
          </h1>
          <p className="text-gray-500">
            Practical crop guidance and clear insights from your AgriConnect farm activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v)}>
            <SelectContent>
              {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => refetch()} disabled={isFetching} variant="outline">
            <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /><h2 className="font-semibold text-slate-900">Ask your Farm Advisor</h2></div><select aria-label="Advisor language" value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"><option value="english">English</option><option value="tamil">தமிழ்</option><option value="hindi">हिन्दी</option></select></div>
          <p className="text-sm text-slate-600">Ask a farming question. Include your crop, location and crop age for more useful guidance.</p><div className="flex flex-wrap gap-2">{["My tomato leaves are turning yellow","How can I improve soil health?","How should I plan irrigation?","How can I manage pests safely?"].map((prompt) => <button key={prompt} type="button" onClick={() => { setQuestion(prompt); setMessages((old) => [...old, { role: "user", content: prompt }]); chat.mutate(prompt); }} disabled={chat.isPending} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50">{prompt}</button>)}</div>
          {messages.length > 0 && <div aria-live="polite" className="max-h-80 space-y-3 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 sm:p-4">{messages.map((m, i) => <div key={i} className={cn("rounded-lg p-3 text-sm", m.role === "user" ? "ml-8 bg-emerald-100" : "mr-8 bg-white")}>{m.content}</div>)}{chat.isPending && <p className="text-xs text-gray-500">Preparing guidance...</p>}</div>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about crops, soil, water or pests..." className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /><Button type="submit" disabled={!question.trim() || chat.isPending}><Send className="mr-2 h-4 w-4" />Ask</Button></form>
          <p className="text-xs text-slate-400">General guidance only. Confirm serious crop-health and chemical-use decisions with a qualified local agricultural expert.</p>
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/farmer/crop-advisor" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"><p className="font-semibold">Crop selection & field planning</p><p className="mt-1 text-sm text-gray-500">Soil, season, weather, field size and water inputs.</p></Link>
        <Link href="/farmer/weather" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"><p className="font-semibold">Weather guidance</p><p className="mt-1 text-sm text-gray-500">Review local weather and its crop impact.</p></Link>
      </div>
      {isLoading && (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Preparing your business summary...
          </CardContent>
        </Card>
      )}

      {isError && !data && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">Could not load your advisor. Please try again.</CardContent>
        </Card>
      )}

      {data && !report?.hasData && !isLoading && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-amber-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <span className="font-medium">Not enough data yet.</span> No sales in this period. List your produce
              and check back once orders start coming in.
            </p>
          </CardContent>
        </Card>
      )}

      {data && report?.hasData && (
        <>
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <TrendingUp className="h-5 w-5 text-emerald-600" /> What happened ({report.periodLabel})
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Sales</p>
                  <p className="text-2xl font-bold">{formatPrice(Number(what.revenue) || 0)}</p>
                  <p className="mt-1 text-xs">{upDown(Number(what.revenueChangePct))}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Orders</p>
                  <p className="text-2xl font-bold">{Number(what.orders) || 0}</p>
                  <p className="mt-1 text-xs">{upDown(Number(what.ordersChangePct))}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Customers</p>
                  <p className="text-2xl font-bold">{Number(what.customers) || 0}</p>
                  <p className="mt-1 text-xs">{upDown(Number(what.customersChangePct))}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Estimated profit*</p>
                  <p className="text-2xl font-bold text-emerald-600">{formatPrice(Number(what.estimatedProfit) || 0)}</p>
                  <p className="mt-1 text-xs">{upDown(Number(what.estimatedProfitChangePct))}</p>
                </CardContent>
              </Card>
            </div>
            {what.topProduct && (
              <p className="mt-2 text-sm text-gray-500">
                Top seller: <span className="font-medium text-gray-800">{what.topProduct.name}</span> · Top area:{" "}
                <span className="font-medium text-gray-800">{what.topArea?.name}</span> ({fmt(Number(what.topArea?.quantityKg) || 0)}).
              </p>
            )}
            <p className="mt-1 text-[11px] text-gray-400">*Estimated profit uses a transparent margin estimate, not true farm accounts.</p>
          </div>

          {why.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Info className="h-5 w-5 text-emerald-600" /> Why
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {why.map((w, i) => (
                  <Card key={i} className="bg-gray-50/60">
                    <CardContent className="flex items-start gap-3 p-4">
                      <span className="text-xl">{w.emoji}</span>
                      <div>
                        <p className="font-medium text-gray-900">{w.title}</p>
                        <p className="text-sm text-gray-600">{w.message}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {forecast.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-emerald-600" /> What happens next ({report.periodLabel})
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {forecast.map((f, i) => (
                  <Card key={i} className="border-l-4 border-l-emerald-400">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-gray-900">{f.product}</p>
                        <Badge className={cn("border", statusStyles[f.status] ?? statusStyles.balanced)}>
                          {f.status === "shortage" ? "Shortage" : f.status === "overstock" ? "Overstock" : "Balanced"}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-end gap-2">
                        <p className="text-2xl font-bold">{fmt(Number(f.predictedKg) || 0)}</p>
                        <span className={cn("text-sm", trendStyles[f.trend] ?? trendStyles.steady)}>
                          {f.trend === "up" ? "▲" : f.trend === "down" ? "▼" : "→"} {Math.round(Number(f.growthPct) || 0)}%
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Range {Math.round(Number(f.predictedLowKg) || 0)}–{Math.round(Number(f.predictedHighKg) || 0)} kg · You sold {Math.round(Number(f.currentKg) || 0)} kg
                      </p>
                      <p className="mt-2 text-xs">
                        <span className="text-gray-500">Your stock:</span>{" "}
                        <span className="font-medium">{fmt(Number(f.supplyKg) || 0)}</span>
                        {f.gapKg > 0 && <span className="text-amber-600"> · Gap ~{Math.round(Number(f.gapKg) || 0)} kg</span>}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {recs.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Bot className="h-5 w-5 text-emerald-600" /> What should I do?
              </h2>
              <div className="space-y-3">
                {recs.map((r, i) => (
                  <Card key={i} className={cn(r.priority === "high" && "border-emerald-300 bg-gradient-to-br from-emerald-50/60 to-teal-50/30")}>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{r.emoji}</span>
                        <div>
                          <p className="font-semibold text-gray-900">{r.title}</p>
                          <p className="text-sm text-gray-600">{r.reason}</p>
                          {r.link && (
                            <Link href={r.link} className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:underline">
                              {r.action} →
                            </Link>
                          )}
                        </div>
                      </div>
                      <Badge className={cn("border", r.priority === "high" ? "bg-emerald-100 text-emerald-700 border-emerald-300" : "bg-slate-100 text-slate-600 border-slate-300")}>
                        {r.priority}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {priceInsight.length > 0 && (
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                <Package className="h-5 w-5 text-emerald-600" /> Price check
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {priceInsight.map((p, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <p className="font-medium text-gray-900">{p.product}</p>
                      <div className="mt-2 space-y-1 text-sm text-gray-600">
                        <p>Your price: <span className="font-semibold">{p.yourPrice != null ? `${p.yourPrice}/kg` : "not listed"}</span></p>
                        <p>Market avg: <span className="font-semibold">{p.marketAvg != null ? `${p.marketAvg}/kg` : "n/a"}</span></p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><Wallet className="h-4 w-4" /> Wallet balance</span>
                <span className="text-lg font-bold">{formatPrice(Number(wallet.balance) || 0)}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><Wallet className="h-4 w-4" /> Pending payout</span>
                <span className="text-lg font-bold text-emerald-600">{formatPrice(Number(wallet.pending) || 0)}</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-700"><Truck className="h-4 w-4" /> Deliveries</span>
                <span className="text-lg font-bold">{Number(delivery.total) || 0} <span className="text-sm font-normal text-gray-500">({Math.round(Number(delivery.onTime) || 0)} on time)</span></span>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}