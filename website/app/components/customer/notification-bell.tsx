"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Clock, ExternalLink, X } from "lucide-react";
import { api } from "../../lib/api/client";
import { resolveBackendUrl } from "../../lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Separator } from "../ui/separator";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"];

const typeLabels: Record<string, string> = {
  order: "Order",
  delivery: "Delivery",
  payment: "Payment",
  promotion: "Offer",
  system: "System",
  customer: "Update",
  chat: "Message",
  warehouse: "Warehouse",
  farmer: "Farmer",
  admin: "Admin",
  security: "Security",
};

function timeAgo(iso?: string) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function notificationTitle(notification: any) {
  return notification.title || typeLabels[notification.type] || "Notification";
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<any | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const { data: countData } = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, "count"],
    queryFn: () => api.get("/notifications/unread/count"),
    enabled: true,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const { data: listData, refetch: refetchList } = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, "list"],
    queryFn: () => api.get("/notifications/", { params: { limit: 10 } }),
    enabled: open,
    refetchInterval: open ? 15000 : false,
    refetchOnWindowFocus: true,
  });

  const unreadCount = (countData as any)?.data?.count ?? 0;
  const notifications: any[] = (listData as any)?.data?.notifications ?? [];

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
  };

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      await invalidate();
    } catch {
      // Keep the notification visible if the request fails.
    }
  };

  const markAllRead = async () => {
    try {
      await api.put("/notifications/read-all");
      await invalidate();
    } catch {
      // Keep the current state if the request fails.
    }
  };

  const openDetail = async (notification: any) => {
    try {
      const response = await api.get(`/notifications/${notification.id}`);
      const detail = (response as any)?.data?.notification;
      setSelectedNotification(detail || notification);
    } catch {
      setSelectedNotification(notification);
    }

    setOpen(false);

    if (!notification.isRead) {
      await markRead(notification.id);
    }
  };

  const closeDetail = () => setSelectedNotification(null);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void refetchList();
  };

  return (
    <>
      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={toggle}
          className="relative flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          title={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
          aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        >
          <Bell className="h-5 w-5 text-slate-600" strokeWidth={2} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 z-[70] mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-slate-900">Notifications</p>
                <p className="text-xs text-slate-500">
                  {unreadCount ? `${unreadCount} unread` : "All caught up"}
                </p>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell className="mx-auto h-9 w-9 text-slate-300" />
                  <p className="mt-2 text-sm font-medium text-slate-900">No notifications yet</p>
                  <p className="mt-1 text-xs text-slate-500">New account and activity updates will appear here.</p>
                </div>
              ) : (
                notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => void openDetail(notification)}
                    className={`block w-full border-b border-slate-100 px-4 py-3 text-left transition last:border-0 hover:bg-slate-50 ${
                      notification.isRead ? "bg-white" : "bg-amber-50/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        notification.isRead ? "bg-slate-200" : "bg-emerald-500"
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{notificationTitle(notification)}</p>
                          <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(notification.createdAt)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{notification.message}</p>
                        {notification.data?.podUrl && (
                          <img
                            src={resolveBackendUrl(notification.data.podUrl)}
                            alt="Proof of delivery"
                            className="mt-2 h-16 w-20 rounded-lg border object-cover"
                          />
                        )}
                        <p className="mt-1.5 text-[11px] font-medium text-emerald-700">Click to view details</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50 p-2">
              <Link
                href="/notifications"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                View all notifications
              </Link>
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(selectedNotification)} onOpenChange={(value) => !value && closeDetail()}>
        <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader className="pr-8">
            <DialogTitle>{selectedNotification ? notificationTitle(selectedNotification) : "Notification"}</DialogTitle>
            <button
              type="button"
              onClick={closeDetail}
              className="absolute right-4 top-4 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Close notification details"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>

          {selectedNotification && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {selectedNotification.message || "No additional message."}
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Clock className="h-4 w-4" />
                <span>{selectedNotification.createdAt ? new Date(selectedNotification.createdAt).toLocaleString() : "Recently"}</span>
              </div>

              {selectedNotification.data && Object.keys(selectedNotification.data).length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-slate-900">Additional Details</h4>
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      {Object.entries(selectedNotification.data).map(([key, value]) => (
                        <div key={key} className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
                          <span className="text-xs font-medium capitalize text-slate-500">{key.replace(/([A-Z])/g, " $1")}</span>
                          <span className="max-w-[65%] break-words text-right text-xs text-slate-700">
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {selectedNotification.data?.podUrl && (
                <img
                  src={resolveBackendUrl(selectedNotification.data.podUrl)}
                  alt="Proof of delivery"
                  className="max-h-64 w-full rounded-xl border object-contain"
                />
              )}

              {selectedNotification.actionUrl && (
                <Link
                  href={selectedNotification.actionUrl}
                  onClick={closeDetail}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  {selectedNotification.actionLabel || "Open related page"}
                  <ExternalLink className="h-4 w-4" />
                </Link>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
