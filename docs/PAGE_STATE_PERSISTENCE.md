# Global Navigation State Persistence & Page-State Restoration

This document is the single reference for how AgriConnect persists UI state
across navigation, Back/Forward, refresh, session change, and (where relevant)
the Flutter app. It maps every requirement to its implementation.

---

## 1. State strategy table

Every piece of user-visible state is assigned to exactly one source of truth.
Nothing sensitive (tokens, addresses, coordinates) is ever written to the URL
or to session storage.

| State                                | Store             | Where it lives                    | Survives refresh | Survives tab close | Back/Forward |
| ------------------------------------ | ----------------- | --------------------------------- | ---------------- | ------------------ | ------------ |
| Search query `q`                     | URL `?q=`         | `(customer)/search`               | ✅               | ✅ (shared URL)    | ✅           |
| Filters (category/price/organic/farmer/sort) | URL `?category=&priceMin=&priceMax=&organic=&farmer=&sortBy=` | `(customer)/search` | ✅ | ✅ | ✅ |
| Pagination `page`                    | URL `?page=`       | search + marketplaces             | ✅               | ✅                 | ✅           |
| Marketplace radius / sort / tab      | URL params        | `(customer)/nearby`, `(customer)/marketplace/*` | ✅ | ✅ | ✅ |
| Unsubmitted search text (draft)      | `sessionStorage` (zustand `session-state-store`) | `(customer)/search` | ✅ (tab only) | ❌ | ✅ |
| Scroll position per URL              | `sessionStorage` (zustand `scroll-restore-store`) | global hook `useScrollRestore` | ✅ (tab only) | ❌ | ✅ |
| Product-details Back target          | `sessionStorage` (zustand `navigation-store`) | product detail | ✅ (tab only) | ❌ | ✅ |
| Server data (product lists)          | TanStack Query in-memory cache (`gcTime` 30 min) | global provider + `usePersistentQuery` | ❌ (refetch) | ❌ | ✅ |
| Real-time stock                      | zustand `inventory-store` + WebSocket + refetch on focus | product detail | refetch ✅ | ❌ | ✅ |
| Cart                                 | `localStorage` (zustand `cart-store`) | global (header, cart, checkout) | ✅ | ✅ | ✅ |
| Wishlist                             | Server (FastAPI, per user) | `useWishlist` via TanStack Query | ✅ | ✅ | ✅ |
| Auth session                         | NextAuth cookies + server | global | ✅ | ✅ | n/a |

### Rules enforced by the architecture

1. **URL-first.** Anything that defines "what the user is looking at" lives in
   the query string. Read it once with `usePageParams()`; write with
   `update()`; Back/Forward and manual URL edits restore it with no sync loops.
2. **Session-scoped ephemera.** Drafts, scroll offsets, and the Back target are
   plain strings/numbers in `sessionStorage` (per-tab), never sensitive data.
3. **In-memory server cache.** TanStack Query keeps fetched listings for 30
   minutes (`gcTime`) with a 60s default / 2 min listing `staleTime`, so
   re-mounting a listing does not repeat API calls.
4. **Real-time data is always re-validated.** Stock is validated on mount,
   refreshed on window focus (`refetchOnWindowFocus: "always"`), and pushed via
   WebSocket. Never restored from a cache blindly.
5. **Logout wipes everything tab-scoped.** `clearTransientState()` clears
   drafts, scroll positions, referrer, and the cart; `queryClient.clear()`
   drops cached queries.

---

## 2. Folder structure (web)

```
website/app/
  lib/
    utils/
      query-state.ts            # pure serialize/parse/patch helpers (unit-tested)
      listing-routes.ts         # which routes are "listing" pages + labels
    store/
      scroll-restore-store.ts   # per-URL scroll offset (sessionStorage)
      session-state-store.ts    # search drafts / scratchpad (sessionStorage)
      navigation-store.ts       # last listing referrer for Product Back
      clear-transient-state.ts  # logout reset
      cart-store.ts             # persisted cart (localStorage)
      inventory-store.ts        # real-time stock
    hooks/
      use-page-params.ts        # URL = source of truth for page state
      use-persistent-query.ts   # TanStack wrapper w/ keepPreviousData
      use-scroll-restore.ts     # global scroll save/restore
      use-logout.ts             # sign-out + state reset
    components/
      listing-location-tracker.tsx  # records listing URL on navigation
  components/providers/session-provider.tsx  # QueryClient policy
```

- `usePageParams` (URL state), `usePersistentQuery` (server cache),
  `useScrollRestore` (scroll) are the **only** three primitives pages consume —
  no per-page duplication.
- Marketplaces are isolated from each other because each has its own route and
  URL namespace; states never mix across `/nearby`, `/marketplace/state`, etc.

---

## 3. URL query-state (web)

`usePageParams()` (`app/lib/hooks/use-page-params.ts`) makes the query string
the single source of truth:

```ts
const { params, update, clearAll } = usePageParams();
const q = params.q ?? "";
update({ q: "apple" }, { push: true, reset: ["page"] }); // submit -> new history entry
update({ sortBy: "price-asc" });                         // filter  -> replace (no history spam)
```

- Reading from `params` automatically responds to Back/Forward and manual URL
  edits (no effect-based syncing).
- Updates are de-duplicated by `applyParamPatch` — no router call when nothing
  changed.
- Empty-string values remove the key, so cleared filters disappear from the URL.
- The pure logic lives in `app/lib/utils/query-state.ts` (unit tested).

Sensitive values must never be placed here. Pagination is reset automatically
whenever the underlying query/filter changes (`reset: ["page"]`).

---

## 4. Client state (web)

| Store                    | Scope     | Key point                                              |
| ------------------------ | --------- | ------------------------------------------------------ |
| `session-state-store`    | tab       | search text typed but not yet submitted (`/search` draft) |
| `scroll-restore-store`   | tab       | `window.scrollY` keyed by pathname + query string       |
| `navigation-store`       | tab       | last listing href, so product Back is exact             |

All three use zustand `persist` + `sessionStorage`. Refresh and SPA
Back/Forward restore them; closing the tab discards them (desired — they are
session ephemera).

## 5. Server data cache (web)

`QueryClient` defaults (`app/components/providers/session-provider.tsx`):

```ts
staleTime: 60 * 1000,          // re-fetch only after 60s by default
gcTime: 30 * 60 * 1000,        // keep fetched listings in memory 30 min
refetchOnWindowFocus: "always",// stock re-validated when tab is focused
retry: 1,
```

`usePersistentQuery()` (`app/lib/hooks/use-persistent-query.ts`) is the single
wrapper for every listing query and adds:

- `placeholderData: keepPreviousData` — the previous page/filter result stays
  rendered while the next one loads (no skeleton flash).
- `staleTime` default **2 minutes** for listings — browsing filters/pages within
  a tab does not hammer the API.

The cache is intentionally **not** persisted to storage: on a hard refresh the
URL restores the query/filters and a single fresh request re-populates the
cache, avoiding ever showing stale real-time data.

## 6. Scroll position

Global `useScrollRestore()` (mounted once in `Providers`) debounces
`window.scrollY` saves keyed by `pathname + query` into sessionStorage and
restores on first mount and on `popstate`. Because the key includes the query
string, a filtered/paginated listing restores its exact scroll, while a
different filter combination gets its own position.

## 7. Browser Back/Forward & Product Details Back

- Listing pages restore URL params + scroll on Back because both are keyed by
  the URL (App Router routes are re-rendered from the URL state).
- `ListingLocationTracker` (mounted once, zero UI) records the most recent
  listing href (`navigation-store`) on every navigation.
- Product Details (`app/product/[productId]/page.tsx`) renders
  `Back to {label}` using that href — **exact source listing with the same
  filters and page** — instead of the previous hard-coded `/nearby`. Deep links
  fall back to `/nearby`; unknown paths fall back to "Back".

## 8. Search state (web)

All search params are URL-bound and survive refresh / Back / share:

- `q` — submitted query (submission uses `push` so it gets its own history entry).
- `category`, `priceMin`, `priceMax`, `organic`, `farmer`, `sortBy` — sidebar
  filters; each writes to the URL.
- `page` — pagination, reset on any filter change.
- Unsubmitted input is kept in `session-state-store` (draft) so typing survives
  an accidental back/refresh but is never committed to the URL until submit.
- `/search?category=organic` (home-page link) is normalized to the organic-only
  toggle.

Filter UIs (`DesktopSidebar`, `MobileFilters`) are presentational — they only
read props and call `onXChange`, keeping state logic in the page + URL.

## 9. Marketplace state (web)

Each marketplace is its own route (`/nearby`, `/marketplace/state`,
`/marketplace/national`, `/marketplace/community`), so their URL params are
naturally isolated:

- `/nearby`: `radius`, `sortBy`, `tab`, `page`.
- `/marketplace/state` / `national`: `sortBy`, `category`, `page`.
- Marketplace states never leak into one another; every listing page uses
  `usePageParams` + `usePersistentQuery` + `useScrollRestore` (via the global
  hook) for identical behavior.

## 10. Real-time inventory / stock

- `inventory-store` keeps `stockByProduct` updated via WebSocket pushes while a
  product page is open.
- On mount, stock is fetched fresh; `refetchOnWindowFocus: "always"` revalidates
  when the user returns to the tab.
- Stock is never read from a persisted cache — it is always the freshest value
  the API/WS provides.

## 11. Cart, wishlist, auth, refresh, logout

- **Cart** — persisted zustand store (`localStorage`). Survives refresh and tab
  close. Cleared on sign-out.
- **Wishlist** — server-side, per user (FastAPI), cached via TanStack Query.
  Cleared by `queryClient.clear()` on logout and by the server when the session
  ends.
- **Refresh** — URL restores filters/pagination; scroll restores via
  sessionStorage; cart/stock re-validate from API; the in-memory query cache
  avoids duplicate requests when data is still fresh.
- **Logout** — `useLogout()` calls `clearTransientState()` (drafts, scroll,
  referrer, cart) + `queryClient.clear()`, then NextAuth `signOut`. The API
  client also runs `clearTransientState()` on an automatic 401 sign-out
  (`/login?expired=true`).

## 12. Flutter (mobile)

Same strategy, adapted for native:

- **URL query params via `go_router`** — `MarketplaceQueryController`
  (Riverpod) mirrors the route's `queryParameters`, the single source of truth
  for `search`, filters, `sort`, `page`. Updating it navigates to a new
  `Uri` so Android back / deep links restore the exact listing.
- **`NavigationStateService`** (shared_preferences) persists scroll offsets keyed
  by route+query and the last listing location for product-detail Back.
- **Server cache** — Riverpod `FutureProvider` with auto-retry disabled for
  listings is replaced on the web by TanStack Query; on mobile the service
  layer caches list payloads for a short TTL and always re-validates stock.
- Screens (Nearby, State Marketplace, Product Details) are being migrated to
  these primitives so no screen re-implements persistence.

See `mobile/` for the services; each screen that participates in state
persistence consumes the shared controller/service rather than local `setState`.

## 13. FastAPI (backend) requirements

- All listing/search endpoints are **read-only, paginated, idempotent**:
  `GET /products/search`, `GET /marketplace/nearby`, `GET /marketplace/state`,
  `GET /marketplace/national` (and `?page=&limit=`).
- Cache headers: `Cache-Control: private, max-age=60` on listings; no caching on
  stock/inventory endpoints.
- `GET /inventory/stock/{id}` must return the live stock value every time; the
  WebSocket inventory channel pushes deltas.
- Auth endpoints remain unchanged; wishlist is scoped to the authenticated
  customer. Do not store client-supplied filters server-side (the client's URL
  is the state store).

## 14. MongoDB considerations

- Store indexes for the query shapes the URL state produces:
  `{ category: 1, price: 1 }`, `{ farmerName: 1 }`, `{ isOrganic: 1, price: 1 }`,
  and `{ createdAt: -1 }` for "newest" sort.
- Keep listings immutable-by-update (`_id` stable) so cached client results and
  URL params remain valid across refreshes.
- Do not persist client UI state in MongoDB — the URL/session storage owns it.

## 15. Security

- The URL and session storage carry **only** non-sensitive filter/view state.
  No tokens, addresses, PII, or coordinates are ever persisted client-side.
- Search drafts are plain text; scroll offsets are numbers.
- The cart stores minimal product snapshots (id, name, price, unit) — no
  payment or identity data.

## 16. Error handling

- Listing queries use `usePersistentQuery`; on failure the previous page stays
  rendered and TanStack retries once. Pages surface an inline error with a
  Retry action (`refetch`).
- A failed stock fetch never blocks product rendering; the UI degrades to the
  last known WS/API value with an "unavailable" state.
- Session-expiry (401) triggers automatic sign-out + state cleanup +
  `/login?expired=true`.

## 17. Testing

- **Unit (Jest + jsdom, `npm test`):** pure query-state helpers
  (`parseQueryString`, `applyParamPatch`, `buildHref`, number/bool readers) and
  the persisted stores (drafts, scroll positions, referrer, cart
  add/merge/clear, sign-out reset).
- **E2E (Cypress):** `cypress/e2e/search-persistence.cy.ts` verifies that
  filters/sort/pagination survive a reload, that the URL is the source of
  truth, and that Product Details Back returns to the exact listing (with
  fallback for deep links).
  Run with `npx cypress run` against the running dev server
  (`npx cypress install` first).

## 18. Running

1. Backend: `cd backend && uvicorn main:app --reload --port 8000`
2. Web: `cd website && npm install && npm run dev` → http://localhost:3000
3. Unit tests: `cd website && npm test`
4. E2E: `cd website && npx cypress install && npx cypress run`
5. Mobile: `cd mobile && flutter pub get && flutter run`

---

## 19. Requirement checklist

| # | Requirement                                  | Where implemented |
| - | -------------------------------------------- | ----------------- |
| 1 | URL state is source of truth                 | `usePageParams`, `query-state.ts` |
| 2 | Folder structure                             | §2 above |
| 3 | Client state scoped/isolated                 | `session-state-store`, `scroll-restore-store`, `navigation-store` |
| 4 | URL query-state implementation               | §3 above |
| 5 | Back/Forward restores URL state              | `usePageParams` + scroll restore |
| 6 | Page-specific state                          | draft store + per-page URL params |
| 7 | Server data cache                            | `session-provider.tsx`, `usePersistentQuery` |
| 8 | Marketplace states not mixed                 | one route + URL namespace per marketplace |
| 9 | Product details Back exact                   | `navigation-store` + `listing-location-tracker` |
| 10 | Filter sidebar persists                      | search/marketplace URL filters |
| 11 | Pagination / infinite scroll                 | `?page=` + `keepPreviousData` |
| 12 | Search result cache                          | TanStack Query (`gcTime`) |
| 13 | Real-time inventory                          | `inventory-store` + WS + focus refetch |
| 14 | Cart persists                                | `cart-store` (localStorage) |
| 15 | Wishlist persists                            | server-side per user |
| 16 | Auth session                                 | NextAuth; cleanup on logout/401 |
| 17 | Refresh preserves state                      | URL + sessionStorage + cache |
| 18 | New session (no leak)                        | sessionStorage scoped per tab |
| 19 | Logout clears transient state                | `clear-transient-state.ts` + `useLogout` |
| 20 | Flutter equivalent                           | §12 + `mobile/` services |
| 21 | Reusable hooks/components (no duplication)   | `usePageParams`/`usePersistentQuery`/`useScrollRestore` |
| 22 | Global state strategy table                  | §1 |
| 23 | Security                                    | §15 |
| 24 | Error handling                               | §16 |
| 25 | Tests                                        | §17 + `app/**/*.test.ts`, `cypress/e2e/*` |
| 26 | Running instructions                         | §18 |
