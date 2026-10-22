import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  NotificationType,
  Role,
  type JoinWaitlistInput,
  type WaitlistDemandEntry,
  type WaitlistDemandPage,
  type WaitlistDemandQuery,
  type WaitlistEntry,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { readCursor, type Page } from "../common/paging";
import { NotificationService } from "../notification/notification.service";
import {
  decodeCursor,
  encodeCursor,
  type WaitlistCursor,
} from "./waitlist-cursor";
import {
  NightsAvailableError,
  WaiterHoldsNightsError,
  WaiterNotFoundError,
  WaitlistFullError,
  WaitlistListingNotFoundError,
  WaitlistOwnListingError,
  WaitlistRepository,
} from "./waitlist.repository";
import type { FreedNights } from "./waitlist.types";

/**
 * Who is waiting for which nights, and telling them when the nights come free.
 *
 * A notice rather than a booking made on the waiter's behalf, deliberately. A booking here
 * is a hold that lapses in fifteen minutes unless its guest pays: taken for somebody who
 * is not looking, it would most often lapse unpaid — the nights off the calendar for a
 * quarter of an hour, then a second round of notices. It would also commit them to a price
 * that may have changed and to plans that may have moved since they joined. So everybody
 * waiting for the nights is told at once, and the first to book takes them, through the
 * same transaction as anybody else.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    private readonly waitlistRepository: WaitlistRepository,
    private readonly notificationService: NotificationService,
  ) {}

  findMine(userId: string): Promise<WaitlistEntry[]> {
    return this.waitlistRepository.findFor(userId);
  }

  /**
   * One page of the ranges waited for on the listings this caller may see: a user's own
   * listings, an admin every listing on the site. The scope is the role's, never a
   * parameter, and an unreadable cursor is a `400` — both for the reasons
   * `BookingService.findPage` gives.
   */
  async findDemand(
    user: AuthenticatedUser,
    query: WaitlistDemandQuery,
  ): Promise<WaitlistDemandPage> {
    const cursor = readCursor(query.cursor, query.sort, decodeCursor);
    const { items, hasMore } = await this.demandFor(user, query, cursor);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(last, query.sort) : null,
    };
  }

  /** Exhaustive over the role, with the `never` default `BookingService.pageFor` explains. */
  private demandFor(
    user: AuthenticatedUser,
    query: WaitlistDemandQuery,
    cursor: WaitlistCursor | null,
  ): Promise<Page<WaitlistDemandEntry>> {
    switch (user.role) {
      case Role.ADMIN:
        return this.waitlistRepository.findPageForEveryone(query, cursor);
      case Role.USER:
        return this.waitlistRepository.findPageForListingOwner(
          user.id,
          query,
          cursor,
        );
      default: {
        const unknownRole: never = user.role;

        throw new ForbiddenException(
          `Unknown role ${JSON.stringify(unknownRole)}`,
        );
      }
    }
  }

  /**
   * The refusals of `WaitlistRepository.join`, answered the way a booking's are — and only
   * free nights are a `409`, because that one is the calendar having moved: the client
   * reads it again on that status alone. A full list and one's own stay are a `403`, the
   * caller's own limit rather than news about the nights.
   *
   * Once the entry is in, the nights are announced as if just freed. `join` locks the
   * listing, but a cancellation and a lapsing hold do not: one can commit after `join`
   * read the nights as held and run its own announcement before the entry is committed,
   * which would leave the entry waiting for nights already free. Read after the commit, the
   * release is either visible here or its announcement sees the entry.
   */
  async join(userId: string, input: JoinWaitlistInput): Promise<WaitlistEntry> {
    let entry: WaitlistEntry;

    try {
      entry = await this.waitlistRepository.join(userId, input);
    } catch (error) {
      if (error instanceof WaitlistListingNotFoundError) {
        throw new NotFoundException(error.message);
      }

      if (error instanceof WaitlistOwnListingError) {
        throw new ForbiddenException(
          "You cannot join the waitlist of your own listing",
        );
      }

      if (error instanceof WaiterNotFoundError) {
        throw new UnauthorizedException("Session no longer exists");
      }

      if (
        error instanceof WaitlistFullError ||
        error instanceof WaiterHoldsNightsError
      ) {
        throw new ForbiddenException(error.message);
      }

      if (error instanceof NightsAvailableError) {
        throw new ConflictException(error.message);
      }

      throw error;
    }

    await this.announceFreed([input]);

    return entry;
  }

  async leave(userId: string, id: string): Promise<void> {
    if (!(await this.waitlistRepository.leave(userId, id))) {
      throw new NotFoundException(`Waitlist entry ${id} not found`);
    }
  }

  /**
   * What `BookingService` calls after nights stopped being held. Never throws, for the
   * reason `NotificationService.notify` does not: the cancellation or the release is
   * committed by then, and failing its request would answer a write that happened with a
   * `500`. A failure costs the notices, and is logged.
   *
   * Entries are claimed — deleted — before their owners are told, and only the call that
   * deleted one tells anybody, so two releases racing over the same nights cannot tell one
   * person twice. That makes the notice at most once, the trade every `notify` makes. The
   * waiters are different people, so they are told at once rather than one after another.
   */
  async announceFreed(freed: FreedNights[]): Promise<void> {
    for (const nights of freed) {
      try {
        const waiting = await this.waitlistRepository.findNowFree(nights);
        const claimed = await this.waitlistRepository.claim(
          waiting.map(({ id }) => id),
        );

        await Promise.all(
          waiting
            .filter(({ id }) => claimed.has(id))
            .map((entry) =>
              this.notificationService.notify(entry.userId, {
                type: NotificationType.WAITLIST_AVAILABLE,
                data: entry.nights,
              }),
            ),
        );
      } catch (error) {
        this.logger.error(
          `Could not announce the nights of listing ${nights.listingId} from ${nights.from} to ${nights.to}: ${String(error)}`,
        );
      }
    }
  }
}
