import { CLIENT_CLOSED_REQUEST } from "@repo/contracts";
import { HTTP_STATUS } from "#shared/config";

/**
 * The proxy's own line per request — the half of a request the API's log cannot see.
 * Both lines carry the same id, so a user quoting the `x-request-id` of an answer finds
 * where the browser's request arrived and where the API took it.
 *
 * Written to stdout without a logging library: one line per request is all this server
 * logs, and the platform's viewer reads a JSON line as it is. The shape follows the API's
 * pino-http line — `level` named, `time` ISO, `req.id`, `res.statusCode`, `err` — so one
 * query reads both services. Outside production a short line instead, next to the API's
 * pino-pretty output in the same terminal.
 */

export interface ProxiedRequest {
  id: string;
  method: string;
  /** Without the query string, as the API logs it: that is where a search puts what it searched for. */
  path: string;
  status: number;
  durationMs: number;
  /** `x-vercel-id`, which finds the request in Vercel's own logs; absent outside Vercel. */
  vercelId: string | null;
  /** What made the proxy fail, when something did: a throw, or an unset `API_ORIGIN`. */
  error?: unknown;
}

/** pino's `err`, so a failure reads the same in both logs. */
interface LoggedError {
  type: string;
  message: string;
  stack?: string;
}

function loggedErrorOf(error: unknown): LoggedError {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: String(error) };
  }

  return {
    type: error.name,
    message: error.message,
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}

export function requestLine(request: ProxiedRequest): {
  level: "info" | "error";
  time: string;
  msg: string;
  req: { id: string; method: string; url: string };
  res: { statusCode: number; aborted?: true };
  responseTime: number;
  vercelId?: string;
  err?: LoggedError;
} {
  return {
    level:
      request.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR ? "error" : "info",
    time: new Date().toISOString(),
    msg: `${request.method} ${request.path} ${String(request.status)}`,
    req: { id: request.id, method: request.method, url: request.path },
    // `aborted` as the API marks it, so one query finds the clients that left in both logs.
    res:
      request.status === CLIENT_CLOSED_REQUEST
        ? { statusCode: request.status, aborted: true }
        : { statusCode: request.status },
    responseTime: Math.round(request.durationMs),
    ...(request.vercelId === null ? {} : { vercelId: request.vercelId }),
    ...(request.error === undefined
      ? {}
      : { err: loggedErrorOf(request.error) }),
  };
}

export function logRequest(request: ProxiedRequest): void {
  const line = requestLine(request);
  const write = line.level === "error" ? console.error : console.info;

  if (process.env.NODE_ENV === "production") {
    write(JSON.stringify(line));

    return;
  }

  const short = `BFF ${line.msg} ${String(line.responseTime)}ms ${request.id}`;

  // The error itself rather than its fields, so the terminal prints its stack and cause.
  if (request.error === undefined) write(short);
  else write(short, request.error);
}
