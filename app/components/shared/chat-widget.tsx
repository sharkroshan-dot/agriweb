"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Bot, Send, X, Loader2, Mic, Square } from "lucide-react";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
};

const getSpeechRecognition = (): (new () => SpeechRecognitionLike) | null => {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

interface Message {
  role: "user" | "bot";
  text: string;
}

const SUGGESTIONS =
  typeof window !== "undefined" && window.location.hostname
    ? [
        "Find vegetables below ₹500",
        "How do I add a product?",
        "What payment methods are supported?",
        "How does delivery work?",
      ]
    : [
        "Find vegetables below ₹500",
        "How do I add a product?",
        "What payment methods are supported?",
        "How does delivery work?",
      ];

export default function ChatWidget() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechRecognitionCtor = useRef(getSpeechRecognition());

  useEffect(() => {
    if (!open) return;
    if (messages.length === 0) {
      setMessages([
        {
          role: "bot",
          text: "Hi! I'm your AI assistant. Ask me about products, pricing, payments, or how to use the platform. I only use live data from the marketplace.",
        },
      ]);
    }
  }, [open, messages.length]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;
    if (status !== "authenticated") {
      setMessages((m) => [...m, { role: "user", text }, { role: "bot", text: "Please sign in first to use the AI assistant." }]);
      setInput("");
      return;
    }
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);
    try {
      const res: any = await api.post("/ai/chatbot", { message: text, language: "english" });
      setMessages((m) => [...m, { role: "bot", text: res?.reply || "Sorry, I couldn't process that." }]);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "Sorry, something went wrong. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const toggleMic = () => {
    const Ctor = speechRecognitionCtor.current;
    if (!Ctor) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript;
      if (transcript) {
        setInput(transcript);
        void send(transcript);
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
      {open && (
        <div className="mb-3 flex h-[28rem] w-[22rem] flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <div>
                <p className="text-sm font-semibold">AI Assistant</p>
                <p className="text-[11px] text-emerald-100">AgriConnect AI</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close assistant">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-sm",
                  msg.role === "user"
                    ? "ml-auto bg-emerald-600 text-white"
                    : "bg-white text-slate-800 shadow-sm"
                )}
              >
                {msg.text}
              </div>
            ))}
            {loading && (
              <div className="flex w-10 items-center justify-center rounded-xl bg-white py-2 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 border-t bg-white px-3 py-2">
              {SUGGESTIONS.slice(0, 4).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                    setMessages((m) => [...m, { role: "user", text: s }]);
                    setLoading(true);
                    void api
                      .post("/ai/chatbot", { message: s, language: "english" })
                      .then((res: any) =>
                        setMessages((m) => [...m, { role: "bot", text: res?.reply || "No reply." }])
                      )
                      .catch(() =>
                        setMessages((m) => [...m, { role: "bot", text: "Sorry, something went wrong." }])
                      )
                      .finally(() => setLoading(false));
                  }}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700 transition hover:bg-emerald-100"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 border-t bg-white p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask anything…"
              className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={toggleMic}
              disabled={!speechRecognitionCtor.current || loading}
              aria-label={listening ? "Stop listening" : "Speak your question"}
              title={speechRecognitionCtor.current ? "Tap and speak" : "Voice input not supported in this browser"}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg transition disabled:opacity-40",
                listening
                  ? "animate-pulse bg-red-500 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle AI assistant"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white shadow-lg transition hover:scale-105"
      >
        <Bot className="h-6 w-6" />
      </button>
    </div>
  );
}
