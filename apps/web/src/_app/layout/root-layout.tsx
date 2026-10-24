import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "../providers";
import { AppShell } from "./app-shell";
import "../styles/globals.css";

// The application supplies the faces, the design system names the token: the loader
// writes into `--app-font-*`, and `@repo/ui/globals.css` maps those onto `--font-sans`
// and `--font-mono`. Writing straight into the token names would make each of them
// reference itself, and the tokens would survive only as long as this class outranks
// the `@layer theme` rule that Tailwind emits.
//
// `next/font/google` downloads the faces at build time and serves them from this origin,
// subset to Latin and as woff2 — under half of the full variable `.woff`. The mono face is
// not preloaded: no first screen sets text in it, and a preload is fetched at high
// priority alongside the stylesheet, ahead of what the page actually paints.
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--app-font-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--app-font-mono",
  preload: false,
});

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
  <html
    lang="en"
    className={`${geistSans.variable} ${geistMono.variable}`}
    suppressHydrationWarning
  >
    <body className="min-h-svh bg-background antialiased">
      <Providers>
        <AppShell>{children}</AppShell>
      </Providers>
    </body>
  </html>
);
