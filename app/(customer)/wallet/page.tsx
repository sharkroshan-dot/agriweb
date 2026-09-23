"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Wallet,
  RefreshCw,
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  ArrowUpLeft,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { formatPrice, formatDate } from "../../lib/utils";
import { api } from "../../lib/api/client";

export default function CustomerWalletPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["customerWallet"],
    queryFn: () => api.get("/payments/wallet/info"),
  });

  const wallet = useMemo(() => {
    const w = (data as any)?.data || (Array.isArray(data) ? {} : data) || {};
    return {
      balance: Number(w.balance || 0),
      currency: w.currency || "INR",
      isActive: w.isActive !== false,
      transactions: Array.isArray(w.transactions) ? w.transactions : [],
    };
  }, [data]);

  const transactions = useMemo(() => {
    return wallet.transactions.map((t: any) => ({
      id: t._id || t.id,
      amount: Number(t.amount || 0),
      type: (t.type || "credit").toLowerCase(),
      description: t.description || "Wallet transaction",
      balanceAfter: t.balanceAfter != null ? Number(t.balanceAfter) : null,
      referenceType: t.referenceType || "",
      date: t.createdAt,
    }));
  }, [wallet.transactions]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/customer/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">My Wallet</h1>
          <p className="text-sm text-muted-foreground">
            Refund money (COD / wallet refunds) is credited here and can be used for future orders
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
        <CardContent className="flex items-center gap-4 p-6">
          <div className="rounded-full bg-white/20 p-3">
            <Wallet className="h-8 w-8" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-emerald-50">Wallet Balance</p>
            <p className="text-3xl font-bold">
              {isLoading ? "…" : formatPrice(wallet.balance)}
            </p>
            <p className="mt-1 text-xs text-emerald-50/90">
              {wallet.isActive
                ? "This balance can be used to pay for your orders"
                : "Your wallet is currently inactive"}
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Wallet className="h-10 w-10 text-red-500" />
            <p className="font-medium">Failed to load wallet</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Wallet className="h-10 w-10 text-emerald-300" />
            <p className="font-medium">No transactions yet</p>
            <p className="text-sm text-muted-foreground">
              COD and wallet refunds are credited here.{" "}
              <Link href="/refunds" className="inline-flex items-center gap-1 font-medium text-emerald-600 hover:underline">
                <ArrowUpLeft className="h-3.5 w-3.5" /> View your refunds
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaction History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {transactions.map((t: any) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3"
              >
                <div
                  className={`rounded-full p-2 ${
                    t.type === "debit"
                      ? "bg-amber-50 text-amber-600"
                      : "bg-emerald-50 text-emerald-600"
                  }`}
                >
                  {t.type === "debit" ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.date ? formatDate(t.date) : ""}
                    {t.referenceType ? ` · ${t.referenceType}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-semibold ${
                      t.type === "debit" ? "text-amber-600" : "text-emerald-600"
                    }`}
                  >
                    {t.type === "debit" ? "-" : "+"}
                    {formatPrice(t.amount)}
                  </p>
                  {t.balanceAfter != null && (
                    <p className="text-xs text-muted-foreground">
                      Balance: {formatPrice(t.balanceAfter)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}