"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Trash2, X, ChevronRight, Clock, ExternalLink } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";
import { Badge } from "../components/ui/badge";
import { api } from "../lib/api/client";

const typeLabels: Record<string, string> = {
  order: "Order",
  delivery: "Delivery",
  payment: "Payment",
  promotion: "Offer",
  system: "System",
  customer: "Update",
};

const typeIcons: Record<string, any> = {
  order: "Order",
  delivery: "Delivery",
  payment: "Payment",
  promotion: "Offer",
  system: "System",
  customer: "Update",
};

const typeColors: Record<string, string> = {
  order: "bg-emerald-100 text-emerald-700 border-emerald-300",
  delivery: "bg-blue-100 text-blue-700 border-blue-300",
  payment: "bg-amber-100 text-amber-700 border-amber-300",
  promotion: "bg-purple-100 text-purple-700 border-purple-300",
  system: "bg-slate-100 text-slate-700 border-slate-300",
  customer: "bg-teal-100 text-teal-700 border-teal-300",
};

interface NotificationDetail {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, any>;
  actionUrl?: string;
  actionLabel?: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();
  const [selectedNotification, setSelectedNotification] = useState<NotificationDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=${encodeURIComponent("/notifications")}`);
    }
  }, [router, status]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notificationsList"],
    queryFn: () => api.get(`/notifications/`, { params: { limit: 50 } }),
    enabled: status === "authenticated",
  });

  const notifications: NotificationDetail[] = (data as any)?.data?.notifications ?? [];
  const unreadCount = (data as any)?.data?.unreadCount ?? 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notificationsList"] });

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      refresh();
    } catch {
      // ignore
    }
  };

  const markAllRead = async () => {
    try {
      await api.put(`/notifications/read-all`);
      refresh();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.delete(`/notifications/${id}`);
      refresh();
      if (selectedNotification?.id === id) {
        setSelectedNotification(null);
        setIsDetailOpen(false);
      }
    } catch {
      // ignore
    }
  };

  const openDetail = (notification: NotificationDetail) => {
    setSelectedNotification(notification);
    setIsDetailOpen(true);
    if (!notification.isRead) {
      markRead(notification.id);
    }
  };

  const closeDetail = () => {
    setIsDetailOpen(false);
    setSelectedNotification(null);
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            All of your platform notifications in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
              {unreadCount} unread
            </span>
          )}
          <Button variant="outline" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-500" /> Inbox
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
              Unable to load notifications. Please try again.
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Bell className="h-10 w-10 text-slate-300" />
              <p className="font-medium text-slate-900">No notifications yet</p>
              <p className="text-sm text-muted-foreground">
                Notifications about your account activity will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openDetail(notification)}
                  className={`w-full flex items-start justify-between gap-3 px-3 py-3 text-left transition hover:bg-slate-50 ${
                    notification.isRead ? "bg-white" : "bg-amber-50/40"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors[notification.type] || typeColors.system}`}>
                        {typeIcons[notification.type] || "Notification"}
                        {typeLabels[notification.type] || "Notification"}
                      </span>
                      {!notification.isRead && (
                        <span className="w-2 h-2 rounded-full bg-emerald-600" aria-label="Unread" />
                      )}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900 truncate">
                      {notification.title || typeLabels[notification.type] || "Notification"}
                    </p>
                    <p className="mt-1 text-sm text-slate-600 line-clamp-2">{notification.message}</p>
                    <p className="mt-1 text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {getTimeAgo(notification.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <ChevronRight className="h-5 w-5 text-slate-300" />
                    <div className="flex items-center gap-1">
                      {!notification.isRead && (
                        <Button variant="outline" size="icon" onClick={(e) => { e.stopPropagation(); markRead(notification.id); }}>
                          <CheckCheck className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={(e) => handleDelete(notification.id, e)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDetailOpen} onOpenChange={closeDetail}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
            <DialogTitle className="text-lg font-semibold">
              {selectedNotification ? typeLabels[selectedNotification.type] || "Notification" : "Notification"}
            </DialogTitle>
            <Button variant="ghost" size="icon" onClick={closeDetail}>
              <X className="h-5 w-5" />
            </Button>
          </DialogHeader>
          <ScrollArea className="h-[60vh]">
            {selectedNotification && (
              <div className="space-y-4 pb-4">
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${typeColors[selectedNotification.type] || typeColors.system}`}>
                    {typeIcons[selectedNotification.type] || "Notification"}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors[selectedNotification.type] || typeColors.system}`}>
                        {typeIcons[selectedNotification.type] || "Notification"}
                        {typeLabels[selectedNotification.type] || "Notification"}
                      </span>
                      {!selectedNotification.isRead && (
                        <Badge variant="default" className="bg-emerald-100 text-emerald-700">
                          New
                        </Badge>
                      )}
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">{selectedNotification.title}</h3>
                  </div>
                </div>

                <Separator />

                <div className="prose prose-sm max-w-none">
                  <p className="text-slate-700 whitespace-pre-wrap">{selectedNotification.message}</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm text-slate-600">
                    <Clock className="h-4 w-4 text-slate-400" />
                    <span>Received: {new Date(selectedNotification.createdAt).toLocaleString()}</span>
                  </div>

                  {selectedNotification.data && Object.keys(selectedNotification.data).length > 0 && (
                    <div>
                      <h4 className="font-medium text-slate-900 mb-2">Additional Details</h4>
                      <div className="space-y-2">
                        {Object.entries(selectedNotification.data).map(([key, value]) => (
                          <div key={key} className="flex items-start gap-3 text-sm">
                            <span className="text-slate-500 min-w-[120px] font-medium capitalize">
                              {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                            </span>
                            <span className="text-slate-700 break-all">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {selectedNotification.actionUrl && (
                  <div className="pt-4 border-t">
                    <Button
                      onClick={() => {
                        closeDetail();
                        router.push(selectedNotification.actionUrl!);
                      }}
                      className="w-full"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {selectedNotification.actionLabel || "View Details"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}