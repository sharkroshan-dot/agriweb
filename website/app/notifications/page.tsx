"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, BellRing, Check, CheckCheck, Clock, ExternalLink, Gift,
  Megaphone, MoreVertical, Package, Trash2, Truck, X, Circle,
  RefreshCw, Inbox, ShieldCheck, Wallet, MessageSquare, Sprout,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";
import { Badge } from "../components/ui/badge";
import { api } from "../lib/api/client";

type NotificationDetail = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  data?: Record<string, any>;
  actionUrl?: string;
  actionLabel?: string;
};

type Category = "all" | "orders" | "delivery" | "rewards" | "system";
type StatusFilter = "all" | "unread" | "read";

const categoryMeta: Record<Category, { label: string; shortLabel: string; icon: any; color: string }> = {
  all: { label: "Notifications", shortLabel: "Notifications", icon: Bell, color: "emerald" },
  orders: { label: "Orders", shortLabel: "Orders", icon: Package, color: "blue" },
  delivery: { label: "Delivery", shortLabel: "Delivery", icon: Truck, color: "violet" },
  rewards: { label: "Rewards", shortLabel: "Rewards", icon: Gift, color: "amber" },
  system: { label: "System & Updates", shortLabel: "System & Updates", icon: Megaphone, color: "slate" },
};

const categoryStyles: Record<Category, string> = {
  all: "bg-emerald-100 text-emerald-800",
  orders: "bg-blue-100 text-blue-800",
  delivery: "bg-violet-100 text-violet-800",
  rewards: "bg-amber-100 text-amber-800",
  system: "bg-slate-100 text-slate-700",
};

function getCategory(notification: NotificationDetail): Exclude<Category, "all"> {
  const type = String(notification.type || "").toLowerCase();
  const dataType = String(notification.data?.type || notification.data?.kind || "").toLowerCase();
  const text = \`\${notification.title || ""} \${notification.message || ""}\`.toLowerCase();
  if (dataType.includes("loyalty") || dataType.includes("reward") || /agripoints|points earned|points redeemed|reward/.test(text)) return "rewards";
  if (type === "delivery") return "delivery";
  if (type === "order" || type === "payment") return "orders";
  if (type === "promotion") return "rewards";
  return "system";
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function timeAgo(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return \`\${minutes}m ago\`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return \`\${hours}h ago\`;
  const days = Math.floor(hours / 24);
  if (days < 7) return \`\${days}d ago\`;
  return date.toLocaleDateString();
}

function NotificationIcon({ category, className = "" }: { category: Category; className?: string }) {
  const Icon = categoryMeta[category].icon;
  return <Icon className={className} aria-hidden="true" />;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<Category>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedNotification, setSelectedNotification] = useState<NotificationDetail | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(\`/login?callbackUrl=\${encodeURIComponent("/notifications")}\`);
    }
  }, [router, status]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["notificationsList"],
    queryFn: () => api.get("/notifications/", { params: { limit: 100 } }),
    enabled: status === "authenticated",
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const notifications: NotificationDetail[] = (data as any)?.data?.notifications ?? [];
  const total = (data as any)?.data?.total ?? notifications.length;
  const unreadCount = (data as any)?.data?.unreadCount ?? notifications.filter((item) => !item.isRead).length;
  const readCount = Math.max(0, total - unreadCount);

  const counts = useMemo(() => {
    const result: Record<Category, number> = { all: total, orders: 0, delivery: 0, rewards: 0, system: 0 };
    notifications.forEach((item) => { result[getCategory(item)] += 1; });
    return result;
  }, [notifications, total]);

  const visibleNotifications = useMemo(() => notifications.filter((item) => {
    const categoryMatches = selectedCategory === "all" || getCategory(item) === selectedCategory;
    const statusMatches = statusFilter === "all" || (statusFilter === "unread" ? !item.isRead : item.isRead);
    return categoryMatches && statusMatches;
  }), [notifications, selectedCategory, statusFilter]);

  const refresh = async () => {
    setFeedback("");
    await queryClient.invalidateQueries({ queryKey: ["notificationsList"] });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markRead = async (id: string) => {
    try {
      await api.put(\`/notifications/\${id}/read\`);
      await refresh();
      setActionMenuId(null);
    } catch {
      setFeedback("Could not update this notification. Please try again.");
    }
  };

  const markAllRead = async () => {
    if (!unreadCount) return;
    try {
      await api.put("/notifications/read-all");
      await refresh();
      setFeedback("All notifications marked as read.");
    } catch {
      setFeedback("Could not mark notifications as read. Please try again.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(\`/notifications/\${id}\`);
      if (selectedNotification?.id === id) setSelectedNotification(null);
      await refresh();
      setActionMenuId(null);
    } catch {
      setFeedback("Could not delete this notification. Please try again.");
    }
  };

  const openDetail = async (notification: NotificationDetail) => {
    const normalized = {
      ...notification,
      actionUrl: notification.actionUrl || notification.data?.actionUrl || notification.data?.url,
      actionLabel: notification.actionLabel || (
        notification.data?.type === "farmer_fulfillment_pickup_ready" ? "Open Farm Collection Queue" : "View Details"
      ),
    };
    setSelectedNotification(normalized);
    setActionMenuId(null);
    if (!notification.isRead) await markRead(notification.id);
  };

  const isCooperativeInvitation = selectedNotification?.data?.kind === "cooperative_invitation" && Boolean(selectedNotification.data?.invitationId);

  const respondToCooperativeInvitation = async (accept: boolean) => {
    if (!selectedNotification?.data?.invitationId) return;
    setInviteBusy(true);
    try {
      await api.post(\`/cooperatives/invitations/\${selectedNotification.data.invitationId}/\${accept ? "accept" : "reject"}\`);
      await refresh();
      setSelectedNotification(null);
    } catch (error: any) {
      window.alert(error?.message || \`Could not \${accept ? "accept" : "reject"} the invitation.\`);
    } finally {
      setInviteBusy(false);
    }
  };

  if (status === "loading") {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div>;
  }

  return (
    <main className="role-workspace mx-auto w-full max-w-[1600px] space-y-5 p-3 sm:p-5 lg:p-6">
      {/* Shared hero: identical for every authenticated role. */}
      <section className="relative isolate overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-white via-emerald-50 to-emerald-800 px-5 py-6 shadow-sm sm:px-8 sm:py-7">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-y-0 right-0 w-[65%] bg-[radial-gradient(ellipse_at_75%_45%,rgba(16,185,129,0.45),transparent_65%)]" />
          <div className="absolute bottom-0 right-0 h-20 w-[72%] rounded-tl-[100%] bg-gradient-to-r from-emerald-100/20 via-lime-300/40 to-emerald-900/80" />
          <div className="absolute bottom-3 right-[18%] h-10 w-10 rounded-full bg-emerald-700/15 blur-sm" />
          <Sprout className="absolute bottom-4 right-[25%] h-14 w-14 text-emerald-800/30" />
          <BellRing className="absolute right-5 top-1/2 hidden h-24 w-24 -translate-y-1/2 text-white/80 sm:block lg:right-10 lg:h-28 lg:w-28" strokeWidth={1.4} />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 shadow-inner sm:h-20 sm:w-20">
            <Bell className="h-8 w-8 sm:h-10 sm:w-10" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Notifications</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-700 sm:text-base">Stay updated with your orders, deliveries, rewards and important alerts.</p>
          </div>
        </div>
      </section>

      {/* Exact top-level headings from the approved design. */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "orders", "delivery", "rewards", "system"] as Category[]).map((category) => {
          const Icon = categoryMeta[category].icon;
          const active = selectedCategory === category;
          return (
            <button key={category} type="button" onClick={() => setSelectedCategory(category)}
              className={\`inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition \${active ? "border-emerald-600 bg-emerald-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50"}\`}>
              <Icon className="h-4 w-4" />
              <span>{categoryMeta[category].shortLabel}</span>
              <span className={\`rounded-full px-2 py-0.5 text-xs \${active ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-800"}\`}>{counts[category]}</span>
            </button>
          );
        })}
        <div className="ml-auto">
          <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0} className="border-emerald-200 text-emerald-800 hover:bg-emerald-50">
            <CheckCheck className="mr-2 h-4 w-4" /> Mark all as read
          </Button>
        </div>
      </div>

      {feedback && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{feedback}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Notifications Overview */}
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Notifications Overview</h2>
          <div className="space-y-1">
            {([
              { id: "all", label: "All Notifications", count: total, icon: Bell },
              { id: "unread", label: "Unread", count: unreadCount, icon: BellRing },
              { id: "read", label: "Read", count: readCount, icon: Check },
            ] as const).map((item) => {
              const active = statusFilter === item.id && selectedCategory === "all";
              const Icon = item.icon;
              return (
                <button key={item.id} type="button" onClick={() => { setStatusFilter(item.id); setSelectedCategory("all"); }}
                  className={\`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-semibold transition \${active ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"}\`}>
                  <span className="flex items-center gap-3"><Icon className="h-5 w-5" />{item.label}</span>
                  <span className={\`rounded-full px-2.5 py-1 text-xs \${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}\`}>{item.count}</span>
                </button>
              );
            })}
          </div>
          <Separator className="my-4" />
          <h3 className="mb-3 text-base font-bold text-slate-900">Categories</h3>
          <div className="space-y-1">
            {(["orders", "delivery", "rewards", "system"] as Category[]).map((category) => {
              const Icon = categoryMeta[category].icon;
              const active = selectedCategory === category;
              return (
                <button key={category} type="button" onClick={() => { setSelectedCategory(category); setStatusFilter("all"); }}
                  className={\`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium transition \${active ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"}\`}>
                  <span className="flex items-center gap-3"><Icon className="h-5 w-5" />{categoryMeta[category].label}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{counts[category]}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Recent Notifications */}
        <section className="min-w-0 overflow-visible rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Recent Notifications</h2>
              <p className="mt-1 text-xs text-slate-500">{visibleNotifications.length} shown · {unreadCount} unread</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { void refetch(); }} disabled={isFetching} className="border-slate-200">
              <RefreshCw className={\`mr-2 h-3.5 w-3.5 \${isFetching ? "animate-spin" : ""}\`} /> Refresh
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div>
          ) : isError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">Unable to load notifications. Please refresh and try again.</div>
          ) : visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-14 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Inbox className="h-7 w-7" /></div>
              <h3 className="font-semibold text-slate-900">No notifications found</h3>
              <p className="mt-1 max-w-sm text-sm text-slate-500">New updates about your account activity will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleNotifications.map((notification) => {
                const category = getCategory(notification);
                const unread = !notification.isRead;
                const Icon = categoryMeta[category].icon;
                return (
                  <article key={notification.id} className={\`group relative flex gap-3 rounded-xl px-3 py-4 transition hover:bg-emerald-50/50 sm:gap-4 \${unread ? "bg-emerald-50/35" : "bg-white"}\`}>
                    <div className="flex w-3 shrink-0 items-start justify-center pt-5">
                      {unread ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" aria-label="Unread" /> : <span className="h-2.5 w-2.5 rounded-full bg-transparent" />}
                    </div>
                    <button type="button" onClick={() => void openDetail(notification)} className="flex min-w-0 flex-1 items-start gap-3 text-left sm:gap-4">
                      <span className={\`flex h-12 w-12 shrink-0 items-center justify-center rounded-full \${categoryStyles[category]}\`}><Icon className="h-6 w-6" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-950">{notification.title || categoryMeta[category].label}</span>
                          {unread && <Badge className="border-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">New</Badge>}
                        </span>
                        <span className="mt-1 block text-sm leading-5 text-slate-700">{notification.message}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{timeLabel(notification.createdAt)}</span>
                          <span>{timeAgo(notification.createdAt)}</span>
                        </span>
                      </span>
                    </button>
                    <div className="relative shrink-0">
                      <span className={\`hidden rounded-full px-3 py-1 text-xs font-semibold sm:inline-flex \${categoryStyles[category]}\`}>{categoryMeta[category].label === "System & Updates" ? "System" : categoryMeta[category].label.replace(/s$/, "")}</span>
                      <button type="button" aria-label="Notification actions" title="Notification actions" onClick={() => setActionMenuId(actionMenuId === notification.id ? null : notification.id)}
                        className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"><MoreVertical className="h-5 w-5" /></button>
                      {actionMenuId === notification.id && (
                        <div className="absolute right-0 top-9 z-30 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                          {!notification.isRead && <button type="button" onClick={() => void markRead(notification.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"><CheckCheck className="h-4 w-4" />Mark as read</button>}
                          <button type="button" onClick={() => void handleDelete(notification.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {total > notifications.length && <p className="mt-4 text-center text-xs text-slate-500">Showing the latest {notifications.length} of {total} notifications.</p>}
        </section>
      </div>

      <Dialog open={Boolean(selectedNotification)} onOpenChange={(open) => { if (!open) setSelectedNotification(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
          <DialogHeader className="flex flex-row items-center justify-between gap-3">
            <DialogTitle className="text-lg font-semibold">Notification Details</DialogTitle>
            <button type="button" onClick={() => setSelectedNotification(null)} aria-label="Close notification details" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-3">
            {selectedNotification && (() => {
              const category = getCategory(selectedNotification);
              return (
                <div className="space-y-4 pb-4">
                  <div className="flex items-start gap-3">
                    <div className={\`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl \${categoryStyles[category]}\`}><NotificationIcon category={category} className="h-6 w-6" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><Badge className={categoryStyles[category]}>{categoryMeta[category].label}</Badge>{!selectedNotification.isRead && <Badge className="bg-emerald-100 text-emerald-800">New</Badge>}</div>
                      <h3 className="mt-2 text-lg font-semibold text-slate-900">{selectedNotification.title}</h3>
                    </div>
                  </div>
                  <Separator />
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedNotification.message}</p>
                  <div className="flex items-center gap-2 text-sm text-slate-500"><Clock className="h-4 w-4" />Received: {timeLabel(selectedNotification.createdAt)}</div>
                  {selectedNotification.data && Object.keys(selectedNotification.data).length > 0 && (
                    <div><h4 className="mb-2 font-semibold text-slate-900">Additional Details</h4><div className="space-y-2 rounded-xl border border-slate-200 p-3">
                      {Object.entries(selectedNotification.data).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(100px,140px)_1fr] gap-3 text-sm"><span className="font-medium capitalize text-slate-500">{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</span><span className="break-all text-slate-700">{typeof value === "object" ? JSON.stringify(value) : String(value)}</span></div>)}
                    </div></div>
                  )}
                  {isCooperativeInvitation && <div className="flex gap-3 border-t pt-4"><Button className="flex-1" disabled={inviteBusy} onClick={() => void respondToCooperativeInvitation(true)}>Accept Invitation</Button><Button variant="outline" className="flex-1" disabled={inviteBusy} onClick={() => void respondToCooperativeInvitation(false)}>Reject</Button></div>}
                  {selectedNotification.actionUrl && <div className="border-t pt-4"><Button className="w-full" onClick={() => { const url = selectedNotification.actionUrl!; setSelectedNotification(null); router.push(url); }}><ExternalLink className="mr-2 h-4 w-4" />{selectedNotification.actionLabel || "View Details"}</Button></div>}
                </div>
              );
            })()}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </main>
  );
}
