import { CalendarIcon } from "lucide-react";
import { formatDate } from "#shared/lib";

/** When the account was made, behind a calendar — the day it was on the reader's clock. */
export const UserJoined = ({
  createdAt,
  readerTimeZone,
}: {
  createdAt: string;
  /** The reader's zone, which the day is read in (`readerTimeZone`). */
  readerTimeZone: string;
}) => (
  <span className="flex items-center gap-1.5">
    <CalendarIcon className="size-[1em]" />
    Joined {formatDate(createdAt, readerTimeZone)}
  </span>
);
