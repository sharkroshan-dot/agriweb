"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, RefreshCw, Users, Info } from "lucide-react";
import { api } from "../../../lib/api/client";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

type Message = { id: string; senderId: string | null; senderName: string; messageType: string; content: string; createdAt: string; isMine?: boolean; };
export default function CooperativeChat({ cooperativeId, cooperativeName, memberCount, currentUserId }: { cooperativeId: string; cooperativeName: string; memberCount: number; currentUserId?: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryKey = ["cooperativeMessages", cooperativeId];
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: () => api.get(`/cooperatives/${cooperativeId}/messages?limit=60`),
    enabled: Boolean(cooperativeId),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const messages: Message[] = data?.data?.messages || [];
  const send = useMutation({
    mutationFn: (content: string) => api.post(`/cooperatives/${cooperativeId}/messages`, { content }),
    onSuccess: () => { setDraft(""); qc.invalidateQueries({ queryKey }); },
    onError: (error: any) => toast.error(error?.message || "Message could not be sent"),
  });
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length]);
  const grouped = useMemo(() => messages, [messages]);
  const submit = () => { const content = draft.trim(); if (content && !send.isPending) send.mutate(content); };
  return <Card className="coop-chat-card overflow-hidden rounded-2xl border-slate-200 shadow-sm">
    <CardHeader className="border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><Users className="h-5 w-5"/></div>
          <div><CardTitle className="text-base font-semibold tracking-tight text-slate-900">{cooperativeName}</CardTitle><CardDescription className="mt-1 flex items-center gap-2"><span>{memberCount} active members</span><span>·</span><Badge variant="outline" className="text-emerald-700">Private group</Badge></CardDescription></div>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`}/>Refresh</Button>
      </div>
    </CardHeader>
    <CardContent className="bg-slate-50 p-0">
      <div className="flex items-start gap-2 border-b border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600"><Info className="mt-0.5 h-4 w-4 shrink-0"/>Messages are visible only to active members of this cooperative. Operational events are labelled as AgriConnect updates.</div>
      <div className="h-[min(64vh,680px)] min-h-[360px] space-y-4 overflow-y-auto px-3 py-4 sm:px-5">
        {isLoading ? <div className="py-12 text-center text-sm text-slate-500">Loading cooperative conversation…</div> : isError ? <div className="py-12 text-center"><p className="text-sm text-slate-600">Could not load group messages.</p><Button className="mt-3" size="sm" variant="outline" onClick={() => refetch()}>Try again</Button></div> : grouped.length === 0 ? <div className="mx-auto mt-12 max-w-sm rounded-2xl border border-dashed bg-white p-6 text-center"><MessageCircle className="mx-auto h-8 w-8 text-emerald-600"/><p className="mt-3 font-semibold text-slate-800">Start your cooperative conversation</p><p className="mt-1 text-sm text-slate-500">Share harvest updates, discuss orders and coordinate collections with your members.</p></div> : grouped.map((message) => {
          const system = message.messageType === "system";
          const mine = Boolean(message.isMine) || Boolean(currentUserId && message.senderId === currentUserId);
          const time = message.createdAt ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
          if (system) return <div key={message.id} className="mx-auto max-w-[90%] rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">AgriConnect update</p><p className="mt-1 text-sm text-amber-950">{message.content}</p><p className="mt-1 text-[10px] text-amber-700">{time}</p></div>;
          return <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 shadow-sm sm:max-w-[76%] ${mine ? "rounded-br-md bg-[#d9fdd3]" : "rounded-bl-md border bg-white"}`}><p className={`mb-1 text-xs font-semibold ${mine ? "text-emerald-800" : "text-sky-700"}`}>{mine ? "You" : message.senderName}</p><p className="whitespace-pre-wrap break-words text-sm text-slate-800">{message.content}</p><p className="mt-1 text-right text-[10px] text-slate-500">{time}</p></div></div>;
        })}
        <div ref={bottomRef}/>
      </div>
      <div className="border-t border-slate-200 bg-white p-3 sm:p-4">
        <div className="flex items-end gap-2">
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Message your cooperative…" maxLength={4000} className="h-11 flex-1 rounded-xl border-slate-300 bg-slate-50 px-4"/>
          <Button onClick={submit} disabled={!draft.trim() || send.isPending} className="h-11 w-11 shrink-0 rounded-xl bg-emerald-700 p-0 hover:bg-emerald-800" aria-label="Send message">{send.isPending ? <RefreshCw className="h-4 w-4 animate-spin"/> : <Send className="h-4 w-4"/>}</Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Enter to send · Shift + Enter for a new line · Messages refresh automatically</p>
      </div>
    </CardContent>
  </Card>;
}
