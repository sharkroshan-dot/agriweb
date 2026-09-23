"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Truck,
  Search,
  Clock,
  MapPin,
  Phone,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api/client";
import { formatTime, formatPrice } from "../../lib/utils";

const statusColors: Record<string,string> = {
  assigned: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  accepted: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  picked_up: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
  in_transit: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  delivered: "bg-green-500/10 text-green-600 border-green-500/20",
  failed: "bg-red-500/10 text-red-600 border-red-500/20",
  cancelled: "bg-gray-500/10 text-gray-600 border-gray-500/20",
};

const statusLabels: Record<string,string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
};

const contactCustomer = (phone: string | undefined, type: "call" | "message") => {
  if (!phone) return;
  const number = phone.replace(/[^\d+]/g, "");
  window.location.href = type === "call" ? `tel:${number}` : `sms:${number}`;
};

const customerPhone = (delivery: any) =>
  delivery?.customerPhone || delivery?.customer?.phone || delivery?.customer?.phoneNumber
  || delivery?.order?.customerPhone || delivery?.order?.customer?.phone || delivery?.order?.phone
  || delivery?.phone || delivery?.phoneNumber;

export default function DeliveryDeliveriesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("today");
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;

  const mockDeliveries = [
    { id: "DLV-1001", orderNumber: "ORD-1001", status: "in_transit", priority: "high", customerName: "Amina Zulu", distance: "2.5", eta: "10 min", address: "Lusaka", items: [{ name: "Maize", quantity: 2 }], totalAmount: 240 },
    { id: "DLV-1002", orderNumber: "ORD-1002", status: "pending", priority: "normal", customerName: "Peter Banda", distance: "4.1", eta: "20 min", address: "Kitwe", items: [{ name: "Tomatoes", quantity: 1 }], totalAmount: 180 },
  ];

  const { data: deliveries, isLoading, refetch } = useQuery({
    queryKey: ["deliveryDeliveries", statusFilter, dateFilter],
    queryFn: () => api.get("/delivery/me/deliveries", { params: { status: statusFilter !== "all" ? statusFilter : undefined, date: dateFilter !== "all" ? dateFilter : undefined, limit: 50 } }),
    enabled: Boolean(accessToken),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Deliveries</h1>
            <p className="text-muted-foreground">Manage your deliveries</p>
          </div>
        </div>
        {[1,2,3,4].map(i=> <div key={i} className="h-32 animate-pulse rounded-lg bg-muted"/>)}
      </div>
    );
  }

  const deliveryList = accessToken ? deliveries?.data?.deliveries || [] : mockDeliveries;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Deliveries</h1>
          <p className="text-muted-foreground">{deliveryList.length} deliveries found</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4"/></Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search deliveries..." value={searchTerm} onChange={(e)=>setSearchTerm(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="picked_up">Picked Up</SelectItem>
              <SelectItem value="in_transit">In Transit</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={dateFilter} onValueChange={setDateFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Date"/></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {deliveryList.length === 0 ? (
        <Card className="p-12 text-center">
          <Truck className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No deliveries found</h3>
          <p className="mt-2 text-muted-foreground">{statusFilter !== "all" ? `No ${statusLabels[statusFilter]} deliveries` : "You don't have any deliveries yet"}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {deliveryList.map((delivery: any) => (
            <Card key={delivery.id}>
              <CardContent className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-medium">{delivery.orderNumber}</span>
                      <Badge variant="outline" className={cn("border", statusColors[delivery.status] || '')}>{statusLabels[delivery.status] || delivery.status}</Badge>
                      <Badge variant="outline" className="text-xs">{delivery.priority === 'high' ? '🔴 High Priority' : 'Normal'}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span>Customer: <span className="font-medium text-foreground">{delivery.customerName}</span></span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3"/>{delivery.distance || '2.5'} km away</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3"/>ETA: {delivery.eta || formatTime(new Date())}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{delivery.address}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs">📦 {delivery.items?.length || 0} items</Badge>
                      <Badge variant="outline" className="text-xs">💰 {formatPrice(delivery.totalAmount || 0)}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contactCustomer(customerPhone(delivery), "call")} aria-label="Call customer"><Phone className="h-4 w-4"/></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => contactCustomer(delivery.customerPhone, "message")} aria-label="Message customer"><MessageSquare className="h-4 w-4"/></Button>
                    {delivery.status !== 'delivered' && delivery.status !== 'failed' && (<Button size="sm"><MapPin className="mr-2 h-4 w-4"/>Navigate</Button>)}
                    {delivery.status === 'delivered' && (<Badge variant="success" className="ml-2">✅ Completed</Badge>)}
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
