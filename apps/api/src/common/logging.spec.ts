import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { Controller, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { PinoLogger } from "nestjs-pino";
import pino, { type Logger } from "pino";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { useBodyParsers } from "./body-parsers";
import {
  LOG_FORMAT,
  REQUEST_ID_HEADER,
  nestLogger,
  requestLogOptions,
  theLogger,
  useRequestLog,
} from "./logging";

const SESSION = "access_token=secret-session-value";

/** A logger in the application's format, writing its lines where the spec can read them. */
function capturingLogger(): {
  logger: Logger;
  lines: Record<string, unknown>[];
} {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });

  return { logger: pino({ ...LOG_FORMAT, level: "info" }, destination), lines };
}

/** The line is written once the response has finished, a moment after the answer arrives. */
async function lastLineOf(
  lines: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50 && lines.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const line = lines.at(-1);

  if (line === undefined) throw new Error("nothing was logged");

  return line;
}

/**
 * The request log as pino-http writes it, from a real request to a plain HTTP server: what
 * reaches the log is decided by the serializers, so the assertions read the lines written,
 * not the options handed over.
 */
describe("the request log", () => {
  let server: Server;
  let origin: string;
  const { logger, lines } = capturingLogger();
  const lastLine = () => lastLineOf(lines);

  beforeAll(async () => {
    const log = pinoHttp({ ...requestLogOptions(), logger });

    server = createServer((request, response) => {
      log(request, response);

      // Answered never: the client gives up first.
      if (request.url === "/hanging") return;

      if (request.url === "/signed-in") {
        Object.assign(request, { user: { id: "user-1" } });
      }

      response.statusCode = request.url === "/broken" ? 500 : 200;
      response.setHeader("set-cookie", SESSION);
      response.end("ok");
    });
    server.listen(0);
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    lines.length = 0;
  });

  it("keeps the method, the path and the status, and no header or query at all", async () => {
    await fetch(`${origin}/users?email=someone@example.com`, {
      headers: { cookie: SESSION, authorization: "Bearer token" },
    });

    const line = await lastLine();

    expect(line.msg).toBe("GET /users 200");
    expect(line.req).toEqual({
      id: expect.any(String) as unknown,
      method: "GET",
      url: "/users",
    });
    expect(line.res).toEqual({ statusCode: 200 });
    expect(JSON.stringify(line)).not.toContain("secret-session-value");
    expect(JSON.stringify(line)).not.toContain("Bearer");
    expect(JSON.stringify(line)).not.toContain("someone@example.com");
  });

  it("names the level and states the time as a log viewer reads them", async () => {
    await fetch(`${origin}/`);

    const line = await lastLine();

    expect(line.level).toBe("info");
    expect(new Date(line.time as string).toISOString()).toBe(line.time);
  });

  it("names the request in the answer, and adopts an id the caller sent", async () => {
    const fresh = await fetch(`${origin}/`);
    const freshId = fresh.headers.get(REQUEST_ID_HEADER);

    expect(freshId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await lastLine()).req).toMatchObject({ id: freshId });

    lines.length = 0;

    const adopted = await fetch(`${origin}/`, {
      headers: { [REQUEST_ID_HEADER]: "edge-42" },
    });

    expect(adopted.headers.get(REQUEST_ID_HEADER)).toBe("edge-42");
    expect((await lastLine()).req).toMatchObject({ id: "edge-42" });
  });

  it("replaces an incoming id it would not write into the log", async () => {
    const response = await fetch(`${origin}/`, {
      headers: { [REQUEST_ID_HEADER]: "x".repeat(129) },
    });

    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("names the account once the guard has put it on the request", async () => {
    await fetch(`${origin}/signed-in`);

    expect((await lastLine()).userId).toBe("user-1");
  });

  it("logs a request the client left before its answer as a 499", async () => {
    const leaving = new AbortController();
    const request = fetch(`${origin}/hanging`, { signal: leaving.signal });

    setTimeout(() => {
      leaving.abort();
    }, 50);
    await expect(request).rejects.toThrow();

    const line = await lastLine();

    expect(line.msg).toBe("GET /hanging 499");
    expect(line.level).toBe("info");
    expect(line.res).toEqual({ statusCode: 499, aborted: true });
  });

  it("logs a 5xx as an error and leaves the health probe out", async () => {
    await fetch(`${origin}/broken`);

    const broken = await lastLine();

    expect(broken.level).toBe("error");
    expect(broken.msg).toBe("GET /broken 500");
    // Nest logs the exception itself; pino-http's made-up one would only be noise.
    expect(broken).not.toHaveProperty("err");

    lines.length = 0;
    await fetch(`${origin}/health`);
    await fetch(`${origin}/health?probe=1`);
    await fetch(`${origin}/after-health`);

    expect((await lastLine()).msg).toBe("GET /after-health 200");
    expect(lines).toHaveLength(1);
  });
});

@Controller()
class EchoController {
  @Post("echo")
  echo(): string {
    return "ok";
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

/**
 * Mounted the way `main.ts` mounts it, ahead of the body parsers: a request they refuse
 * never reaches a route or a Nest middleware, and still has to be logged and named.
 */
describe("the request log ahead of the body parsers", () => {
  let app: NestExpressApplication;
  const { logger, lines } = capturingLogger();

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(EchoModule, {
      bodyParser: false,
      logger: false,
    });
    useRequestLog(app, logger);
    useBodyParsers(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    lines.length = 0;
  });

  it.each([
    ["a malformed body", "{not json", 400],
    ["an oversized body", JSON.stringify({ text: "x".repeat(200_000) }), 413],
  ])("logs and names %s it refused", async (_case, body, status) => {
    const response = await request(app.getHttpServer())
      .post("/echo")
      .set("content-type", "application/json")
      .send(body)
      .expect(status);

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await lastLineOf(lines)).msg).toBe(`POST /echo ${String(status)}`);
  });
});

describe("nestLogger", () => {
  const environment = process.env.NODE_ENV;
  let info: jest.SpyInstance;

  // The process's logger is built once and kept; built here, under Jest's own NODE_ENV, it
  // is the silent one, rather than a production logger writing to stdout for the rest of
  // the file. The listing filter reads NODE_ENV per call, so the tests below still apply.
  beforeAll(() => {
    theLogger();
  });

  beforeEach(() => {
    info = jest.spyOn(PinoLogger.prototype, "info").mockImplementation(() => {
      // Written nowhere: the spec reads the calls.
    });
  });

  afterEach(() => {
    info.mockRestore();
    process.env.NODE_ENV = environment;
  });

  it("leaves Nest's module and route listing out of the production log", () => {
    process.env.NODE_ENV = "production";
    const logger = nestLogger();

    logger.log("Mapped {/health, GET} route", "RouterExplorer");
    logger.log("AppModule dependencies initialized", "InstanceLoader");
    logger.log("HealthController {/health}:", "RoutesResolver");
    logger.log("Nest application successfully started", "NestApplication");

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      { context: "NestApplication" },
      "Nest application successfully started",
    );
  });

  it("keeps the listing outside production, where the routes change", () => {
    process.env.NODE_ENV = "development";

    nestLogger().log("Mapped {/health, GET} route", "RouterExplorer");

    expect(info).toHaveBeenCalledTimes(1);
  });
});
