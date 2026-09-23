"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Brain, ChevronDown, Loader2, Sparkles, X, ArrowRight } from "lucide-react";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";

type BriefItem = {
  title?: string;
  message?: string;
  description?: string;
  reason?: string;
  suggestedAction?: string;
  action?: string;
  priority?: string;
  severity?: string;
  confidence?: number;
  model?: string;
};

export function AICopilot() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ai-copilot-brief"],
    queryFn: () => api.get("/ai/copilot/brief"),
    enabled: open,
    staleTime: 60_000,
    retry: 1,
  });

  const payload = data?.data || {};
  const items: BriefItem[] = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.insights) ? payload.insights : [];

  const summary = payload?.summary || payload?.message || payload?.title || "Your AI brief is ready.";
  const getMessage = (item: BriefItem) =>
    item.message || item.description || item.reason || "AI detected a useful marketplace insight.";
  const getAction = (item: BriefItem) => item.action || item.suggestedAction;

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}
        aria-label="Open AI copilot"
        className={cn("flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition",
          open ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50")}>
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">AI Copilot</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,420px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white"><Brain className="h-4 w-4" /></div>
              <div>
                <p className="text-sm font-semibold text-slate-900">AI Copilot</p>
                <p className="text-[11px] text-slate-500">{payload?.title || "Role-aware marketplace insights"}</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close AI copilot">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[min(70vh,560px)] overflow-y-auto p-4">
            {isLoading ? (
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> Preparing your latest insights...
              </div>
            ) : isError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                AI insights are temporarily unavailable. Your marketplace is still fully usable.
              </div>
            ) : items.length > 0 ? (
              <>
                <div className="mb-3 rounded-xl bg-emerald-50 p-4">
                  <p className="text-sm font-medium leading-6 text-emerald-950">{summary}</p>
                  {payload?.guardrail && <p className="mt-2 text-[11px] leading-5 text-emerald-800/70">{payload.guardrail}</p>}
                </div>
                <div className="space-y-3">
                  {items.slice(0, 5).map((item, index) => {
                    const action = getAction(item);
                    const confidence = typeof item.confidence === "number" ? Math.round(item.confidence * 100) : null;
                    return (
                      <div key={item.title || index} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{item.title || "AI insight"}</p>
                            {item.model && <p className="mt-0.5 text-[10px] font-medium text-slate-400">{item.model}</p>}
                          </div>
                          {(item.severity || item.priority) && (
                            <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{item.severity || item.priority}</span>
                          )}
                        </div>
                        <p className="mt-3 text-xs leading-5 text-slate-600">{getMessage(item)}</p>
                        {action && (
                          <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3">
                            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Suggested action</p>
                              <p className="mt-1 text-xs leading-5 text-slate-700">{action}</p>
                            </div>
                          </div>
                        )}
                        {confidence !== null && (
                          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
                            <span>Model confidence</span><span className="font-semibold text-emerald-700">{confidence}%</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                No marketplace insights are available right now. New insights will appear as activity changes.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
