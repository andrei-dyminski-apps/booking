import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./globals.css";

// The application supplies the faces, the design system names the token: the loader
// writes into `--app-font-*`, and `@repo/ui/globals.css` maps those onto `--font-sans`
// and `--font-mono`. Writing straight into the token names would make each of them
// reference itself, and the tokens would survive only as long as this class outranks
// the `@layer theme` rule that Tailwind emits.
const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--app-font-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--app-font-mono",
});

export const metadata: Metadata = {
  title: "Booking",
  description: "A booking demo built on a shared zod contract",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // next-themes writes the theme class onto <html> before React hydrates, and that
    // difference from the server markup is expected rather than a bug.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-svh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
