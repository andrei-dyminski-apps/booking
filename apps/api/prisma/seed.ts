import { tz, TZDate } from "@date-fns/tz";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { addDays, format } from "date-fns";
import {
  cents,
  checkInDayEnd,
  quoteStay,
  type PricedListing,
} from "@repo/contracts";
import {
  checkInData,
  stayMoneyData,
} from "../src/booking/infrastructure/stay-rows";
import {
  BookingStatus,
  CancellationPolicy,
  ConversationSide,
  PrismaClient,
  ReviewKind,
  Role,
  Weekday,
} from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Every demo login shares it. Documented in the README — they exist only in this seed. */
const DEMO_PASSWORD = "password123";

/**
 * A guest, a host and an admin to sign in as, plus the accounts that give the filter
 * boxes something to suggest: a second host, so the admin's owner filter has a choice, and
 * three more guests, two of them with the same name — what the address beside a name
 * exists to tell apart for an admin, and what a host sees only by the id. Hosting is not a
 * role: the hosts are users who own listings, and the second one books a stay of the
 * first's as well, so one account has both a Trips and a Hosting side.
 */
const users = {
  guest: {
    name: "Maya Lindqvist",
    email: "guest@example.com",
    role: Role.USER,
  },
  owner: { name: "Tomas Berg", email: "owner@example.com", role: Role.USER },
  admin: { name: "Nora Hale", email: "admin@example.com", role: Role.ADMIN },
  host: { name: "Ines Duarte", email: "ines@example.com", role: Role.USER },
  alex: {
    name: "Alex Morgan",
    email: "alex.morgan@example.com",
    role: Role.USER,
  },
  otherAlex: {
    name: "Alex Morgan",
    email: "amorgan@example.com",
    role: Role.USER,
  },
  sam: { name: "Sam Ortega", email: "sam@example.com", role: Role.USER },
} satisfies Record<string, { name: string; email: string; role: Role }>;

type UserKey = keyof typeof users;

/**
 * Prices are whole cents, as every amount is: 12_000 is a hundred and twenty a night. The
 * owner holds most of the catalogue and the second host the last two listings.
 *
 * `pricePerNightCents` is the default; a few listings carry the exceptions as well — dearer
 * weekends, a cheaper midweek, a few dates priced on their own — so the listing page has
 * a stay whose nights do not all cost the same to quote. The dates are days from the run,
 * for the reason `inDays` below gives. The cancellation policies are spread across the
 * listings, so the listing page and the stays show every schedule but `NON_REFUNDABLE`,
 * which comes with the discount that pays for it: two listings offer the rate beside their
 * own policy, and the stay booked at it is the one that shows the schedule.
 */
const listings: Array<{
  owner: UserKey;
  title: string;
  description: string;
  pricePerNightCents: number;
  capacity: number;
  cancellationPolicy: CancellationPolicy;
  nonRefundableDiscountBps?: number;
  /** Spread over the clock, so the stays show their windows in zones far from UTC. */
  timeZone: string;
  checkInTime: string;
  weekdayPrices?: Partial<Record<Weekday, number>>;
  datePrices?: Array<{ inDays: number; priceCents: number }>;
}> = [
  {
    owner: "owner",
    title: "Loft above the harbour",
    description:
      "Two rooms under the roof, a wall of glass facing the water and a kitchen that fits four.",
    pricePerNightCents: 12_000,
    capacity: 4,
    cancellationPolicy: CancellationPolicy.FLEXIBLE,
    timeZone: "Europe/Lisbon",
    checkInTime: "15:00",
    nonRefundableDiscountBps: 1_000,
    weekdayPrices: { fri: 15_000, sat: 15_000 },
    datePrices: [
      { inDays: 30, priceCents: 19_900 },
      { inDays: 31, priceCents: 19_900 },
    ],
  },
  {
    owner: "owner",
    title: "Cottage at the edge of the pines",
    description:
      "A wood stove, a long table and nothing within earshot but the forest road.",
    pricePerNightCents: 8_500,
    capacity: 6,
    cancellationPolicy: CancellationPolicy.MODERATE,
    timeZone: "Europe/Oslo",
    checkInTime: "16:00",
    weekdayPrices: { mon: 7_000, tue: 7_000, wed: 7_000, thu: 7_000 },
  },
  {
    owner: "owner",
    title: "Studio on the market square",
    description:
      "One room, one window over the awnings, and every tram line within a minute's walk.",
    pricePerNightCents: 5_400,
    capacity: 2,
    cancellationPolicy: CancellationPolicy.FLEXIBLE,
    timeZone: "Europe/Prague",
    checkInTime: "14:00",
  },
  {
    owner: "owner",
    title: "Farmhouse with the long table",
    description:
      "Six bedrooms, a kitchen built for a crowd and a field that ends at the river.",
    pricePerNightCents: 21_000,
    capacity: 12,
    cancellationPolicy: CancellationPolicy.FIRM,
    timeZone: "America/New_York",
    checkInTime: "15:00",
    nonRefundableDiscountBps: 1_500,
  },
  {
    owner: "owner",
    title: "Attic room off the canal",
    description:
      "A bed under the beams, a desk at the window and the water two floors down.",
    pricePerNightCents: 3_900,
    capacity: 1,
    cancellationPolicy: CancellationPolicy.LIMITED,
    timeZone: "Europe/Amsterdam",
    checkInTime: "15:00",
  },
  {
    owner: "owner",
    title: "Beach house on stilts",
    description:
      "A deck facing west, an outdoor shower and sand from the bottom step onwards.",
    pricePerNightCents: 16_500,
    capacity: 8,
    cancellationPolicy: CancellationPolicy.FIRM,
    timeZone: "Pacific/Honolulu",
    checkInTime: "16:00",
    weekdayPrices: { sat: 19_500, sun: 19_500 },
    datePrices: [{ inDays: 45, priceCents: 25_000 }],
  },
  {
    owner: "host",
    title: "Vineyard cottage",
    description:
      "Two rooms at the end of a row of vines, with the press house for a neighbour.",
    pricePerNightCents: 9_800,
    capacity: 3,
    cancellationPolicy: CancellationPolicy.MODERATE,
    timeZone: "Australia/Adelaide",
    checkInTime: "14:00",
  },
  {
    owner: "host",
    title: "Cabin at the tree line",
    description:
      "A stove, a drying rack for boots and the last road before the path takes over.",
    pricePerNightCents: 7_200,
    capacity: 4,
    cancellationPolicy: CancellationPolicy.LIMITED,
    timeZone: "America/Vancouver",
    checkInTime: "15:00",
  },
];

/**
 * Dates are relative to the day the seed runs, not written down: `createBookingSchema`
 * refuses a check-in in the past, and fixed dates would hand the demo data a shelf life
 * after which the API can no longer create what the seed just wrote.
 */
function inDays(days: number): Date {
  return TZDate.tz(
    "UTC",
    format(addDays(TZDate.tz("UTC"), days), "yyyy-MM-dd"),
  );
}

/**
 * A demo stay's money columns, by the `quoteStay` a hold is created with and from the same
 * demo prices the listings are written with — so a seeded stay's nights and amount are the
 * ones the listing page would have quoted for it. Written through `stayMoneyData`, as
 * `create` writes them, so a stay one payment could not carry is refused here too rather
 * than seeded as a booking the API would never take.
 */
function moneyOf(index: number, from: Date, to: Date, nonRefundable = false) {
  const listing = listings[index];

  if (listing === undefined) {
    throw new Error(`No demo listing at index ${index}`);
  }

  const day = (date: Date) => format(date, "yyyy-MM-dd", { in: tz("UTC") });
  const priced: PricedListing = {
    pricePerNightCents: cents(listing.pricePerNightCents),
    pricing: {
      weekdays: Object.fromEntries(
        Object.entries(listing.weekdayPrices ?? {}).map(([weekday, price]) => [
          weekday,
          cents(price),
        ]),
      ),
      dates: (listing.datePrices ?? []).map((entry) => ({
        date: day(inDays(entry.inDays)),
        priceCents: cents(entry.priceCents),
      })),
    },
  };

  const discountBps = nonRefundable
    ? (listing.nonRefundableDiscountBps ?? null)
    : null;

  if (nonRefundable && discountBps === null) {
    throw new Error(`Demo listing ${index} offers no non-refundable rate`);
  }

  return stayMoneyData(quoteStay(priced, day(from), day(to), discountBps));
}

/** The policy a demo stay is frozen under: the rate's, or the listing's own. */
function policyOf(
  listing: { cancellationPolicy: CancellationPolicy },
  nonRefundable = false,
): CancellationPolicy {
  return nonRefundable
    ? CancellationPolicy.NON_REFUNDABLE
    : listing.cancellationPolicy;
}

/**
 * A demo stay's copy of its listing's check-in, written through `checkInData` as `create`
 * writes it.
 */
function checkInOf(
  listing: { timeZone: string; checkInTime: string },
  from: Date,
) {
  return checkInData({
    from: format(from, "yyyy-MM-dd", { in: tz("UTC") }),
    timeZone: listing.timeZone,
    checkInTime: listing.checkInTime,
  });
}

/**
 * Indexes into `listings`; the ids only exist once the rows are written. Several listings
 * are left with no stay at all on purpose: the catalogue's date filter has to have
 * something to keep as well as something to drop. The stays of one listing never overlap
 * — `bookings_no_overlap` would refuse the seed. One is booked at the non-refundable rate,
 * so a stay with a discount and nothing to refund is in the demo too.
 */
const bookings: Array<{
  guest: UserKey;
  listing: number;
  from: Date;
  to: Date;
  nonRefundable?: boolean;
}> = [
  { guest: "guest", listing: 0, from: inDays(10), to: inDays(14) },
  {
    guest: "guest",
    listing: 0,
    from: inDays(19),
    to: inDays(21),
    nonRefundable: true,
  },
  { guest: "guest", listing: 1, from: inDays(12), to: inDays(16) },
  { guest: "guest", listing: 2, from: inDays(40), to: inDays(53) },
  { guest: "guest", listing: 3, from: inDays(5), to: inDays(9) },
  { guest: "guest", listing: 6, from: inDays(30), to: inDays(37) },
  { guest: "alex", listing: 1, from: inDays(20), to: inDays(23) },
  { guest: "otherAlex", listing: 2, from: inDays(8), to: inDays(11) },
  { guest: "sam", listing: 3, from: inDays(15), to: inDays(18) },
  { guest: "sam", listing: 7, from: inDays(25), to: inDays(28) },
  { guest: "host", listing: 2, from: inDays(25), to: inDays(29) },
];

/**
 * Ranges waited for, each over nights a stay above already holds — the API refuses an
 * entry for free nights, and one on the waiter's own listing. Three are the demo guest's,
 * one matching a stay exactly and one only overlapping it, so "Trips" opens with the
 * section filled. Sam waits for nights of the demo guest's, so cancelling that trip is
 * what sends the `WAITLIST_AVAILABLE` notice.
 */
const waitlist: Array<{
  user: UserKey;
  listing: number;
  from: Date;
  to: Date;
}> = [
  { user: "guest", listing: 1, from: inDays(20), to: inDays(23) },
  { user: "guest", listing: 3, from: inDays(14), to: inDays(17) },
  { user: "guest", listing: 7, from: inDays(25), to: inDays(28) },
  { user: "sam", listing: 0, from: inDays(10), to: inDays(14) },
  { user: "alex", listing: 6, from: inDays(32), to: inDays(35) },
];

/**
 * Stays of the demo guest that are over, so the reviews have something to be about — the API books nothing
 * in the past, which is why only the seed can write these. Each says which halves were
 * reviewed: one is reviewed by both sides, one by the guest alone and one by nobody, so
 * the demo guest and the demo owner each have a form left to fill in.
 */
const pastStays = [
  {
    listing: 0,
    from: inDays(-40),
    to: inDays(-36),
    byGuest: {
      rating: 5,
      comment:
        "The light off the water in the morning is worth the stairs. Spotless, and the kitchen really does fit four.",
    },
    byOwner: {
      rating: 5,
      comment:
        "Left the loft as they found it and kept to the check-out time. Welcome back any time.",
    },
  },
  {
    listing: 1,
    from: inDays(-25),
    to: inDays(-21),
    byGuest: {
      rating: 4,
      comment:
        "Exactly the quiet we came for. The stove takes some getting used to, the forest does not.",
    },
    byOwner: null,
  },
  {
    listing: 2,
    from: inDays(-9),
    to: inDays(-6),
    byGuest: null,
    byOwner: null,
  },
];

/**
 * Two threads about the guest's stays at the owner's listings, written as a short exchange
 * each. The last one is the guest's and the host has not opened it, so the owner's list
 * starts with something unread and the guest's with nothing.
 */
const conversations: Array<{
  guest: UserKey;
  listing: number;
  messages: Array<{ sender: ConversationSide; body: string }>;
}> = [
  {
    guest: "guest",
    listing: 0,
    messages: [
      {
        sender: ConversationSide.GUEST,
        body: "Hi! Is early check-in possible?",
      },
      {
        sender: ConversationSide.HOST,
        body: "Usually from noon — I will confirm the day before.",
      },
    ],
  },
  {
    guest: "guest",
    listing: 2,
    messages: [
      {
        sender: ConversationSide.GUEST,
        body: "Is there a place to leave bicycles?",
      },
    ],
  },
];

const MS_PER_MINUTE = 60_000;

async function main(): Promise<void> {
  // Order matters, and both steps are refusals rather than cascades: bookings reference
  // listings with onDelete: Restrict, and listings reference their owner the same way, so
  // deleting the users first fails on the foreign key instead of taking the rows with it.
  // Deleting the users does take their refresh tokens (onDelete: Cascade), so a re-seed
  // ends every session issued against the previous data. Conversations restrict their
  // listing like a booking does, and take their messages with them.
  // Reviews would go with their bookings anyway (onDelete: Cascade); deleting them first
  // keeps the order readable as the dependency it is.
  await prisma.review.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.user.deleteMany();

  // One hash for every account: argon2 is deliberately slow, and the demo password is the same.
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
  });

  const created = await Promise.all(
    Object.values(users).map((user) =>
      prisma.user.create({ data: { ...user, passwordHash } }),
    ),
  );

  // Found by the address, the one unique column a demo account is written with.
  const idOf = (key: UserKey): string => {
    const row = created.find((user) => user.email === users[key].email);

    if (row === undefined) {
      throw new Error(`The demo account "${key}" was not written`);
    }

    return row.id;
  };

  const rooms = await Promise.all(
    listings.map(({ owner, weekdayPrices = {}, datePrices = [], ...listing }) =>
      prisma.listing.create({
        data: {
          ...listing,
          ownerId: idOf(owner),
          weekdayPrices: {
            create: Object.values(Weekday).flatMap((weekday) => {
              const priceCents = weekdayPrices[weekday];

              return priceCents === undefined ? [] : [{ weekday, priceCents }];
            }),
          },
          datePrices: {
            create: datePrices.map((entry) => ({
              date: inDays(entry.inDays),
              priceCents: entry.priceCents,
            })),
          },
        },
      }),
    ),
  );

  // One `create` per stay rather than a `createMany`, which writes no nested rows — and
  // the nights are one. In turn rather than at once, so the stays are written in the order
  // they are listed and every seed orders them by `created_at` the same way.
  for (const booking of bookings) {
    const listing = rooms[booking.listing];

    if (listing === undefined) {
      throw new Error(`No demo listing at index ${booking.listing}`);
    }

    await prisma.booking.create({
      data: {
        listingId: listing.id,
        guestId: idOf(booking.guest),
        from: booking.from,
        to: booking.to,
        ...moneyOf(
          booking.listing,
          booking.from,
          booking.to,
          booking.nonRefundable,
        ),
        cancellationPolicy: policyOf(listing, booking.nonRefundable),
        ...checkInOf(listing, booking.from),
        // Confirmed, not holds: a PENDING_PAYMENT booking would lapse 15 minutes after
        // the seed runs and disappear from the demo.
        status: BookingStatus.CONFIRMED,
      },
    });
  }

  await prisma.waitlistEntry.createMany({
    data: waitlist.map((entry) => {
      const listing = rooms[entry.listing];

      if (listing === undefined) {
        throw new Error(`No demo listing at index ${entry.listing}`);
      }

      return {
        listingId: listing.id,
        userId: idOf(entry.user),
        from: entry.from,
        to: entry.to,
        checkInDayEndsAt: checkInDayEnd(
          listing,
          format(entry.from, "yyyy-MM-dd", { in: tz("UTC") }),
        ),
      };
    }),
  });

  for (const past of pastStays) {
    const listing = rooms[past.listing];

    if (listing === undefined) {
      throw new Error(`No demo listing at index ${past.listing}`);
    }

    const booking = await prisma.booking.create({
      data: {
        listingId: listing.id,
        guestId: idOf("guest"),
        from: past.from,
        to: past.to,
        ...moneyOf(past.listing, past.from, past.to),
        cancellationPolicy: listing.cancellationPolicy,
        ...checkInOf(listing, past.from),
        status: BookingStatus.CONFIRMED,
      },
    });

    const reviews = [
      past.byGuest === null
        ? null
        : { kind: ReviewKind.LISTING, ...past.byGuest },
      past.byOwner === null
        ? null
        : { kind: ReviewKind.GUEST, ...past.byOwner },
    ].filter((review) => review !== null);

    await prisma.review.createMany({
      data: reviews.map((review) => ({ ...review, bookingId: booking.id })),
    });
  }

  // One minute between messages, oldest first, so the threads read in the order written.
  let minutesAgo = conversations.reduce(
    (total, conversation) => total + conversation.messages.length,
    0,
  );

  for (const conversation of conversations) {
    const listing = rooms[conversation.listing];

    if (listing === undefined) {
      throw new Error(`No demo listing at index ${conversation.listing}`);
    }

    const messages = conversation.messages.map((message) => ({
      ...message,
      createdAt: new Date(Date.now() - minutesAgo-- * MS_PER_MINUTE),
    }));
    const first = messages.at(0);
    const last = messages.at(-1);

    if (first === undefined || last === undefined) {
      throw new Error("A demo conversation needs at least one message");
    }

    const lastBy = (sender: ConversationSide): Date | null =>
      messages.findLast((message) => message.sender === sender)?.createdAt ??
      null;

    await prisma.conversation.create({
      data: {
        listingId: listing.id,
        guestId: idOf(conversation.guest),
        // A thread is opened by its first message, so it is as old as that one.
        createdAt: first.createdAt,
        lastMessageAt: last.createdAt,
        lastMessageBody: last.body,
        lastMessageSender: last.sender,
        guestReadAt: last.createdAt,
        hostReadAt: lastBy(ConversationSide.HOST),
        messages: { create: messages },
      },
    });
  }

  console.log(
    `Seeded users: ${Object.values(users)
      .map((user) => `${user.name} <${user.email}>`)
      .join(", ")} — password "${DEMO_PASSWORD}"`,
  );
  console.log(
    `Seeded listings: ${listings.length}, bookings: ${bookings.length + pastStays.length} (${pastStays.length} of them over, some reviewed), conversations: ${conversations.length}, waitlist entries: ${waitlist.length}`,
  );
}

void main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
