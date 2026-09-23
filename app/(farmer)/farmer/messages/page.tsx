"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import {
  MessageSquare,
  Send,
  Loader2,
  Users,
  Store,
  Bell,
  Search,
  ArrowLeft,
  ArrowDown,
  Wifi,
  WifiOff,
  Inbox,
  Truck,
  Paperclip,
  MapPin,
  X,
} from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn, formatTime } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";

interface Participant {
  id: string;
  name: string;
  role?: string;
}

interface Conversation {
  id: string;
  conversation_type?: string;
  participants?: Participant[];
  participant?: Participant;
  subject?: string;
  last_message?: { content: string; sender_name: string; created_at: string } | null;
  lastMessage?: string;
  unread_count?: number;
  updated_at?: string;
}

interface ChatAttachment {
  type?: string;
  url?: string;
  name?: string;
}

interface ChatLocation {
  kind?: string;
  label?: string;
  latitude?: number;
  longitude?: number;
}

interface ChatMsg {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
  message_type?: string;
  attachments?: ChatAttachment[];
  location?: ChatLocation;
}

function participantName(conv: Conversation, userId: string): string {
  const direct = conv.participant;
  if (direct?.name) return direct.name;
  const other = conv.participants?.find((p) => p.id !== userId);
  if (other?.name) return other.name;
  if (conv.subject && conv.subject !== "Delivery conversation") return conv.subject;
  return "Contact";
}

function participantRole(conv: Conversation, userId: string): string {
  const direct = conv.participant;
  if (direct?.role) return direct.role;
  return conv.participants?.find((p) => p.id !== userId)?.role || "";
}

type RoleFilter = "all" | "customer" | "partners" | "business" | "support";

function roleBucket(role: string): RoleFilter {
  const r = (role || "").toLowerCase();
  if (r === "customer") return "customer";
  if (["delivery", "delivery_partner", "partner", "driver"].includes(r)) return "partners";
  if (["business", "buyer", "wholesaler"].includes(r)) return "business";
  if (["support", "admin", "operations", "agent"].includes(r)) return "support";
  return "all";
}

const ROLE_FILTERS: { key: RoleFilter; label: string }[] = [
  { key: "customer", label: "Customers" },
  { key: "partners", label: "Partners" },
  { key: "business", label: "Buyers" },
  { key: "support", label: "Support" },
];

function lastMessageText(conv: Conversation): string {
  return conv.last_message?.content || conv.lastMessage || "No messages yet";
}

function lastMessageTime(conv: Conversation): string {
  return conv.last_message?.created_at || conv.updated_at || "";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (startOfDay === startOfToday) return "Today";
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
  if (startOfDay === yesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function messageKey(m: ChatMsg, fallback: string): string {
  return (m.id as string) || (m as any)._id || `${m.created_at}-${m.sender_id}-${fallback}`;
}

function mergeMessages(current: ChatMsg[], incoming: ChatMsg[]): ChatMsg[] {
  const merged = new Map<string, ChatMsg>();
  current.forEach((m, idx) => {
    const key = messageKey(m, `${idx}`);
    if (!merged.has(key)) merged.set(key, m);
  });
  incoming.forEach((m, idx) => {
    const key = messageKey(m, `${idx}`);
    if (!merged.has(key)) merged.set(key, m);
  });
  return Array.from(merged.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 0) return formatTime(iso);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function messageAttachmentUrl(m: ChatMsg): string | null {
  const att = m.attachments?.[0];
  if (!att?.url) return null;
  if (att.url.startsWith("/uploads/")) {
    const prefix =
      process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "";
    const origin = prefix.replace(/\/api\/v1\/?$/, "").replace(/\/+$/, "");
    return `${origin}${att.url}`;
  }
  return att.url;
}

function isImageAttachment(m: ChatMsg): boolean {
  const att = m.attachments?.[0];
  if (!att) return false;
  if (att.type === "document") return false;
  if (!att.url) return false;
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(att.url);
}

function mapsLink(location: ChatLocation): string {
  const lat = location.latitude ?? 0;
  const lng = location.longitude ?? 0;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export default function FarmerMessagesPage() {
  const { data: session, status } = useSession();
  const userId = String((session?.user as any)?.id || "user-1");
  const userName = (session?.user as any)?.name || "Farmer";
  const userRole = (session?.user as any)?.role || "farmer";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [uploading, setUploading] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    const load = async () => {
      try {
        const res: any = await api.get("/chat/conversations", { params: { user_id: userId } });
        if (cancelled) return;
        const list: Conversation[] = res?.data || res?.conversations || [];
        setConversations(list);
        setActiveId((prev) => prev ?? list[0]?.id ?? null);
      } catch {
        if (!cancelled) setConversations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const pollId = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [userId, status]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const loadMessages = async () => {
      try {
        const res: any = await api.get(`/chat/conversations/${activeId}/messages`);
        if (cancelled || !res?.data) return;
        setMessages((current) => mergeMessages(current, res.data));
        setConversations((current) =>
          current.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c))
        );
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setMsgsLoading(false);
      }
    };
    setMsgsLoading(true);
    void loadMessages();
    const pollId = window.setInterval(loadMessages, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const host =
      process.env.NEXT_PUBLIC_API_URL
        ? new URL(process.env.NEXT_PUBLIC_API_URL, window.location.origin).origin
        : window.location.origin;
    const wsBase = host.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const accessToken = (session?.user as any)?.accessToken || (session as any)?.accessToken || "";
    const tokenParam = accessToken ? `&token=${encodeURIComponent(accessToken)}` : "";
    const wsUrl = `${wsBase}/api/v1/chat/ws/${activeId}?user_id=${encodeURIComponent(userId)}&user_name=${encodeURIComponent(userName)}&user_role=${encodeURIComponent(userRole)}${tokenParam}`;

    let socket: WebSocket | null = null;
    let closedByUs = false;
    let reconnectTimer: number | undefined;

    const patchConversation = (msg: ChatMsg) => {
      setConversations((current) => {
        const updated = current.map((c) =>
          c.id === activeId
            ? {
                ...c,
                last_message: {
                  content: msg.content,
                  sender_name: msg.sender_name,
                  created_at: msg.created_at,
                },
                updated_at: msg.created_at,
                unread_count: 0,
              }
            : c
        );
        return updated.sort(
          (a, b) =>
            new Date(lastMessageTime(b)).getTime() - new Date(lastMessageTime(a)).getTime()
        );
      });
    };

    const connect = () => {
      socket = new WebSocket(wsUrl);
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        socketRef.current = null;
        if (!closedByUs && activeId) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };
      socket.onerror = () => setConnected(false);
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "new_message" || payload.type === "message_sent") {
            const msg = payload.data as ChatMsg;
            setMessages((current) => mergeMessages(current, [msg]));
            patchConversation(msg);
          }
        } catch {
          // Ignore malformed frames.
        }
      };
    };

    connect();
    return () => {
      closedByUs = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
      socketRef.current = null;
    };
  }, [activeId, userId, userName, userRole, session]);

  useEffect(() => {
    if (nearBottom) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeId, nearBottom]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setNearBottom(distance < 140);
  };

  const send = async () => {
    const content = text.trim();
    if (!content || !activeId || sending) return;
    setText("");
    setSending(true);
    try {
      const res: any = await api.post("/chat/messages", {
        conversation_id: activeId,
        content,
        sender_id: userId,
        sender_name: userName,
        sender_role: userRole,
      });
      if (res?.data) {
        const msg = res.data as ChatMsg;
        setMessages((current) => mergeMessages(current, [msg]));
        setConversations((current) => {
          const updated = current.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  last_message: {
                    content: msg.content,
                    sender_name: msg.sender_name,
                    created_at: msg.created_at,
                  },
                  updated_at: msg.created_at,
                }
              : c
          );
          return updated.sort(
            (a, b) =>
              new Date(lastMessageTime(b)).getTime() - new Date(lastMessageTime(a)).getTime()
          );
        });
      }
    } catch {
      setText(content);
    } finally {
      setSending(false);
    }
  };

  const markRead = async () => {
    if (!activeId) return;
    try {
      await api.post(`/chat/conversations/${activeId}/read`);
    } catch {
      // Non-fatal — unread badge simply stays until next poll.
    }
  };

  const handleAttachment = async (file: File | undefined) => {
    if (!file || !activeId || uploading) return;
    setUploading(true);
    try {
      const res: any = await api.upload(
        `/chat/messages/attachment?conversation_id=${encodeURIComponent(activeId)}`,
        file
      );
      if (res?.data) {
        const msg = res.data as ChatMsg;
        setMessages((current) => mergeMessages(current, [msg]));
      }
    } catch {
      // Ignore — attachment upload failure is surfaced by the backend.
    } finally {
      setUploading(false);
    }
  };

  const shareLocation = async () => {
    if (!activeId || sharingLocation) return;
    if (!("geolocation" in navigator)) {
      window.alert("Location sharing is not supported on this device.");
      return;
    }
    setSharingLocation(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      );
      const { latitude, longitude } = pos.coords;
      const isDelivery = roleBucket(participantRole(active, userId)) === "partners";
      const res: any = await api.post("/chat/messages/location", {
        conversation_id: activeId,
        sender_id: userId,
        sender_name: userName,
        sender_role: userRole,
        latitude,
        longitude,
        share_kind: isDelivery ? "delivery" : "pickup",
        label: isDelivery ? "Delivery Meeting Point" : "Farm Pickup Location",
      });
      if (res?.data) {
        const msg = res.data as ChatMsg;
        setMessages((current) => mergeMessages(current, [msg]));
      }
    } catch {
      window.alert("Could not get your location. Please check permissions and try again.");
    } finally {
      setSharingLocation(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const role = roleBucket(participantRole(c, userId));
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (!q) return true;
      return (
        participantName(c, userId).toLowerCase().includes(q) ||
        lastMessageText(c).toLowerCase().includes(q) ||
        (c.subject || "").toLowerCase().includes(q)
      );
    });
  }, [conversations, search, userId, roleFilter]);

  const roleCounts = useMemo(() => {
    const counts: Record<RoleFilter, number> = { all: conversations.length, customer: 0, partners: 0, business: 0, support: 0 };
    conversations.forEach((c) => {
      const b = roleBucket(participantRole(c, userId));
      if (b !== "all") counts[b] += 1;
    });
    return counts;
  }, [conversations, userId]);

  const toggleRoleFilter = (key: RoleFilter) =>
    setRoleFilter((prev) => (prev === key ? "all" : key));

  const active = conversations.find((c) => c.id === activeId);
  const activeName = active ? participantName(active, userId) : "";
  const activeRole = active ? participantRole(active, userId) : "";

  const openConversation = (id: string) => {
    setActiveId(id);
    setMobileView("chat");
    void markRead();
  };

  const goBackToList = () => {
    setMobileView("list");
  };

  const roleFilters = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setRoleFilter("all")}
        aria-pressed={roleFilter === "all"}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          roleFilter === "all"
            ? "border-emerald-600 bg-emerald-600 text-white"
            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
        )}
      >
        All
        <span className={cn("rounded-full px-1.5 text-[10px]", roleFilter === "all" ? "bg-white/20" : "bg-slate-100")}>
          {roleCounts.all}
        </span>
      </button>
      {ROLE_FILTERS.map(({ key, label }) => {
        const icon =
          key === "customer" ? (
            <Users className="h-3 w-3" />
          ) : key === "partners" ? (
            <Truck className="h-3 w-3" />
          ) : key === "business" ? (
            <Store className="h-3 w-3" />
          ) : (
            <Bell className="h-3 w-3" />
          );
        const active = roleFilter === key;
        return (
          <button
            key={key}
            onClick={() => toggleRoleFilter(key)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            )}
          >
            {icon}
            {label}
            <span className={cn("rounded-full px-1.5 text-[10px]", active ? "bg-white/20" : "bg-slate-100")}>
              {roleCounts[key]}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Messages</h1>
          <p className="text-gray-500">Chat with customers, buyers and platform support in real time.</p>
        </div>
        {roleFilters}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="flex h-[70vh] p-0">
          {/* Conversation list */}
          <div
            className={cn(
              "w-full shrink-0 flex-col border-r sm:flex sm:w-80",
              mobileView === "list" ? "flex" : "hidden"
            )}
          >
            <div className="border-b p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search conversations…"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex-1 divide-y overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center p-8 text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
                  <Inbox className="h-8 w-8 text-slate-300" />
                  <p className="text-sm text-gray-500">
                    {search
                      ? "No conversations match your search."
                      : roleFilter !== "all"
                        ? `No ${ROLE_FILTERS.find((r) => r.key === roleFilter)?.label.toLowerCase()} conversations yet.`
                        : "No conversations yet."}
                  </p>
                  {!search && roleFilter === "all" && (
                    <p className="text-xs text-gray-400">
                      Live chats with customers start from an order&apos;s delivery details. Check your orders page.
                    </p>
                  )}
                </div>
              )}
              {filtered.map((c) => {
                const name = participantName(c, userId);
                const role = participantRole(c, userId);
                const unread = c.unread_count || 0;
                return (
                  <button
                    key={c.id}
                    onClick={() => openConversation(c.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
                      c.id === activeId ? "bg-emerald-50" : "hover:bg-slate-50"
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                      {initials(name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-800">{name}</p>
                        {lastMessageTime(c) && (
                          <span className="shrink-0 text-[10px] text-gray-400">
                            {timeAgo(lastMessageTime(c))}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-gray-500">{lastMessageText(c)}</p>
                      {role && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-emerald-600">{role}</p>}
                    </div>
                    {unread > 0 && (
                      <Badge variant="destructive" className="h-5 min-w-5 shrink-0 px-1.5 text-[10px]">
                        {unread}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chat pane */}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              mobileView === "chat" ? "flex" : "hidden sm:flex"
            )}
          >
            {!active ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50/50 p-6 text-center">
                <MessageSquare className="h-10 w-10 text-slate-300" />
                <p className="text-sm text-gray-500">
                  Select a conversation to start chatting, or open the live chat on one of your orders.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="sm:hidden"
                      onClick={goBackToList}
                      aria-label="Back to conversations"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                      {initials(activeName)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{activeName}</p>
                      <p className="flex items-center gap-1 text-xs text-gray-400">
                        {connected ? (
                          <Wifi className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <WifiOff className="h-3 w-3 text-amber-500" />
                        )}
                        {connected ? "Live" : activeRole || "Reconnecting…"}
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  ref={listRef}
                  onScroll={handleScroll}
                  className="relative flex-1 space-y-2 overflow-y-auto bg-slate-50/50 p-4"
                >
                  {msgsLoading && (
                    <div className="flex items-center justify-center py-8 text-slate-400">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}
                  {!msgsLoading && messages.length === 0 && (
                    <p className="pt-12 text-center text-sm text-gray-400">
                      Say hello to {activeName} to start the conversation.
                    </p>
                  )}
                  {!msgsLoading &&
                    messages.map((m, idx) => {
                      const day = formatDay(m.created_at);
                      const prevDay = idx > 0 ? formatDay(messages[idx - 1].created_at) : "";
                      const mine = m.sender_id === userId;
                      return (
                        <div key={messageKey(m, `${idx}`)}>
                          {day && day !== prevDay && (
                            <div className="my-3 flex justify-center">
                              <span className="rounded-full bg-white px-3 py-0.5 text-[10px] text-gray-400 shadow-sm">
                                {day}
                              </span>
                            </div>
                          )}
                          <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "max-w-[78%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                                mine
                                  ? "rounded-br-sm bg-emerald-600 text-white"
                                  : "rounded-bl-sm border bg-white text-slate-800 shadow-sm"
                              )}
                            >
                              {!mine && (
                                <p className="mb-1 text-[10px] font-semibold text-emerald-700">
                                  {m.sender_name || activeName}
                                </p>
                              )}
                              {isImageAttachment(m) && messageAttachmentUrl(m) && (
                                <a
                                  href={messageAttachmentUrl(m)!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mb-2 block overflow-hidden rounded-lg"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={messageAttachmentUrl(m)!}
                                    alt={m.content || "Attachment"}
                                    className="max-h-48 w-full object-cover"
                                  />
                                </a>
                              )}
                              {m.location && (
                                <a
                                  href={mapsLink(m.location)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={cn(
                                    "mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
                                    mine
                                      ? "bg-emerald-700/40 text-emerald-50"
                                      : "bg-emerald-50 text-emerald-700"
                                  )}
                                >
                                  <MapPin className="h-4 w-4 shrink-0" />
                                  <span>{m.location.label || "Shared Location"} — tap to open map</span>
                                </a>
                              )}
                              <p className="whitespace-pre-line">{m.content}</p>
                              {m.created_at && (
                                <p
                                  className={cn(
                                    "mt-1 text-right text-[10px]",
                                    mine ? "text-emerald-100" : "text-gray-400"
                                  )}
                                >
                                  {formatTime(m.created_at)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  <div ref={endRef} />
                  {!nearBottom && (
                    <button
                      onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}
                      className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border bg-white text-slate-500 shadow-md transition-colors hover:bg-slate-100"
                      aria-label="Scroll to latest message"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 border-t bg-white p-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => void handleAttachment(e.target.files?.[0])}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={uploading || !activeId}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach image"
                    title="Attach product image / quality evidence"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={sharingLocation || !activeId}
                    onClick={() => void shareLocation()}
                    aria-label="Share pickup location"
                    title="Share farm pickup location"
                  >
                    {sharingLocation ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                  </Button>
                  <Input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void send();
                    }}
                    placeholder={`Message ${activeName}…`}
                    disabled={sending}
                    className="h-10 flex-1"
                  />
                  <Button onClick={() => void send()} disabled={!text.trim() || sending} size="icon">
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}