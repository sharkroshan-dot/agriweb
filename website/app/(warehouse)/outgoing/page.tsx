"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ArrowUp, Truck, RefreshCw, PackageCheck, Clock3, AlertCircle } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { api } from "../../lib/api/client";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  packed: "bg-blue-100 text-blue-700",
  in_transit: "bg-purple-100 text-purple-700",
  delivered: "bg-green-100 text-green-700",
  delayed: "bg-red-100 text-red-700",
};

export default function WarehouseOutgoingPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["warehouseOutgoing", statusFilter],
    queryFn: () => api.get("/warehouse/me/outgoing", { params: { status: statusFilter !== "all" ? statusFilter : undefined } }),
  });

  const outgoing = data?.data?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Outgoing Stock</h1>
          <p className="text-muted-foreground">Track outbound shipments and dispatch readiness</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search dispatch orders..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="packed">Packed</SelectItem>
            <SelectItem value="in_transit">In Transit</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="delayed">Delayed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map((i)=><div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}</div>
      ) : outgoing.length === 0 ? (
        <Card className="p-12 text-center">
          <ArrowUp className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No outgoing shipments</h3>
          <p className="mt-2 text-muted-foreground">Dispatches will appear here once orders are packed.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {outgoing.map((item: any) => (
            <Card key={item.id}>
              <CardContent className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold">{item.orderId || item.batchName || "Dispatch Order"}</h3>
                      <Badge className={statusColors[item.status] || "bg-slate-100 text-slate-700"}>{item.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{item.destination || "To customer"} • {item.quantity || 0} units</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Truck className="h-4 w-4" />{item.vehicle || "Fleet vehicle"}</span>
                      <span className="flex items-center gap-1"><Clock3 className="h-4 w-4" />{item.eta || "Pending"}</span>
                      {item.priority === "high" && <span className="flex items-center gap-1 text-red-600"><AlertCircle className="h-4 w-4" />High priority</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline"><PackageCheck className="mr-2 h-4 w-4" />Pack</Button>
                    <Button size="sm">Dispatch</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
