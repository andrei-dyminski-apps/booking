import type { Metadata } from "next";
import { Providers } from "../providers";
import { AppShell } from "./app-shell";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Booking",
  description: "A booking demo built on a shared zod contract",
};

export const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  // next-themes writes the theme class onto <html> before React hydrates, and that
  // difference from the server markup is expected rather than a bug.
  <html lang="en" suppressHydrationWarning>
    <body className="min-h-svh bg-background antialiased">
      <Providers>
        <AppShell>{children}</AppShell>
      </Providers>
    </body>
  </html>
);
