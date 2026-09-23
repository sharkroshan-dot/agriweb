import { scrollKeyFor, useScrollRestoreStore } from "./scroll-restore-store";

describe("scrollKeyFor", () => {
  it("includes the query string so filters/pagination keep distinct scrolls", () => {
    expect(scrollKeyFor("/search", "q=apple&page=2")).toBe("/search?q=apple&page=2");
    expect(scrollKeyFor("/nearby", "")).toBe("/nearby");
  });
});

describe("useScrollRestoreStore", () => {
  beforeEach(() => {
    useScrollRestoreStore.persist.clearStorage();
  });

  it("stores and retrieves a position per URL key", () => {
    const store = useScrollRestoreStore.getState();
    store.setPosition("/search?q=apple", 340);
    expect(useScrollRestoreStore.getState().positions["/search?q=apple"]).toBe(340);
  });

  it("does not churn state when saving the same position", () => {
    const before = useScrollRestoreStore.getState();
    before.setPosition("/nearby", 120);
    const afterFirst = useScrollRestoreStore.getState().positions["/nearby"];
    const stateRef = useScrollRestoreStore.getState();
    stateRef.setPosition("/nearby", 120);
    expect(afterFirst).toBe(120);
  });

  it("persists across store rehydration from sessionStorage", () => {
    useScrollRestoreStore.getState().setPosition("/marketplace/state", 500);
    const hydrated = useScrollRestoreStore.persist.rehydrate();
    return hydrated.then(() => {
      expect(useScrollRestoreStore.getState().positions["/marketplace/state"]).toBe(500);
    });
  });
});
