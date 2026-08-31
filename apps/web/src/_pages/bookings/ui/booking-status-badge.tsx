import { BookingStatus } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import { STATUS_LABELS } from "../lib/bookings-search";

/**
 * The four states of a stay. The record is keyed by the contract's own enum rather than
 * switched over, so a fifth status stops compiling here instead of rendering as an empty
 * badge.
 *
 * What each of them is called lives beside the filter that offers it (`STATUS_LABELS`):
 * a status named one thing in the box and another on the row is two names for one value.
 * Only the colour is decided here.
 *
 * A hold and a lapsed hold are the two this application can actually produce: nothing pays
 * yet, so `CONFIRMED` waits for the payment step.
 */
const VARIANT: Record<
  BookingStatus,
  "default" | "outline" | "secondary" | "destructive"
> = {
  [BookingStatus.PENDING_PAYMENT]: "outline",
  [BookingStatus.CONFIRMED]: "default",
  [BookingStatus.CANCELLED]: "destructive",
  [BookingStatus.EXPIRED]: "secondary",
};

export const BookingStatusBadge = ({ status }: { status: BookingStatus }) => (
  <Badge variant={VARIANT[status]}>{STATUS_LABELS[status]}</Badge>
);
