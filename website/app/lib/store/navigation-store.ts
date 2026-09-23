import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface ListingReferrer {
  /** Listing pathname, e.g. "/nearby" or "/marketplace/state". */
  pathname: string;
  /** Full href including query params so filters/pagination are preserved. */
  href: string;
  /** Human-readable label for the Back link. */
  label: string;
}

/**
 * Records the most recent listing/marketplace page the user visited in this
 * tab. Product details reads it so its Back link returns to the exact listing
 * (with the same query params), instead of a hard-coded route.
 *
 * Session-scoped: a deep link to a product page in a fresh tab simply falls
 * back to the default marketplace link.
 */
interface NavigationStore {
  listingReferrer: ListingReferrer | null;
  setListingReferrer: (referrer: ListingReferrer) => void;
  clear: () => void;
}

export const useNavigationStore = create<NavigationStore>()(
  persist(
    (set) => ({
      listingReferrer: null,
      setListingReferrer: (referrer) =>
        set((state) => {
          if (state.listingReferrer?.href === referrer.href) return state;
          return { listingReferrer: referrer };
        }),
      clear: () => set({ listingReferrer: null }),
    }),
    {
      name: "agri-navigation-state",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
