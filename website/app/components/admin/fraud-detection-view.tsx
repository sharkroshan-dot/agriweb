"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Shield, User, CreditCard, Package, DollarSign, TrendingUp, Eye, Loader2, RefreshCw, Flag, CheckCircle, XCircle, Info, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Progress } from "../../components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import toast from "react-hot-toast";

const RISK_LEVELS = [
  { value: "all", label: "All Levels" },
  { value: "high", label: "High Risk (71-100)" },
  { value: "medium", label: "Medium Risk (31-70)" },
  { value: "low", label: "Low Risk (0-30)" },
];

const RISK_COLORS = {
  high: "bg-red-100 text-red-700 border-red-300",
  medium: "bg-amber-100 text-amber-700 border-amber-300",
  low: "bg-emerald-100 text-emerald-700 border-emerald-300",
};

const RISK_ICONS = {
  high: <XCircle className="h-4 w-4" />,
  medium: <AlertTriangle className="h-4 w-4" />,
  low: <CheckCircle className="h-4 w-4" />,
};

interface FraudSignal {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string;
  riskScore: number;
  riskLevel: "high" | "medium" | "low";
  signals: string[];
  status: "pending_review" | "approved" | "rejected" | "escalated";
  createdAt: string;
  orderValue: number;
  paymentMethod: string;
}

interface FraudStats {
  total: number;
  high: number;
  medium: number;
  low: number;
  pendingReview: number;
  approved: number;
  rejected: number;
}

export function FraudDetectionView() {
  const [riskFilter, setRiskFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["fraudStats"],
    queryFn: () => api.get("/ai/fraud/stats"),
  });

  const { data: signalsData, isLoading: signalsLoading, refetch } = useQuery({
    queryKey: ["fraudSignals", riskFilter, statusFilter, sortOrder],
    queryFn: () =>
      api.get("/ai/fraud/signals", {
        params: { riskLevel: riskFilter, status: statusFilter, sort: sortOrder },
      }),
  });

  const stats = statsData?.data as FraudStats | undefined;
  const signals = (signalsData?.data?.signals || signalsData?.signals || []) as FraudSignal[];

  const handleAction = async (signalId: string, action: "approve" | "reject" | "escalate") => {
    try {
      await api.post("/ai/fraud/action", { signalId, action });
      toast.success(`Order ${action}d successfully`);
      refetch();
    } catch (error) {
      toast.error(`Failed to ${action} order`);
    }
  };

  const getRiskBadge = (level: "high" | "medium" | "low") => (
    <Badge className={cn("gap-1", RISK_COLORS[level])}>
      {RISK_ICONS[level]}
      {level.charAt(0).toUpperCase() + level.slice(1)}
    </Badge>
  );

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending_review: "bg-amber-100 text-amber-700 border-amber-300",
      approved: "bg-emerald-100 text-emerald-700 border-emerald-300",
      rejected: "bg-red-100 text-red-700 border-red-300",
      escalated: "bg-blue-100 text-blue-700 border-blue-300",
    };
    const labels: Record<string, string> = {
      pending_review: "Pending Review",
      approved: "Approved",
      rejected: "Rejected",
      escalated: "Escalated",
    };
    return (
      <Badge className={cn("border", styles[status])}>
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-emerald-600" />
            Fraud Detection Center
          </h1>
          <p className="text-gray-500 mt-1">
            Monitor and review suspicious orders flagged by AI risk scoring
          </p>
        </div>
        <Button onClick={() => refetch()} disabled={signalsLoading} variant="outline">
          <RefreshCw className={cn("mr-2 h-4 w-4", signalsLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Signals</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.total || 0}</p>
              </div>
              <div className="p-3 bg-gray-100 rounded-xl">
                <Flag className="h-6 w-6 text-gray-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">High Risk</p>
                <p className="text-2xl font-bold text-red-600">{stats?.high || 0}</p>
              </div>
              <div className="p-3 bg-red-50 rounded-xl">
                <AlertTriangle className="h-6 w-6 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Medium Risk</p>
                <p className="text-2xl font-bold text-amber-600">{stats?.medium || 0}</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Low Risk</p>
                <p className="text-2xl font-bold text-emerald-600">{stats?.low || 0}</p>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl">
                <CheckCircle className="h-6 w-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Pending Review</p>
                <p className="text-2xl font-bold text-blue-600">{stats?.pendingReview || 0}</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-xl">
                <Eye className="h-6 w-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Auto-Approved</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.approved || 0}</p>
              </div>
              <div className="p-3 bg-gray-100 rounded-xl">
                <CheckCircle className="h-6 w-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Flagged Orders
          </CardTitle>
          <div className="flex items-center gap-3">
            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RISK_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="escalated">Escalated</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
              aria-label={sortOrder === "desc" ? "Sort ascending" : "Sort descending"}
            >
              {sortOrder === "desc" ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {signalsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
            </div>
          ) : signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="mb-4 h-12 w-12 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900">No fraud signals found</h3>
              <p className="mt-2 text-sm text-gray-500">All orders appear normal with current filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-center">Risk Score</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Key Signals</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signals.map((signal) => (
                    <TableRow key={signal.id} className="hover:bg-gray-50">
                      <TableCell className="font-mono text-sm">{signal.orderId}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400" />
                          <div>
                            <p className="font-medium">{signal.customerName}</p>
                            <p className="text-xs text-gray-500">{signal.customerId}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Progress value={signal.riskScore} className="w-24 h-2" />
                          <span className="text-sm font-mono font-medium">
                            {signal.riskScore}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{getRiskBadge(signal.riskLevel)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {signal.signals.slice(0, 3).map((s, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {s}
                            </Badge>
                          ))}
                          {signal.signals.length > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{signal.signals.length - 3} more
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {signal.paymentMethod}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        ₹{signal.orderValue.toLocaleString()}
                      </TableCell>
                      <TableCell>{getStatusBadge(signal.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {signal.status === "pending_review" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-emerald-600 hover:bg-emerald-50"
                                onClick={() => handleAction(signal.id, "approve")}
                                aria-label="Approve order"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:bg-red-50"
                                onClick={() => handleAction(signal.id, "reject")}
                                aria-label="Reject order"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-blue-600 hover:bg-blue-50"
                                onClick={() => handleAction(signal.id, "escalate")}
                                aria-label="Escalate for review"
                              >
                                <Flag className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-gray-500 hover:bg-gray-100"
                            onClick={() => window.open(`/admin/orders/${signal.orderId}`, "_blank")}
                            aria-label="View order details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-amber-900">How AI Fraud Detection Works</p>
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                <li className="flex items-start gap-2">
                  <span className="text-amber-600">•</span>
                  <strong>Risk Scoring:</strong> ML model analyzes 20+ signals (COD history, cancellations, device patterns, order velocity, etc.)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-600">•</span>
                  <strong>Risk Levels:</strong> 0-30 (Low) → Auto-approve, 31-70 (Medium) → Flag for review, 71-100 (High) → Block/Require verification
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-600">•</span>
                  <strong>Human-in-the-loop:</strong> AI never auto-bans. High-risk orders route to manual review with recommended actions.
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-600">•</span>
                  <strong>Continuous Learning:</strong> Reviewer feedback retrains the model to reduce false positives over time.
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}