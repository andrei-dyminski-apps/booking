import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { addMinutes } from "date-fns";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  isPrismaError,
  PrismaErrorCode,
  violatedConstraint,
} from "../prisma/prisma.errors";
import {
  accountMailToken,
  hashMailToken,
} from "../mail/application/mail-content";
import { canSendTo } from "../mail/domain/mail-policy";
import { recordMailTask } from "../mail/infrastructure/mail-outbox.repository";
import { toUser } from "../user/user.repository";
import { isDemoEmail } from "./demo-accounts";

type AccountMailKind =
  "register" | "reset" | "change" | "emailChanged" | "passwordChanged";
type LinkKind = Extract<AccountMailKind, "register" | "reset" | "change">;

export class DemoEmailChangeError extends Error {}

@Injectable()
export class AccountMailRepository {
  constructor(private readonly prisma: PrismaService) {}

  credentials(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, blockedAt: null },
      select: { passwordHash: true, sessionVersion: true },
    });
  }

  async hasActiveLink(kind: "register" | "reset", token: string) {
    return (await readLink(this.prisma, kind, token)) !== null;
  }

  requestRegistration(email: string, nextPath?: string) {
    return this.request("register", email, async (tx) => {
      if (await tx.user.findUnique({ where: { email }, select: { id: true } }))
        return;
      if (!(await reusableRequest(tx, "register", email)))
        await queue(tx, "register", email, { nextPath });
    });
  }

  requestReset(email: string) {
    return this.request("reset", email, async (tx) => {
      const [user] = await tx.$queryRaw<
        Pick<LockedUser, "id" | "email" | "sessionVersion">[]
      >`
        SELECT id, email::text AS email, session_version AS "sessionVersion"
        FROM users WHERE email = ${email}::citext AND blocked_at IS NULL
          AND deleted_at IS NULL AND email_verified_at IS NOT NULL
        FOR SHARE
      `;
      if (user && !(await reusableRequest(tx, "reset", user.email, user))) {
        await queue(tx, "reset", user.email, {
          userId: user.id,
          sessionVersion: user.sessionVersion,
        });
      }
    });
  }

  async requestChange(
    userId: string,
    expectedPasswordHash: string,
    expectedVersion: number,
    email: string,
  ) {
    return this.request(
      "change",
      email,
      async (tx) => {
        const user = await lockUser(tx, userId);
        if (
          !user ||
          user.passwordHash !== expectedPasswordHash ||
          user.sessionVersion !== expectedVersion
        )
          return;
        if (isDemoEmail(user.email)) throw new DemoEmailChangeError();
        const owner = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        const eligible =
          user.email !== email &&
          (!owner || owner.id === userId) &&
          canDeliver(email);
        const reusable = eligible
          ? await reusableRequest(tx, "change", email, user)
          : undefined;
        await removeAccountMail(tx, {
          kind: "change",
          userId,
          id: reusable ? { not: reusable } : undefined,
        });
        if (!eligible || reusable) return;
        await queue(tx, "change", email, {
          userId,
          sessionVersion: user.sessionVersion,
        });
      },
      userId,
    );
  }

  private request(
    kind: LinkKind,
    email: string,
    send: (tx: Prisma.TransactionClient) => Promise<void>,
    userId?: string,
  ) {
    if (kind !== "change" && !canDeliver(email)) return Promise.resolve();
    return this.prisma.$transaction(async (tx) => {
      await lockMailRequests(tx, kind, userId ?? email.toLowerCase());
      await send(tx);
    });
  }

  async register(token: string, name: string, passwordHash: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const registered = await readLink(tx, "register", token);
        if (!registered) return null;
        await lockMailRequests(tx, "register", registered.email.toLowerCase());
        if (!(await consume(tx, registered.id))) return null;
        const user = await tx.user.create({
          data: {
            name,
            email: registered.email,
            passwordHash,
            emailVerifiedAt: new Date(),
          },
        });
        await removeAccountMail(tx, {
          kind: "register",
          email: registered.email,
        });
        return toUser(user);
      });
    } catch (error) {
      if (conflictsOnEmail(error)) return null;
      throw error;
    }
  }

  async reset(token: string, passwordHash: string) {
    return this.changeCredentials("reset", token, async (tx, user) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });
      await queue(tx, "passwordChanged", user.email, { userId: user.id });
    });
  }

  async changeEmail(token: string) {
    try {
      return await this.changeCredentials(
        "change",
        token,
        async (tx, user, email) => {
          const now = new Date();
          await tx.user.update({
            where: { id: user.id },
            data: {
              email,
              emailVerifiedAt: now,
              emailUndeliverableAt: null,
              emailDeliveryRestoredAt: now,
              confirmationHash: null,
              confirmationExpiresAt: null,
              sessionVersion: { increment: 1 },
            },
          });
          await tx.mailConfirmation.deleteMany({ where: { userId: user.id } });
          if (canDeliver(user.email)) {
            await queue(tx, "emailChanged", user.email, { userId: user.id });
          }
        },
      );
    } catch (error) {
      if (conflictsOnEmail(error)) return null;
      throw error;
    }
  }

  private changeCredentials(
    kind: "reset" | "change",
    token: string,
    update: (
      tx: Prisma.TransactionClient,
      user: LockedUser,
      email: string,
    ) => Promise<void>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const link = await readLink(tx, kind, token);
      if (!link?.userId) return null;
      const user = await lockUser(tx, link.userId);
      if (
        !user ||
        user.sessionVersion !== link.sessionVersion ||
        (kind === "change" && isDemoEmail(user.email)) ||
        !(await consume(tx, link.id))
      )
        return null;
      await update(tx, user, link.email);
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
      await tx.mailReplyToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await removeAccountMail(tx, {
        userId: user.id,
        tokenHash: { not: null },
      });
      return { userId: user.id, sessionVersion: user.sessionVersion + 1 };
    });
  }
}

function canDeliver(email: string) {
  return canSendTo(email, process.env.NODE_ENV === "production");
}

async function reusableRequest(
  tx: Prisma.TransactionClient,
  kind: LinkKind,
  email: string,
  user?: Pick<LockedUser, "id" | "sessionVersion">,
) {
  // Mail processing takes the same row lock before moving a delivery back to the queue.
  const requests = await tx.$queryRaw<
    { id: string; createdAt: Date; expiresAt: Date | null }[]
  >`
    SELECT id, created_at AS "createdAt", expires_at AS "expiresAt" FROM account_mail
    WHERE kind = ${kind} AND email = ${email}::citext AND email::text = ${email}
      AND user_id IS NOT DISTINCT FROM ${user?.id ?? null}::uuid
      AND session_version IS NOT DISTINCT FROM ${user?.sessionVersion ?? null}::int
    ORDER BY created_at DESC, id DESC FOR UPDATE
  `;
  if (!requests.length) return;
  const now = new Date();
  const reusable = requests.filter(
    ({ expiresAt }) => expiresAt === null || expiresAt > now,
  );
  const outbox = {
    kind: "account",
    failedAt: null,
  };
  const pending = await tx.mailOutbox.findFirst({
    where: {
      ...outbox,
      id: { in: reusable.map(({ id }) => id) },
      acceptedEmailId: null,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const recent = reusable[0];
  if (pending) return pending.id;
  if (recent && recent.createdAt >= addMinutes(now, -2)) return recent.id;

  // A new request supersedes any retry for the already accepted delivery.
  await tx.mailOutbox.deleteMany({
    where: {
      ...outbox,
      id: { in: requests.map(({ id }) => id) },
      acceptedEmailId: { not: null },
    },
  });
}

async function removeAccountMail(
  tx: Prisma.TransactionClient,
  where: Prisma.AccountMailWhereInput,
) {
  const letters = await tx.accountMail.findMany({
    where,
    select: { id: true },
  });
  if (!letters.length) return;
  const id = { in: letters.map((letter) => letter.id) };
  await tx.accountMail.deleteMany({ where: { id } });
  await tx.mailOutbox.deleteMany({
    where: { id, kind: "account", failedAt: null },
  });
}

function lockMailRequests(
  tx: Prisma.TransactionClient,
  kind: LinkKind,
  identifier: string,
) {
  const key = "account-mail/" + kind + "/" + identifier;
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

type LockedUser = {
  id: string;
  email: string;
  passwordHash: string;
  sessionVersion: number;
};

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  const [user] = await tx.$queryRaw<LockedUser[]>`
    SELECT id, email::text AS email, password_hash AS "passwordHash", session_version AS "sessionVersion"
    FROM users WHERE id = ${userId}::uuid AND blocked_at IS NULL AND deleted_at IS NULL
    FOR UPDATE
  `;
  return user;
}

async function queue(
  tx: Prisma.TransactionClient,
  kind: AccountMailKind,
  email: string,
  details: { userId?: string; sessionVersion?: number; nextPath?: string } = {},
) {
  const id = randomUUID();
  const notification = kind === "emailChanged" || kind === "passwordChanged";
  await tx.accountMail.create({
    data: {
      id,
      kind,
      email,
      ...details,
      tokenHash: notification ? null : hashMailToken(accountMailToken(id)),
    },
  });
  await recordMailTask(tx, {
    id,
    kind: "account",
    userId: details.userId ?? id,
  });
}

function readLink(tx: Prisma.TransactionClient, kind: LinkKind, token: string) {
  return tx.accountMail.findUnique({
    where: {
      tokenHash: hashMailToken(token),
      kind,
      expiresAt: { gt: new Date() },
    },
  });
}

async function consume(tx: Prisma.TransactionClient, id: string) {
  const result = await tx.accountMail.deleteMany({
    where: { id, expiresAt: { gt: new Date() } },
  });
  if (result.count !== 1) return false;
  await tx.mailOutbox.deleteMany({
    where: { id, kind: "account", failedAt: null },
  });
  return true;
}

const uniqueConstraintSchema = z.object({ fields: z.array(z.string()) });

function conflictsOnEmail(error: unknown): boolean {
  if (!isPrismaError(error, PrismaErrorCode.UniqueViolation)) return false;
  const constraint = violatedConstraint(error, uniqueConstraintSchema);
  return constraint === null || constraint.fields.includes("email");
}
