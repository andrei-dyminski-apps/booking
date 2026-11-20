import { cn } from "@repo/ui/lib/utils";

/**
 * The logo: a roof over a reception bell, a stay and its front desk. Drawn in the theme's
 * own tokens rather than fixed colours, so it inverts with the theme like every primary
 * button does. The favicon, the touch icon and the shared card are the same drawing in
 * fixed colours (`app/icon.svg` and the files beside it), because a browser tab or a
 * chat preview knows nothing of the theme.
 *
 * Decorative wherever it is used: the site's name is always written next to it.
 */
export const BrandMark = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 32 32"
    aria-hidden
    className={cn("size-8 shrink-0", className)}
  >
    <rect width="32" height="32" rx="7" className="fill-primary" />
    <g className="fill-primary-foreground">
      <path
        d="M6.5 14.5 16 6.5l9.5 8"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
      <circle cx="16" cy="14.6" r="1.4" />
      <path d="M10 22.4a6 6 0 0 1 12 0Z" />
      <rect x="7" y="23.6" width="18" height="2.6" rx="1.3" />
    </g>
  </svg>
);
