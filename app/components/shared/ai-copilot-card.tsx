"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { AlertCircle, ArrowRight, BrainCircuit, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type Severity = "low" | "medium" | "high";

type CopilotInsight = {
  title?: string;
  model?: string;
  confidence?: number;
  severity?: Severity | string;
  reason?: string;
  suggestedAction?: string;
  description?: string;
};

type CopilotBrief = {
  title?: string;
  guardrail?: string;
  insights?: CopilotInsight[];
  updatedAt?: string;
};

const severityStyles: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

function getConfidenceTone(confidence?: number) {
  const value = Number(confidence ?? 0);
  if (value >= 0.8) return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (value >= 0.65) return "bg-amber-50 text-amber-700 border border-amber-200";
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

export function AICopilotCard({
  className,
  ctaHref,
  ctaLabel = "Open AI Copilot",
}: {
  className?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const { data: session } = useSession();
  const role = ((session as any)?.user?.role ?? (session as any)?.role ?? "customer") as string;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ai-copilot-brief", role],
    queryFn: () => api.get("/ai/copilot/brief"),
    staleTime: 60_000,
    retry: 1,
  });

  const brief = ((data as any)?.data ?? (data as any) ?? null) as CopilotBrief | null;
  const insights = Array.isArray(brief?.insights) ? brief.insights : [];

  if (isLoading) {
    return (
      <Card className={cn("border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-transparent", className)}>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base">AI Copilot</CardTitle>
              <CardDescription>Loading guidance...</CardDescription>
            </div>
          </div>
          <div className="animate-pulse rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-400">Live</div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="animate-pulse rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="h-4 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-3 w-full rounded bg-slate-200" />
            <div className="mt-2 h-3 w-5/6 rounded bg-slate-200" />
          </div>
          <div className="animate-pulse rounded-xl border border-slate-200 bg-white/80 p-3">
            <div className="h-4 w-28 rounded bg-slate-200" />
            <div className="mt-3 h-3 w-full rounded bg-slate-200" />
            <div className="mt-2 h-3 w-2/3 rounded bg-slate-200" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError || !brief) {
    return (
      <Card className={cn("border-red-200 bg-red-50/60", className)}>
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-red-100 p-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-base font-semibold text-red-800">AI Copilot unavailable</p>
              <p className="mt-1 text-sm text-red-700">We couldn&apos;t load your guidance. Please retry.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-transparent", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-emerald-600" />
              {brief.title || "AI Copilot"}
            </CardTitle>
            <CardDescription className="mt-1">Role-aware guidance for your dashboard.</CardDescription>
          </div>
        </div>
        <Badge variant="secondary" className="rounded-full border border-emerald-200 bg-white text-emerald-700">
          Live
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3">
        {insights.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-600">
            No AI guidance available right now. Try again later.
          </div>
        ) : (
          insights.slice(0, 2).map((insight, index) => {
            const confidence = Number(insight.confidence ?? 0) * 100;
            const severity = (insight.severity || "low").toString().toLowerCase();
            const modelName = insight.model || "marketplace_model";
            const reason = insight.reason || insight.description || "No reasoning provided yet.";
            const action = insight.suggestedAction || "Review this recommendation before acting.";

            return (
              <div key={`${insight.title || "insight"}-${index}`} className="rounded-xl border border-slate-200 bg-white/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{insight.title || "Insight"}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", getConfidenceTone(Number(insight.confidence ?? 0)))}>
                      {Math.round(confidence)}% confidence
                    </span>
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", severityStyles[severity] || severityStyles.low)}>
                      {severity}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                    {modelName}
                  </Badge>
                  <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                    AI advisory
                  </Badge>
                </div>

                <p className="mt-3 text-sm leading-6 text-slate-600">{reason}</p>
                <p className="mt-2 text-sm leading-6 text-emerald-700">
                  <span className="font-semibold">Suggested action:</span> {action}
                </p>
              </div>
            );
          })
        )}

        {brief.guardrail && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{brief.guardrail}</p>
          </div>
        )}

        {ctaHref && (
          <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
            <Link href={ctaHref}>
              {ctaLabel}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
