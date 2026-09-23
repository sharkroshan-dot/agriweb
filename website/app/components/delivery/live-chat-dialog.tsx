"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, MessageCircle } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useSession } from "next-auth/react";
import { api } from "../../lib/api/client";

type ChatMessage = { id: string; sender_name: string; sender_id: string; content: string; created_at: string };

export function LiveChatDialog({
  orderId,
  customerName,
  onClose,
}: {
  orderId: string;
  customerName: string;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const conversationId = `delivery-chat-${orderId}`;
  const userId = String((session?.user as any)?.id || "delivery-partner");
  const userName = (session?.user as any)?.name || "Delivery partner";
  const userRole = (session?.user as any)?.role || "delivery";
  const isCustomer = userRole === "customer";

  useEffect(() => {
    let cancelled = false;
    const loadMessages = () => {
      void api.get<{ data?: ChatMessage[] }>(`/chat/conversations/${conversationId}/messages`)
        .then((response) => {
          if (cancelled || !response?.data) return;
          setMessages((current) => {
            const key = (m: ChatMessage, i: number) => (m.id || (m as any)._id || `${m.created_at}-${i}`);
            const merged = new Map<string, ChatMessage>();
            current.forEach((m, i) => merged.set(key(m, i), m));
            response.data!.forEach((m, i) => merged.set(key(m, i), m));
            const sorted = Array.from(merged.values()).sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            if (userRole === "customer") {
              const incomingCount = sorted.filter((message) => message.sender_id !== userId).length;
              window.localStorage.setItem(`agri-chat-read-${conversationId}`, String(incomingCount));
              window.localStorage.removeItem(`agri-chat-unread-${orderId}`);
              window.dispatchEvent(new CustomEvent("agri-chat-read", { detail: conversationId }));
            }
            return sorted;
          });
        })
        .catch(() => undefined);
    };
    loadMessages();
    const pollId = window.setInterval(loadMessages, 1000);

    const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
    let websocketBase = window.location.origin;
    if (configuredApiUrl) {
      try {
        websocketBase = new URL(configuredApiUrl, window.location.origin).origin;
      } catch {
        // Keep the frontend origin when the API URL is relative or malformed.
      }
    }
    const websocketUrl = websocketBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const accessToken = (session?.user as any)?.accessToken || (session as any)?.accessToken || "";
    const tokenParam = accessToken ? `&token=${encodeURIComponent(accessToken)}` : "";
    const socket = new WebSocket(`${websocketUrl}/api/v1/chat/ws/${conversationId}?user_id=${encodeURIComponent(userId)}&user_name=${encodeURIComponent(userName)}${tokenParam}`);
    socketRef.current = socket;
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "new_message" || payload.type === "message_sent") {
          const message = payload.data as ChatMessage;
          setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
        }
      } catch {
        // Ignore malformed socket messages.
      }
    };
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      socket.close();
      socketRef.current = null;
    };
  }, [conversationId, userId, userName, session]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content) return;
    setInput("");

    // Always persist through the backend. The backend broadcasts the saved
    // message to connected participants, and polling covers disconnected ones.
    try {
      const response = await api.post<{ data?: ChatMessage }>("/chat/messages", {
        conversation_id: conversationId,
        content,
        sender_id: userId,
        sender_name: userName,
        sender_role: userRole,
      });
      if (response?.data) {
        setMessages((current) => current.some((item) => item.id === response.data!.id)
          ? current
          : [...current, response.data!]);
      }
    } catch {
      setInput(content);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[1100] flex h-[440px] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-white shadow-2xl sm:w-[360px]">
      <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /><div><p className="text-sm font-semibold">{customerName}</p><p className="text-[11px] opacity-80">{connected ? "Live chat" : "Connecting..."}</p></div></div>
        <Button variant="ghost" size="icon" className="text-white hover:bg-emerald-700" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3">
        {messages.length === 0 ? <p className="pt-16 text-center text-xs text-muted-foreground">Start a conversation about this delivery.</p> : messages.map((message) => (
          <div key={message.id} className={`flex ${message.sender_id === userId ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${message.sender_id === userId ? "bg-emerald-600 text-white" : "bg-white text-slate-900 shadow-sm"}`}>
              {isCustomer && message.sender_id !== userId && <p className="mb-1 text-[10px] font-semibold text-emerald-700">Delivery partner</p>}
              {message.content}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 border-t bg-white p-3">
        <Input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder="Type a message..." />
        <Button size="icon" onClick={() => void send()} disabled={!input.trim()}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
