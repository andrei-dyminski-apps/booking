import { createTransport } from "nodemailer";
import {
  InboundMailAboveQuotaError,
  MailDeliveryError,
  MailQuotaError,
  isPermanentMailFailure,
  MailRateLimitError,
} from "../application/ports/mail-gateway";
import { MailpitGateway, ResendGateway } from "./mail-gateways";

const sendMail = jest.fn();

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ sendMail })),
}));

describe("ResendGateway", () => {
  const gateway = new ResendGateway("test-api-key", "host@mail.test");
  afterEach(() => jest.restoreAllMocks());

  it("sends both bodies and the reply address with the job's idempotency key", async () => {
    const providerId = "8b146471-e88e-4322-86af-016cd36fd216";
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ id: providerId }));
    const letter = {
      to: "guest@mail.test",
      subject: "Stay",
      text: "Details",
      html: "<p>Details</p>",
    };
    await expect(
      gateway.send(
        gateway.prepare({ ...letter, replyTo: "reply+signed@mail.test" }),
        "notice-1",
      ),
    ).resolves.toBe(providerId);
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer test-api-key",
        "Idempotency-Key": "notice-1",
      },
    });
    expect(
      JSON.parse(typeof options?.body === "string" ? options.body : "{}"),
    ).toEqual({
      ...letter,
      from: "host@mail.test",
      reply_to: "reply+signed@mail.test",
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
    });
  });

  it("reports the HTTP status without leaking the recipient or provider body", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("rejected guest@mail.test", { status: 429 }),
      );
    await expect(gateway.receive("email-id")).rejects.toThrow(
      /^Resend returned HTTP 429$/,
    );
  });

  it.each([
    ["invalid_idempotent_request", true],
    ["concurrent_idempotent_requests", false],
  ] as const)("classifies HTTP 409 %s", async (name, permanent) => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ name }, { status: 409 }));
    const failure: unknown = await gateway
      .send({ to: "guest@mail.test", body: "{}" }, "notice-1")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(isPermanentMailFailure(failure)).toBe(permanent);
  });

  it.each([
    ["daily_quota_exceeded", "2026-11-23T00:00:00.000Z"],
    ["monthly_quota_exceeded", "2026-12-01T00:00:00.000Z"],
  ])("defers %s until the UTC reset", async (name, reset) => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json(
          { name, message: "Do not log the provider body" },
          { status: 429, headers: { Date: "Sun, 22 Nov 2026 12:00:00 GMT" } },
        ),
      );
    await expect(
      gateway.send({ to: "guest@mail.test", body: "{}" }, "notice-1"),
    ).rejects.toEqual(new MailQuotaError(new Date(reset)));
  });

  it.each([
    [{ "retry-after": "7", "ratelimit-reset": "2" }, 7],
    [{ "retry-after": "invalid", "ratelimit-reset": "2" }, 2],
    [{}, 1],
  ])(
    "defers a request rate refusal using the provider headers %j",
    async (headers, delay) => {
      const now = new Date("2026-11-22T12:00:00Z");
      jest.spyOn(Date, "now").mockReturnValue(now.getTime());
      const responseHeaders = new Headers();
      for (const [header, value] of Object.entries(headers)) {
        if (value !== undefined) responseHeaders.set(header, value);
      }
      jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          Response.json(
            { name: "rate_limit_exceeded" },
            { status: 429, headers: responseHeaders },
          ),
        );
      await expect(
        gateway.send({ to: "guest@mail.test", body: "{}" }, "notice-1"),
      ).rejects.toEqual(
        new MailRateLimitError(new Date(now.getTime() + delay * 1000)),
      );
    },
  );

  it("distinguishes inbound quota refusals from other forbidden responses", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ name: "email_above_quota" }, { status: 403 }),
      )
      .mockResolvedValueOnce(
        Response.json({ name: "invalid_permission" }, { status: 403 }),
      );

    await expect(gateway.receive("email-id")).rejects.toBeInstanceOf(
      InboundMailAboveQuotaError,
    );
    await expect(gateway.receive("email-id")).rejects.toThrow(
      /^Resend returned HTTP 403$/,
    );
  });

  it("keeps the headers and forwarded recipients from a received message", async () => {
    const letter = {
      to: ["reply@mail.test"],
      cc: ["host@mail.test"],
      bcc: ["guest@mail.test"],
      received_for: ["forwarded@mail.test"],
      text: "Out of office",
      headers: { "auto-submitted": "auto-replied" },
    };
    jest.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(letter));

    await expect(gateway.receive("email-id")).resolves.toEqual(letter);
  });

  it("checks the provider's suppression list without altering it", async () => {
    const fetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    const email = "guest+one@mail.test";
    await expect(gateway.isSuppressed(email)).resolves.toBe(true);
    await expect(gateway.isSuppressed(email)).resolves.toBe(false);
    await expect(gateway.isSuppressed(email)).rejects.toThrow(
      "Resend returned HTTP 503",
    );
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.resend.com/suppressions/guest%2Bone%40mail.test",
    );
    expect(
      fetch.mock.calls.every(([, init]) => init?.method === undefined),
    ).toBe(true);
  });
});

describe("MailpitGateway", () => {
  const gateway = new MailpitGateway(
    "smtp://localhost:1025",
    "staydesk@mail.test",
  );
  afterEach(() => sendMail.mockReset());

  it("bounds every SMTP wait so a stopped Mailpit cannot hold a job", () => {
    const options = jest.mocked(createTransport).mock.calls[0]?.[0];
    if (typeof options !== "string") throw new Error("Expected an SMTP URL");
    const url = new URL(options);
    expect(url.host).toBe("localhost:1025");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      dnsTimeout: "3000",
      connectionTimeout: "3000",
      greetingTimeout: "3000",
      socketTimeout: "5000",
    });
  });

  it("sends the prepared letter from the configured sender under the job's key", async () => {
    sendMail.mockResolvedValue({});
    const letter = {
      to: "guest@mail.test",
      subject: "Reset your StayDesk password",
      text: "Open the link",
      html: "<p>Open the link</p>",
      replyTo: "reply+signed@mail.test",
    };
    await gateway.send(gateway.prepare(letter), "account-1");
    expect(sendMail).toHaveBeenCalledWith({
      ...letter,
      from: "staydesk@mail.test",
      headers: {
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
      },
      messageId: "<account-1@mailpit.local>",
    });
  });

  it("reports a refused connection as a delivery failure the job retries", async () => {
    sendMail.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:1025"),
    );
    const request = gateway.prepare({
      to: "guest@mail.test",
      subject: "Stay",
      text: "Details",
      html: "<p>Details</p>",
    });
    const sent = gateway.send(request, "notice-1");
    await expect(sent).rejects.toBeInstanceOf(MailDeliveryError);
    await expect(sent).rejects.toThrow("Mailpit did not accept the message");
    await expect(sent).rejects.not.toThrow(/ECONNREFUSED|guest@mail\.test/);
    expect(
      isPermanentMailFailure(await sent.catch((error: unknown) => error)),
    ).toBe(false);
  });

  it("has no inbox and no suppression list of its own", async () => {
    await expect(gateway.receive()).rejects.toMatchObject({ status: 404 });
    await expect(gateway.sentRecipients()).resolves.toEqual([]);
    await expect(gateway.isSuppressed()).resolves.toBe(false);
  });
});
