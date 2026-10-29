"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@repo/ui/components/sonner";

/**
 * The only client boundary around the whole tree: the theme has to be read from
 * localStorage, the toaster has to survive navigation between pages, and the query client
 * has to outlive a re-render. The theme's inline script carries the request's CSP nonce.
 *
 * TanStack Query is here for the one screen whose truth arrives later than its render: a
 * stay being paid for is confirmed by the payment provider's webhook, not by the browser
 * that paid, so the page polls the booking until it changes. Everything else is still read
 * by a server render. The client is made once per browser session, in state rather than at
 * module scope, so a server render never shares one between two visitors.
 */
export const Providers = ({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce: string | undefined;
}) => {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        nonce={nonce}
      >
        {children}
        <Toaster position="top-center" />
      </ThemeProvider>
    </QueryClientProvider>
  );
};
