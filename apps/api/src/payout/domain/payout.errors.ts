/** Another run settles the stay; it lets go within its lease, so this is a retry, not a failure. */
export class SettlementInProgressError extends Error {
  constructor(bookingId: string) {
    super(`The payout of booking ${bookingId} is being settled by another run`);
    this.name = "SettlementInProgressError";
  }
}
