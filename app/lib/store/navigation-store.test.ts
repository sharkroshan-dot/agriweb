import { useNavigationStore } from "./navigation-store";

describe("useNavigationStore", () => {
  beforeEach(() => {
    useNavigationStore.persist.clearStorage();
    useNavigationStore.setState({ listingReferrer: null });
  });

  it("records the most recent listing referrer", () => {
    useNavigationStore
      .getState()
      .setListingReferrer({ pathname: "/marketplace/state", href: "/marketplace/state?sort=price-asc", label: "State Marketplace" });
    expect(useNavigationStore.getState().listingReferrer).toEqual({
      pathname: "/marketplace/state",
      href: "/marketplace/state?sort=price-asc",
      label: "State Marketplace",
    });
  });

  it("keeps only the newest referrer and drops duplicates", () => {
    const store = useNavigationStore.getState();
    store.setListingReferrer({ pathname: "/search", href: "/search?q=apple", label: "Search" });
    store.setListingReferrer({ pathname: "/nearby", href: "/nearby", label: "Nearby Markets" });
    expect(useNavigationStore.getState().listingReferrer?.href).toBe("/nearby");

    const ref = useNavigationStore.getState();
    ref.setListingReferrer({ pathname: "/nearby", href: "/nearby", label: "Nearby Markets" });
    // same href — no-op, referrer unchanged
    expect(useNavigationStore.getState().listingReferrer?.href).toBe("/nearby");
  });

  it("starts with no referrer", () => {
    expect(useNavigationStore.getState().listingReferrer).toBeNull();
  });
});
