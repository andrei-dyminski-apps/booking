import type { FailedPaymentEvent } from "@repo/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { countOf, formatMoment } from "#shared/lib";
import { retryPaymentEventAction } from "../api/set-aside-actions";
import { LastError } from "./last-error";
import { RetryButton } from "./retry-button";

/**
 * A delivery of the payment provider the worker gave up on: which one, why, and since
 * when. Not its payload — what the event says is Stripe's to show, under the id below. The
 * usual order is a fix deployed first and the event retried after it.
 */
export const FailedEventCard = ({ event }: { event: FailedPaymentEvent }) => (
  <Card>
    <CardHeader>
      <CardTitle className="font-mono break-all">{event.type}</CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono break-all">{event.id}</span>
        <span>Received {formatMoment(event.receivedAt)} UTC</span>
        <span>
          Set aside {formatMoment(event.failedAt)} UTC after{" "}
          {countOf(event.attempts, "attempt")}
        </span>
      </CardDescription>
    </CardHeader>

    <CardContent>
      <LastError error={event.lastError} />
    </CardContent>

    <CardFooter>
      <RetryButton action={retryPaymentEventAction.bind(null, event.id)} />
    </CardFooter>
  </Card>
);
