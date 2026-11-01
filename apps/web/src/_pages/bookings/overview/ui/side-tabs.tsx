import { ButtonLink } from "#shared/ui";
import { sideTabs, type FilterValues } from "../lib/bookings-search";

/**
 * The two halves of a user's stays, as links: the trips they took and the stays taken
 * against their listings. Navigation rather than ARIA tabs — each half is an address of
 * its own, read on the server, and the current one is marked the way the sidebar marks
 * the current section.
 */
export const SideTabs = ({ values }: { values: FilterValues }) => (
  <nav aria-label="Side of your stays" className="flex gap-2">
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
