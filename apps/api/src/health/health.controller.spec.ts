import { ServiceUnavailableException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TerminusModule } from "@nestjs/terminus";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { DatabaseHealthIndicator } from "./database.health";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator } from "./redis.health";

type Answer = "answers" | "refuses" | "hangs";

const prismaThat = (answer: Answer) => ({
  $queryRaw: () => {
    switch (answer) {
      case "answers":
        return Promise.resolve([{ "?column?": 1 }]);
      case "refuses":
        return Promise.reject(new Error("connect ECONNREFUSED 10.0.0.7:5432"));
      case "hangs":
        return new Promise<never>(() => undefined);
    }
  },
});

const realtimeAnswering = (answers: boolean) => ({
  ping: () =>
    answers
      ? Promise.resolve()
      : Promise.reject(new Error("connect ECONNREFUSED 10.0.0.8:6379")),
});

const controllerWith = async (database: Answer, redis: boolean) => {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule.forRoot({ logger: false })],
    controllers: [HealthController],
    providers: [
      DatabaseHealthIndicator,
      RedisHealthIndicator,
      { provide: PrismaService, useValue: prismaThat(database) },
      { provide: RealtimeService, useValue: realtimeAnswering(redis) },
    ],
  }).compile();

  return moduleRef.get(HealthController);
};

describe("HealthController", () => {
  it("answers ok while Postgres and Redis both answer", async () => {
    const healthController = await controllerWith("answers", true);

    await expect(healthController.check()).resolves.toMatchObject({
      status: "ok",
      details: { database: { status: "up" }, redis: { status: "up" } },
    });
  });

  it("answers 503 naming what is down, without the address it failed to reach", async () => {
    const healthController = await controllerWith("answers", false);
    const failure: unknown = await healthController
      .check()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);

    const body = (failure as ServiceUnavailableException).getResponse();

    expect(body).toMatchObject({
      status: "error",
      details: { database: { status: "up" }, redis: { status: "down" } },
    });
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("counts a database that does not answer as down", async () => {
    const healthController = await controllerWith("refuses", true);
    const failure: unknown = await healthController
      .check()
      .catch((error: unknown) => error);
    const body = (failure as ServiceUnavailableException).getResponse();

    expect(body).toMatchObject({ details: { database: { status: "down" } } });
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("counts a database that answers nothing within a second as down", async () => {
    const healthController = await controllerWith("hangs", true);

    jest.useFakeTimers();

    try {
      const failure = healthController.check().catch((error: unknown) => error);

      await jest.advanceTimersByTimeAsync(1_000);

      const body = (
        (await failure) as ServiceUnavailableException
      ).getResponse();

      expect(body).toMatchObject({ details: { database: { status: "down" } } });
    } finally {
      jest.useRealTimers();
    }
  });
});
