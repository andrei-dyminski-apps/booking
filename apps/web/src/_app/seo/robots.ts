import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { siteUrl } from "#shared/config";
import { PROTECTED } from "../proxy";

/**
 * What a crawler may ask for, and where the sitemap is. Left out are the BFF — answers in
 * JSON, not pages — and every section a stranger is sent to the login page from: a crawler
 * is always a stranger, so each of them is a redirect it would spend its visits on.
 *
 * Rendered per request (`connection()`), since the sitemap's address is `siteOrigin()`,
 * read like every other variable of this server rather than frozen at build.
 */
export async function robots(): Promise<MetadataRoute.Robots> {
  await connection();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", ...PROTECTED],
    },
    sitemap: siteUrl("/sitemap.xml"),
  };
}
