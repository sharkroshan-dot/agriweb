"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  getListingLabel,
  isListingPath,
} from "../utils/listing-routes";
import { useNavigationStore } from "../store/navigation-store";

/**
 * Zero-UI client component mounted once at the app root. Whenever the URL is a
 * listing/marketplace page, it records the full href (including query params)
 * so Product Details can return to the exact listing the user came from.
 */
function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setListingReferrer = useNavigationStore((s) => s.setListingReferrer);

  useEffect(() => {
    if (!isListingPath(pathname)) return;
    const qs = searchParams.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    setListingReferrer({ pathname, href, label: getListingLabel(pathname) });
  }, [pathname, searchParams, setListingReferrer]);

  return null;
}

export function ListingLocationTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
