"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { CheckCircle2, FileText, Loader2, XCircle } from "lucide-react";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

const backendOrigin = (() => {
  try { return new URL(process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1").origin; }
  catch { return "http://localhost:8000"; }
})();

export default function AdminDeliveryPage() {
  const queryClient = useQueryClient();
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["adminDeliveryStats"],
    queryFn: () => api.get("/delivery/admin/stats"),
  });

  const { data: partnersData, isLoading: partnersLoading } = useQuery({
    queryKey: ["adminDeliveryPartners"],
    queryFn: () =>
      api.get("/delivery/admin/partners", {
        params: { limit: 100 },
      }),
  });

  const { data: documentsData, isLoading: documentsLoading } = useQuery({
    queryKey: ["adminDeliveryDocuments"],
    queryFn: () => api.get("/delivery/admin/documents"),
  });

  const summary = statsData?.data?.summary ?? {};
  const partnerInfo = statsData?.data?.partners ?? {};
  const partners = partnersData?.data?.partners ?? [];
  const documents = documentsData?.data?.documents ?? [];

  const statusFor = (p: any) => {
    if (!p.isAvailable) return { label: "Offline", variant: "secondary" as const };
    return { label: "Available", variant: "success" as const };
  };

  const reviewAction = async (partnerId: string, action: "verify" | "reject") => {
    const remark = action === "reject"
      ? window.prompt("Reason for rejection:") || "Documents need correction"
      : "";
    setReviewingId(partnerId);
    try {
      await api.put(`/delivery/admin/documents/${partnerId}/${action}`, { remark: remark || undefined });
      toast.success(action === "verify" ? "Driving licence verified" : "Driving licence rejected");
      queryClient.invalidateQueries({ queryKey: ["adminDeliveryDocuments"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to update document");
    } finally {
      setReviewingId(null);
    }
  };

  const docBadge = (status: string) => {
    if (status === "verified") return <Badge variant="success">Verified</Badge>;
    if (status === "rejected") return <Badge variant="destructive">Rejected</Badge>;
    return <Badge variant="warning">Under review</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Logistics</p>
        <h1 className="text-3xl font-semibold tracking-tight">Delivery operations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Monitor shipment progress, delays, and dispatch readiness.</p>
      </div>

      {statsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{summary.totalAssignments ?? 0}</p><p className="text-xs text-muted-foreground">Total assignments</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{summary.completed ?? 0}</p><p className="text-xs text-muted-foreground">Completed</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-600">{summary.inProgress ?? 0}</p><p className="text-xs text-muted-foreground">In progress</p></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{summary.completionRate ?? 0}%</p><p className="text-xs text-muted-foreground">Completion rate</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Driving licence verification</CardTitle>
          <CardDescription>Review driving licence photocopies submitted by delivery partners for security.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {documentsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : documents.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No driving licence documents submitted yet.</p>
          ) : (
            documents.map((doc: any) => {
              const dl = doc.drivingLicense || {};
              return (
                <div key={doc.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start">
                  <div className="h-24 w-full shrink-0 overflow-hidden rounded-md border bg-muted sm:h-24 sm:w-40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${backendOrigin}${dl.photoUrl}`} alt="Driving licence" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{doc.name}</p>
                      {docBadge(dl.status)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {doc.phone || "No phone"} {doc.vehicleNumber ? `• ${doc.vehicleNumber}` : ""}
                    </p>
                    {dl.licenseNumber && <p className="text-sm text-muted-foreground">Licence: {dl.licenseNumber}</p>}
                    {dl.expiryDate && <p className="text-sm text-muted-foreground">Expires: {dl.expiryDate}</p>}
                    {dl.remark && <p className="mt-1 text-xs text-amber-700">Admin note: {dl.remark}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {dl.status !== "verified" && (
                      <Button size="sm" variant="success" disabled={reviewingId === doc.id} onClick={() => reviewAction(doc.id, "verify")}>
                        {reviewingId === doc.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                        Approve
                      </Button>
                    )}
                    {dl.status !== "rejected" && (
                      <Button size="sm" variant="destructive" disabled={reviewingId === doc.id} onClick={() => reviewAction(doc.id, "reject")}>
                        {reviewingId === doc.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <XCircle className="mr-1.5 h-4 w-4" />}
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery partners</CardTitle>
          <CardDescription>
            {partnerInfo.total ?? 0} total • {partnerInfo.available ?? 0} available • {partnerInfo.busy ?? 0} busy
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {partnersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : partners.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No delivery partners found.</p>
          ) : (
            partners.map((partner) => {
              const name = partner.user?.name || partner.name || "Partner";
              const status = statusFor(partner);
              return (
                <div key={partner.id} className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-sm text-muted-foreground">
                      {partner.user?.phone || "No phone"} • {partner.vehicleType || "No vehicle"}
                    </p>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
