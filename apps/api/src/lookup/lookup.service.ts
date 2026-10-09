import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  LookupKind,
  Role,
  type LookupOption,
  type LookupPage,
  type LookupQuery,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { readCursor, type Page } from "../common/paging";
import {
  decodeCursor,
  encodeCursor,
  LOOKUP_SORT,
  type LookupCursor,
} from "./lookup-cursor";
import { LookupRepository } from "./lookup.repository";

/**
 * What a filter box suggests. The guard has already said which roles may ask; what is left
 * here is the scope of the two lookups over stays, which follows the role exactly as
 * `GET /bookings` does — a guest is offered what their own stays name, an owner what the
 * stays against their listings name, an admin what everybody's do.
 */
@Injectable()
export class LookupService {
  constructor(private readonly lookupRepository: LookupRepository) {}

  /** The owners of what is on offer — the admin's alone, and so the one with no scope. */
  owners(query: LookupQuery): Promise<LookupPage> {
    return this.page(LookupKind.owners, query, (cursor) =>
      this.lookupRepository.findOwners(query, cursor),
    );
  }

  /**
   * A guest's scope is themselves, so there is nobody for them to look up: `@Roles`
   * refuses them before this, and the switch refuses them again rather than falling
   * through to a query — exhaustive, `default` included, for the reason
   * `BookingService.pageFor` gives.
   */
  guests(user: AuthenticatedUser, query: LookupQuery): Promise<LookupPage> {
    return this.page(LookupKind.guests, query, (cursor) => {
      switch (user.role) {
        case Role.ADMIN:
          return this.lookupRepository.findGuestsOfEveryone(query, cursor);
        case Role.OWNER:
          return this.lookupRepository.findGuestsOfListingOwner(
            user.id,
            query,
            cursor,
          );
        case Role.USER:
          throw new ForbiddenException(
            "A guest has nobody else's stays to filter",
          );
        default: {
          const unknownRole: never = user.role;

          throw new ForbiddenException(
            `Unknown role ${JSON.stringify(unknownRole)}`,
          );
        }
      }
    });
  }

  /**
   * The one lookup every role may ask, because every role has a list of stays to filter
   * by listing: a guest is offered the listings they stayed in, which is their scope of
   * `GET /bookings` too.
   */
  listings(user: AuthenticatedUser, query: LookupQuery): Promise<LookupPage> {
    return this.page(LookupKind.listings, query, (cursor) => {
      switch (user.role) {
        case Role.ADMIN:
          return this.lookupRepository.findListingsOfEveryone(query, cursor);
        case Role.OWNER:
          return this.lookupRepository.findListingsOfListingOwner(
            user.id,
            query,
            cursor,
          );
        case Role.USER:
          return this.lookupRepository.findListingsOfGuest(
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
    });
  }

  /**
   * The cursor is this API's own, so an unreadable one is a `400` rather than a silent
   * first page — the reason `readCursor` states for every list — and one issued by another
   * kind of lookup is unreadable here. `nextCursor` is issued only when there is a page
   * after this one.
   */
  private async page(
    kind: LookupKind,
    query: LookupQuery,
    read: (cursor: LookupCursor | null) => Promise<Page<LookupOption>>,
  ): Promise<LookupPage> {
    const cursor = readCursor(query.cursor, LOOKUP_SORT, decodeCursor(kind));
    const { items, hasMore } = await read(cursor);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(kind, last) : null,
    };
  }
}
