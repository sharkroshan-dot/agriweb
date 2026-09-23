import { useCartStore } from "./cart-store";
import { useNavigationStore } from "./navigation-store";
import { useScrollRestoreStore } from "./scroll-restore-store";
import { useSessionStateStore } from "./session-state-store";

/**
 * Clears all tab-scoped transient state when the user signs out:
 * - search drafts / unsubmitted text,
 * - saved scroll positions,
 * - the recorded listing referrer,
 * - the persisted cart (user-specific data).
 *
 * Wishlist is stored server-side per user, so it is cleared automatically
 * when the session ends (and the React Query cache is cleared separately by
 * the caller via `queryClient.clear()`).
 */
export function clearTransientState() {
  useScrollRestoreStore.persist.clearStorage();
  useSessionStateStore.persist.clearStorage();
  useNavigationStore.persist.clearStorage();
  useCartStore.getState().clearCart();
}
