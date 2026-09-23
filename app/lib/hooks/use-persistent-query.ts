"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";

/**
 * useQuery wrapper for paginated / filterable listings.
 *
 * - `placeholderData: keepPreviousData` keeps the previous result rendered
 *   while the next page/filter loads, so the UI never flashes to a skeleton.
 * - Every listing (search, marketplace, nearby) goes through this hook so the
 *   caching policy stays consistent instead of being re-implemented per page.
 *
 * Defaults are tuned for listings: data stays "fresh" for 2 minutes within the
 * tab (no redundant API calls on re-mount), while time-sensitive data such as
 * product stock uses the shorter global default (60s) with revalidation.
 */
export function usePersistentQuery<TQueryFnData = unknown, TError = Error>(
  options: UseQueryOptions<TQueryFnData, TError>,
) {
  return useQuery<TQueryFnData, TError, TQueryFnData>({
    ...options,
    placeholderData: keepPreviousData,
    staleTime: options.staleTime ?? 2 * 60 * 1000,
  });
}
