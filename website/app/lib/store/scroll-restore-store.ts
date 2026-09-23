import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Persists the page scroll position per URL (pathname + query string) in
 * sessionStorage so it survives in-page navigation, Back/Forward, and a tab
 * refresh. Only a plain scroll offset is stored — nothing sensitive.
 */
interface ScrollRestoreState {
  positions: Record<string, number>;
  setPosition: (key: string, y: number) => void;
}

export const useScrollRestoreStore = create<ScrollRestoreState>()(
  persist(
    (set) => ({
      positions: {},
      setPosition: (key, y) =>
        set((state) => {
          if (state.positions[key] === y) return state;
          return { positions: { ...state.positions, [key]: y } };
        }),
    }),
    {
      name: "agri-page-scroll",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

export function scrollKeyFor(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname;
}
