"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";\nimport toast from "react-hot-toast";
import { RefreshCw, Warehouse, Route, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";

export default function WarehouseFulfillmentPage() {
  const [refreshKey, setRefreshKey] = useState(0);\n  const transferMutation = useMutation({
    mutationFn: ({ orderId, hubId, quantity }: { orderId: string; hubId: string; quantity: number }) =>
      api.post(`/fulfillment/orders/${orderId}/transfer-to-hub`, { hubId, quantity }),
    onSuccess: () => { setRefreshKey((v) => v + 1); toast.success("Transfer to local hub started"); },
    onError: (e: any) => toast.error(e?.message || "Transfer failed"),
  });

  const hubsQuery = useQuery({
    queryKey: ["fulfillmentHubs", refreshKey],
    queryFn: () => api.get("/fulfillment/hubs"),
  });
  const incomingQuery = useQuery({
    queryKey: ["fulfillmentIncoming", refreshKey],
    queryFn: () => api.get("/warehouse/me/incoming", { params: { limit: 100 } }),
  });

  const hubs = hubsQuery.data?.data?.hubs ?? [];
  const incoming = incomingQuery.data?.data?.incoming ?? [];\n  const ordersQuery = useQuery({
    queryKey: ["warehouseTransferOrders", refreshKey],
    queryFn: () => api.get("/orders", { params: { status: "transfer_pending", limit: 100 } }),
  });
  const transferOrders = ordersQuery.data?.data?.orders ?? [];


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Fulfillment Routing</h1>
          <p className="text-muted-foreground">Distance, ETA, shelf-life risk and local-hub routing.</p>
        </div>
        <Button variant="outline" onClick={() => setRefreshKey((v) => v + 1)}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5"><Warehouse className="h-5 w-5" /><p className="mt-2 text-2xl font-bold">{hubs.length}</p><p className="text-sm text-muted-foreground">Approved local hubs</p></CardContent></Card>
        <Card><CardContent className="p-5"><Route className="h-5 w-5" /><p className="mt-2 text-2xl font-bold">{incoming.length}</p><p className="text-sm text-muted-foreground">Warehouse inbound jobs</p></CardContent></Card>
        <Card><CardContent className="p-5"><ShieldCheck className="h-5 w-5" /><p className="mt-2 text-sm font-semibold">Risk-aware</p><p className="text-sm text-muted-foreground">Distance + ETA + shelf life</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Local Fulfillment Hubs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {hubs.length === 0 ? <p className="text-sm text-muted-foreground">No approved local hubs are available.</p> : hubs.map((hub: any) => (
            <div key={hub.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div><p className="font-semibold">{hub.name}</p><p className="text-sm text-muted-foreground">{hub.address?.city || "Local hub"}</p></div>
              <Badge>{Number(hub.availableCapacity ?? 0)} capacity available</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Warehouse Inbound</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {incoming.length === 0 ? <p className="text-sm text-muted-foreground">No inbound transfers.</p> : incoming.map((item: any) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div><p className="font-semibold">Order {item.orderId || "—"}</p><p className="text-sm text-muted-foreground">{item.quantity} units • {item.batchNumber || "Batch not recorded"}</p></div>
              <Badge variant="outline">{item.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
