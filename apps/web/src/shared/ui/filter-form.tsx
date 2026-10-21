"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The form a filter dialog is made of: a plain `GET` form that, where JavaScript is
 * available, navigates to the canonical address itself instead of letting the server
 * redirect it there.
 *
 * A `GET` form submits every box it has, so the address it lands on is
 * `?from=&to=&minPrice=100&…` — the same search a chip writes as `?minPrice=100`. The page
 * answers that by redirecting (see `canonical` in each slice's search module), and the
 * cost of it is visible: the browser shows the address it was submitted to and then
 * replaces it a round trip later. So the link is written here, before the navigation,
 * by the very function the chips and the ordering write theirs with — the address bar then
 * only ever holds the canonical one.
 *
 * The redirect stays, and stays load-bearing: it is what canonicalises a submit with no
 * JavaScript behind it and a URL somebody typed or shortened by hand. This is the fast
 * path over it, not a replacement — which is also why the form keeps its `method` and its
 * `action`: without a script it is exactly the form it was.
 *
 * It carries `noValidate` like every other form here, and for a sharper reason: the
 * boxes state `min` and `step` so that a keypad offers the right thing, and the browser
 * would otherwise refuse a submit over them in its own words, before the query schema has
 * said anything. A search arrives out of a URL, so a value the contract refuses reaches the
 * dialog already filled in — and a submit the browser blocked would leave a visitor with a
 * box they cannot correct by pressing the only button in front of them.
 *
 * Navigating is the whole of what it does, like `SortSelect` beside it, so it is a
 * `shared/ui` component rather than a primitive of the design system.
 */
export const FilterForm = ({
  action,
  href,
  onNavigate,
  children,
}: {
  /** Where the form posts without JavaScript — the route of the list being filtered. */
  action: string;
  /**
   * The address these boxes mean, written by the slice that knows what they filter. It is
   * given the fields the browser would have submitted, so what it produces is the link
   * that search belongs at.
   */
  href: (fields: Record<string, string>) => string;
  /** Run before the navigation starts — the dialog closes itself the way a reload did. */
  onNavigate?: () => void;
  children: ReactNode;
}) => {
  const router = useRouter();

  return (
    <form
      method="get"
      action={action}
      // The popup is portalled out of the subtree that renders it, so the grid of the
      // dialog is what lays these out — `contents` keeps the form from becoming a box
      // inside it.
      className="contents"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onNavigate?.();
        router.push(href(submittedFields(event.currentTarget)));
      }}
    >
      {children}
    </form>
  );
};

/**
 * What the form would have submitted, as text.
 *
 * Trimmed, because `singleParam` trims what it reads back out of the URL: a value that
 * survived the address bar with a space around it would not be the value the page
 * canonicalises to, and the redirect this exists to avoid would run after all.
 */
function submittedFields(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [name, value] of new FormData(form))
    if (typeof value === "string") fields[name] = value.trim();

  return fields;
}
