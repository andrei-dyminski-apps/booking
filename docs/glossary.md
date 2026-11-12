# Glossary

The concepts of the booking service: who the actors are, how a stay moves from a hold to a
payout, where the money goes, and how the system keeps itself correct. It explains what a word
_means here_; the rules built on it live in the documents linked at the end.

Terms are grouped by topic and alphabetical inside a group. `code` names are real identifiers
(an enum value, a constant, a route), so they can be searched for.

- [Actors and domain](#actors-and-domain)
- [Stay lifecycle](#stay-lifecycle)
- [Money](#money)
- [Cancellations and fees](#cancellations-and-fees)
- [Payments and payouts](#payments-and-payouts)
- [How the system stays correct](#how-the-system-stays-correct)
- [Access and visibility](#access-and-visibility)
- [Notifications and live updates](#notifications-and-live-updates)
- [Architecture](#architecture)
- [Reference tables](#reference-tables)

## Actors and domain

**Admin** — an account with the role `ADMIN`. Manages accounts, removes reviews, cancels any
stay (with a full refund) and acts on whatever the money flows gave up on. An admin is not a side
of any conversation, and an admin account cannot be blocked.

**Catalogue** — the public, filterable list of listings that are on offer. Its filters live in the
URL, so a filtered catalogue is a link somebody can send.

**Conversation** — one message thread per guest and listing. Its host is whoever owns the listing.
Only a guest writes first; after that either side replies. A thread shows the name of both people
and the address of neither. A retired listing does not close the thread.

**Demand** — the date ranges people are waiting for on a host's listings. A host sees the dates
only; an admin also sees who waits.

**Guest** — whoever booked a stay. Not a role: any user is a guest of some stays and the host of
others.

**Host** — whoever owns a listing. Not a role either: every rule about "the host" follows the
listing's owner. Any user may publish a listing; nobody may book their own.

**Listing** — a place to stay: title, description, nightly price, capacity and a cancellation
policy. Belongs to one owner.

**Nightly price** — a default plus exceptions. A night costs the price of its date if there is one,
else the price of its weekday, else the listing's default. The same rule prices the quote on the
listing page and the hold on the server.

**Retired listing** — a listing its owner took down. It leaves the catalogue and the dashboard,
answers "not found" by id and cannot be booked, but it is not erased: stays already taken keep
naming where they happened, and their reviews and threads stay.

**Review** — what one side of a finished stay said about the other: 1 to 5 stars and a comment. One
review of each kind per stay.

- The guest's review of the place (`LISTING`) is public, on the listing's page.
- The host's review of the guest (`GUEST`) is read only by that guest, by hosts the guest has a live
  hold or a confirmed stay with, and by an admin.
- Nothing on a review names its author: the kind says which side wrote it.
- A stay opens for review once it is `CONFIRMED` and its check-out day has come.

**Role** — `USER` or `ADMIN`; nothing else. Registration always creates a `USER`, and the API
changes no role: an admin account is made outside it (the seed writes the demo admin).

**Side** — which half of a relationship the caller is on. For stays, `GUEST` (their trips) or
`HOST` (stays taken against their listings). For conversations, the same two, decided by the
account rather than the role.

**Trips / Hosting** — the two halves of the stays screen for a user. An admin sees every stay.

**Waitlist** — a user's wish to hear when held nights come free. An entry holds nothing: it never
blocks a booking. When nights are freed, everybody waiting for a range that is now free as a whole
is told at once (`WAITLIST_AVAILABLE`) and their entry is removed; whoever books first takes the
nights. The service never books for a waiter, because an unattended hold would lapse and block the
nights for everybody. At most 20 entries per account.

## Stay lifecycle

**Active booking** — a booking in `PENDING_PAYMENT` or `CONFIRMED`: the only ones that occupy
nights. `CANCELLED` and `EXPIRED` are terminal, free the nights at once and keep their record.

**Availability** — the date ranges of a listing that are already taken, shown on the calendar. It
only informs; the decision to refuse a booking is made when the hold is taken.

**Check-in / check-out** — the first and last day of a stay. Check-out is exclusive: a stay from
the 1st to the 4th occupies three nights. Check-out must be later than check-in, and check-in may
not be in the past where the listing is: a day before the listing's today in its time zone is
refused, whatever day it is in UTC.

**Check-in time / time zone** — a listing names where it is (an IANA zone such as
`Europe/Berlin`) and when a guest may arrive (`HH:mm` on that clock); every booking copies both
when it is taken, like its policy. Listings and stays from before them carry `UTC` / `00:00`.

**Concurrent booking** — how two guests are kept from the same nights, in three layers: the request
that takes the nights first locks the listing, so competing requests queue and the second gets an
honest `409`; the database itself refuses two overlapping active stays, so even a bug in the code
cannot write them; and a timed job plus a sweep release holds that were never paid.

**Half-open range** — a stay includes its check-in day and excludes its check-out day. That is why
back-to-back stays (check-out the day the next guest checks in) are legal. The booking check, the
catalogue's date filter and the stays list all read the range the same way, so they cannot
disagree about what "taken" means.

**Hold** — a booking in `PENDING_PAYMENT`: it reserves the nights for 15 minutes (`expiresAt`)
while the guest pays. A hold past its deadline holds nothing, even before the job that releases it
has run.

**Lapsed hold** — a hold whose deadline has passed. It is released (`EXPIRED`) by a timed job, by a
sweep, or by the next booking of that listing — whichever comes first — and both sides are told.

**Night** — one date of a stay with the price it cost when the hold was quoted. A stay's total is
the sum of its nights; a later price change restates nothing.

**Quote** — pricing a stay. Done by the server at the moment the hold is taken; nothing about money
is ever read from a request. If the listing changed since the guest saw it, the booking is refused
with `412` instead of charging a price or freezing a policy they never read.

**Slot** — the nights of a listing that a booking occupies.

**Stay** — the user-facing word for a booking: a guest's reservation of one listing for a date
range. "Stay" and "booking" are the same thing.

## Money

**Basis points (bps)** — hundredths of a percent; `10_000` is 100%. Every rate is in basis points,
never a fraction: the platform fee is 1 500 bps (15%), half a refund is 5 000.

**Cents** — the only unit of money. Every price and amount is a whole number of cents and says so
in its name (`amountCents`), so sums are exact and nothing between the database and the payment
provider converts. Turning cents into a label is the interface's job alone.

**Charge limits** — a stay costs between the payment provider's floor and ceiling for one charge
(`MIN_CHARGE`, `MAX_CHARGE`, after any discount); a quote outside them is refused with `422`,
and the booking form says so before the press (`chargeRefusal`).

**Currency** — stored with every booking, so a record of money says what it was paid in. Payments
and transfers are made in the stay's own currency.

**Host share** — what the host earns from a stay: the payment less refunds, less the platform fee,
rounded half up once. The platform keeps the rest, so no cent is lost or invented.

**Platform fee** — the platform's cut of the host's share, `PLATFORM_FEE_BPS` (15%). Not to be
confused with the [host fee](#cancellations-and-fees), which is a penalty.

**Price ceiling** — the highest price the contract accepts (`MAX_PRICE`); chosen so a night at the
ceiling can still be paid for.

## Cancellations and fees

**Canceller** — who cancelled a stay: `GUEST`, `HOST` or `ADMIN`. The relation comes before the
role: a guest or host made admin outside the API after booking or listing still cancels their own
stay as its guest or host; `ADMIN` is the role acting on somebody else's stay. Everybody who may
read a stay may cancel it, each on their own terms.

**Cancellation policy** — the refund schedule a host picks for a listing. A booking copies the
policy's _name_ when the hold is taken, so a later change to the listing restates no stay already
made. The table is the contract's `CANCELLATION_TERMS`; the API refunds by it and the pages state
it.

| Policy           | Full refund until        | Partial refund            |
| ---------------- | ------------------------ | ------------------------- |
| `FLEXIBLE`       | 48 hours before check-in | —                         |
| `MODERATE`       | 5 days before            | —                         |
| `LIMITED`        | 14 days before           | half, until 7 days before |
| `FIRM`           | 30 days before           | half, until 7 days before |
| `NON_REFUNDABLE` | never (no grace period)  | —                         |

A row of that table is never edited once a booking can carry it; new terms are a new policy
(`FIRM_V2`), and the old one stays for the stays already taken under it.

**Cancellation answer vs refund** — a cancellation is final the moment it is answered. The refund
follows it: the amount owed is written on the booking, and a job sends it afterwards.

**Cancellation reason** — free text a host must give when cancelling. Stored with who cancelled
and when, and carried to the other side in the notice.

**Check-in instant** — the moment a stay begins: its check-in day at the check-in time in the
listing's time zone. Refund windows, the host's fee and the payout are measured from it. Neither a
guest nor a host nor an admin may cancel a stay once it has come, and a stay can be ended early only
from it on — "tonight" being the listing's night.

**Grace period** — a full refund within 24 hours of booking, provided check-in is more than 7 days
away. Every policy but `NON_REFUNDABLE` has it.

**Host cancellation** — a host cancelling a paid stay. Requires a reason, refunds the guest in full
under any policy and creates a [host fee](#cancellations-and-fees).

**Host fee** — what a host owes for cancelling a paid stay, one per stay: 10% of what the
cancellation refunds if more than 30 days before check-in, 25% if more than 48 hours before, 50%
after that. Nothing for a hold, an unpaid stay, a stay already refunded in full, or one whose
dispute was lost.

**Host fee threshold** — from the third counted cancellation within a year every admin is told. A
waived fee is not counted: the waiver says the cancellation was not the host's doing.

**Refund quote** — the rule that decides how much a cancellation gives back: the policy's share of
the window the cancellation falls in, or everything within the grace period, less what was already
refunded. A host's or an admin's cancellation refunds whatever is left, always. It lives in the
shared contract because the booking page states it to the guest before the API applies it.

**Waiver** — an admin forgiving what is still owed of a host fee, with a reason. What was already
withheld stays withheld.

**Withholding** — how host fees are collected. Nothing of a cancelled stay was ever paid to the
host, so the fee is not debited: it is kept back from their next payouts, oldest fee first. A
payout the fees take whole sends no transfer. A fee nobody can withhold (a host who never earns
again) stays owed on the admin's screen; the platform does not charge a host's card. If a later
refund exceeds what the transfer holds, the shortfall goes back as debt onto the fees that payout
was kept back for.

## Payments and payouts

**Charge** — the card payment behind a PaymentIntent. The host's transfer is funded by it.

**Connected account** — the Stripe account a host is paid out to. Opened the first time the host
sets up payouts on `/dashboard/payouts` (Stripe's embedded onboarding) and never replaced. Until it
can receive transfers, the host's listings take bookings as usual and the payouts wait.

**Dispute** — a chargeback. It moves forward only: `OPEN`, then `WON` or `LOST`. While open,
nothing is paid out and the payment cannot be refunded. A lost dispute takes back a payout already
sent and cancels a stay that has not begun; a won one lets the payout go.

**Idempotency key** — a name sent with every write to the payment provider (such as
`booking-<id>-payment`), so a retry is the same request, not a second one. The provider forgets keys
after 24 hours, so refunds and transfers are also looked up by their own identifiers before being
sent.

**Late payment** — a payment that completes after its hold was released. It reaches nights that
are no longer the guest's and is refunded in full automatically.

**Payment flow** — the server prices the stay; the guest pays on the stay's own page through
Stripe's payment form (card details go to Stripe and never through this site); the provider's
webhook confirms the stay. The browser's own "success" only starts waiting for the status to move.

**PaymentIntent** — the provider's object for one payment. One per hold, opened on request under a
key named after the booking, so a reload gets the same one. A hold that lapses or is cancelled gets
its intent withdrawn.

**Payment methods offered** — only methods that confirm at once, because one that stays
`processing` for days would outlive the 15-minute hold.

**Payout** — the transfer of the host's share to their connected account, due 24 hours after
the check-in instant. A timed job per stay sends it when due and an hourly sweep sends whatever
the jobs missed. A refund after the payout takes the host's share of it back by a reversal.

**Payout reservation** — what a payout means to send, fixed before the transfer under a lock on the
host, so no transaction stays open across the call to the provider and two stays of one host cannot
keep back the same fee. A reservation is released when the payout cannot go out (set aside, account
lapsed, dispute open), and a retry of one reservation sends the same amount.

**Refund** — money returned to the guest. Sent by a job after a cancellation, retried by a sweep
until it goes through. A refund made in the provider's dashboard reaches the stay too: a full one
cancels a stay not yet begun, a partial one tells the guest.

**Refund failure** — a refund the guest's bank sent back. Kept on record, and every admin is told.
Re-sending would be refused by the same card, so an admin sends the money back some other way and
records how.

**Separate charges and transfers** — the marketplace pattern used here: the guest pays the
platform, and the host is paid by a separate transfer funded by that charge.

**Settle** — the one place that takes money back from a host. It compares what the host holds with
what is owed now and reverses the difference.

**Webhook** — the payment provider calling the service with its news: payments, refunds, disputes,
and the state of hosts' accounts. Verified, recorded, answered `200` at once, and handled afterwards
by a worker. See [Inbox](#how-the-system-stays-correct).

## How the system stays correct

**At most once / at least once** — delivery guarantees. A notice is _at most once_: the write that
triggers it commits first, and a crash in between loses it. Webhooks are _at least once_, which is
why every handler must tolerate repeats.

**Idempotent** — safe to run twice with the effect of running once. Payment confirmation, refunds,
transfers and every webhook handler are written this way, which is what makes retrying safe.

**Inbox** — the pattern behind the webhooks: every delivery is stored first, keyed by the
provider's event id, so a repeat delivery records nothing; a worker handles it afterwards and marks
it processed; a sweep re-queues what a lost job left; and processed events are pruned after 90
days.

**Job and sweep** — background work comes in two halves. A _job_ does one thing at its due moment (release this
hold, pay this stay, handle this event). A _sweep_ runs on a timer and catches what jobs missed
(every minute for holds, events and owed refunds; hourly for payouts). The queue lives in memory
and a restart drops scheduled jobs, so the sweep is what makes scheduling allowed to fail without
failing the request that created the booking.

**Lease** — a deadline on a booking marking that someone is working on it: one for a cancellation
(with its refund and the payment news), one for a settlement or a payout transfer. Used instead of a
held database transaction because the work under it calls the payment provider. Renewed while the
work runs; if it is taken, a user gets a `409` and a job or event retries later without counting a
failure.

**Retry limits** — a webhook event is retried up to 24 times, an owed refund 30, a payout 24, then
it is set aside.

**Set aside / stuck** — what a money flow gives up on after its retry limit. The row is stamped, the
sweep leaves it alone and every admin is told. Admins work through three lists on `/admin/payments`:
failed webhook events, bounced refunds and stuck stays (refunds or payouts). A retry clears the
stamp and the counter, hands the row back and queues it at once; it is refused with `409` if the
money is no longer owed.

**Provider news is ordered by nobody** — the payment provider does not deliver events in order. A
refund or dispute that arrives before the payment's own news is retried, not read as news about a
payment that never confirmed a stay.

## Access and visibility

**Access and refresh tokens** — a session is a pair. The access token is short-lived (15 minutes)
and cannot be revoked before it expires; the refresh token lives a week and is revocable. Both live
only in cookies the page's scripts cannot read, never in a response body.

**Blocking** — what an admin does instead of deleting an account. It ends every session at once
(login answers `403`, refresh fails) and the access token already in a browser lapses within its
lifetime. Nothing is deleted, so stays and listings keep their history. An admin cannot block
themselves.

**Ownership check vs role check** — two different questions. The role check asks "may this kind of
user call this endpoint at all" and is answered from the token alone. The ownership check asks "does
this row belong to the caller" and can only be answered once the row is read. `403` from the first
means "not your kind of endpoint"; `403` from the second means "not your row".

**Public routes** — the catalogue's three reads and a listing's reviews. Everything else is closed
until a session is present: a new route is protected by default.

**Rotation with reuse detection** — every refresh burns the token it was given and issues the next
in the same family. A burned token that comes back means a copy exists somewhere, so the whole family
is revoked and the real user logs in again.

**Role is a set, not a hierarchy** — an `ADMIN` does not pass a check for `USER` by being senior. A
route admins may use names `ADMIN` itself. The one place a hierarchy exists is ownership, where an
admin passes without owning anything.

**Scope** — what a caller may see in a list, decided by their role (and `side`) inside the query
itself, never by a parameter the client could widen. A filter narrows a scope and can never reach
around it, so the worst a filter can do is return nothing.

**Session recovery** — an expired access token is not a signed-out user. The shell spends one
refresh per visit, and the login page one before showing a form, then sends the visitor on to where
they were going.

**Throttling** — requests are rate limited per address: 120 a minute overall, 10 on sign-up and
sign-in (which answer a guess), 600 on the public catalogue reads.

**`403` vs `404`** — a refusal is `403` when the caller could have found the row anyway (a listing in
the shared catalogue) and `404` when a `403` would reveal that an id exists (a booking, a
conversation, a guest's reviews).

## Notifications and live updates

**Event stream** — the one channel the API pushes through: a single connection per browser, opened
with a snapshot of the unread counts. The server ends it after five minutes so a block or an expiry
reaches an open tab at the reconnect.

**Lookup** — the suggestions behind an id filter box (owners, hosts, guests, listings), matched by
part of a name or by a whole id, limited to what the caller may see. A guest's address is never
offered to a host.

**Message vs notification** — a chat message is not a notification. A thread holds its own unread
state, and a notice per message would bury bookings and reviews on the bell.

**Notification** — a record of something that happened which one account should hear about, written
first and then announced on the stream. It is a copy of what was true at the time (a title, the
dates), so what the recipient was told stays what they were told after the listing is renamed or
retired. Telling never fails the action that caused it. What only a person can put right goes to
every admin.

**Read marker** — each side of a conversation has its own. A thread is unread for a side while its
newest message is later than that side's marker. Marking read names the newest message the screen
showed, so a message written meanwhile stays news.

**Unread count** — notifications and conversations unread, counted together and always as an
absolute number, never a delta, so a tab that missed an event is corrected by the next one.

## Architecture

**Two applications, one contract** — `apps/web` (the interface) and `apps/api` (the rules and the
money) never import each other. They talk over HTTP, and the shape of every request and response is
a schema in `@repo/contracts`, written once and used for validation on the server, for forms in the
browser and for the types on both sides. Rules both sides apply live there too: pricing a night,
quoting a refund, a host's share, a host's cancellation fee, when a stay opens for review.

**BFF (backend for frontend)** — the browser never calls the API directly. It calls `/api/...` on
the frontend's own origin and a proxy there forwards the request and re-issues the session cookies
for that origin. The session is therefore first-party wherever the two services are deployed, and a
preview deployment can be pointed at any API and still sign in.

**Cached public reads, uncached personal ones** — only reads that are the same for every visitor
(the catalogue, one listing, its availability, its reviews) are cached, under their URL and tagged,
and a mutation invalidates the tags it changed. Everything personal is read fresh and never cached.

**Domain modules and the direction of dependency** — the money is split in three: `payment` is the
provider's front door and knows no stay; `booking` is the stays; `payout` is the host's share. They
depend one way: `payment` ← `booking` ← `payout`. What `payment` hears is handed to whoever
registered to act on it, and what `booking` has to tell `payout` goes through a registry that is
awaited, not an event bus, so a failure is retried.

**Entry points into one set of rules** — the same booking rules are reached by an HTTP request, a
provider's webhook and a timed job. That is why the money modules have an application layer between
the entry points and the storage.

**Feature-Sliced Design (FSD)** — how the interface is organised: layers that may only import
downwards, from the shell and the screens, through user actions and business entities, to shared
code with no business knowledge. Routes are one-line pointers into the screens.

**Filters live in the URL** — every list's filters, ordering and page are the address. A filtered
view is a link; what is applied is spelled out as chips, each a link to the same search without
that filter.

**Pages by "after this row"** — lists are paged from a bookmark naming the row a page ended on, not
by a page number, so a row inserted while somebody is paging shifts nothing. A bookmark names a
place in one ordering only; one the API did not issue, or one carried to another ordering, is
refused rather than silently answered with a first page.

**Port and adapter** — the seam for an _external service_, not for the database: the payment
provider sits behind an interface, so everything above it can be tested against a stand-in, and the
whole payment cycle can be exercised with the provider mocked.

**Shell** — the frame around every screen: navigation, the session, the bell with unread counts.
It reads the session once for the whole frame.

## Reference tables

### Booking status

| Status            | Meaning                                                    | Active (holds the slot) |
| ----------------- | ---------------------------------------------------------- | ----------------------- |
| `PENDING_PAYMENT` | a hold: 15 minutes to pay                                  | yes                     |
| `CONFIRMED`       | paid; the provider's webhook said the money arrived        | yes                     |
| `CANCELLED`       | cancelled by the guest, the host, an admin or the provider | no                      |
| `EXPIRED`         | the hold lapsed unpaid                                     | no                      |

The status reports the stored value, not the clock: for up to a minute (the sweep interval) a
lapsed hold is still `PENDING_PAYMENT` even though its slot is already free.

### Other enums

| Enum               | Values                                            |
| ------------------ | ------------------------------------------------- |
| `Role`             | `USER`, `ADMIN`                                   |
| `Canceller`        | `GUEST`, `HOST`, `ADMIN`                          |
| `ConversationSide` | `GUEST`, `HOST`                                   |
| `ReviewKind`       | `LISTING` (guest → place), `GUEST` (host → guest) |
| `DisputeStatus`    | `OPEN`, `WON`, `LOST`                             |

### Notification types

| Type                           | Who is told                  | About                                                   |
| ------------------------------ | ---------------------------- | ------------------------------------------------------- |
| `BOOKING_REQUESTED`            | the host                     | a hold taken on their listing                           |
| `BOOKING_CONFIRMED`            | both sides                   | the payment confirmed the stay                          |
| `BOOKING_CANCELLED`            | the side that did not cancel | a cancellation, with the canceller and reason           |
| `BOOKING_EXPIRED`              | both sides                   | an unpaid hold lapsed                                   |
| `STAY_ENDED_EARLY`             | the side that did not end it | a stay ended early, the new check-out and the refund    |
| `PAYMENT_REFUNDED`             | the guest                    | a late payment refunded, or a refund from the dashboard |
| `PAYMENT_DISPUTED`             | the host                     | a dispute opened on a payment                           |
| `PAYOUT_SENT`                  | the host                     | a transfer went out                                     |
| `HOST_CANCELLATION_FEE`        | the host                     | a fee owed for cancelling a paid stay                   |
| `REVIEW_RECEIVED`              | the side reviewed            | a review of a finished stay                             |
| `WAITLIST_AVAILABLE`           | the waiter                   | nights they waited for are free                         |
| `REFUND_FAILED`                | every admin                  | a guest's bank sent a refund back                       |
| `PAYMENT_EVENT_FAILED`         | every admin                  | a webhook event was set aside                           |
| `CANCELLATION_REFUND_FAILED`   | every admin                  | a cancellation's or an early end's refund set aside     |
| `PAYOUT_FAILED`                | every admin                  | a payout was set aside                                  |
| `PAYOUT_SHORTFALL`             | every admin                  | a transfer recorded for less than was reserved          |
| `HOST_CANCELLATIONS_THRESHOLD` | every admin                  | a host's third counted cancellation within a year       |

### Limits and constants

| Constant                         | Value           | Where it matters                               |
| -------------------------------- | --------------- | ---------------------------------------------- |
| Hold length                      | 15 minutes      | `expiresAt` of a `PENDING_PAYMENT` booking     |
| `GRACE_PERIOD_HOURS`             | 24              | full refund within a day of booking            |
| `GRACE_MIN_LEAD_HOURS`           | 7 days          | grace applies only if check-in is further away |
| `PLATFORM_FEE_BPS`               | 1 500 (15%)     | taken from the host's share                    |
| `PAYOUT_DELAY_HOURS`             | 24              | after the check-in instant                     |
| `HOST_CANCELLATIONS_THRESHOLD`   | 3               | counted cancellations within a year            |
| `HOST_CANCELLATIONS_WINDOW_DAYS` | 365             | the window those are counted in                |
| `MAX_WAITLIST_ENTRIES`           | 20              | per account                                    |
| `MIN_RATING` / `MAX_RATING`      | 1 / 5           | review stars                                   |
| `MAX_EVENT_ATTEMPTS`             | 24              | before a webhook event is set aside            |
| `MAX_REFUND_ATTEMPTS`            | 30              | before an owed refund is set aside             |
| `MAX_PAYOUT_ATTEMPTS`            | 24              | before a payout is set aside                   |
| `EVENT_RETENTION_DAYS`           | 90              | processed events are pruned after this         |
| Access / refresh token lifetime  | 15 min / 7 days | how long each half of a session lasts          |

## Where the rules are written

- [`README.md`](../README.md) — endpoints, payments, authentication, roles
- [`apps/api/CLAUDE.md`](../apps/api/CLAUDE.md) — backend conventions and the reasoning behind them
- [`apps/web/CLAUDE.md`](../apps/web/CLAUDE.md) — frontend conventions and FSD
- [`packages/contracts`](../packages/contracts) — the rules both sides share
- [`docs/plan.md`](plan.md) — the roadmap
