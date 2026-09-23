"use client";

import { useEffect, useRef, useState } from "react";
import { Send, MessageCircle, Plus, Users, Search, Bell } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { useChatStore } from "../../lib/store/chat-store";
import { formatDate, formatTime } from "../../lib/utils";

const userColors: Record<string, string> = {
  farmer: "border-green-200 bg-green-50 text-green-700",
  customer: "border-blue-200 bg-blue-50 text-blue-700",
  delivery: "border-purple-200 bg-purple-50 text-purple-700",
  admin: "border-red-200 bg-red-50 text-red-700",
};

export default function ChatPage() {
  const {
    conversations,
    messages,
    activeConversationId,
    isConnected,
    loading,
    fetchConversations,
    fetchMessages,
    setActiveConversation,
    connectWebSocket,
    disconnectWebSocket,
    sendMessage,
    addMessage,
    markConversationRead,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredConversations = conversations.filter((c) =>
    c.subject.toLowerCase().includes(search.toLowerCase()) ||
    c.participants.some((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  );

  const activeMessages = activeConversationId ? messages[activeConversationId] || [] : [];
  const activeConv = conversations.find((c) => c.id === activeConversationId);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
      connectWebSocket(activeConversationId);
      markConversationRead(activeConversationId);
      return () => disconnectWebSocket();
    }
  }, [activeConversationId, fetchMessages, connectWebSocket, disconnectWebSocket, markConversationRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages]);

  const handleSend = () => {
    const content = input.trim();
    if (!content || !activeConversationId) return;
    sendMessage(content);
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getOtherParticipant = (conv: typeof conversations[0]) => {
    return conv.participants.find((p) => p.role !== "customer") || conv.participants[0];
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] p-0">
      {/* Conversations sidebar */}
      <div className="flex w-80 flex-col border-r bg-white">
        <div className="border-b p-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-emerald-600" /> Messages
            </h1>
            <div className="flex items-center gap-1">
              <Badge className={isConnected ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}>
                {isConnected ? "Live" : "Offline"}
              </Badge>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">Loading...</div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <MessageCircle className="h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No conversations</p>
              <p className="text-xs text-muted-foreground">Start a chat with a farmer or delivery partner</p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const other = getOtherParticipant(conv);
              return (
                <button
                  key={conv.id}
                  onClick={() => setActiveConversation(conv.id)}
                  className={`w-full border-b p-4 text-left transition hover:bg-slate-50 ${
                    activeConversationId === conv.id ? "bg-emerald-50" : ""
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 truncate">{other.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full border ${userColors[other.role] || ""}`}>
                          {other.role}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground truncate">{conv.subject}</p>
                      {conv.last_message && (
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">
                          {conv.last_message.sender_name}: {conv.last_message.content}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-2">
                      {conv.last_message && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {formatTime(conv.last_message.created_at)}
                        </span>
                      )}
                      {conv.unread_count > 0 && (
                        <Badge className="border-emerald-200 bg-emerald-500 text-white text-[10px] px-1.5 py-0">
                          {conv.unread_count}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col bg-slate-50">
        {!activeConversationId ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageCircle className="mx-auto h-12 w-12 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900">Your Messages</h2>
              <p className="mt-1 text-sm text-muted-foreground">Select a conversation to start chatting</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between border-b bg-white p-4">
              <div>
                {activeConv && (() => {
                  const other = getOtherParticipant(activeConv);
                  return (
                    <>
                      <h2 className="font-semibold text-slate-900">{other.name}</h2>
                      <p className="text-xs text-muted-foreground">{activeConv.subject}</p>
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon"><Bell className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon"><Users className="h-4 w-4" /></Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {activeMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No messages yet. Start a conversation!
                </div>
              ) : (
                activeMessages.map((msg) => {
                  const isMine = msg.sender_id === "user-1";
                  return (
                    <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                          isMine
                            ? "bg-emerald-600 text-white rounded-br-md"
                            : "bg-white border border-slate-200 text-slate-900 rounded-bl-md"
                        }`}
                      >
                        {!isMine && (
                          <p className="text-xs font-medium text-emerald-600 mb-0.5">{msg.sender_name}</p>
                        )}
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        <p className={`text-[10px] mt-1 ${isMine ? "text-emerald-200" : "text-muted-foreground"} text-right`}>
                          {formatTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="border-t bg-white p-4">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="flex-shrink-0">
                  <Plus className="h-5 w-5 text-muted-foreground" />
                </Button>
                <Input
                  ref={inputRef}
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 rounded-full border-slate-200 bg-slate-50"
                />
                <Button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="flex-shrink-0 rounded-full"
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
