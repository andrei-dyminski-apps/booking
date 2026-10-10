import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";

/**
 * What a date field says when what arrived was not a calendar day — a box left empty, or
 * text nothing could read as one. The same job `numberMessage` does in `listing.ts`, and
 * for the same reason: zod's own `Invalid ISO date` names the format rather than the thing
 * being asked for, and a form here puts it under the box as the field is left.
 *
 * The two codes are the two ways of arriving with nothing: `invalid_type` is a field that
 * was never sent, `invalid_format` with an empty string is a box on the screen nobody
 * filled in.
 *
 * It lives here rather than beside the booking that first needed it because a listing's
 * date prices are days too, and `listing.ts` cannot import from `booking.ts` — the
 * booking already imports the listing's summary.
 */
export const dayMessage =
  (missing: string, notADay: string) =>
  (issue: z.core.$ZodRawIssue): string | undefined => {
    if (issue.code === "invalid_type") return missing;
    if (issue.code !== "invalid_format") return undefined;

    return issue.input === "" ? missing : notADay;
  };

/**
 * The format a calendar day is written in, on its own, so a rule about a day can ask
 * whether it has anything to compare yet before it compares.
 */
const DAY = z.iso.date();

export const isDay = (value: string): boolean => DAY.safeParse(value).success;

/**
 * A calendar date has no time zone, so "today" needs one chosen for it, and UTC is the
 * only clock both sides of the wire share. The check is therefore a guard against an
 * obvious mistake — a stay booked for last year — and not a precise deadline: within a day
 * of the boundary it can refuse what is still today somewhere. The exact cut-off belongs
 * with the availability rules of phase 4, which know the listing's own time zone.
 */
export const today = (): string => format(TZDate.tz("UTC"), "yyyy-MM-dd");
