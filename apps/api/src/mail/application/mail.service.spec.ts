import { ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MailOutboxRepository } from "../infrastructure/mail-outbox.repository";
import { MailGateway } from "./ports/mail-gateway";
import { InMemoryMailGateway } from "../infrastructure/mail-gateways";
import { MailRepository } from "../infrastructure/mail.repository";
import { MailService } from "./mail.service";

type Recipient = NonNullable<Awaited<ReturnType<MailRepository["user"]>>>;

const recipient: Recipient = {
  id: "recipient",
  email: "recipient@mail.test",
  role: "USER",
  emailVerifiedAt: null,
  emailUndeliverableAt: null,
  mutedMailGroups: [],
};

describe("MailService", () => {
  let mailService: MailService;
  const user = jest.fn<ReturnType<MailRepository["user"]>, [string]>();
  const confirmation = jest.fn<Promise<void>, [string]>();
  let mailGateway: InMemoryMailGateway;

  beforeEach(async () => {
    user.mockReset();
    confirmation.mockReset();
    mailGateway = new InMemoryMailGateway();

    const moduleRef = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MailRepository, useValue: { user } },
        { provide: MailOutboxRepository, useValue: { confirmation } },
        { provide: MailGateway, useValue: mailGateway },
      ],
    }).compile();
    mailService = moduleRef.get(MailService);
  });

  it("returns a 503 for an explicit resend that could not be queued", async () => {
    user.mockResolvedValue(recipient);
    confirmation.mockRejectedValue(new Error("Postgres unavailable"));

    await expect(mailService.resend(recipient.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(confirmation).toHaveBeenCalledWith(recipient.id);
  });

  it("refuses a resend while the provider still suppresses the address", async () => {
    user.mockResolvedValue({
      ...recipient,
      emailUndeliverableAt: new Date(),
    });
    mailGateway.suppressed.add(recipient.email);

    await expect(mailService.resend(recipient.id)).rejects.toMatchObject({
      response: { code: "EMAIL_DELIVERY_SUPPRESSED" },
    });
    expect(confirmation).not.toHaveBeenCalled();
  });
});
