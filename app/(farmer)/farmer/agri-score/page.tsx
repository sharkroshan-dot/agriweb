"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, BadgeCheck, Loader2, Award, Medal } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Progress } from "../../../components/ui/progress";
import { VerificationStepsList } from "../../../components/farmer/verification-sections";
import toast from "react-hot-toast";

const LEVELS = [
  { min: 0, label: "Starting Farmer", color: "text-slate-500" },
  { min: 30, label: "Growing Farmer", color: "text-emerald-600" },
  { min: 60, label: "Trusted Farmer", color: "text-teal-600" },
  { min: 85, label: "Top Farmer", color: "text-amber-600" },
];

export default function FarmerScorePage() {
  const [toggled, setToggled] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["farmerTrustScore"],
    queryFn: () => api.get("/kyc/verification-status"),
    retry: 1,
  });

  const info = data?.data || {};
  const score = Math.round(Number(info.trustScore ?? 0) * (toggled ? 0.85 : 1));
  const level = [...LEVELS].reverse().find((l) => score >= l.min) || LEVELS[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">AgriConnect Score</h1>
        <p className="text-gray-500">
          A trust score that unlocks priority delivery, better marketplace placement and easier credit.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 bg-gradient-to-br from-emerald-600 to-teal-700 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-6 w-6" />
                <p className="font-medium">Your Score</p>
              </div>
              <Badge className="bg-white/20 text-white">{level.label}</Badge>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <p className="text-6xl font-bold">{score}</p>
              <p className="pb-1 text-sm text-white/80">/ 100</p>
            </div>
            <Progress value={score} className="mt-4 h-3 bg-white/25 [&>div]:bg-amber-300" />
            <p className="mt-3 text-sm text-white/80">
              {score >= 85
                ? "Outstanding! You qualify for priority placements and fast payout."
                : score >= 60
                  ? "Great trust level. Complete verifications below to reach Top Farmer."
                  : "Keep verifying your profile to raise your score and unlock benefits."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-500" /> Score levels
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {LEVELS.map((l) => (
              <div key={l.label} className={cn("flex items-center justify-between rounded-lg border p-2.5 text-sm", score >= l.min ? "border-emerald-200 bg-emerald-50/60" : "border-gray-100")}>
                <span className={cn("font-medium", l.color)}>{l.label}</span>
                <span className="text-xs text-gray-400">≥ {l.min}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-emerald-600" /> Profile verification
            </CardTitle>
            <CardDescription>Complete these to grow your AgriConnect Score.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
              </div>
            ) : (
              <VerificationStepsList />
            )}
            {info.role && (
              <p className="text-xs text-gray-400">Verified role: <b className="text-slate-600">{info.role}</b></p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Medal className="h-4 w-4 text-amber-500" /> Score benefits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              "Higher placement in marketplace search results",
              "Priority delivery assignment for urgent orders",
              "Faster settlement and payout eligibility",
              "Easier access to bulk & B2B contracts",
              "Burst badge shown to customers while ordering",
            ].map((b) => (
              <div key={b} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{b}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg border border-dashed p-3 text-xs text-gray-500">
              <span>Demo preview: adjust score</span>
              <button
                onClick={() => { setToggled((v) => !v); toast(toggled ? "Score restored" : "Showing a lower-score preview"); }}
                className="rounded-full border px-3 py-1 text-emerald-700 hover:bg-emerald-50"
              >
                {toggled ? "Restore score" : "Preview lower"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}