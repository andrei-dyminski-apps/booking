import type { ReactNode } from "react";
import {
  HOST_CANCELLATIONS_WINDOW_DAYS,
  stillOwed,
  type HostFee,
  type HostFeeOverview,
} from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { countOf, formatMoment, formatMoney } from "#shared/lib";
import { DateRange } from "#shared/ui";

/**
 * What a host owes for cancelling paid stays, one line a fee: the stay, the fee, what was
 * kept back of their payouts towards it, and a waiver. The host's payouts screen and the
 * admin's page of the account draw the same card; only the admin is handed `action`, the
 * control that waives a fee still owed. Nothing at all for a host with no fee in the window
 * and nothing owed — a card saying "none" on every payouts screen would be noise.
 */
export const HostFeesCard = ({
  overview,
  audience,
  action,
}: {
  overview: HostFeeOverview;
  /** Who reads it: the host is told about their own payouts, an admin about the host's. */
  audience: "host" | "admin";
  action?: (fee: HostFee) => ReactNode;
}) => {
  if (overview.fees.length === 0) return null;

  const period = `the last ${countOf(HOST_CANCELLATIONS_WINDOW_DAYS, "day")}`;
  // The overview carries no currency of its own: the site charges in one, and its fees are
  // in it — so the total is spelled in theirs rather than in an assumed default.
  const currency = overview.fees[0]?.currency;
  const owed =
    overview.owedCents > 0
      ? `${formatMoney(overview.owedCents, currency)} is still owed and is kept back from ${audience === "host" ? "your" : "their"} next payouts.`
      : "Nothing is owed.";
  // `cancellationsInWindow` leaves out the stays whose fee an admin waived, while the list
  // below shows them, so the sentence says so rather than contradict the rows under it. A
  // waived fee is owed by nobody, so every one in the list is a fee of the window.
  const waived = overview.fees.filter((fee) => fee.waivedAt !== null).length;
  const counted = countOf(overview.cancellationsInWindow, "paid stay");
  const waivedAside =
    waived === 0
      ? ""
      : `, not counting ${countOf(waived, "stay")} whose ${waived === 1 ? "fee was" : "fees were"} waived`;
  const cancelled =
    audience === "host"
      ? `You cancelled ${counted} in ${period}${waivedAside}.`
      : `${counted} cancelled by this host in ${period}${waivedAside}.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cancellation fees</CardTitle>
        <CardDescription>
          {audience === "host"
            ? `Cancelling a paid stay refunds the guest in full and costs a fee. ${cancelled} ${owed}`
            : `${cancelled} ${owed}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul role="list" className="flex flex-col divide-y">
          {overview.fees.map((fee) => (
            <HostFeeRow key={fee.id} fee={fee} action={action?.(fee)} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

const HostFeeRow = ({ fee, action }: { fee: HostFee; action: ReactNode }) => {
  const left = stillOwed(fee);

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="font-medium break-words">{fee.listingTitle}</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <DateRange from={fee.from} to={fee.to} />
          <span>cancelled {formatMoment(fee.createdAt)} UTC</span>
        </span>
        {fee.cancellationReason !== null && (
          <span className="break-words text-muted-foreground">
            “{fee.cancellationReason}”
          </span>
        )}
        <span>
          Fee {formatMoney(fee.amountCents, fee.currency)}
          {fee.withheldCents > 0 &&
            `, ${formatMoney(fee.withheldCents, fee.currency)} kept back so far`}
          {left > 0 && `, ${formatMoney(left, fee.currency)} still owed`}
        </span>
        {fee.waivedAt !== null && (
          <span className="break-words text-muted-foreground">
            Waived {formatMoment(fee.waivedAt)} UTC
            {/* Only an admin's overview names who waived it. */}
            {fee.waivedBy !== null && ` by ${fee.waivedBy.name}`}
            {fee.waiveReason === null ? "" : `: “${fee.waiveReason}”`}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {fee.waivedAt !== null ? (
          <Badge variant="outline">Waived</Badge>
        ) : left === 0 ? (
          <Badge variant="outline">Settled</Badge>
        ) : (
          // The admin's control to waive it; the host is told it is still owed.
          (action ?? <Badge variant="secondary">Owed</Badge>)
        )}
      </div>
    </li>
  );
};
