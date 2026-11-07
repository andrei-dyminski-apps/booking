import { Suspense, type ReactNode } from "react";
import { CalendarCheckIcon, WarehouseIcon } from "lucide-react";
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
import {
  anyUser,
  ROLE_LABELS,
  UserBlockedSince,
  UserJoined,
} from "#entities/user";
import { HostFees } from "#entities/host-fee";
import { hostFeesApi, requireRole } from "#shared/api";
import { ROUTES } from "#shared/config";
import { countOf, filtersHref, requireId } from "#shared/lib";
import { BackLink, ButtonLink } from "#shared/ui";
import { BlockButton } from "./block-button";
import { WaiveFeeButton } from "./waive-fee-button";

/**
 * One account: what it is, whether it may sign in, and the way to what it has done on the
 * site. The stays and the listings are not listed here — each is
 * a link to the list that already pages and filters them, narrowed to this account by the
 * filter that list already takes (`guestId` on the stays, `ownerId` on the listings). What
 * the account owes as a host for cancelling paid stays is, with a waiver per fee.
 */
export const UserPage = async ({ params }: PageProps<"/admin/users/[id]">) => {
  const id = requireId((await params).id);
  const viewer = await requireRole(Role.ADMIN, ROUTES.adminUser(id));
  const user = await anyUser(id);
  const self = user.id === viewer.id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackLink href={ROUTES.adminUsers}>All users</BackLink>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">
              {user.name}
            </h1>
            <p className="text-sm break-all text-muted-foreground">
              {user.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {self && <Badge variant="secondary">You</Badge>}
            {user.blockedAt !== null && (
              <Badge variant="destructive">Blocked</Badge>
            )}
            <Badge variant="outline">{ROLE_LABELS[user.role]}</Badge>
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <UserJoined createdAt={user.createdAt} />
            <UserBlockedSince blockedAt={user.blockedAt} />
          </p>
        </div>
      </div>

      {user.role === Role.USER && (
        <>
          <AccessCard user={user} />
          <ActivityCard user={user} />
        </>
      )}
      {/* Streamed after the account: its access and activity do not wait for the fees. */}
      <Suspense fallback={null}>
        <HostFees
          read={() => hostFeesApi.ofHost(id)}
          audience="admin"
          action={(fee) => <WaiveFeeButton feeId={fee.id} />}
        />
      </Suspense>
    </div>
  );
};

/**
 * The block. Only a user's account is drawn with it — the API refuses to block an admin's,
 * the viewer's own included, and a control that could only reach that `403` is not worth
 * putting on the screen.
 */
const AccessCard = ({ user }: { user: ManagedUserDetail }) => (
  <Card>
    <CardHeader>
      <CardTitle>Access</CardTitle>
      <CardDescription>
        A block ends its sessions and stops any new sign-in; a page already open
        loses access when its short-lived token runs out.
      </CardDescription>
    </CardHeader>

    <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-end">
      <BlockButton
        userId={user.id}
        name={user.name}
        blocked={user.blockedAt !== null}
      />
    </CardFooter>
  </Card>
);

/**
 * What the account has behind it: the stays it took and the listings it offers, both rows
 * drawn, an empty one included. Only a user's account has the card — an admin neither books
 * nor lists, and the API grants no role, so an admin's would always be empty.
 */
const ActivityCard = ({ user }: { user: ManagedUserDetail }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ul role="list" className="flex flex-col divide-y">
          <ActivityRow
            icon={<CalendarCheckIcon className="size-4" />}
            label={countOf(user.bookingCount, "stay taken", "stays taken")}
            href={
              user.bookingCount > 0
                ? filtersHref(ROUTES.bookings, { guestId: user.id })
                : null
            }
          />
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
