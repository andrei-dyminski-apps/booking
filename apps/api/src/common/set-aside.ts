import { ConflictException, NotFoundException } from "@nestjs/common";
import type { ErrorCode } from "@repo/contracts";
import { apiException } from "./api-exception";

/** One refusal of `writeOrRefuse`: the rule's code and the sentence beside it. */
type Refusal = { code: ErrorCode; message: string };

/**
 * What every admin action on something set aside answers when its conditional write
 * matched nothing — a retry, a resolution: `409` for a row that is there in another state,
 * `404` for one that is not. `exists` is asked only after the write missed, so an action
 * that goes through costs one statement.
 */
export async function writeOrRefuse(
  write: Promise<boolean>,
  exists: () => Promise<boolean>,
  refusal: { conflict: Refusal; notFound: Refusal },
): Promise<void> {
  if (await write) return;

  if (await exists()) {
    throw apiException(
      ConflictException,
      refusal.conflict.code,
      refusal.conflict.message,
    );
  }

  throw apiException(
    NotFoundException,
    refusal.notFound.code,
    refusal.notFound.message,
  );
}
