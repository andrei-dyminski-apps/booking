import {
  StayParty,
  type NotificationContent,
  type StayNotice,
} from "@repo/contracts";
import type { NotificationService } from "../../notification/notification.service";

type BothSidesNotice = Extract<
  NotificationContent,
  { data: { recipient: StayParty } }
>["type"];

/** Both sides of a stay, leaving out `except` — whoever made it happen. */
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
