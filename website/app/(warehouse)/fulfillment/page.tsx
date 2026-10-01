"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { RefreshCw, Warehouse, Route, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";

export default function WarehouseFulfillmentPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedForConsolidation, setSelectedForConsolidation] = useState<string[]>([]);

  const hubsQuery = useQuery({
    queryKey: ["fulfillmentHubs", refreshKey],
    queryFn: () => api.get("/fulfillment/hubs"),
  });
  const incomingQuery = useQuery({
    queryKey: ["fulfillmentIncoming", refreshKey],
    queryFn: () => api.get("/warehouse/me/incoming", { params: { limit: 100 } }),
  });

  const hubs = hubsQuery.data?.data?.hubs ?? [];
  const incoming = incomingQuery.data?.data?.incoming ?? [];

  const routingQuery = useQuery({
    queryKey: ["warehouseRoutingDecisions", refreshKey, incoming.map((x: any) => x.orderId).join(",")],
    enabled: incoming.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        incoming.filter((x: any) => x.orderId).map(async (x: any) => {
          try {
            const res = await api.get(`/fulfillment/orders/${x.orderId}/decision`);
            return { incoming: x, decision: res?.data };
          } catch {
            return null;
          }
        }),
      );
      return results.filter(Boolean);
    },
  });

  const hubReceiveMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/fulfillment/orders/${orderId}/hub-receive`, { qualityCheck: "passed", notes: "Hub receiving verification completed" }),
    onSuccess: () => {
      setRefreshKey((v) => v + 1);
      toast.success("Hub receipt verified");
    },
    onError: (e: any) => toast.error(e?.message || "Hub receipt failed"),
  });

  const hubDispatchMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/fulfillment/orders/${orderId}/hub-dispatch`, {}),
    onSuccess: () => {
      setRefreshKey((v) => v + 1);
      toast.success("Local hub stock dispatched to delivery partner");
    },
    onError: (e: any) => toast.error(e?.message || "Hub dispatch failed"),
  });

  const consolidateMutation = useMutation({
    mutationFn: ({ hubId, orderIds }: { hubId: string; orderIds: string[] }) =>
      api.post(`/fulfillment/hubs/${hubId}/consolidate`, { hubId, orderIds }),
    onSuccess: () => {
      setSelectedForConsolidation([]);
      setRefreshKey((v) => v + 1);
      toast.success("Consolidated transfer manifest created");
    },
    onError: (e: any) => toast.error(e?.message || "Consolidation failed"),
  });

  const transferMutation = useMutation({
    mutationFn: ({ orderId, hubId, quantity }: { orderId: string; hubId: string; quantity: number }) =>
      api.post(`/fulfillment/orders/${orderId}/transfer-to-hub`, { hubId, quantity }),
    onSuccess: () => {
      setRefreshKey((v) => v + 1);
      toast.success("Transfer to local hub started");
    },
    onError: (e: any) => toast.error(e?.message || "Transfer failed"),
  });

  const transferOrders = routingQuery.data ?? [];

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
        <CardHeader><CardTitle>Warehouse Inbound</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {incoming.length === 0 ? <p className="text-sm text-muted-foreground">No inbound jobs.</p> : incoming.map((item: any) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div>
                <p className="font-semibold">Order {item.orderId || "—"}</p>
                <p className="text-sm text-muted-foreground">{item.quantity} units • {item.batchNumber || "Batch not recorded"}</p>
              </div>
              <Badge variant="outline">{item.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Warehouse → Local Hub</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {transferOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders currently requiring local-hub transfer.</p>
          ) : transferOrders.map((row: any) => {
            const decision = row?.decision || {};
            if (decision.nearbyFulfillmentType !== "local_hub") return null;
            const hub = hubs.find((h: any) => h.id === decision.nearbyFulfillmentLocationId || h._id === decision.nearbyFulfillmentLocationId);
            const quantity = Number(row?.incoming?.quantity || 0);
            const orderId = String(row?.incoming?.orderId || "");
            return (
              <div key={orderId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div>
                  <p className="font-semibold">Order {orderId}</p>
                  <p className="text-sm text-muted-foreground">
                    {quantity} units • {decision.perishabilityRisk || "risk pending"} • {decision.estimatedDistanceKm ?? "—"} km • ETA {decision.estimatedDeliveryMinutes ?? "—"} min<br />Nearby stock: {decision.nearbyStockAvailable ?? "—"} • Delivery capacity: {decision.deliveryCapacityAvailable ?? "—"} {decision.deliveryCapacitySufficient === false ? "• insufficient" : ""}
                  </p>
                </div>
                {decision.nearbyFulfillmentType === "local_hub" && decision.transferStatus !== "in_transit" && decision.transferStatus !== "received" && (
                  <input type="checkbox" checked={selectedForConsolidation.includes(orderId)} onChange={(e) => setSelectedForConsolidation((prev) => e.target.checked ? [...prev, orderId] : prev.filter((id) => id !== orderId))} />
                )}
                {decision.transferStatus === "in_transit" ? (
                <Button
                  disabled={hubReceiveMutation.isPending}
                  onClick={() => hubReceiveMutation.mutate(orderId)}
                >
                  Verify Hub Receipt
                </Button>
              ) : decision.transferStatus === "received" ? (
                <Button
                  disabled={hubDispatchMutation.isPending}
                  onClick={() => hubDispatchMutation.mutate(orderId)}
                >
                  Dispatch to Delivery Partner
                </Button>
              ) : (
                <Button
                  disabled={!hub || transferMutation.isPending}
                  onClick={() => hub && transferMutation.mutate({ orderId, hubId: hub.id, quantity })}
                >
                  Transfer to {hub?.name || "Recommended Local Hub"}
                </Button>
              )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Consolidated transfer</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Select two or more orders targeting the same local hub to create one transfer manifest.</p>
          <Button disabled={selectedForConsolidation.length < 2 || consolidateMutation.isPending} onClick={() => {
            const rows = transferOrders.filter((r: any) => selectedForConsolidation.includes(String(r?.incoming?.orderId)));
            const hubId = rows[0]?.decision?.nearbyFulfillmentLocationId;
            if (hubId) consolidateMutation.mutate({ hubId, orderIds: selectedForConsolidation });
          }}>Create Consolidated Manifest ({selectedForConsolidation.length})</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Approved Local Fulfillment Hubs</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {hubs.length === 0 ? <p className="text-sm text-muted-foreground">No approved local hubs are available.</p> : hubs.map((hub: any) => (
            <div key={hub.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div><p className="font-semibold">{hub.name}</p><p className="text-sm text-muted-foreground">{hub.address?.city || "Local hub"}</p></div>
              <Badge>{Number(hub.availableCapacity ?? 0)} capacity available</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
