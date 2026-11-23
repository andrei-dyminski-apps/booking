import {
  HttpException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { sendMessageSchema } from "@repo/contracts";
import { ConversationService } from "../../conversation/conversation.service";
import {
  DuplicateReplyError,
  InvalidReplyError,
} from "../../conversation/conversation.repository";
import {
  MAIL_EVENT_ATTEMPTS,
  inboundRecipients,
  type MailEvent,
  type MailEventInput,
} from "./mail-event";
import { replyTokenHash } from "./mail-content";
import {
  InboundMailAboveQuotaError,
  isPermanentMailFailure,
  mailFailureStatus,
  mailFailureText,
  MailGateway,
} from "./ports/mail-gateway";
import { MailRepository } from "../infrastructure/mail.repository";
import { isAutomaticReply, replyText } from "./reply-text";

const SWEEP_INTERVAL_MS = 10_000;
const SWEEP_BATCH = 25;

@Injectable()
export class MailInbox implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MailInbox.name);
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private closing = false;

  constructor(
    private readonly mailRepository: MailRepository,
    private readonly mailGateway: MailGateway,
    private readonly conversationService: ConversationService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(
      () => void this.sweep(),
      SWEEP_INTERVAL_MS,
    ).unref();
    void this.sweep();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    this.closing = true;
    await this.running;
  }

  async accept(event: MailEventInput) {
    const incoming = event.kind === "email.received";
    const replyHash = incoming ? uniqueReplyHash(event.recipients) : null;
    if (incoming && !replyHash && event.recipients.length) {
      this.logUnplaceable(event.id);
      return;
    }
    const stored = await this.mailRepository.record({
      ...event,
      recipients: incoming ? [] : event.recipients,
      replyTokenHash: replyHash,
    });
    if (!stored.processedAt && !stored.failedAt) void this.sweep();
  }

  // A sweep recovers work even if Redis is down or the process ended after acknowledging it.
  sweep(): Promise<void> {
    if (this.closing) return Promise.resolve();
    this.running ??= this.drain()
      .catch(() => this.logger.error("Could not sweep the mail inbox"))
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  private async drain() {
    for (let i = 0; i < SWEEP_BATCH && !this.closing; i++) {
      const event = await this.mailRepository.claim();
      if (!event) break;
      try {
        await this.process(event);
      } catch (error) {
        if (error instanceof InboundMailAboveQuotaError) {
          this.logger.warn("Dropped an email received above quota " + event.id);
          await this.mailRepository.done(event);
          continue;
        }
        const status = mailFailureStatus(error);
        const missing = status === 404 || status === 410;
        if (missing && event.attempts >= 5) {
          this.logger.warn(
            "Mail provider no longer has email for event " + event.id,
          );
          await this.mailRepository.done(event);
        } else if (
          event.attempts >= MAIL_EVENT_ATTEMPTS ||
          (!missing && isPermanentMailFailure(error))
        ) {
          const reason = mailFailureText(error);
          await this.mailRepository.setAside(event, reason);
          this.logger.error(`Mail event ${event.id} set aside: ${reason}`);
        } else {
          await this.mailRepository.retry(event);
          this.logger.warn(
            "Will retry mail event " +
              event.id +
              (status ? " after HTTP " + String(status) : ""),
          );
        }
      }
    }
  }

  private async process(event: MailEvent) {
    if (event.kind !== "email.received") {
      const recipientIds = event.lookupRecipients
        ? await this.mailRepository.recipientIds(
            await this.mailGateway.sentRecipients(event.emailId),
            event.createdAt,
          )
        : event.recipientIds;
      await this.mailRepository.suppress(event, recipientIds);
      return;
    }

    if (!(await this.receive(event))) this.logUnplaceable(event.id);
    await this.mailRepository.done(event);
  }

  private logUnplaceable(id: string) {
    this.logger.warn("Dropped an unplaceable email reply " + id);
  }

  private async receive(event: MailEvent) {
    const legacy = event.replyTokenHash
      ? undefined
      : await this.mailGateway.receive(event.emailId);
    const hash =
      event.replyTokenHash ??
      uniqueReplyHash(legacy ? inboundRecipients(legacy) : []);
    if (!hash) return false;
    const target = await this.mailRepository.replyTarget(hash, event.createdAt);
    if (!target) return false;
    const letter = legacy ?? (await this.mailGateway.receive(event.emailId));
    if (isAutomaticReply(letter)) return false;
    const input = sendMessageSchema.safeParse({ body: replyText(letter) });
    if (!input.success) return false;
    try {
      await this.conversationService.send(
        target.threadId,
        target.user,
        input.data,
        { id: event.emailId, tokenHash: hash, receivedAt: event.createdAt },
      );
      return true;
    } catch (error) {
      if (error instanceof DuplicateReplyError) return true;
      if (error instanceof InvalidReplyError) return false;
      if (error instanceof HttpException && error.getStatus() < 500)
        return false;
      throw error;
    }
  }
}

function uniqueReplyHash(recipients: readonly string[]): string | null {
  const hashes = new Set(
    recipients.map(replyTokenHash).filter((hash) => hash !== null),
  );
  return hashes.size === 1 ? (hashes.values().next().value ?? null) : null;
}
