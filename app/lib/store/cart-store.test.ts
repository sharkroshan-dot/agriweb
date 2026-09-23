import { useCartStore } from "./cart-store";

describe("useCartStore", () => {
  beforeEach(() => {
    useCartStore.persist.clearStorage();
  });

  const item = {
    id: "p1",
    name: "Tomatoes",
    price: 35,
    quantity: 2,
    unit: "kg",
  };

  it("adds items and merges quantities for the same id", () => {
    const store = useCartStore.getState();
    store.addItem(item);
    store.addItem(item);
    expect(useCartStore.getState().getItemCount()).toBe(4);
  });

  it("removes items", () => {
    const store = useCartStore.getState();
    store.addItem(item);
    store.removeItem("p1");
    expect(useCartStore.getState().getItemCount()).toBe(0);
  });

  it("updates quantity without going below 1", () => {
    const store = useCartStore.getState();
    store.addItem(item);
    store.updateQuantity("p1", 1);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
    store.updateQuantity("p1", 0);
    expect(useCartStore.getState().items[0].quantity).toBe(1);
  });

  it("clears the whole cart (used on sign-out)", () => {
    const store = useCartStore.getState();
    store.addItem(item);
    store.addItem({ ...item, id: "p2" });
    store.clearCart();
    expect(useCartStore.getState().items).toHaveLength(0);
  });
});
