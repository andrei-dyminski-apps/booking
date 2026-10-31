import Link from "next/link";
import type { RefundFailure } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";
import { formatDay, formatMoment, formatMoney } from "#shared/lib";
import { ButtonLink } from "#shared/ui";
import { ResolveRefundButton } from "./resolve-refund-button";

/**
 * A refund the guest's bank sent back, and the stay it belonged to. The provider's ids are
 * on the card because they are what finds the money at Stripe — and once no booking names
 * the payment any more, they are all that does. A resolved one carries the note of how the
 * money went back instead of the button.
 */
export const RefundFailureCard = ({ failure }: { failure: RefundFailure }) => (
  <Card>
    <CardHeader>
      <CardTitle>
        {formatMoney(failure.amountCents, failure.currency)}
      </CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Came back {formatMoment(failure.failedAt)} UTC</span>
        <span className="font-mono break-all">{failure.refundId}</span>
        <span className="font-mono break-all">{failure.paymentId}</span>
      </CardDescription>
      <CardAction>
        <Badge
          variant={failure.resolvedAt === null ? "destructive" : "outline"}
        >
          {failure.resolvedAt === null ? "Open" : "Resolved"}
        </Badge>
      </CardAction>
    </CardHeader>

    <CardContent className="flex flex-col gap-2 text-sm">
      <p>
        <span className="text-muted-foreground">
          Reason given by the bank:{" "}
        </span>
        {failure.reason ?? "none given"}
      </p>
      {failure.stay === null ? (
        <p className="text-muted-foreground">
          No stay names this payment any more.
        </p>
      ) : (
        <p>
          <span className="text-muted-foreground">Stay: </span>
          <Link
            href={ROUTES.booking(failure.stay.bookingId)}
            className="hover:underline"
          >
            {failure.stay.listingTitle}, {formatDay(failure.stay.from)} –{" "}
            {formatDay(failure.stay.to)}
          </Link>
        </p>
      )}
      {failure.resolvedAt !== null && (
        <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Resolved {formatMoment(failure.resolvedAt)} UTC
          </span>
          <p className="break-words whitespace-pre-wrap">
            {failure.resolution}
          </p>
        </div>
      )}
    </CardContent>

    {(failure.resolvedAt === null || failure.stay !== null) && (
      <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {failure.resolvedAt === null && (
          <ResolveRefundButton refundId={failure.refundId} />
        )}
        {failure.stay !== null && (
          <ButtonLink
            href={ROUTES.booking(failure.stay.bookingId)}
            variant="ghost"
            size="sm"
          >
            Open the stay
          </ButtonLink>
        )}
      </CardFooter>
    )}
  </Card>
);
