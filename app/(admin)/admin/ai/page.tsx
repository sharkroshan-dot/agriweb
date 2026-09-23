"use client";

import { useQuery } from "@tanstack/react-query";
import { Brain, MessageSquare, Sparkles, TrendingUp, Loader2 } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Progress } from "../../../components/ui/progress";
import { api } from "../../../lib/api/client";

const modelLabelMap: Record<string, string> = {
  price_prediction: "Price Prediction",
  demand_forecast: "Demand Forecasting",
  demand_forecasting: "Demand Forecasting",
  crop_recommendation: "Crop Recommendation",
  quality_assessment: "Quality Assessment",
  weather_impact: "Weather Impact",
};

export default function AdminAIDashboardPage() {
  const { data: analyticsData, isLoading } = useQuery({
    queryKey: ["adminAIStats"],
    queryFn: () => api.get("/ai/analytics"),
  });

  const { data: modelsData } = useQuery({
    queryKey: ["adminAIModels"],
    queryFn: () => api.get("/ai/models"),
  });

  const models = modelsData?.data ?? [];
  const ai = analyticsData?.data ?? {};

  const modelList = models.length > 0 ? models : ai.models ?? [];
  const totalPredictions = ai.totalPredictions ?? modelList.reduce((s, m) => s + (m.totalPredictions || 0), 0);
  const avgAccuracy =
    ai.avgAccuracy ??
    (modelList.length > 0
      ? modelList.reduce((sum, m) => sum + (m.accuracy ?? m.predictionAccuracy ?? 0), 0) / modelList.length
      : 0);
  const accuracyPct = Math.round((Number(avgAccuracy) || 0) * 1000) / 10;
  const totalModels = modelList.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">AI operations</p>
        <h1 className="text-3xl font-semibold tracking-tight">Intelligence and automation center</h1>
        <p className="mt-1 text-sm text-muted-foreground">Inspect model health, inference performance, and automation outcomes across the platform.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Inference volume</p>
                    <p className="mt-2 text-2xl font-semibold">{totalPredictions > 0 ? totalPredictions.toLocaleString("en-IN") : "No data"}</p>
                  </div>
                  <div className="rounded-full bg-primary/10 p-2 text-primary"><Brain className="h-4 w-4" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Model accuracy</p>
                    <p className="mt-2 text-2xl font-semibold">{avgAccuracy ? `${accuracyPct}%` : "No data"}</p>
                  </div>
                  <div className="rounded-full bg-emerald-100 p-2 text-emerald-700"><Sparkles className="h-4 w-4" /></div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Active models</p>
                    <p className="mt-2 text-2xl font-semibold">{totalModels}</p>
                  </div>
                  <div className="rounded-full bg-amber-100 p-2 text-amber-700"><TrendingUp className="h-4 w-4" /></div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Model health</CardTitle>
                <CardDescription>Performance and status of production AI models.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {modelList.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No models available.</p>
                ) : (
                  modelList.map((model) => {
                    const label = modelLabelMap[model.type ?? model.modelType] ?? (model.type ?? model.modelType ?? "Model").replace(/_/g, " ");
                    const accuracy = Number(model.accuracy ?? model.predictionAccuracy ?? 0);
                    const status = model.status || (accuracy >= 0.85 ? "deployed" : "training");
                    return (
                      <div key={model.id ?? label} className="rounded-lg border p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="font-medium capitalize">{label}</p>
                          <Badge variant={status === "deployed" ? "success" : status === "training" ? "warning" : "secondary"}>
                            {status.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
                          <span>Accuracy</span>
                          <span>{accuracy ? `${Math.round(accuracy * 100)}%` : "N/A"}</span>
                        </div>
                        <Progress value={accuracy ? Math.round(accuracy * 100) : 0} />
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI assistant activity</CardTitle>
                <CardDescription>Recent AI insights generated for the platform.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {modelList.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No AI activity yet.</p>
                ) : (
                  modelList.slice(0, 5).map((model) => {
                    const label = modelLabelMap[model.type ?? model.modelType] ?? (model.type ?? model.modelType ?? "Model").replace(/_/g, " ");
                    return (
                      <div key={model.id ?? label} className="flex items-start gap-3 rounded-lg border p-3">
                        <div className="rounded-full bg-primary/10 p-2 text-primary"><MessageSquare className="h-4 w-4" /></div>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium capitalize text-foreground">{label}</span> model is{" "}
                          {model.status === "deployed" ? "active and serving predictions" : model.status === "training" ? "currently training" : "available"}.
                        </p>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
