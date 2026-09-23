"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ChevronDown, ChevronUp, MessageSquare, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { api } from "../../../lib/api/client";
import { formatDate, cn } from "../../../lib/utils";

type ComplaintStatus = "pending" | "under_review" | "resolved" | "rejected";

interface Complaint {
  id: number;
  user: { id: number; name: string; email: string };
  type: string;
  subject: string;
  description: string;
  status: ComplaintStatus;
  created_at: string;
  response?: string;
  updated_at?: string;
}

const statusConfig: Record<ComplaintStatus, { label: string; variant: "warning" | "default" | "success" | "destructive" }> = {
  pending: { label: "Pending", variant: "warning" },
  under_review: { label: "Under Review", variant: "default" },
  resolved: { label: "Resolved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
};

const complaintTypes = ["all", "product_quality", "delivery", "payment", "service", "other"];

export default function AdminComplaintsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [statusUpdate, setStatusUpdate] = useState<ComplaintStatus | "">("");

  const { data, isLoading } = useQuery({
    queryKey: ["complaints", page, statusFilter, typeFilter, query],
    queryFn: () =>
      api.get<{
        data: Complaint[];
        meta?: { total: number; page: number; last_page: number };
      }>("/complaints", {
        params: { page, per_page: pageSize, status: statusFilter !== "all" ? statusFilter : undefined, type: typeFilter !== "all" ? typeFilter : undefined, search: query || undefined },
      }),
  });

  const complaints = data?.data ?? [];
  const total = data?.meta?.total ?? complaints.length;
  const lastPage = data?.meta?.last_page ?? Math.ceil(total / pageSize);

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { status?: ComplaintStatus; response?: string } }) => api.put(`/complaints/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["complaints"] });
      setResponseText("");
      setStatusUpdate("");
      setSelectedComplaint(null);
    },
  });

  const handleOpenDetail = (complaint: Complaint) => {
    setSelectedComplaint(complaint);
    setResponseText(complaint.response ?? "");
    setStatusUpdate(complaint.status);
  };

  const handleUpdate = () => {
    if (!selectedComplaint) return;
    const body: { status?: ComplaintStatus; response?: string } = {};
    if (statusUpdate && statusUpdate !== selectedComplaint.status) body.status = statusUpdate as ComplaintStatus;
    if (responseText !== (selectedComplaint.response ?? "")) body.response = responseText;
    if (Object.keys(body).length === 0) return;
    updateMutation.mutate({ id: selectedComplaint.id, body });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Complaints</h1>
          <p className="text-sm text-muted-foreground">Manage user complaints, review issues, and respond.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ["complaints"] })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search complaints..."
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(statusConfig).map(([key, config]) => (
              <SelectItem key={key} value={key}>{config.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            {complaintTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type === "all" ? "All types" : type.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>All Complaints</CardTitle>
          <CardDescription>{total} complaint{total !== 1 ? "s" : ""} found</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading complaints...</div>
          ) : complaints.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">No complaints found.</div>
          ) : (
            <div className="space-y-2">
              {complaints.map((complaint) => {
                const statusConf = statusConfig[complaint.status];
                const isExpanded = expandedId === complaint.id;
                return (
                  <div key={complaint.id} className="rounded-lg border">
                    <div
                      className="flex cursor-pointer flex-wrap items-center gap-3 p-4 sm:flex-nowrap"
                      onClick={() => setExpandedId(isExpanded ? null : complaint.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">#{complaint.id}</p>
                          <Badge variant={statusConf.variant}>{statusConf.label}</Badge>
                          <span className="hidden rounded bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600 sm:inline">
                            {complaint.type.replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-700">{complaint.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {complaint.user.name} &middot; {formatDate(complaint.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); handleOpenDetail(complaint); }}
                        >
                          <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                          Respond
                        </Button>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 pt-3">
                        <p className="whitespace-pre-wrap text-sm text-slate-600">{complaint.description}</p>
                        {complaint.response && (
                          <div className="mt-3 rounded-lg bg-blue-50 p-3">
                            <p className="text-xs font-medium text-blue-600">Admin Response</p>
                            <p className="mt-1 text-sm text-blue-800">{complaint.response}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {lastPage}
          </span>
          <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Dialog open={!!selectedComplaint} onOpenChange={(open) => { if (!open) setSelectedComplaint(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complaint #{selectedComplaint?.id}</DialogTitle>
            <DialogDescription>
              {selectedComplaint?.user.name} &middot; {selectedComplaint?.type.replace("_", " ")}
            </DialogDescription>
          </DialogHeader>
          {selectedComplaint && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{selectedComplaint.subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{selectedComplaint.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">Submitted {formatDate(selectedComplaint.created_at)}</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Status</label>
                  <Select value={statusUpdate} onValueChange={(v) => setStatusUpdate(v as ComplaintStatus)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(statusConfig).map(([key, conf]) => (
                        <SelectItem key={key} value={key}>{conf.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Response</label>
                  <textarea
                    className="min-h-[100px] w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Write your response..."
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedComplaint(null)}>Cancel</Button>
                <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
