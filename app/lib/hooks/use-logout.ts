"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { clearTransientState } from "../store/clear-transient-state";

/**
 * Sign-out that also resets all tab-scoped state so the next user (or the
 * same user signing back in) never sees a previous session's cart, search
 * drafts, scroll positions, or cached queries.
 */
export function useLogout() {
  const queryClient = useQueryClient();

  const logout = useCallback(async () => {
    clearTransientState();
    queryClient.clear();
    await signOut({ callbackUrl: "/" });
  }, [queryClient]);

  return logout;
}
