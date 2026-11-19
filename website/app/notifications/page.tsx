"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell, BellRing, Check, CheckCheck, Clock, ExternalLink, Gift,
  Megaphone, MoreVertical, Package, Trash2, Truck, X,
  Inbox, Sprout, Star, ArrowUpDown, Search, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "../components/ui/button";
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
type SortOrder = "newest" | "oldest";

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
  const text = `${notification.title || ""} ${notification.message || ""}`.toLowerCase();
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
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
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
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const pageSize = 5;

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=${encodeURIComponent("/notifications")}`);
    }
  }, [router, status]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["notificationsList", currentPage],
    queryFn: () => api.get("/notifications/", { params: { limit: pageSize, skip: (currentPage - 1) * pageSize } }),
    enabled: status === "authenticated",
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const selectedOrderReference = selectedNotification
    ? String(
        selectedNotification.data?.orderNumber ||
        selectedNotification.data?.orderId ||
        selectedNotification.data?.order_id ||
        selectedNotification.message.match(/#?(ORD-[A-Z0-9-]+)/i)?.[1] ||
        ""
      ).trim()
    : "";
  const { data: relatedOrdersData, isLoading: relatedOrdersLoading, isError: relatedOrdersError } = useQuery({
    queryKey: ["notificationRelatedOrders", selectedOrderReference],
    queryFn: () => api.get("/orders", { params: { limit: 100 } }),
    enabled: Boolean(selectedNotification && selectedOrderReference),
    staleTime: 30000,
  });
  const relatedOrders = (relatedOrdersData as any)?.data?.orders || (relatedOrdersData as any)?.orders || [];
  const relatedOrder = relatedOrders.find((order: any) => {
    const refs = [order.orderNumber, order.id, order._id].filter(Boolean).map(String);
    return refs.some((value) => value === selectedOrderReference || value.includes(selectedOrderReference) || selectedOrderReference.includes(value));
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
    const needle = searchTerm.trim().toLowerCase();
    const searchMatches = !needle || [item.title, item.message, item.type, item.data?.orderNumber].some((value) => String(value || "").toLowerCase().includes(needle));
    return categoryMatches && statusMatches && searchMatches;
  }).sort((a, b) => {
    const difference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return sortOrder === "newest" ? -difference : difference;
  }), [notifications, selectedCategory, statusFilter, sortOrder, searchTerm]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageNumbers = Array.from(new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))).sort((a, b) => a - b);
  const dateGroupLabel = (value: string) => {
    const date = new Date(value);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  const refresh = async () => {
    setFeedback("");
    await queryClient.invalidateQueries({ queryKey: ["notificationsList"] });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`);
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
      await api.delete(`/notifications/${id}`);
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
      await api.post(`/cooperatives/invitations/${selectedNotification.data.invitationId}/${accept ? "accept" : "reject"}`);
      await refresh();
      setSelectedNotification(null);
    } catch (error: any) {
      window.alert(error?.message || `Could not ${accept ? "accept" : "reject"} the invitation.`);
    } finally {
      setInviteBusy(false);
    }
  };

  if (status === "loading") {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div>;
  }

  return (
    <main className="w-full max-w-none space-y-5">
      <section aria-label="Notifications" className="relative isolate flex h-[104px] min-h-[104px] w-full min-w-0 items-center overflow-hidden rounded-xl border border-slate-100 bg-[#f4fff9] shadow-sm sm:h-[104px] sm:min-h-[104px]">
        <div aria-hidden="true" className="absolute inset-0" style={{ backgroundImage: "url(data:image/webp;base64,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)", backgroundPosition: "center center", backgroundRepeat: "no-repeat", backgroundSize: "100% 100%", filter: "brightness(0.9) saturate(0.96)" }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]" style={{ background: "linear-gradient(90deg, #f8fffb 0%, #f8fffb 48%, rgba(248,255,251,0.99) 60%, rgba(248,255,251,0.88) 68%, rgba(248,255,251,0.28) 82%, rgba(248,255,251,0.04) 100%)" }} />
        <div className="relative z-10 flex min-w-0 items-center gap-4 px-5 sm:px-7">
          <div className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full bg-[#d9f8e6] text-[#087443]">
            <Bell className="h-9 w-9" strokeWidth={1.9} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[25px] font-bold leading-tight tracking-tight text-[#101820] sm:text-[26px]">Notifications</h1>
            <p className="mt-1 text-[13px] font-medium leading-5 text-slate-600">Stay updated with your orders, deliveries, rewards and important alerts.</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {(["all", "orders", "delivery", "rewards", "system"] as Category[]).map((category) => {
          const Icon = categoryMeta[category].icon;
          const active = selectedCategory === category;
          return (
            <button key={category} type="button" onClick={() => { setSelectedCategory(category); setStatusFilter("all"); setCurrentPage(1); }}
              className={`inline-flex min-h-9 items-center gap-2 rounded-lg border-b-[3px] px-3 py-1.5 text-sm font-semibold transition sm:px-4 ${active ? "border-x-transparent border-t-transparent border-b-emerald-700 bg-emerald-50 text-emerald-900" : "border-x-transparent border-t-transparent border-b-transparent bg-white text-slate-700 hover:bg-emerald-50"}`}>
              <Icon className="h-4 w-4" /><span>{categoryMeta[category].shortLabel}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? "bg-emerald-100 text-emerald-800" : "bg-emerald-100 text-emerald-800"}`}>{counts[category]}</span>
            </button>
          );
        })}
        <div className="ml-auto pr-1"><Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0} className="h-9 rounded-lg border-slate-200 bg-white px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"><CheckCheck className="mr-1.5 h-3.5 w-3.5" /> Mark all as read</Button></div>
      </div>

      {feedback && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{feedback}</div>}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[230px_minmax(340px,0.95fr)_minmax(390px,1.25fr)] 2xl:grid-cols-[250px_minmax(370px,0.95fr)_minmax(440px,1.25fr)]">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
          <h2 className="mb-3 text-base font-bold text-slate-900">Notifications Overview</h2>
          <div className="space-y-1">
            {([
              { id: "all", label: "All Notifications", count: total, icon: Bell },
              { id: "unread", label: "Unread", count: unreadCount, icon: BellRing },
              { id: "read", label: "Read", count: readCount, icon: Check },
            ] as const).map((item) => {
              const active = statusFilter === item.id && selectedCategory === "all";
              const Icon = item.icon;
              return <button key={item.id} type="button" onClick={() => { setStatusFilter(item.id); setSelectedCategory("all"); setCurrentPage(1); }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${active ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"}`}>
                <span className="flex items-center gap-3"><Icon className="h-5 w-5" />{item.label}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{item.count}</span>
              </button>;
            })}
          </div>
          <Separator className="my-4" />
          <h3 className="mb-2.5 text-base font-bold text-slate-900">Categories</h3>
          <div className="space-y-1">
            {(["orders", "delivery", "rewards", "system"] as Category[]).map((category) => {
              const Icon = categoryMeta[category].icon;
              const active = selectedCategory === category;
              return <button key={category} type="button" onClick={() => { setSelectedCategory(category); setStatusFilter("all"); }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${active ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"}`}>
                <span className="flex items-center gap-3"><Icon className="h-5 w-5" />{categoryMeta[category].label}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{counts[category]}</span>
              </button>;
            })}
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-bold text-slate-900 sm:text-xl">Recent Notifications</h2><p className="mt-0.5 text-xs text-slate-500">Showing 5 notifications at a time · Page {currentPage} of {totalPages}</p></div>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <ArrowUpDown className="h-4 w-4 text-slate-500" /><span className="sr-only">Sort notifications</span>
              <select value={sortOrder} onChange={(event) => { setSortOrder(event.target.value as SortOrder); setCurrentPage(1); }} className="bg-transparent font-semibold outline-none">
                <option value="newest">Newest First</option><option value="oldest">Oldest First</option>
              </select>
            </label>
          </div>

          <label className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 focus-within:border-emerald-400">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search this page by title, message or order number..." className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
            {searchTerm && <button type="button" onClick={() => setSearchTerm("")} className="text-xs font-semibold text-emerald-700">Clear</button>}
          </label>
          {isLoading ? <div className="flex justify-center py-16"><div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" /></div>
          : isError ? <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">Unable to load notifications. Please refresh and try again.</div>
          : visibleNotifications.length === 0 ? <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-14 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Inbox className="h-7 w-7" /></div>
              <h3 className="font-semibold text-slate-900">No notifications found</h3><p className="mt-1 max-w-sm text-sm text-slate-500">New updates about your account activity will appear here.</p>
            </div>
          : <div className="space-y-2">
              {visibleNotifications.map((notification, notificationIndex) => {
                const category = getCategory(notification);
                const unread = !notification.isRead;
                const Icon = category === "rewards" ? Star : categoryMeta[category].icon;
                const groupLabel = dateGroupLabel(notification.createdAt);
                const previousGroup = notificationIndex > 0 ? dateGroupLabel(visibleNotifications[notificationIndex - 1].createdAt) : "";
                return <Fragment key={notification.id}>
                  {groupLabel !== previousGroup && <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{groupLabel} · {visibleNotifications.filter((item) => dateGroupLabel(item.createdAt) === groupLabel).length} Notifications</div>}
                  <article className={`group relative flex gap-3 rounded-xl px-2 py-2 transition hover:bg-emerald-50/50 sm:gap-3 sm:px-3 sm:py-2.5 ${selectedNotification?.id === notification.id ? "bg-emerald-50 ring-1 ring-emerald-300" : notificationIndex === 0 && !selectedNotification ? "bg-emerald-50/70" : "bg-white"}`}>
                  <div className="flex w-3 shrink-0 items-start justify-center pt-5">{unread || notificationIndex === 0 ? <span className="h-2.5 w-2.5 rounded-full bg-emerald-700" aria-label={unread ? "Unread" : "Featured notification"} /> : <span className="h-2.5 w-2.5 rounded-full bg-transparent" />}</div>
                  <button type="button" onClick={() => void openDetail(notification)} className="flex min-w-0 flex-1 items-start gap-3 text-left sm:gap-4">
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12 ${category === "rewards" ? "bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-sm ring-2 ring-emerald-100" : "bg-emerald-100 text-emerald-800"}`}><Icon className={`h-6 w-6 sm:h-7 sm:w-7 ${category === "rewards" ? "fill-current" : ""}`} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-950 text-sm sm:text-[15px]">{notification.title || categoryMeta[category].label}</span></span>
                      <span className="mt-0.5 block text-xs leading-4 text-slate-700 sm:text-[13px]">{notification.message}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{timeLabel(notification.createdAt)}</span><span>{timeAgo(notification.createdAt)}</span></span>
                    </span>
                  </button>
                  <div className="relative flex shrink-0 items-center gap-2">
                    <span className={`hidden rounded-full px-3 py-1.5 text-xs font-semibold sm:inline-flex ${categoryStyles[category]}`}>{categoryMeta[category].label === "System & Updates" ? "System" : categoryMeta[category].label.replace(/s$/, "")}</span>
                    <button type="button" aria-label="Notification actions" title="Notification actions" onClick={() => setActionMenuId(actionMenuId === notification.id ? null : notification.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 hover:text-slate-950"><MoreVertical className="h-5 w-5" /></button>
                    {actionMenuId === notification.id && <div className="absolute right-0 top-10 z-30 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                      {!notification.isRead && <button type="button" onClick={() => void markRead(notification.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-emerald-50"><CheckCheck className="h-4 w-4" />Mark as read</button>}
                      <button type="button" onClick={() => void handleDelete(notification.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete</button>
                    </div>}
                  </div>
                  </article>
                </Fragment>;
              })}
            </div>}
          {visibleNotifications.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">Showing {Math.min((currentPage - 1) * pageSize + 1, total)}–{Math.min(currentPage * pageSize, total)} of {total} notifications</p>
            <div className="flex items-center gap-1">
              <button type="button" disabled={currentPage === 1 || isLoading} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
              {pageNumbers.map((page, index) => <Fragment key={page}>{index > 0 && page - pageNumbers[index - 1] > 1 && <span className="px-1 text-xs text-slate-400">…</span>}<button type="button" onClick={() => setCurrentPage(page)} aria-current={currentPage === page ? "page" : undefined} className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-semibold ${currentPage === page ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-200 text-slate-700 hover:bg-emerald-50"}`}>{page}</button></Fragment>)}
              <button type="button" disabled={currentPage >= totalPages || isLoading} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>}
          {searchTerm && <p className="mt-2 text-xs text-slate-500">Search checks the currently loaded page.</p>}
        </section>

        <aside className="min-w-0 min-h-[520px] rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Inbox className="h-5 w-5 text-emerald-700" />Notification Details</h2>
            {selectedNotification && <button type="button" onClick={() => setSelectedNotification(null)} aria-label="Clear selected notification" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>}
          </div>
          {selectedNotification ? (() => {
            const detailCategory = getCategory(selectedNotification);
            const data = selectedNotification.data || {};
            const detailEntries = Object.entries(data).filter(([key, value]) =>
              !["actionurl", "url", "invitationid", "kind", "type"].includes(key.toLowerCase()) &&
              value !== null && value !== undefined && value !== ""
            );
            const findValue = (pattern: RegExp) => detailEntries.find(([key]) => pattern.test(key))?.[1];
            const points = findValue(/points?Earned|earnedPoints|points/i);
            const balance = findValue(/balance|totalPoints|availablePoints/i);
            const orderNumber = findValue(/order(Number|Id)?/i) || selectedNotification.message.match(/#?(ORD-[A-Z0-9-]+)/i)?.[1];
            const orderDate = findValue(/orderDate|purchaseDate/i);
            const amount = findValue(/amount|totalPrice|orderTotal/i);
            const status = findValue(/status/i);
            const orderItems = Array.isArray(relatedOrder?.items) ? relatedOrder.items : [];
            const orderStatus = relatedOrder?.orderStatus || relatedOrder?.status || status;
            const orderTotal = relatedOrder?.totalAmount ?? relatedOrder?.total ?? amount;
            const orderDateValue = relatedOrder?.orderDate || relatedOrder?.createdAt || orderDate;
            const deliveryAddress = relatedOrder?.deliveryAddress || relatedOrder?.shippingAddress || {};
            const addressText = typeof deliveryAddress === "string"
              ? deliveryAddress
              : [deliveryAddress.addressLine1, deliveryAddress.addressLine2, deliveryAddress.landmark, deliveryAddress.city, deliveryAddress.state, deliveryAddress.zipCode || deliveryAddress.postalCode].filter(Boolean).join(", ");
            const paymentMethod = relatedOrder?.paymentMethod || relatedOrder?.payment?.method;
            const paymentStatus = relatedOrder?.paymentStatus || relatedOrder?.payment?.status;
            const statusHistory = Array.isArray(relatedOrder?.statusHistory) ? relatedOrder.statusHistory : [];

            const product = findValue(/productName|product/i);
            const labelFor = (key: string) => {
              const labels: Record<string, string> = {
                orderNumber: "Order Number", createdAt: "Order Date", orderDate: "Order Date",
                orderStatus: "Order Status", status: "Status", paymentStatus: "Payment Status",
                paymentMethod: "Payment Method", deliveryType: "Delivery Method",
                totalAmount: "Order Total", totalPrice: "Item Total", unitPrice: "Unit Price",
                productName: "Product", quantity: "Quantity", discount: "Discount",
                points: "AgriPoints Earned", balance: "AgriPoints Balance",
                postalCode: "PIN Code", zipCode: "PIN Code", addressLine1: "Address",
                addressLine2: "Address Line 2", city: "City", state: "State",
              };
              return labels[key] || key.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
            };
            const humanValue = (key: string, value: any): string => {
              if (value === null || value === undefined || value === "") return "Not provided";
              if (typeof value === "boolean") return value ? "Yes" : "No";
              if (/status/i.test(key)) return String(value).replace(/[_-]/g, " ").replace(/\\b\\w/g, (letter) => letter.toUpperCase());
              if (/paymentMethod/i.test(key)) {
                const methods: Record<string, string> = { razorpay: "Razorpay", cash: "Cash on Delivery", cod: "Cash on Delivery", upi: "UPI", card: "Card" };
                return methods[String(value).toLowerCase()] || String(value).replace(/[_-]/g, " ");
              }
              if (/deliveryType/i.test(key)) {
                const methods: Record<string, string> = { pickup: "Customer Pickup", delivery: "Home Delivery" };
                return methods[String(value).toLowerCase()] || String(value).replace(/[_-]/g, " ");
              }
              if (/(createdAt|orderDate|date|timestamp)/i.test(key)) {
                const date = new Date(value);
                if (!Number.isNaN(date.getTime())) return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
              }
              if (/(amount|price|total|discount)/i.test(key) && typeof value === "number") return `₹${value.toLocaleString("en-IN")}`;
              return String(value).replace(/[_-]/g, " ");
            };
            const formatValue = (value: unknown) => typeof value === "object" ? "Details available below" : String(value);
            const excluded = new Set([points, balance, orderNumber, orderDate, amount, status, product].filter((value) => value !== undefined));
            const otherEntries = detailEntries.filter(([key, value]) =>
              !excluded.has(value) && !["id", "_id", "trackingHistory", "tracking_history"].includes(key)
            );
            const flattenHumanEntries = (value: any, prefix = ""): [string, any][] => {
              if (!value || typeof value !== "object") return prefix ? [[prefix, value]] : [];
              if (Array.isArray(value)) {
                if (prefix === "items" || prefix === "orderItems") {
                  return value.flatMap((item: any, index: number) => {
                    if (!item || typeof item !== "object") return [[`Item ${index + 1}`, item] as [string, any]];
                    const name = item.productName || item.name || `Item ${index + 1}`;
                    const qty = item.quantity ?? 1;
                    const unit = item.unit || item.unitName || "";
                    const price = item.totalPrice ?? item.price;
                    return [[`Product ${index + 1}`, name], [`Quantity ${index + 1}`, `${qty} ${unit}`.trim()], ...(price !== undefined ? [[`Item Total ${index + 1}`, price] as [string, any]] : [])];
                  });
                }
                return [];
              }
              return Object.entries(value).flatMap(([key, nested]) => {
                if (["id", "_id", "trackingHistory", "tracking_history", "statusHistory"].includes(key)) return [];
                const next = prefix ? `${prefix} — ${key}` : key;
                if (nested && typeof nested === "object") return flattenHumanEntries(nested, next);
                return [[next, nested] as [string, any]];
              });
            };
            const humanEntries = otherEntries.flatMap(([key, value]) => flattenHumanEntries(value, key));
            const DetailRows = ({ entries }: { entries: [string, any][] }) => <div className="divide-y divide-slate-100">{entries.map(([key, value], index) => <div key={`${key}-${index}`} className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-3 py-2.5 text-xs sm:text-sm"><span className="font-medium text-slate-500">{labelFor(key)}</span><span className="break-words text-right font-semibold capitalize text-slate-800">{humanValue(key, value)}</span></div>)}</div>;
            return <div className="space-y-4">
              <div className="rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-emerald-50/60 p-4">
                <div className="flex items-start gap-3">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${detailCategory === "rewards" ? "bg-emerald-700 text-white" : "bg-emerald-100 text-emerald-800"}`}>
                    <NotificationIcon category={detailCategory} className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2"><Badge className={categoryStyles[detailCategory]}>{categoryMeta[detailCategory].label}</Badge>{!selectedNotification.isRead && <Badge className="bg-emerald-100 text-emerald-800">Unread</Badge>}</div>
                    <h3 className="text-base font-bold leading-6 text-slate-950">{selectedNotification.title || categoryMeta[detailCategory].label}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedNotification.message}</p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-4 w-4" />{timeLabel(selectedNotification.createdAt)}</p>
                  </div>
                </div>
              </div>
              {detailCategory === "rewards" && (points !== undefined || balance !== undefined) && <section className="overflow-hidden rounded-xl border border-slate-200">
                <h3 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800"><Gift className="h-4 w-4 text-emerald-700" />Reward Summary</h3>
                <div className="grid grid-cols-2 divide-x divide-slate-200 p-4">
                  {points !== undefined && <div className="px-2 text-center"><p className="text-xs font-medium text-slate-500">Points Earned</p><p className="mt-1 text-2xl font-bold text-emerald-700">{formatValue(points)} <span className="text-sm font-semibold">pts</span></p></div>}
                  {balance !== undefined && <div className="px-2 text-center"><p className="text-xs font-medium text-slate-500">Current Balance</p><p className="mt-1 text-2xl font-bold text-slate-900">{formatValue(balance)} <span className="text-sm font-semibold">pts</span></p></div>}
                </div>
              </section>}
              {(orderNumber || orderDate || amount !== undefined || status !== undefined || product !== undefined || relatedOrdersLoading || relatedOrdersError) && <section className="overflow-hidden rounded-xl border border-slate-200">
                <h3 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800"><Package className="h-4 w-4 text-emerald-700" />Related Order Details</h3>
                <div className="px-4 py-1">
                  {orderNumber && <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span className="text-slate-500">Order Number</span><span className="break-all text-right font-semibold text-slate-800">{formatValue(orderNumber)}</span></div>}
                  {orderDateValue && <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span className="text-slate-500">Order Date</span><span className="text-right font-semibold text-slate-800">{formatValue(orderDateValue)}</span></div>}
                  {orderStatus && <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span className="text-slate-500">Order Status</span><span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">{formatValue(orderStatus)}</span></div>}
                  {orderTotal !== undefined && <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span className="text-slate-500">Order Total</span><span className="text-right font-semibold text-slate-800">₹{Number(orderTotal).toLocaleString("en-IN")}</span></div>}
                  {paymentMethod && <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span className="text-slate-500">Payment Method</span><span className="text-right font-semibold capitalize text-slate-800">{formatValue(paymentMethod)}</span></div>}
                  {paymentStatus && <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span className="text-slate-500">Payment Status</span><span className="text-right font-semibold capitalize text-slate-800">{formatValue(paymentStatus)}</span></div>}
                  {addressText && <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-3 text-sm"><span className="shrink-0 text-slate-500">Delivery Address</span><span className="text-right font-semibold text-slate-800">{addressText}</span></div>}
                  {relatedOrdersLoading && <p className="py-3 text-xs text-slate-500">Loading the linked order information…</p>}
                  {relatedOrdersError && <p className="py-3 text-xs text-amber-700">The linked order information could not be loaded. The notification information is still available above.</p>}
                  {orderItems.length > 0 && <div className="border-t border-slate-100 py-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Items in this order ({orderItems.length})</p>
                    <div className="space-y-2">{orderItems.map((item: any, index: number) => <div key={item.id || item.productId || index} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><div className="min-w-0"><p className="truncate font-semibold text-slate-800">{item.productName || item.name || "Product"}</p><p className="text-xs text-slate-500">Quantity: {item.quantity ?? 1}</p></div><span className="shrink-0 font-semibold text-slate-800">₹{Number(item.totalPrice ?? (Number(item.unitPrice || item.price || 0) * Number(item.quantity || 1))).toLocaleString("en-IN")}</span></div>)}</div>
                  </div>}
                </div>
              </section>}
              {humanEntries.length > 0 && <section className="overflow-hidden rounded-xl border border-slate-200">
                <h3 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800"><Inbox className="h-4 w-4 text-emerald-700" />Additional Information</h3>
                <div className="px-4"><DetailRows entries={humanEntries} /></div>
              </section>}
              {detailEntries.length === 0 && !orderNumber && <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">The full notification message and received time are shown above. No additional structured details were supplied with this notification.</div>}
              {isCooperativeInvitation && <div className="flex gap-2"><Button className="flex-1" disabled={inviteBusy} onClick={() => void respondToCooperativeInvitation(true)}>Accept Invitation</Button><Button variant="outline" className="flex-1" disabled={inviteBusy} onClick={() => void respondToCooperativeInvitation(false)}>Reject</Button></div>}
              {selectedNotification.actionUrl && <Button className="w-full" onClick={() => { const url = selectedNotification.actionUrl!; setSelectedNotification(null); router.push(url); }}><ExternalLink className="mr-2 h-4 w-4" />{selectedNotification.actionLabel || "View Details"}</Button>}
            </div>;
          })() : <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Bell className="h-7 w-7" /></div>
            <h3 className="font-semibold text-slate-900">Select a notification</h3>
            <p className="mt-1 max-w-xs text-sm leading-5 text-slate-500">Choose any notification from the list to see its full message and related information here.</p>
          </div>}
        </aside>
      </div>
    </main>
  );
}
