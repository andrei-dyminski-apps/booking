import { UsersIcon } from "lucide-react";
import { Role, weekdaySchema, type Role as RoleName } from "@repo/contracts";
import { Badge } from "@repo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Separator } from "@repo/ui/components/separator";
import { currentUser, listingsApi } from "#shared/api";
import {
  availabilityTag,
  HOLD_SWEEP_REVALIDATE,
  listingTag,
  ROUTES,
} from "#shared/config";
import {
  addDays,
  formatMoney,
  countOf,
  orNotFound,
  requireId,
  today,
  WEEKDAY_NAMES,
} from "#shared/lib";
import { BackLink, ButtonLink } from "#shared/ui";
import { readListingReviews } from "../api/read-listing-reviews";
import { buildMonths } from "../lib/months";
import { AvailabilityCalendar } from "./availability-calendar";
import { BookingForm } from "./booking-form";
import { ListingReviews } from "./listing-reviews";

/**
 * Three months is what the calendar draws, and the window has to reach the end of the
 * third one from whichever day of the first it starts on. The widest run of three
 * consecutive months is 92 days (Jul + Aug + Sep), and starting later in the month only
 * pushes the window further out, so 92 covers every case — the days before today that it
 * leaves out are drawn as past rather than as free.
 *
 * The API caps the width of a window it will answer about, and this is well inside it.
 */
const CALENDAR_MONTHS = 3;
const CALENDAR_DAYS = 92;

/** How many reviews the listing's screen draws under the summary of all of them. */
const REVIEWS_SHOWN = 10;

/**
 * Why an account that is not a guest has no form. Keyed by the two roles that reach it
 * rather than written as one sentence about owners: an admin is not renting anything out,
 * and being told they are is a screen describing somebody else. A fourth role stops
 * compiling here instead of picking up whichever of the two it was nearest to.
 */
const NOT_A_GUEST: Record<Exclude<RoleName, typeof Role.USER>, string> = {
  [Role.OWNER]: "This account rents listings out instead.",
  [Role.ADMIN]: "This account moderates the site instead.",
};

export const ListingPage = async ({ params }: PageProps<"/listings/[id]">) => {
  const id = requireId((await params).id);
  const from = today();

  // Both listing reads are public, cached under their own URL and tagged separately,
  // because the writes that change them are different: editing a listing does not change
  // who has booked it, and booking it does not touch the row. The availability carries a
  // lifetime as well — a hold lapses on a timer rather than on a mutation.
  //
  // The session is asked for beside them rather than after them: it is the third request
  // this page makes and none of the three needs an answer from the other two, so waiting
  // for the row before asking who is reading it was a round trip spent on nothing. It
  // stays outside the cached pair, and it must — a session attached to a cached request
  // would be handed to whoever asks for the same URL next.
  //
  // The reviews are the third public read, tagged on their own for the same reason, and
  // they sit outside `orNotFound`: a failure of theirs is drawn as a notice in their
  // place rather than taking the page down — see `readListingReviews`.
  const [[listing, availability], reviews, viewer] = await Promise.all([
    orNotFound(
      Promise.all([
        // No lifetime beside the tag, unlike the availability: nothing about the row
        // changes on a timer, so the writes that name this tag are the whole of its
        // invalidation. `false` is how that is spelled — an absent `revalidate` would
        // leave the read uncached and the tag pointing at nothing.
        listingsApi.get(id, {
          next: { revalidate: false, tags: [listingTag(id)] },
        }),
        listingsApi.availability(
          id,
          { from, to: addDays(from, CALENDAR_DAYS) },
          {
            next: {
              revalidate: HOLD_SWEEP_REVALIDATE,
              tags: [availabilityTag(id)],
            },
          },
        ),
      ]),
    ),
    readListingReviews(id, REVIEWS_SHOWN),
    currentUser(),
  ]);

  // The days of the week priced differently from the default, in the order of the week.
  const weekdayPrices = weekdaySchema.options.flatMap((weekday) => {
    const price = listing.pricing.weekdays[weekday];

    return price === undefined ? [] : [{ weekday, price }];
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <BackLink href={ROUTES.catalogue}>All stays</BackLink>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            {listing.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="h-6">
              {formatMoney(listing.pricePerNight)} a night
            </Badge>
            <Badge variant="outline" className="h-6">
              <UsersIcon />
              Sleeps {listing.capacity}
            </Badge>
          </div>
          {(weekdayPrices.length > 0 || listing.pricing.dates.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {weekdayPrices.map(({ weekday, price }) => (
                <Badge key={weekday} variant="outline" className="h-6">
                  {WEEKDAY_NAMES[weekday]} {formatMoney(price)}
                </Badge>
              ))}
              {listing.pricing.dates.length > 0 && (
                <span>
                  {countOf(listing.pricing.dates.length, "date")} priced on
                  their own — the form below counts every night.
                </span>
              )}
            </div>
          )}
          <p className="max-w-2xl text-sm text-muted-foreground">
            {listing.description}
          </p>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">
              Availability
            </h2>
            <p className="text-sm text-muted-foreground">
              The nights already held or booked, for the next three months.
            </p>
          </div>

          <AvailabilityCalendar
            months={buildMonths(
              from,
              CALENDAR_MONTHS,
              availability.booked,
              from,
            )}
          />
        </div>

        {/* Sticky beside a calendar somebody is reading: the form is what they are
            reading it for, and scrolling past it to find the dates again is the one
            thing this screen can spare them. */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Book this listing</CardTitle>
            <CardDescription>
              Whether the nights are free is settled by the API, inside the
              transaction that locks this listing — the calendar beside it is
              what it looked like a moment ago, not a promise.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {viewer === null ? (
              <ButtonLink
                href={`${ROUTES.login}?next=${encodeURIComponent(ROUTES.listing(id))}`}
                className="w-full"
              >
                Sign in to book
              </ButtonLink>
            ) : viewer.role === Role.USER ? (
              <BookingForm
                listingId={listing.id}
                prices={listing}
                earliest={from}
              />
            ) : (
              // The API says the same thing with `@Roles(Role.USER)` on the route: a role
              // is one persona here, and neither an owner renting places out nor an admin
              // moderating them is also a guest.
              <p className="text-sm text-muted-foreground">
                Stays are booked by guests. {NOT_A_GUEST[viewer.role]}
              </p>
            )}
          </CardContent>
        </Card>

        <Separator />

        <ListingReviews
          listingId={listing.id}
          page={reviews}
          moderating={viewer?.role === Role.ADMIN}
        />
      </div>
    </div>
  );
};
