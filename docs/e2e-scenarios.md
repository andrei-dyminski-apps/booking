# Frontend e2e scenarios

The scenarios of the browser suite of phase 11 (`docs/plan.md`), by priority. Each one is
written as a goal a visitor sets out to reach, and what they do and see on the way; how the
suite makes it possible is the plan's and the code's business.

Every scenario listed here is in the suite, and a tick means it is written and green. Only
the main path of each is listed: its edge cases are proven by the API's e2e specs, the
contract's Vitest suite and the frontend's own specs, so none of them belongs here.

## Rules every scenario follows

- **It arranges what it needs itself** — its own listing and stay, and its own account
  whenever it changes the account — and relies on nothing another test left behind. A retry
  starts from the same place as the first attempt.
- **The demo accounts are only signed in to.** They are shared, so a scenario never changes
  one, and what it compares — a count of notices, of unread messages — is compared with what
  it was before the scenario's own step, never with a fixed number. A scenario that registers
  or blocks an account uses one it registered itself, new on every attempt.
- **Two people at once are two browsers**, each signed in as a different user.
- **Money goes through the pages.** State a scenario should not click its way to is
  arranged beforehand; a payment never is.

## How to read a scenario

- **Runs on** — **every target** is the hermetic stack, real Stripe on the local stack and
  the live deployment; **hermetic only** is the hermetic stack alone, because what the
  scenario needs cannot exist on the deployment (an account registered there can never be
  deleted, the admin is not the suite's to use, a second guest is not among the two accounts
  the suite has there) or what it proves the hermetic run proves already; **real Stripe
  only** is the local stack with Stripe's side real, because what the scenario proves is
  that Stripe accepts what the application sends.
- **Cost** — a note for planning the work, not for reading the goal: **cheap** is plain pages
  and forms; **medium** needs a second browser context or state arranged beforehand;
  **expensive** needs the payment or a queue.

## Priority 1 — the application does not work without these

- [ ] **Register.** A new visitor fills in the form and lands signed in under their own name.
      _Hermetic only. Cheap._
- [ ] **Sign in and out.** A demo account signs in and sees its own name; on its profile it
      finds its details, the dates among them in the visitor's own time zone; after signing
      out the account's pages are no longer reachable. _Every target. Cheap._
- [ ] **Protected page.** An anonymous visitor opening a page behind the session is sent to
      the sign-in page and, once signed in, arrives on the page they asked for.
      _Every target. Cheap._
- [ ] **Browsing without an account.** A visitor who has not signed in reads a listing — its
      description, price and availability calendar — and, wanting to book or to write to the
      host, is offered to sign in, and once signed in arrives back on that listing.
      _Every target. Cheap._
- [ ] **Catalogue and search.** Starting from the home page, a visitor filters and orders the
      stays; the list changes, survives a reload and a shared link, and "next page"
      continues it. _Every target. Cheap._
- [ ] **Booking and payment.** A guest finds a listing, reads its description, price and
      availability calendar, picks dates, sees the quote, holds the stay, sees the countdown,
      pays, and lands on a confirmed stay. The centrepiece. _Every target. Expensive._
- [ ] **My bookings.** A guest who has booked finds the stay among their bookings with its
      status and amount, and opens it. _Every target. Medium: the stay is arranged beforehand,
      and paid through the pages._
- [ ] **Getting around.** A visitor reaches the pages their role uses — a guest's bookings,
      messages, notifications, waitlist and profile; a host's dashboard; the admin's
      listings, users and payments — from the menu alone, without typing an address: the
      sidebar on desktop, the menu sheet on a phone, where it is walked once more together
      with the catalogue up to a listing's page. _Every target on desktop for the guest's
      and the host's pages, hermetic only for the admin's; the phone run is hermetic only.
      Cheap._

## Priority 2 — the main functions of each role

- [ ] **Guest: choosing a rate.** On a listing that offers both, a guest sees the flexible
      and the non-refundable rate side by side, with the cancellation terms and what each
      costs; picking one changes the quote, and the stay they book keeps that rate and its
      terms. _Every target. Medium: the listing is arranged beforehand._
- [ ] **Guest: cancelling a paid stay.** The dialog states the refund; the stay then shows
      the same figure, first as on its way and then as refunded. _Every target. Expensive:
      the refund is asynchronous._
- [ ] **Host: managing listings.** A host creates a listing, edits it, deletes it; the
      catalogue shows each change. _Every target. Medium._
- [ ] **Host: a guest's stay.** A guest pays for a stay on the host's listing; the host, in
      another browser, finds it on their calendar and among their bookings. _Every target.
      Expensive._
- [ ] **Host: cancelling a guest's stay.** The host cancels a paid stay; the dialog states
      the refund and the guest's stay then shows the same figure. _Hermetic only: the
      API already proves the rules. Expensive._
- [ ] **Messages.** A guest writes to the host from the listing page; the host, in another
      browser, sees the message arrive without reloading and replies; the guest sees the
      reply. _Every target. Medium._

## Priority 3 — secondary functions

- [ ] **Notifications.** A guest writes to a host; the host's bell counts the message, the
      notifications page lists it, and marking all read clears the count. _Every target.
      Medium._
- [ ] **Waitlist.** A guest wanting dates that someone else holds joins the waitlist for
      them, sees it on their waitlist page, and leaves it. _Hermetic only: the second guest
      who holds the dates is registered by the scenario, and the deployment has none.
      Medium._
- [ ] **Ending a stay early.** The refund is stated before the guest confirms, and the stay
      then shows the end and the same figure. _Every target. Expensive: needs a stay that
      has begun._
- [ ] **Reviews.** After a stay that is over, the guest reviews the listing; the review shows
      on the listing and among the guest's own reviews. _Every target. Expensive: needs a
      stay that is over, which only an early end produces._
- [ ] **Host: reviewing a guest.** After a stay that is over, the host reviews the guest; the
      guest finds it, as reviews of them, from their profile, and the host finds the guest's
      reviews from the stay. _Every target. Expensive: needs a stay that is over._
- [ ] **Role gates.** A guest opening the admin pages or the host's dashboard is turned away
      and sees none of their content. The one scenario that is a refusal: what a browser adds
      to the API's own check is that the page never flashes content it should not show.
      _Every target. Cheap._
- [ ] **A broken link.** A visitor who opens an address that does not exist sees a not-found
      page and gets back to the catalogue from it. _Every target. Cheap._

## Priority 4 — admin and extra screens

- [ ] **Admin: blocking a user.** The admin finds a user the test registered itself through
      the users list and its filter, opens their page and blocks them, who can then no longer
      sign in. _Hermetic only. Medium._
- [ ] **Admin: editing a listing.** The admin finds a listing in the admin's listings list,
      changes it, and the catalogue shows the change. _Hermetic only. Medium._
- [ ] **Admin: a partial refund.** The admin finds a paid stay in the payments list and
      refunds part of it; the amounts shown follow. _Hermetic only. Expensive; the API
      already proves the rules._
- [ ] **Payouts.** A host who has not set up payouts is told so on their dashboard; they open
      the payouts page, pick the country of their payout account and are handed over to
      Stripe's own onboarding; what is inside it is Stripe's, not tested. _Real Stripe only:
      the account is opened with Stripe. Cheap._

## Cross-cutting

- [ ] **No errors, no accessibility violations.** Every page any scenario visits opens with
      no console error and no failed request, and passes an automated accessibility check
      that fails on serious and critical violations. A response a scenario expects — a
      not-found page, a redirect to sign-in, a refusal of a role — is declared by the test
      that provokes it and is not a failure. It is a rule of the suite rather than a
      scenario, and it overlaps the phase 8 audit.
