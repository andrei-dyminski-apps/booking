import { hostShare, Role } from "@repo/contracts";
import type { AuthenticatedUser } from "../../../auth/auth.types";
import { cents, NO_CENTS, type Cents } from "../../../payment/domain/money";
import type { SettledStay } from "../../domain/payout.types";

/*
 * The fixtures the payout specs and the fakes beside this file share. Kept out of the
 * build by `tsconfig.build.json` (`*.fakes.ts`), like every file of this directory.
 */
export const GUEST_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const HOST_ID = "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f";
export const BOOKING_ID = "2f3a4b5c-6d7e-4f80-9a1b-2c3d4e5f6a7b";
export const LISTING_ID = "3a4b5c6d-7e8f-4091-8a2b-3c4d5e6f7a8b";
export const ACCOUNT_ID = "acct_host";
export const PAYMENT_ID = "pi_1";
export const CHARGE_ID = "ch_1";

/**
 * What the stay cost, and the host's share of it — read off the contract's own rule rather
 * than restated: the rate and the rounding are `hostShare`'s, pinned by its own spec, and
 * what the specs check is what the services do with the share.
 */
export const AMOUNT = cents(48_000);
export const SHARE = hostShare(AMOUNT, NO_CENTS);
/** 80 of the stay refunded and 180, and the host's share once each has been. */
export const REFUNDED_80 = cents(8_000);
export const REFUNDED_180 = cents(18_000);
export const SHARE_AFTER_80 = hostShare(AMOUNT, REFUNDED_80);
export const SHARE_AFTER_180 = hostShare(AMOUNT, REFUNDED_180);

/** A check-in long enough ago that the payout is due, and one far enough ahead it is not. */
export const PAST = "2026-01-10";
export const FUTURE = "2099-01-10";

export const host: AuthenticatedUser = {
  id: HOST_ID,
  email: "host@example.com",
  role: Role.USER,
};

/**
 * The destination is read off the host whenever the stay is, as the real join does, and
 * whether it was paid out off the amount the payout wrote — the real `paid_out_at` is
 * written in the same statement.
 */
export type StoredStay = Omit<SettledStay, "destination" | "paidOut"> & {
  paymentId: string;
};

/** A host's fee as the ledger holds it, oldest first in `fees`. */
export type StoredFee = {
  id: string;
  hostId: string;
  amountCents: Cents;
  withheldCents: Cents;
  waived: boolean;
};
