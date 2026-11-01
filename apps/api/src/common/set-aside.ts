import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * What every admin action on something set aside answers when its conditional write
 * matched nothing — a retry, a resolution: `409` for a row that is there in another state,
 * `404` for one that is not. `exists` is asked only after the write missed, so an action
 * that goes through costs one statement.
 */
export async function writeOrRefuse(
  write: Promise<boolean>,
  exists: () => Promise<boolean>,
  refusal: { conflict: string; notFound: string },
): Promise<void> {
  if (await write) return;

  if (await exists()) throw new ConflictException(refusal.conflict);

  throw new NotFoundException(refusal.notFound);
}
