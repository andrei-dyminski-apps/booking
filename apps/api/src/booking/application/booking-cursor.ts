import { bookingSchema, bookingSortSchema } from "@repo/contracts";
import type { Booking, BookingSort } from "@repo/contracts";
import { decodeParts, encodeParts } from "../../common/paging";
import type { BookingCursor } from "../domain/booking.types";

/**
 * The envelope — the base64 spelling, the separator and the resource tag — belongs to
 * `src/common/paging.ts`, because every paged read of this API writes a cursor the same
 * way. The tag is what keeps the two apart: a `newest` cursor of the catalogue is a
 * timestamp and a uuid, which is exactly what a `newest` cursor of the stays is, so
 * without it one list would answer a place in the other.
 */
const RESOURCE = "bookings";

export function encodeCursor(booking: Booking, sort: BookingSort): string {
  return encodeParts(RESOURCE, sort, sortKey(booking, sort), booking.id);
}

/**
 * `null` for anything this cannot read. The value arrives in a URL, so it is untrusted
 * input like any other and every half of it is validated as strictly as a field is: the
 * caller answers that with a `400`, because a cursor is either one this API issued or a
 * mistake, and silently starting from the top would answer a different question than the
 * one asked.
 *
 * Each key is read against the rule the contract already writes for the column it comes
 * from — a moment for `createdAt`, a calendar day for `from` — so a cursor cannot name a
 * value no booking could hold, and the two are not interchangeable.
 */
export function decodeCursor(raw: string): BookingCursor | null {
  const parts = decodeParts(RESOURCE, raw, {
    sort: bookingSortSchema,
    id: bookingSchema.shape.id,
  });

  if (parts === null) return null;

  const { sort, key, id } = parts;

  switch (sort) {
    case "newest":
    case "oldest": {
      const createdAt = bookingSchema.shape.createdAt.safeParse(key);

      return createdAt.success
        ? { sort, createdAt: new Date(createdAt.data), id }
        : null;
    }
    case "checkInAsc":
    case "checkInDesc": {
      const from = bookingSchema.shape.from.safeParse(key);

      // A calendar day names midnight UTC, which is the instant the `@db.Date` column
      // holds and the one `BookingRepository` compares against everywhere else.
      return from.success ? { sort, from: new Date(from.data), id } : null;
    }
  }
}

/**
 * The value of the column this ordering sorts by, as text. The switch is exhaustive on
 * purpose: a fifth sort added to the contract stops compiling here and in `afterCursor`,
 * which is where the other half of the same decision lives.
 */
function sortKey(booking: Booking, sort: BookingSort): string {
  switch (sort) {
    case "newest":
    case "oldest":
      return booking.createdAt;
    case "checkInAsc":
    case "checkInDesc":
      return booking.from;
  }
}
