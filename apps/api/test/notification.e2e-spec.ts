import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import {
  NotificationType,
  Role,
  StayParty,
  notificationPageSchema,
  unreadCountSchema,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { EventStream } from "./event-stream";
import { resetQueue } from "./queue";
import { credentialsFor, signInAs, type Agent } from "./session";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 120,
  capacity: 4,
};

describe("Notifications (e2e)", () => {
  let app: INestApplication<App>;
  let guest: Agent;
  let owner: Agent;
  let admin: Agent;
  let listingId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);
    await resetQueue(app);

    guest = await signInAs(app, Role.USER);
    owner = await signInAs(app, Role.OWNER);
    admin = await signInAs(app, Role.ADMIN);

    const listing = await owner
      .post("/listings")
      .send(listingInput)
      .expect(201);

    listingId = (listing.body as { id: string }).id;
  });

  afterEach(async () => {
    await app.close();
  });

  const book = async (): Promise<string> => {
    const response = await guest
      .post("/bookings")
      .send({ listingId, from: inDays(10), to: inDays(12) })
      .expect(201);

    return (response.body as { id: string }).id;
  };

  const feedOf = async (agent: Agent) =>
    notificationPageSchema.parse(
      (await agent.get("/notifications").expect(200)).body,
    );

  const unreadOf = async (agent: Agent): Promise<number> =>
    unreadCountSchema.parse(
      (await agent.get("/notifications/unread-count").expect(200)).body,
    ).unread;

  it("tells the host about a new hold, in their feed and in their count", async () => {
    const bookingId = await book();

    const feed = await feedOf(owner);

    expect(feed.items).toEqual([
      expect.objectContaining({
        type: NotificationType.BOOKING_REQUESTED,
        readAt: null,
        data: {
          bookingId,
          listingId,
          listingTitle: listingInput.title,
          from: inDays(10),
          to: inDays(12),
        },
      }),
    ]);
    await expect(unreadOf(owner)).resolves.toBe(1);
    await expect(feedOf(guest)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("tells both sides when an admin cancels, each as the side they are", async () => {
    const bookingId = await book();

    await admin.delete(`/bookings/${bookingId}`).expect(204);

    const [toGuest] = (await feedOf(guest)).items;
    const [toHost] = (await feedOf(owner)).items;

    expect(toGuest).toMatchObject({
      type: NotificationType.BOOKING_CANCELLED,
      data: { recipient: StayParty.GUEST },
    });
    expect(toHost).toMatchObject({
      type: NotificationType.BOOKING_CANCELLED,
      data: { recipient: StayParty.HOST },
    });
    await expect(feedOf(admin)).resolves.toMatchObject({ items: [] });
  });

  it("marks one read, refuses somebody else's, and marks all read", async () => {
    await book();
    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(20), to: inDays(22) })
      .expect(201);

    const [newest] = (await feedOf(owner)).items;
    const id = String(newest?.id);

    await guest.post(`/notifications/${id}/read`).expect(404);

    const afterOne = await owner.post(`/notifications/${id}/read`).expect(200);

    const one = unreadCountSchema.parse(afterOne.body);

    expect(one.unread).toBe(1);

    const afterAll = await owner.post("/notifications/read").expect(200);
    const all = unreadCountSchema.parse(afterAll.body);

    // Each count is later than the one before it, which is what a client orders them by.
    expect(all.unread).toBe(0);
    expect(all.revision).toBeGreaterThan(one.revision);
    expect(
      (await feedOf(owner)).items.every((item) => item.readAt !== null),
    ).toBe(true);
  });

  it("refuses the stream without a session", async () => {
    await request(app.getHttpServer()).get("/events").expect(401);
  });

  it("opens the stream with the count, then pushes what happens while it is open", async () => {
    await book();

    const stream = await EventStream.openAs(app, credentialsFor.OWNER);

    try {
      await expect(stream.next()).resolves.toMatchObject({
        type: "sync",
        unreadNotifications: 1,
      });

      await guest
        .post("/bookings")
        .send({ listingId, from: inDays(30), to: inDays(32) })
        .expect(201);

      await expect(stream.next()).resolves.toMatchObject({
        type: "notification.created",
        notification: { type: NotificationType.BOOKING_REQUESTED },
        unreadNotifications: 2,
      });

      await owner.post("/notifications/read").expect(200);

      await expect(stream.next()).resolves.toMatchObject({
        type: "notifications.read",
        unreadNotifications: 0,
      });
    } finally {
      stream.close();
    }
  });
});
