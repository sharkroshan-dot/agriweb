"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Mail,
  Phone,
  ShoppingCart,
  IndianRupee,
  CalendarDays,
  Search,
  RefreshCw,
  UserRound,
  Repeat2,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { FarmerPageHeader } from "../../../components/farmer/farmer-page-header";
import { api } from "../../../lib/api/client";
import { formatPrice } from "../../../lib/utils";

function getInitials(name?: string) {
  const parts = String(name || "Customer").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "C";
}

function formatCustomerDate(value?: string | Date | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function FarmerCustomersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [period, setPeriod] = useState<"today" | "week" | "month" | "year" | "all">("all");
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["farmerCustomers", period],
    queryFn: () => api.get("/farmers/me/customers", { params: { period } }),
    refetchOnWindowFocus: true,
  });

  const customers = useMemo(
    () => (Array.isArray(data?.data?.customers) ? data.data.customers : []),
    [data]
  );

  const stats = useMemo(() => {
    const lifetimeOrders = customers.reduce((sum: number, customer: any) => sum + Number(customer.orderCount || 0), 0);
    const lifetimeSpend = customers.reduce((sum: number, customer: any) => sum + Number(customer.totalSpent || 0), 0);
    const lifetimeRepeat = customers.filter((customer: any) => Number(customer.orderCount || 0) > 1).length;
    const periodStats = data?.data?.stats;
    const totalOrders = Number(periodStats?.ordersReceived ?? lifetimeOrders);
    const totalSpent = Number(periodStats?.totalCustomerSpend ?? lifetimeSpend);
    return {
      totalCustomers: customers.length,
      totalOrders,
      totalSpent,
      repeatCustomers: Number(periodStats?.repeatCustomers ?? lifetimeRepeat),
      averageOrderValue: totalOrders > 0 ? totalSpent / totalOrders : 0,
    };
  }, [customers, data]);

  const visibleCustomers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer: any) =>
      [
        customer.name,
        customer.email,
        customer.phone,
        customer.customerId,
      ].some((value) => String(value || "").toLowerCase().includes(query))
    );
  }, [customers, searchQuery]);

  return (
    <div className="w-full min-w-0 space-y-5 pb-8">
      <FarmerPageHeader
        eyebrow="Customer relationships"
        title="Customers"
        description="Understand who buys from your farm, review order history and keep customer contact details close."
      >
        <Button
          type="button"
          variant="outline"
          className="h-10 border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </FarmerPageHeader>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Customer performance</h2>
          <p className="text-xs text-slate-500">Select a period for orders, repeat customers and spending</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Customer metrics period">
          {([
            ["today", "Today"],
            ["week", "This week"],
            ["month", "This month"],
            ["year", "This year"],
            ["all", "All time"],
          ] as const).map(([value, label]) => (
            <Button key={value} type="button" size="sm" variant={period === value ? "default" : "outline"}
              className={period === value ? "bg-emerald-700 text-white hover:bg-emerald-800" : "border-slate-200"}
              onClick={() => setPeriod(value)} aria-pressed={period === value}>
              {label}
            </Button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Total customers", value: stats.totalCustomers, icon: Users, tone: "bg-emerald-50 text-emerald-700" },
          { label: "Orders received", value: stats.totalOrders, icon: ShoppingCart, tone: "bg-blue-50 text-blue-700" },
          { label: "Repeat customers", value: stats.repeatCustomers, icon: Repeat2, tone: "bg-violet-50 text-violet-700" },
          { label: "Total customer spend", value: formatPrice(stats.totalSpent), icon: IndianRupee, tone: "bg-amber-50 text-amber-700" },
        ].map((stat) => (
          <Card key={stat.label} className="border-slate-200 shadow-sm">
            <CardContent className="flex min-w-0 items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <p className="mt-1 truncate text-2xl font-bold tracking-tight text-slate-950">
                  {isLoading || isError ? "—" : stat.value}
                </p>
              </div>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${stat.tone}`}>
                <stat.icon className="h-5 w-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Your customers</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isLoading || isError ? "Customer information" : `Showing ${visibleCustomers.length} of ${customers.length} customers`}
            </p>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search name, email or phone..."
              aria-label="Search customers by name, email or phone"
              className="h-11 w-full border-slate-200 bg-white pl-9 text-sm shadow-sm"
            />
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading customers">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-56 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center rounded-xl border border-red-200 bg-red-50/50 px-5 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-red-600 shadow-sm">
                <Users className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">Unable to load customers</h3>
              <p className="mt-1 max-w-lg text-sm text-slate-600">
                {(error as any)?.response?.data?.detail || (error as any)?.message || "Check your connection and try again."}
              </p>
              <Button className="mt-4 bg-emerald-700 hover:bg-emerald-800" onClick={() => refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />Try again
              </Button>
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50/30 px-5 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <Users className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">No customers yet</h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                Customers who place orders from your farm will appear here with their contact information and purchase summary.
              </p>
            </div>
          ) : visibleCustomers.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-12 text-center">
              <Search className="h-8 w-8 text-slate-300" />
              <h3 className="mt-3 text-sm font-semibold text-slate-900">No matching customers</h3>
              <p className="mt-1 text-sm text-slate-500">Try a different name, email address, phone number or customer ID.</p>
              <Button className="mt-4" size="sm" variant="outline" onClick={() => setSearchQuery("")}>Clear search</Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleCustomers.map((customer: any) => {
                const orderCount = Number(customer.orderCount || 0);
                return (
                  <article
                    key={customer.customerId}
                    className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/60 p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-sm font-bold text-emerald-800">
                          {getInitials(customer.name)}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-slate-950">{customer.name || "Customer"}</h3>
                          {customer.email ? (
                            <p className="mt-0.5 truncate text-xs text-slate-500" title={customer.email}>{customer.email}</p>
                          ) : (
                            <p className="mt-0.5 text-xs text-slate-400">No email provided</p>
                          )}
                        </div>
                      </div>
                      <Badge variant={orderCount > 1 ? "success" : "secondary"} className="shrink-0">
                        {orderCount > 1 ? "Repeat" : "Customer"}
                      </Badge>
                    </div>

                    <div className="flex flex-1 flex-col gap-4 p-4">
                      <div className="space-y-3">
                        {customer.phone ? (
                          <a href={`tel:${customer.phone}`} className="flex min-w-0 items-center gap-2.5 text-sm text-slate-600 transition-colors hover:text-emerald-800">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Phone className="h-4 w-4" /></span>
                            <span className="truncate">{customer.phone}</span>
                            <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-300" />
                          </a>
                        ) : (
                          <div className="flex items-center gap-2.5 text-sm text-slate-400">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><Phone className="h-4 w-4" /></span>
                            Phone not provided
                          </div>
                        )}
                        {customer.email ? (
                          <a href={`mailto:${customer.email}`} className="flex min-w-0 items-center gap-2.5 text-sm text-slate-600 transition-colors hover:text-emerald-800">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Mail className="h-4 w-4" /></span>
                            <span className="truncate">{customer.email}</span>
                            <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-300" />
                          </a>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-slate-50 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Orders</p>
                          <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-slate-950">
                            <ShoppingCart className="h-4 w-4 text-slate-400" />{orderCount}
                          </p>
                        </div>
                        <div className="rounded-xl bg-emerald-50/70 p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Total spent</p>
                          <p className="mt-1 truncate text-lg font-bold text-emerald-900">{formatPrice(customer.totalSpent || 0)}</p>
                        </div>
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <CalendarDays className="h-3.5 w-3.5" />Last order
                        </span>
                        <span className="font-semibold text-slate-700">{formatCustomerDate(customer.lastOrderDate)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {!isLoading && !isError && customers.length > 0 ? (
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>Customer details are based on orders placed with your farm.</span>
          <span className="flex items-center gap-1.5"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" />{stats.averageOrderValue > 0 ? `Average order value: ${formatPrice(stats.averageOrderValue)}` : "No order value available"}</span>
        </div>
      ) : null}
    </div>
  );
}
