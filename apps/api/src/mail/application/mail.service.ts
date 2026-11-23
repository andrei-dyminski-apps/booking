import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  mailSettingsSchema,
  type MailGroup,
  type MailSettings,
} from "@repo/contracts";
import { apiException } from "../../common/api-exception";
import { sessionNotFound } from "../../common/session-errors";
import { canConfirm } from "../domain/mail-policy";
import { MailOutboxRepository } from "../infrastructure/mail-outbox.repository";
import { MailGateway } from "./ports/mail-gateway";
import { MailRepository } from "../infrastructure/mail.repository";

@Injectable()
export class MailService {
  constructor(
    private readonly mailRepository: MailRepository,
    private readonly outbox: MailOutboxRepository,
    private readonly mailGateway: MailGateway,
  ) {}

  async settings(userId: string): Promise<MailSettings> {
    const user = await this.mailRepository.user(userId);
    if (!user) throw sessionNotFound();
    return mailSettingsSchema.parse({
      verified: !!user.emailVerifiedAt,
      undeliverable: !!user.emailUndeliverableAt,
      muted: user.mutedMailGroups,
      canRequestConfirmation: canConfirm(
        user,
        process.env.NODE_ENV === "production",
      ),
    });
  }

  preferences(userId: string, muted: MailGroup[]): Promise<void> {
    return this.mailRepository.preferences(userId, muted);
  }

  async resend(userId: string): Promise<void> {
    const recipient = await this.mailRepository.user(userId);
    if (!recipient) throw sessionNotFound();
    if (!canConfirm(recipient, process.env.NODE_ENV === "production"))
      throw apiException(
        ConflictException,
        "EMAIL_CONFIRMATION_UNAVAILABLE",
        recipient.emailVerifiedAt && !recipient.emailUndeliverableAt
          ? "Your email is already confirmed."
          : "Email confirmation is unavailable for this address.",
      );

    if (recipient.emailUndeliverableAt) {
      const suppressed = await this.mailGateway
        .isSuppressed(recipient.email)
        .catch(() => {
          throw new ServiceUnavailableException(
            "Could not check email delivery. Please try again.",
          );
        });
      if (suppressed)
        throw apiException(
          ConflictException,
          "EMAIL_DELIVERY_SUPPRESSED",
          "Email delivery is paused. Contact support before requesting another confirmation.",
        );
    }

    try {
      await this.outbox.confirmation(userId);
    } catch {
      throw new ServiceUnavailableException(
        "Could not queue a confirmation. Please try again.",
      );
    }
  }

  async confirm(token: string): Promise<void> {
    if (!(await this.mailRepository.confirm(token)))
      throw apiException(
        BadRequestException,
        "EMAIL_CONFIRMATION_INVALID",
        "This confirmation link is invalid or expired",
      );
  }
}
