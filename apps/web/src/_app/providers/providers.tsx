"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@repo/ui/components/sonner";

/**
 * The only client boundary around the whole tree: the theme has to be read from
 * localStorage, and the toaster has to survive navigation between pages. The theme's
 * inline script carries the request's CSP nonce.
 *
 * The query cache is not here: the stay's page is the one screen that uses it, and holds
 * its own (`BookingQueryProvider`), so every other screen loads no TanStack Query.
 */
export const Providers = ({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce: string | undefined;
}) => (
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
);
