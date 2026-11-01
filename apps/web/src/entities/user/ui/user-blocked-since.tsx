import { formatMoment } from "#shared/lib";

/** Since when the account has been blocked; nothing for an account that is not. */
export const UserBlockedSince = ({
  blockedAt,
}: {
  blockedAt: string | null;
}) =>
  blockedAt === null ? null : (
    <span>Blocked since {formatMoment(blockedAt)} UTC</span>
  );
