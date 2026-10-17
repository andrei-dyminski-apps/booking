import { Controller, Logger, Sse, type MessageEvent } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import type { ServerEvent } from "@repo/contracts";
import {
  catchError,
  defer,
  EMPTY,
  interval,
  map,
  merge,
  type Observable,
  takeUntil,
  timer,
} from "rxjs";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RealtimeService } from "../realtime/realtime.service";
import { UnreadService } from "../unread/unread.service";
import { unreadFieldsOf } from "../unread/unread.types";

/**
 * Often enough that no proxy between here and a browser takes the stream for idle and
 * closes it — the usual idle limits are a minute or more — and rarely enough to cost
 * nothing. A comment line, so a client sees no event for it.
 */
const HEARTBEAT_MS = 25_000;

/**
 * How long one connection is served before the API closes it, and the browser's
 * `EventSource` opens the next one by itself. The application closing ends every stream
 * sooner — see `RealtimeService.closing`.
 *
 * The guard checks the access token when the stream opens and never again, so without a
 * bound a stream would outlive the token it was opened with — and with it a block or a
 * role change, which the API otherwise enforces within `JWT_ACCESS_TTL`. Closing it is what
 * makes the reconnect pass the guard again: a live session reconnects unnoticed, an expired
 * token is a `401` the frontend answers with one refresh, and a blocked account is turned
 * away. Each reconnect starts with a `sync`, so nothing is lost across it.
 */
const STREAM_LIFETIME_MS = 5 * 60 * 1000;

/**
 * `GET /events` — the one stream a signed-in browser holds open, as Server-Sent Events.
 * One-way is all a push needs: everything a browser says to the API goes through the
 * ordinary routes, which keep their validation, their throttling and their guard, and the
 * stream only says that something changed. SSE is also plain HTTP, so it travels through
 * the frontend's proxy like any other response and carries the session cookie with it — a
 * WebSocket could do neither through a Next.js route handler.
 *
 * Every event is a JSON `data:` line of the contract's `serverEventSchema`, sent as the
 * default event type: a client reads one `message` listener and switches on `type`, and a
 * new member of the union needs no new listener.
 *
 * Behind the global guard like everything else: the stream is the caller's own account.
 */
@Controller("events")
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly realtimeService: RealtimeService,
    private readonly unreadService: UnreadService,
  ) {}

  @Sse()
  // The body is a stream of frames rather than one JSON document, so there is no DTO to
  // hand over: what is described is the media type, and the shape of each `data` line is
  // named in words.
  @ApiOkResponse({
    description:
      "Server-Sent Events: each `data` line is one value of `serverEventSchema`, the first one a `sync`",
    content: { "text/event-stream": { schema: { type: "string" } } },
  })
  stream(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    const events = this.realtimeService
      .eventsOf(user.id, this.syncOf(user.id))
      .pipe(map((event): MessageEvent => ({ data: event })));

    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ comment: "keep-alive" })),
    );

    // Ended rather than errored when the channel could not be subscribed: an error would
    // reach the browser as an `error` event, and a plain end is what `EventSource` answers
    // with a reconnect — which subscribes again. See `RealtimeService.eventsOf`.
    return merge(events, heartbeat).pipe(
      takeUntil(merge(timer(STREAM_LIFETIME_MS), this.realtimeService.closing)),
      catchError(() => EMPTY),
    );
  }

  /**
   * What a fresh connection is told first: the counts, which is all a client needs to be
   * right again after any gap. A failure to read them leaves the stream open without it —
   * the live events still carry the counts, and the next reconnect asks again.
   */
  private syncOf(userId: string): Observable<ServerEvent> {
    return defer(() => this.unreadService.count(userId)).pipe(
      map(
        (counts): ServerEvent => ({ type: "sync", ...unreadFieldsOf(counts) }),
      ),
      catchError((error: unknown) => {
        this.logger.warn(
          `Could not count what ${userId} has unread: ${String(error)}`,
        );

        return EMPTY;
      }),
    );
  }
}
