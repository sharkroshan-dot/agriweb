"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";

export default function ChatSafetyPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const { data, refetch } = useQuery({
    queryKey: ["adminChatSafetyReports"],
    queryFn: () => api.get("/chat/safety/reports"),
  });
  const reports = Array.isArray(data?.data) ? data.data : [];

  async function resolve(id: string, action: string) {
    setBusy(id);
    try {
      await api.post(`/chat/safety/reports/${id}/resolve? action=${encodeURIComponent(action)}`.replace("? action=", "?action="));
      await refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Communication Safety</h1>
        <p className="text-sm text-slate-500">Review reported AgriConnect conversations and moderation cases.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-5"><p className="text-xs text-slate-500">Pending reports</p><p className="mt-1 text-2xl font-bold">{reports.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs text-slate-500">Moderation</p><p className="mt-1 text-2xl font-bold">Active</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs text-slate-500">Access model</p><p className="mt-1 text-sm font-semibold">Relationship-based</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs text-slate-500">Attachments</p><p className="mt-1 text-sm font-semibold">Validated + scanned</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Pending reports</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!reports.length && <p className="text-sm text-slate-500">No pending communication reports.</p>}
          {reports.map((report: any) => (
            <div key={String(report.id || report._id)} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{report.reason}</p>
                  <p className="text-xs text-slate-500">Conversation: {report.conversation_id}</p>
                </div>
                <Badge variant="outline">{report.status}</Badge>
              </div>
              {report.details && <p className="mt-2 text-sm text-slate-600">{report.details}</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={busy === String(report.id || report._id)} onClick={() => resolve(String(report.id || report._id), "reviewed")}>Review / close</Button>
                <Button size="sm" variant="outline" disabled={busy === String(report.id || report._id)} onClick={() => resolve(String(report.id || report._id), "restrict")}>Restrict</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
