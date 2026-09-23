"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  applyParamPatch,
  buildHref,
  type QueryParams,
} from "../utils/query-state";

/**
 * PageParams represents a flat map of string query params ("" means absent).
 */
export type PageParams = QueryParams;

interface UpdateOptions {
  /**
   * When true, a new history entry is created (use for explicit user actions
   * like submitting a search). Defaults to false (replace) so that ephemeral
   * filter changes do not pollute the browser history.
   */
  push?: boolean;
  /**
   * Params to remove from the URL as part of this update. Handy for resetting
   * the page number whenever the underlying query/filters change.
   */
  reset?: string[];
}

/**
 * Makes the URL query string the single source of truth for a page's filter /
 * search state.
 *
 * - `params` recomputes whenever the URL changes, so browser Back/Forward and
 *   manual URL edits automatically restore the page state (no sync loops).
 * - `update()` writes changes back to the URL so the state survives a page
 *   refresh and is shareable.
 * - Sensitive values (tokens, addresses, coordinates) must NOT be stored here.
 */
export function usePageParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = useMemo<PageParams>(() => {
    const result: PageParams = {};
    searchParams.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }, [searchParams]);

  const update = useCallback(
    (patch: PageParams, options: UpdateOptions = {}) => {
      const next = applyParamPatch(
        Object.fromEntries(searchParams.entries()),
        patch,
        options.reset ?? [],
      );
      if (!next) return;

      const url = buildHref(pathname, next);

      if (options.push) {
        router.push(url, { scroll: false });
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [router, pathname, searchParams],
  );

  const clearAll = useCallback(() => {
    if (searchParams.toString() === "") return;
    router.replace(pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  return { params, update, clearAll };
}
