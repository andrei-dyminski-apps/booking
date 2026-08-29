import Link from "next/link";
import { CalendarSearchIcon } from "lucide-react";
import { Role, type Role as RoleName } from "@repo/contracts";
import { buttonVariants } from "@repo/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty";
import { bookingsApi, requireUser } from "#shared/api";
import { ROUTES } from "#shared/config";
import { BookingCard } from "./booking-card";

/**
 * One page, three scopes. `GET /bookings` narrows what it returns by the caller's role
 * rather than by a parameter — a guest sees the stays they took, an owner the stays taken
 * against their listings, an admin every one of them — so this page has no filter to get
 * wrong, and the only thing the role decides here is what to call the list.
 *
 * The read is personal, so it is `no-store` and carries no tag: the Data Cache is keyed by
 * URL and shared between visitors, and a tag would only make it easier to serve one
 * person's stays to the next.
 */
const SCOPE: Record<RoleName, { title: string; empty: string; lead: string }> =
  {
    [Role.USER]: {
      title: "Your stays",
      lead: "Every booking you have taken, with the state the API keeps it in.",
      empty: "Nothing booked yet. The catalogue is where a stay starts.",
    },
    [Role.OWNER]: {
      title: "Bookings",
      lead: "Every stay taken against your listings. Cancelling one is the guest's to do, not yours.",
      empty: "Nobody has booked your listings yet.",
    },
    [Role.ADMIN]: {
      title: "All bookings",
      lead: "Every stay on the site, in the state the API keeps it in.",
      empty: "There are no bookings at all yet.",
    },
  };

export const BookingsPage = async () => {
  const viewer = await requireUser(ROUTES.bookings);
  const bookings = await bookingsApi.list({ cache: "no-store" });
  const scope = SCOPE[viewer.role];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{scope.title}</h1>
        <p className="text-sm text-muted-foreground">{scope.lead}</p>
      </div>

      {bookings.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarSearchIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing here yet</EmptyTitle>
            <EmptyDescription>{scope.empty}</EmptyDescription>
          </EmptyHeader>
          {viewer.role === Role.USER && (
            <EmptyContent>
              <Link href={ROUTES.catalogue} className={buttonVariants()}>
                Browse the stays
              </Link>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {bookings.map((booking) => (
            <BookingCard key={booking.id} booking={booking} viewer={viewer} />
          ))}
        </div>
      )}
    </div>
  );
};
