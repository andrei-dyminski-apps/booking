import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  NotificationContent,
  NotificationPage,
  NotificationQuery,
  UnreadCount,
} from "@repo/contracts";
import { readCursor } from "../common/paging";
import { RealtimeService } from "../realtime/realtime.service";
import { unreadFieldsOf, type UnreadCounts } from "../unread/unread.types";
import { decodeCursor, encodeCursor } from "./notification-cursor";
import { NotificationRepository } from "./notification.repository";

/** The feed has one ordering — see `notificationSortSchema`. */
const SORT = "newest";

/**
 * What an account is told, and the bookkeeping of what it has read. Two halves, written in
 * that order every time: the row in Postgres, which is the record, then the event on the
 * account's channel, which is only the news that the record changed. A browser that missed
 * the event loses nothing but its timing — the next `sync` of the stream restates the
 * count, and the feed is read from the table.
 *
 * Other modules reach it through `notify` alone. The messages between users do not: a
 * message is a row of its own with an unread state of its own, and a notice per message
 * would bury everything else on the bell — `ConversationService` publishes its events
 * itself.
 *
 * The routes answer the bell's half of the counts — `{ unread, revision }` — and the events
 * carry both halves; the revision is one sequence across them.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly realtimeService: RealtimeService,
  ) {}

  /**
   * Never throws, and the reason is the caller: every notice announces something another
   * module has already committed — a booking, a cancellation, a review — and failing the
   * request now would answer a write that happened with a `500`. The same trade
   * `BookingExpiryQueue.scheduleExpiry` makes. What a failure costs is the notice itself,
   * which is logged.
   */
  async notify(userId: string, content: NotificationContent): Promise<void> {
    try {
      const { notification, count } = await this.notificationRepository.create(
        userId,
        content,
      );

      await this.realtimeService.publish(userId, {
        type: "notification.created",
        notification,
        ...unreadFieldsOf(count),
      });
    } catch (error) {
      this.logger.error(
        `Could not notify user ${userId} of ${content.type}: ${String(error)}`,
      );
    }
  }

  /**
   * The same notice to every admin — what the money paths raise when a person has to act:
   * a refund the guest's bank sent back, a payment event the worker gave up on. Never
   * throws, for the reason `notify` does; a site without an admin is told nobody, and the
   * caller's own log line is what is left.
   */
  async notifyAdmins(content: NotificationContent): Promise<void> {
    let adminIds: string[];

    try {
      adminIds = await this.notificationRepository.findAdminIds();
    } catch (error) {
      this.logger.error(
        `Could not find the admins to notify of ${content.type}: ${String(error)}`,
      );

      return;
    }

    for (const adminId of adminIds) {
      await this.notify(adminId, content);
    }
  }

  async findPage(
    userId: string,
    query: NotificationQuery,
  ): Promise<NotificationPage> {
    const cursor = readCursor(query.cursor, SORT, decodeCursor);
    const { items, hasMore } = await this.notificationRepository.findPage(
      userId,
      query,
      cursor,
    );
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(last, SORT) : null,
    };
  }

  async unreadCount(userId: string): Promise<UnreadCount> {
    return bellOf(await this.notificationRepository.countUnread(userId));
  }

  /**
   * `404` for an id this account has no notification under, whoever else's it might be —
   * the feed is personal, so "exists, but not yours" would only tell a stranger that it
   * exists.
   */
  async markRead(userId: string, id: string): Promise<UnreadCount> {
    const marked = await this.notificationRepository.markRead(userId, id);

    if (marked === null) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    return this.announceRead(userId, marked.changed, marked.count);
  }

  async markAllRead(userId: string): Promise<UnreadCount> {
    const { changed, count } =
      await this.notificationRepository.markAllRead(userId);

    return this.announceRead(userId, changed > 0, count);
  }

  /**
   * The other tabs of the account hear about it too: a notice read in one window should
   * not stay bold in the next. The count is answered to the caller as well, so the tab that
   * asked does not have to wait for its own event to come back round. A read that changed
   * nothing — a second click, "mark all" with nothing unread — is news to nobody, and every
   * tab would answer it with a refresh.
   */
  private async announceRead(
    userId: string,
    changed: boolean,
    count: UnreadCounts,
  ): Promise<UnreadCount> {
    if (changed) {
      await this.realtimeService.publish(userId, {
        type: "notifications.read",
        ...unreadFieldsOf(count),
      });
    }

    return bellOf(count);
  }
}

/** The half of the counts the notification routes answer with. */
function bellOf(counts: UnreadCounts): UnreadCount {
  return { unread: counts.notifications, revision: counts.revision };
}
