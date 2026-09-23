"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Wallet, TrendingUp, Clock, Landmark, History, Loader2, RefreshCw, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

export default function DeliveryEarningsPage() {
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [payout, setPayout] = useState({
    paymentMethod: "bank_transfer",
    upiId: "",
    minWithdrawal: 200,
    autoWithdraw: false,
  });
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["deliveryEarnings"],
    queryFn: () => api.get("/delivery/me/earnings"),
    enabled: Boolean(accessToken),
    retry: 1,
  });

  const d = data?.data || {};
  const today = d.todayEarnings || 0;
  const week = d.weekEarnings || 0;
  const month = d.monthEarnings || 0;
  const pending = d.pendingPayouts || 0;
  const balance = d.walletBalance || d.pendingPayouts || 0;
  const weeklyChange = d.weeklyChange ?? 0;
  const transactions: any[] = d.recentTransactions || [];

  const { data: settingsData } = useQuery({
    queryKey: ["deliverySettingsPrefs"],
    queryFn: () => api.get("/settings/mine"),
    enabled: Boolean(accessToken),
  });

  useEffect(() => {
    if (settingsData?.data?.payout) {
      setPayout((current) => ({ ...current, ...settingsData.data.payout }));
    }
  }, [settingsData?.data]);

  const handleSavePayout = async () => {
    setSavingPayout(true);
    try {
      await api.put("/settings/mine", { payout });
      toast.success("Payout preferences saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save payout preferences");
    } finally {
      setSavingPayout(false);
    }
  };

  const handleWithdraw = async () => {
    if (pending <= 0) {
      toast.error("No eligible balance to withdraw yet");
      return;
    }
    if (pending < payout.minWithdrawal) {
      toast.error(`Minimum withdrawal is Rs ${payout.minWithdrawal}`);
      return;
    }
    if (payout.paymentMethod === "upi" && !payout.upiId?.trim()) {
      toast.error("Add your UPI ID first");
      return;
    }
    setIsWithdrawing(true);
    try {
      const res = await api.post("/delivery/me/earnings/withdraw", {
        amount: pending,
        bankAccount: { method: payout.paymentMethod, upiId: payout.upiId?.trim() },
      });
      toast.success(res?.message || "Withdrawal request submitted!");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to withdraw");
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Payments</p>
          <h1 className="text-3xl font-semibold tracking-tight">Earnings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track your earnings and request payouts.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Today</p>
                    <p className="text-2xl font-bold">{inr(today)}</p>
                  </div>
                  <div className="rounded-full p-2 bg-muted text-green-600"><TrendingUp className="h-5 w-5" /></div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{weeklyChange >= 0 ? "+" : ""}{weeklyChange}% vs last week</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">This Week</p>
                    <p className="text-2xl font-bold">{inr(week)}</p>
                  </div>
                  <div className="rounded-full p-2 bg-muted text-blue-600"><Wallet className="h-5 w-5" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">This Month</p>
                    <p className="text-2xl font-bold">{inr(month)}</p>
                  </div>
                  <div className="rounded-full p-2 bg-muted text-indigo-600"><Clock className="h-5 w-5" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Pending Payout</p>
                    <p className="text-2xl font-bold">{inr(pending)}</p>
                  </div>
                  <div className="rounded-full p-2 bg-muted text-amber-600"><TrendingUp className="h-5 w-5" /></div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Withdraw & Balance</CardTitle>
              <CardDescription>Request a payout of your available earnings.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Available balance</p>
                <p className="text-3xl font-bold text-primary">{inr(balance)}</p>
              </div>
              <Button onClick={handleWithdraw} disabled={isWithdrawing || pending <= 0}>
                {isWithdrawing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
                Withdraw
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /> Payment method & payout preferences</CardTitle>
              <CardDescription>How and when you receive your earnings.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Payment method</label>
                  <Select className="mt-1" value={payout.paymentMethod} onValueChange={(v) => setPayout((s) => ({ ...s, paymentMethod: v }))}>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">UPI ID</label>
                  <Input className="mt-1" value={payout.upiId} onChange={(e) => setPayout((s) => ({ ...s, upiId: e.target.value }))} placeholder="raj@upi" />
                </div>
                <div>
                  <label className="text-sm font-medium">Minimum withdrawal (Rs)</label>
                  <Input type="number" min="0" className="mt-1" value={payout.minWithdrawal} onChange={(e) => setPayout((s) => ({ ...s, minWithdrawal: Number(e.target.value) }))} />
                </div>
                <div className="flex items-end pb-1">
                  <div className="flex w-full items-center justify-between rounded-lg border p-3 text-sm font-medium">
                    Auto-withdraw
                    <Switch checked={payout.autoWithdraw} onCheckedChange={(on) => setPayout((s) => ({ ...s, autoWithdraw: on }))} aria-label="Auto-withdraw" />
                  </div>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button variant="outline" onClick={handleSavePayout} disabled={savingPayout}>
                  {savingPayout ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save preferences
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Recent Transactions</CardTitle>
              <CardDescription>Latest delivery earnings.</CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
              ) : (
                <div className="divide-y">
                  {transactions.map((t, i) => (
                    <div key={i} className="flex items-center justify-between py-3">
                      <div>
                        <p className="text-sm font-medium">{t.description || "Delivery earnings"}</p>
                        <p className="text-xs text-muted-foreground">{t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}</p>
                      </div>
                      <Badge variant="success">{inr(t.amount)}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}