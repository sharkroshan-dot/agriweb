"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { api } from "../../lib/api/client";

export function AppPresence() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;

    let stopped = false;

    const send = async (active: boolean) => {
      if (stopped && active) return;
      try {
        await api.post("/chat/presence/heartbeat", {
          name: session.user.name || session.user.email || "",
          role: session.user.role || "",
          active,
        });
      } catch {
        // Presence is non-blocking; authorization remains server-side.
      }
    };

    void send(true);
    const interval = window.setInterval(() => void send(true), 30000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void send(true);
      // Hidden tabs are not immediately offline: mobile/browser backgrounding
      // can temporarily suspend timers. The server TTL decides when presence expires.
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      void send(false);
    };
  }, [status, session?.user?.id, session?.user?.name, session?.user?.email, session?.user?.role]);

  return null;
}
