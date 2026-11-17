"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@repo/ui/components/sonner";

/**
 * `next-themes` writes an inline script of its own, which the policy would refuse: it can
 * carry nothing but a nonce, and the shell it sits in is prerendered before any request
 * has one. A script of a type that is not JavaScript is a data block the browser neither
 * runs nor reports, so the library's copy is left inert and the root layout runs the same
 * logic as `ThemeScript`, allowed by its hash.
 */
const INERT_SCRIPT = { type: "text/plain" } as const;

/**
 * The only client boundary around the whole tree: the theme has to be read from
 * localStorage, and the toaster has to survive navigation between pages.
 *
 * The query cache is not here: the stay's page is the one screen that uses it, and holds
 * its own (`BookingQueryProvider`), so every other screen loads no TanStack Query.
 */
export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    disableTransitionOnChange
    scriptProps={INERT_SCRIPT}
  >
    {children}
    <Toaster position="top-center" />
  </ThemeProvider>
);
