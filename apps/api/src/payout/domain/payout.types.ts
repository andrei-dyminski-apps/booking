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
  /** Whether the stay was paid out — by a transfer, or by the host's fees taking it whole. */
  paidOut: boolean;
  /** What the transfer holds of this stay now; `null` before the payout. */
  paidOutAmountCents: Cents | null;
  /**
   * What a payout under way means to send, fixed before the transfer; `null` when none is
   * under way — before the payout, or once it is recorded.
   */
  payoutReservedCents: Cents | null;
  /** How many reservations the payout has made — the current one's number keys its transfer. */
  payoutReservations: number;
  /**
   * What the payout kept back towards the host's fees, from its reservation on: with
   * `paidOutAmountCents`, what the host holds of the stay.
   */
  feeWithheldCents: Cents;
  hold: ReleasedHold;
  destination: PayoutDestination;
};

/** Who reads a host's fees: only an admin is told which admin waived one. */
export type HostFeeReader = "host" | "admin";

export type PayoutAccountHolder = PayoutDestination & {
  email: string;
  name: string;
};

/** What a host holds of a stay: the transfer, and what was kept back towards their fees. */
export type Holding = { paidOut: Cents; withheld: Cents };

/** A payout fixed before its transfer: what to send, and what is kept back towards fees. */
export type PayoutReservation = { send: Cents; withheld: Cents };

/** What a transfer sent; `transferId` is `null` when the fees took the share whole. */
export type RecordedPayout = { transferId: string | null; sent: Cents };

/** The writes a settlement makes, each only over what it read. */
export type SettlementWrites = {
  /** What the host holds after a reversal or a refund the withheld cannot keep. */
  settlement: (from: Holding, to: Holding) => Promise<boolean>;
  /** A transfer a run sent and never recorded, found again. */
  payout: (payout: RecordedPayout) => Promise<boolean>;
  /** A reservation no transfer was sent for, handed back: what it kept back is owed again. */
  release: (reservation: PayoutReservation) => Promise<boolean>;
};
