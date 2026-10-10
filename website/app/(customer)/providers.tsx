// website/app/providers.tsx
"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { useScrollRestore } from "../lib/hooks/use-scroll-restore";
import { ListingLocationTracker } from "../lib/components/listing-location-tracker";
import { VoiceAssistant } from "../components/shared/voice-assistant";

export function Providers({ children }: { children: React.ReactNode }) {
  useScrollRestore();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Reuse recent page data while moving between dashboard sections.
            // Explicit mutations/invalidation still refresh affected records.
            staleTime: 2 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            refetchOnWindowFocus: false,
            // Avoid repeating a slow request and keeping a page in loading state
            // for another full timeout window.
            retry: 0,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ListingLocationTracker />
          {children}
          <VoiceAssistant />
          <ReactQueryDevtools initialIsOpen={false} />
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}