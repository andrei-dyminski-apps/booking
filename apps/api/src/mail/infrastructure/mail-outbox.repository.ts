import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { mailRequestContext } from "../../common/mail-request-context";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  MAIL_DELIVERY_OUTCOMES,
  type MailDeliveryOutcome,
} from "../application/mail-event";
import {
  MAIL_PROCESSING_FAILURES,
  MAIL_SEND_ATTEMPTS,
  type DeliverySnapshot,
  type MailAttempt,
  type MailTask,
  type PendingMail,
  type QueuedMail,
} from "../application/mail-task";
import { openMailSnapshot, sealMailSnapshot } from "./mail-snapshot";
import { resendQuotaRetryAt } from "./resend-quota";

const digestSnapshotSchema = z.object({
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  replyAddressHash: z.string().nullable(),
});
const MAIL_RECHECK_SECONDS = 15;

type StoredMailAttempt = {
  startedAt: Date | null;
  sendAttempts: number;
  digest: unknown;
  delivery: string | null;
};

export function readMailAttempt(
  id: string,
  row: StoredMailAttempt,
  deliveryRound = 0,
): MailAttempt {
  const startedAt = row.sendAttempts > 0 ? row.startedAt : new Date();
  if (!startedAt) throw new Error("Missing first mail attempt time");
  return {
    startedAt,
    digest: digestSnapshotSchema.nullable().parse(row.digest),
    delivery: row.delivery === null ? null : openMailSnapshot(id, row.delivery),
    rebuildDigest: deliveryRound > 0 && row.sendAttempts === 0,
  };
}

// Call inside the transaction that writes the account, notice or message.
export async function recordMailTask(
  tx: Prisma.TransactionClient,
  task: MailTask,
) {
  await tx.mailOutbox.create({
    data: { ...task, requestId: mailRequestContext.getStore() },
  });
}

export function recordConfirmation(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  return recordMailTask(tx, { id: randomUUID(), kind: "confirm", userId });
}

@Injectable()
export class MailOutboxRepository {
  constructor(private readonly prismaService: PrismaService) {}

  confirmation(userId: string) {
    return recordConfirmation(this.prismaService, userId);
  }

  async claim(): Promise<PendingMail | undefined> {
    const [task] = await this.prismaService.$queryRaw<PendingMail[]>`
      UPDATE mail_outbox AS task
      SET available_at = CURRENT_TIMESTAMP + ${MAIL_RECHECK_SECONDS}::int * interval '1 second'
      WHERE task.id = (
        SELECT id FROM mail_outbox
        WHERE failed_at IS NULL AND accepted_email_id IS NULL
          AND available_at <= CURRENT_TIMESTAMP
        ORDER BY CASE WHEN kind IN ('confirm', 'account') THEN 0 ELSE 1 END,
            available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id, kind, user_id AS "userId", request_id AS "requestId",
          created_at AS "createdAt", available_at AS "availableAt",
          delivery_round AS "deliveryRound"
    `;
    return task;
  }

  async acknowledge(task: PendingMail) {
    await this.prismaService.mailOutbox.deleteMany({
      where: {
        id: task.id,
        failedAt: null,
        acceptedEmailId: null,
        availableAt: task.availableAt,
        deliveryRound: task.deliveryRound,
      },
    });
  }

  // Jobs enqueued before the outbox kept unfinished deliveries can still be retried.
  async adopt(
    { id, kind, userId, requestId }: QueuedMail,
    createdAt: Date,
    earlierAttempts: number,
  ) {
    await this.prismaService.mailOutbox.createMany({
      data: {
        id,
        kind,
        userId,
        requestId,
        createdAt,
        startedAt: earlierAttempts > 0 ? createdAt : null,
        sendAttempts: earlierAttempts,
      },
      skipDuplicates: true,
    });
  }

  async begin({ id, kind, userId, deliveryRound = 0 }: QueuedMail) {
    const [attempt] = await this.prismaService.$queryRaw<
      (StoredMailAttempt & { providerRetry: number })[]
    >`
      SELECT started_at AS "startedAt", send_attempts AS "sendAttempts",
          digest_snapshot AS digest, delivery_snapshot AS delivery, provider_retry AS "providerRetry"
      FROM mail_outbox
      WHERE id = ${id}::uuid AND kind = ${kind} AND user_id = ${userId}::uuid
          AND delivery_round = ${deliveryRound} AND failed_at IS NULL AND accepted_email_id IS NULL
    `;
    return attempt;
  }

  async freezeDelivery(
    { id, deliveryRound = 0 }: QueuedMail,
    candidate: DeliverySnapshot,
    db: Prisma.TransactionClient = this.prismaService,
  ) {
    const encrypted = sealMailSnapshot(id, candidate);
    const [row] = await db.$queryRaw<{ snapshot: string }[]>`
      UPDATE mail_outbox
      SET delivery_snapshot = CASE
            WHEN kind = 'digest' AND delivery_round > 0 AND send_attempts = 0
            THEN ${encrypted} ELSE COALESCE(delivery_snapshot, ${encrypted}) END,
          digest_snapshot = NULL
      WHERE id = ${id}::uuid AND delivery_round = ${deliveryRound}
          AND failed_at IS NULL AND accepted_email_id IS NULL
      RETURNING delivery_snapshot AS snapshot
    `;
    return row ? openMailSnapshot(id, row.snapshot) : undefined;
  }

  async coalesceDigests(
    tx: Prisma.TransactionClient,
    task: QueuedMail,
    throughId: string,
  ) {
    // A deferred sibling with no outstanding send attempts can be replaced too.
    await tx.$executeRaw`
      DELETE FROM mail_outbox AS pending
      USING messages AS message, messages AS latest
      WHERE pending.id = message.id AND latest.id = ${throughId}::uuid
        AND message.conversation_id = latest.conversation_id
        AND message.sender = latest.sender AND message.created_at <= latest.created_at
        AND pending.id <> ${task.id}::uuid AND pending.user_id = ${task.userId}::uuid
        AND pending.kind = 'digest' AND pending.failed_at IS NULL
        AND pending.send_attempts = 0
        AND (
          pending.delivery_round > 0 OR
          (pending.delivery_snapshot IS NULL AND pending.digest_snapshot IS NULL)
        )
    `;
  }

  async startAttempt(
    tx: Prisma.TransactionClient,
    { id, kind, userId, deliveryRound = 0 }: QueuedMail,
  ) {
    // Give a provider call time to settle before the relay replaces a lost Redis job.
    const [row] = await tx.$queryRaw<{ attempt: number; startedAt: Date }[]>`
      UPDATE mail_outbox
      SET send_attempts = send_attempts + 1,
          started_at = CASE WHEN send_attempts = 0 THEN statement_timestamp()
                           ELSE COALESCE(started_at, statement_timestamp()) END,
          available_at = GREATEST(
            available_at,
            CURRENT_TIMESTAMP + ${MAIL_RECHECK_SECONDS}::int * interval '1 second'
          )
      WHERE id = ${id}::uuid AND kind = ${kind} AND user_id = ${userId}::uuid
          AND delivery_round = ${deliveryRound} AND send_attempts < ${MAIL_SEND_ATTEMPTS}
          AND failed_at IS NULL AND accepted_email_id IS NULL
      RETURNING send_attempts AS attempt, started_at AS "startedAt"
    `;
    return row;
  }

  async defer({ id, kind, deliveryRound = 0 }: QueuedMail, retryAt: Date) {
    // Remove this refusal from the count. Earlier attempts may still have reached Resend.
    await this.prismaService.$transaction(async (tx) => {
      if (kind === "account")
        await tx.$queryRaw`SELECT id FROM account_mail WHERE id = ${id}::uuid FOR UPDATE`;
      const [deferred] = await tx.$queryRaw<{ sendAttempts: number }[]>`
        UPDATE mail_outbox
        SET available_at = ${retryAt}, delivery_round = delivery_round + 1,
            started_at = CASE WHEN send_attempts <= 1 THEN NULL ELSE started_at END,
            send_attempts = GREATEST(send_attempts - 1, 0)
        WHERE id = ${id}::uuid AND delivery_round = ${deliveryRound}
            AND failed_at IS NULL AND accepted_email_id IS NULL
        RETURNING send_attempts AS "sendAttempts"
      `;
      if (kind === "account" && deferred?.sendAttempts === 0) {
        await tx.accountMail.updateMany({
          where: { id },
          data: { expiresAt: null },
        });
      }
    });
  }

  async recordFailure(
    { id, deliveryRound = 0 }: QueuedMail,
    reason: string,
    terminal: boolean,
  ) {
    const [row] = await this.prismaService.$queryRaw<
      { failedAt: Date | null }[]
    >`
      UPDATE mail_outbox
      SET processing_failures = processing_failures + 1,
          last_error = ${reason},
          failed_at = CASE
            WHEN ${terminal} OR processing_failures + 1 >= ${MAIL_PROCESSING_FAILURES}
            THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ${id}::uuid AND delivery_round = ${deliveryRound}
          AND failed_at IS NULL AND accepted_email_id IS NULL
      RETURNING failed_at AS "failedAt"
    `;
    return row?.failedAt != null;
  }

  async complete(
    { id, kind, userId, deliveryRound = 0 }: QueuedMail,
    emailId?: string | void,
  ) {
    await this.prismaService.$transaction(async (tx) => {
      const pending = {
        id,
        kind,
        userId,
        deliveryRound,
        failedAt: null,
        acceptedEmailId: null,
      };
      if (emailId) {
        await tx.mailEvent.createMany({
          data: {
            id: "accepted/" + emailId,
            emailId,
            outboxId: id,
            kind: "email.accepted",
            createdAt: new Date(),
            processedAt: new Date(),
          },
          skipDuplicates: true,
        });
        // A signed webhook can be processed before the send response arrives.
        await lockProviderReceipt(tx, emailId);
        if (kind !== "account" || (await lockAccountLetter(tx, id))) {
          const { count } = await tx.mailOutbox.updateMany({
            where: pending,
            data: { acceptedEmailId: emailId, availableAt: new Date() },
          });
          if (!count) return;
          const outcome = await tx.mailEvent.findFirst({
            where: { emailId, kind: { in: MAIL_DELIVERY_OUTCOMES } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              emailId: true,
              kind: true,
              createdAt: true,
              providerFailureReason: true,
            },
          });
          if (outcome) await this.reconcileDelivery(tx, outcome);
          return;
        }
      }
      await tx.mailOutbox.deleteMany({ where: pending });
    });
  }

  async resolveDelivery(
    tx: Prisma.TransactionClient,
    outcome: MailDeliveryOutcome,
  ) {
    await lockProviderReceipt(tx, outcome.emailId);
    await this.reconcileDelivery(tx, outcome);
  }

  private async reconcileDelivery(
    tx: Prisma.TransactionClient,
    outcome: MailDeliveryOutcome,
  ) {
    const task = await tx.mailOutbox.findUnique({
      where: { acceptedEmailId: outcome.emailId, failedAt: null },
      select: { id: true, kind: true, providerRetry: true },
    });
    if (!task) return;
    if (task.kind === "account" && !(await lockAccountLetter(tx, task.id)))
      return;

    const where = {
      id: task.id,
      acceptedEmailId: outcome.emailId,
      failedAt: null,
    };
    if (outcome.kind === "email.delivered") {
      await tx.mailOutbox.deleteMany({ where });
      return;
    }

    const retryAt =
      outcome.kind === "email.failed"
        ? resendQuotaRetryAt(outcome.providerFailureReason, outcome.createdAt)
        : undefined;
    const { count } = await tx.mailOutbox.updateMany({
      where,
      data:
        retryAt && task.providerRetry < MAIL_SEND_ATTEMPTS - 1
          ? {
              acceptedEmailId: null,
              availableAt: retryAt,
              deliveryRound: { increment: 1 },
              providerRetry: { increment: 1 },
              // The provider has confirmed this email was never sent.
              sendAttempts: 0,
              startedAt: null,
            }
          : {
              failedAt: new Date(),
              lastError: outcome.providerFailureReason ?? outcome.kind,
            },
    });
    if (task.kind === "account" && count) {
      await tx.accountMail.update({
        where: { id: task.id },
        data: { expiresAt: null },
      });
    }
  }
}

function lockProviderReceipt(tx: Prisma.TransactionClient, emailId: string) {
  const key = "mail-receipt/" + emailId;
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function lockAccountLetter(tx: Prisma.TransactionClient, id: string) {
  const [letter] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM account_mail WHERE id = ${id}::uuid FOR UPDATE
  `;
  return letter;
}
