import {
  CalendarRangeIcon,
  ClockIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { currentUser } from "#shared/api";
import { ACCOUNT_DELETED_PARAM, ROUTES } from "#shared/config";
import { singleParam } from "#shared/lib";
import { ButtonLink } from "#shared/ui";

/**
 * Explains why a booking starts as a fifteen-minute hold.
 *
 * It is also where an erased account lands (`ROUTES.accountDeleted`), and says so at the
 * top: the session is gone by then, so a notice on the page is the one way left to tell
 * the visitor it worked.
 */
export const HomePage = async ({ searchParams }: PageProps<"/">) => {
  const user = await currentUser();
  const deleted =
    singleParam((await searchParams)[ACCOUNT_DELETED_PARAM.key]) ===
    ACCOUNT_DELETED_PARAM.value;

  return (
    <div className="flex flex-col gap-12">
      {user === null && deleted && (
        <p
          role="status"
          className="rounded-lg border bg-muted px-4 py-3 text-sm"
        >
          Your account has been deleted. Your past stays stay on record without
          your name, and the email address is free to register again.
        </p>
      )}

      <section className="flex flex-col items-start gap-6">
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          One contract, two sides
        </span>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Rooms, dates and guests — settled by the API, not by the screen.
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            Search the catalogue by the window you need, hold the nights while
            you make up your mind, and see every stay you have taken in one
            place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={ROUTES.catalogue} size="lg">
            Browse the stays
          </ButtonLink>
          {user === null && (
            <ButtonLink href={ROUTES.register} size="lg" variant="outline">
              Create an account
            </ButtonLink>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {HIGHLIGHTS.map(({ title, description, icon: Icon }) => (
          <Card key={title}>
            <CardHeader>
              <span
                aria-hidden
                className="mb-2 grid size-8 place-items-center rounded-lg bg-muted"
              >
                <Icon className="size-4" />
              </span>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
};

const HIGHLIGHTS: {
  title: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    title: "Search by the window",
    description:
      "Dates, price and party size narrow the catalogue in the address bar, so a search is a link you can send to whoever you are travelling with.",
    icon: CalendarRangeIcon,
  },
  {
    title: "A hold, then a stay",
    description:
      "Booking takes the nights off the calendar for fifteen minutes while you pay. Paid, the stay is confirmed; unpaid, the hold lapses on its own and the nights go back on offer.",
    icon: ClockIcon,
  },
  {
    title: "No double bookings",
    description:
      "Whether the nights are free is decided inside the transaction that locks the listing — the calendar is what it looked like a moment ago, not a promise.",
    icon: ShieldCheckIcon,
  },
];
