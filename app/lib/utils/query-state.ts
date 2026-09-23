/**
 * Pure, framework-free helpers for treating the URL query string as the single
 * source of truth for page search/filter state.
 *
 * These functions have no React or Next.js dependency so they can be unit
 * tested in isolation and shared by hooks and components.
 */

export interface QueryParams {
  [name: string]: string;
}

/** Parse a search string ("?q=apple&page=2") into a flat param map. */
export function parseQueryString(search: string): QueryParams {
  const result: QueryParams = {};
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query) return result;
  for (const [key, value] of new URLSearchParams(query).entries()) {
    result[key] = value;
  }
  return result;
}

/**
 * Serialize a param map to a query string WITHOUT the leading "?".
 * Empty-string / undefined / null values are dropped entirely so a cleared
 * param disappears from the URL instead of lingering as "?organic=".
 */
export function toQueryString(params: QueryParams): string {
  const search = new URLSearchParams();
  let changed = false;
  for (const [key, rawValue] of Object.entries(params)) {
    const value = rawValue === undefined || rawValue === null ? "" : String(rawValue);
    if (value === "") continue;
    search.set(key, value);
    changed = true;
  }
  return changed ? search.toString() : "";
}

/**
 * Produce the next param map after applying a patch.
 *
 * - Keys in `reset` are removed (used to clear `page` whenever a filter changes).
 * - A patch value of "" / undefined / null removes the key.
 * - Returns `null` when nothing changed so callers can skip a router update.
 */
export function applyParamPatch(
  current: QueryParams,
  patch: QueryParams,
  reset: string[] = [],
): QueryParams | null {
  const next: QueryParams = { ...current };
  let changed = false;

  for (const key of reset) {
    if (key in next) {
      delete next[key];
      changed = true;
    }
  }

  for (const [key, rawValue] of Object.entries(patch)) {
    const value = rawValue === undefined || rawValue === null ? "" : String(rawValue);
    if (value === "") {
      if (next[key] !== undefined) {
        delete next[key];
        changed = true;
      }
    } else if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }

  return changed ? next : null;
}

/** Build a full href for a pathname + params, omitting the query when empty. */
export function buildHref(pathname: string, params: QueryParams): string {
  const qs = toQueryString(params);
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Read an integer param with a safe fallback and optional clamping. */
export function getNumberParam(
  params: QueryParams,
  key: string,
  fallback: number,
  range?: { min?: number; max?: number },
): number {
  const raw = params[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) return fallback;
  let value = parsed;
  if (range?.min !== undefined) value = Math.max(range.min, value);
  if (range?.max !== undefined) value = Math.min(range.max, value);
  return value;
}

/** Read a boolean param ("true" -> true, anything else -> fallback). */
export function getBoolParam(params: QueryParams, key: string, fallback = false): boolean {
  const raw = params[key];
  if (raw === undefined) return fallback;
  return raw === "true";
}
