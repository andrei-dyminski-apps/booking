import { randomUUID } from "node:crypto";
import { NotificationType } from "@repo/contracts";
import { messagePush, noticePush } from "./push-content";

describe("messagePush", () => {
  const conversationId = randomUUID();

  it("folds the whitespace of a message into one line", () => {
    const push = messagePush({
      conversationId,
      senderName: "Alice",
      listingTitle: "Loft",
      body: "Hello,\n\n  is it   free?",
    });

    expect(push.body).toBe("Hello, is it free?");
  });

  it("cuts a long message to what a tray shows, by the characters a reader sees", () => {
    const push = messagePush({
      conversationId,
      senderName: "Alice",
      listingTitle: "Loft",
      body: "🏠".repeat(200),
    });

    expect(Array.from(push.body)).toHaveLength(160);
    expect(push.body.endsWith("…")).toBe(true);
  });
});

describe("noticePush", () => {
  it("cuts a cancellation whose reason is long to what a tray shows", () => {
    const push = noticePush({
      id: randomUUID(),
      type: NotificationType.BOOKING_CANCELLED,
      data: {
        bookingId: randomUUID(),
        listingId: randomUUID(),
        listingTitle: "Loft",
        from: "2026-07-01",
        to: "2026-07-03",
        recipient: "GUEST",
        refundCents: null,
        currency: "usd",
        cancelledBy: null,
        reason: "🏠".repeat(500),
      },
      readAt: null,
      createdAt: new Date().toISOString(),
    });

    expect(Array.from(push.body)).toHaveLength(160);
    expect(push.body.endsWith("…")).toBe(true);
  });

  it("keeps payment worker diagnostics in the admin dashboard", () => {
    const push = noticePush({
      id: randomUUID(),
      type: NotificationType.PAYMENT_EVENT_FAILED,
      data: {
        eventId: "evt_example",
        eventType: "payment_intent.succeeded",
        error: "Internal payment worker error",
      },
      readAt: null,
      createdAt: "2026-08-01T10:00:00.000Z",
    });

    expect(push.body).toBe("Review the details in the admin dashboard.");
  });

  it("says only where to look for a refund failure, whose detail is the provider's error", () => {
    const push = noticePush({
      id: randomUUID(),
      type: NotificationType.CANCELLATION_REFUND_FAILED,
      data: {
        bookingId: randomUUID(),
        error: "card_declined: the bank said no",
      },
      readAt: null,
      createdAt: "2026-08-01T10:00:00.000Z",
    });

    expect(push.body).toBe("Review the details in the admin dashboard.");
  });
});
