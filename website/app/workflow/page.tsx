"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, Loader2, OctagonAlert } from "lucide-react";
import { api } from "../lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";

const stateMeta: Record<string, { label: string; className: string }> = {
  NOT_STARTED: { label: "Not started", className: "bg-slate-100 text-slate-700" },
  IN_PROGRESS: { label: "In progress", className: "bg-blue-100 text-blue-700" },
  ACTION_REQUIRED: { label: "Action required", className: "bg-amber-100 text-amber-800" },
  COMPLETED: { label: "Completed", className: "bg-emerald-100 text-emerald-700" },
  BLOCKED: { label: "Blocked", className: "bg-red-100 text-red-700" },
};

function StateBadge({ state }: { state: string }) {
  const meta = stateMeta[state] || stateMeta.NOT_STARTED;
  return <Badge className={meta.className}>{meta.label}</Badge>;
}

export default function WorkflowPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["myWorkflow"],
    queryFn: () => api.get("/workflow/me"),
    refetchInterval: 30000,
  });

  const workflow = data?.data || data;
  const steps = useMemo(() => Array.isArray(workflow?.steps) ? workflow.steps : [], [workflow]);

  if (isLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }

  if (isError || !workflow) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <OctagonAlert className="h-8 w-8 text-red-500" />
          <p className="font-medium">Workflow status could not be loaded.</p>
          <button className="rounded-md border px-3 py-2 text-sm" onClick={() => refetch()}>Retry</button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-emerald-700">LIVE WORKFLOW</p>
        <h1 className="text-2xl font-bold">My Workflow</h1>
        <p className="mt-1 text-sm text-slate-500">
          The next step is calculated from current backend records, not from a fixed page sequence.
        </p>
      </div>

      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{workflow.currentStep || "Workflow"}</CardTitle>
              <p className="mt-1 text-sm text-slate-600">Role: {workflow.role}</p>
            </div>
            <StateBadge state={workflow.state} />
          </div>
        </CardHeader>
        <CardContent>
          {workflow.next ? (
            <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold">{workflow.next.label}</p>
                <p className="text-sm text-slate-500">{workflow.next.reason}</p>
                {workflow.blockedReason ? <p className="mt-1 text-sm text-red-600">{workflow.blockedReason}</p> : null}
              </div>
              <Link href={workflow.next.href} className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No action is currently required.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Workflow progress</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {steps.map((step: any, index: number) => (
              <Link key={step.key} href={step.href} className="flex items-center gap-3 rounded-xl border p-3 hover:bg-slate-50">
                {step.state === "COMPLETED" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-400" />}
                <span className="w-7 text-xs text-slate-400">{index + 1}</span>
                <span className="flex-1 text-sm font-medium">{step.label}</span>
                <StateBadge state={step.state} />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
