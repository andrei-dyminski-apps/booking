import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Request } from "express";
import type { LoggerService } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Logger as PinoNestLogger, PinoLogger, type Params } from "nestjs-pino";
import pino, {
  type LevelWithSilent,
  type Logger,
  type LoggerOptions,
} from "pino";
import { pinoHttp, type Options } from "pino-http";
import {
  CLIENT_CLOSED_REQUEST,
  REQUEST_ID_HEADER,
  REQUEST_ID_PATTERN,
} from "@repo/contracts";
import type { AuthenticatedUser } from "../auth/auth.types";
import { HEALTH_PATH } from "../health/health-path";

/**
 * The id every line of one request carries. An id the caller already sent is kept, so a
 * proxy in front that names its requests can be followed into this log — the frontend's
 * BFF does, for every request a browser makes — and either way the answer names it back,
 * which is what a user reporting an error can quote. An id is adopted only in the shape of
 * `REQUEST_ID_PATTERN`: it ends up in every line of the request and in the answer's
 * header, so anything else gets a fresh UUID instead.
 *
 * A kept id is a correlation hint, not a fact: anyone reaching the API directly can send
 * one, another request's included, so two requests may share it and nothing may be
 * decided by it. The browser cannot — the BFF mints its own id and drops whatever a
 * browser sent.
 */
export function requestIdOf(
  request: IncomingMessage,
  response: ServerResponse,
): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === "string" && REQUEST_ID_PATTERN.test(incoming)
      ? incoming
      : randomUUID();

  response.setHeader(REQUEST_ID_HEADER, id);

  return id;
}

/**
 * The status the client got, or `499` (`CLIENT_CLOSED_REQUEST`) when it left before the
 * answer was finished. pino-http writes the line on `close` as well as on `finish`, and the
 * status there is whatever the handler had set — a `200` nobody received. The event stream
 * ends this way every time a tab closes, which is right: nobody was left to answer.
 */
export function loggedStatusOf(response: ServerResponse): number {
  return response.writableFinished
    ? response.statusCode
    : CLIENT_CLOSED_REQUEST;
}

/**
 * The path alone, never the query string: that is where a search typed into a filter
 * goes — an admin's lookup of an account by its address — and the filters of a request
 * are not what finds it again, its id is.
 */
export function loggedPathOf(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
}

/**
 * A `4xx` stays `info`: an expired access token is a `401` the frontend answers with a
 * refresh several times an hour per visitor, and a level that fires on it says nothing.
 * So does a `499`: the client chose to leave.
 */
export function requestLevelOf(
  _request: IncomingMessage,
  response: ServerResponse,
  error?: Error,
): LevelWithSilent {
  return error !== undefined || loggedStatusOf(response) >= 500
    ? "error"
    : "info";
}

/**
 * The account behind the request, once the guard has put it there. pino-http reads it
 * again when the response finishes, which is the call that sees it — at the start of the
 * request nobody has been authenticated yet.
 */
export function requestPropsOf(request: IncomingMessage): {
  userId?: string;
} {
  // The middleware runs inside Express, so the request is Express's, and `user` is what
  // JwtAuthGuard put on it.
  const user = (request as Request).user as AuthenticatedUser | undefined;

  return user === undefined ? {} : { userId: user.id };
}

function rootLevel(): LevelWithSilent {
  return process.env.NODE_ENV === "test" ? "silent" : "info";
}

/**
 * What every line looks like, wherever it is written. The level is its name, not pino's
 * number: a platform's log viewer (Railway's, and most others) reads `"level":"error"` and
 * knows nothing of `50`. The time is ISO 8601 rather than milliseconds since the epoch, so
 * a line reads the same to a person and to any parser.
 */
export const LOG_FORMAT = {
  formatters: { level: (label: string) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
} satisfies LoggerOptions;

let applicationLogger: Logger | undefined;

/**
 * The one pino instance of the process: the request log and every `Logger` of
 * `@nestjs/common` write through it, so there is one transport and one level.
 *
 * - **JSON in production, a line a person reads elsewhere.** `pino-pretty` is a dev
 *   dependency, chosen by `NODE_ENV` alone, so an environment installed without dev
 *   dependencies has to run with `NODE_ENV=production` or fail at boot. Under Jest
 *   (`NODE_ENV=test`) everything is silent and nothing starts the pretty printer's worker
 *   thread.
 */
export function theLogger(): Logger {
  if (applicationLogger !== undefined) return applicationLogger;

  const pretty =
    process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

  applicationLogger = pino({
    ...LOG_FORMAT,
    level: rootLevel(),
    transport: pretty
      ? {
          target: "pino-pretty",
          options: { singleLine: true, ignore: "pid,hostname" },
        }
      : undefined,
  });

  return applicationLogger;
}

/**
 * The `nestjs-pino` module's options. It does not mount the request log itself
 * (`useExisting`): `useRequestLog` has already, ahead of everything else. What the module
 * still adds is the request's logger in async storage, so a line logged while a request is
 * handled carries its id.
 */
export function loggerParams(): Params {
  return { pinoHttp: { logger: theLogger() }, useExisting: true };
}

/**
 * What Nest says while it wires the application up: a line per module and per route. Worth
 * reading in development, where the routes change; in production it is a hundred lines of
 * every deploy saying what the last one said.
 */
const BOOT_CHATTER = new Set([
  "InstanceLoader",
  "RoutesResolver",
  "RouterExplorer",
]);

class ApplicationLogger extends PinoNestLogger {
  override log(message: unknown, ...optionalParams: unknown[]): void {
    // Nest passes the context last.
    const context = optionalParams.at(-1);

    if (
      process.env.NODE_ENV === "production" &&
      typeof context === "string" &&
      BOOT_CHATTER.has(context)
    ) {
      return;
    }

    super.log(message, ...optionalParams);
  }
}

/**
 * `nestjs-pino` behind every `Logger` of `@nestjs/common`, from Nest's first line.
 *
 * - **Handed to `NestFactory.create`, not taken from the module afterwards.** The module's
 *   own logger exists only once every module has been created, and what Nest says before
 *   that is buffered and, if creating one fails, written by Nest's plain console logger —
 *   the one failure a deploy's log has to show in its own format. Built by hand instead,
 *   from the module's own options: both classes take them as constructor arguments, and
 *   both write through `theLogger()`, reading the request's logger from the same storage.
 */
export function nestLogger(): LoggerService {
  const params = loggerParams();

  return new ApplicationLogger(new PinoLogger(params), params);
}

/**
 * The request log, mounted by `main.ts` before any other middleware.
 *
 * - **First, not where `nestjs-pino` would put it.** Its module mounts the middleware when
 *   Nest initialises, after everything `main.ts` has registered, so a request the body
 *   parsers refuse — a malformed body's `400`, an oversized one's `413` — would be answered
 *   unlogged and without an id. Neither is an interceptor: that runs after the guards and
 *   would miss the limiter's `429` and the guard's `401`, the requests worth reading after
 *   an incident.
 * - **The request is logged by an allowlist, not redacted from a full dump.** pino's default
 *   serializer writes every header, the session cookies and the Stripe signature among
 *   them, and a redaction list is only as good as the last header somebody remembered.
 *   What is kept is what answers "which request was it": the method, the path (without its
 *   query string, see `loggedPathOf`), the client
 *   address (`req.ip`, so `TRUST_PROXY` applies), the status and the time it took.
 *
 * An e2e spec that reads the request id calls it too: the testing module has no `main.ts`.
 */
export function useRequestLog(
  app: NestExpressApplication,
  logger: Logger = theLogger(),
): void {
  app.use(pinoHttp({ ...requestLogOptions(), logger }));
}

function lineOf(request: IncomingMessage, response: ServerResponse): string {
  return `${String(request.method)} ${loggedPathOf(request.url)} ${String(loggedStatusOf(response))}`;
}

/**
 * The `5xx` line without the error pino-http makes up for it. With no error of its own to
 * report, pino-http attaches a `failed with status code 500` whose stack is its own
 * internals; the real exception is already logged by Nest, under the same request id.
 * An error the response actually emitted is kept.
 */
export function requestErrorObjectOf(
  _request: IncomingMessage,
  response: ServerResponse,
  error: Error,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  if (
    error.message !== `failed with status code ${String(response.statusCode)}`
  ) {
    return fields;
  }

  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => key !== "err"),
  );
}

/** The request log's options, apart from the logger it writes through. */
export function requestLogOptions(): Options {
  return {
    genReqId: requestIdOf,
    customLogLevel: requestLevelOf,
    customProps: requestPropsOf,
    customSuccessMessage: lineOf,
    customErrorMessage: lineOf,
    customErrorObject: requestErrorObjectOf,
    // The path the platform probes; a line per probe would be most of the log.
    autoLogging: {
      ignore: (request) => loggedPathOf(request.url) === `/${HEALTH_PATH}`,
    },
    serializers: {
      req: (request: { id: unknown; raw: IncomingMessage }) => ({
        id: request.id,
        method: request.raw.method,
        url: loggedPathOf(request.raw.url),
        ip: (request.raw as Request).ip,
      }),
      res: (response: { raw: ServerResponse }) => ({
        statusCode: loggedStatusOf(response.raw),
        ...(response.raw.writableFinished ? {} : { aborted: true }),
      }),
    },
  };
}
