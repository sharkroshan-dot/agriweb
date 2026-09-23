"use client";

import { useEffect, useRef, useState } from "react";
import { usePageParams } from "./use-page-params";

/**
 * Text-input-friendly binding to a single URL query param.
 *
 * Keeps a local value so typing stays smooth, debounces writes back to the
 * URL (which remains the source of truth), and follows external URL changes
 * such as browser Back/Forward or a manual URL edit.
 */
export function useParamField(name: string, debounceMs = 350) {
  const { params, update } = usePageParams();
  const external = params[name] || "";
  const [value, setValue] = useState(external);
  const lastPushedRef = useRef<string | null>(null);

  // Follow URL changes coming from Back/Forward, refresh, or a manual edit,
  // but do not clobber text the user is still typing (i.e. the value we just
  // pushed ourselves).
  useEffect(() => {
    if (lastPushedRef.current === external) {
      lastPushedRef.current = null;
      return;
    }
    setValue(external);
  }, [external]);

  // Debounce local edits back into the URL.
  useEffect(() => {
    if (value === external) return;
    const timer = setTimeout(() => {
      lastPushedRef.current = value;
      update({ [name]: value });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [value, external, name, update, debounceMs]);

  return { value, setValue };
}
