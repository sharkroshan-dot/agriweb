"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Loader2, Package, MapPin, Clock, User, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn, formatPrice } from "../../../lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import toast from "react-hot-toast";

interface Job {
  id: string;
  orderId?: string;
  orderNumber?: string;
  customerName?: string;
  items?: number;
  pickupName?: string;
  deliveryArea?: string;
  deliveryCity?: string;
  earnings?: number;
  distanceKm?: number;
  distanceFromPartner?: number;
  weightKg?: number;
  status?: string;
  timeSlot?: string;
  expiresAt?: string;
  accepted?: boolean;
}

export default function DeliveryReassignPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("open");
  const [actionId, setActionId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["deliveryJobs"],
    queryFn: () => api.get("/delivery/me/jobs"),
    retry: 1,
  });

  const open: Job[] = (data?.data?.openJobs || []).map((j: any) => ({ ...j }));
  const accepted: Job[] = (data?.data?.acceptedJobs || []).map((j: any) => ({ ...j }));

  const assignMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/delivery/jobs/${jobId}/accept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deliveryJobs"] });
      toast.success("Job accepted");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to accept job"),
  });

  const releaseMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/delivery/jobs/${jobId}/release`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deliveryJobs"] });
      toast.success("Job released back to the pool");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to release job"),
  });

  const jobStatus = (j: Job) => (j.status === "delivered" ? "Delivered" : j.status === "in_transit" ? "In transit" : j.status === "accepted" ? "Accepted" : "Available");

  const renderJob = (j: Job, allowAction: boolean) => (
    <div key={j.id} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-emerald-600" />
          <p className="font-medium">{j.orderNumber || j.orderId?.slice(0, 8)}</p>
          <Badge variant={j.status === "delivered" ? "success" : j.status === "accepted" ? "secondary" : "outline"}>
            {jobStatus(j)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {j.earnings != null && <span className="font-semibold">{formatPrice(j.earnings)}</span>}
          {j.distanceKm != null && <span className="text-xs text-gray-400">{j.distanceKm} km</span>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        {j.customerName && <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 text-gray-400" /> {j.customerName}</span>}
        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-sky-500" /> {j.pickupName || "Farm"}</span>
        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-emerald-600" /> {j.deliveryArea || j.deliveryCity || "Customer"}</span>
        {j.weightKg != null && <span className="text-xs text-gray-400">{j.weightKg} kg</span>}
        {j.timeSlot && <span className="text-xs text-gray-400 flex items-center gap-1"><Clock className="h-3 w-3" /> {j.timeSlot}</span>}
      </div>
      {allowAction && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            disabled={assignMutation.isPending && actionId === j.id}
            onClick={() => { setActionId(j.id); assignMutation.mutate(j.id); }}
          >
            {assignMutation.isPending && actionId === j.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Accept job
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={releaseMutation.isPending && actionId === j.id}
            onClick={() => { setActionId(j.id); releaseMutation.mutate(j.id); }}
          >
            {releaseMutation.isPending && actionId === j.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Release
          </Button>
        </div>
      )}
    </div>
  );

  const shown = filter === "accepted" ? accepted : open;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Auto-Reassignment</h1>
        <p className="text-gray-500">
          When a rider is busy or declines, jobs auto-reassign to the next available driver — so orders never sit.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="success" className="gap-1"><RefreshCcw className="h-3 w-3" /> Auto-reassign on</Badge>
          <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Timeout 5 min</Badge>
        </div>
        <Select value={filter} onValueChange={setFilter} className="w-44">
          <SelectContent>
            <SelectItem value="open">Open jobs</SelectItem>
            <SelectItem value="accepted">My accepted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {filter === "accepted" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Package className="h-5 w-5 text-emerald-600" />}
            {filter === "accepted" ? "Jobs I accepted" : "Available jobs (auto-reassigned pool)"}
          </CardTitle>
          <CardDescription>
            {filter === "accepted"
              ? "Jobs you took. Release one to hand it back to the auto-reassignment pool."
              : "These jobs were offered to another rider and auto-reassigned to you."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center py-14 text-center">
              <RefreshCcw className="h-10 w-10 text-gray-300" />
              <p className="mt-3 font-medium text-gray-600">No {filter === "accepted" ? "accepted" : "open"} jobs</p>
              <p className="text-sm text-gray-400">{filter === "accepted" ? "Accept a job to see it here." : "New orders will appear here for auto-assignment."}</p>
            </div>
          ) : (
            <div className="space-y-3">{shown.map((j) => renderJob(j, filter === "open"))}</div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-800">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <p>
          <b>How it works:</b> If a rider doesn't accept within 5 minutes, the job is released and reassigned to the next available driver automatically. No manual intervention needed.
        </p>
      </div>
    </div>
  );
}