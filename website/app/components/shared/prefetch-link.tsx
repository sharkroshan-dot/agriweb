"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, type ComponentProps, type FocusEvent, type MouseEvent } from "react";

type Props = ComponentProps<typeof NextLink>;

/**
 * Prefetch a local route as soon as a navigation link is hovered or focused.
 * This warms Next.js route assets before the user clicks without preloading
 * every page (which can overload a large role-based dashboard).
 */
export function PrefetchLink({ href, prefetch = true, onMouseEnter, onFocus, ...props }: Props) {
  const router = useRouter();
  const prefetched = useRef(false);

  const warmRoute = useCallback(() => {
    if (prefetched.current || typeof href !== "string" || !href.startsWith("/")) return;
    prefetched.current = true;
    router.prefetch(href);
  }, [href, router]);

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    onMouseEnter?.(event);
    warmRoute();
  };

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    onFocus?.(event);
    warmRoute();
  };

  return (
    <NextLink
      {...props}
      href={href}
      prefetch={prefetch}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
    />
  );
}
