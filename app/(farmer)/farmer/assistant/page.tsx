"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mic, MicOff, Send, Loader2, Sparkles, Bot, Languages, Info } from "lucide-react";
import { api } from "../../../lib/api/client";
import { cn } from "../../../lib/utils";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem } from "../../../components/ui/select";
import { Badge } from "../../../components/ui/badge";
import toast from "react-hot-toast";

const LANGUAGES = [
  { value: "english", label: "English" },
  { value: "tamil", label: "தமிழ் (Tamil)" },
  { value: "hindi", label: "हिन्दी (Hindi)" },
];

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  intent?: string;
  action?: string;
}

export default function FarmerAssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      text: "Vanakkam! I'm your AgriConnect voice assistant. Ask me in English, தமிழ் or हिन्दी — for example “show my orders”, “how do I upload products?”, or just speak into the mic.",
    },
  ]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState("english");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(Boolean(SpeechRecognition));
  }, []);

  const chatMutation = useMutation({
    mutationFn: (payload: { message: string; language: string }) => api.post("/ai/chatbot", payload),
    onSuccess: (res: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          role: "assistant",
          text: res?.reply || "I didn't understand that. Could you try again?",
          intent: res?.intent,
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          role: "assistant",
          text: "Sorry, I couldn't reach the AI service right now. Please try again.",
        },
      ]);
    },
  });

  const voiceMutation = useMutation({
    mutationFn: (payload: { audioText: string; language: string; context: string }) =>
      api.post("/ai/voice-assistant", payload),
    onSuccess: (res: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          role: "assistant",
          text: res?.response || "Processing your request...",
          action: res?.action,
        },
      ]);
      if (res?.action === "add_product") {
        toast.success("Opening the product form for you");
        setTimeout(() => (window.location.href = "/farmer/products/new"), 1200);
      } else if (res?.action === "show_orders") {
        toast.success("Opening your orders");
        setTimeout(() => (window.location.href = "/farmer/orders"), 1200);
      } else if (res?.action === "go_dashboard") {
        toast.success("Taking you to your dashboard");
        setTimeout(() => (window.location.href = "/farmer/dashboard"), 1200);
      }
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          role: "assistant",
          text: "Voice assistant is unavailable. Try typing your question instead.",
        },
      ]);
    },
  });

  const sendText = (text?: string) => {
    const value = (text ?? input).trim();
    if (!value || chatMutation.isPending) return;
    setMessages((prev) => [...prev, { id: prev.length + 1, role: "user", text: value }]);
    setInput("");
    chatMutation.mutate({ message: value, language });
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice input is not supported in this browser. Use Chrome or Edge over HTTPS.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognition();
    recognitionRef.current = rec;
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = language === "tamil" ? "ta-IN" : language === "hindi" ? "hi-IN" : "en-IN";
    setListening(true);
    setTranscribing(true);
    rec.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      setTranscribing(false);
      setListening(false);
      if (transcript) {
        setMessages((prev) => [...prev, { id: prev.length + 1, role: "user", text: transcript }]);
        voiceMutation.mutate({ audioText: transcript, language, context: "general" });
      } else {
        toast.error("I didn't catch that. Please speak again or type instead.");
      }
    };
    rec.onerror = (event: any) => {
      setTranscribing(false);
      setListening(false);
      const code = event?.error;
      if (code === "not-allowed" || code === "service-not-allowed") {
        toast.error("Microphone access was blocked. Allow the mic in your browser and try again.");
      } else if (code === "no-speech") {
        toast.error("No speech detected. Please try again.");
      } else if (code === "audio-capture") {
        toast.error("No microphone found. Check your mic or type instead.");
      } else if (code === "network") {
        toast.error("Speech service offline. Please type your question instead.");
      } else {
        toast.error("Could not hear you. Please try again or type instead.");
      }
    };
    rec.onend = () => {
      setTranscribing(false);
      setListening(false);
    };
    try {
      rec.start();
    } catch (err: any) {
      setTranscribing(false);
      setListening(false);
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        toast.error("Microphone access was blocked. Allow the mic in your browser and try again.");
      } else {
        toast.error("Could not start the microphone. Please type your question instead.");
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Voice Assistant</h1>
          <p className="text-gray-500">
            Speak or type in your language — English, தமிழ், हिन्दी. Get orders, upload products, and more.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Languages className="h-4 w-4 text-gray-400" />
          <Select value={language} onValueChange={setLanguage} className="w-44">
            <SelectContent>
              {LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="success" className="gap-1">
          <Sparkles className="h-3 w-3" /> Multilingual
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Mic className="h-3 w-3" /> Voice + Text
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Bot className="h-3 w-3" /> AI powered
        </Badge>
      </div>

      {voiceSupported === false && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-medium">Voice input isn't available in this browser.</span> Open this page in{" "}
            <strong>Chrome or Edge over HTTPS</strong> to use the mic — or just type below for the same help.
          </p>
        </div>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div ref={scrollRef} className="h-[52vh] space-y-4 overflow-y-auto p-4">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "rounded-br-sm bg-emerald-600 text-white"
                      : "rounded-bl-sm border bg-white text-slate-800"
                  )}
                >
                  {msg.role === "assistant" && (
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                      <Bot className="h-3.5 w-3.5" /> AgriConnect AI{msg.intent ? ` · ${msg.intent.replace("_", " ")}` : ""}
                    </p>
                  )}
                  {msg.text}
                </div>
              </div>
            ))}
            {(chatMutation.isPending || voiceMutation.isPending || transcribing) && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border bg-white px-4 py-3 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                  {transcribing ? "Listening..." : "Thinking..."}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t p-3">
            <Button
              variant={listening ? "destructive" : "outline"}
              size="icon"
              onClick={startListening}
              className={cn("shrink-0", listening && "animate-pulse")}
              aria-label={listening ? "Stop listening" : "Start voice input"}
            >
              {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
              placeholder="Type your question here…"
              className="h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <Button onClick={() => sendText()} disabled={!input.trim() || chatMutation.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-dashed bg-slate-50/50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-700">Try asking:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {["Show my orders", "How do I upload products?", "Give me harvesting tips", "How do I get paid?", "அறுவடை குறிப்புகள் தரவா?", "मूल्य कैसे तय करें?"].map((q) => (
            <button
              key={q}
              onClick={() => sendText(q)}
              className="rounded-full border bg-white px-3 py-1 text-xs text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
