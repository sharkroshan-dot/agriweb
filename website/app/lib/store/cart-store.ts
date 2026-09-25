import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CartItem {
	id: string;
	name: string;
	price: number;
	quantity: number;
	image?: string;
	variantId?: string;
	farmerName?: string;
	unit?: string;
	farmerId?: string;
	pickupAvailable?: boolean;
	farmAddress?: string;
	farmDistanceKm?: number;
	originalPrice?: number;
	minBulkQty?: number;
	bulkPrice?: number;
}

interface CartStore {
	items: CartItem[];
	addItem: (item: CartItem) => void;
	removeItem: (id: string, variantId?: string) => void;
	updateQuantity: (id: string, quantity: number, variantId?: string) => void;
	updateItem: (id: string, patch: Partial<CartItem>) => void;
	clearCart: () => void;
	getTotal: () => number;
	getItemCount: () => number;
}

export const useCartStore = create<CartStore>()(
	persist(
		(set, get) => ({
			items: [],
			addItem: (item) => {
				set((state) => {
					const existing = state.items.find((i) => i.id === item.id && i.variantId === item.variantId);
					if (existing) {
						return {
							items: state.items.map((i) =>
								i.id === item.id && i.variantId === item.variantId
									? { ...i, quantity: i.quantity + item.quantity }
									: i
							),
						};
					}
					return { items: [...state.items, item] };
				});
			},
			removeItem: (id, variantId) => set((state) => ({
				items: state.items.filter((i) => !(i.id === id && (variantId === undefined || i.variantId === variantId))),
			})),
			updateQuantity: (id, quantity) =>
				set((state) => ({
					items: state.items.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, quantity) } : i)),
				})),
			updateItem: (id, patch) =>
				set((state) => ({
					items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
				})),
			clearCart: () => set({ items: [] }),
			getTotal: () => {
				const { items } = get();
				return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
			},
			getItemCount: () => {
				const { items } = get();
				return items.reduce((sum, item) => sum + item.quantity, 0);
			},
		}),
		{
			name: "cart-storage",
		}
	)
);
