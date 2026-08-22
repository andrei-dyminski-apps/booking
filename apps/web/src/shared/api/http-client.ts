import { z } from "zod";
import { apiErrorSchema, type ApiErrorIssue } from "@repo/contracts";
import { API_URL } from "../config";

/**
 * The transport every call to the API goes through: the base URL, the two errors and the
 * parse of the answer live here once, so an entity only writes down its own routes.
 */

/** The API never answered: it is down, DNS failed, CORS rejected the request. */
export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super("API is unreachable", { cause });
    this.name = "ApiUnreachableError";
  }
}

/** The API answered with a non-2xx status. `issues` is non-empty only for a failed validation. */
export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: readonly ApiErrorIssue[] = [],
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

/**
 * Caching of a read is a decision of the call site, not a default of this module —
 * hence a mandatory argument rather than an optional one.
 */
export type ReadOptions =
  | { cache: RequestCache }
  | { next: { revalidate?: number | false; tags?: string[] } };

type RequestOptions<T> = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  schema: z.ZodType<T>;
  body?: unknown;
  read?: ReadOptions;
};

/**
 * An API that accepts the connection and then says nothing would hold a server render
 * open for the five minutes undici allows it, so the transport gives up first. The abort
 * reaches the caller as a `TimeoutError` out of `fetch`, which is exactly the case
 * `ApiUnreachableError` describes.
 *
 * The price is Next's per-render memoization: a `signal` in the init opts the request out
 * of it, so two components asking for the same booking in one pass make two requests. The
 * Data Cache — the decision `read` carries from the call site — is not affected, and a
 * render that never finishes costs more than a duplicated call.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export async function apiRequest<T>({
  method,
  path,
  schema,
  body,
  read,
}: RequestOptions<T>): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      // The session is an httpOnly cookie issued by another origin — the API is a
      // separate host in every environment — and a cross-origin fetch leaves it behind
      // unless it is asked for. Without this every guarded route answers 401.
      credentials: "include",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      ...read,
    });
  } catch (cause) {
    // Only a transport error means the API is not running: any status code is an answer.
    throw new ApiUnreachableError(cause);
  }

  if (!response.ok) throw await toResponseError(response);

  // The answer is checked with the same schema the backend built it from. The parse is
  // deliberately outside the try above: a drift from the contract has to throw, not
  // disguise itself as an unavailable API.
  if (hasNoBody(response)) return schema.parse(undefined);

  const payload: unknown = await response.json();

  return schema.parse(payload);
}

/**
 * 204 and 205 are defined to carry no body at all, and a proxy may state a zero length
 * instead of either. `response.json()` throws on all three, so the schema is handed the
 * `undefined` that the `z.void()` of a deleting route expects.
 */
function hasNoBody(response: Response): boolean {
  return (
    response.status === 204 ||
    response.status === 205 ||
    response.headers.get("content-length") === "0"
  );
}

async function toResponseError(response: Response): Promise<ApiResponseError> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(payload);

  // A body outside the error contract carries nothing worth showing, but the status is
  // still an answer — so this stays a plain response error rather than a parse failure.
  if (!parsed.success) {
    return new ApiResponseError(
      response.status,
      `API responded with ${response.status}`,
    );
  }

  return new ApiResponseError(
    response.status,
    parsed.data.message,
    parsed.data.errors ?? [],
  );
}
