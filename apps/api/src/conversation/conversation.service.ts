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
import { RealtimeService } from "../realtime/realtime.service";
import { unreadFieldsOf } from "../unread/unread.types";
import {
  type AppendedMessage,
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

/**
 * The threads, and the news of them on the account's event stream: every message is
 * published to both sides, and opening a thread to the reader's other tabs. The row comes
 * first and the event second, as with a notification — a publish never throws, and what a
 * lost one costs is repaired by the next event or the next `sync`.
 *
 * A message is not a notification: the thread holds its own unread state, and a notice
 * per message would bury the bookings and the reviews on the bell.
 */
@Injectable()
export class ConversationService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly realtimeService: RealtimeService,
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
   * A user reads one scope — every thread their account is a side of, as a guest and as a
   * host — unlike the stays, where `side` picks one half. A thread's two people are fixed
   * by its rows, which is how `sideOf` decides them too, so the list and the thread cannot
   * disagree. The switch is exhaustive for the reason
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
      const { conversation, ...appended } =
        await this.conversationRepository.start(guestId, input);

      await this.announce(appended);

      return conversation;
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

    let appended: AppendedMessage;

    try {
      appended = await this.conversationRepository.append(id, side, input.body);
    } catch (error) {
      // The thread went with its guest's account after `sideOf` read it.
      if (error instanceof ConversationNotFoundError) throw notFound(id);

      throw error;
    }

    await this.announce(appended);

    return appended.message;
  }

  /**
   * A read that moved nothing — a second tab, a thread already read — is news to nobody,
   * the rule `NotificationService` follows for its own marks.
   */
  async markRead(
    id: string,
    user: AuthenticatedUser,
    input: MarkReadInput,
  ): Promise<void> {
    const side = await this.sideOf(id, user);
    const counts = await this.conversationRepository.markRead(
      id,
      side,
      new Date(input.upTo),
      user.id,
    );

    if (counts !== null) {
      await this.realtimeService.publish(user.id, {
        type: "conversation.read",
        conversationId: id,
        ...unreadFieldsOf(counts),
      });
    }
  }

  /**
   * To both sides, each with its own counts: the other side has news, and the sender's
   * other tabs have a thread to redraw — and, if the sender had not opened it since the last
   * reply, one unread thread fewer.
   */
  private async announce({ message, unread }: AppendedMessage): Promise<void> {
    await Promise.all(
      unread.map(({ userId, counts }) =>
        this.realtimeService.publish(userId, {
          type: "message.created",
          message,
          ...unreadFieldsOf(counts),
        }),
      ),
    );
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
