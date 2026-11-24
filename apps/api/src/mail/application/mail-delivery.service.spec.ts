import { addHours, subSeconds } from "date-fns";
import { Test } from "@nestjs/testing";
import { signature } from "./mail-content";
import { MailDeliveryService } from "./mail-delivery.service";
import { MailRetryExpired, type MailTask } from "./mail-task";
import { MailGateway } from "./ports/mail-gateway";
import { InMemoryMailGateway } from "../infrastructure/mail-gateways";
import { MailOutboxRepository } from "../infrastructure/mail-outbox.repository";
import { MailRepository } from "../infrastructure/mail.repository";

type Recipient = NonNullable<Awaited<ReturnType<MailRepository["user"]>>>;

describe("MailDeliveryService", () => {
  const recipient: Recipient = {
    id: "recipient",
    email: "recipient@mail.test",
    role: "USER",
    emailVerifiedAt: null,
    emailUndeliverableAt: null,
    mutedMailGroups: [],
  };
  const confirmation: MailTask = {
    kind: "confirm",
    id: "confirmation",
    userId: recipient.id,
  };
  const key = "confirm-confirmation";
  const issuedAt = new Date("2026-11-22T00:00:00Z");
  const attempt = {
    startedAt: issuedAt,
    digest: null,
    delivery: null,
  };
  let mailDeliveryService: MailDeliveryService;
  let mailGateway: InMemoryMailGateway;
  const startConfirmation = jest.fn<
    ReturnType<MailRepository["startConfirmation"]>,
    Parameters<MailRepository["startConfirmation"]>
  >();
  const user = jest.fn<ReturnType<MailRepository["user"]>, [string]>();

  beforeEach(async () => {
    jest.replaceProperty(process, "env", {
      ...process.env,
      JWT_REFRESH_SECRET: "mail-test-secret",
      SITE_ORIGIN: "https://staydesk.test",
    });
    startConfirmation.mockReset();
    user.mockReset().mockResolvedValue(recipient);
    mailGateway = new InMemoryMailGateway();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailDeliveryService,
        { provide: MailRepository, useValue: { startConfirmation, user } },
        { provide: MailGateway, useValue: mailGateway },
        {
          provide: MailOutboxRepository,
          useValue: {
            freezeDelivery: jest
              .fn<
                ReturnType<MailOutboxRepository["freezeDelivery"]>,
                Parameters<MailOutboxRepository["freezeDelivery"]>
              >()
              .mockImplementation((_task, candidate) =>
                Promise.resolve(candidate),
              ),
          },
        },
      ],
    }).compile();
    mailDeliveryService = moduleRef.get(MailDeliveryService);
  });

  afterEach(() => jest.restoreAllMocks());

  it("uses the original issue time and the same delivery key on retry", async () => {
    startConfirmation.mockResolvedValue({ attempt: 1, startedAt: issuedAt });

    await mailDeliveryService.deliver(confirmation, key, attempt);
    await mailDeliveryService.deliver(confirmation, key, attempt);

    const token = signature("confirm/confirmation");
    expect(
      startConfirmation.mock.calls.map(([task, token, date]) => [
        task.userId,
        token,
        date,
      ]),
    ).toEqual([
      [recipient.id, token, issuedAt],
      [recipient.id, token, issuedAt],
    ]);
    expect(mailGateway.sent.size).toBe(1);
    expect(mailGateway.sent.get(key)?.text).toContain(
      "https://staydesk.test/confirm-email#" + token,
    );
  });

  it.each([
    [1, false],
    [-2, false],
    [10, true],
  ] as const)(
    "rechecks a retry with %i seconds left after acquiring the lock",
    async (secondsLeft, canSend) => {
      const deadline = addHours(issuedAt, 24);
      const clock = jest.spyOn(Date, "now").mockReturnValue(issuedAt.getTime());
      startConfirmation.mockImplementation(() => {
        clock.mockReturnValue(subSeconds(deadline, secondsLeft).getTime());
        return Promise.resolve({ attempt: 2, startedAt: issuedAt });
      });
      const delivery = mailDeliveryService.deliver(confirmation, key, attempt);
      if (canSend) await delivery;
      else await expect(delivery).rejects.toBeInstanceOf(MailRetryExpired);
      expect(mailGateway.sent.has(key)).toBe(canSend);
    },
  );

  it("skips delivery when the repository refuses to issue a link", async () => {
    startConfirmation.mockResolvedValue(undefined);

    await mailDeliveryService.deliver(confirmation, key, attempt);

    expect(mailGateway.sent.size).toBe(0);
  });

  it.each([
    ["mail-demo.test", "", "https://mail-demo.test"],
    [
      "ftp://invalid.test",
      " *, http://mail-demo.test:3100 ",
      "http://mail-demo.test:3100",
    ],
    ["", "", "http://localhost:3100"],
  ])(
    "renders a valid link with site origin %p and web origins %p",
    async (site, web, expected) => {
      const env = jest.replaceProperty(process, "env", {
        ...process.env,
        SITE_ORIGIN: site,
        WEB_ORIGIN: web,
        WEB_PORT: "3100",
      });
      try {
        startConfirmation.mockResolvedValue({
          attempt: 1,
          startedAt: issuedAt,
        });
        await mailDeliveryService.deliver(confirmation, key, attempt);
        expect(mailGateway.sent.get(key)?.text).toContain(
          expected + "/confirm-email#",
        );
      } finally {
        env.restore();
      }
    },
  );

  it("skips an old confirmation after delivery is paused", async () => {
    user.mockResolvedValue({
      ...recipient,
      emailUndeliverableAt: new Date("2026-11-22T00:01:00Z"),
    });

    await mailDeliveryService.deliver(confirmation, key, attempt);

    expect(startConfirmation).not.toHaveBeenCalled();
    expect(mailGateway.sent.size).toBe(0);
  });
});
