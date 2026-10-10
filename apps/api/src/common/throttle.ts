import { minutes } from "@nestjs/throttler";

/**
 * The limit the public reads carry instead of the API-wide one — the three of the
 * catalogue in `ListingController` and a listing's reviews in `ReviewController` — and the
 * reason is that "per address" stops meaning "per visitor" for exactly these routes. It
 * lives here rather than beside either controller because both apply it.
 *
 * They are the only `@Public()` reads, which is why the frontend caches them — and a
 * cached read is served from that server rather than from a browser: it reaches this API
 * from the frontend's single address, with no `x-forwarded-for` to bucket it by. Attaching
 * one would not help either; the header would go into the Data Cache key and split the
 * shared entry per visitor, which is the opposite of what caching them is for. So every
 * visitor browsing the catalogue arrives here as one client, and the default 120 a minute
 * is a ceiling on the whole site's cache misses rather than on one client's requests.
 *
 * 600 is what a cold cache costs rather than a number picked for the feel of it: a page
 * of the catalogue and a listing beside its availability are three URLs, the frontend
 * stores each of them for a minute, and the filters are free text — so the misses scale
 * with the searches being asked, not with the visitors asking them. It is still a limit:
 * `limit` caps a page at 50 rows and the availability window at a year, so nothing here
 * hands over the table faster than it would without one.
 *
 * A route that stops being public stops needing this — the session buckets it by visitor
 * again, and the default is the right ceiling for that.
 */
export const CATALOGUE_READS = { default: { ttl: minutes(1), limit: 600 } };
