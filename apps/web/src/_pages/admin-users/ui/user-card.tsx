import { CalendarIcon } from "lucide-react";
import type { ManagedUser, User } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { formatDate, formatMoment } from "#shared/lib";
import { ROLE_LABELS } from "../lib/users-search";
import { BlockButton } from "./block-button";
import { RoleForm } from "./role-form";

/**
 * One account, and the two things an admin may change about it.
 *
 * The admin's own row is drawn without them, which is the API's rule read from this side
 * rather than the rule itself: `PATCH /users/:id` refuses a change to the caller's own
 * account on every request, and controls that could only ever reach that `403` are not
 * worth putting on the screen.
 */
export const UserCard = ({
  user,
  viewer,
}: {
  user: ManagedUser;
  viewer: User;
}) => {
  const self = user.id === viewer.id;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="break-all">{user.email}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <CalendarIcon className="size-3.5" />
            Joined {formatDate(user.createdAt)}
          </span>
          {user.blockedAt !== null && (
            <span>Blocked since {formatMoment(user.blockedAt)} UTC</span>
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {self && <Badge variant="secondary">You</Badge>}
          {user.blockedAt !== null && (
            <Badge variant="destructive">Blocked</Badge>
          )}
          <Badge variant="outline">{ROLE_LABELS[user.role]}</Badge>
        </CardAction>
      </CardHeader>

      {!self && (
        <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-between">
          <RoleForm userId={user.id} role={user.role} email={user.email} />
          <BlockButton
            userId={user.id}
            email={user.email}
            blocked={user.blockedAt !== null}
          />
        </CardFooter>
      )}
    </Card>
  );
};
