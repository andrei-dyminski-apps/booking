import type { ComponentProps } from "react";
import Link from "next/link";
import { buttonVariants } from "@repo/ui/components/button";
import { cn } from "@repo/ui/lib/utils";

/**
 * A link that looks like a button — a `<Link>` wearing the button classes, not a `Button`
 * rendering an `<a>`. Navigation is an anchor and an action is a `Button`; this is the
 * anchor half, spelled once so the `cn(buttonVariants(...))` incantation, and the
 * `tailwind-merge` semantics a screen relies on when it adds a class of its own, are not
 * copied to every call site.
 *
 * `variant` and `size` are the button's own, taken straight off `buttonVariants` so a new
 * one appears here for free. Everything else — `href`, `className`, `children` — is
 * `next/link`'s; a `className` is merged after the variants, the same order the primitive
 * merges it in.
 *
 * It lives in `shared/ui` rather than in `@repo/ui` for the reason `FilterChips` and
 * `SortSelect` do: anything that imports `next/*` is not a design-system primitive.
 */
type ButtonLinkProps = ComponentProps<typeof Link> &
  Pick<NonNullable<Parameters<typeof buttonVariants>[0]>, "variant" | "size">;

export const ButtonLink = ({
  variant,
  size,
  className,
  ...props
}: ButtonLinkProps) => (
  <Link
    className={cn(buttonVariants({ variant, size }), className)}
    {...props}
  />
);
