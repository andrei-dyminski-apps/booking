/**
 * How the inbox hands a recorded event to its worker — the port the dispatcher queues
 * through, so the application layer names no queue. `PaymentEventQueue` is the adapter.
 * Never throws: the event is in the database already, and the sweep finds one whose job
 * never got written.
 */
export abstract class PaymentEventJobs {
  abstract process(eventId: string): Promise<void>;
}
