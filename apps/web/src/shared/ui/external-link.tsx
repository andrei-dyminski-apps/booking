import type { ComponentProps } from "react";
import { ExternalLinkIcon } from "lucide-react";

/**
 * A link to another site: an anchor that opens in a new tab without handing that site the
 * page that opened it (`noopener`) or the address it was opened from (`noreferrer`) —
 * spelled once, so no call site has to remember either half.
 *
 * It draws nothing of its own beyond the optional arrow, so a text link in the footer and
 * a whole card on the home page are both this component with a `className` each. `target`
 * and `rel` are not props: a link that did not open elsewhere would not be this one.
 *
 * A new tab is said in words for a screen reader (WCAG's advice for links that open a new
 * window), since the arrow is decoration and a card has none: the visually hidden text
 * lands in the link's name, after whatever the caller wrote.
 */
type ExternalLinkProps = Omit<ComponentProps<"a">, "target" | "rel"> & {
  /** Draws the small "opens elsewhere" arrow after the children. */
  icon?: boolean;
};

export const ExternalLink = ({
  icon = false,
  children,
  ...props
}: ExternalLinkProps) => (
  <a {...props} target="_blank" rel="noopener noreferrer">
    {children}
    {icon && <ExternalLinkIcon aria-hidden className="size-3" />}
    <span className="sr-only"> (opens in a new tab)</span>
  </a>
);
