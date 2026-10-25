import {
  StayParty,
  type NotificationContent,
  type StayNotice,
} from "@repo/contracts";
import type { NotificationService } from "../../notification/notification.service";

/** The notices both sides of a stay can be sent, each told which side of it they are. */
type BothSidesNotice = Extract<
  NotificationContent,
  { data: { recipient: StayParty } }
>["type"];

/**
 * Tells the guest and the host of a stay the same news, leaving out `except` — whoever
 * made it happen and needs no notice of it. Written once because a confirmation, a lapse
 * and a cancellation are told this way from both the service and the webhook, and who
 * hears about a stay is one rule rather than four.
 */
export async function notifyBothSides(
  notificationService: Pick<NotificationService, "notify">,
  type: BothSidesNotice,
  {
    stay,
    guestId,
    listingOwnerId,
  }: { stay: StayNotice; guestId: string; listingOwnerId: string },
  except?: string,
): Promise<void> {
  const parties = [
    { userId: guestId, recipient: StayParty.GUEST },
    { userId: listingOwnerId, recipient: StayParty.HOST },
  ].filter(({ userId }) => userId !== except);

  await Promise.all(
    parties.map(({ userId, recipient }) =>
      notificationService.notify(userId, {
        type,
        data: { ...stay, recipient },
      }),
    ),
  );
}
