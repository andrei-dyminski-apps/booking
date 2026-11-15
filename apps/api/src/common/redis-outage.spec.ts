import { EventEmitter } from "node:events";
import { RedisOutage, isConnectionError } from "./redis-outage";

function refused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
    code: "ECONNREFUSED",
  });
}

describe("RedisOutage", () => {
  const logged: { level: "warn" | "log" | "error"; message: string }[] = [];
  const logger = {
    warn: (message: string) => {
      logged.push({ level: "warn", message });
    },
    log: (message: string) => {
      logged.push({ level: "log", message });
    },
    error: (message: string) => {
      logged.push({ level: "error", message });
    },
  };

  let connection: EventEmitter;
  let redisOutage: RedisOutage;

  beforeEach(() => {
    logged.length = 0;
    connection = new EventEmitter();
    redisOutage = new RedisOutage(logger, "The test queue");
  });

  it("warns once however many retries fail, and says when the connection is back", () => {
    redisOutage.report(refused(), connection);
    redisOutage.report(refused(), connection);
    redisOutage.report(new Error("Connection is closed."), connection);
    connection.emit("ready");

    expect(logged).toEqual([
      {
        level: "warn",
        message:
          "The test queue lost Redis, retrying until it is back: Error: connect ECONNREFUSED 127.0.0.1:6379",
      },
      { level: "log", message: "The test queue reached Redis again" },
    ]);
  });

  it("warns again for the next outage", () => {
    redisOutage.report(refused(), connection);
    connection.emit("ready");
    connection.emit("ready");
    redisOutage.report(refused(), connection);

    expect(logged.map(({ level }) => level)).toEqual(["warn", "log", "warn"]);
  });

  it("logs an error that is not about the connection every time, while it is up", () => {
    redisOutage.report(new Error("ERR unknown command"), connection);
    redisOutage.report(new Error("ERR unknown command"), connection);

    expect(logged).toEqual([
      { level: "error", message: "The test queue: Error: ERR unknown command" },
      { level: "error", message: "The test queue: Error: ERR unknown command" },
    ]);
  });

  it("keeps quiet about any error while the connection is down", () => {
    redisOutage.report(refused(), connection);
    redisOutage.report(new Error("ERR unknown command"), connection);

    expect(logged.map(({ level }) => level)).toEqual(["warn"]);
  });
});

describe("isConnectionError", () => {
  it("knows a socket that cannot reach Redis and a closed connection", () => {
    expect(isConnectionError(refused())).toBe(true);
    expect(isConnectionError(new Error("Connection is closed."))).toBe(true);
  });

  it("does not take a command's own error or a non-error for one", () => {
    expect(isConnectionError(new Error("ERR unknown command"))).toBe(false);
    expect(isConnectionError("ECONNREFUSED")).toBe(false);
  });
});
