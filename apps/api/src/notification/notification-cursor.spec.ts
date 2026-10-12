import { randomUUID } from "node:crypto";
import { NotificationType, type Notification } from "@repo/contracts";
import { encodeParts } from "../common/paging";
import { decodeCursor, encodeCursor } from "./notification-cursor";

const notification: Notification = {
  id: randomUUID(),
  type: NotificationType.BOOKING_REQUESTED,
  data: {
    bookingId: randomUUID(),
    listingId: randomUUID(),
    listingTitle: "Loft above the harbour",
    from: "2026-09-01",
    to: "2026-09-05",
  },
  readAt: null,
  createdAt: "2026-10-11T08:00:00.000Z",
};

describe("notification cursor", () => {
  it("reads back the place it was issued for", () => {
    expect(decodeCursor(encodeCursor(notification, "newest"))).toEqual({
      sort: "newest",
      createdAt: new Date(notification.createdAt),
      id: notification.id,
    });
  });

  it("refuses a cursor another list of this API issued", () => {
    const review = encodeParts(
      "reviews-LISTING",
      "newest",
      notification.createdAt,
      notification.id,
    );

    expect(decodeCursor(review)).toBeNull();
  });

  it("refuses an ordering the feed does not offer", () => {
    const oldest = encodeParts(
      "notifications",
      "oldest",
      notification.createdAt,
      notification.id,
    );

    expect(decodeCursor(oldest)).toBeNull();
  });

  it("refuses a key no row could have been created at", () => {
    const garbled = encodeParts(
      "notifications",
      "newest",
      "yesterday",
      notification.id,
    );

    expect(decodeCursor(garbled)).toBeNull();
  });

  it("refuses an id that is not one", () => {
    const garbled = encodeParts(
      "notifications",
      "newest",
      notification.createdAt,
      "42",
    );

    expect(decodeCursor(garbled)).toBeNull();
  });

  it("refuses text that is not a cursor at all", () => {
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });
});
