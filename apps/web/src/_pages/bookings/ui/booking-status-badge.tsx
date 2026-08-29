import { BookingStatus } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";

/**
 * The four states of a stay, named for a person. The record is keyed by the contract's own
 * enum rather than switched over, so a fifth status stops compiling here instead of
 * rendering as an empty badge.
 *
 * A hold and a lapsed hold are the two this application can actually produce: nothing
 * pays yet, so `CONFIRMED` waits for the payment step.
 */
const STATUS: Record<
  BookingStatus,
  {
    label: string;
    variant: "default" | "outline" | "secondary" | "destructive";
  }
> = {
  [BookingStatus.PENDING_PAYMENT]: { label: "On hold", variant: "outline" },
  [BookingStatus.CONFIRMED]: { label: "Confirmed", variant: "default" },
  [BookingStatus.CANCELLED]: { label: "Cancelled", variant: "destructive" },
  [BookingStatus.EXPIRED]: { label: "Lapsed", variant: "secondary" },
};

export const BookingStatusBadge = ({ status }: { status: BookingStatus }) => (
  <Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>
);
