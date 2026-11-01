import { BookingStatus } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import { BOOKING_STATUS_LABELS } from "../model/status-labels";

/**
 * The four states of a stay. The record is keyed by the contract's own enum rather than
 * switched over, so a fifth status stops compiling here instead of rendering as an empty
 * badge.
 *
 * What each of them is called is `BOOKING_STATUS_LABELS`, which the stays screen's filter
 * offers as well: a status named one thing in the box and another on the row is two names
 * for one value. Only the colour is decided here.
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
  <Badge variant={VARIANT[status]}>{BOOKING_STATUS_LABELS[status]}</Badge>
);
