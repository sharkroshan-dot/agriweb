"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, MoreHorizontal, Shield, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { api } from "../../lib/api/client";
import toast from "react-hot-toast";

const inr = (v: number) => `Rs ${Number(v || 0).toLocaleString("en-IN")}`;

export default function AdminFarmersPage() {
  const [search, setSearch] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["adminFarmersList", search],
    queryFn: () =>
      api.get("/admin/farmers", {
        params: {
          limit: 100,
          ...(search ? { search } : {}),
        },
      }),
  });

  const farmers = data?.farmers ?? [];

  const handleVerify = async (farmerId: string) => {
    setActionId(farmerId);
    try {
      await api.put(`/admin/farmers/${farmerId}/verify`);
      toast.success("Farmer verified");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to verify farmer");
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (farmerId: string) => {
    setActionId(farmerId);
    try {
      await api.put(`/admin/farmers/${farmerId}/reject`);
      toast.success("Farmer rejected");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Failed to reject farmer");
    } finally {
      setActionId(null);
    }
  };

  const total = farmers.length;
  const verified = farmers.filter((f) => f.isVerified).length;
  const active = farmers.filter((f) => f.isActive !== false).length;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Farmers</h1>
        <p className="text-sm text-muted-foreground">Manage registered farmers on the platform</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold">{total}</p><p className="text-xs text-muted-foreground">Total</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-green-600">{verified}</p><p className="text-xs text-muted-foreground">Verified</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-blue-600">{active}</p><p className="text-xs text-muted-foreground">Active</p></CardContent></Card>
      </div>

      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search farmers..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Farmer directory</CardTitle>
          <CardDescription>Farmers registered on the platform.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : farmers.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No farmers found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="p-4 font-medium">Farmer</th>
                    <th className="p-4 font-medium">Phone</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {farmers.map((farmer) => {
                    const fullName = `${farmer.firstName || ""} ${farmer.lastName || ""}`.trim() || "Farmer";
                    const isVerified = Boolean(farmer.isVerified);
                    return (
                      <tr key={farmer.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="p-4">
                          <p className="font-medium text-slate-900">{fullName}</p>
                          <p className="text-xs text-muted-foreground">{farmer.email}</p>
                        </td>
                        <td className="p-4 text-slate-600">{farmer.phone}</td>
                        <td className="p-4">
                          <Badge variant={isVerified ? "success" : "warning"}>
                            {isVerified ? "Verified" : "Pending"}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-1">
                            {!isVerified ? (
                              <Button variant="ghost" size="sm" onClick={() => handleVerify(farmer.id)} disabled={actionId === farmer.id} title="Verify">
                                {actionId === farmer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4 text-green-600" />}
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" onClick={() => handleReject(farmer.id)} disabled={actionId === farmer.id} title="Reject">
                                {actionId === farmer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4 text-red-500" />}
                              </Button>
                            )}
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </div>
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
