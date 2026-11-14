"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Sprout, Mic, MessageCircle, ArrowUpRight, Sparkles } from "lucide-react";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { FarmerAssistantContent } from "../assistant/page";
import { FarmerCropAdvisorContent } from "../crop-advisor/page";
import { AdvisorView } from "../../../components/farmer/ai-views/advisor-view";

const tabs = [
  { id: "chat", label: "Chat & Voice", description: "Ask questions by typing or speaking", icon: MessageCircle },
  { id: "crop", label: "Crop Advice", description: "Get crop recommendations for your field", icon: Sprout },
  { id: "advisor", label: "Farm Advisor", description: "Understand sales, demand and farm performance", icon: Sparkles },
] as const;

export default function AiFarmAssistantPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["id"]>("chat");

  return (
    <div className="mx-auto w-full max-w-none space-y-5 pb-8">
      <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm"><Bot className="h-6 w-6" /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">AgriConnect intelligence</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">AI Farm Assistant</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">One workspace for farm questions, crop recommendations, voice assistance and data-driven farm insights.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800"><MessageCircle className="h-3.5 w-3.5" /> Chat</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-800"><Mic className="h-3.5 w-3.5" /> Voice</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-800"><Sprout className="h-3.5 w-3.5" /> Crop advice</span>
          </div>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-pressed={selected}
              className={cn("rounded-xl border p-4 text-left transition-all", selected ? "border-emerald-500 bg-emerald-50 shadow-sm ring-1 ring-emerald-500/20" : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50")}>
              <div className="flex items-center justify-between gap-2">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", selected ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600")}><Icon className="h-4 w-4" /></span>
                {selected && <span className="text-[11px] font-semibold text-emerald-700">Selected</span>}
              </div>
              <h2 className="mt-3 text-sm font-semibold text-slate-900">{tab.label}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{tab.description}</p>
            </button>
          );
        })}
      </div>

      <Card className="min-w-0 border-slate-200 shadow-sm">
        <CardContent className="min-w-0 p-4 sm:p-5">
          {activeTab === "chat" && <FarmerAssistantContent />}
          {activeTab === "crop" && <FarmerCropAdvisorContent />}
          {activeTab === "advisor" && <AdvisorView />}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div><p className="text-sm font-semibold text-slate-800">Individual pages remain available</p><p className="text-xs text-slate-500">Use these links to open each original tool separately.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/farmer/assistant">Voice Assistant <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/farmer/crop-advisor">Crop Advisor <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/farmer/advisor">AI Farm Advisor <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
        </div>
      </div>
    </div>
  );
}
