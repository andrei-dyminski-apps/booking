import { RetryLaterError } from "../../common/retry-later.error";

/** Another run settles the stay; it lets go within its lease, so this is a retry, not a failure. */
export class SettlementInProgressError extends RetryLaterError {
  constructor(bookingId: string) {
    super(`The payout of booking ${bookingId} is being settled by another run`);
    this.name = "SettlementInProgressError";
  }
}

/**
 * What `HostFeeRepository.waive` throws when the account behind the admin's token is gone:
 * the token outlives the row (a reseed, a deletion), and the waiver names who made it.
 */
export class WaivingAccountGoneError extends Error {
  constructor(adminId: string) {
    super(`User ${adminId} no longer exists`);
    this.name = "WaivingAccountGoneError";
  }
}

/**
 * What `HostFeeRepository.waive` throws when the account behind the token is no longer an
 * active admin: its role or its block was written in the database after the token was
 * issued, and `JwtStrategy` reads no database, so the token still claims `ADMIN`.
 */
export class WaivingAccountNotAdminError extends Error {
  constructor(adminId: string) {
    super(`User ${adminId} is no longer an active admin`);
    this.name = "WaivingAccountNotAdminError";
  }
}
