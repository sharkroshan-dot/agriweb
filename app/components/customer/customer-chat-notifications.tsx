"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { api } from "../../lib/api/client";

export function CustomerChatNotifications() {
  const { data: session, status } = useSession();
  const userId = String((session?.user as any)?.id || "");

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    let cancelled = false;
    const sockets: WebSocket[] = [];

    const notify = async (orderId: string, message: any) => {
      if (message.sender_id === userId || cancelled || typeof window === "undefined") return;
      const unreadKey = `agri-chat-unread-${orderId}`;
      const unread = Number(window.localStorage.getItem(unreadKey) || 0) + 1;
      window.localStorage.setItem(unreadKey, String(unread));
      window.dispatchEvent(new CustomEvent("agri-chat-unread", { detail: orderId }));
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch { return; }
      }
      if (Notification.permission !== "granted") return;
      const notification = new Notification("New delivery message", {
        body: `${message.sender_name || "Delivery partner"}: ${message.content}`,
        tag: `delivery-chat-${orderId}`,
      });
      notification.onclick = () => {
        window.focus();
        window.location.href = `/orders/${orderId}`;
      };
    };

    const connect = async () => {
      try {
        const response: any = await api.get("/orders", { params: { limit: 100 } });
        const orders = response?.data?.orders || response?.orders || [];
        const activeOrders = orders.filter((order: any) => !["delivered", "cancelled"].includes(String(order.status || order.orderStatus || "").toLowerCase()));
        const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
        let websocketBase = window.location.origin;
        if (configuredApiUrl) {
          try { websocketBase = new URL(configuredApiUrl, window.location.origin).origin; } catch { /* use current origin */ }
        }
        const websocketUrl = websocketBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

        activeOrders.forEach((order: any) => {
          if (cancelled) return;
          const orderId = String(order.id || order._id || "");
          if (!orderId) return;
          const conversationId = `delivery-chat-${orderId}`;
          const accessToken = (session?.user as any)?.accessToken || (session as any)?.accessToken || "";
          const tokenParam = accessToken ? `&token=${encodeURIComponent(accessToken)}` : "";
          const socket = new WebSocket(`${websocketUrl}/api/v1/chat/ws/${conversationId}?user_id=${encodeURIComponent(userId)}&user_name=${encodeURIComponent((session?.user as any)?.name || "Customer")}${tokenParam}`);
          socket.onmessage = (event) => {
            try {
              const payload = JSON.parse(event.data);
              if (payload.type === "new_message" || payload.type === "message_sent") void notify(orderId, payload.data);
            } catch { /* ignore malformed messages */ }
          };
          sockets.push(socket);
        });
      } catch { /* chat notifications are optional */ }
    };

    void connect();
    return () => {
      cancelled = true;
      sockets.forEach((socket) => socket.close());
    };
  }, [status, userId, session]);

  return null;
}
