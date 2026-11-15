import type { Logger } from "@nestjs/common";

/** What says a connection is back: an ioredis client, or a BullMQ queue's or worker's backend. */
export type ReadySignal = {
  once(event: "ready", listener: () => void): unknown;
};

/**
 * The codes a socket that cannot reach Redis fails with, and ioredis' own text for a
 * command sent on a connection that has gone away. Anything else is not an outage.
 */
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

const CLOSED_CONNECTION_MESSAGE = "Connection is closed.";

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const { code } = error as Error & { code?: unknown };

  return (
    (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) ||
    error.message === CLOSED_CONNECTION_MESSAGE
  );
}

/**
 * The log of one Redis client's `error` events: a warning when it loses Redis, a line when
 * it has it back, and nothing in between. ioredis retries on a backoff — from a second up
 * to twenty for a BullMQ connection, from 50 ms up to two seconds for a plain client — and
 * reports each attempt, and a BullMQ queue or worker with no `error` listener writes each
 * one with its stack to stderr, outside the structured log — over a thousand lines in ten
 * seconds of an outage.
 *
 * While the connection is down every error is part of the outage and stays quiet; one
 * that is not about the connection, while it is up, is logged as an error each time.
 *
 * A worker's backend owns two connections, the main one and the blocking one, and fires
 * `ready` for either: its "reached Redis again" comes as the first of them is back, and
 * the other follows on its own next retry.
 */
export class RedisOutage {
  private down = false;

  constructor(
    private readonly logger: Pick<Logger, "warn" | "log" | "error">,
    private readonly client: string,
  ) {}

  report(error: unknown, connection: ReadySignal): void {
    if (this.down) return;

    if (!isConnectionError(error)) {
      this.logger.error(
        `${this.client}: ${String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      return;
    }

    this.down = true;
    this.logger.warn(
      `${this.client} lost Redis, retrying until it is back: ${String(error)}`,
    );
    connection.once("ready", () => {
      this.down = false;
      this.logger.log(`${this.client} reached Redis again`);
    });
  }
}
