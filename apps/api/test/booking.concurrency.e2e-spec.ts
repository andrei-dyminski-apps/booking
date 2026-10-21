import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { App } from "supertest/types";
import {
  Role,
  type CreateBookingInput,
  type CreateListingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { resetDatabase } from "./database";
import { inDays } from "./dates";
import { resetQueue } from "./queue";
import { hostCredentials, signIn, signInAs, type Agent } from "./session";

const listingInput: CreateListingInput = {
  title: "Loft above the harbour",
  description: "Two rooms under the roof and a wall of glass facing the water.",
  pricePerNight: 120,
  capacity: 4,
};

/**
 * The centrepiece of phase 4. Ten requests for the same listing and the same dates fire at
 * once; the locking transaction in `BookingRepository.create` serialises them and the
 * `EXCLUDE` constraint stands behind it — so exactly one becomes a hold and the other nine
 * get an honest `409`, with one row in the database.
 */
describe("Concurrent booking (e2e)", () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let guest: Agent;
  let owner: Agent;
  let input: CreateBookingInput;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prismaService = app.get(PrismaService);

    await resetDatabase(app);
    await resetQueue(app);

    guest = await signInAs(app, Role.USER);
    owner = await signIn(app, hostCredentials);

    const listing = await owner
      .post("/listings")
      .send(listingInput)
      .expect(201);

    input = {
      listingId: (listing.body as { id: string }).id,
      from: inDays(10),
      to: inDays(14),
    };
  });

  afterEach(async () => {
    await app.close();
  });

  it("lets exactly one of ten parallel identical requests through", async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => guest.post("/bookings").send(input)),
    );

    const statuses = responses.map((response) => response.status).sort();

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(9);

    const stored = await prismaService.booking.findMany({
      where: { listingId: input.listingId },
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("PENDING_PAYMENT");
  });

  it("frees the slot again once the winning hold is cancelled", async () => {
    const first = await guest.post("/bookings").send(input).expect(201);

    await guest
      .delete(`/bookings/${(first.body as { id: string }).id}`)
      .expect(204);

    // A cancelled booking keeps its row but leaves the active set, so the EXCLUDE
    // constraint no longer covers it and the same dates book again.
    await guest.post("/bookings").send(input).expect(201);
  });
});
