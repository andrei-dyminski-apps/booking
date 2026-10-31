import Link from "next/link";
import {
  NO_CENTS,
  owedToHost,
  StuckKind,
  type StuckStay,
} from "@repo/contracts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { BookingStatusBadge } from "#entities/booking";
import { ROUTES } from "#shared/config";
import { countOf, formatDay, formatMoment, formatMoney } from "#shared/lib";
import { ButtonLink } from "#shared/ui";
import { retryStuckAction } from "../api/set-aside-actions";
import { LastError } from "./last-error";
import { RetryButton } from "./retry-button";

/**
 * A stay whose owed refund or host payout stopped retrying. The money is still on the row —
 * the debt a cancellation left, or the share the host is owed — so the way out is the job
 * again rather than a note: retried, it sends what the row says.
 */
export const StuckStayCard = ({ stuck }: { stuck: StuckStay }) => {
  const { booking } = stuck;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Link href={ROUTES.booking(booking.id)} className="hover:underline">
            {booking.listing.title}
          </Link>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            {formatDay(booking.from)} – {formatDay(booking.to)}
          </span>
          <span>{owed(stuck)}</span>
          <span>
            Set aside {formatMoment(stuck.failedAt)} UTC after{" "}
            {countOf(stuck.attempts, "attempt")}
          </span>
        </CardDescription>
        <CardAction>
          <BookingStatusBadge status={booking.status} />
        </CardAction>
      </CardHeader>

      <CardContent>
        <LastError error={stuck.lastError} />
      </CardContent>

      <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <RetryButton
          action={retryStuckAction.bind(null, booking.id, stuck.kind)}
        />
        <ButtonLink href={ROUTES.booking(booking.id)} variant="ghost" size="sm">
          Open the stay
        </ButtonLink>
      </CardFooter>
    </Card>
  );
};

/**
 * What the job would send: the refund the cancellation owes, or what the host is owed — by
 * `owedToHost`, the rule the payout itself is computed by, so a refund still owed, an unpaid
 * stay and a lost dispute count here as they do there.
 */
function owed({ kind, booking }: StuckStay): string {
  if (kind === StuckKind.refund) {
    return `${formatMoney(booking.refundOwedCents ?? NO_CENTS, booking.currency)} owed to the guest`;
  }

  return `${formatMoney(owedToHost(booking), booking.currency)} owed to the host`;
}
