/**
 * How the inbox hands a recorded event to its worker. Never throws: the event is in the
 * database already, and the sweep finds one whose job never got written.
 */
export abstract class PaymentEventJobs {
  abstract process(eventId: string): Promise<void>;
}
