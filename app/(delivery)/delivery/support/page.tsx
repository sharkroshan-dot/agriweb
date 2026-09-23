"use client";

import React, { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Send, Plus, Loader2, LifeBuoy } from "lucide-react";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { api } from "../../../lib/api/client";
import toast from "react-hot-toast";

export default function DeliverySupportPage() {
  const { data: session } = useSession();
  const accessToken = (session as any)?.accessToken as string | undefined;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: conversations, refetch: refetchConvos } = useQuery({
    queryKey: ["deliverySupportConversations"],
    queryFn: () => api.get("/delivery/support/conversations"),
    enabled: Boolean(accessToken),
  });

  const convos: any[] = conversations?.data || [];

  useEffect(() => {
    if (!conversationId && convos.length > 0) {
      setConversationId(convos[0].id);
    }
  }, [convos, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    api.get(`/delivery/support/conversations/${conversationId}`)
      .then((res) => setMessages(res?.data?.messages || []))
      .catch(() => setMessages([]));
  }, [conversationId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openNew = async () => {
    const subject = newSubject.trim();
    if (!subject) {
      toast.error("Please describe your issue");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post("/delivery/support/conversations", { subject, initialMessage: subject });
      setConversationId(res?.data?.id || null);
      setNewSubject("");
      refetchConvos();
      toast.success("Support request created");
    } catch (err: any) {
      toast.error(err?.message || "Failed to create request");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    try {
      let cid = conversationId;
      if (!cid) {
        const res = await api.post("/delivery/support/conversations", { subject: text, initialMessage: text });
        cid = res?.data?.id || null;
        setConversationId(cid);
        refetchConvos();
      }
      await api.post(`/delivery/support/conversations/${cid}/messages`, { conversationId: cid, content: text });
      setMessages((m) => [...m, { senderRole: "delivery", content: text, createdAt: new Date().toISOString() }]);
    } catch (err: any) {
      toast.error(err?.message || "Failed to send");
      setDraft(text);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div>
        <p className="text-sm font-medium text-primary">Assistance</p>
        <h1 className="text-3xl font-semibold tracking-tight">Help & Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">Chat with dispatch about deliveries and issues.</p>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Open a new support request..."
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") openNew(); }}
          />
          <Button onClick={openNew} disabled={busy || !newSubject.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Open
          </Button>
        </div>

        {convos.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {convos.map((c) => (
              <button
                key={c.id}
                onClick={() => setConversationId(c.id)}
                className={`rounded-full border px-3 py-1 text-xs ${conversationId === c.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {c.subject || "Support"}
              </button>
            ))}
          </div>
        )}
      </div>

      <Card className="mt-4 flex-1">
        <CardContent className="flex h-full flex-col p-0">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <LifeBuoy className="h-12 w-12 text-primary/40" />
                <p className="mt-3 text-sm font-medium">Connect with dispatch</p>
                <p className="text-sm text-muted-foreground">Send a message to get help.</p>
              </div>
            ) : (
              messages.map((m, i) => {
                const isMe = m.senderRole === "delivery";
                return (
                  <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${isMe ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                      <p>{m.content}</p>
                      {m.createdAt && (
                        <p className={`mt-1 text-[10px] ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {new Date(m.createdAt).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={endRef} />
          </div>
          <div className="border-t p-3">
            <div className="flex gap-2">
              <Input
                placeholder="Type a message..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              />
              <Button onClick={send} disabled={!draft.trim()}><Send className="mr-2 h-4 w-4" />Send</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}