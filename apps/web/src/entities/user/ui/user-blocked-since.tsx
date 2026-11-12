import { formatMomentIn } from "#shared/lib";

/** Since when the account has been blocked; nothing for an account that is not. */
export const UserBlockedSince = ({
  blockedAt,
  readerTimeZone,
}: {
  blockedAt: string | null;
  /** The reader's zone, which the moment is stated in (`readerTimeZone`). */
  readerTimeZone: string;
}) =>
  blockedAt === null ? null : (
    <span>Blocked since {formatMomentIn(blockedAt, readerTimeZone)}</span>
  );
