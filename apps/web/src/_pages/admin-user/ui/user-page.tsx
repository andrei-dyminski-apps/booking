import type { ReactNode } from "react";
import {
  ArrowLeftIcon,
  CalendarCheckIcon,
  CalendarIcon,
  WarehouseIcon,
} from "lucide-react";
import { Role, type ManagedUserDetail } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { anyUser, ROLE_LABELS } from "#entities/user";
import { requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import {
  countOf,
  filtersHref,
  formatDate,
  formatMoment,
  requireId,
} from "#shared/lib";
import { ButtonLink } from "#shared/ui";
import { BlockButton } from "./block-button";
import { RoleForm } from "./role-form";

/**
 * One account: what it is, the two things an admin may change about it, and the way to
 * what it has done on the site. The stays and the listings are not listed here — each is
 * a link to the list that already pages and filters them, narrowed to this account by the
 * filter that list already takes (`guestId` on the stays, `ownerId` on the listings).
 */
export const UserPage = async ({ params }: PageProps<"/admin/users/[id]">) => {
  const id = requireId((await params).id);
  const viewer = await requireRole(Role.ADMIN, ROUTES.adminUser(id));
  const user = await anyUser(id);
  const self = user.id === viewer.id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <ButtonLink
          href={ROUTES.adminUsers}
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
        >
          <ArrowLeftIcon />
          All users
        </ButtonLink>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight break-all">
            {user.email}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {self && <Badge variant="secondary">You</Badge>}
            {user.blockedAt !== null && (
              <Badge variant="destructive">Blocked</Badge>
            )}
            <Badge variant="outline">{ROLE_LABELS[user.role]}</Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarIcon className="size-3.5" />
              Joined {formatDate(user.createdAt)}
            </span>
            {user.blockedAt !== null && (
              <span>Blocked since {formatMoment(user.blockedAt)} UTC</span>
            )}
          </p>
        </div>
      </div>

      <AccessCard user={user} self={self} />
      <ActivityCard user={user} />
    </div>
  );
};

/**
 * The role and the block. The admin's own account is drawn without them — the API refuses
 * a change to the caller's own row on every request, and controls that could only reach
 * that `403` are not worth putting on the screen.
 */
const AccessCard = ({
  user,
  self,
}: {
  user: ManagedUserDetail;
  self: boolean;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Access</CardTitle>
      <CardDescription>
        {self
          ? "This is your account. Another admin changes its role or blocks it."
          : "A new role takes effect when the account's session next refreshes. A block ends its sessions and stops any new sign-in; a page already open loses access when its short-lived token runs out."}
      </CardDescription>
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

/**
 * What the account has behind it, as far as its role reaches: stays for a user, listings
 * for an owner. A row outside the role is still drawn while it has something in it — a
 * role changed later leaves the stays and the listings where they were. With neither row
 * there is no card.
 */
const ActivityCard = ({ user }: { user: ManagedUserDetail }) => {
  const stays = user.role === Role.USER || user.bookingCount > 0;
  const listings = user.role === Role.OWNER || user.listingCount > 0;
  if (!stays && !listings) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ul role="list" className="flex flex-col divide-y">
          {stays && (
            <ActivityRow
              icon={<CalendarCheckIcon className="size-4" />}
              label={countOf(user.bookingCount, "stay taken", "stays taken")}
              href={
                user.bookingCount > 0
                  ? filtersHref(ROUTES.bookings, { guestId: user.id })
                  : null
              }
            />
          )}
          {listings && (
            <ActivityRow
              icon={<WarehouseIcon className="size-4" />}
              label={countOf(
                user.listingCount,
                "listing on offer",
                "listings on offer",
              )}
              href={
                user.listingCount > 0
                  ? filtersHref(ROUTES.admin, { ownerId: user.id })
                  : null
              }
            />
          )}
        </ul>
      </CardContent>
    </Card>
  );
};

/** A count, and a link to the list behind it once there is anything in that list. */
const ActivityRow = ({
  icon,
  label,
  href,
}: {
  icon: ReactNode;
  label: string;
  href: string | null;
}) => (
  <li className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
    <span className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </span>
    {href !== null && (
      <ButtonLink href={href} variant="outline" size="sm">
        View
      </ButtonLink>
    )}
  </li>
);
