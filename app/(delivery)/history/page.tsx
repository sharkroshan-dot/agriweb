"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import {
  History,
  Search,
  Clock,
  DollarSign,
  Star,
  MapPin,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api/client";
import { formatDate, formatTime, formatPrice } from "../../lib/utils";
import { CheckCircle } from "lucide-react";

export default function DeliveryHistoryPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [periodFilter, setPeriodFilter] = useState<string>("month");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const mockHistory = [
    { id: "hist-1", orderNumber: "ORD-0999", status: "delivered", date: new Date().toISOString(), customerName: "Amina Zulu", distance: "2.5", deliveredAt: new Date().toISOString(), earnings: 180, rating: 5, address: "Lusaka", paymentMethod: "Cash", deliveryTime: "25 min", items: [{ quantity: 2, name: "Maize", price: 120 }], totalAmount: 240 },
    { id: "hist-2", orderNumber: "ORD-0998", status: "delivered", date: new Date().toISOString(), customerName: "Peter Banda", distance: "4.1", deliveredAt: new Date().toISOString(), earnings: 150, rating: 4.8, address: "Kitwe", paymentMethod: "Card", deliveryTime: "20 min", items: [{ quantity: 1, name: "Tomatoes", price: 180 }], totalAmount: 180 },
  ];

  const { data: history, isLoading } = useQuery({
    queryKey: ["deliveryHistory", periodFilter],
    queryFn: () => api.get("/delivery/me/history", { params: { period: periodFilter, limit: 50 } }),
    enabled: Boolean(accessToken),
  });

  const { data: stats } = useQuery({
    queryKey: ["deliveryStats"],
    queryFn: () => api.get("/delivery/me/stats"),
    enabled: Boolean(accessToken),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const deliveries = accessToken ? history?.data?.deliveries || [] : mockHistory;
  const deliveryStats = accessToken ? stats?.data || {} : { totalDeliveries: 45, completed: 42, earnings: 4500, rating: 4.8 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Delivery History</h1>
        <p className="text-muted-foreground">View your past deliveries and performance</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Total Deliveries", value: deliveryStats.totalDeliveries || 45, icon: CheckCircle },
          { label: "Completed", value: deliveryStats.completed || 42, icon: CheckCircle, color: "text-green-600" },
          { label: "Total Earnings", value: formatPrice(deliveryStats.earnings || 4500), icon: DollarSign, color: "text-green-600" },
          { label: "Avg Rating", value: `⭐ ${deliveryStats.rating || 4.8}`, icon: Star, color: "text-yellow-600" },
        ].map((stat, index) => (
          <Card key={index}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
                <stat.icon className={cn("h-8 w-8", stat.color || "text-muted-foreground")} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search deliveries..." value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Period"/></SelectTrigger>
          <SelectContent>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="quarter">This Quarter</SelectItem>
            <SelectItem value="year">This Year</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {deliveries.length === 0 ? (
        <Card className="p-12 text-center">
          <History className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No deliveries yet</h3>
          <p className="mt-2 text-muted-foreground">Start accepting deliveries to build your history</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {deliveries.map((delivery: any) => (
            <Card key={delivery.id}>
              <CardContent className="p-4">
                <div className="flex cursor-pointer items-center justify-between" onClick={() => setExpandedOrder(expandedOrder === delivery.id ? null : delivery.id)}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{delivery.orderNumber}</span>
                      <Badge variant={delivery.status === 'delivered' ? 'success' : 'destructive'}>{delivery.status}</Badge>
                      <Badge variant="outline" className={String(delivery.paymentMethod).toLowerCase() === 'cash' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'border-blue-200 text-blue-700'}>{String(delivery.paymentMethod).toLowerCase() === 'cash' ? 'COD' : 'Online'}</Badge>
                      <Badge variant="outline" className="text-xs">{formatDate(delivery.date)}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span>{delivery.customerName}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3"/>{delivery.distance || '2.5'} km</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3"/>{formatTime(delivery.deliveredAt || delivery.date)}</span>
                      <span>•</span>
                      <span className="font-medium text-primary">{formatPrice(delivery.earnings || 0)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1"><span className="text-sm">⭐</span><span className="font-medium">{delivery.rating || 4.5}</span></div>
                    {expandedOrder === delivery.id ? <ChevronUp className="h-5 w-5 text-muted-foreground"/> : <ChevronDown className="h-5 w-5 text-muted-foreground"/>}
                  </div>
                </div>

                {expandedOrder === delivery.id && (
                  <div className="mt-4 border-t pt-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <h4 className="text-sm font-medium">Delivery Details</h4>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          <p>Address: {delivery.address}</p>
                          <p>Payment: {delivery.paymentMethod}</p>
                          <p>Distance: {delivery.distance || '2.5'} km</p>
                          <p>Time: {delivery.deliveryTime || '25 min'}</p>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium">Items Delivered</h4>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          {delivery.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between">
                              <span>{item.quantity}x {item.name}</span>
                              <span>{formatPrice(item.price || 0)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 border-t pt-2 flex justify-between font-medium"><span>Total</span><span className="text-primary">{formatPrice(delivery.totalAmount || 0)}</span></div>
                      </div>
                    </div>
                    {delivery.feedback && (<div className="mt-4 rounded-lg bg-muted/50 p-3"><p className="text-sm font-medium">Customer Feedback</p><p className="text-sm text-muted-foreground">{delivery.feedback}</p></div>)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
