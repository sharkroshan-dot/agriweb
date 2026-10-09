"use client";

import { PrefetchLink as Link } from "./prefetch-link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, Clock3, Ban, Workflow } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api/client";

type WorkflowStep = {
  key: string;
  label: string;
  href: string;
  state: "NOT_STARTED" | "IN_PROGRESS" | "ACTION_REQUIRED" | "COMPLETED" | "BLOCKED";
  active?: boolean;
};

type Role = "farmer" | "customer" | "delivery" | "warehouse" | "business" | "admin";

const FALLBACK: Record<Role, WorkflowStep[]> = {
  farmer: ["Farm Setup","Crop Planning","Growing","Pre-orders","Harvest","Batch","Quality","Product","Inventory","Orders","Delivery","Earnings"].map((label,i)=>({key:String(i),label,href:"/farmer/dashboard",state:"NOT_STARTED"})),
  customer: ["Browse","Product","Address","Delivery Fee","Checkout","Payment","Order","Tracking","Delivery","Review"].map((label,i)=>({key:String(i),label,href:"/nearby",state:"NOT_STARTED"})),
  delivery: ["Availability","Assignment","Accept","Pickup","Verify","Dispatch","Route","Delivery","Proof","Completed","Earnings"].map((label,i)=>({key:String(i),label,href:"/delivery/dashboard",state:"NOT_STARTED"})),
  warehouse: [
    ["Warehouse Setup", "/warehouse/settings"],
    ["Incoming Stock", "/incoming"],
    ["Receive", "/incoming"],
    ["Batch Verification", "/incoming"],
    ["Quality", "/warehouse/quality-inspection"],
    ["Storage", "/stock"],
    ["Inventory", "/stock"],
    ["Pick", "/stock"],
    ["Pack", "/stock"],
    ["Dispatch", "/stock"],
    ["Transfer", "/transfers"],
  ].map(([label, href], i) => ({key:String(i), label, href, state:"NOT_STARTED"})),
  business: ["Business Setup","Category","RFQ","Farmer Quotes","Compare Quotes","Select Quote","Contract","B2B Order","Payment","Fulfillment","Delivery","Completion"].map((label,i)=>({key:String(i),label,href:"/business/dashboard",state:"NOT_STARTED"})),
  admin: ["Overview","Users","Farmers","Products","Harvests","Batches","Quality","Inventory","Orders","Payments","Delivery","Warehouse","Complaints","Settlements","Analytics","AI","Audit"].map((label,i)=>({key:String(i),label,href:"/admin/dashboard",state:"NOT_STARTED"})),
};

function stateIcon(state: WorkflowStep["state"]) {
  if (state === "COMPLETED") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === "ACTION_REQUIRED") return <Clock3 className="h-4 w-4 text-amber-600" />;
  if (state === "BLOCKED") return <Ban className="h-4 w-4 text-red-600" />;
  if (state === "IN_PROGRESS") return <Clock3 className="h-4 w-4 text-blue-600" />;
  return <Circle className="h-4 w-4 text-slate-400" />;
}

function stateClass(state: WorkflowStep["state"], active?: boolean) {
  // The selected/current step uses the same AgriConnect green treatment
  // across every role. Active takes visual priority over the workflow state.
  if (active) return "border-emerald-300 bg-emerald-50 shadow-sm";
  if (state === "COMPLETED") return "border-emerald-100 bg-emerald-50/40";
  if (state === "ACTION_REQUIRED") return "border-amber-300 bg-amber-50";
  if (state === "BLOCKED") return "border-red-200 bg-red-50";
  if (state === "IN_PROGRESS") return "border-blue-100 bg-blue-50/40";
  return "border-slate-200 bg-slate-50";
}

export function WorkflowGuide({ role }: { role: Role }) {
  const { data, isLoading } = useQuery({
    queryKey: ["myWorkflow", role],
    queryFn: () => api.get("/workflow/me"),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  const resolved = data?.data?.data;
  const steps: WorkflowStep[] = Array.isArray(resolved?.steps) && resolved.steps.length
    ? resolved.steps
    : FALLBACK[role];
  const next = resolved?.next as { href?: string; label?: string; reason?: string } | undefined;
  const backendActiveKey = steps.find((step) => step.active)?.key ?? null;
  const [selectedKey, setSelectedKey] = useState<string | null>(backendActiveKey);

  useEffect(() => {
    if (backendActiveKey) setSelectedKey(backendActiveKey);
  }, [backendActiveKey]);

  return (
    <section className="mb-5 rounded-2xl border border-emerald-100 bg-white shadow-sm" aria-label="Workflow progress">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <Workflow className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Your workflow</p>
            <p className="text-xs text-slate-500">
              {isLoading ? "Checking your current progress…" : next?.reason || "Your next action is based on the current backend state."}
            </p>
          </div>
        </div>
        {next?.href && next.label && (
          <Link href={next.href} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            Continue: {next.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-11">
          {steps.map((step) => {
            const selected = selectedKey === step.key;
            return (
              <Link
                key={step.key || step.label}
                href={step.href || "#"}
                aria-current={selected ? "step" : undefined}
                onClick={() => setSelectedKey(step.key)}
                className={`group flex min-h-[78px] w-full flex-col gap-1 rounded-xl border p-2.5 text-left transition hover:border-emerald-300 hover:bg-emerald-50/70 ${stateClass(step.state, selected)}`}
                title={step.state.replace(/_/g, " ")}
              >
                <div className={selected ? "text-emerald-700" : undefined}>
                  {stateIcon(selected ? "COMPLETED" : step.state)}
                </div>
                <span className={`text-xs font-semibold ${selected ? "text-emerald-800" : "text-slate-700"}`}>{step.label}</span>
                <span className={`text-[9px] font-medium uppercase tracking-wide ${selected ? "text-emerald-600" : "text-slate-400"}`}>{selected ? "SELECTED" : step.state.replace(/_/g, " ")}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
