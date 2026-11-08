import Link from "next/link";
import { RefundFailureStatus, type BookingAdjustment } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { setAsideHref } from "#shared/config";
import { formatMoment, formatMoney } from "#shared/lib";
import { FinishRefundButton } from "./finish-refund-button";

/**
 * The refunds admins sent for the stay without cancelling it, newest first: who, how much,
 * why, and the provider's id to look the refund up by. An admin's alone, like the route
 * behind it; nothing at all for a stay nobody refunded this way.
 *
 * A press Stripe never answered is listed too, as unconfirmed, with the button that finishes
 * it under its own request — the dialog it came from mints a new one when it opens again, so
 * this is the one way left to settle it without risking a second refund. A refund the bank
 * sent back says so and leads to its row on the bounced refunds list, where the money is
 * sent back some other way.
 *
 * Drawn by `BookingLive` rather than the page, so a press finished here starts the same wait
 * for the refund total that a refund from the dialog does (`onRefunded`).
 *
 * `null` is a read that failed, said as such rather than drawn as no card: no card already
 * means "nobody refunded this way", and an unconfirmed press hidden by a failed read is one
 * nobody would think to finish.
 */
export const BookingAdjustments = ({
  bookingId,
  adjustments,
  onRefunded,
}: {
  bookingId: string;
  adjustments: BookingAdjustment[] | null;
  /** A press finished from the list — the page waits for its webhook. */
  onRefunded: () => void;
}) => {
  if (adjustments === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Refunds by admins</CardTitle>
          <CardDescription>
            The refunds could not be loaded right now. Reload the page to try
            again.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (adjustments.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refunds by admins</CardTitle>
        <CardDescription>
          Sent without cancelling the stay. The refund total above follows once
          Stripe reports each one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul role="list" className="flex flex-col divide-y">
          {adjustments.map((adjustment) => (
            <li
              key={adjustment.id}
              className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0"
            >
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {formatMoney(adjustment.amountCents, adjustment.currency)} by{" "}
                {adjustment.admin.name}
                {adjustment.refundId === null && (
                  <Badge variant="outline">Unconfirmed</Badge>
                )}
                {adjustment.bounce !== null && (
                  <Badge
                    variant={
                      adjustment.bounce === RefundFailureStatus.OPEN
                        ? "destructive"
                        : "outline"
                    }
                  >
                    {adjustment.bounce === RefundFailureStatus.OPEN
                      ? "Sent back by the bank"
                      : "Sent back, resolved"}
                  </Badge>
                )}
              </span>
              <span className="text-muted-foreground">
                {formatMoment(adjustment.createdAt)} UTC
                {adjustment.refundId !== null && (
                  <>
                    {" "}
                    · <span className="break-all">{adjustment.refundId}</span>
                  </>
                )}
              </span>
              <span className="break-words text-muted-foreground">
                “{adjustment.reason}”
              </span>
              {adjustment.refundId === null && (
                <FinishRefundButton
                  bookingId={bookingId}
                  press={{
                    amountCents: adjustment.amountCents,
                    reason: adjustment.reason,
                    requestId: adjustment.requestId,
                  }}
                  onRefunded={onRefunded}
                />
              )}
              {adjustment.refundId !== null && adjustment.bounce !== null && (
                <Link
                  href={setAsideHref("bounced", {
                    refundId: adjustment.refundId,
                    status: adjustment.bounce,
                  })}
                  className="self-start hover:underline"
                >
                  Open it on the bounced refunds
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};
