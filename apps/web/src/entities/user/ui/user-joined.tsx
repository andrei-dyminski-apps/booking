import { CalendarIcon } from "lucide-react";
import { formatDate } from "#shared/lib";

/** When the account was made, behind a calendar. */
export const UserJoined = ({ createdAt }: { createdAt: string }) => (
  <span className="flex items-center gap-1.5">
    <CalendarIcon className="size-[1em]" />
    Joined {formatDate(createdAt)}
  </span>
);
