import { assertConnectionUrlsMatchCompose } from "./env-consistency";

describe("assertConnectionUrlsMatchCompose", () => {
  const savedEnv = process.env;

  beforeEach(() => {
    // A copy rather than the object itself: the function reads process.env directly, and a
    // test that mutated the real one would leak into the next file of the same worker.
    process.env = { ...savedEnv };
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    for (const name of [
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "POSTGRES_DB",
      "POSTGRES_PORT",
      "REDIS_PORT",
    ]) {
      delete process.env[name];
    }
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  const composeEnv = (): void => {
    process.env.POSTGRES_USER = "booking";
    process.env.POSTGRES_PASSWORD = "booking";
    process.env.POSTGRES_DB = "booking";
    process.env.POSTGRES_PORT = "5432";
    process.env.REDIS_PORT = "6379";
  };

  it("passes when the URLs repeat the compose variables", () => {
    composeEnv();
    process.env.DATABASE_URL =
      "postgresql://booking:booking@localhost:5432/booking";
    process.env.REDIS_URL = "redis://localhost:6379";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).not.toThrow();
  });

  it("reports a port changed on one side only", () => {
    composeEnv();
    process.env.POSTGRES_PORT = "5433";
    process.env.DATABASE_URL =
      "postgresql://booking:booking@localhost:5432/booking";
    process.env.REDIS_URL = "redis://localhost:6379";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).toThrow(/POSTGRES_PORT=5433, while DATABASE_URL says 5432/);
  });

  it("reports every part that disagrees at once", () => {
    composeEnv();
    process.env.POSTGRES_PASSWORD = "changed";
    process.env.POSTGRES_DB = "other";
    process.env.DATABASE_URL =
      "postgresql://booking:booking@localhost:5432/booking";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).toThrow(/POSTGRES_PASSWORD=changed.*\n.*POSTGRES_DB=other/);
  });

  it("reads an omitted port as the well-known one, which is what Compose publishes", () => {
    composeEnv();
    process.env.DATABASE_URL = "postgresql://booking:booking@localhost/booking";
    process.env.REDIS_URL = "redis://localhost";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).not.toThrow();
  });

  it("compares a percent-encoded password against what .env states", () => {
    composeEnv();
    process.env.POSTGRES_PASSWORD = "p@ss:1";
    process.env.DATABASE_URL =
      "postgresql://booking:p%40ss%3A1@localhost:5432/booking";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).not.toThrow();
  });

  it("says nothing when only the URLs are set, as on a deployment", () => {
    process.env.DATABASE_URL =
      "postgresql://app:secret@pooler.internal:6543/app";
    process.env.REDIS_URL = "rediss://default:secret@redis.internal:6380";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).not.toThrow();
  });

  it("leaves a missing URL to the module that needs it", () => {
    composeEnv();

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).not.toThrow();
  });

  it("names a URL it cannot parse instead of comparing nothing", () => {
    composeEnv();
    process.env.DATABASE_URL = "postgresql://h1:5432,h2:5432/booking";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).toThrow(/DATABASE_URL is not a URL/);
  });

  // `localhost` becomes the scheme and the rest an opaque path, so the URL parses and
  // every field reads empty — one mistake would otherwise be reported as a list of
  // invented ones.
  it("names a host-less URL once rather than reporting every part as wrong", () => {
    composeEnv();
    process.env.DATABASE_URL = "localhost:5432";

    let message = "";

    try {
      assertConnectionUrlsMatchCompose();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/DATABASE_URL has no host/);
    expect(message).not.toMatch(/POSTGRES_USER/);
  });

  it("leaves a unix socket alone, which it has no way to compare", () => {
    composeEnv();
    process.env.DATABASE_URL =
      "postgresql:///booking?host=/var/run/postgresql&port=5432";
    delete process.env.REDIS_PORT;

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).not.toThrow();
  });

  it("says nothing about a broken URL where no part is set to compare it with", () => {
    process.env.DATABASE_URL = "localhost:5432";

    expect(() => {
      assertConnectionUrlsMatchCompose();
    }).not.toThrow();
  });
});
