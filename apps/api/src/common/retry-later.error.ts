/**
 * A failure that is nobody's fault: another run holds what this one needs — a lease on the
 * stay — and lets go on its own, so the job or the event simply comes again. The processors
 * log it as a warning without a stack (`logJobFailure`), so it does not read as the errors
 * that need a person.
 */
export abstract class RetryLaterError extends Error {}
