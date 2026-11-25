import { mailGroupSchema, notificationTypeSchema } from "@repo/contracts";
import { canConfirm, canSendCopy, canSendTo, groupOf } from "./mail-policy";

const verified = new Date("2026-01-01T00:00:00.000Z");

describe("canSendTo", () => {
  it.each([
    "guest@example.com",
    "owner@EXAMPLE.com",
    "ines@example.net",
    "sam@example.org",
  ])(
    "never sends to %s, the seed's demo domains, in any environment",
    (email) => {
      expect(canSendTo(email, false)).toBe(false);
      expect(canSendTo(email, true)).toBe(false);
    },
  );

  it.each([
    "me@staydesk.test",
    "me@host.localhost",
    "me@mail.example",
    "me@mail.invalid",
  ])(
    "sends to %s locally, where Mailpit catches it, but not in production",
    (email) => {
      expect(canSendTo(email, false)).toBe(true);
      expect(canSendTo(email, true)).toBe(false);
    },
  );

  it("sends to a real domain, including one that only contains a reserved word", () => {
    for (const email of [
      "me@gmail.com",
      "me@example.com.au",
      "me@notexample.com",
      "me@test.dev",
    ]) {
      expect(canSendTo(email, true)).toBe(true);
    }
  });
});

describe("canConfirm", () => {
  const user = {
    email: "me@gmail.com",
    emailVerifiedAt: null,
    emailUndeliverableAt: null,
  };

  it("offers a confirmation to an unverified mailbox", () => {
    expect(canConfirm(user, true)).toBe(true);
  });

  it("offers none to a verified mailbox that still receives mail", () => {
    expect(canConfirm({ ...user, emailVerifiedAt: verified }, true)).toBe(
      false,
    );
  });

  it("offers one again once the verified mailbox bounced", () => {
    expect(
      canConfirm(
        { ...user, emailVerifiedAt: verified, emailUndeliverableAt: verified },
        true,
      ),
    ).toBe(true);
  });

  it("offers none to an address mail is never sent to", () => {
    expect(canConfirm({ ...user, email: "guest@example.com" }, false)).toBe(
      false,
    );
  });
});

describe("canSendCopy", () => {
  const user = {
    email: "me@gmail.com",
    emailVerifiedAt: verified,
    emailUndeliverableAt: null,
    mutedMailGroups: [] as string[],
  };

  it("copies a notice to a verified mailbox", () => {
    expect(canSendCopy(user, "stays", true)).toBe(true);
  });

  it("copies nothing to an unverified mailbox", () => {
    expect(canSendCopy({ ...user, emailVerifiedAt: null }, "stays", true)).toBe(
      false,
    );
  });

  it("copies nothing to a mailbox that bounced", () => {
    expect(
      canSendCopy({ ...user, emailUndeliverableAt: verified }, "stays", true),
    ).toBe(false);
  });

  it("copies nothing of a muted group and still copies the others", () => {
    const muted = { ...user, mutedMailGroups: ["payments"] };
    expect(canSendCopy(muted, "payments", true)).toBe(false);
    expect(canSendCopy(muted, "stays", true)).toBe(true);
  });

  it("copies nothing to a demo address even when it is verified", () => {
    expect(
      canSendCopy({ ...user, email: "owner@example.com" }, "stays", false),
    ).toBe(false);
  });
});

describe("groupOf", () => {
  it("leaves no group but messages without a notice to mute, since messages are digests", () => {
    const reached = new Set(notificationTypeSchema.options.map(groupOf));
    for (const group of mailGroupSchema.options) {
      expect(reached.has(group)).toBe(group !== "messages");
    }
  });

  it("files a notice that is only shown in the app under no group", () => {
    expect(groupOf("BOOKING_EXPIRED")).toBeNull();
  });
});
