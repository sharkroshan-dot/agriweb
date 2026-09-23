"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Leaf, Sparkles, Loader2, Wallet, TrendingUp, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { api } from "../../lib/api/client";
import { formatPrice } from "../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import toast from "react-hot-toast";

export default function AgriPointsPage() {
  const queryClient = useQueryClient();
  const [redeemPoints, setRedeemPoints] = useState(100);

  const { data: pointsData, isLoading } = useQuery({
    queryKey: ["loyalty", "me"],
    queryFn: () => api.get("/loyalty/me"),
  });

  const redeemMutation = useMutation({
    mutationFn: (points: number) => api.post("/loyalty/redeem", { points }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["loyalty", "me"] });
      toast.success(res?.message || "Points redeemed!");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to redeem points"),
  });

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const d = pointsData?.data ?? {};
  const rules = d.rules ?? {};
  const txns = d.transactions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Leaf className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">AgriPoints</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white">
          <CardContent className="p-6">
            <p className="text-sm text-emerald-100">Your Balance</p>
            <p className="mt-1 text-4xl font-bold">{d.balance ?? 0}</p>
            <p className="mt-1 text-sm text-emerald-100">≈ ₹{d.rewardValueRs ?? 0} wallet credit</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <TrendingUp className="h-4 w-4 text-emerald-600" /> Lifetime earned
            </p>
            <p className="mt-1 text-3xl font-bold">{d.lifetimeEarned ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Wallet className="h-4 w-4 text-emerald-600" /> How to earn
            </p>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              <li>₹100 spent → 1 point</li>
              <li>Farm pickup → +{rules.bonusPickup} points</li>
              <li>Community delivery → +{rules.bonusCommunity} points</li>
              <li>Nearby farmer delivery → +{rules.bonusNearby} points</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-emerald-600" /> Redeem for Wallet Credit
          </CardTitle>
          <CardDescription>
            {rules.pointsPerRsReward} points = ₹1. Use them to pay for your next order.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <select
            value={redeemPoints}
            onChange={(e) => setRedeemPoints(Number(e.target.value))}
            className="h-9 rounded-md border border-gray-200 px-2 text-sm"
          >
            {[100, 200, 500, 1000, 2500, 5000].map((p) => (
              <option key={p} value={p} disabled={p > (d.balance ?? 0)}>
                {p} points → ₹{p / (rules.pointsPerRsReward || 100)}
              </option>
            ))}
          </select>
          <Button
            disabled={redeemMutation.isPending || redeemPoints > (d.balance ?? 0) || redeemPoints <= 0}
            onClick={() => redeemMutation.mutate(redeemPoints)}
          >
            {redeemMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
            Redeem
          </Button>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Points History</h2>
        {txns.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-gray-400">
              No points activity yet. Complete orders to start earning AgriPoints!
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {txns.map((t: any) => (
              <Card key={t.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    {t.points >= 0 ? (
                      <ArrowUpRight className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <ArrowDownRight className="h-5 w-5 text-orange-500" />
                    )}
                    <div>
                      <p className="font-medium">{t.description || t.reason}</p>
                      <p className="text-xs text-gray-400">{formatDate(t.createdAt)}</p>
                    </div>
                  </div>
                  <Badge variant={t.points >= 0 ? "success" : "secondary"}>
                    {t.points >= 0 ? "+" : ""}{t.points} pts
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "";
  }
}