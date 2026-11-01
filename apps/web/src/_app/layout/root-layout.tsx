import type { Metadata } from "next";
import { NONCE_HEADER } from "#shared/config";
import { Providers } from "../providers";
import { AppShell } from "./app-shell";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Booking",
  description: "A booking demo built on a shared zod contract",
};

export const RootLayout = async ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => {
  // Minted by the proxy for this request; the theme's inline script needs it under the CSP.
  // `next/headers` is imported lazily: `global-error.tsx`, a client module, reaches this
  // file through the segment's index, and a static import would refuse to bundle there.
  const { headers } = await import("next/headers");
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    // next-themes writes the theme class onto <html> before React hydrates, and that
    // difference from the server markup is expected rather than a bug.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-svh bg-background antialiased">
        <Providers nonce={nonce}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
};
