"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Loader2, Ban, RotateCcw } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Select, SelectContent, SelectItem } from "../../components/ui/select";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  farmer: "Farmer",
  delivery: "Delivery",
  warehouse: "Warehouse",
  admin: "Admin",
};

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actionId, setActionId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminUsersList", query, roleFilter],
    queryFn: () =>
      api.get("/users", {
        params: {
          limit: 100,
          ...(query ? { search: query } : {}),
          ...(roleFilter !== "all" ? { role: roleFilter } : {}),
        },
      }),
  });

  const users = Array.isArray(data) ? data : [];

  const handleActivate = async (userId: string) => {
    setActionId(userId);
    try {
      await api.put(`/users/${userId}/activate`);
      toast.success("User activated");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to activate user");
    } finally {
      setActionId(null);
    }
  };

  const handleSuspend = async (userId: string) => {
    setActionId(userId);
    try {
      await api.put(`/users/${userId}/suspend`, { params: { reason: "Suspended by admin" } });
      toast.success("User suspended");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to suspend user");
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">User management</p>
          <h1 className="text-3xl font-semibold tracking-tight">Manage platform users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Search accounts, review permissions, and manage verification status.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => refetch()}>
            <Filter className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>Account directory</CardTitle>
              <CardDescription>Review users and their verification status.</CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                <Search className="h-4 w-4" />
                <input
                  className="w-40 bg-transparent outline-none"
                  placeholder="Search users"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="farmer">Farmer</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="warehouse">Warehouse</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : users.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No users found.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">User</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Phone</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {users.map((user) => {
                    const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email;
                    const isActive = user.is_active !== false;
                    return (
                      <tr key={user.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                              {fullName
                                .split(" ")
                                .filter(Boolean)
                                .map((part) => part[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium">{fullName}</p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 capitalize">{ROLE_LABELS[user.role] || user.role}</td>
                        <td className="px-4 py-3">{user.phone}</td>
                        <td className="px-4 py-3">
                          <Badge variant={!isActive ? "destructive" : "success"}>
                            {!isActive ? "Suspended" : "Active"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {isActive ? (
                            <Button variant="secondary" size="sm" className="gap-2" onClick={() => handleSuspend(user.id)} disabled={actionId === user.id}>
                              {actionId === user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                              Suspend
                            </Button>
                          ) : (
                            <Button variant="secondary" size="sm" className="gap-2" onClick={() => handleActivate(user.id)} disabled={actionId === user.id}>
                              {actionId === user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                              Activate
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
