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
import { ROLE_LABELS } from "#entities/user";
import { ROUTES } from "#shared/config";
import { formatDate, formatMoment } from "#shared/lib";
import { ButtonLink } from "#shared/ui";

/**
 * One account in the list, and the way to its own page. The role and the block are
 * changed there rather than here, next to the stays and the listings the account has —
 * what an admin wants to look at before blocking somebody.
 */
export const UserCard = ({
  user,
  viewer,
}: {
  user: ManagedUser;
  viewer: User;
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="break-words">{user.name}</CardTitle>
      <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="break-all">{user.email}</span>
        <span className="flex items-center gap-1.5">
          <CalendarIcon className="size-3.5" />
          Joined {formatDate(user.createdAt)}
        </span>
        {user.blockedAt !== null && (
          <span>Blocked since {formatMoment(user.blockedAt)} UTC</span>
        )}
      </CardDescription>
      <CardAction className="flex items-center gap-2">
        {user.id === viewer.id && <Badge variant="secondary">You</Badge>}
        {user.blockedAt !== null && (
          <Badge variant="destructive">Blocked</Badge>
        )}
        <Badge variant="outline">{ROLE_LABELS[user.role]}</Badge>
      </CardAction>
    </CardHeader>

    <CardFooter>
      <ButtonLink
        href={ROUTES.adminUser(user.id)}
        variant="outline"
        size="sm"
        className="w-full sm:w-auto"
      >
        Manage
      </ButtonLink>
    </CardFooter>
  </Card>
);
