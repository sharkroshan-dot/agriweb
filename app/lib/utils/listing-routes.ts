/**
 * Routes that list products/markets and therefore participate in
 * "Back to the exact listing I came from" navigation tracking.
 */

const LISTING_ROUTE_LABELS: Record<string, string> = {
  "/nearby": "Nearby Markets",
  "/search": "Search",
  "/marketplace": "Marketplace",
  "/marketplace/state": "State Marketplace",
  "/marketplace/national": "National Marketplace",
  "/marketplace/community": "Community Marketplace",
  "/farmers": "Farmers",
};

export function isListingPath(pathname: string): boolean {
  return pathname in LISTING_ROUTE_LABELS;
}

export function getListingLabel(pathname: string): string {
  return LISTING_ROUTE_LABELS[pathname] ?? "Back";
}
