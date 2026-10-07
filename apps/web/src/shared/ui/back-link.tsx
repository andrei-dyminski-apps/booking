import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { ButtonLink } from "./button-link";

/**
 * The way up from a detail screen to the list it was opened from — a ghost link with an
 * arrow, sitting above the heading. The negative margin pulls the ghost padding back so
 * the arrow lines up with the heading's left edge rather than the button's box.
 */
export const BackLink = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <ButtonLink
    href={href}
    variant="ghost"
    size="sm"
    className="-ml-2 self-start"
  >
    <ArrowLeftIcon />
    {children}
  </ButtonLink>
);
