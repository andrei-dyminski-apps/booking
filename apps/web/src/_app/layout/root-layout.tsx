import type { Metadata } from "next";
import {
  NONCE_HEADER,
  SITE_DESCRIPTION,
  SITE_LOGO,
  SITE_NAME,
  siteOrigin,
  siteUrl,
} from "#shared/config";
import { JsonLd } from "#shared/ui";
import { Providers } from "../providers";
import { AppShell } from "./app-shell";
import "../styles/globals.css";

/**
 * What every page inherits: the base every relative URL of a page's metadata is resolved
 * against, and a title a page's own is set into. A function rather than an object, so the
 * origin is read per request like every other variable of this server rather than frozen
 * at build.
 *
 * The shared link names the site and says what it is, so a page with no `openGraph` of
 * its own is still shared as something rather than as a bare address; a page that has one
 * replaces this whole. The picture it is shared with is not here: `app/opengraph-image.png`
 * and `app/twitter-image.png` are file conventions, which Next puts on every page beneath
 * them and ranks above any page's `openGraph` — the listings have no photos of their own
 * yet, so the brand card is the one picture there is. The icons are file conventions too
 * (`favicon.ico`, `icon.svg`, `apple-icon.png`).
 */
export const generateMetadata = (): Metadata => ({
  metadataBase: new URL(siteOrigin()),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: {
    siteName: SITE_NAME,
    type: "website",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  // Safari on an iPhone reads its own tags rather than the manifest: added to the Home
  // Screen, the site opens as an app under this name (`apple-icon.png` is its icon).
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
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
    logo: siteUrl(SITE_LOGO),
  },
  {
    "@type": "WebSite",
    "@id": siteUrl("/#website"),
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
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
