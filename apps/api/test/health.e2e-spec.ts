import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { REQUEST_ID_HEADER } from "@repo/contracts";
import { useRequestLog } from "./../src/common/logging";
import { waitUntil } from "./wait-until";

/** Against the docker-compose Postgres and Redis, the two the probe has to reach. */
describe("Health (e2e)", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    useRequestLog(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers ok without a session, uncached, once both stores answer", async () => {
    // Not at once: the Redis connection is still being opened when `init` resolves, and a
    // probe answered before it is ready is right to say so.
    const probe = () => request(app.getHttpServer()).get("/health");

    await waitUntil(async () => (await probe()).status === 200);

    const response = await probe().expect(200);

    expect(response.body).toEqual({
      status: "ok",
      info: { database: { status: "up" }, redis: { status: "up" } },
      error: {},
      details: { database: { status: "up" }, redis: { status: "up" } },
    });
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("names every answer with the id of its request", async () => {
    const response = await request(app.getHttpServer())
      .get("/")
      .set(REQUEST_ID_HEADER, "trace-1")
      .expect(200);

    expect(response.headers[REQUEST_ID_HEADER]).toBe("trace-1");
  });
});
