import Link from "next/link";
import {
  CalendarRangeIcon,
  ClockIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { ROUTES } from "#shared/config";

/**
 * The one page with nothing to read from the API. What it explains is the rule the rest
 * of the site is built on — a booking is a hold before it is a stay — because that is the
 * thing a visitor is surprised by otherwise, fifteen minutes after they took one.
 */
export const HomePage = () => (
  <div className="flex flex-col gap-12">
    <section className="flex flex-col items-start gap-6">
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        One contract, two sides
      </span>

      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Rooms, dates and guests — settled by the API, not by the screen.
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          Search the catalogue by the window you need, hold the nights while you
          make up your mind, and see every stay you have taken in one place.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={ROUTES.catalogue}
          className={buttonVariants({ size: "lg" })}
        >
          Browse the stays
        </Link>
        <Link
          href={ROUTES.register}
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          Create an account
        </Link>
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
      "Booking takes the nights off the calendar for fifteen minutes. There is nothing to pay with yet, so the hold lapses on its own and they go back on offer.",
    icon: ClockIcon,
  },
  {
    title: "No double bookings",
    description:
      "Whether the nights are free is decided inside the transaction that locks the listing — the calendar is what it looked like a moment ago, not a promise.",
    icon: ShieldCheckIcon,
  },
];
