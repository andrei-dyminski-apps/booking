/**
 * No call fails the caller: the hourly sweep pays what a lost payout job would have, and an
 * account whose close could not be queued is logged for a person to close.
 */
/**
 * An account opened for `userId` that lost the race to the column, which holds `attached`:
 * the user is named so a person told to close it by hand can tell whose it was.
 */
export type AccountClose = {
  accountId: string;
  userId: string;
  attached: string | null;
};

/** How every line about an account close names it. */
export function describeClose({
  accountId,
  userId,
  attached,
}: AccountClose): string {
  return `account ${accountId} of user ${userId}, who holds ${attached ?? "none"}`;
}

export abstract class PayoutJobs {
  abstract schedulePayout(bookingId: string, runAt: Date): Promise<void>;

  abstract schedulePayoutsOf(hostId: string): Promise<void>;

  abstract scheduleAccountClose(close: AccountClose): Promise<void>;
}
