import { formatMomentIn } from "#shared/lib";

/** When the person erased their own account; nothing for an account still there. */
export const UserDeletedSince = ({
  deletedAt,
  readerTimeZone,
}: {
  deletedAt: string | null;
  /** The reader's zone, which the moment is stated in (`readerTimeZone`). */
  readerTimeZone: string;
}) =>
  deletedAt === null ? null : (
    <span>Deleted {formatMomentIn(deletedAt, readerTimeZone)}</span>
  );
