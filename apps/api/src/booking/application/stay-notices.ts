import {
  NotificationType,
  type Canceller,
  StayParty,
  type NotificationContent,
  type StayNotice,
} from "@repo/contracts";
import type { NotificationService } from "../../notification/notification.service";
import type { Cents, Currency } from "../../payment/domain/money";

type BothSidesNotice = Exclude<
  Extract<NotificationContent, { data: { recipient: StayParty } }>["type"],
  typeof NotificationType.BOOKING_CANCELLED
>;

type Parties = { stay: StayNotice; guestId: string; listingOwnerId: string };

/**
 * What a cancellation gives back, who made it and why, stated to both sides beside the stay.
 * The provider's news cancels with no canceller and no reason.
 */
export type CancellationNotice = {
  refundCents: Cents | null;
  currency: Currency;
  cancelledBy: Canceller | null;
  reason: string | null;
};

/** Both sides of a stay, leaving out `except` — whoever made it happen. */
export async function notifyBothSides(
  notificationService: Pick<NotificationService, "notify">,
  type: BothSidesNotice,
  parties: Parties,
  except?: string,
): Promise<void> {
  await toBothSides(notificationService, parties, except, (recipient) => ({
    type,
    data: { ...parties.stay, recipient },
  }));
}

/** The same, for a cancellation: its notice carries what it gives back and who made it. */
export async function notifyBothSidesOfCancellation(
  notificationService: Pick<NotificationService, "notify">,
  { notice, ...parties }: Parties & { notice: CancellationNotice },
  except?: string,
): Promise<void> {
  await toBothSides(notificationService, parties, except, (recipient) => ({
    type: NotificationType.BOOKING_CANCELLED,
    data: { ...parties.stay, recipient, ...notice },
  }));
}

async function toBothSides(
  notificationService: Pick<NotificationService, "notify">,
  { guestId, listingOwnerId }: Parties,
  except: string | undefined,
  contentFor: (recipient: StayParty) => NotificationContent,
): Promise<void> {
  const parties = [
    { userId: guestId, recipient: StayParty.GUEST },
    { userId: listingOwnerId, recipient: StayParty.HOST },
  ].filter(({ userId }) => userId !== except);

  await Promise.all(
    parties.map(({ userId, recipient }) =>
      notificationService.notify(userId, contentFor(recipient)),
    ),
  );
}
