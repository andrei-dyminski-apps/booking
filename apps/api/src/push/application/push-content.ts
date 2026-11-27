import {
  describeNotification,
  notificationRoutes,
  type Notification,
  type PushGroup,
  type PushPayload,
} from "@repo/contracts";

/** A push as it is worded, before a delivery gives it the receipt of one browser. */
export type PushContent = Omit<PushPayload, "receipt">;
export type PushNews = { group: PushGroup; content: PushContent };

/**
 * A notification tray shows two or three lines; the thread, the stay or the bell holds the
 * rest. A notice's line can carry a cancellation's reason, so it is cut the same way: a
 * push past the four kilobytes Web Push allows is refused for good.
 */
const BODY_EXCERPT_LENGTH = 160;

/**
 * A notice as a push: the wording and the link of the bell, the toast and the email
 * (`describeNotification`). Keep payment failure diagnostics in the signed-in dashboard.
 */
export function noticePush(notification: Notification): PushContent {
  const { title, detail, href } = describeNotification(notification);

  return {
    title,
    body:
      notification.type === "PAYMENT_EVENT_FAILED" ||
      notification.type === "REFUND_FAILED" ||
      notification.type === "CANCELLATION_REFUND_FAILED" ||
      notification.type === "PAYOUT_FAILED"
        ? "Review the details in the admin dashboard."
        : excerpt(detail),
    url: href,
    tag: `notification-${notification.id}`,
  };
}

/** What a message push says: who wrote, about which listing, and the start of it. */
export type MessagePushSource = {
  conversationId: string;
  senderName: string;
  listingTitle: string;
  body: string;
};

/**
 * A message as a push. Tagged by its thread, so a burst of messages in one conversation
 * replaces one notification rather than stacking a notification per message.
 */
export function messagePush(source: MessagePushSource): PushContent {
  return {
    title: `${source.senderName} · ${source.listingTitle}`,
    body: excerpt(source.body),
    url: notificationRoutes.conversation(source.conversationId),
    tag: `conversation-${source.conversationId}`,
  };
}

function excerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const characters = Array.from(line);

  return characters.length <= BODY_EXCERPT_LENGTH
    ? line
    : `${characters.slice(0, BODY_EXCERPT_LENGTH - 1).join("")}…`;
}
