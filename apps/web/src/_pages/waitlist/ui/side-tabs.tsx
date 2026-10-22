import { ButtonLink } from "#shared/ui";
import { sideTabs, type WaitlistValues } from "../lib/waitlist-search";

/**
 * A user's two waitlists, as links: the ranges they wait for and the ones waited for on
 * their listings. Navigation rather than ARIA tabs, for the reason the stays' tabs give.
 */
export const SideTabs = ({ values }: { values: WaitlistValues }) => (
  <nav aria-label="Side of the waitlist" className="flex gap-2">
    {sideTabs(values).map((tab) => (
      <ButtonLink
        key={tab.side}
        href={tab.href}
        variant={tab.current ? "secondary" : "ghost"}
        size="sm"
        aria-current={tab.current ? "page" : undefined}
      >
        {tab.label}
      </ButtonLink>
    ))}
  </nav>
);
