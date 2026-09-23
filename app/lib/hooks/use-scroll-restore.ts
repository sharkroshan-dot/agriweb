"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { scrollKeyFor, useScrollRestoreStore } from "../store/scroll-restore-store";

/**
 * Global scroll restoration.
 *
 * - Saves `window.scrollY` (debounced) keyed by the current URL.
 * - Restores the saved offset when the page first mounts (refresh, direct
 *   navigation, or browser Back that remounts the page) and on `popstate`
 *   (SPA Back/Forward between already-mounted routes).
 *
 * Mount this once near the top of the app (see Providers).
 */
export function useScrollRestore() {
  const pathname = usePathname();

  useEffect(() => {
    const store = useScrollRestoreStore;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let restoreRaf: number | undefined;

    const currentKey = () =>
      scrollKeyFor(window.location.pathname, window.location.search);

    const save = () => {
      store.getState().setPosition(currentKey(), window.scrollY);
    };

    const debouncedSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 150);
    };

    const restore = (key: string) => {
      const y = store.getState().positions[key];
      if (typeof y === "number" && y > 0) {
        restoreRaf = requestAnimationFrame(() => {
          window.scrollTo({ top: y, left: 0, behavior: "auto" });
        });
      }
    };

    const onPopState = () => {
      requestAnimationFrame(() => restore(currentKey()));
    };

    // First mount: restore if we have a saved position for this URL.
    const initialKey = currentKey();
    restoreRaf = requestAnimationFrame(() => restore(initialKey));

    window.addEventListener("scroll", debouncedSave, { passive: true });
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);
    window.addEventListener("popstate", onPopState);

    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      if (restoreRaf) cancelAnimationFrame(restoreRaf);
      window.removeEventListener("scroll", debouncedSave);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("popstate", onPopState);
    };
  }, [pathname]);
}
