"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@repo/ui/components/sonner";

/**
 * The only client boundary around the whole tree: the theme has to be read from
 * localStorage, and the toaster has to survive navigation between pages.
 */
export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    disableTransitionOnChange
  >
    {children}
    <Toaster position="top-center" />
  </ThemeProvider>
);
