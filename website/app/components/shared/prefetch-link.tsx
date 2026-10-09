"use client";

import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type ComponentProps, type FocusEvent, type MouseEvent } from "react";

type Props = ComponentProps<typeof NextLink>;

/**
 * Prefetch a local route on hover/focus, then show immediate navigation
 * feedback on click while the destination route and its data load.
 */
export function PrefetchLink({ href, prefetch = true, onMouseEnter, onFocus, onClick, ...props }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const prefetched = useRef<string | null>(null);

  const warmRoute = useCallback(() => {
    if (typeof href !== "string" || !href.startsWith("/") || prefetched.current === href) return;
    prefetched.current = href;
    router.prefetch(href);
  }, [href, router]);

  useEffect(() => {
    if (prefetched.current !== href) prefetched.current = null;
  }, [href]);

  const handleMouseEnter = (event: MouseEvent<HTMLAnchorElement>) => {
    onMouseEnter?.(event);
    warmRoute();
  };

  const handleFocus = (event: FocusEvent<HTMLAnchorElement>) => {
    onFocus?.(event);
    warmRoute();
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
      (props.target && props.target !== "_self") ||
      props.download !== undefined
    ) return;

    if (typeof href === "string" && href.startsWith("/") && href.split(/[?#]/, 1)[0] !== pathname) {
      window.dispatchEvent(new Event("agri:navigation-start"));
      warmRoute();
    }
  };

  return (
    <NextLink
      {...props}
      href={href}
      prefetch={prefetch}
      onMouseEnter={handleMouseEnter}
      onFocus={handleFocus}
      onClick={handleClick}
    />
  );
}
