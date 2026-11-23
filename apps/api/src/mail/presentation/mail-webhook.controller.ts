import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { apiException } from "../../common/api-exception";
import type { Request } from "express";
import { Public } from "../../auth/decorators/public.decorator";
import { MailInbox } from "../application/mail-inbox";
import type { MailEventInput } from "../application/mail-event";
import { readResendMailEvent } from "../infrastructure/resend-webhook";

@Controller("webhooks/mail")
export class MailWebhookController {
  constructor(private readonly mailInbox: MailInbox) {}

  @Public()
  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @SkipThrottle()
  async handle(@Req() req: RawBodyRequest<Request>) {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret)
      throw new ServiceUnavailableException("Mail webhook is not configured");
    const id = req.get("svix-id");
    if (!req.rawBody || !id)
      throw apiException(
        BadRequestException,
        "WEBHOOK_SIGNATURE_MISSING",
        "Missing webhook signature",
      );
    let event: MailEventInput | undefined;
    try {
      event = readResendMailEvent(secret, req.rawBody, req.body, {
        id,
        timestamp: req.get("svix-timestamp") ?? "",
        signature: req.get("svix-signature") ?? "",
      });
    } catch {
      throw apiException(
        BadRequestException,
        "WEBHOOK_EVENT_INVALID",
        "Invalid mail webhook",
      );
    }
    if (event) await this.mailInbox.accept(event);
  }
}
