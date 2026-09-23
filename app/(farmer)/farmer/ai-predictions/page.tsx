"use client";

import { useState } from "react";
import { Map, Bot } from "lucide-react";
import { cn } from "../../../lib/utils";
import { DemandHeatmapView } from "../../../components/farmer/ai-views/demand-heatmap-view";
import { AdvisorView } from "../../../components/farmer/ai-views/advisor-view";

const TABS = [
  { id: "heatmap", label: "Demand Heatmap", icon: Map },
  { id: "advisor", label: "AI Advisor", icon: Bot },
];

export default function AiPredictionsPage() {
  const [tab, setTab] = useState("heatmap");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">AI Predictions</h1>
        <p className="text-gray-500">
          Where the demand is, and what to do about it — two AI views from your real farm data.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
              tab === t.id
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "heatmap" ? <DemandHeatmapView /> : <AdvisorView />}
    </div>
  );
}