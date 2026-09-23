"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "../../lib/api/client";
import { resolveBackendUrl } from "../../lib/utils";

export const NOTIFICATIONS_QUERY_KEY = ["customerNotifications"];

const typeLabels: Record<string, string> = {
  order: "Order",
  delivery: "Delivery",
  payment: "Payment",
  promotion: "Offer",
  system: "System",
  customer: "Update",
};

function timeAgo(iso?: string) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const { data: countData } = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, "count"],
    queryFn: () => api.get(`/notifications/unread/count`),
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  const { data: listData, refetch: refetchList } = useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, "list"],
    queryFn: () => api.get(`/notifications/`, { params: { limit: 8 } }),
    enabled: open,
  });

  const unreadCount = (countData as any)?.data?.count ?? 0;
  const notifications: any[] = (listData as any)?.data?.notifications ?? [];

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    } catch {
      // handled by api client
    }
  };

  const markAllRead = async () => {
    try {
      await api.put(`/notifications/read-all`);
      await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
    } catch {
      // handled by api client
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) refetchList();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-slate-100"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-md border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-emerald-600 transition hover:text-emerald-700"
              >
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left transition last:border-0 hover:bg-slate-50 ${
                    n.isRead ? "opacity-70" : "bg-amber-50/40"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-amber-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {n.title || typeLabels[n.type] || "Notification"}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                      {n.data?.podUrl && (
                        <img
                          src={resolveBackendUrl(n.data.podUrl)}
                          alt="Proof of delivery"
                          className="mt-1.5 h-16 w-20 rounded-md border object-cover"
                        />
                      )}
                      <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t bg-slate-50 p-1.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
