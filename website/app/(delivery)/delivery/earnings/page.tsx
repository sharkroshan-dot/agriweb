"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Wallet, TrendingUp, Clock, Landmark, History, Loader2, RefreshCw, Save, CalendarDays, Coins, ArrowDownToLine, CircleDollarSign, Truck, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const inr = (v: number) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function DeliveryEarningsPage() {
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [payout, setPayout] = useState({ paymentMethod: "bank_transfer", upiId: "", minWithdrawal: 200, autoWithdraw: false });
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const { data, isLoading, refetch, isFetching, isError } = useQuery({
    queryKey: ["deliveryEarnings"],
    queryFn: () => api.get("/delivery/me/earnings"),
    enabled: Boolean(accessToken),
    retry: 1,
  });
  const { data: settingsData } = useQuery({
    queryKey: ["deliverySettingsPrefs"],
    queryFn: () => api.get("/settings/mine"),
    enabled: Boolean(accessToken),
  });
  useEffect(() => {
    if (settingsData?.data?.payout) setPayout((current) => ({ ...current, ...settingsData.data.payout }));
  }, [settingsData?.data]);

  const d = data?.data || {};
  const today = Number(d.todayEarnings || 0);
  const week = Number(d.weekEarnings || 0);
  const month = Number(d.monthEarnings || 0);
  const pending = Number(d.pendingPayouts || 0);
  const balance = Number(d.walletBalance ?? d.availableBalance ?? pending);
  const lifetime = Number(d.totalEarnings ?? d.lifetimeEarnings ?? d.totalEarned ?? 0);
  const transactions: any[] = d.recentTransactions || [];
  const chartRows = useMemo(() => {
    const now = new Date();
    const bins = period === "daily" ? 7 : period === "weekly" ? 6 : 6;
    const labels = period === "daily"
      ? Array.from({length: bins}, (_,i) => { const x=new Date(now); x.setDate(now.getDate()-(bins-1-i)); return x.toLocaleDateString("en-IN",{weekday:"short"}); })
      : period === "weekly"
      ? Array.from({length: bins}, (_,i) => `W${i+1}`)
      : Array.from({length: bins}, (_,i) => { const x=new Date(now.getFullYear(),now.getMonth()-(bins-1-i),1); return x.toLocaleDateString("en-IN",{month:"short"}); });
    const values = labels.map((label, i) => {
      if (period === "daily") {
        const target = new Date(now); target.setDate(now.getDate()-(bins-1-i));
        return transactions.filter((t:any)=>t.createdAt && new Date(t.createdAt).toDateString()===target.toDateString()).reduce((s:number,t:any)=>s+Number(t.amount||0),0);
      }
      if (period === "monthly") {
        const target = new Date(now.getFullYear(),now.getMonth()-(bins-1-i),1);
        return transactions.filter((t:any)=>{if(!t.createdAt)return false;const dt=new Date(t.createdAt);return dt.getFullYear()===target.getFullYear()&&dt.getMonth()===target.getMonth();}).reduce((s:number,t:any)=>s+Number(t.amount||0),0);
      }
      return 0;
    });
    return labels.map((label,i)=>({label,value:values[i]}));
  }, [transactions, period]);
  const maxChart = Math.max(1,...chartRows.map(x=>x.value));
  const breakdown = useMemo(() => {
    const groups = new Map<string,number>();
    transactions.forEach((t:any)=>{const key=String(t.type || t.category || t.description || "Delivery earnings");groups.set(key,(groups.get(key)||0)+Number(t.amount||0));});
    return Array.from(groups.entries()).slice(0,5);
  }, [transactions]);

  const handleSavePayout = async () => {
    setSavingPayout(true);
    try { await api.put("/settings/mine", { payout }); toast.success("Payout preferences saved"); }
    catch (err:any) { toast.error(err?.message || "Failed to save payout preferences"); }
    finally { setSavingPayout(false); }
  };
  const handleWithdraw = async () => {
    if (pending <= 0) return toast.error("No eligible balance to withdraw yet");
    if (pending < payout.minWithdrawal) return toast.error(`Minimum withdrawal is ₹${payout.minWithdrawal}`);
    if (payout.paymentMethod === "upi" && !payout.upiId?.trim()) return toast.error("Add your UPI ID first");
    setIsWithdrawing(true);
    try { const res=await api.post("/delivery/me/earnings/withdraw",{amount:pending,bankAccount:{method:payout.paymentMethod,upiId:payout.upiId?.trim()}});toast.success(res?.message||"Withdrawal request submitted");refetch(); }
    catch(err:any){toast.error(err?.message||"Failed to withdraw");}
    finally{setIsWithdrawing(false);}
  };

  return <div className="space-y-4 pb-6">
    <header className="relative isolate flex min-h-[112px] items-center overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-[#effbe9] via-[#e9f8df] to-[#d5efc2] px-5 py-4 shadow-sm sm:px-7">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[48%] bg-gradient-to-l from-emerald-300/25 to-transparent"/>
      <div className="relative z-10 flex items-center gap-4"><div className="rounded-xl bg-emerald-600 p-3 text-white shadow"><Wallet className="h-8 w-8"/></div><div className="h-12 w-px bg-emerald-700/50"/><div><p className="text-[11px] font-bold uppercase tracking-widest text-emerald-800">Delivery operations</p><h1 className="text-2xl font-bold tracking-tight text-slate-900">Earnings &amp; Payouts</h1><p className="text-xs text-slate-600 sm:text-sm">Track your delivery income, bonuses, available balance and payouts.</p></div></div>
      <div className="relative z-10 ml-auto hidden items-center gap-2 sm:flex"><Button variant="outline" size="sm" onClick={()=>refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching?"animate-spin":""}`}/>Refresh</Button></div>
    </header>
    {isLoading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">{[1,2,3,4,5].map(i=><div key={i} className="h-24 animate-pulse rounded-xl bg-muted"/>)}</div> : isError ? <Card><CardContent className="py-10 text-center"><p className="font-semibold">Unable to load earnings</p><Button className="mt-3" variant="outline" onClick={()=>refetch()}>Try again</Button></CardContent></Card> : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {label:"Total Earnings",value:inr(lifetime),sub:"Lifetime recorded earnings",icon:Coins,tone:"emerald"},
          {label:"Available Balance",value:inr(balance),sub:"Current wallet balance",icon:Wallet,tone:"green"},
          {label:"Pending Earnings",value:inr(pending),sub:"Awaiting payout",icon:Clock,tone:"amber"},
          {label:"This Month",value:inr(month),sub:"Current month",icon:CalendarDays,tone:"blue"},
          {label:"This Week",value:inr(week),sub:"Current week",icon:TrendingUp,tone:"violet"},
        ].map((item)=>{const Icon=item.icon;return <Card key={item.label} className="border-slate-200 shadow-sm"><CardContent className="flex items-center gap-3 p-4"><span className={`rounded-full p-3 ${item.tone==="amber"?"bg-amber-50 text-amber-600":item.tone==="blue"?"bg-blue-50 text-blue-600":item.tone==="violet"?"bg-violet-50 text-violet-600":"bg-emerald-50 text-emerald-700"}`}><Icon className="h-5 w-5"/></span><div className="min-w-0"><p className="text-xs text-muted-foreground">{item.label}</p><p className="text-xl font-bold tracking-tight">{item.value}</p><p className="text-[11px] text-muted-foreground">{item.sub}</p></div></CardContent></Card>})}
      </section>
      <section className="grid gap-4 xl:grid-cols-[1.25fr_1fr_0.9fr]">
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-3"><CardTitle className="text-base">Earnings Trend</CardTitle><div className="flex rounded-full bg-slate-100 p-1">{(["daily","weekly","monthly"] as const).map(p=><Button key={p} size="sm" variant={period===p?"default":"ghost"} className={period===p?"h-7 rounded-full bg-emerald-700 px-3 text-xs hover:bg-emerald-800":"h-7 rounded-full px-3 text-xs"} onClick={()=>setPeriod(p)}>{p[0].toUpperCase()+p.slice(1)}</Button>)}</div></CardHeader><CardContent className="pt-5"><div className="flex h-40 items-end gap-3 border-b border-slate-100 px-1">{chartRows.map((x,i)=><div key={x.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><div className="w-full rounded-t-md bg-gradient-to-t from-emerald-500 to-green-300" style={{height:`${x.value?Math.max(6,x.value/maxChart*78):3}%`}} title={inr(x.value)}/><span className="text-[10px] text-muted-foreground">{x.label}</span></div>)}</div><p className="mt-3 text-[11px] text-muted-foreground">Chart is calculated from the transactions currently returned by the earnings service. Missing historical periods are not estimated.</p></CardContent></Card>
        <Card><CardHeader className="border-b pb-3"><CardTitle className="text-base">Earnings Breakdown</CardTitle><CardDescription>Categories from recorded transactions</CardDescription></CardHeader><CardContent className="space-y-3 pt-4">{breakdown.length?breakdown.map(([name,amount])=><div key={name} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 text-sm last:border-0"><span className="truncate text-slate-700">{name}</span><span className="font-semibold">{inr(amount)}</span></div>):<p className="py-8 text-center text-sm text-muted-foreground">No earning transactions recorded yet.</p>}<div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"><span>Current month</span><span className="float-right">{inr(month)}</span></div></CardContent></Card>
        <Card><CardHeader className="border-b pb-3"><CardTitle className="text-base">Payout &amp; Balance</CardTitle><CardDescription>Withdrawal status and available funds</CardDescription></CardHeader><CardContent className="space-y-4 pt-4"><div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs text-emerald-800">Available balance</p><p className="text-2xl font-bold text-emerald-800">{inr(balance)}</p></div><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Pending payout</span><strong>{inr(pending)}</strong></div><Button className="w-full bg-emerald-700 hover:bg-emerald-800" onClick={handleWithdraw} disabled={isWithdrawing||pending<=0}>{isWithdrawing?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<ArrowDownToLine className="mr-2 h-4 w-4"/>}Withdraw eligible balance</Button><p className="text-[11px] text-muted-foreground">Payout requests follow the existing eligibility and minimum-withdrawal rules.</p></CardContent></Card>
      </section>
      <Card><CardHeader className="border-b pb-3"><CardTitle className="text-base">Transaction History</CardTitle><CardDescription>Recent delivery earnings recorded by AgriConnect.</CardDescription></CardHeader><CardContent className="p-0">{transactions.length? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr>{["Transaction","Date & time","Type / Description","Amount","Status"].map(x=><th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y">{transactions.map((t:any,i:number)=><tr key={t.id||t._id||i}><td className="px-4 py-3 font-medium">{t.transactionId||t.id||t._id||"—"}</td><td className="px-4 py-3 text-slate-600">{t.createdAt?new Date(t.createdAt).toLocaleString("en-IN"):"—"}</td><td className="px-4 py-3">{t.description||t.type||"Delivery earnings"}</td><td className="px-4 py-3 font-semibold text-emerald-700">{inr(t.amount)}</td><td className="px-4 py-3"><Badge variant="success">{t.status||"Recorded"}</Badge></td></tr>)}</tbody></table></div>:<p className="py-10 text-center text-sm text-muted-foreground">No transactions yet.</p>}</CardContent></Card>
      <Card className="overflow-hidden border-emerald-200/70 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-emerald-50/70 to-white pb-4">
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-5 w-5 text-emerald-700"/>Payment method &amp; payout preferences</CardTitle>
          <CardDescription>Manage where and how you receive eligible delivery earnings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div>
            <p className="mb-2 text-sm font-medium">Choose payment method</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={()=>setPayout(s=>({...s,paymentMethod:"bank_transfer"}))} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${payout.paymentMethod==="bank_transfer"?"border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500":"border-slate-200 hover:border-emerald-300"}`}>
                <span className="rounded-lg bg-emerald-100 p-2 text-emerald-700"><Landmark className="h-5 w-5"/></span>
                <span className="flex-1"><span className="block text-sm font-semibold">Bank transfer</span><span className="block text-xs text-muted-foreground">Receive payouts to your registered bank account</span></span>
                {payout.paymentMethod==="bank_transfer"&&<CheckCircle2 className="h-5 w-5 text-emerald-600"/>}
              </button>
              <button type="button" onClick={()=>setPayout(s=>({...s,paymentMethod:"upi"}))} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${payout.paymentMethod==="upi"?"border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500":"border-slate-200 hover:border-emerald-300"}`}>
                <span className="rounded-lg bg-blue-100 p-2 text-blue-700"><Wallet className="h-5 w-5"/></span>
                <span className="flex-1"><span className="block text-sm font-semibold">UPI</span><span className="block text-xs text-muted-foreground">Receive payouts using your UPI ID</span></span>
                {payout.paymentMethod==="upi"&&<CheckCircle2 className="h-5 w-5 text-emerald-600"/>}
              </button>
            </div>
          </div>
          {payout.paymentMethod==="upi" ? <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="payout-upi">UPI ID</label><Input id="payout-upi" value={payout.upiId} onChange={e=>setPayout(s=>({...s,upiId:e.target.value}))} placeholder="name@bank"/><p className="text-xs text-muted-foreground">Enter the UPI ID where you want eligible payouts sent. Make sure it belongs to you.</p></div> : <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><Landmark className="mt-0.5 h-5 w-5 shrink-0 text-slate-600"/><div><p className="text-sm font-semibold text-slate-800">Registered bank account</p><p className="mt-1 text-xs leading-5 text-slate-600">Payouts will use the bank account registered in your AgriConnect profile. Manage or verify bank details through the supported account verification process.</p></div></div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="minimum-withdrawal">Minimum withdrawal (₹)</label><Input id="minimum-withdrawal" type="number" min="1" step="1" value={payout.minWithdrawal} onChange={e=>setPayout(s=>({...s,minWithdrawal:Math.max(0,Number(e.target.value))}))}/><p className="text-xs text-muted-foreground">Minimum eligible balance needed to request a payout.</p></div>
            <div className="flex items-center justify-between gap-3 rounded-xl border p-4"><div><p className="text-sm font-semibold">Auto-withdraw</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Automatically request a payout when your eligible balance reaches the configured minimum, if enabled for your account.</p></div><Switch checked={payout.autoWithdraw} onCheckedChange={on=>setPayout(s=>({...s,autoWithdraw:on}))}/></div>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">Changes apply after they are successfully saved.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>setPayout({paymentMethod:settingsData?.data?.payout?.paymentMethod||"bank_transfer",upiId:settingsData?.data?.payout?.upiId||"",minWithdrawal:Number(settingsData?.data?.payout?.minWithdrawal??200),autoWithdraw:Boolean(settingsData?.data?.payout?.autoWithdraw)})} disabled={savingPayout}>Cancel changes</Button><Button type="button" className="bg-emerald-700 hover:bg-emerald-800" onClick={handleSavePayout} disabled={savingPayout||payout.minWithdrawal<1||(payout.paymentMethod==="upi"&&!payout.upiId.trim())}>{savingPayout?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Save changes</Button></div>
          </div>
        </CardContent>
      </Card>
    </>}
  </div>;
}
