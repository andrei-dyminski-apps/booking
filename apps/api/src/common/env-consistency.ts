/**
 * The connection URLs repeat what docker-compose.yml is given: POSTGRES_* and REDIS_PORT
 * describe the containers, DATABASE_URL and REDIS_URL describe how the application reaches
 * them, and nothing links the two — Compose cannot assemble a URL from parts. Change one
 * side alone and the container comes up one way while the application arrives another,
 * which surfaces much later as a refused connection, far from the line that caused it.
 *
 * So the two are compared at boot. What this checks is the local setup and not the
 * deployment: a platform hands over a ready URL and sets no POSTGRES_* at all, so a part
 * that is absent is not an error but the signal that there is nothing to compare against.
 * That is also why a URL which does not parse is only reported when the parts are there —
 * a managed database may be a multi-host string the WHATWG parser refuses, and it is none
 * of this function's business.
 *
 * It does not check that the URL reaches anything: whether the container is running, and
 * whether its volume still holds the credentials it was first initialised with, is what
 * the connection itself answers.
 */
export function assertConnectionUrlsMatchCompose(): void {
  const problems = [
    ...describeMismatches("DATABASE_URL", process.env.DATABASE_URL, [
      // The host is deliberately absent: Compose is never told one, so there is no second
      // side to disagree with. Everything below is written twice today.
      {
        variable: "POSTGRES_USER",
        expected: process.env.POSTGRES_USER,
        read: (url) => decodeComponent(url.username),
      },
      {
        variable: "POSTGRES_PASSWORD",
        expected: process.env.POSTGRES_PASSWORD,
        read: (url) => decodeComponent(url.password),
      },
      {
        variable: "POSTGRES_DB",
        expected: process.env.POSTGRES_DB,
        read: (url) => url.pathname.replace(/^\//, ""),
      },
      {
        variable: "POSTGRES_PORT",
        expected: process.env.POSTGRES_PORT,
        // An omitted port means the well-known one, and Compose publishes exactly that
        // when POSTGRES_PORT is unset — the two agree rather than differ.
        read: (url) => url.port || "5432",
      },
    ]),
    ...describeMismatches("REDIS_URL", process.env.REDIS_URL, [
      {
        variable: "REDIS_PORT",
        expected: process.env.REDIS_PORT,
        read: (url) => url.port || "6379",
      },
    ]),
  ];

  if (problems.length > 0) {
    throw new Error(
      [
        "The connection URLs disagree with the docker-compose variables in .env:",
        ...problems.map((problem) => `  - ${problem}`),
        "Update both sides. Credentials of an already created database are fixed when its",
        "volume is first initialised, so changing them also needs `docker compose down -v`.",
      ].join("\n"),
    );
  }
}

type ComposePart = {
  readonly variable: string;
  readonly expected: string | undefined;
  readonly read: (url: URL) => string;
};

function describeMismatches(
  variable: string,
  rawUrl: string | undefined,
  parts: readonly ComposePart[],
): string[] {
  const stated = parts.filter(
    (part) => part.expected !== undefined && part.expected !== "",
  );

  // Nothing to compare against — the deployment case, where only the URL is set.
  if (stated.length === 0) {
    return [];
  }

  // A missing URL is not this function's error: PrismaService and the BullMQ factory each
  // refuse to start without one, in their own words.
  if (rawUrl === undefined || rawUrl === "") {
    return [];
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return [`${variable} is not a URL, so there is nothing to compare`];
  }

  // "localhost:5432" parses rather than throws — `localhost` becomes the scheme and the
  // rest an opaque path — and every field below would then be read out of nothing, turning
  // one mistake into a list of invented ones. No host means either that typo or a unix
  // socket, which libpq spells as a `host` query parameter and this check cannot compare.
  if (url.hostname === "") {
    return url.searchParams.has("host")
      ? []
      : [`${variable} has no host, so it is not a connection URL`];
  }

  return stated.flatMap((part) => {
    const actual = part.read(url);

    return part.expected === actual
      ? []
      : [
          `${part.variable}=${part.expected ?? ""}, while ${variable} says ${actual}`,
        ];
  });
}

/**
 * The user and the password arrive percent-encoded, because that is the only way a URL can
 * carry a `@` or a `:`. A stray `%` that encodes nothing is not worth failing over — the
 * comparison then runs against the raw text, which is what the developer typed anyway.
 */
function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
