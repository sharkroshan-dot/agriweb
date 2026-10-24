"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Package, RefreshCw, Truck, XCircle } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

export default function WarehouseReturnsPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["farmerWarehouseReturns"],
    queryFn: () => api.get("/farmers/me/warehouse-returns"),
    refetchInterval: 15000,
  });
  const returns = data?.data?.returns || [];

  const decide = async (id: string, decision: "accept" | "reject") => {
    try {
      await api.put(`/farmers/me/warehouse-returns/${id}`, { decision });
      toast.success(decision === "accept" ? "Return accepted" : "Return rejected");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || "Unable to update return");
    }
  };

  const receive = async (id: string) => {
    try {
      await api.put(`/farmers/me/warehouse-returns/${id}/receive`);
      toast.success("Returned shipment received");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || "Receipt failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-amber-700 to-slate-800 p-6 text-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-amber-200">Warehouse ↔ Farmer</p>
            <h1 className="mt-1 text-3xl font-bold">Warehouse Returns</h1>
            <p className="mt-2 text-sm text-slate-200">
              Review, accept or reject warehouse return requests, then confirm physical receipt.
            </p>
          </div>
          <Button variant="secondary" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      ) : returns.length === 0 ? (
        <Card className="p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 font-semibold">No warehouse return requests</h3>
          <p className="mt-2 text-sm text-muted-foreground">Warehouse exceptions will appear here when a return is requested.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {returns.map((item: any) => (
            <Card key={item.id}>
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-col justify-between gap-3 md:flex-row">
                  <div>
                    <h2 className="font-semibold">Order #{item.orderNumber || item.orderId}</h2>
                    <p className="text-sm text-muted-foreground">Reason: {item.reason}</p>
                    {item.notes && <p className="text-xs text-muted-foreground">Notes: {item.notes}</p>}
                  </div>
                  <Badge variant="outline">{String(item.status || "").replaceAll("_", " ")}</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(item.items || []).map((line: any, index: number) => (
                    <div key={`${line.productId}-${index}`} className="rounded-lg bg-muted/40 p-3 text-sm">
                      <b>{line.productName}</b>
                      <div className="text-muted-foreground">{line.quantity} {line.unit}</div>
                    </div>
                  ))}
                </div>
                {item.status === "pending_farmer_acceptance" && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => decide(item.id, "accept")}><CheckCircle2 className="mr-2 h-4 w-4" />Accept Return</Button>
                    <Button variant="outline" onClick={() => decide(item.id, "reject")}><XCircle className="mr-2 h-4 w-4" />Reject Return</Button>
                  </div>
                )}
                {item.status === "accepted" && (
                  <Badge variant="secondary"><Truck className="mr-2 h-4 w-4" />Waiting for warehouse dispatch</Badge>
                )}
                {item.status === "in_transit_to_farmer" && (
                  <Button onClick={() => receive(item.id)}><CheckCircle2 className="mr-2 h-4 w-4" />Confirm Receipt</Button>
                )}
                {item.status === "received_by_farmer" && (
                  <Badge variant="success"><CheckCircle2 className="mr-2 h-4 w-4" />Received by Farmer</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
