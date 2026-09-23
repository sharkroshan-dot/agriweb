"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";

const formatAddress = (addr: any) => {
  if (!addr || typeof addr === "string") return addr || "N/A";
  return [addr.addressLine1, addr.addressLine2, addr.city, addr.state].filter(Boolean).join(", ") || "N/A";
};

export default function DeliveryHistoryPage() {
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["deliveryHistory"],
    queryFn: () => api.get("/delivery/me/history"),
    enabled: Boolean(accessToken),
  });

  const history = data?.data?.deliveries || [];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Delivery archive</p>
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review completed routes and past delivery outcomes.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Completed deliveries</CardTitle>
          <CardDescription>Your delivered orders from the database.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No completed deliveries yet.</p>
          ) : (
            history.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">{item.customerName || "Customer"}</p>
                  <p className="text-sm text-muted-foreground">{formatAddress(item.deliveryAddress)}</p>
                  {item.totalAmount && (
                    <p className="text-sm text-muted-foreground">{formatPrice(item.totalAmount)}</p>
                  )}
                  {item.items && item.items.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {item.items.map((i: any) => i.productName).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="success">Delivered</Badge>
                  <Button variant="outline" size="sm" onClick={() => setSelectedTrip(item)}>
                    Details
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {selectedTrip && (
        <Card>
          <CardHeader>
            <CardTitle>Trip details</CardTitle>
            <CardDescription>Expanded information for the selected delivery.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="font-medium">Customer:</span> {selectedTrip.customerName || "N/A"}</p>
            <p><span className="font-medium">Address:</span> {formatAddress(selectedTrip.deliveryAddress)}</p>
            {selectedTrip.totalAmount && (
              <p><span className="font-medium">Amount:</span> {formatPrice(selectedTrip.totalAmount)}</p>
            )}
            {selectedTrip.items && selectedTrip.items.length > 0 && (
              <p><span className="font-medium">Items:</span> {selectedTrip.items.map((i: any) => i.productName).join(", ")}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
