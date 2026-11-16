"use client";

import { useQuery } from "@tanstack/react-query";
import { Leaf, TrendingUp, ArrowDownRight, ArrowUpRight, ShoppingBag } from "lucide-react";
import { api } from "../../lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";

export default function AgriPointsPage() {
  const { data: pointsData, isLoading } = useQuery({
    queryKey: ["loyalty", "me"],
    queryFn: () => api.get("/loyalty/me"),
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
  const totalPointsUsed = Number(d.lifetimeSpent ?? txns.reduce((sum: number, txn: any) => sum + Math.max(0, -Number(txn.points || 0)), 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Leaf className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold">AgriPoints</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white">
          <CardContent className="p-6">
            <p className="text-sm text-emerald-100">Your Balance</p>
            <p className="mt-1 text-4xl font-bold">{d.balance ?? 0}</p>
            <p className="mt-1 text-sm text-emerald-100">Points available to use at checkout</p>
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
              <ArrowDownRight className="h-4 w-4 text-emerald-600" /> Total points used
            </p>
            <p className="mt-1 text-3xl font-bold">{totalPointsUsed}</p>
            <p className="mt-1 text-xs text-gray-500">Points applied to previous orders</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <ShoppingBag className="h-4 w-4 text-emerald-600" /> How to earn
            </p>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              <li>₹100 spent → 1 point</li>
              <li>Community delivery → +{rules.bonusCommunity} points</li>
              <li>Nearby farmer delivery → +{rules.bonusNearby} points</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-emerald-950">Use your points on your next order</h2>
            <p className="mt-1 text-sm text-emerald-800">Choose AgriPoints during checkout to get a discount on eligible product orders.</p>
          </div>
          <Button asChild>
            <a href="/marketplace">Shop products</a>
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