import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_LOGO, SITE_NAME } from "#shared/config";

/**
 * What a browser installs the site as: its name, its icons and the colour of the window
 * around it. The colours are the tile's of the logo rather than the theme's — a manifest
 * is read once, before any page says which theme it is in.
 */
export function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#171717",
    theme_color: "#171717",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: SITE_LOGO, sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
