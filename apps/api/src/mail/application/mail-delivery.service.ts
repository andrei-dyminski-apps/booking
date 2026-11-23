import { addHours } from "date-fns";
import { Injectable } from "@nestjs/common";
import { describeNotification } from "@repo/contracts";
import { canConfirm, canSendCopy, groupOf } from "../domain/mail-policy";
import {
  hashMailToken,
  accountMailToken,
  renderLetter,
  replyAddress,
  signature,
} from "./mail-content";
import {
  MAIL_SEND_ATTEMPTS,
  MailAccountDeliveryStopped,
  MailAttemptsExhausted,
  MailRetryExpired,
  type DeliverySnapshot,
  type MailAttempt,
  type QueuedMail,
} from "./mail-task";
import {
  MAIL_PROVIDER_TIMEOUT_MS,
  MailDeferredError,
  MailGateway,
} from "./ports/mail-gateway";
import { MailOutboxRepository } from "../infrastructure/mail-outbox.repository";
import { MailRepository } from "../infrastructure/mail.repository";

@Injectable()
export class MailDeliveryService {
  constructor(
    private readonly mailRepository: MailRepository,
    private readonly mailGateway: MailGateway,
    private readonly outbox: MailOutboxRepository,
  ) {}

  async deliver(task: QueuedMail, key: string, attempt: MailAttempt) {
    const production = process.env.NODE_ENV === "production";
    const started =
      task.kind === "digest"
        ? await this.startDigest(task, attempt, production)
        : task.kind === "account"
          ? await this.startAccountMail(task, attempt)
          : await this.startMail(task, attempt, production);
    if (!started) return;
    // Account and conversation locks may have outlasted the worker's initial check.
    if (
      started.attempt > 1 &&
      Date.now() + MAIL_PROVIDER_TIMEOUT_MS >=
        addHours(started.startedAt, 24).getTime()
    )
      throw new MailRetryExpired();
    try {
      return await this.mailGateway.send(started.delivery.request, key);
    } catch (error) {
      if (
        started.attempt === MAIL_SEND_ATTEMPTS &&
        !(error instanceof MailDeferredError)
      )
        throw new MailAttemptsExhausted(error);
      throw error;
    }
  }

  private async startAccountMail(task: QueuedMail, attempt: MailAttempt) {
    const action = await this.mailRepository.accountMail(task.id);
    if (!action) return;

    let suppressionCheckedAt: Date | undefined;
    if (action.kind === "reset" && action.userId) {
      const user = await this.mailRepository.user(action.userId);
      if (!user?.emailVerifiedAt || user.email !== action.email) return;
      if (user.emailUndeliverableAt) {
        suppressionCheckedAt = new Date();
        if (await this.mailGateway.isSuppressed(action.email))
          throw new MailAccountDeliveryStopped(
            "Account recovery email is suppressed",
          );
      }
    }

    let delivery = attempt.delivery;
    if (!delivery) {
      const token = accountMailToken(action.id);
      if (action.tokenHash && hashMailToken(token) !== action.tokenHash) return;
      const letter = accountLetter(action.kind, token, action.nextPath);
      if (!letter) return;
      delivery =
        (await this.outbox.freezeDelivery(task, {
          kind: "account",
          request: this.mailGateway.prepare({ ...letter, to: action.email }),
        })) ?? null;
    }
    if (delivery?.kind !== "account") return;
    const started = await this.mailRepository.startAccountMail(
      task,
      action.userId,
      suppressionCheckedAt,
    );
    if (started) return { delivery, ...started };
  }

  private async startMail(
    task: QueuedMail,
    attempt: MailAttempt,
    production: boolean,
  ) {
    let delivery = attempt.delivery;
    if (!delivery) {
      const candidate = await this.prepare(task, production);
      if (!candidate) return;
      delivery = (await this.outbox.freezeDelivery(task, candidate)) ?? null;
    }
    if (!delivery || delivery.kind === "digest" || delivery.kind === "account")
      return;
    const started = await this.startSending(
      task,
      delivery,
      attempt.startedAt,
      production,
    );
    if (started) return { delivery, ...started };
  }

  private async prepare(
    task: QueuedMail,
    production: boolean,
  ): Promise<DeliverySnapshot | undefined> {
    const { id, userId, kind } = task;
    const user = await this.mailRepository.user(userId);
    if (!user) return;
    if (kind === "confirm") {
      if (!canConfirm(user, production)) return;
      const token = signature("confirm/" + id);
      const letter = renderLetter(
        "Confirm your email address",
        "Confirm this address within 24 hours to receive StayDesk emails.",
        "/confirm-email#" + token,
      );
      return {
        kind,
        token,
        request: this.mailGateway.prepare({ ...letter, to: user.email }),
      };
    }
    const notice = await this.mailRepository.notice(id, userId);
    const group = notice && groupOf(notice.type);
    if (!notice || !group || !canSendCopy(user, group, production)) return;
    const {
      title,
      detail: notificationDetail,
      href,
    } = describeNotification(notice);
    const detail =
      notice.type === "CANCELLATION_REFUND_FAILED" ||
      notice.type === "PAYOUT_FAILED"
        ? "Review the details in the admin dashboard."
        : notificationDetail;
    const letter = renderLetter(title, detail, href);
    return {
      kind: "notice",
      group,
      request: this.mailGateway.prepare({ ...letter, to: user.email }),
    };
  }

  private async startSending(
    task: QueuedMail,
    delivery: Exclude<DeliverySnapshot, { kind: "digest" | "account" }>,
    issuedAt: Date,
    production: boolean,
  ) {
    if (delivery.kind === "notice") {
      return this.mailRepository.startCopy(
        task,
        (user) =>
          user.email === delivery.request.to &&
          canSendCopy(user, delivery.group, production),
      );
    }

    const recipient = await this.mailRepository.user(task.userId);
    if (
      !recipient ||
      recipient.email !== delivery.request.to ||
      !canConfirm(recipient, production)
    )
      return;

    const suppressedAt = recipient.emailUndeliverableAt;
    const recoveryCheckedAt = suppressedAt ? new Date() : null;
    if (
      suppressedAt &&
      (issuedAt <= suppressedAt ||
        (await this.mailGateway.isSuppressed(recipient.email)))
    )
      return;

    return this.mailRepository.startConfirmation(
      task,
      delivery.token,
      issuedAt,
      recoveryCheckedAt,
      (user) =>
        canConfirm(user, production) &&
        user.email === recipient.email &&
        user.emailUndeliverableAt?.getTime() === suppressedAt?.getTime(),
    );
  }

  private async startDigest(
    task: QueuedMail,
    attempt: MailAttempt,
    production: boolean,
  ) {
    const { id, deliveryRound } = task;
    const eligible = (user: Parameters<typeof canSendCopy>[0]) =>
      canSendCopy(user, "messages", production);
    const frozen = attempt.delivery;
    if (frozen && frozen.kind !== "digest") return;
    if (frozen && !attempt.rebuildDigest) {
      return this.mailRepository.startDigest(
        task,
        attempt,
        frozen.replyHash,
        eligible,
        () => frozen,
      );
    }

    const legacy = attempt.rebuildDigest ? null : attempt.digest;
    if (legacy) {
      const { replyAddressHash, ...letter } = legacy;
      const reply = replyAddressHash ? replyAddress(id) : undefined;
      if (
        replyAddressHash &&
        (!reply || hashMailToken(reply.address) !== replyAddressHash)
      )
        return;
      return this.mailRepository.startDigest(
        task,
        attempt,
        reply?.hash ?? null,
        eligible,
        (_current, _replyAllowed, to) => ({
          kind: "digest",
          request: this.mailGateway.prepare({
            ...letter,
            to,
            replyTo: reply?.address,
          }),
          replyHash: reply?.hash ?? null,
        }),
      );
    }

    const reply = replyAddress(id, deliveryRound);
    return this.mailRepository.startDigest(
      task,
      attempt,
      reply?.hash ?? null,
      eligible,
      (current, replyAllowed, to) => {
        const letter = renderLetter(
          "Unread messages about " + current.title,
          String(current.count) +
            (current.count === 1 ? " unread message" : " unread messages") +
            "\n\n" +
            current.latestBody,
          "/messages/" + current.threadId,
        );
        const allowedReply = replyAllowed ? reply : undefined;
        return {
          kind: "digest",
          request: this.mailGateway.prepare({
            ...letter,
            to,
            replyTo: allowedReply?.address,
          }),
          replyHash: allowedReply?.hash ?? null,
          throughId: current.latestId,
        };
      },
    );
  }
}

function accountLetter(kind: string, token: string, nextPath: string | null) {
  switch (kind) {
    case "register": {
      const next = nextPath
        ? "?" + new URLSearchParams({ next: nextPath }).toString()
        : "";
      return renderLetter(
        "Finish creating your StayDesk account",
        "Open this link within 24 hours to choose your password and finish signing up.",
        "/complete-registration" + next + "#" + token,
      );
    }
    case "reset":
      return renderLetter(
        "Reset your StayDesk password",
        "Open this link within 30 minutes to choose a new password. If you did not request a reset, you can ignore this email.",
        "/reset-password#" + token,
      );
    case "change":
      return renderLetter(
        "Confirm your new StayDesk email address",
        "Open this link within 24 hours to change your account email address.",
        "/confirm-email?change=1#" + token,
      );
    case "emailChanged":
      return renderLetter(
        "Your StayDesk email address changed",
        "Your account now uses a different email address. If you did not make this change, contact support@staydesk.dev.",
        "/",
      );
    case "passwordChanged":
      return renderLetter(
        "Your StayDesk password changed",
        "Your existing sessions have ended. If you did not make this change, contact support@staydesk.dev.",
        "/login",
      );
  }
}
