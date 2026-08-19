import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types";
import {
  apiErrorSchema,
  bookingSchema,
  type CreateBookingInput,
} from "@repo/contracts";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";

const input: CreateBookingInput = {
  roomId: "101",
  guestName: "Anna",
  from: "2026-09-01",
  to: "2026-09-05",
};

describe("BookingController (e2e)", () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Tests hit the real database from docker-compose — wipe it before each one.
    await app.get(PrismaService).booking.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a booking and answers with a body matching the contract schema", async () => {
    const response = await request(app.getHttpServer())
      .post("/bookings")
      .send(input)
      .expect(201);

    expect(() => bookingSchema.parse(response.body)).not.toThrow();
  });

  it("rejects a body that does not pass the schema", async () => {
    const response = await request(app.getHttpServer())
      .post("/bookings")
      .send({ ...input, guestName: "A" })
      .expect(400);

    // The error body is part of the contract too: the frontend puts these issues
    // under the matching inputs, so their shape has to be checked, not just the status.
    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toEqual([
      expect.objectContaining({ path: ["guestName"] }),
    ]);
  });

  it("rejects check-out before check-in — the rule lives in the schema", async () => {
    await request(app.getHttpServer())
      .post("/bookings")
      .send({ ...input, from: "2026-09-05", to: "2026-09-01" })
      .expect(400);
  });

  it("answers 409 when the dates overlap an existing booking", async () => {
    await request(app.getHttpServer())
      .post("/bookings")
      .send(input)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post("/bookings")
      .send({ ...input, from: "2026-09-04", to: "2026-09-08" })
      .expect(409);

    // A Nest exception carries a message and no per-field issues — the same contract.
    const error = apiErrorSchema.parse(response.body);

    expect(error.errors).toBeUndefined();
    expect(error.message).toContain(input.roomId);
  });

  it("returns the list and deletes a booking", async () => {
    const created = await request(app.getHttpServer())
      .post("/bookings")
      .send(input);
    const id = (created.body as { id: string }).id;

    await request(app.getHttpServer()).get("/bookings").expect(200);
    await request(app.getHttpServer()).delete(`/bookings/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/bookings/${id}`).expect(404);
  });
});
