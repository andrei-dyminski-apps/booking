import type { MetadataRoute } from "next";
import { ROUTES, SITE_DESCRIPTION, SITE_LOGO, SITE_NAME } from "#shared/config";

/**
 * What a browser installs the site as: its name, its icons and the colour of the window
 * around it. The colours are the tile's of the logo rather than the theme's — a manifest
 * is read once, before any page says which theme it is in.
 *
 * `id` is what a browser knows the installed app by, so it never changes once shipped —
 * a new one would be a second app beside the first. The shortcuts are the long-press menu
 * of the installed icon: the three places a visit most often heads for. Two of them are
 * signed-in sections, which send a stranger to sign in first, as their links do.
 */
export function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en",
    dir: "ltr",
    categories: ["travel", "lifestyle"],
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
    shortcuts: [
      { name: "Find a stay", url: ROUTES.catalogue },
      { name: "Trips", url: ROUTES.bookings },
      { name: "Messages", url: ROUTES.messages },
    ],
  };
}
