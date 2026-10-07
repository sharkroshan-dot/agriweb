"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, CheckCircle2, RefreshCw, Warehouse, Truck, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

export default function FarmerFulfillmentConsolidationPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["farmerFulfillmentConsolidations"],
    queryFn: () => api.get("/warehouse/me/farmer-fulfillment-consolidations"),
  });
  const rows = data?.data?.consolidations || [];
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { refetch(); }, [refetch]);

  const completeConsolidation = async (orderId: string) => {
    setBusy(orderId);
    try {
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/complete-consolidation`);
      toast.success("All warehouse portions consolidated into the complete order");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Consolidation failed");
    } finally { setBusy(null); }
  };

  const dispatchPortion = async (orderId: string) => {
    setBusy(orderId);
    try {
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/dispatch-to-consolidation`);
      toast.success("Warehouse portion dispatched to consolidation");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Warehouse dispatch failed");
    } finally { setBusy(null); }
  };

  const receiveAtConsolidation = async (orderId: string) => {
    setBusy(orderId);
    try {
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/receive-at-consolidation`);
      toast.success("Portions received at consolidation warehouse");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Consolidation receipt failed");
    } finally { setBusy(null); }
  };

  const handoffHub = async (orderId: string) => {
    setBusy(orderId);
    try {
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/handoff-local-hub`);
      toast.success("Complete order sent to the local hub");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Local hub handoff failed");
    } finally { setBusy(null); }
  };

  const receiveHub = async (orderId: string) => {
    setBusy(orderId);
    try {
      await api.post(`/warehouse/me/farmer-fulfillment/${orderId}/receive-local-hub`);
      toast.success("Local hub received the complete order; one delivery job is open");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Local hub receipt failed");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Farmer Fulfillment Consolidation</h1>
          <p className="text-muted-foreground">Multiple warehouses → one consolidation hub → one local hub → one delivery partner.</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <Card className="border-indigo-100 bg-indigo-50/60">
        <CardContent className="p-5">
          <div className="grid gap-3 md:grid-cols-5 text-sm">
            {[
              ["1", "Warehouse A/B/C", "Receive + verify farmer-packed portions"],
              ["2", "Consolidation", "Complete original order"],
              ["3", "Local Hub", "Receive one complete shipment"],
              ["4", "One Job", "Open one final delivery job"],
              ["5", "Customer", "Single delivery partner"],
            ].map(([n, title, desc]) => (
              <div key={n} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">{n}</span><b>{title}</b></div>
                <p className="mt-2 text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? <div className="h-32 animate-pulse rounded-xl bg-muted" /> :
        rows.length === 0 ? <Card className="p-12 text-center"><Boxes className="mx-auto h-12 w-12 text-muted-foreground" /><h3 className="mt-4 font-semibold">No multi-warehouse orders</h3><p className="mt-2 text-sm text-muted-foreground">Orders split across warehouses will appear here.</p></Card> :
        <div className="space-y-4">{rows.map((row: any) => {
          const complete = row.allWarehousesReceived;
          const consolidated = ["consolidated", "hub_handoff_pending", "local_hub_ready"].includes(row.consolidationStatus);
          const hubSent = ["hub_handoff_pending", "local_hub_ready"].includes(row.consolidationStatus);
          const hubReceived = row.consolidationStatus === "local_hub_ready";
          const jobOpen = Boolean(row.deliveryPartnerJobId);
          return (
            <Card key={row.orderId}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2"><Boxes className="h-5 w-5 text-indigo-600" />#{row.orderNumber}</CardTitle>
                  <Badge variant={jobOpen ? "success" : "secondary"}>{jobOpen ? "Final Delivery Job Open" : row.consolidationStatus || "Collecting"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Warehouses</p><p className="mt-1 font-semibold">{row.warehouseCount}</p><p className="text-xs text-muted-foreground">{row.storedCount}/{row.incomingCount} received + stored</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Consolidation Hub</p><p className="mt-1 font-semibold">{row.consolidationWarehouseName || "Assigned hub"}</p></div>
                  <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Local Hub</p><p className="mt-1 font-semibold">{row.localHub?.name || "Not assigned"}</p></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.allocations?.map((a: any, index: number) => (
                    <Badge key={index} variant="outline"><Warehouse className="mr-1 h-3.5 w-3.5" />{a.warehouseName}: {a.productName} {a.quantity} {a.unit}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!complete || !row.allConsolidationLegsReceived || consolidated || busy === row.orderId} onClick={() => completeConsolidation(row.orderId)}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />{consolidated ? "Consolidated" : "Complete Consolidation"}
                  </Button>
                  <Button variant="outline" disabled={!consolidated || hubSent || busy === row.orderId} onClick={() => handoffHub(row.orderId)}>
                    <Truck className="mr-2 h-4 w-4" />{hubSent ? "Sent to Local Hub" : "Transfer to Local Hub"}
                  </Button>
                  <Button variant="outline" disabled={!hubSent || hubReceived || busy === row.orderId} onClick={() => receiveHub(row.orderId)}>
                    <MapPin className="mr-2 h-4 w-4" />{hubReceived ? "Local Hub Received" : "Confirm Local Hub Receipt"}
                  </Button>
                </div>
                {!complete && <p className="text-xs text-amber-700">Waiting for every assigned warehouse to receive, quality-check and store its farmer-packed portion.</p>}
                {jobOpen && <p className="text-sm font-medium text-emerald-700">✓ One final delivery job is open. All products in this original order go together through one delivery partner.</p>}
              </CardContent>
            </Card>
          );
        })}</div>}
    </div>
  );
}
