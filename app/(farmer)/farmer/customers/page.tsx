"use client";

import { useQuery } from "@tanstack/react-query";
import { Users, Mail, Phone, ShoppingCart, IndianRupee, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";

export default function FarmerCustomersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["farmerCustomers"],
    queryFn: () => api.get("/farmers/me/customers"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  const customers = data?.data?.customers || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-gray-500">Manage your customer relationships</p>
        </div>
      </div>

      {customers.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-semibold">No customers yet</h3>
          <p className="mt-2 text-gray-500">Customers who order from you will appear here.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {customers.map((customer: any) => (
            <Card key={customer.customerId} className="overflow-hidden">
              <CardHeader className="border-b bg-gray-50/50 pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                    <Users className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{customer.name}</CardTitle>
                    <p className="text-xs text-gray-500">{customer.email}</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3 text-sm">
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Phone className="h-4 w-4" />
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-gray-600">
                    <ShoppingCart className="h-4 w-4" />
                    <span>{customer.orderCount} order{customer.orderCount !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <IndianRupee className="h-4 w-4" />
                    <span>{formatPrice(customer.totalSpent)} total</span>
                  </div>
                  {customer.lastOrderDate && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <CalendarDays className="h-4 w-4" />
                      <span>Last order: {new Date(customer.lastOrderDate).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
