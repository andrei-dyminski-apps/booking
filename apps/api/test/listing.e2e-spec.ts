import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import {
  RATE_UNDER_NON_REFUNDABLE_POLICY,
  Role,
  apiErrorSchema,
  bookingPageSchema,
  earliestToday,
  listingAvailabilitySchema,
  listingDetailSchema,
  listingListSchema,
  listingPageSchema,
  listingSchema,
  type CreateListingInput,
  type ListingPage,
  type ListingPricing,
} from "@repo/contracts";
import { cents } from "./../src/payment/domain/money";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { hostCredentials, signIn, signInAs, type Agent } from "./session";

const input: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNightCents: cents(12_000),
  capacity: 4,
};

describe("ListingController (e2e)", () => {
  let app: INestApplication<App>;
  let guest: Agent;
  let owner: Agent;
  let otherOwner: Agent;
  let admin: Agent;

  /** The id of a listing `owner` created before each test. */
  let listingId: string;

  /** A visitor with no session at all — what the catalogue is now open to. */
  const anyone = (): request.Agent => request(app.getHttpServer());

  const publish = async (
    over: Partial<CreateListingInput> = {},
    by: Agent = owner,
  ): Promise<string> => {
    const created = await by
      .post("/listings")
      .send({ ...input, ...over })
      .expect(201);

    return (created.body as { id: string }).id;
  };

  const catalogue = async (query = ""): Promise<ListingPage> => {
    const response = await anyone().get(`/listings${query}`).expect(200);

    return listingPageSchema.parse(response.body);
  };

  const titles = (page: ListingPage): string[] =>
    page.items.map((listing) => listing.title);

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    await resetDatabase(app);

    guest = await signInAs(app, Role.USER);
    owner = await signIn(app, hostCredentials);
    otherOwner = await signIn(app, {
      name: "E2E Second Owner",
      email: "e2e-owner-2@example.com",
      password: "password123",
    });
    admin = await signInAs(app, Role.ADMIN);

    const created = await owner.post("/listings").send(input).expect(201);
    listingId = (created.body as { id: string }).id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("answers with a body matching the contract schema and an owner taken from the session", async () => {
    const response = await owner.get(`/listings/${listingId}`).expect(200);
    const listing = listingSchema.parse(response.body);
    const session = await owner.get("/auth/me").expect(200);

    expect(listing.ownerId).toBe((session.body as { id: string }).id);
  });

  it("ignores an ownerId sent by the client — it is not in the schema, so it is stripped", async () => {
    const impostor = "8c9d0e1f-2a3b-4c5d-9e6f-7a8b9c0d1e2f";
    const response = await owner
      .post("/listings")
      .send({ ...input, ownerId: impostor })
      .expect(201);

    expect(listingSchema.parse(response.body).ownerId).not.toBe(impostor);
  });

  it("lets any user publish and refuses an admin — the role check, before any row", async () => {
    await guest.post("/listings").send(input).expect(201);
    await admin.post("/listings").send(input).expect(403);
  });

  it("opens the catalogue, a listing and its calendar to a visitor with no session", async () => {
    // The three reading routes are @Public(): a catalogue nobody may see before signing up
    // is not a catalogue, and the frontend caches those answers under their URL for every
    // visitor at once. Everything that writes stays behind the session.
    await expect(catalogue()).resolves.toMatchObject({ nextCursor: null });
    await anyone().get(`/listings/${listingId}`).expect(200);
    await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: inDays(1), to: inDays(30) })
      .expect(200);

    await anyone().post("/listings").send(input).expect(401);
    await anyone().get("/listings/mine").expect(401);
  });

  it("reads the same catalogue for every signed-in role", async () => {
    for (const agent of [guest, owner, otherOwner, admin]) {
      const response = await agent.get("/listings").expect(200);

      expect(listingPageSchema.parse(response.body).items).toHaveLength(1);
    }
  });

  it("filters by price and by the party that has to fit", async () => {
    await publish({
      title: "Attic room",
      pricePerNightCents: cents(3950),
      capacity: 1,
    });
    await publish({
      title: "Farmhouse",
      pricePerNightCents: cents(21_000),
      capacity: 12,
    });

    await expect(
      catalogue("?minPriceCents=4000").then(titles),
    ).resolves.toEqual(["Farmhouse", input.title]);
    await expect(
      catalogue("?minPriceCents=4000&maxPriceCents=20000").then(titles),
    ).resolves.toEqual([input.title]);
    await expect(catalogue("?guests=5").then(titles)).resolves.toEqual([
      "Farmhouse",
    ]);
  });

  it("narrows the catalogue to the listings of one owner", async () => {
    const otherId = await publish({ title: "Attic room" }, otherOwner);
    const { ownerId } = listingSchema.parse(
      (await anyone().get(`/listings/${otherId}`).expect(200)).body,
    );

    await expect(
      catalogue(`?ownerId=${ownerId}`).then(titles),
    ).resolves.toEqual(["Attic room"]);
    await anyone().get("/listings?ownerId=not-an-id").expect(400);
  });

  it("drops a listing whose nights are taken, and offers it again the moment they are not", async () => {
    await publish({ title: "Attic room" });
    const taken = { from: inDays(10), to: inDays(14) };
    const booking = await guest
      .post("/bookings")
      .send({ listingId, ...taken })
      .expect(201);

    await expect(
      catalogue(`?from=${taken.from}&to=${taken.to}`).then(titles),
    ).resolves.toEqual(["Attic room"]);

    // The day the stay ends is the day the next guest checks in: back-to-back is free.
    await expect(
      catalogue(`?from=${inDays(14)}&to=${inDays(16)}`).then(titles),
    ).resolves.toHaveLength(2);

    // A cancelled stay holds nothing — the same rule the EXCLUDE constraint filters on.
    await guest
      .delete(`/bookings/${(booking.body as { id: string }).id}`)
      .expect(204);
    await expect(
      catalogue(`?from=${taken.from}&to=${taken.to}`).then(titles),
    ).resolves.toHaveLength(2);
  });

  /**
   * The one case no request can provoke: a hold holds the slot until its deadline, and the
   * catalogue has to let go of it the moment it passes — before the job or the sweep that
   * marks the row `EXPIRED` has run. That is what `holdsTheSlot` being the complement of
   * `lapsedHolds` buys, and it is a condition in SQL, so it is tested against Postgres.
   */
  it("stops counting a hold the moment its deadline passes, job or no job", async () => {
    const stay = { from: inDays(10), to: inDays(14) };
    const created = await guest
      .post("/bookings")
      .send({ listingId, ...stay })
      .expect(201);

    await expect(
      catalogue(`?from=${stay.from}&to=${stay.to}`).then(titles),
    ).resolves.toEqual([]);

    await app.get(PrismaService).booking.update({
      where: { id: (created.body as { id: string }).id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      catalogue(`?from=${stay.from}&to=${stay.to}`).then(titles),
    ).resolves.toEqual([input.title]);

    const calendar = await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: inDays(1), to: inDays(30) })
      .expect(200);

    expect(listingAvailabilitySchema.parse(calendar.body).booked).toEqual([]);
  });

  it("walks the catalogue by cursor, newest first and each row exactly once", async () => {
    await publish({ title: "Second" });
    await publish({ title: "Third" });

    const first = await catalogue("?limit=2");

    expect(titles(first)).toEqual(["Third", "Second"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await catalogue(
      `?limit=2&cursor=${encodeURIComponent(String(first.nextCursor))}`,
    );

    expect(titles(second)).toEqual([input.title]);
    expect(second.nextCursor).toBeNull();
  });

  it("orders the catalogue the way it was asked to", async () => {
    await publish({ title: "Attic room", pricePerNightCents: cents(3950) });
    await publish({ title: "Farmhouse", pricePerNightCents: cents(21_000) });

    // Four orderings out of two keys, each read in both directions — and the default is
    // the one a catalogue with nothing asked of it shows.
    await expect(catalogue().then(titles)).resolves.toEqual([
      "Farmhouse",
      "Attic room",
      input.title,
    ]);
    await expect(catalogue("?sort=newest").then(titles)).resolves.toEqual([
      "Farmhouse",
      "Attic room",
      input.title,
    ]);
    await expect(catalogue("?sort=oldest").then(titles)).resolves.toEqual([
      input.title,
      "Attic room",
      "Farmhouse",
    ]);
    await expect(catalogue("?sort=priceAsc").then(titles)).resolves.toEqual([
      "Attic room",
      input.title,
      "Farmhouse",
    ]);
    await expect(catalogue("?sort=priceDesc").then(titles)).resolves.toEqual([
      "Farmhouse",
      input.title,
      "Attic room",
    ]);
  });

  /**
   * The cursor is a place in one ordering and in no other, which is what it carries the
   * `sort` for: handed back under a different one it would name a row the new list has
   * somewhere else entirely, and the page after it would belong to neither.
   */
  it("pages a sorted catalogue, and refuses its cursor under another ordering", async () => {
    await publish({ title: "Attic room", pricePerNightCents: cents(3950) });
    await publish({ title: "Farmhouse", pricePerNightCents: cents(21_000) });

    const first = await catalogue("?sort=priceAsc&limit=2");

    expect(titles(first)).toEqual(["Attic room", input.title]);
    expect(first.nextCursor).not.toBeNull();

    const cursor = encodeURIComponent(String(first.nextCursor));

    await expect(
      catalogue(`?sort=priceAsc&limit=2&cursor=${cursor}`).then(titles),
    ).resolves.toEqual(["Farmhouse"]);

    await anyone()
      .get(`/listings?sort=priceDesc&limit=2&cursor=${cursor}`)
      .expect(400);
    await anyone().get(`/listings?limit=2&cursor=${cursor}`).expect(400);
  });

  /**
   * A price-ordered page narrows by the same column `minPriceCents`/`maxPriceCents` narrow, so the
   * cursor and the filter meet on one field. They are `AND`-ed rather than merged, and
   * this is what would catch it if they stopped being: the second page would let a
   * listing above the ceiling back in.
   */
  it("keeps the price filter on every page of a price-ordered catalogue", async () => {
    await publish({ title: "Attic room", pricePerNightCents: cents(3950) });
    await publish({ title: "Farmhouse", pricePerNightCents: cents(21_000) });

    const filtered =
      "?sort=priceAsc&limit=1&minPriceCents=3900&maxPriceCents=12000";
    const first = await catalogue(filtered);

    expect(titles(first)).toEqual(["Attic room"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await catalogue(
      `${filtered}&cursor=${encodeURIComponent(String(first.nextCursor))}`,
    );

    expect(titles(second)).toEqual([input.title]);
    expect(second.nextCursor).toBeNull();
  });

  it("refuses a query it cannot answer as asked", async () => {
    // One date is half a question, a cursor this API never issued is a mistake, and a
    // limit above the ceiling is the one parameter that could ask for the whole table.
    await anyone()
      .get(`/listings?from=${inDays(1)}`)
      .expect(400);
    await anyone().get("/listings?cursor=not-a-cursor").expect(400);
    await anyone().get("/listings?sort=cheapest").expect(400);
    await anyone().get("/listings?limit=500").expect(400);
    await anyone().get("/listings?guests=none").expect(400);
    // A third decimal is finer than the column stores, so it is refused rather than
    // rounded into a filter nobody asked for.
    await anyone().get("/listings?minPriceCents=5000.5").expect(400);
  });

  /**
   * A form with an empty field serialises to `?guests=`, not to nothing at all, and every
   * coercion of this query would otherwise read that differently — `Number("")` is `0`, so
   * `minPriceCents` would quietly become a filter while the four beside it answered `400`. All
   * of them are the same question as no parameter at all.
   */
  it("reads a blank filter as one nobody filled in", async () => {
    const unfiltered = await catalogue();

    for (const query of [
      "?minPriceCents=",
      "?maxPriceCents=",
      "?guests=",
      "?limit=",
      "?cursor=",
      "?sort=",
      "?from=&to=",
      "?minPriceCents=&maxPriceCents=&guests=&limit=&cursor=&sort=&from=&to=",
    ]) {
      await expect(catalogue(query)).resolves.toEqual(unfiltered);
    }
  });

  /**
   * The window has the ceiling `limit` has on the catalogue, and for the same reason: this
   * read is public and answers with every stay it finds, so an unbounded one is a request
   * for the whole booking history of a listing.
   */
  it("refuses a calendar window wider than a year", async () => {
    await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: inDays(1), to: inDays(367) })
      .expect(200);
    await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: inDays(1), to: inDays(368) })
      .expect(400);
    await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: "0001-01-01", to: "9999-12-31" })
      .expect(400);
  });

  it("reports the nights a listing is taken for, whole and in order", async () => {
    const stay = { from: inDays(10), to: inDays(14) };

    await guest
      .post("/bookings")
      .send({ listingId, ...stay })
      .expect(201);

    // A window that only touches the stay still gets it whole: a calendar drawing its last
    // day has to know the nights continue past the edge.
    const response = await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: inDays(12), to: inDays(20) })
      .expect(200);

    expect(listingAvailabilitySchema.parse(response.body)).toEqual({
      listingId,
      from: inDays(12),
      to: inDays(20),
      booked: [stay],
    });

    // A window before the stay is empty, and a retired listing has no calendar at all.
    const empty = await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: inDays(1), to: inDays(9) })
      .expect(200);

    expect(listingAvailabilitySchema.parse(empty.body).booked).toEqual([]);

    await owner.delete(`/listings/${listingId}`).expect(204);
    await anyone()
      .get(`/listings/${listingId}/availability`)
      .query({ from: inDays(1), to: inDays(30) })
      .expect(404);
  });

  it("gives an owner only their own listings under /listings/mine", async () => {
    await otherOwner
      .post("/listings")
      .send({ ...input, title: "Cottage at the edge of the pines" })
      .expect(201);

    const mine = await owner.get("/listings/mine").expect(200);

    expect(listingListSchema.parse(mine.body)).toHaveLength(1);
    await expect(catalogue()).resolves.toMatchObject({
      items: [{ title: "Cottage at the edge of the pines" }, { id: listingId }],
    });
  });

  it("answers /listings/mine with nothing for a user who has published nothing", async () => {
    const mine = await guest.get("/listings/mine").expect(200);

    expect(listingListSchema.parse(mine.body)).toEqual([]);
    await admin.get("/listings/mine").expect(403);
  });

  it("lets the owner edit their listing", async () => {
    const response = await owner
      .patch(`/listings/${listingId}`)
      .send({ pricePerNightCents: 13_550 })
      .expect(200);

    expect(listingSchema.parse(response.body).pricePerNightCents).toBe(13_550);
  });

  it("stores a cancellation policy, FLEXIBLE unless one is named, and keeps it through an edit that does not name it", async () => {
    const read = async (id: string) =>
      listingDetailSchema.parse(
        (await anyone().get(`/listings/${id}`).expect(200)).body,
      ).cancellationPolicy;

    expect(await read(listingId)).toBe("FLEXIBLE");

    const firm = await publish({ cancellationPolicy: "FIRM" });

    expect(await read(firm)).toBe("FIRM");
    expect(
      (await catalogue()).items.find((listing) => listing.id === firm)
        ?.cancellationPolicy,
    ).toBe("FIRM");

    await owner
      .patch(`/listings/${firm}`)
      .send({ pricePerNightCents: 13_550 })
      .expect(200);
    expect(await read(firm)).toBe("FIRM");

    const changed = await owner
      .patch(`/listings/${firm}`)
      .send({ cancellationPolicy: "MODERATE" })
      .expect(200);
    expect(listingSchema.parse(changed.body).cancellationPolicy).toBe(
      "MODERATE",
    );

    await owner
      .patch(`/listings/${firm}`)
      .send({ cancellationPolicy: "GENEROUS" })
      .expect(400);
  });

  it("stores a time zone and a check-in time, UTC at 15:00 unless named, and keeps them through an edit that does not name them", async () => {
    const read = async (id: string) => {
      const { timeZone, checkInTime } = listingDetailSchema.parse(
        (await anyone().get(`/listings/${id}`).expect(200)).body,
      );

      return { timeZone, checkInTime };
    };

    expect(await read(listingId)).toEqual({
      timeZone: "UTC",
      checkInTime: "15:00",
    });

    const honolulu = await publish({
      timeZone: "Pacific/Honolulu",
      checkInTime: "16:30",
    });

    expect(await read(honolulu)).toEqual({
      timeZone: "Pacific/Honolulu",
      checkInTime: "16:30",
    });

    await owner
      .patch(`/listings/${honolulu}`)
      .send({ pricePerNightCents: 13_550 })
      .expect(200);
    expect(await read(honolulu)).toEqual({
      timeZone: "Pacific/Honolulu",
      checkInTime: "16:30",
    });

    await owner
      .patch(`/listings/${honolulu}`)
      .send({ timeZone: "Pacific/Kiritimati" })
      .expect(200);
    expect((await read(honolulu)).timeZone).toBe("Pacific/Kiritimati");

    // An offset does not follow summer time, and a name nobody knows converts nothing.
    for (const timeZone of ["+05:00", "Etc/GMT+5", "Mars/Olympus_Mons", ""]) {
      await owner.patch(`/listings/${honolulu}`).send({ timeZone }).expect(400);
    }

    // Stored as `Intl` spells it, whatever the case or the alias it was typed in.
    await owner
      .patch(`/listings/${honolulu}`)
      .send({ timeZone: "us/eastern" })
      .expect(200);
    expect((await read(honolulu)).timeZone).toBe("America/New_York");

    for (const checkInTime of ["24:00", "9:00", "15:00:00"]) {
      await owner
        .patch(`/listings/${honolulu}`)
        .send({ checkInTime })
        .expect(400);
    }
  });

  it("refuses a check-in time out of HH:mm on the column too, whoever writes it", async () => {
    await expect(
      app.get(PrismaService).listing.update({
        where: { id: listingId },
        data: { checkInTime: "25:00" },
      }),
    ).rejects.toThrow("listings_check_in_time_format");
  });

  it("stores a non-refundable discount within its bounds, none unless one is named, and withdraws it on null", async () => {
    const read = async (id: string) =>
      listingDetailSchema.parse(
        (await anyone().get(`/listings/${id}`).expect(200)).body,
      ).nonRefundableDiscountBps;

    expect(await read(listingId)).toBeNull();

    const discounted = await publish({ nonRefundableDiscountBps: 1_500 });

    expect(await read(discounted)).toBe(1_500);

    await owner
      .patch(`/listings/${discounted}`)
      .send({ capacity: 3 })
      .expect(200);
    expect(await read(discounted)).toBe(1_500);

    for (const nonRefundableDiscountBps of [50, 5_001, 12.5]) {
      await owner
        .patch(`/listings/${discounted}`)
        .send({ nonRefundableDiscountBps })
        .expect(400);
    }

    await owner
      .patch(`/listings/${discounted}`)
      .send({ nonRefundableDiscountBps: null })
      .expect(200);
    expect(await read(discounted)).toBeNull();
  });

  it("offers no non-refundable rate under the non-refundable policy, whichever half a save names", async () => {
    // The contract's refusal is an issue under the discount; the API's own, the message.
    const refused = async (
      response: Promise<{ body: unknown }>,
    ): Promise<void> => {
      const { message, errors } = apiErrorSchema.parse((await response).body);

      expect(errors ?? [{ path: [], message }]).toContainEqual(
        expect.objectContaining({ message: RATE_UNDER_NON_REFUNDABLE_POLICY }),
      );
    };
    const read = async (id: string) =>
      listingSchema.parse(
        (await anyone().get(`/listings/${id}`).expect(200)).body,
      );

    // Both in one body: the contract's refusal, before anything is written.
    await refused(
      owner
        .post("/listings")
        .send({
          ...input,
          cancellationPolicy: "NON_REFUNDABLE",
          nonRefundableDiscountBps: 1_000,
        })
        .expect(400),
    );

    // One half against the other on the row: the CHECK's, answered in the same words.
    const discounted = await publish({ nonRefundableDiscountBps: 1_000 });

    await refused(
      owner
        .patch(`/listings/${discounted}`)
        .send({ cancellationPolicy: "NON_REFUNDABLE" })
        .expect(400),
    );
    expect(await read(discounted)).toMatchObject({
      cancellationPolicy: "FLEXIBLE",
      nonRefundableDiscountBps: 1_000,
    });

    const strict = await publish({ cancellationPolicy: "NON_REFUNDABLE" });

    await refused(
      owner
        .patch(`/listings/${strict}`)
        .send({ nonRefundableDiscountBps: 1_000 })
        .expect(400),
    );

    // Withdrawing the rate in the same save is what lets the policy through.
    await owner
      .patch(`/listings/${discounted}`)
      .send({
        cancellationPolicy: "NON_REFUNDABLE",
        nonRefundableDiscountBps: null,
      })
      .expect(200);
    expect(await read(discounted)).toMatchObject({
      cancellationPolicy: "NON_REFUNDABLE",
      nonRefundableDiscountBps: null,
    });
  });

  it("refuses the edit to another owner — the role passes, the ownership does not", async () => {
    await otherOwner
      .patch(`/listings/${listingId}`)
      .send({ pricePerNightCents: 100 })
      .expect(403);
  });

  it("lets an admin edit and delete a listing they do not own", async () => {
    await admin
      .patch(`/listings/${listingId}`)
      .send({ capacity: 8 })
      .expect(200);
    await admin.delete(`/listings/${listingId}`).expect(204);
    await owner.get(`/listings/${listingId}`).expect(404);
  });

  it("retires a booked listing rather than refusing to let go of it", async () => {
    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(10), to: inDays(14) })
      .expect(201);

    await owner.delete(`/listings/${listingId}`).expect(204);

    // Gone everywhere it was on offer...
    await owner.get(`/listings/${listingId}`).expect(404);
    const mine = await owner.get("/listings/mine").expect(200);
    expect(listingListSchema.parse(mine.body)).toHaveLength(0);

    // ...and the stay taken against it still has its record, still readable by the owner
    // of the listing it names. That is the whole reason the row outlives the offer.
    const stays = await owner.get("/bookings?side=HOST").expect(200);
    expect(bookingPageSchema.parse(stays.body).items).toHaveLength(1);
  });

  it("takes no new booking against a retired listing", async () => {
    await owner.delete(`/listings/${listingId}`).expect(204);

    // The row is still there, so the foreign key is satisfied and would let this insert
    // through — the pre-flight check in BookingService is what answers instead.
    await guest
      .post("/bookings")
      .send({ listingId, from: inDays(10), to: inDays(14) })
      .expect(404);
  });

  it("refuses to edit a listing that has been retired", async () => {
    await owner.delete(`/listings/${listingId}`).expect(204);

    await owner
      .patch(`/listings/${listingId}`)
      .send({ pricePerNightCents: 13_550 })
      .expect(404);
    await owner.delete(`/listings/${listingId}`).expect(404);
  });

  it("stores the exceptions to a price, answers them on the listing alone, and replaces them whole", async () => {
    const pricing: ListingPricing = {
      weekdays: { fri: cents(15_000), sat: cents(16_050) },
      dates: [
        { date: inDays(20), priceCents: cents(40_000) },
        { date: inDays(10), priceCents: cents(9999) },
      ],
    };
    const id = await publish({ pricing });

    const detail = listingDetailSchema.parse(
      (await anyone().get(`/listings/${id}`).expect(200)).body,
    );

    // The dates come back in the order of the calendar, not in the order they were sent.
    expect(detail.pricing).toEqual({
      weekdays: pricing.weekdays,
      dates: [
        { date: inDays(10), priceCents: 9999 },
        { date: inDays(20), priceCents: 40_000 },
      ],
    });

    // A page of the catalogue carries the default alone.
    const page = await anyone().get("/listings").expect(200);
    expect(
      (page.body as { items: Record<string, unknown>[] }).items.every(
        (item) => !("pricing" in item),
      ),
    ).toBe(true);

    // An edit that does not name the prices leaves them as they were...
    await owner.patch(`/listings/${id}`).send({ capacity: 6 }).expect(200);
    expect(
      listingDetailSchema.parse(
        (await anyone().get(`/listings/${id}`).expect(200)).body,
      ).pricing,
    ).toEqual(detail.pricing);

    // ...and one that does is the whole set: what it leaves out is gone.
    const fridaysOnly: ListingPricing = {
      weekdays: { fri: cents(14_000) },
      dates: [],
    };

    await owner
      .patch(`/listings/${id}`)
      .send({ pricing: fridaysOnly })
      .expect(200);
    expect(
      listingDetailSchema.parse(
        (await anyone().get(`/listings/${id}`).expect(200)).body,
      ).pricing,
    ).toEqual(fridaysOnly);
  });

  it("answers only the date prices still ahead, and drops the past ones on the next save", async () => {
    // A date that has passed cannot be written over HTTP, so the row is put there the way
    // time would have put it — by the calendar moving on after it was saved.
    const prismaService = app.get(PrismaService);

    await prismaService.listingDatePrice.createMany({
      data: [
        { listingId, date: new Date(inDays(-3)), priceCents: 30_000 },
        { listingId, date: new Date(inDays(3)), priceCents: 20_000 },
      ],
    });

    const read = async (): Promise<ListingPricing> =>
      listingDetailSchema.parse(
        (await anyone().get(`/listings/${listingId}`).expect(200)).body,
      ).pricing;

    expect((await read()).dates).toEqual([
      { date: inDays(3), priceCents: 20_000 },
    ]);

    await owner
      .patch(`/listings/${listingId}`)
      .send({ pricing: await read() })
      .expect(200);

    expect(
      await prismaService.listingDatePrice.count({ where: { listingId } }),
    ).toBe(1);
  });

  it("keeps the price of a night still sold west of Greenwich, though UTC is on the next day", async () => {
    // The earliest today of any zone: tonight in Honolulu after midnight UTC, which a
    // listing there still sells and `create` prices by this row.
    const tonight = earliestToday();
    const pricing = {
      weekdays: {},
      dates: [{ date: tonight, priceCents: cents(25_000) }],
    };

    await owner.patch(`/listings/${listingId}`).send({ pricing }).expect(200);

    expect(
      listingDetailSchema.parse(
        (await anyone().get(`/listings/${listingId}`).expect(200)).body,
      ).pricing.dates,
    ).toEqual(pricing.dates);
  });

  it("queues parallel saves of one listing's prices instead of colliding on the key", async () => {
    // The same days in every set, so two saves interleaved between clearing and inserting
    // would both insert `fri` and one of them would fail on the primary key.
    const sets: ListingPricing[] = Array.from({ length: 10 }, (_, n) => ({
      weekdays: { fri: cents(10_000 + n), sat: cents(20_000 + n) },
      dates: [{ date: inDays(7), priceCents: cents(30_000 + n) }],
    }));

    const responses = await Promise.all(
      sets.map((pricing) =>
        owner.patch(`/listings/${listingId}`).send({ pricing }),
      ),
    );

    expect(responses.map(({ status }) => status)).toEqual(sets.map(() => 200));

    // Whichever save went last, the stored set is one of them whole, never a mix.
    const stored = listingDetailSchema.parse(
      (await anyone().get(`/listings/${listingId}`).expect(200)).body,
    ).pricing;

    expect(sets).toContainEqual(stored);
  });

  it("refuses a date price in the past, twice for one date, or for a day of the week nobody has", async () => {
    const send = (pricing: unknown) =>
      owner.patch(`/listings/${listingId}`).send({ pricing });

    // Two days back: yesterday in UTC is still today west of Greenwich until noon UTC.
    await send({
      weekdays: {},
      dates: [{ date: inDays(-2), priceCents: 10_000 }],
    }).expect(400);
    await send({
      weekdays: {},
      dates: [
        { date: inDays(5), priceCents: 10_000 },
        { date: inDays(5), priceCents: 12_000 },
      ],
    }).expect(400);
    await send({ weekdays: { fri: 0 }, dates: [] }).expect(400);
    await send({ weekdays: { fri: 15_055.5 }, dates: [] }).expect(400);
    // Not a day of the week: refused rather than stripped, because a save that dropped the
    // key would replace the set with an empty one and still answer 200.
    await send({ weekdays: { Fri: 15_000 }, dates: [] }).expect(400);
  });

  it("rejects a body that does not pass the schema", async () => {
    await owner
      .post("/listings")
      .send({ ...input, capacity: 0 })
      .expect(400);
    // A price is exact to the cent — the scale the column stores — so a third decimal is
    // refused rather than rounded into a price nobody typed.
    await owner
      .post("/listings")
      .send({ ...input, pricePerNightCents: 12_050.5 })
      .expect(400);
    // A PATCH that changes nothing is a mistake on the caller's side, not a no-op.
    await owner.patch(`/listings/${listingId}`).send({}).expect(400);
  });

  it("stores a price at the ceiling of the contract and refuses one above it", async () => {
    // The two ends of that ceiling have to agree, and only a real column can say that they
    // do: the schema is what answers a request above it, while the CHECK on the column
    // says the same number to every write that never passes through the schema. The
    // highest price the schema accepts has to come back exact to the cent — the cent
    // being the first thing a float would have lost.
    const created = await owner
      .post("/listings")
      .send({ ...input, pricePerNightCents: 99_999_999 })
      .expect(201);

    expect(listingSchema.parse(created.body).pricePerNightCents).toBe(
      99_999_999,
    );

    await owner
      .post("/listings")
      .send({ ...input, pricePerNightCents: 100_000_000 })
      .expect(400);
  });
});
