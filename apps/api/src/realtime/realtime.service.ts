import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { serverEventSchema, type ServerEvent } from "@repo/contracts";
import { Redis } from "ioredis";
import { from, Observable, ReplaySubject, switchMap } from "rxjs";
import { requireRedisUrl } from "../common/redis-url";

/** One channel per account: whatever is published there reaches every tab it has open. */
const CHANNEL_PREFIX = "realtime:user:";

const channelOf = (userId: string): string => `${CHANNEL_PREFIX}${userId}`;

type Listener = (event: ServerEvent) => void;

/**
 * The tabs of one account open on this instance, and the subscription of its channel they
 * share. `subscribed` settles once Redis has confirmed the channel, and rejects if it never
 * did — see `eventsOf`.
 */
type Channel = {
  listeners: Set<Listener>;
  subscribed: Promise<void>;
};

/**
 * How long a publish may take before the request that made it gives up on it. Without a
 * bound a connection that is up but silent — a network partition with no reset — would
 * hold every booking, review and mark-as-read open, each behind a write that has already
 * committed. A second is long for a `PUBLISH` and short for a request.
 */
const PUBLISH_TIMEOUT_MS = 1_000;

/**
 * The transport of everything the API pushes to a browser, and nothing about what is
 * pushed: a domain module calls `publish` with an event of the contract's union, and the
 * stream behind `GET /events` hands each connection `eventsOf` its own account.
 *
 * **Redis pub/sub rather than an in-process emitter**, because the process that writes a
 * notification is not necessarily the one holding the recipient's connection: two
 * instances of the API behind a load balancer, or a BullMQ worker that runs elsewhere, are
 * both a publish that an emitter would deliver to nobody. Redis is already a dependency
 * (the hold-expiry queue), so this costs two connections rather than a new service.
 *
 * **Delivery is best effort, and the stream is not the record.** Pub/sub keeps nothing for
 * a subscriber that was not listening — a tab between two connections, an instance that
 * restarted — so whatever is worth keeping is written to Postgres first (a notification
 * row) and the event only says that it happened. Every connection begins with a `sync`
 * that restates the counts, which is what repairs whatever was missed.
 *
 * Two connections, because a Redis connection that has subscribed to anything can do
 * nothing else. The subscriber holds one channel per account with a tab open here, counted
 * by `channels` so the last tab to close is what unsubscribes.
 *
 * **It also ends the streams when the application closes.** A stream has no end of its
 * own short of its lifetime, and Express closes its server only once every response has
 * ended — so without `closing` a deploy, or a restart under `nest start --watch`, would
 * wait out the lifetime of the newest stream. Nest calls `onModuleDestroy` before it closes
 * the HTTP server, which is what makes this the place for it.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);

  private readonly channels = new Map<string, Channel>();

  private readonly closingSubject = new ReplaySubject<void>(1);

  /**
   * Emits once, when the application starts closing — and at once to a stream that opens
   * after that, which is what a `ReplaySubject` is for.
   */
  readonly closing: Observable<void> = this.closingSubject.asObservable();

  /**
   * Fails a command at once while disconnected instead of queueing it, and after
   * `PUBLISH_TIMEOUT_MS` on a connection that stopped answering: a publish is made on behalf
   * of a request that has already committed, and waiting would hold that request open for
   * as long as Redis stays away.
   */
  private readonly publisher = new Redis(requireRedisUrl(), {
    enableOfflineQueue: false,
    commandTimeout: PUBLISH_TIMEOUT_MS,
  });

  /**
   * Queues while disconnected, the opposite trade: a subscribe sent before the connection
   * is up should land once it is, and ioredis re-subscribes every channel after a
   * reconnect by itself.
   */
  private readonly subscriber = new Redis(requireRedisUrl());

  constructor() {
    this.subscriber.on("message", (channel: string, raw: string) => {
      this.deliver(channel, raw);
    });

    // Without a listener an `error` event is an uncaught exception; with one, ioredis
    // keeps reconnecting and this only says so.
    for (const connection of [this.publisher, this.subscriber]) {
      connection.on("error", (error: unknown) => {
        this.logger.warn(`Redis connection error: ${String(error)}`);
      });
    }
  }

  /**
   * Never throws. The caller has committed whatever the event announces, so a Redis that
   * is down costs the recipient the live update and nothing else — the row is there, and
   * the next `sync` counts it.
   */
  async publish(userId: string, event: ServerEvent): Promise<void> {
    try {
      await this.publisher.publish(channelOf(userId), JSON.stringify(event));
    } catch (error) {
      this.logger.warn(
        `Could not publish ${event.type} to user ${userId}: ${String(error)}`,
      );
    }
  }

  /**
   * The events of one account, for as long as somebody is subscribed, opened by `opening`
   * once the channel is subscribed. That order is the point of the parameter: whatever
   * `opening` reads — the counts of the `sync` — is read after the channel listens, so a
   * change made in between arrives as an event rather than falling into the gap.
   *
   * The first subscriber of an account subscribes the Redis channel and the last one to
   * leave unsubscribes it; ioredis sends the two commands in order on one connection, so a
   * tab that closes while another opens cannot leave the channel in the wrong state.
   *
   * A subscribe that fails — Redis away for longer than the subscriber's retries — errors
   * every stream waiting on it, and forgets the channel. A stream that stayed open would
   * hear nothing for as long as it lasted, and so would every tab of the account that
   * joined it later; an ended one is reconnected by the browser, and the next connection
   * subscribes again.
   */
  eventsOf(
    userId: string,
    opening: Observable<ServerEvent>,
  ): Observable<ServerEvent> {
    return new Observable<ServerEvent>((subscriber) => {
      const channel = this.join(userId);
      const listener: Listener = (event) => subscriber.next(event);

      channel.listeners.add(listener);

      const opened = from(channel.subscribed)
        .pipe(switchMap(() => opening))
        .subscribe({
          next: (event) => subscriber.next(event),
          error: (error: unknown) => subscriber.error(error),
        });

      return () => {
        opened.unsubscribe();
        this.leave(userId, channel, listener);
      };
    });
  }

  /**
   * `disconnect` rather than `quit`: a `QUIT` is a command, and a connection still being
   * established when the application closes — a test that boots and shuts the app down at
   * once — queues it behind a handshake and keeps the process alive. Nothing is waiting on
   * either connection by then: a publish is bounded by its timeout, and `closing` has just
   * ended every stream.
   */
  onModuleDestroy(): void {
    this.closingSubject.next();
    this.closingSubject.complete();
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }

  private join(userId: string): Channel {
    const existing = this.channels.get(userId);

    if (existing !== undefined) return existing;

    const name = channelOf(userId);
    const subscribed = this.subscriber.subscribe(name).then(() => undefined);
    const channel: Channel = { listeners: new Set(), subscribed };

    // Handled here once, whoever else is still waiting on it: the streams still open see
    // the rejection through `eventsOf`, and one that left before it settled must not
    // turn it into an unhandled rejection.
    void subscribed.catch((error: unknown) => {
      this.logger.warn(`Could not subscribe ${name}: ${String(error)}`);

      if (this.channels.get(userId) === channel) this.channels.delete(userId);
    });

    this.channels.set(userId, channel);

    return channel;
  }

  /**
   * Unsubscribes only the channel it joined: one that failed has been forgotten already, and
   * the account may have subscribed afresh since — a channel a later connection relies on.
   */
  private leave(userId: string, channel: Channel, listener: Listener): void {
    channel.listeners.delete(listener);

    if (channel.listeners.size > 0 || this.channels.get(userId) !== channel) {
      return;
    }

    this.channels.delete(userId);

    const name = channelOf(userId);

    this.subscriber.unsubscribe(name).catch((error: unknown) => {
      this.logger.warn(`Could not unsubscribe ${name}: ${String(error)}`);
    });
  }

  /**
   * Parsed against the contract like anything else that arrives from outside the process:
   * the channel is shared with every instance of this API, including one deployed from an
   * older version of the union. An event this one cannot read is dropped and logged rather
   * than forwarded for a browser to choke on.
   */
  private deliver(channel: string, raw: string): void {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;

    const listeners = this.channels.get(
      channel.slice(CHANNEL_PREFIX.length),
    )?.listeners;

    if (listeners === undefined) return;

    let payload: unknown;

    try {
      payload = JSON.parse(raw);
    } catch {
      payload = undefined;
    }

    const event = serverEventSchema.safeParse(payload);

    if (!event.success) {
      this.logger.warn(`Dropped an unreadable event on ${channel}`);

      return;
    }

    for (const listener of listeners) listener(event.data);
  }
}
