import type { MailGroup, NotificationType } from "@repo/contracts";

export function groupOf(type: NotificationType): MailGroup | null {
  switch (type) {
    case "BOOKING_REQUESTED":
    case "BOOKING_CONFIRMED":
    case "BOOKING_CANCELLED":
    case "STAY_ENDED_EARLY":
      return "stays";
    case "PAYMENT_REFUNDED":
    case "REFUND_FAILED":
    case "CANCELLATION_REFUND_FAILED":
    case "PAYOUT_SENT":
    case "PAYOUT_FAILED":
    case "PAYOUT_SHORTFALL":
    case "HOST_CANCELLATION_FEE":
    case "PAYMENT_DISPUTED":
      return "payments";
    case "WAITLIST_AVAILABLE":
      return "waitlist";
    default:
      return null;
  }
}

type Recipient = {
  email: string;
  emailVerifiedAt: Date | null;
  emailUndeliverableAt: Date | null;
};

export function canSendTo(email: string, production: boolean): boolean {
  return (
    !/@example\.(com|net|org)$/i.test(email) &&
    (!production || !/\.(example|invalid|test|localhost)$/i.test(email))
  );
}

export function canConfirm(user: Recipient, production: boolean): boolean {
  return (
    canSendTo(user.email, production) &&
    (!user.emailVerifiedAt || !!user.emailUndeliverableAt)
  );
}

export function canSendCopy(
  user: Recipient & { mutedMailGroups: readonly string[] },
  group: MailGroup,
  production: boolean,
): boolean {
  return (
    canSendTo(user.email, production) &&
    !!user.emailVerifiedAt &&
    !user.emailUndeliverableAt &&
    !user.mutedMailGroups.includes(group)
  );
}
