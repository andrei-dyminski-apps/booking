/**
 * Prisma hands a `contains` to `LIKE` as it is, so `_` and `%` in what somebody typed would
 * match any character and any run of them — `john_doe` would find `johnxdoe` and `%` every
 * row. The backslash is the default escape character of `LIKE`, so it is escaped too.
 *
 * It lives beside the client rather than in one repository because two of them search a
 * column by a part of it: the `email` filter of `GET /users` and the lookups of `/lookups`.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
