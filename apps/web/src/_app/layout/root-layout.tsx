import type { Metadata } from "next";
import { SITE_NAME, siteOrigin, siteUrl } from "#shared/config";
import { JsonLd } from "#shared/ui";
import { Providers } from "../providers";
import { AppShell } from "./app-shell";
import { ThemeScript } from "./theme-script";
import "../styles/globals.css";

const DESCRIPTION = "A booking demo built on a shared zod contract";

/**
 * What every page inherits: the base every relative URL of a page's metadata is resolved
 * against, and a title a page's own is set into. It reads no request, so it is part of the
 * prerendered shell and the origin in it is the one the build saw — on Vercel the same
 * `SITE_ORIGIN` or production domain the server runs with.
 *
 * The shared link names the site and says what it is, so a page with no `openGraph` of
 * its own is still shared as something rather than as a bare address; a page that has one
 * replaces this whole.
 */
export const generateMetadata = (): Metadata => ({
  metadataBase: new URL(siteOrigin()),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: DESCRIPTION,
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    title: SITE_NAME,
    description: DESCRIPTION,
  },
});

/**
 * The two things the whole site shares, stated once in the shell rather than on every
 * page: who publishes it, and the site itself. Each page states what is its own.
 */
const siteJsonLd = () => [
  {
    "@type": "Organization",
    "@id": siteUrl("/#organization"),
    name: SITE_NAME,
    url: siteUrl("/"),
  },
  {
    "@type": "WebSite",
    "@id": siteUrl("/#website"),
    name: SITE_NAME,
    description: DESCRIPTION,
    url: siteUrl("/"),
    publisher: { "@id": siteUrl("/#organization") },
  },
];

/**
 * Nothing here reads the request, and that is what lets every page start as a prerendered
 * shell: the session is read inside the islands of the shell that differ per visitor
 * (`AppShell`), and the theme's script is allowed by its hash rather than by a nonce.
 */
export const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  // The theme's script writes its class onto <html> before React hydrates, and that
  // difference from the server markup is expected rather than a bug.
  <html lang="en" suppressHydrationWarning>
    <body className="min-h-svh bg-background antialiased">
      <ThemeScript />
      <JsonLd data={siteJsonLd()} />
      <Providers>
        <AppShell>{children}</AppShell>
      </Providers>
    </body>
  </html>
);
