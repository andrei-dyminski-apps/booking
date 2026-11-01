import type { BookingStatus } from "@repo/contracts";
import type { ReleasedHold } from "../../booking/domain/booking.types";
import type { Cents } from "../../payment/domain/money";
import type { PayoutFacts } from "./payout";

export type PayoutDestination = {
  accountId: string | null;
  enabled: boolean;
};

/** A stay's money after its payment, and where its host is paid. */
export type SettledStay = PayoutFacts & {
  bookingId: string;
  status: BookingStatus;
  chargeId: string | null;
  transferId: string | null;
  /** What the host holds of this stay now; `null` before a transfer. */
  paidOutAmountCents: Cents | null;
  hold: ReleasedHold;
  destination: PayoutDestination;
};

export type PayoutAccountHolder = PayoutDestination & {
  email: string;
  name: string;
};
