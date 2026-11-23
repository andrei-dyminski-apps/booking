import { Injectable } from "@nestjs/common";
import { addDays, addHours, addSeconds, subDays } from "date-fns";
import { notificationContentSchema, type MailGroup } from "@repo/contracts";
import { RetryLaterError } from "../../common/retry-later.error";
import { PrismaService } from "../../prisma/prisma.service";
import { isLockUnavailable } from "../../prisma/prisma.errors";
import { sessionNotFound } from "../../common/session-errors";
import type { Prisma } from "../../generated/prisma/client";
import type {
  MailEvent,
  StoredMailEventInput,
} from "../application/mail-event";
import { hashMailToken } from "../application/mail-content";
import {
  MailRetryExpired,
  type DeliverySnapshot,
  type MailAttempt,
  type QueuedMail,
} from "../application/mail-task";
import { MailOutboxRepository } from "./mail-outbox.repository";

const recipientSelect = {
  id: true,
  email: true,
  role: true,
  emailVerifiedAt: true,
  emailUndeliverableAt: true,
  mutedMailGroups: true,
} as const;

type Recipient = Prisma.UserGetPayload<{ select: typeof recipientSelect }>;
type Digest = {
  threadId: string;
  title: string;
  latestId: string;
  latestBody: string;
  count: number;
};

class MailConversationBusyError extends RetryLaterError {
  constructor() {
    super("The conversation is busy");
  }
}

@Injectable()
export class MailRepository {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly outbox: MailOutboxRepository,
  ) {}
  user(id: string) {
    return this.prismaService.user.findFirst({
      where: { id, deletedAt: null, blockedAt: null },
      select: recipientSelect,
    });
  }
  async preferences(id: string, muted: MailGroup[]) {
    const result = await this.prismaService.user.updateMany({
      where: { id, deletedAt: null, blockedAt: null },
      data: { mutedMailGroups: [...new Set(muted)] },
    });
    if (!result.count) throw sessionNotFound();
  }
  // Token writes and delivery start serialize with account changes.
  private async lockRecipient(tx: Prisma.TransactionClient, id: string) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE id = ${id}::uuid AND deleted_at IS NULL AND blocked_at IS NULL
      FOR SHARE
    `;
    if (!locked) return;
    return tx.user.findUniqueOrThrow({
      where: { id },
      select: recipientSelect,
    });
  }

  private withRecipient<T>(
    id: string,
    action: (user: Recipient, tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T | undefined> {
    return this.prismaService.$transaction(async (tx) => {
      const user = await this.lockRecipient(tx, id);
      if (user) return action(user, tx);
    });
  }

  async startConfirmation(
    task: QueuedMail,
    token: string,
    issuedAt: Date,
    recoveryCheckedAt: Date | null,
    eligible: (user: Recipient) => boolean,
  ) {
    const { userId } = task;
    return this.withRecipient(userId, async (user, tx) => {
      const now = new Date();
      if (!eligible(user)) return;
      if (addHours(issuedAt, 24) <= now) throw new MailRetryExpired();
      const started = await this.outbox.startAttempt(tx, task);
      if (!started) return;
      const expiresAt = addHours(started.startedAt, 24);
      await tx.mailConfirmation.deleteMany({
        where: { userId, expiresAt: { lte: now } },
      });
      const hash = hashMailToken(token);
      const inserted = await tx.mailConfirmation.createMany({
        data: { hash, userId, expiresAt, recoveryCheckedAt },
        skipDuplicates: true,
      });
      if (!inserted.count) {
        // A quota refusal can move the first possible delivery to the next reset.
        await tx.mailConfirmation.updateMany({
          where: { hash, userId, expiresAt: { lt: expiresAt } },
          data: { expiresAt, recoveryCheckedAt },
        });
      }
      return started;
    });
  }

  async startCopy(task: QueuedMail, eligible: (user: Recipient) => boolean) {
    return this.withRecipient(task.userId, async (user, tx) => {
      if (!eligible(user)) return;
      return this.outbox.startAttempt(tx, task);
    });
  }

  async startDigest(
    task: QueuedMail,
    attempt: MailAttempt,
    replyHash: string | null,
    eligible: (user: Recipient) => boolean,
    prepare: (
      thread: Digest,
      replyAllowed: boolean,
      email: string,
    ) => Extract<DeliverySnapshot, { kind: "digest" }>,
  ) {
    return this.withRecipient(task.userId, async (user, tx) => {
      if (!eligible(user)) return;
      const { id } = task;
      // Writers and account changes can take these locks in a different order.
      const [thread] = await tx.$queryRaw<{ canReply: boolean }[]>`
        SELECT author.deleted_at IS NULL AS "canReply" FROM messages AS m
        JOIN conversations AS c ON c.id = m.conversation_id
        JOIN listings AS l ON l.id = c.listing_id
        JOIN users AS author ON author.id =
          CASE WHEN m.sender = 'GUEST' THEN c.guest_id ELSE l.owner_id END
        WHERE m.id = ${id}::uuid
          AND ${user.id}::uuid =
            CASE WHEN m.sender = 'GUEST' THEN l.owner_id ELSE c.guest_id END
        FOR UPDATE OF c NOWAIT FOR SHARE OF author NOWAIT
      `.catch((error: unknown) => {
        if (isLockUnavailable(error)) throw new MailConversationBusyError();
        throw error;
      });
      if (!thread) return;

      const frozen = attempt.delivery;
      if (frozen && frozen.kind !== "digest") return;
      const throughId =
        !attempt.rebuildDigest && (frozen || attempt.digest)
          ? (frozen?.throughId ?? id)
          : null;
      const unread = await this.digest(
        id,
        throughId,
        attempt.rebuildDigest ?? false,
        tx,
      );
      if (!unread) return;
      const canReply = thread.canReply && user.role === "USER";
      const issueToken = Boolean(replyHash && canReply && !throughId);
      const replyAllowed =
        issueToken ||
        (canReply &&
          replyHash !== null &&
          !!(await tx.mailReplyToken.findFirst({
            where: {
              hash: replyHash,
              userId: user.id,
              messageId: unread.latestId,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { hash: true },
          })));
      const delivery = await this.outbox.freezeDelivery(
        task,
        prepare(unread, replyAllowed, user.email),
        tx,
      );
      if (
        delivery?.kind !== "digest" ||
        delivery.request.to !== user.email ||
        (delivery.replyHash &&
          (delivery.replyHash !== replyHash || !replyAllowed))
      )
        return;
      const started = await this.outbox.startAttempt(tx, task);
      if (!started) return;
      if (issueToken && delivery.replyHash) {
        await this.issueReply(
          tx,
          user.id,
          unread.latestId,
          delivery.replyHash,
          started.startedAt,
        );
      }
      if (!throughId) {
        // Keep the original job and idempotency key for the whole batch.
        await this.outbox.coalesceDigests(tx, task, unread.latestId);
      }
      return { delivery, ...started };
    });
  }

  async confirm(token: string) {
    const hash = hashMailToken(token);
    return this.prismaService.$transaction(async (tx) => {
      const issued = await tx.mailConfirmation.findUnique({ where: { hash } });
      const legacy = issued
        ? null
        : await tx.user.findUnique({
            where: { confirmationHash: hash },
            select: { id: true },
          });
      const id = issued?.userId ?? legacy?.id;
      if (!id) return false;
      const [locked] = await tx.$queryRaw<
        {
          email_undeliverable_at: Date | null;
          confirmation_hash: string | null;
          confirmation_expires_at: Date | null;
        }[]
      >`
        SELECT email_undeliverable_at, confirmation_hash, confirmation_expires_at FROM users
        WHERE id = ${id}::uuid AND deleted_at IS NULL AND blocked_at IS NULL
        FOR UPDATE
      `;
      if (!locked) return false;
      const now = new Date();
      // Recheck after the lock: a different valid link may have confirmed the address.
      const confirmation = issued
        ? await tx.mailConfirmation.findUnique({ where: { hash } })
        : locked.confirmation_hash === hash
          ? {
              expiresAt: locked.confirmation_expires_at,
              recoveryCheckedAt: null,
            }
          : null;
      const expiresAt = confirmation?.expiresAt;
      const recoveryCheckedAt = confirmation?.recoveryCheckedAt;
      if (!expiresAt || expiresAt <= now) return false;
      if (
        locked.email_undeliverable_at &&
        (!recoveryCheckedAt ||
          recoveryCheckedAt <= locked.email_undeliverable_at ||
          addHours(expiresAt, -24) <= locked.email_undeliverable_at)
      )
        return false;
      await tx.user.update({
        where: { id },
        data: {
          confirmationHash: null,
          confirmationExpiresAt: null,
          emailVerifiedAt: now,
          emailUndeliverableAt: null,
          // A normal verification says nothing about Resend's suppression list.
          emailDeliveryRestoredAt: recoveryCheckedAt ?? undefined,
        },
      });
      await tx.mailConfirmation.deleteMany({ where: { userId: id } });
      await tx.mailReplyToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
  }
  async notice(id: string, userId: string) {
    const row = await this.prismaService.notification.findFirst({
      where: { id, userId },
    });
    return row ? notificationContentSchema.parse(row) : null;
  }
  private async issueReply(
    tx: Prisma.TransactionClient,
    userId: string,
    messageId: string,
    hash: string,
    issuedAt: Date,
  ) {
    const expiresAt = addDays(issuedAt, 7);
    // Leave time for webhook redelivery and keep tokens for replies in the inbox.
    await tx.$executeRaw`
        DELETE FROM mail_reply_tokens AS token
        WHERE token.user_id = ${userId}::uuid
          AND token.expires_at <= ${subDays(issuedAt, 2)}
          AND NOT EXISTS (
            SELECT 1 FROM mail_events AS event
            WHERE event.processed_at IS NULL AND event.reply_token_hash = token.hash
              AND event.created_at < token.expires_at
          )
      `;
    await tx.mailReplyToken.createMany({
      data: { hash, userId, messageId, expiresAt },
      skipDuplicates: true,
    });
  }
  async replyTarget(hash: string, receivedAt: Date) {
    const reply = await this.prismaService.mailReplyToken.findFirst({
      where: {
        hash,
        revokedAt: null,
        expiresAt: { gt: receivedAt },
        user: {
          role: "USER",
          deletedAt: null,
          blockedAt: null,
          emailVerifiedAt: { not: null },
          emailUndeliverableAt: null,
        },
      },
      select: {
        user: { select: { id: true, email: true, role: true } },
        message: { select: { conversationId: true } },
      },
    });
    return reply
      ? { user: reply.user, threadId: reply.message.conversationId }
      : null;
  }
  // Under the conversation lock, summarize unread incoming messages through
  // the latest one, or through the original cutoff when retrying.
  private async digest(
    messageId: string,
    throughId: string | null,
    rebuild: boolean,
    db: Prisma.TransactionClient,
  ) {
    const [digest] = await db.$queryRaw<Digest[]>`
      SELECT c.id AS "threadId", l.title,
          latest.id AS "latestId", latest.body AS "latestBody",
          (
            SELECT count(*)::integer FROM messages AS unread
            WHERE unread.conversation_id = c.id AND unread.sender = m.sender
              AND unread.created_at > marker.read_at
              AND unread.created_at <= latest.created_at
          ) AS count
      FROM messages AS m
      JOIN conversations AS c ON c.id = m.conversation_id
      JOIN listings AS l ON l.id = c.listing_id
      LEFT JOIN messages AS cutoff ON cutoff.id = ${throughId}::uuid
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          CASE WHEN m.sender = 'GUEST' THEN c.host_read_at ELSE c.guest_read_at END,
          '-infinity'
        ) AS read_at
      ) AS marker
      CROSS JOIN LATERAL (
        SELECT incoming.id, incoming.created_at, incoming.body
        FROM messages AS incoming
        WHERE incoming.conversation_id = c.id AND incoming.sender = m.sender
          AND incoming.created_at > marker.read_at
          AND (cutoff.id IS NULL OR incoming.created_at <= cutoff.created_at)
        ORDER BY incoming.created_at DESC LIMIT 1
      ) AS latest
      WHERE m.id = ${messageId}::uuid
        AND (${rebuild} OR cutoff.id IS NOT NULL OR m.created_at > marker.read_at)
    `;
    return digest;
  }
  async recipientIds(addresses: string[], at: Date) {
    if (!addresses.length) return [];
    const users = await this.prismaService.user.findMany({
      where: {
        email: { in: addresses.map((address) => address.toLowerCase()) },
        deletedAt: null,
        createdAt: { lte: at },
      },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }

  async record({ recipients, ...event }: StoredMailEventInput) {
    const outgoing = event.kind !== "email.received";
    const recipientIds = outgoing
      ? await this.recipientIds(recipients, event.createdAt)
      : [];
    return this.prismaService.mailEvent.upsert({
      where: { id: event.id },
      create: {
        ...event,
        recipientIds,
        lookupRecipients: outgoing && recipients.length === 0,
      },
      update: {},
      select: { processedAt: true, failedAt: true },
    });
  }
  async claim(): Promise<MailEvent | undefined> {
    const [event] = await this.prismaService.$queryRaw<MailEvent[]>`
      UPDATE mail_events AS event
      SET available_at = CURRENT_TIMESTAMP + interval '60 seconds',
          attempts = event.attempts + 1
      WHERE event.id = (
        SELECT id FROM mail_events
        WHERE processed_at IS NULL AND failed_at IS NULL
          AND available_at <= CURRENT_TIMESTAMP
        ORDER BY available_at, id
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, kind, email_id AS "emailId", recipient_ids AS "recipientIds",
          lookup_recipients AS "lookupRecipients", reply_token_hash AS "replyTokenHash",
          created_at AS "createdAt", processed_at AS "processedAt",
          available_at AS "availableAt", attempts
    `;
    return event;
  }
  async suppress(event: MailEvent, recipientIds: string[]) {
    await this.prismaService.$transaction(async (tx) => {
      if (!(await this.done(event, tx))) return;
      const users = await tx.user.updateManyAndReturn({
        where: {
          id: { in: recipientIds },
          deletedAt: null,
          AND: [
            {
              OR: [
                { emailDeliveryRestoredAt: null },
                { emailDeliveryRestoredAt: { lte: event.createdAt } },
              ],
            },
            {
              OR: [
                { emailUndeliverableAt: null },
                { emailUndeliverableAt: { lt: event.createdAt } },
              ],
            },
          ],
        },
        data: { emailUndeliverableAt: event.createdAt },
        select: { id: true },
      });
      if (users.length) {
        await tx.mailReplyToken.updateMany({
          where: { userId: { in: users.map(({ id }) => id) }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
  }
  async done(
    event: MailEvent,
    db: Prisma.TransactionClient = this.prismaService,
  ) {
    const { count } = await db.mailEvent.updateMany({
      where: activeMailClaim(event),
      data: {
        processedAt: new Date(),
        recipientIds: [],
        lookupRecipients: false,
        replyTokenHash: null,
      },
    });
    return count === 1;
  }
  setAside(event: MailEvent, reason: string) {
    return this.prismaService.mailEvent.updateMany({
      where: activeMailClaim(event),
      data: { failedAt: new Date(), lastError: reason },
    });
  }
  retry(event: MailEvent) {
    return this.prismaService.mailEvent.updateMany({
      where: activeMailClaim(event),
      data: {
        availableAt: addSeconds(
          Date.now(),
          Math.min(5 * 2 ** (event.attempts - 1), 3600),
        ),
      },
    });
  }
}

function activeMailClaim(event: MailEvent): Prisma.MailEventWhereInput {
  return {
    id: event.id,
    processedAt: null,
    failedAt: null,
    availableAt: event.availableAt,
  };
}
