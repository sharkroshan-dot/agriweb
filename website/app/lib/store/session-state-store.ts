import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Small session-scoped scratchpad for non-URL state that should survive
 * Back/Forward navigation within a tab, e.g. search text a user typed but did
 * not submit yet. Values are plain text strings and never sensitive.
 */
interface SessionStateStore {
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  getDraft: (key: string) => string | undefined;
}

export const useSessionStateStore = create<SessionStateStore>()(
  persist(
    (set, get) => ({
      drafts: {},
      setDraft: (key, value) =>
        set((state) => ({ drafts: { ...state.drafts, [key]: value } })),
      getDraft: (key) => get().drafts[key],
    }),
    {
      name: "agri-session-state",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
