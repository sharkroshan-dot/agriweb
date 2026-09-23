import { create } from "zustand";

interface StockInfo {
  product_id: string;
  total_stock: number;
  reserved_stock: number;
  sold_stock: number;
  available_stock: number;
  unit: string;
  is_out_of_stock: boolean;
}

interface InventoryStore {
  stockByProduct: Record<string, StockInfo>;
  wsConnections: Record<string, WebSocket | null>;

  setStock: (productId: string, stock: StockInfo) => void;
  connectProductStock: (productId: string) => () => void;
  disconnectProduct: (productId: string) => void;
}

export const useInventoryStore = create<InventoryStore>((set, get) => ({
  stockByProduct: {},
  wsConnections: {},

  setStock: (productId, stock) =>
    set((state) => ({
      stockByProduct: { ...state.stockByProduct, [productId]: stock },
    })),

  connectProductStock: (productId: string) => {
    const existing = get().wsConnections[productId];
    if (existing) return () => {};

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host =
      window.location.hostname === "localhost"
        ? "localhost:8000"
        : window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/inventory/ws/stock/${productId}`;

    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "stock_update" && msg.data) {
          set((state) => ({
            stockByProduct: {
              ...state.stockByProduct,
              [productId]: msg.data,
            },
          }));
        }
      } catch {}
    };

    ws.onerror = () => {};

    set((state) => ({
      wsConnections: { ...state.wsConnections, [productId]: ws },
    }));

    return () => {
      ws.close();
      set((state) => {
        const next = { ...state.wsConnections };
        delete next[productId];
        return { wsConnections: next };
      });
    };
  },

  disconnectProduct: (productId: string) => {
    const ws = get().wsConnections[productId];
    if (ws) {
      ws.close();
      set((state) => {
        const next = { ...state.wsConnections };
        delete next[productId];
        return { wsConnections: next };
      });
    }
  },
}));
