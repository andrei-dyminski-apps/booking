import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import {
  BookingStatus,
  ReviewKind,
  Role,
  apiErrorSchema,
  bookingSchema,
  reviewPageSchema,
  reviewSchema,
  type CreateListingInput,
  type CreateReviewInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";
import { credentialsFor, signInAs, type Agent } from "./session";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 120,
  capacity: 4,
};

const review: CreateReviewInput = {
  rating: 5,
  comment: "Quiet, warm and exactly as described.",
};

describe("ReviewController (e2e)", () => {
  let app: INestApplication<App>;
  let guest: Agent;
  let otherGuest: Agent;
  let owner: Agent;
  let otherOwner: Agent;
  let admin: Agent;
  let listingId: string;
  let guestId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);
    await resetQueue(app);

    guest = await signInAs(app, Role.USER);
    otherGuest = await signInAs(app, Role.USER, {
      name: "E2E Second Guest",
      email: "e2e-guest-2@example.com",
      password: "password123",
    });
    owner = await signInAs(app, Role.OWNER);
    otherOwner = await signInAs(app, Role.OWNER, {
      name: "E2E Second Owner",
      email: "e2e-owner-2@example.com",
      password: "password123",
    });
    admin = await signInAs(app, Role.ADMIN);

    const listing = await owner
      .post("/listings")
      .send(listingInput)
      .expect(201);

    listingId = (listing.body as { id: string }).id;
    guestId = (
      await app
        .get(PrismaService)
        .user.findUniqueOrThrow({ where: { email: credentialsFor.USER.email } })
    ).id;
  });

  afterEach(async () => {
    await app.close();
  });

  /**
   * A stay written straight into the table: the API books nothing in the past and confirms
   * nothing until the payment step exists, and a finished, paid stay is what a review is
   * about. The dates are relative to the day the suite runs, like every fixture here.
   */
  const stay = async (
    overrides: { status?: BookingStatus; from?: number; to?: number } = {},
  ): Promise<string> => {
    const row = await app.get(PrismaService).booking.create({
      data: {
        listingId,
        guestId,
        from: new Date(inDays(overrides.from ?? -6)),
        to: new Date(inDays(overrides.to ?? -2)),
        status: overrides.status ?? BookingStatus.CONFIRMED,
        expiresAt:
          overrides.status === BookingStatus.PENDING_PAYMENT
            ? new Date(Date.now() + 60_000)
            : null,
      },
    });

    return row.id;
  };

  it("takes one review from each side of a finished stay", async () => {
    const bookingId = await stay();

    const byGuest = await guest
      .post(`/bookings/${bookingId}/reviews`)
      .send(review)
      .expect(201);
    const byOwner = await owner
      .post(`/bookings/${bookingId}/reviews`)
      .send({ rating: 3, comment: "Left the place tidy, arrived late." })
      .expect(201);

    expect(reviewSchema.parse(byGuest.body).kind).toBe(ReviewKind.LISTING);
    expect(reviewSchema.parse(byOwner.body).kind).toBe(ReviewKind.GUEST);

    const booking = await guest.get(`/bookings/${bookingId}`).expect(200);

    expect(bookingSchema.parse(booking.body).reviewed).toEqual({
      byGuest: true,
      byOwner: true,
    });
  });

  it("refuses a second review of the same half with a 409", async () => {
    const bookingId = await stay();

    await guest.post(`/bookings/${bookingId}/reviews`).send(review).expect(201);

    const again = await guest
      .post(`/bookings/${bookingId}/reviews`)
      .send(review)
      .expect(409);

    expect(apiErrorSchema.parse(again.body).statusCode).toBe(409);
  });

  it("refuses a stay that is not over or never happened", async () => {
    for (const bookingId of [
      await stay({ from: -1, to: 3 }),
      await stay({ status: BookingStatus.CANCELLED, from: -20, to: -18 }),
    ]) {
      await guest
        .post(`/bookings/${bookingId}/reviews`)
        .send(review)
        .expect(409);
    }
  });

  it("answers 404 to everybody who is not a side of the stay, and 403 to an admin", async () => {
    const bookingId = await stay();

    await otherGuest
      .post(`/bookings/${bookingId}/reviews`)
      .send(review)
      .expect(404);
    await otherOwner
      .post(`/bookings/${bookingId}/reviews`)
      .send(review)
      .expect(404);
    await admin.post(`/bookings/${bookingId}/reviews`).send(review).expect(403);
  });

  it("validates the body against the contract", async () => {
    const bookingId = await stay();

    await guest
      .post(`/bookings/${bookingId}/reviews`)
      .send({ rating: 6, comment: "short" })
      .expect(400);
  });

  it("shows the guests' reviews of a listing to anybody, with a summary", async () => {
    await guest
      .post(`/bookings/${await stay()}/reviews`)
      .send(review)
      .expect(201);
    await guest
      .post(`/bookings/${await stay({ from: -30, to: -27 })}/reviews`)
      .send({ ...review, rating: 4 })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/listings/${listingId}/reviews`)
      .expect(200);
    const page = reviewPageSchema.parse(response.body);

    expect(page.items.map((item) => item.rating)).toEqual([4, 5]);
    expect(page.summary).toEqual({ count: 2, average: 4.5 });
  });

  it("keeps a guest's reviews to the guest, an admin and the hosts they booked with", async () => {
    await owner
      .post(`/bookings/${await stay()}/reviews`)
      .send(review)
      .expect(201);

    for (const reader of [guest, owner, admin]) {
      const response = await reader
        .get(`/guests/${guestId}/reviews`)
        .expect(200);

      expect(reviewPageSchema.parse(response.body).summary.count).toBe(1);
    }

    await otherGuest.get(`/guests/${guestId}/reviews`).expect(404);
    await otherOwner.get(`/guests/${guestId}/reviews`).expect(404);
    await request(app.getHttpServer())
      .get(`/guests/${guestId}/reviews`)
      .expect(401);
  });

  it("closes a guest's reviews to a host whose only request was cancelled or expired", async () => {
    await stay({ status: BookingStatus.CANCELLED, from: 10, to: 12 });
    await stay({ status: BookingStatus.EXPIRED, from: 20, to: 22 });

    await owner.get(`/guests/${guestId}/reviews`).expect(404);

    await stay({ status: BookingStatus.PENDING_PAYMENT, from: 30, to: 32 });

    await owner.get(`/guests/${guestId}/reviews`).expect(200);
  });

  it("lets an admin remove a review, and nobody else", async () => {
    const created = await guest
      .post(`/bookings/${await stay()}/reviews`)
      .send(review)
      .expect(201);
    const { id } = reviewSchema.parse(created.body);

    await guest.delete(`/reviews/${id}`).expect(403);
    await owner.delete(`/reviews/${id}`).expect(403);
    await admin.delete(`/reviews/${id}`).expect(204);
    await admin.delete(`/reviews/${id}`).expect(404);
  });

  it("answers 404 for the reviews of a retired listing", async () => {
    await owner.delete(`/listings/${listingId}`).expect(204);

    await request(app.getHttpServer())
      .get(`/listings/${listingId}/reviews`)
      .expect(404);
  });
});
