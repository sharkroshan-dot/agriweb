"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, CalendarDays, Wheat, Loader2, Sprout, TrendingUp, IndianRupee } from "lucide-react";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";

export default function FarmerSupplyCalendarPage() {
  const { data: plansData, isLoading } = useQuery({
    queryKey: ["farmerSupplyCalendarFromHarvestPlans"],
    queryFn: () => api.get("/harvests/farmer/plans"),
    retry: 1,
  });

  const { data: batchesData } = useQuery({
    queryKey: ["farmerSupplyCalendarBatches"],
    queryFn: () => api.get("/batches"),
    retry: 1,
  });

  const plans = plansData?.data?.plans || [];
  const batches = batchesData?.data?.batches || [];

  // Supply Calendar is a read-only view of Harvest Planner.
  // The farmer does not create an independent supply record here.
  const entries = useMemo(() => {
    return plans
      .filter((p: any) => p.status !== "cancelled")
      .map((p: any) => {
        const planId = String(p._id || p.id);
        const batch = batches.find(
          (b: any) => String(b.sourceHarvestPlanId || "") === planId
        );
        const qualityStatus = batch?.qualityStatus || "not_created";

        let status = "planned";
        if (p.status === "preorder") status = "preorder";
        if (p.status === "harvested") status = "harvested";
        if (p.status === "harvested" && batch) status = "batched";
        if (p.status === "harvested" && batch?.qualityStatus === "approved") {
          status = "quality_approved";
        }

        return {
          id: planId,
          cropName: p.cropName,
          expectedDate: p.expectedHarvestDate,
          expectedQuantityKg: Number(p.expectedQuantityKg || 0),
          actualQuantityKg:
            p.actualQuantityKg != null ? Number(p.actualQuantityKg) : null,
          plannedRatePerKg: p.preOrderPricePerKg,
          finalRatePerKg: p.finalRatePerKg != null ? Number(p.finalRatePerKg) : null,
          preOrderCount: Number(p.preorderCount || 0),
          status,
          batchId: batch?._id || batch?.id,
          qualityStatus,
        };
      })
      .sort(
        (a: any, b: any) =>
          new Date(a.expectedDate).getTime() -
          new Date(b.expectedDate).getTime()
      );
  }, [plans, batches]);

  const totalKg = entries.reduce(
    (sum: number, entry: any) =>
      sum + Number(entry.actualQuantityKg ?? entry.expectedQuantityKg ?? 0),
    0
  );

  const totalPreorders = entries.reduce(
    (sum: number, entry: any) => sum + Number(entry.preOrderCount || 0),
    0
  );

  const monthLabel = new Date().toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Supply Calendar</h1>
          <p className="text-gray-500">
            Supply is tracked from your Harvest Planner. Mark the harvest there
            first; the actual harvested quantity then drives the supply chain.
          </p>
        </div>
        <Badge variant="outline">Linked to Harvest Planner</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-gray-500">{monthLabel} — tracked supply</p>
              <p className="text-2xl font-bold text-emerald-700">{totalKg} kg</p>
              <p className="text-xs text-gray-500">
                Actual kg after harvest; expected kg before harvest
              </p>
            </div>
            <Boxes className="h-8 w-8 text-emerald-600" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-gray-500">Harvest plans</p>
              <p className="text-2xl font-bold text-blue-700">{entries.length}</p>
            </div>
            <Sprout className="h-8 w-8 text-blue-600" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-gray-500">Pre-orders</p>
              <p className="text-2xl font-bold text-amber-700">{totalPreorders}</p>
            </div>
            <TrendingUp className="h-8 w-8 text-amber-600" />
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <CalendarDays className="h-10 w-10 text-gray-300" />
            <p className="mt-3 font-medium text-gray-600">No harvest plans yet</p>
            <p className="text-sm text-slate-500">
              Create a harvest plan from Harvest Planner. It will appear here
              automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry: any) => {
            const harvested = ["harvested", "batched", "quality_approved"].includes(entry.status);
            const quantity = entry.actualQuantityKg ?? entry.expectedQuantityKg;
            const statusLabel =
              entry.status === "quality_approved"
                ? "Quality Approved"
                : entry.status === "batched"
                  ? "Batch Created"
                  : entry.status === "harvested"
                    ? "Harvested"
                    : entry.status === "preorder"
                      ? "Pre-order Open"
                      : "Planned";

            return (
              <Card key={entry.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={cn(
                        "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg",
                        harvested ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                      )}
                    >
                      <span className="text-base font-bold leading-none">
                        {new Date(entry.expectedDate).getDate()}
                      </span>
                      <span className="text-[10px] uppercase">
                        {new Date(entry.expectedDate).toLocaleDateString("en-IN", { month: "short" })}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{entry.cropName}</p>
                        <Badge variant={harvested ? "secondary" : "outline"}>{statusLabel}</Badge>
                      </div>

                      <p className="text-sm text-gray-500">
                        <span className="font-medium text-slate-600">Actual:</span>{" "}
                        <span className="font-semibold text-slate-700">
                          {entry.actualQuantityKg != null ? `${entry.actualQuantityKg} kg` : "—"}
                        </span>
                        {" · "}
                        <span className="font-medium text-slate-600">Expected:</span>{" "}
                        <span className="font-semibold text-slate-700">{entry.expectedQuantityKg} kg</span>
                        {" · "}
                        {formatDate(entry.expectedDate)}
                        {entry.preOrderCount > 0 && ` · ${entry.preOrderCount} pre-orders`}
                      </p>

                      <p className="mt-1 text-sm">
                        <span className="text-slate-500">Planned/pre-order rate:</span>{" "}
                        <span className="font-semibold text-slate-700">
                          {entry.plannedRatePerKg != null ? `₹${entry.plannedRatePerKg}/kg` : "—"}
                        </span>
                        {" · "}
                        <span className="text-slate-500">Final rate:</span>{" "}
                        <span className={cn(
                          "font-semibold",
                          entry.finalRatePerKg != null ? "text-emerald-700" : "text-slate-400"
                        )}>
                          {entry.finalRatePerKg != null ? `₹${entry.finalRatePerKg}/kg` : "Not harvested"}
                        </span>
                      </p>

                      <p className="mt-1 text-xs">
                        {entry.batchId ? (
                          <span className="font-medium text-slate-500">
                            Batch created · Quality:{" "}
                            <span className={entry.qualityStatus === "approved" ? "text-emerald-700" : "text-amber-700"}>
                              {entry.qualityStatus === "approved" ? "Approved" : "Pending inspection"}
                            </span>
                          </span>
                        ) : entry.actualQuantityKg != null ? (
                          <span className="font-medium text-amber-700">
                            Harvest recorded · Create a batch from this harvest.
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            Harvest not recorded yet · Complete this crop in Harvest Planner.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className={cn(
                      "flex items-center gap-1 text-sm font-semibold",
                      (entry.finalRatePerKg ?? entry.plannedRatePerKg) ? "text-emerald-700" : "text-slate-400"
                    )}>
                      <IndianRupee className="h-4 w-4" />
                      {entry.finalRatePerKg ?? entry.plannedRatePerKg ?? "—"}/kg
                    </span>
                    <Wheat className="h-4 w-4 text-slate-300" />
                  </div>
                </CardContent>
              </Card>
            );
          })}})}
        </div>
      )}

      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-emerald-600" />
            Correct supply-chain flow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-5">
            {[
              ["Harvest Planner", "Create expected harvest"],
              ["Mark Harvested", "Record actual kg"],
              ["Batch", "Create traceable lot"],
              ["Quality", "Inspect and approve"],
              ["Inventory", "Only approved produce becomes sellable"],
            ].map(([title, description]) => (
              <div
                key={title}
                className="rounded-lg border border-emerald-200 bg-white/70 p-3"
              >
                <p className="text-sm font-semibold text-emerald-800">{title}</p>
                <p className="mt-1 text-xs text-emerald-900/70">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
