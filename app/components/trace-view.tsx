"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  Loader2,
  Layers,
  Wheat,
  Snowflake,
  FlaskConical,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Package,
} from "lucide-react";
import { api } from "../lib/api/client";
import { formatDate, formatPrice } from "../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { QRCodeSVG } from "qrcode.react";

const STORAGE_LABELS: Record<string, string> = {
  normal: "Normal / ambient",
  refrigerated: "Refrigerated",
  cold_storage: "Cold storage",
  frozen: "Frozen",
};

export default function TraceView({ lot }: { lot: string }) {
  const [input, setInput] = useState(lot);

  const { data, isLoading, error } = useQuery({
    queryKey: ["trace", lot],
    queryFn: () => api.get(`/batches/trace/${encodeURIComponent(lot)}`),
    enabled: !!lot,
    retry: false,
  });

  const batch = data?.data;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            AgriConnect Traceability
          </div>
          <span className="text-xs text-slate-400">From farm to doorstep</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Track a harvest lot</CardTitle>
            <CardDescription>
              Enter the lot number printed on your product label or delivery slip (e.g. LOT-20260817-001).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim()) window.location.href = `/trace/${encodeURIComponent(input.trim().toUpperCase())}`;
              }}
            >
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="LOT-YYYYMMDD-NNN" />
              <Button type="submit">
                <Search className="mr-2 h-4 w-4" /> Trace
              </Button>
            </form>
          </CardContent>
        </Card>

        {!lot ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-slate-500">
              <Layers className="h-10 w-10 text-slate-300" />
              <p className="text-sm">Enter a lot number above to see the full journey of your produce.</p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          </div>
        ) : error || !batch ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <XCircle className="h-10 w-10 text-red-400" />
              <p className="text-sm font-medium text-slate-700">Lot &quot;{lot}&quot; not found</p>
              <p className="text-xs text-slate-500">Double-check the lot number and try again.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 font-mono text-base">
                    <Layers className="h-5 w-5 text-emerald-600" /> {batch.lotNumber}
                  </CardTitle>
                  {batch.listed ? (
                    <Badge variant="success">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Traceable · Listed
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Recorded</Badge>
                  )}
                </div>
                <CardDescription>Verified lot record from the AgriConnect network</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-center gap-2 text-sm">
                  <Wheat className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-500">Crop</span>
                  <span className="ml-auto font-medium">{batch.cropName}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-500">Quantity</span>
                  <span className="ml-auto font-medium">{batch.quantityKg} kg</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Snowflake className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-500">Storage</span>
                  <span className="ml-auto font-medium">{STORAGE_LABELS[batch.storageType] ?? batch.storageType ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <FlaskConical className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-500">Quality grade</span>
                  <span className="ml-auto font-medium">{batch.qualityGrade ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm sm:col-span-2">
                  <ShieldCheck className="h-4 w-4 text-slate-400" />
                  <span className="text-slate-500">Verification</span>
                  <span className="ml-auto">
                    {batch.verificationStatus === "verified" || batch.verificationStatus === "buyer_verified" ? (
                      <Badge variant="success">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Grade {batch.effectiveGrade} Verified
                        {batch.verifiedAt ? ` · ${formatDate(batch.verifiedAt)}` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        ⚠ Farmer Declared{batch.farmerDeclaredGrade ? ` Grade ${batch.farmerDeclaredGrade}` : ""} · Not verified
                      </Badge>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Harvested</span>
                  <span className="ml-auto font-medium">{formatDate(batch.harvestDate)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">Best before</span>
                  <span className="ml-auto font-medium">{formatDate(batch.expiresAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm sm:col-span-2">
                  <span className="text-slate-500">Freshness</span>
                  <span className="ml-auto">
                    {batch.freshness?.status === "fresh" && <Badge variant="success">Fresh ({batch.freshness.daysRemaining} days left)</Badge>}
                    {batch.freshness?.status === "expiring" && <Badge variant="warning">Expiring ({batch.freshness.daysRemaining} day left)</Badge>}
                    {batch.freshness?.status === "expired" && <Badge variant="destructive">Expired</Badge>}
                    {batch.freshness?.status === "unknown" && <Badge variant="secondary">Unknown</Badge>}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 text-emerald-600" /> Farm of origin
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">{batch.farmer?.farmName ?? batch.farmer?.farmerName ?? "Registered farmer"}</p>
                {batch.farmer?.farmerName && <p className="text-slate-500">Farmer: {batch.farmer.farmerName}</p>}
                <p className="text-slate-500">
                  {[batch.farmer?.village, batch.farmer?.city, batch.farmer?.district, batch.farmer?.state]
                    .filter(Boolean)
                    .join(", ")}{" "}
                  {batch.farmer?.pincode ? `- ${batch.farmer.pincode}` : ""}
                </p>
              </CardContent>
            </Card>

            {batch.product && (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                  <div>
                    <p className="font-medium">{batch.product.name}</p>
                    <p className="text-xs text-slate-500">Listed on the AgriConnect marketplace</p>
                  </div>
                  <span className="font-semibold">{formatPrice(batch.product.price)} / {batch.product.unit}</span>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" /> Scan to verify this lot
                </CardTitle>
                <CardDescription>Print this QR on the packaging so buyers can trace the lot anywhere.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-3 py-6">
                <div className="rounded-2xl border bg-white p-4">
                  <QRCodeSVG
                    value={`${window.location.origin}/trace/${encodeURIComponent(batch.lotNumber)}`}
                    size={160}
                    level="M"
                  />
                </div>
                <p className="font-mono text-xs text-slate-500">{`${window.location.origin}/trace/${batch.lotNumber}`}</p>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
