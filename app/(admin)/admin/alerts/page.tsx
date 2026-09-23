"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Loader2, Bell } from "lucide-react";
import { api } from "../../../lib/api/client";

const PRIORITY_VARIANT: Record<string, "warning" | "default" | "success" | "destructive"> = {
  high: "warning",
  urgent: "destructive",
  medium: "default",
  low: "success",
};

export default function AdminAlertsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["adminAlerts"],
    queryFn: () =>
      api.get("/notifications/admin/all", {
        params: { limit: 50 },
      }),
  });

  const notifications = data?.data?.notifications ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Monitoring</p>
        <h1 className="text-3xl font-semibold tracking-tight">Alerts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review live issues and platform notifications.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active alerts</CardTitle>
          <CardDescription>Platform notifications and priority items.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : notifications.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            notifications.map((notification) => {
              const priority = (notification.priority || "medium").toLowerCase();
              return (
                <div key={notification.id} className="flex items-center justify-between gap-3 rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                      <Bell className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">{notification.title}</p>
                      <p className="text-sm text-muted-foreground">{notification.message}</p>
                      {notification.createdAt && (
                        <p className="text-xs text-muted-foreground">{new Date(notification.createdAt).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant={PRIORITY_VARIANT[priority] ?? "default"}>{priority}</Badge>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
