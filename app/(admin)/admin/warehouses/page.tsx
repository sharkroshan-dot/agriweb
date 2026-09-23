"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Loader2 } from "lucide-react";
import { api } from "../../../lib/api/client";

export default function AdminWarehousesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["adminWarehouses"],
    queryFn: () =>
      api.get("/warehouse/admin", {
        params: { limit: 100 },
      }),
  });

  const warehouses = data?.data?.warehouses ?? [];

  const utilization = (w: any) =>
    w.totalCapacity ? Math.round((w.usedCapacity || 0) / w.totalCapacity * 100) : 0;

  const statusFor = (w: any) => {
    if (!w.isActive) return { label: "Inactive", variant: "secondary" as const };
    const util = utilization(w);
    if (util >= 90) return { label: "At capacity", variant: "warning" as const };
    return { label: "Healthy", variant: "success" as const };
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Storage network</p>
        <h1 className="text-3xl font-semibold tracking-tight">Warehouse management</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track operational status across storage and cold-chain sites.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Warehouses</CardTitle>
          <CardDescription>Summary of active facilities and their health status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : warehouses.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No warehouses found.</p>
          ) : (
            warehouses.map((warehouse) => {
              const address = warehouse.address || {};
              const location = [address.city, address.state, address.country].filter(Boolean).join(", ") || "Location not set";
              const status = statusFor(warehouse);
              return (
                <div key={warehouse.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{warehouse.name}</p>
                    <p className="text-sm text-muted-foreground">{location}</p>
                    <p className="text-sm text-muted-foreground">
                      {warehouse.usedCapacity || 0} / {warehouse.totalCapacity || 0} used ({utilization(warehouse)}%)
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
