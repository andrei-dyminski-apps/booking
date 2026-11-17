import type { Metadata } from "next";
import { NONCE_HEADER, SITE_NAME, siteOrigin, siteUrl } from "#shared/config";
import { JsonLd } from "#shared/ui";
import { Providers } from "../providers";
import { AppShell } from "./app-shell";
import "../styles/globals.css";

const DESCRIPTION = "A booking demo built on a shared zod contract";

/**
 * What every page inherits: the base every relative URL of a page's metadata is resolved
 * against, and a title a page's own is set into. A function rather than an object, so the
 * origin is read per request like every other variable of this server rather than frozen
 * at build.
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
        <JsonLd data={siteJsonLd()} />
        <Providers nonce={nonce}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
};
