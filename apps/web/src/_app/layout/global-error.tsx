"use client";

import { ErrorPage } from "#_pages/error";
import "../styles/globals.css";

/**
 * The boundary above the shell, and the reason it exists rather than `error.tsx` alone:
 * an `error.tsx` catches what the page under a layout throws, never what the layout
 * itself does — and this shell reads the session before it renders anything, so an API
 * that cannot be reached at all fails there. Without this, that case is a blank 500 from
 * Next.js rather than a screen.
 *
 * It replaces the document instead of sitting inside it, which is why it brings its own
 * `<html>`, `<body>` and token import along. The faces are deliberately not loaded here:
 * the one screen that renders when the site is broken should ask for nothing it can do
 * without, and the token file falls back to the system stack.
 */
export const GlobalError = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => (
  <html lang="en">
    <body className="min-h-svh bg-background antialiased">
      <main className="mx-auto flex min-h-svh w-full max-w-3xl items-center px-4">
        <ErrorPage error={error} reset={reset} />
      </main>
    </body>
  </html>
);
