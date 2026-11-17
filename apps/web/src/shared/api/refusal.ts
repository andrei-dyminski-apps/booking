import type { ErrorCode } from "@repo/contracts";
import { ApiResponseError } from "./http-client";

/**
 * Whether the API refused with one of these rules — what a caller reads where a status has
 * several reasons. An answer outside the contract, or from a build that knows fewer codes,
 * is `UNKNOWN_ERROR` and matches none of them, so a caller never acts on a guess.
 */
export function refusedWith(
  error: unknown,
  ...codes: readonly ErrorCode[]
): boolean {
  return error instanceof ApiResponseError && codes.includes(error.code);
}
