import { useSessionStateStore } from "./session-state-store";

describe("useSessionStateStore", () => {
  beforeEach(() => {
    useSessionStateStore.persist.clearStorage();
  });

  it("saves and retrieves unsubmitted search drafts", () => {
    useSessionStateStore.getState().setDraft("/search", "tomatoes");
    expect(useSessionStateStore.getState().getDraft("/search")).toBe("tomatoes");
  });

  it("updates an existing draft", () => {
    const store = useSessionStateStore.getState();
    store.setDraft("/search", "onions");
    store.setDraft("/search", "potatoes");
    expect(useSessionStateStore.getState().getDraft("/search")).toBe("potatoes");
  });

  it("returns undefined for an unknown draft", () => {
    expect(useSessionStateStore.getState().getDraft("/nope")).toBeUndefined();
  });

  it("keeps drafts for different keys isolated", () => {
    const store = useSessionStateStore.getState();
    store.setDraft("/search", "apples");
    store.setDraft("/nearby", "mangoes");
    expect(store.getDraft("/search")).toBe("apples");
    expect(store.getDraft("/nearby")).toBe("mangoes");
  });
});
