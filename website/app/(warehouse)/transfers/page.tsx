"use client";

import { useState, useMemo } from "react";
import { ArrowLeftRight, Search, Filter, CheckCircle, XCircle, Clock, ArrowUpRight } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { formatDate, formatPrice } from "../../lib/utils";

interface Transfer {
  id: string;
  product: string;
  quantity: string;
  from: string;
  to: string;
  status: "in_transit" | "completed" | "pending" | "cancelled";
  initiatedBy: string;
  date: string;
  notes: string;
}

const sampleTransfers: Transfer[] = [
  { id: "TRF-001", product: "Fresh Tomatoes", quantity: "50 kg", from: "Main Warehouse A", to: "Annur Distribution Hub", status: "completed", initiatedBy: "Admin", date: "2025-07-05", notes: "Regular stock replenishment" },
  { id: "TRF-002", product: "Organic Oranges", quantity: "30 kg", from: "Main Warehouse A", to: "Pollachi Cold Storage", status: "in_transit", initiatedBy: "System", date: "2025-07-08", notes: "Temperature sensitive - priority" },
  { id: "TRF-003", product: "Leafy Spinach", quantity: "20 bunches", from: "Mettupalayam Hub", to: "Main Warehouse A", status: "pending", initiatedBy: "Warehouse Manager", date: "2025-07-10", notes: "Awaiting pickup" },
  { id: "TRF-004", product: "Raw Honey", quantity: "15 jars", from: "Cold Storage B", to: "Main Warehouse A", status: "completed", initiatedBy: "Admin", date: "2025-07-03", notes: "Batch transfer complete" },
  { id: "TRF-005", product: "Potatoes", quantity: "100 kg", from: "Main Warehouse A", to: "City Distribution Hub", status: "cancelled", initiatedBy: "System", date: "2025-07-06", notes: "Route unavailable" },
];

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  completed: { label: "Completed", color: "border-green-200 bg-green-50 text-green-700", icon: CheckCircle },
  in_transit: { label: "In Transit", color: "border-blue-200 bg-blue-50 text-blue-700", icon: ArrowUpRight },
  pending: { label: "Pending", color: "border-yellow-200 bg-yellow-50 text-yellow-700", icon: Clock },
  cancelled: { label: "Cancelled", color: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
};

export default function WarehouseTransfersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return sampleTransfers.filter((t) => {
      const matchSearch = t.id.toLowerCase().includes(search.toLowerCase()) || t.product.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || t.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [search, statusFilter]);

  const activeTransfers = sampleTransfers.filter((t) => t.status === "in_transit").length;
  const pendingTransfers = sampleTransfers.filter((t) => t.status === "pending").length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transfers</h1>
          <p className="text-sm text-muted-foreground">Stock movement between facilities</p>
        </div>
        <Button>
          <ArrowLeftRight className="mr-2 h-4 w-4" /> New Transfer
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{sampleTransfers.length}</p>
            <p className="text-xs text-muted-foreground">Total Transfers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{activeTransfers}</p>
            <p className="text-xs text-muted-foreground">In Transit</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-yellow-600">{pendingTransfers}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search transfers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          {["all", "pending", "in_transit", "completed", "cancelled"].map((s) => (
            <Button key={s} variant={statusFilter === s ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(s)}>
              {s === "in_transit" ? "In Transit" : s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <ArrowLeftRight className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 font-medium">No transfers found</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((transfer) => {
            const StatusIcon = statusConfig[transfer.status].icon;
            return (
              <Card key={transfer.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="rounded-full bg-slate-100 p-2">
                        <ArrowLeftRight className="h-5 w-5 text-slate-600" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{transfer.id}</p>
                          <Badge className={statusConfig[transfer.status].color}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {statusConfig[transfer.status].label}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm font-medium text-slate-900">{transfer.product} - {transfer.quantity}</p>
                        <p className="text-xs text-muted-foreground">
                          {transfer.from} → {transfer.to}
                        </p>
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-muted-foreground">{formatDate(transfer.date)}</p>
                      <p className="text-xs text-muted-foreground">by {transfer.initiatedBy}</p>
                    </div>
                  </div>
                  {transfer.notes && (
                    <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">{transfer.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
