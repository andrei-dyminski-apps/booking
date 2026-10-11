import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ConversationSide,
  Role,
  type Conversation,
  type ConversationPage,
  type ConversationQuery,
  type MarkReadInput,
  type Message,
  type MessagePage,
  type MessageQuery,
  type SendMessageInput,
  type StartConversationInput,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { readCursor, type Page } from "../common/paging";
import {
  ConversationNotFoundError,
  ConversationRepository,
  GuestNotFoundError,
  ListingNotFoundError,
  OwnListingError,
} from "./conversation.repository";
import {
  decodeConversationCursor,
  decodeMessageCursor,
  encodeConversationCursor,
  encodeMessageCursor,
  NEWEST,
  RECENT,
  type ConversationCursor,
} from "./conversation-cursor";

@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
  ) {}

  /**
   * One page of the threads this caller is a side of. The scope is their account's, the
   * `listingId` filter narrows it, and the cursor is this API's own.
   */
  async findPage(
    user: AuthenticatedUser,
    query: ConversationQuery,
  ): Promise<ConversationPage> {
    const cursor = readCursor(query.cursor, RECENT, decodeConversationCursor);
    const { items, hasMore } = await this.pageFor(user, query, cursor);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeConversationCursor(last) : null,
    };
  }

  /**
   * A guest and a host read the same scope — every thread their account is a side of —
   * unlike the stays, where a role is one persona. A thread's two people are fixed by its
   * rows, which is how `sideOf` decides them too, so the list and the thread cannot
   * disagree: an account promoted to `OWNER` keeps the threads it started as a guest in its
   * list as well as at their address. The switch is exhaustive for the reason
   * `BookingService.pageFor` gives; an admin is refused by `@Roles` before reaching it, and
   * refused again here rather than handed a scope nobody wrote down: a thread is a private
   * exchange between two people, and no third role reads it.
   */
  private pageFor(
    user: AuthenticatedUser,
    query: ConversationQuery,
    cursor: ConversationCursor | null,
  ): Promise<Page<Conversation>> {
    switch (user.role) {
      case Role.USER:
      case Role.OWNER:
        return this.conversationRepository.findPageFor(user.id, query, cursor);
      case Role.ADMIN:
        throw new ForbiddenException("Conversations are read by their sides");
      default: {
        const unknownRole: never = user.role;

        throw new ForbiddenException(
          `Unknown role ${JSON.stringify(unknownRole)}`,
        );
      }
    }
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<Conversation> {
    const side = await this.sideOf(id, user);
    const conversation = await this.conversationRepository.findById(id, side);

    if (conversation === null) throw notFound(id);

    return conversation;
  }

  /**
   * The guest writes first, about a listing on offer. A second first message about the
   * same listing continues the thread the guest already has — the answer is that thread
   * either way, and a screen sends its author to it.
   */
  async start(
    guestId: string,
    input: StartConversationInput,
  ): Promise<Conversation> {
    try {
      return await this.conversationRepository.start(guestId, input);
    } catch (error) {
      if (error instanceof ListingNotFoundError) {
        throw new NotFoundException(error.message);
      }

      if (error instanceof OwnListingError) {
        throw new ForbiddenException("You cannot write to yourself");
      }

      // An ended session, answered the way `BookingService.create` answers it.
      if (error instanceof GuestNotFoundError) {
        throw new UnauthorizedException("Session no longer exists");
      }

      throw error;
    }
  }

  async findMessages(
    id: string,
    user: AuthenticatedUser,
    query: MessageQuery,
  ): Promise<MessagePage> {
    await this.sideOf(id, user);

    const cursor = readCursor(query.cursor, NEWEST, decodeMessageCursor);
    const { items, hasMore } =
      await this.conversationRepository.findMessagePage(id, query, cursor);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeMessageCursor(last) : null,
    };
  }

  /**
   * Either side may write, and a retired listing does not close the thread: whatever the
   * two of them still have to settle about a stay outlives the offer.
   */
  async send(
    id: string,
    user: AuthenticatedUser,
    input: SendMessageInput,
  ): Promise<Message> {
    const side = await this.sideOf(id, user);

    try {
      return await this.conversationRepository.append(id, side, input.body);
    } catch (error) {
      // The thread went with its guest's account after `sideOf` read it.
      if (error instanceof ConversationNotFoundError) throw notFound(id);

      throw error;
    }
  }

  async markRead(
    id: string,
    user: AuthenticatedUser,
    input: MarkReadInput,
  ): Promise<void> {
    const side = await this.sideOf(id, user);

    await this.conversationRepository.markRead(id, side, new Date(input.upTo));
  }

  /**
   * Which of the two sides the caller is, or a `404` for somebody who is neither. Not a
   * `403`: nothing lets a stranger list threads, so refusing one by name would be the one
   * way to learn that its id exists — the rule `BookingService.getReadable` follows.
   *
   * Decided by the account rather than the role. The two people of a thread are fixed by
   * its rows — the guest who wrote, and whoever owns the listing — and a role that changed
   * since does not make either of them somebody else.
   */
  private async sideOf(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ConversationSide> {
    const participants = await this.conversationRepository.findParticipants(id);

    if (participants?.guestId === user.id) return ConversationSide.GUEST;
    if (participants?.hostId === user.id) return ConversationSide.HOST;

    throw notFound(id);
  }
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Conversation ${id} not found`);
}
