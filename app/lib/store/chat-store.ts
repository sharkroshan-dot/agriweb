import { create } from "zustand";

interface Message {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

interface Participant {
  id: string;
  name: string;
  role: string;
}

interface Conversation {
  id: string;
  participants: Participant[];
  subject: string;
  last_message: { content: string; sender_name: string; created_at: string } | null;
  unread_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ChatStore {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeConversationId: string | null;
  ws: WebSocket | null;
  isConnected: boolean;
  loading: boolean;

  setConversations: (convs: Conversation[]) => void;
  setMessages: (convId: string, msgs: Message[]) => void;
  addMessage: (convId: string, msg: Message) => void;
  setActiveConversation: (id: string | null) => void;
  connectWebSocket: (conversationId: string, userId?: string, userName?: string, token?: string) => void;
  disconnectWebSocket: () => void;
  sendMessage: (content: string) => void;
  fetchConversations: () => Promise<void>;
  fetchMessages: (convId: string) => Promise<void>;
  markConversationRead: (convId: string) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  conversations: [],
  messages: {},
  activeConversationId: null,
  ws: null,
  isConnected: false,
  loading: false,

  setConversations: (conversations) => set({ conversations }),

  setMessages: (convId, msgs) =>
    set((state) => ({ messages: { ...state.messages, [convId]: msgs } })),

  addMessage: (convId, msg) =>
    set((state) => {
      const existing = state.messages[convId] || [];
      if (existing.some((m) => m.id === msg.id)) return state;
      const updated = { ...state.messages, [convId]: [...existing, msg] };
      const convs = state.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              last_message: { content: msg.content, sender_name: msg.sender_name, created_at: msg.created_at },
              updated_at: msg.created_at,
            }
          : c
      );
      return { messages: updated, conversations: convs };
    }),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  connectWebSocket: (conversationId, userId = "user-1", userName = "You", token = "") => {
    const existing = get().ws;
    if (existing) existing.close();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname === "localhost" ? "localhost:8000" : window.location.host;
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : "";
    const wsUrl = `${protocol}//${host}/api/v1/chat/ws/${conversationId}?user_id=${userId}&user_name=${encodeURIComponent(userName)}${tokenParam}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => set({ isConnected: true });
    ws.onclose = () => set({ isConnected: false, ws: null });
    ws.onerror = () => set({ isConnected: false });
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "new_message" || payload.type === "message_sent") {
          get().addMessage(payload.conversation_id, payload.data);
        }
      } catch { /* ignore */ }
    };

    set({ ws });
  },

  disconnectWebSocket: () => {
    const ws = get().ws;
    if (ws) ws.close();
    set({ ws: null, isConnected: false });
  },

  sendMessage: (content) => {
    const ws = get().ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ content }));
    }
  },

  fetchConversations: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/v1/chat/conversations");
      const json = await res.json();
      if (json.status === "success") set({ conversations: json.data });
    } catch { /* ignore */ }
    set({ loading: false });
  },

  fetchMessages: async (convId) => {
    try {
      const res = await fetch(`/api/v1/chat/conversations/${convId}/messages`);
      const json = await res.json();
      if (json.status === "success") set((state) => ({ messages: { ...state.messages, [convId]: json.data } }));
    } catch { /* ignore */ }
  },

  markConversationRead: (convId) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === convId ? { ...c, unread_count: 0 } : c
      ),
    }));
  },
}));
