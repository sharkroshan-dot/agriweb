"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Bot, X, Settings, Volume2, VolumeX, Send, Loader2 } from "lucide-react";
import { api } from "../../lib/api/client";
import { cn } from "../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  useEffect(() => {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
        if (state.isListening) {
          recognitionRef.current?.start();
        }
      };
    }

    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const addMessage = (role: VoiceMessage["role"], content: string, audioUrl?: string) => {
    const newMessage: VoiceMessage = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
      audioUrl,
    };
    setState((prev) => ({ ...prev, messages: [...prev.messages, newMessage] }));
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
      (v) => v.lang.includes("en") && (v.name.includes("Google") || v.name.includes("Microsoft"))
    );
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onend = () => {
      setState((prev) => ({ ...prev, isSpeaking: false }));
    };

    utterance.onerror = () => {
      setState((prev) => ({ ...prev, isSpeaking: false }));
    };

    speechSynthesis.speak(utterance);
  };

  const handleVoiceCommand = async (command: string) => {
    if (!command.trim()) return;

    addMessage("user", command);
    setState((prev) => ({ ...prev, isProcessing: true, transcript: "" }));

    try {
      const response = await api.post("/ai/voice/process", { command });
      const reply = response.response || "I'm not sure how to help with that.";
      
      addMessage("assistant", reply);
      await speak(reply);
    } catch (error) {
      const errorMsg = "Sorry, I couldn't process that request. Please try again.";
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
    } else {
      recognitionRef.current.start();
      setState((prev) => ({ ...prev, isListening: true }));
    }
  };

  const toggleVolume = () => {
    setState((prev) => ({ ...prev, volume: prev.volume > 0 ? 0 : 1 }));
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
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-xl bg-emerald-600 hover:bg-emerald-700"
        aria-label="Open Voice Assistant"
      >
        <Bot className="h-7 w-7 text-white" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-md h-[500px] lg:h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-slide-up">
      <CardHeader className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
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
            aria-label={state.volume > 0 ? "Mute" : "Unmute"}
          >
            {state.volume > 0 ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10"
            onClick={() => setIsOpen(false)}
            aria-label="Close AI Farm Assistant"
            title="Close assistant"
          >
            <X className="h-4 w-4 text-white" strokeWidth={2.5} />
          </Button>
        </div>
      </CardHeader>

      <ScrollArea className="flex-1 p-4 space-y-3">
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
                "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                message.role === "user"
                  ? "bg-emerald-100 text-emerald-700"
                  : message.role === "assistant"
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-100 text-gray-500"
              )}
            >
              {message.role === "user" ? "U" : message.role === "assistant" ? "AI" : "S"}
            </div>
            <div
              className={cn(
                "max-w-[75%] px-4 py-2 rounded-2xl text-sm",
                message.role === "user"
                  ? "bg-emerald-600 text-white rounded-br-none"
                  : message.role === "assistant"
                  ? "bg-gray-100 text-gray-900 rounded-bl-none"
                  : "bg-amber-50 text-amber-800 border border-amber-200"
              )}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              <p className={cn("text-xs mt-1 opacity-70", message.role === "user" ? "text-emerald-100" : "text-gray-500")}>
                {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              {message.audioUrl && (
                <audio controls src={message.audioUrl} className="mt-2 w-full" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </ScrollArea>

      {state.isProcessing && (
        <div className="px-4 py-2 flex items-center gap-2 text-sm text-gray-500 border-t">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
          AI is thinking...
        </div>
      )}

      <div className="p-4 border-t space-y-3">
        <div className="flex gap-2 flex-wrap">
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
            className="h-12 w-12 rounded-full flex-shrink-0"
            aria-label={state.isListening ? "Stop listening" : "Start voice input"}
            title={state.isListening ? "Stop listening" : "Speak your question"}
          >
            {state.isListening ? (
              <MicOff className="h-6 w-6 text-white" strokeWidth={2.5} />
            ) : (
              <Mic className="h-6 w-6 text-white" strokeWidth={2.5} />
            )}
          </Button>
          <div className="flex-1 relative">
            <input
              type="text"
              value={state.transcript}
              onChange={(e) => setState((prev) => ({ ...prev, transcript: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage(e.currentTarget.value)}
              placeholder={state.isListening ? "Listening..." : "Type or speak your command..."}
              className="w-full h-12 px-4 py-2 pl-12 rounded-full border border-gray-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-sm"
              disabled={state.isProcessing}
            />
            {state.transcript && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setState((prev) => ({ ...prev, transcript: "" }))}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button
            onClick={() => handleSendMessage(state.transcript)}
            disabled={!state.transcript.trim() || state.isProcessing}
            size="lg"
            className="h-12 w-12 rounded-full flex-shrink-0"
            aria-label="Send message"
            title="Send message"
          >
            {state.isProcessing ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : (
              <Send className="h-5 w-5 text-white" strokeWidth={2.5} />
            )}
          </Button>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            {state.isListening && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            {state.isListening ? "Listening" : "Ready"}
          </span>
          <span className="flex items-center gap-1">
            {state.isSpeaking && <Volume2 className="h-3 w-3 animate-pulse" />}
            {state.isSpeaking ? "Speaking" : "Silent"}
          </span>
          <span className="flex items-center gap-1">
            {state.isProcessing && <Loader2 className="h-3 w-3 animate-spin" />}
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