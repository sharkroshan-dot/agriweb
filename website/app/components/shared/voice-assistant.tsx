"use client";

import { useState, useRef, useEffect } from "react";
import {
  Mic,
  MicOff,
  Bot,
  X,
  Volume2,
  VolumeX,
  Send,
  Loader2,
} from "lucide-react";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";
import { CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import toast from "react-hot-toast";

interface VoiceMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  audioUrl?: string;
  intent?: string;
  data?: unknown;
}

interface VoiceAssistantState {
  isListening: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  messages: VoiceMessage[];
  transcript: string;
  volume: number;
}

const WELCOME_MESSAGES = [
  "Hello! I'm your AI Farm Assistant. How can I help you today?",
  "You can ask me about demand forecasts, pricing, delivery routes, or quality inspection.",
  "Try saying: 'What's the tomato demand forecast for this week?' or 'Show me the best price for my onions.'",
];

export function VoiceAssistant() {
  const [state, setState] = useState<VoiceAssistantState>({
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
    messages: [
      {
        id: "welcome",
        role: "assistant",
        content: WELCOME_MESSAGES.join(" "),
        timestamp: new Date(),
      },
    ],
    transcript: "",
    volume: 1,
  });
  const [isOpen, setIsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  useEffect(() => {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "en-IN";

      recognitionRef.current.onresult = (event) => {
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        setState((prev) => ({
          ...prev,
          transcript: finalTranscript || interimTranscript,
        }));

        if (finalTranscript) {
          handleVoiceCommand(finalTranscript.trim());
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error !== "no-speech") {
          toast.error(`Voice error: ${event.error}`);
        }
        setState((prev) => ({ ...prev, isListening: false }));
      };

      recognitionRef.current.onend = () => {
        setState((prev) => ({ ...prev, isListening: false }));
      };
    }

    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const addMessage = (
    role: VoiceMessage["role"],
    content: string,
    audioUrl?: string
  ) => {
    const newMessage: VoiceMessage = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
      audioUrl,
    };

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, newMessage],
    }));
  };

  const speak = async (text: string) => {
    if (!("speechSynthesis" in window)) return;

    setState((prev) => ({ ...prev, isSpeaking: true }));

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = state.volume;
    utterance.lang = "en-IN";

    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(
      (voice) =>
        voice.lang.includes("en") &&
        (voice.name.includes("Google") || voice.name.includes("Microsoft"))
    );

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onend = () => {
      setState((prev) => ({ ...prev, isSpeaking: false }));
    };

    utterance.onerror = () => {
      setState((prev) => ({ ...prev, isSpeaking: false }));
    };

    speechSynthesis.speak(utterance);
  };

  const productData = (data: unknown) => {
    if (!Array.isArray(data)) return [] as Array<Record<string, unknown>>;
    return data.filter((item): item is Record<string, unknown> => {
      if (!item || typeof item !== "object") return false;
      const p = item as Record<string, unknown>;
      return Boolean(p.name) && (p.price !== undefined || p._id !== undefined || p.id !== undefined);
    });
  };

  const handleVoiceCommand = async (command: string) => {
    if (!command.trim()) return;

    addMessage("user", command);
    setState((prev) => ({
      ...prev,
      isProcessing: true,
      transcript: "",
    }));

    try {
      // Use the real AI Farm Assistant endpoint for both typed and voice
      // questions. It retrieves live marketplace/order/wallet data through
      // DataAssistantService instead of relying on a UI-only command route.
      const response = await api.post("/ai/voice-assistant", {
        audioText: command,
        language: "english",
      });
      const reply =
        response?.response ||
        response?.reply ||
        response?.data?.response ||
        response?.data?.reply ||
        "I couldn't find enough information to answer that. Try asking about products, prices, delivery, traceability, AI features, or AgriConnect workflows.";
      const intent = response?.intent || response?.data?.intent;
      const data = response?.data ?? response?.products;

      addMessage("assistant", reply);
      // Attach structured results to the just-created assistant message so the
      // user can act on the answer instead of copying product names manually.
      setState((prev) => {
        const messages = [...prev.messages];
        const last = messages[messages.length - 1];
        if (last?.role === "assistant") {
          messages[messages.length - 1] = { ...last, intent, data };
        }
        return { ...prev, messages };
      });
      await speak(reply);
    } catch {
      const errorMsg =
        "Sorry, I couldn't process that request. Please try again.";

      addMessage("assistant", errorMsg);
      await speak(errorMsg);
      toast.error("Voice command failed");
    } finally {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }
  };

  const handleSendMessage = (message: string) => {
    if (!message.trim()) return;
    handleVoiceCommand(message.trim());
  };

  const toggleListening = () => {
    if (!recognitionRef.current) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }

    if (state.isListening) {
      recognitionRef.current.stop();
      setState((prev) => ({ ...prev, isListening: false }));
      return;
    }

    recognitionRef.current.start();
    setState((prev) => ({ ...prev, isListening: true }));
  };

  const toggleVolume = () => {
    setState((prev) => ({
      ...prev,
      volume: prev.volume > 0 ? 0 : 1,
    }));
  };

  const quickCommands = [
    "What's the tomato demand forecast?",
    "Best price for onions this week",
    "Optimize my delivery route",
    "Check quality of my harvest",
    "Show my earnings summary",
    "Any high-risk deliveries today?",
  ];

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-emerald-600 shadow-xl hover:bg-emerald-700"
        aria-label="Open Voice Assistant"
        title="Open AI Farm Assistant"
      >
        <Bot
          className="h-7 w-7 shrink-0 text-white"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[500px] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-slide-up lg:h-[600px]">
      <CardHeader className="flex items-center justify-between rounded-t-2xl border-b bg-gradient-to-r from-emerald-600 to-emerald-700 p-4 text-white">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="font-semibold">AI Farm Assistant</span>
          <Badge variant="secondary" className="bg-white/20 text-white">
            Voice Enabled
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={toggleVolume}
            aria-label={state.volume > 0 ? "Mute assistant voice" : "Unmute assistant voice"}
            title={state.volume > 0 ? "Mute assistant voice" : "Unmute assistant voice"}
          >
            {state.volume > 0 ? (
              <Volume2 className="h-4 w-4 shrink-0 text-white" stroke="currentColor" strokeWidth={2} aria-hidden="true" />
            ) : (
              <VolumeX className="h-4 w-4 shrink-0 text-white" stroke="currentColor" strokeWidth={2} aria-hidden="true" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={() => setIsOpen(false)}
            aria-label="Close AI Farm Assistant"
            title="Close assistant"
          >
            <X className="h-4 w-4 shrink-0 text-white" stroke="currentColor" strokeWidth={2.5} aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <ScrollArea className="flex-1 space-y-3 p-4">
        {state.messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex gap-3 animate-fade-in",
              message.role === "user" && "flex-row-reverse"
            )}
          >
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium",
                message.role === "user"
                  ? "bg-emerald-100 text-emerald-700"
                  : message.role === "assistant"
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              {message.role === "user"
                ? "U"
                : message.role === "assistant"
                ? "AI"
                : "S"}
            </div>

            <div
              className={cn(
                "max-w-[75%] rounded-2xl px-4 py-2 text-sm",
                message.role === "user"
                  ? "rounded-br-none bg-emerald-600 text-white"
                  : message.role === "assistant"
                  ? "rounded-bl-none bg-gray-100 text-gray-900"
                  : "rounded-bl-none border border-amber-200 bg-amber-50 text-amber-800"
              )}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <p
                className={cn(
                  "mt-1 text-xs opacity-70",
                  message.role === "user"
                    ? "text-emerald-100"
                    : "text-gray-500"
                )}
              >
                {message.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>

              {productData(message.data).length > 0 && (
                <div className="mt-3 space-y-2">
                  {productData(message.data).slice(0, 5).map((product) => {
                    const id = String(product._id ?? product.id ?? "");
                    const name = String(product.name ?? "Product");
                    const price = product.price !== undefined ? String(product.price) : "";
                    const unit = String(product.unit ?? "kg");
                    const farm = String(product.farmerName ?? product.farmName ?? "Local Farmer");
                    if (!id) return null;
                    return (
                      <div key={id} className="rounded-xl border border-emerald-100 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                            <p className="text-xs text-slate-500">{farm}</p>
                            <p className="mt-1 text-sm font-bold text-emerald-700">₹{price}/{unit}</p>
                          </div>
                          <a
                            href={`/product/${id}`}
                            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                          >
                            View & Buy
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {message.audioUrl && (
                <audio
                  controls
                  src={message.audioUrl}
                  className="mt-2 w-full"
                />
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </ScrollArea>

      {state.isProcessing && (
        <div className="flex items-center gap-2 border-t px-4 py-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 text-emerald-600 animate-spin" aria-hidden="true" />
          AI is thinking...
        </div>
      )}

      <div className="space-y-3 border-t p-4">
        <div className="flex flex-wrap gap-2">
          {quickCommands.map((cmd) => (
            <Button
              key={cmd}
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => handleSendMessage(cmd)}
              disabled={state.isProcessing}
            >
              {cmd}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={toggleListening}
            disabled={state.isProcessing}
            variant={state.isListening ? "destructive" : "default"}
            size="lg"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full p-0"
            aria-label={
              state.isListening
                ? "Stop voice recording"
                : "Start voice recording"
            }
            title={
              state.isListening
                ? "Stop voice recording"
                : "Speak your question"
            }
          >
            {state.isListening ? (
              <MicOff
                className="h-6 w-6 shrink-0 text-white"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            ) : (
              <Mic
                className="h-6 w-6 shrink-0 text-white"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            )}
          </Button>

          <div className="relative flex-1">
            <input
              type="text"
              value={state.transcript}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  transcript: e.target.value,
                }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSendMessage(e.currentTarget.value);
                }
              }}
              placeholder={
                state.isListening
                  ? "Listening..."
                  : "Type or speak your command..."
              }
              className="h-12 w-full rounded-full border border-gray-300 px-4 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              disabled={state.isProcessing}
              aria-label="Ask the AI Farm Assistant"
            />

            {state.transcript && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() =>
                  setState((prev) => ({ ...prev, transcript: "" }))
                }
                aria-label="Clear question"
                title="Clear question"
              >
                <X className="h-4 w-4 shrink-0" stroke="currentColor" aria-hidden="true" />
              </Button>
            )}
          </div>

          <Button
            onClick={() => handleSendMessage(state.transcript)}
            disabled={!state.transcript.trim() || state.isProcessing}
            size="lg"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 p-0 text-white hover:bg-emerald-700 disabled:bg-emerald-300 disabled:text-white"
            aria-label="Send question"
            title="Send question"
          >
            {state.isProcessing ? (
              <Loader2
                className="h-5 w-5 shrink-0 animate-spin text-white"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            ) : (
              <Send
                className="h-5 w-5 shrink-0 text-white"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              />
            )}
          </Button>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            {state.isListening && (
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            )}
            {state.isListening ? "Listening" : "Ready"}
          </span>

          <span className="flex items-center gap-1">
            {state.isSpeaking && (
              <Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" />
            )}
            {state.isSpeaking ? "Speaking" : "Silent"}
          </span>

          <span className="flex items-center gap-1">
            {state.isProcessing && (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            )}
            {state.isProcessing ? "Processing" : "Idle"}
          </span>
        </div>
      </div>
    </div>
  );
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}