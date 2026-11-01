import type { RefundFailureStatus } from "@repo/contracts";
import type { SetAsideList } from "#shared/config";
import { ButtonLink } from "#shared/ui";
import { listTabs, statusTabs } from "../lib/payments-search";

/**
 * The four lists as links, the way the stays screen draws its two sides: each is an address
 * of its own, read on the server, and the current one is marked as the sidebar marks the
 * current section.
 */
export const ListTabs = ({ current }: { current: SetAsideList }) => (
  <nav aria-label="What was set aside" className="flex flex-wrap gap-2">
    {listTabs(current).map((tab) => (
      <ButtonLink
        key={tab.list}
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

/** The open bounced refunds and the resolved ones, kept as the record of how each went back. */
export const StatusTabs = ({ current }: { current: RefundFailureStatus }) => (
  <nav aria-label="Bounced refunds" className="flex flex-wrap gap-2">
    {statusTabs(current).map((tab) => (
      <ButtonLink
        key={tab.status}
        href={tab.href}
        variant={tab.current ? "outline" : "ghost"}
        size="sm"
        // "true" rather than "page": the list tab above already marks the page, and this
        // is the current half of it.
        aria-current={tab.current ? "true" : undefined}
      >
        {tab.label}
      </ButtonLink>
    ))}
  </nav>
);
