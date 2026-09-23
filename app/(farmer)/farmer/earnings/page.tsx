"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet,
  TrendingUp,
  Clock,
  Landmark,
  ArrowDownToLine,
  X,
  Loader2,
  IndianRupee,
  ArrowUpRight,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Badge } from "../../../components/ui/badge";
import { cn, formatPrice, formatDate } from "../../../lib/utils";
import { api } from "../../../lib/api/client";

const SUMMARY_CARDS = [
  {
    key: "totalEarnings",
    label: "Total Earnings",
    icon: TrendingUp,
    color: "text-emerald-600",
    format: (v: any) => formatPrice(v ?? 0),
  },
  {
    key: "availableBalance",
    label: "Available Balance",
    icon: Wallet,
    color: "text-blue-600",
    format: (v: any) => formatPrice(v ?? 0),
  },
  {
    key: "pendingEarnings",
    label: "Pending Earnings",
    icon: Clock,
    color: "text-amber-600",
    format: (v: any) => formatPrice(v ?? 0),
  },
  {
    key: "totalWithdrawn",
    label: "Total Withdrawn",
    icon: Landmark,
    color: "text-purple-600",
    format: (v: any) => formatPrice(v ?? 0),
  },
];

const PERIOD_CARDS = [
  { key: "todayEarnings", label: "Today" },
  { key: "weekEarnings", label: "This Week" },
  { key: "monthEarnings", label: "This Month" },
];

const PickupCommissionBanner = ({ amount }: { amount: number }) => {
  if (!amount || amount <= 0) return null;
  return (
    <Card className="border-amber-200 bg-amber-50/60">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Clock className="h-5 w-5" />
        </div>
        <div className="text-sm">
          <p className="font-semibold text-amber-800">
            Outstanding farm-pickup commission: {formatPrice(amount)}
          </p>
          <p className="mt-0.5 text-amber-700">
            This is the platform commission owed on Cash-on-Pickup orders where you collected
            the payment in cash. It will be deducted automatically from your next online sale
            settlement — no separate payment needed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default function FarmerEarningsPage() {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["farmerEarnings"],
    queryFn: () => api.get("/farmers/me/earnings"),
  });

  const withdraw = useMutation({
    mutationFn: (body: any) => api.post("/payments/wallet/withdraw", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["farmerEarnings"] });
      setWithdrawOpen(false);
      setAmount("");
    },
  });

  const earnings = (data as any)?.data ?? {};
  const transactions = earnings.recentTransactions ?? [];
  const withdrawals = earnings.withdrawals ?? [];
  const available = Number(earnings.availableBalance ?? 0);
  const withdrawAmount = Number(amount || 0);

  const withdrawalBadgeVariant = (status: string): "success" | "warning" | "destructive" | "secondary" => {
    switch (status) {
      case "completed":
      case "processed":
        return "success";
      case "processing":
      case "pending":
      case "queued":
        return "warning";
      case "failed":
      case "cancelled":
      case "reversed":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const withdrawalMethod = (bankAccount: any) =>
    bankAccount?.upiId ? "UPI" : "Bank transfer";

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 w-48 animate-pulse rounded bg-gray-200" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  const canWithdraw = withdrawAmount >= 100 && withdrawAmount <= available;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Earnings</h1>
          <p className="text-gray-500">Your sale earnings, balance and withdrawals.</p>
        </div>
        <Button
          onClick={() => setWithdrawOpen(true)}
          disabled={available <= 0}
          title={available <= 0 ? "No balance available to withdraw" : undefined}
        >
          <ArrowDownToLine className="mr-2 h-4 w-4" />
          Withdraw to Bank
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {SUMMARY_CARDS.map(({ key, label, icon: Icon, color, format }) => (
          <Card key={key}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-gray-500">{label}</p>
                  <p className="text-2xl font-bold">{format(earnings[key])}</p>
                </div>
                <div className={cn("rounded-full bg-gray-100 p-2", color)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <PickupCommissionBanner amount={Number(earnings.outstandingPickupCommission ?? 0)} />

      <div className="grid gap-4 md:grid-cols-3">
        {PERIOD_CARDS.map(({ key, label }) => (
          <Card key={key}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-xl font-bold">{formatPrice(earnings[key] ?? 0)}</p>
              </div>
              <IndianRupee className="h-5 w-5 text-gray-300" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>Your recent wallet activity</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No transactions yet. Your sale earnings will appear here after orders are paid.
            </p>
          ) : (
            <div className="divide-y">
              {transactions.map((t: any, i: number) => {
                const isCredit = t.type === "credit";
                return (
                  <div key={i} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          isCredit ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                        )}
                      >
                        {isCredit ? (
                          <TrendingUp className="h-5 w-5" />
                        ) : (
                          <ArrowDownToLine className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.description || (isCredit ? "Earnings" : "Withdrawal")}</p>
                        <p className="text-xs text-gray-500">{formatDate(t.createdAt)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-bold", isCredit ? "text-emerald-600" : "text-red-600")}>
                        {isCredit ? "+" : "-"}{formatPrice(t.amount ?? 0)}
                      </span>
                      <Badge variant={isCredit ? "default" : "secondary"} className="px-2 py-0 text-[10px]">
                        {isCredit ? "Credit" : "Debit"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Withdrawal History</CardTitle>
          <CardDescription>Funds transferred to your bank account or UPI via RazorpayX</CardDescription>
        </CardHeader>
        <CardContent>
          {withdrawals.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No withdrawals yet. Use "Withdraw to Bank" above to transfer your balance.
            </p>
          ) : (
            <div className="divide-y">
              {withdrawals.map((w: any, i: number) => (
                <div key={w.id || i} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                      <ArrowUpRight className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{formatPrice(w.amount ?? 0)}</p>
                      <p className="text-xs text-gray-500">
                        {withdrawalMethod(w.bankAccount)} • {formatDate(w.createdAt)}
                        {w.simulated ? " • (simulated)" : ""}
                      </p>
                    </div>
                  </div>
                  <Badge variant={withdrawalBadgeVariant(w.status)} className="px-2 py-0 text-[10px] capitalize">
                    {w.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent>
          <div className="flex items-center justify-between">
            <DialogHeader>
              <DialogTitle>Withdraw to Bank</DialogTitle>
              <DialogDescription>
                Available balance: <span className="font-semibold text-emerald-600">{formatPrice(available)}</span> (min ₹100)
              </DialogDescription>
            </DialogHeader>
            <button
              onClick={() => setWithdrawOpen(false)}
              className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Amount (₹)</label>
              <Input
                type="number"
                min={100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Account Holder Name</label>
              <Input value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} placeholder="Name on account" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Account Number</label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Bank account number" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">IFSC Code</label>
                <Input value={ifsc} onChange={(e) => setIfsc(e.target.value)} placeholder="e.g. HDFC0001234" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Bank Name</label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name" />
              </div>
            </div>
          </div>

          {withdraw.isError && (
            <p className="text-sm text-red-600">{(withdraw.error as any)?.message || "Withdrawal failed. Please try again."}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setWithdrawOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canWithdraw || !accountHolder || !accountNumber || !ifsc || withdraw.isPending}
              onClick={() =>
                withdraw.mutate({
                  amount: withdrawAmount,
                  bankAccount: {
                    accountHolder,
                    accountNumber,
                    ifsc,
                    bankName,
                  },
                })
              }
            >
              {withdraw.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Request"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
