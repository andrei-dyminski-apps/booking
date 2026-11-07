import type { NotificationContent } from "@repo/contracts";
import type { NotificationService } from "../../../notification/notification.service";

/**
 * `notify` and `notifyAdmins`, the two methods these services call: what is asserted is who
 * was told what, and the storing and pushing behind it are `notification.service.spec.ts`'s.
 */
export class FakeNotificationService implements Pick<
  NotificationService,
  "notify" | "notifyAdmins"
> {
  readonly notices: { userId: string; content: NotificationContent }[] = [];
  readonly toAdmins: NotificationContent[] = [];

  notify(userId: string, content: NotificationContent): Promise<void> {
    this.notices.push({ userId, content });

    return Promise.resolve();
  }

  notifyAdmins(content: NotificationContent): Promise<void> {
    this.toAdmins.push(content);

    return Promise.resolve();
  }
}
