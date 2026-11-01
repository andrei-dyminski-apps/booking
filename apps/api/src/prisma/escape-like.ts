/**
 * Prisma hands a `contains` to `LIKE` as it is, so `_` and `%` in what somebody typed would
 * match any character and any run of them — `john_doe` would find `johnxdoe` and `%` every
 * row. The backslash is the default escape character of `LIKE`, so it is escaped too.
 *
 * It lives beside the client rather than in one repository because three of them search a
 * column by a part of it: the `name` and `email` filters of `GET /users`, the lookups of
 * `/lookups` and the `type` filter of `GET /payment-events/failed`.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
