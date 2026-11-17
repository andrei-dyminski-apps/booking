# Phase 11: client-side navigation, without vs with partial prerendering

- Site: https://booking-beige-five.vercel.app, signed in with the README demo accounts
- **Without Phase 11**: the production deployment after the Phase 11 revert (no `x-nextjs-prerender` header, `x-vercel-cache: MISS` right after the rollback)
- **With Phase 11**: the earlier measurement of the deployment that had it (`docs/lighthouse-phase-11-navigation.md`)
- Identical method: Playwright 1.65.1 / Chromium, viewport 1350x900, a fresh context and login per sample, 5 s idle on the start page, one click, 3 samples per navigation, medians. Profiles: unthrottled, and throttled (Slow 4G: 1.6 Mbit/s, 150 ms RTT, 4x CPU)
- Metrics from the click: **URL** = path changed, **Skeleton** = first `.animate-pulse` in `main`, **Content** = target path shown, no skeleton, DOM quiet for 400 ms (subtracted). Prefetch = router `_rsc` requests before / after the click
- Cells read `without → with`. A change under max(40 ms, 15%) is marked ≈; "faster" means Phase 11 is faster
- The two batches ran about 1.5 hours apart, on different builds of a demo deployment with a shared database

## Unthrottled

| Role  | Navigation                          | Skeleton ms     | Content ms               | Prefetch before / after click (without → with) |
| ----- | ----------------------------------- | --------------- | ------------------------ | ---------------------------------------------- |
| guest | Home → Stays                        | 29 → 28 (−0, ≈) | 328 → 328 (−0, ≈)        | 17 / 13 → 21 / 6                               |
| guest | Home → Bookings                     | 29 → 29 (−0, ≈) | 389 → 449 (+60, slower)  | 17 / 13 → 21 / 8                               |
| guest | Home → Messages                     | 29 → 28 (−1, ≈) | 344 → 452 (+108, slower) | 17 / 5 → 21 / 4                                |
| guest | Home → Waitlist                     | 27 → 28 (+1, ≈) | 322 → 328 (+6, ≈)        | 17 / 6 → 21 / 4                                |
| guest | Home → Notifications (via the bell) | 30 → 30 (−0, ≈) | 347 → 414 (+67, slower)  | 19 / 1 → 23 / 1                                |
| guest | Home → Profile                      | – → 28 (+28, ?) | 361 → 410 (+49, ≈)       | 17 / 3 → 21 / 3                                |
| guest | Stays → a listing                   | 28 → 28 (+1, ≈) | 337 → 626 (+289, slower) | 27 / 1 → 23 / 1                                |
| guest | Bookings → a booking                | 29 → 29 (−0, ≈) | 347 → 386 (+39, ≈)       | 31 / 1 → 27 / 1                                |
| guest | Messages → a thread                 | 29 → 29 (0, ≈)  | 386 → 351 (−35, ≈)       | 19 / 3 → 22 / 3                                |
| owner | Home → Dashboard                    | 29 → 28 (−1, ≈) | 329 → 345 (+17, ≈)       | 17 / 13 → 21 / 10                              |
| owner | Dashboard → Payouts                 | 29 → 29 (+0, ≈) | 346 → 379 (+32, ≈)       | 34 / 1 → 28 / 1                                |
| owner | Dashboard → a listing               | 28 → 29 (+1, ≈) | 338 → 386 (+48, ≈)       | 34 / 1 → 28 / 1                                |
| admin | Home → Admin                        | 29 → 28 (−1, ≈) | 364 → 521 (+157, slower) | 17 / 13 → 19 / 8                               |
| admin | Admin → Users                       | 29 → 29 (−1, ≈) | 345 → 363 (+18, ≈)       | 44 / 11 → 26 / 6                               |
| admin | Admin → Payments                    | 29 → 29 (−0, ≈) | 346 → 478 (+132, slower) | 44 / 4 → 26 / 1                                |
| admin | Users → a user                      | 29 → 28 (−1, ≈) | 345 → 345 (+1, ≈)        | 25 / 2 → 24 / 1                                |

**Median of every sample:** skeleton 29 → 29 ms, content 346 → 410 ms; slowest content 482 → 664 ms.

Pages where Phase 11 is faster / the same / slower — skeleton: 0 / 15 / 0; content: 0 / 10 / 6.

## Throttled (Slow 4G, 4x CPU)

| Role  | Navigation                          | Skeleton ms      | Content ms               | Prefetch before / after click (without → with) |
| ----- | ----------------------------------- | ---------------- | ------------------------ | ---------------------------------------------- |
| guest | Home → Stays                        | 44 → 42 (−2, ≈)  | 598 → 610 (+12, ≈)       | 17 / 13 → 19 / 6                               |
| guest | Home → Bookings                     | 40 → 28 (−12, ≈) | 951 → 949 (−2, ≈)        | 17 / 13 → 19 / 9                               |
| guest | Home → Messages                     | 42 → 41 (−0, ≈)  | 502 → 585 (+83, slower)  | 17 / 5 → 19 / 4                                |
| guest | Home → Waitlist                     | 42 → 41 (−1, ≈)  | 557 → 557 (+0, ≈)        | 17 / 6 → 19 / 4                                |
| guest | Home → Notifications (via the bell) | 60 → 59 (−1, ≈)  | 552 → 626 (+73, ≈)       | 19 / 1 → 21 / 1                                |
| guest | Home → Profile                      | – → 39 (+39, ?)  | 498 → 604 (+105, slower) | 17 / 3 → 19 / 3                                |
| guest | Stays → a listing                   | 45 → 44 (−1, ≈)  | 772 → 946 (+174, slower) | 27 / 1 → 22 / 1                                |
| guest | Bookings → a booking                | 29 → 31 (+2, ≈)  | 720 → 740 (+20, ≈)       | 31 / 1 → 25 / 1                                |
| guest | Messages → a thread                 | 39 → 40 (+0, ≈)  | 655 → 652 (−3, ≈)        | 19 / 3 → 20 / 3                                |
| owner | Home → Dashboard                    | 27 → 42 (+15, ≈) | 319 → 436 (+117, slower) | 17 / 13 → 19 / 10                              |
| owner | Dashboard → Payouts                 | 42 → 44 (+1, ≈)  | 523 → 557 (+34, ≈)       | 34 / 1 → 26 / 1                                |
| owner | Dashboard → a listing               | 31 → 30 (−1, ≈)  | 815 → 857 (+42, ≈)       | 34 / 1 → 26 / 1                                |
| admin | Home → Admin                        | 41 → 28 (−13, ≈) | 771 → 771 (+0, ≈)        | 17 / 13 → 19 / 8                               |
| admin | Admin → Users                       | 44 → 48 (+3, ≈)  | 522 → 535 (+13, ≈)       | 44 / 11 → 24 / 6                               |
| admin | Admin → Payments                    | 30 → 32 (+3, ≈)  | 669 → 691 (+22, ≈)       | 44 / 4 → 24 / 1                                |
| admin | Users → a user                      | 43 → 32 (−11, ≈) | 640 → 647 (+6, ≈)        | 25 / 2 → 22 / 1                                |

**Median of every sample:** skeleton 41 → 41 ms, content 628 → 647 ms; slowest content 993 → 1017 ms.

Pages where Phase 11 is faster / the same / slower — skeleton: 0 / 15 / 0; content: 0 / 12 / 4.

## Reading the results

**Verdict: Phase 11 did not speed up client-side navigation in this test. The skeleton appears at the same moment with and without it, and the content arrives at the same time or a little later with it.**

- **Skeleton / URL change**: about 29 ms unthrottled and about 41 ms throttled in both builds, the same on every page. The instant skeleton does not come from Phase 11: the route `loading.tsx` files are prefetched without it too.
- **Content**: unthrottled, 346 → 410 ms (median of every sample); 6 of 16 navigations are slower with Phase 11 (largest: Stays → a listing +289 ms, Home → Admin +157 ms, Admin → Payments +132 ms, Home → Messages +108 ms), 10 are the same. Throttled, 628 → 647 ms; 4 slower (Stays → a listing +174 ms, Home → Dashboard +117, Home → Profile +105, Home → Messages +83), 12 the same. Nothing is faster beyond the noise floor.
- **Prefetch**: the number of router requests before the click is similar (17–44 without, 19–28 with; the admin pages drop from 44 to 24–26). After the click, without Phase 11 the client sends more requests on the pages that load several things (Home → Stays 13 vs 6, Home → Bookings 13 vs 8, Home → Admin 13 vs 8), so the prefetch does cover more with Phase 11, but that did not shorten the time to content.
- **Home → Profile**: without Phase 11 no skeleton was seen on this navigation (the route had no `loading.tsx` before; `app/profile/loading.tsx` came with Phase 11), so the table shows "–" for that cell. The content time is 361 → 410 ms unthrottled and 498 → 604 ms throttled.

### Caveats

- 3 samples per navigation, one machine, one demo deployment with a shared database; the two batches ran about 1.5 hours apart. Differences below roughly 40 ms or 15% are noise, and several of the "slower" cells are only just past that line.
- "Content ready" waits for the whole page to be free of `.animate-pulse` and quiet for 400 ms, so it is bounded by the slowest API call behind the page. If that call is what sets the time, a shell prefetch cannot shorten it.
- The test clicks after 5 s of idling, when everything in view is prefetched. A click made sooner after load, or on a link that was not in view, is not covered.
- Desktop viewport only; the mobile drawer navigation was not measured.

## All samples

| Build   | Profile     | Role  | Navigation                          | Run | URL ms | Skeleton ms | Content ms | Prefetch before / after | Timeout |
| ------- | ----------- | ----- | ----------------------------------- | --- | ------ | ----------- | ---------- | ----------------------- | ------- |
| without | unthrottled | guest | Home → Stays                        | 1   | 24     | 24          | 346        | 17 / 12                 | no      |
| without | unthrottled | guest | Home → Stays                        | 2   | 29     | 29          | 328        | 17 / 13                 | no      |
| without | unthrottled | guest | Home → Stays                        | 3   | 29     | 29          | 328        | 17 / 13                 | no      |
| without | unthrottled | guest | Home → Bookings                     | 1   | 28     | 28          | 482        | 17 / 12                 | no      |
| without | unthrottled | guest | Home → Bookings                     | 2   | 29     | 29          | 378        | 17 / 13                 | no      |
| without | unthrottled | guest | Home → Bookings                     | 3   | 29     | 29          | 389        | 17 / 13                 | no      |
| without | unthrottled | guest | Home → Messages                     | 1   | 29     | 29          | 345        | 17 / 5                  | no      |
| without | unthrottled | guest | Home → Messages                     | 2   | 29     | 29          | 329        | 17 / 5                  | no      |
| without | unthrottled | guest | Home → Messages                     | 3   | 28     | 28          | 344        | 17 / 5                  | no      |
| without | unthrottled | guest | Home → Waitlist                     | 1   | 23     | 23          | 322        | 17 / 6                  | no      |
| without | unthrottled | guest | Home → Waitlist                     | 2   | 27     | 27          | 327        | 17 / 6                  | no      |
| without | unthrottled | guest | Home → Waitlist                     | 3   | 29     | 29          | 313        | 17 / 6                  | no      |
| without | unthrottled | guest | Home → Notifications (via the bell) | 1   | 30     | 30          | 347        | 19 / 1                  | no      |
| without | unthrottled | guest | Home → Notifications (via the bell) | 2   | 30     | 30          | 347        | 19 / 1                  | no      |
| without | unthrottled | guest | Home → Notifications (via the bell) | 3   | 30     | 30          | 351        | 19 / 1                  | no      |
| without | unthrottled | guest | Home → Profile                      | 1   | 379    | –           | 379        | 17 / 3                  | no      |
| without | unthrottled | guest | Home → Profile                      | 2   | 331    | –           | 331        | 17 / 3                  | no      |
| without | unthrottled | guest | Home → Profile                      | 3   | 361    | –           | 361        | 17 / 3                  | no      |
| without | unthrottled | guest | Stays → a listing                   | 1   | 29     | 29          | 417        | 27 / 1                  | no      |
| without | unthrottled | guest | Stays → a listing                   | 2   | 20     | 20          | 324        | 27 / 1                  | no      |
| without | unthrottled | guest | Stays → a listing                   | 3   | 28     | 28          | 337        | 27 / 1                  | no      |
| without | unthrottled | guest | Bookings → a booking                | 1   | 29     | 29          | 411        | 31 / 1                  | no      |
| without | unthrottled | guest | Bookings → a booking                | 2   | 29     | 29          | 347        | 31 / 1                  | no      |
| without | unthrottled | guest | Bookings → a booking                | 3   | 28     | 28          | 345        | 32 / 1                  | no      |
| without | unthrottled | guest | Messages → a thread                 | 1   | 29     | 29          | 399        | 19 / 3                  | no      |
| without | unthrottled | guest | Messages → a thread                 | 2   | 29     | 29          | 386        | 19 / 3                  | no      |
| without | unthrottled | guest | Messages → a thread                 | 3   | 29     | 29          | 349        | 19 / 3                  | no      |
| without | unthrottled | owner | Home → Dashboard                    | 1   | 29     | 29          | 329        | 17 / 13                 | no      |
| without | unthrottled | owner | Home → Dashboard                    | 2   | 30     | 30          | 346        | 17 / 12                 | no      |
| without | unthrottled | owner | Home → Dashboard                    | 3   | 29     | 29          | 312        | 17 / 13                 | no      |
| without | unthrottled | owner | Dashboard → Payouts                 | 1   | 29     | 29          | 346        | 34 / 1                  | no      |
| without | unthrottled | owner | Dashboard → Payouts                 | 2   | 28     | 28          | 361        | 35 / 1                  | no      |
| without | unthrottled | owner | Dashboard → Payouts                 | 3   | 29     | 29          | 346        | 34 / 1                  | no      |
| without | unthrottled | owner | Dashboard → a listing               | 1   | 27     | 27          | 335        | 34 / 1                  | no      |
| without | unthrottled | owner | Dashboard → a listing               | 2   | 28     | 28          | 361        | 34 / 1                  | no      |
| without | unthrottled | owner | Dashboard → a listing               | 3   | 29     | 29          | 338        | 34 / 1                  | no      |
| without | unthrottled | admin | Home → Admin                        | 1   | 29     | 29          | 364        | 17 / 13                 | no      |
| without | unthrottled | admin | Home → Admin                        | 2   | 29     | 29          | 379        | 17 / 13                 | no      |
| without | unthrottled | admin | Home → Admin                        | 3   | 29     | 29          | 350        | 17 / 14                 | no      |
| without | unthrottled | admin | Admin → Users                       | 1   | 29     | 29          | 345        | 45 / 11                 | no      |
| without | unthrottled | admin | Admin → Users                       | 2   | 29     | 29          | 346        | 44 / 11                 | no      |
| without | unthrottled | admin | Admin → Users                       | 3   | 28     | 28          | 344        | 43 / 11                 | no      |
| without | unthrottled | admin | Admin → Payments                    | 1   | 29     | 29          | 346        | 44 / 4                  | no      |
| without | unthrottled | admin | Admin → Payments                    | 2   | 29     | 29          | 346        | 44 / 4                  | no      |
| without | unthrottled | admin | Admin → Payments                    | 3   | 28     | 28          | 345        | 45 / 4                  | no      |
| without | unthrottled | admin | Users → a user                      | 1   | 29     | 29          | 347        | 25 / 2                  | no      |
| without | unthrottled | admin | Users → a user                      | 2   | 29     | 29          | 330        | 25 / 2                  | no      |
| without | unthrottled | admin | Users → a user                      | 3   | 28     | 28          | 345        | 25 / 2                  | no      |
| without | throttled   | guest | Home → Stays                        | 1   | 44     | 44          | 572        | 17 / 13                 | no      |
| without | throttled   | guest | Home → Stays                        | 2   | 50     | 50          | 616        | 17 / 13                 | no      |
| without | throttled   | guest | Home → Stays                        | 3   | 42     | 42          | 598        | 17 / 13                 | no      |
| without | throttled   | guest | Home → Bookings                     | 1   | 40     | 40          | 951        | 17 / 13                 | no      |
| without | throttled   | guest | Home → Bookings                     | 2   | 26     | 26          | 993        | 17 / 13                 | no      |
| without | throttled   | guest | Home → Bookings                     | 3   | 40     | 40          | 934        | 17 / 12                 | no      |
| without | throttled   | guest | Home → Messages                     | 1   | 44     | 44          | 502        | 17 / 5                  | no      |
| without | throttled   | guest | Home → Messages                     | 2   | 42     | 42          | 486        | 17 / 5                  | no      |
| without | throttled   | guest | Home → Messages                     | 3   | 41     | 41          | 551        | 17 / 5                  | no      |
| without | throttled   | guest | Home → Waitlist                     | 1   | 40     | 40          | 557        | 17 / 6                  | no      |
| without | throttled   | guest | Home → Waitlist                     | 2   | 43     | 43          | 556        | 17 / 6                  | no      |
| without | throttled   | guest | Home → Waitlist                     | 3   | 42     | 42          | 559        | 17 / 6                  | no      |
| without | throttled   | guest | Home → Notifications (via the bell) | 1   | 60     | 60          | 552        | 19 / 1                  | no      |
| without | throttled   | guest | Home → Notifications (via the bell) | 2   | 61     | 61          | 557        | 19 / 1                  | no      |
| without | throttled   | guest | Home → Notifications (via the bell) | 3   | 60     | 60          | 543        | 19 / 1                  | no      |
| without | throttled   | guest | Home → Profile                      | 1   | 529    | –           | 529        | 17 / 3                  | no      |
| without | throttled   | guest | Home → Profile                      | 2   | 498    | –           | 498        | 17 / 3                  | no      |
| without | throttled   | guest | Home → Profile                      | 3   | 496    | –           | 496        | 17 / 3                  | no      |
| without | throttled   | guest | Stays → a listing                   | 1   | 48     | 48          | 772        | 27 / 1                  | no      |
| without | throttled   | guest | Stays → a listing                   | 2   | 45     | 45          | 950        | 27 / 1                  | no      |
| without | throttled   | guest | Stays → a listing                   | 3   | 29     | 29          | 762        | 27 / 1                  | no      |
| without | throttled   | guest | Bookings → a booking                | 1   | 29     | 29          | 720        | 31 / 1                  | no      |
| without | throttled   | guest | Bookings → a booking                | 2   | 29     | 29          | 726        | 32 / 1                  | no      |
| without | throttled   | guest | Bookings → a booking                | 3   | 28     | 28          | 707        | 31 / 1                  | no      |
| without | throttled   | guest | Messages → a thread                 | 1   | 39     | 39          | 655        | 19 / 3                  | no      |
| without | throttled   | guest | Messages → a thread                 | 2   | 46     | 46          | 742        | 19 / 3                  | no      |
| without | throttled   | guest | Messages → a thread                 | 3   | 39     | 39          | 628        | 19 / 3                  | no      |
| without | throttled   | owner | Home → Dashboard                    | 1   | 41     | 41          | 336        | 17 / 13                 | no      |
| without | throttled   | owner | Home → Dashboard                    | 2   | 27     | 27          | 319        | 17 / 13                 | no      |
| without | throttled   | owner | Home → Dashboard                    | 3   | 26     | 26          | 318        | 17 / 13                 | no      |
| without | throttled   | owner | Dashboard → Payouts                 | 1   | 40     | 40          | 523        | 34 / 1                  | no      |
| without | throttled   | owner | Dashboard → Payouts                 | 2   | 47     | 47          | 520        | 34 / 1                  | no      |
| without | throttled   | owner | Dashboard → Payouts                 | 3   | 42     | 42          | 525        | 34 / 1                  | no      |
| without | throttled   | owner | Dashboard → a listing               | 1   | 27     | 27          | 815        | 35 / 1                  | no      |
| without | throttled   | owner | Dashboard → a listing               | 2   | 31     | 31          | 804        | 33 / 1                  | no      |
| without | throttled   | owner | Dashboard → a listing               | 3   | 51     | 51          | 836        | 34 / 1                  | no      |
| without | throttled   | admin | Home → Admin                        | 1   | 41     | 41          | 782        | 17 / 13                 | no      |
| without | throttled   | admin | Home → Admin                        | 2   | 26     | 26          | 771        | 17 / 13                 | no      |
| without | throttled   | admin | Home → Admin                        | 3   | 41     | 41          | 759        | 17 / 13                 | no      |
| without | throttled   | admin | Admin → Users                       | 1   | 44     | 44          | 536        | 43 / 11                 | no      |
| without | throttled   | admin | Admin → Users                       | 2   | 45     | 45          | 518        | 45 / 11                 | no      |
| without | throttled   | admin | Admin → Users                       | 3   | 33     | 33          | 522        | 44 / 11                 | no      |
| without | throttled   | admin | Admin → Payments                    | 1   | 48     | 48          | 725        | 44 / 4                  | no      |
| without | throttled   | admin | Admin → Payments                    | 2   | 29     | 29          | 669        | 44 / 4                  | no      |
| without | throttled   | admin | Admin → Payments                    | 3   | 30     | 30          | 669        | 44 / 4                  | no      |
| without | throttled   | admin | Users → a user                      | 1   | 24     | 24          | 646        | 25 / 2                  | no      |
| without | throttled   | admin | Users → a user                      | 2   | 54     | 54          | 637        | 25 / 2                  | no      |
| without | throttled   | admin | Users → a user                      | 3   | 43     | 43          | 640        | 25 / 2                  | no      |
| with    | unthrottled | guest | Home → Stays                        | 1   | 28     | 28          | 344        | 21 / 6                  | no      |
| with    | unthrottled | guest | Home → Stays                        | 2   | 28     | 28          | 328        | 21 / 6                  | no      |
| with    | unthrottled | guest | Home → Stays                        | 3   | 28     | 28          | 328        | 21 / 6                  | no      |
| with    | unthrottled | guest | Home → Bookings                     | 1   | 29     | 29          | 378        | 21 / 9                  | no      |
| with    | unthrottled | guest | Home → Bookings                     | 2   | 29     | 29          | 545        | 21 / 8                  | no      |
| with    | unthrottled | guest | Home → Bookings                     | 3   | 29     | 29          | 449        | 21 / 8                  | no      |
| with    | unthrottled | guest | Home → Messages                     | 1   | 29     | 29          | 378        | 21 / 4                  | no      |
| with    | unthrottled | guest | Home → Messages                     | 2   | 28     | 28          | 478        | 21 / 4                  | no      |
| with    | unthrottled | guest | Home → Messages                     | 3   | 19     | 19          | 452        | 21 / 4                  | no      |
| with    | unthrottled | guest | Home → Waitlist                     | 1   | 28     | 28          | 312        | 21 / 4                  | no      |
| with    | unthrottled | guest | Home → Waitlist                     | 2   | 28     | 28          | 411        | 20 / 4                  | no      |
| with    | unthrottled | guest | Home → Waitlist                     | 3   | 28     | 28          | 328        | 21 / 4                  | no      |
| with    | unthrottled | guest | Home → Notifications (via the bell) | 1   | 30     | 30          | 414        | 23 / 1                  | no      |
| with    | unthrottled | guest | Home → Notifications (via the bell) | 2   | 30     | 30          | 513        | 23 / 1                  | no      |
| with    | unthrottled | guest | Home → Notifications (via the bell) | 3   | 30     | 30          | 346        | 23 / 1                  | no      |
| with    | unthrottled | guest | Home → Profile                      | 1   | 28     | 28          | 411        | 21 / 3                  | no      |
| with    | unthrottled | guest | Home → Profile                      | 2   | 29     | 29          | 329        | 19 / 3                  | no      |
| with    | unthrottled | guest | Home → Profile                      | 3   | 27     | 27          | 410        | 21 / 3                  | no      |
| with    | unthrottled | guest | Stays → a listing                   | 1   | 28     | 28          | 626        | 22 / 1                  | no      |
| with    | unthrottled | guest | Stays → a listing                   | 2   | 28     | 28          | 649        | 23 / 1                  | no      |
| with    | unthrottled | guest | Stays → a listing                   | 3   | 29     | 29          | 562        | 23 / 1                  | no      |
| with    | unthrottled | guest | Bookings → a booking                | 1   | 20     | 20          | 386        | 27 / 1                  | no      |
| with    | unthrottled | guest | Bookings → a booking                | 2   | 29     | 29          | 428        | 28 / 1                  | no      |
| with    | unthrottled | guest | Bookings → a booking                | 3   | 29     | 29          | 361        | 27 / 1                  | no      |
| with    | unthrottled | guest | Messages → a thread                 | 1   | 29     | 29          | 363        | 22 / 3                  | no      |
| with    | unthrottled | guest | Messages → a thread                 | 2   | 29     | 29          | 351        | 22 / 3                  | no      |
| with    | unthrottled | guest | Messages → a thread                 | 3   | 29     | 29          | 348        | 22 / 3                  | no      |
| with    | unthrottled | owner | Home → Dashboard                    | 1   | 29     | 29          | 345        | 21 / 9                  | no      |
| with    | unthrottled | owner | Home → Dashboard                    | 2   | 28     | 28          | 411        | 21 / 11                 | no      |
| with    | unthrottled | owner | Home → Dashboard                    | 3   | 28     | 28          | 311        | 21 / 10                 | no      |
| with    | unthrottled | owner | Dashboard → Payouts                 | 1   | 28     | 28          | 379        | 28 / 1                  | no      |
| with    | unthrottled | owner | Dashboard → Payouts                 | 2   | 29     | 29          | 330        | 28 / 1                  | no      |
| with    | unthrottled | owner | Dashboard → Payouts                 | 3   | 29     | 29          | 445        | 28 / 1                  | no      |
| with    | unthrottled | owner | Dashboard → a listing               | 1   | 29     | 29          | 386        | 28 / 1                  | no      |
| with    | unthrottled | owner | Dashboard → a listing               | 2   | 29     | 29          | 369        | 28 / 1                  | no      |
| with    | unthrottled | owner | Dashboard → a listing               | 3   | 29     | 29          | 484        | 27 / 1                  | no      |
| with    | unthrottled | admin | Home → Admin                        | 1   | 28     | 28          | 664        | 19 / 8                  | no      |
| with    | unthrottled | admin | Home → Admin                        | 2   | 28     | 28          | 428        | 21 / 8                  | no      |
| with    | unthrottled | admin | Home → Admin                        | 3   | 22     | 22          | 521        | 19 / 9                  | no      |
| with    | unthrottled | admin | Admin → Users                       | 1   | 29     | 29          | 363        | 25 / 6                  | no      |
| with    | unthrottled | admin | Admin → Users                       | 2   | 29     | 29          | 328        | 26 / 6                  | no      |
| with    | unthrottled | admin | Admin → Users                       | 3   | 28     | 28          | 428        | 26 / 6                  | no      |
| with    | unthrottled | admin | Admin → Payments                    | 1   | 29     | 29          | 478        | 26 / 1                  | no      |
| with    | unthrottled | admin | Admin → Payments                    | 2   | 29     | 29          | 462        | 26 / 1                  | no      |
| with    | unthrottled | admin | Admin → Payments                    | 3   | 28     | 28          | 545        | 27 / 1                  | no      |
| with    | unthrottled | admin | Users → a user                      | 1   | 27     | 27          | 496        | 24 / 1                  | no      |
| with    | unthrottled | admin | Users → a user                      | 2   | 28     | 28          | 344        | 24 / 1                  | no      |
| with    | unthrottled | admin | Users → a user                      | 3   | 30     | 30          | 345        | 24 / 1                  | no      |
| with    | throttled   | guest | Home → Stays                        | 1   | 41     | 41          | 610        | 19 / 6                  | no      |
| with    | throttled   | guest | Home → Stays                        | 2   | 45     | 45          | 599        | 19 / 6                  | no      |
| with    | throttled   | guest | Home → Stays                        | 3   | 42     | 42          | 655        | 19 / 6                  | no      |
| with    | throttled   | guest | Home → Bookings                     | 1   | 26     | 26          | 942        | 19 / 9                  | no      |
| with    | throttled   | guest | Home → Bookings                     | 2   | 28     | 28          | 949        | 19 / 8                  | no      |
| with    | throttled   | guest | Home → Bookings                     | 3   | 44     | 44          | 952        | 19 / 9                  | no      |
| with    | throttled   | guest | Home → Messages                     | 1   | 25     | 25          | 518        | 19 / 4                  | no      |
| with    | throttled   | guest | Home → Messages                     | 2   | 41     | 41          | 585        | 19 / 4                  | no      |
| with    | throttled   | guest | Home → Messages                     | 3   | 43     | 43          | 587        | 19 / 4                  | no      |
| with    | throttled   | guest | Home → Waitlist                     | 1   | 43     | 43          | 557        | 19 / 4                  | no      |
| with    | throttled   | guest | Home → Waitlist                     | 2   | 41     | 41          | 557        | 19 / 4                  | no      |
| with    | throttled   | guest | Home → Waitlist                     | 3   | 39     | 39          | 555        | 19 / 4                  | no      |
| with    | throttled   | guest | Home → Notifications (via the bell) | 1   | 57     | 57          | 626        | 21 / 1                  | no      |
| with    | throttled   | guest | Home → Notifications (via the bell) | 2   | 59     | 59          | 660        | 21 / 1                  | no      |
| with    | throttled   | guest | Home → Notifications (via the bell) | 3   | 62     | 62          | 557        | 21 / 1                  | no      |
| with    | throttled   | guest | Home → Profile                      | 1   | 43     | 43          | 640        | 19 / 3                  | no      |
| with    | throttled   | guest | Home → Profile                      | 2   | 29     | 29          | 493        | 19 / 3                  | no      |
| with    | throttled   | guest | Home → Profile                      | 3   | 39     | 39          | 604        | 19 / 3                  | no      |
| with    | throttled   | guest | Stays → a listing                   | 1   | 42     | 42          | 946        | 22 / 1                  | no      |
| with    | throttled   | guest | Stays → a listing                   | 2   | 44     | 44          | 1017       | 22 / 1                  | no      |
| with    | throttled   | guest | Stays → a listing                   | 3   | 45     | 45          | 896        | 22 / 1                  | no      |
| with    | throttled   | guest | Bookings → a booking                | 1   | 33     | 33          | 740        | 24 / 1                  | no      |
| with    | throttled   | guest | Bookings → a booking                | 2   | 31     | 31          | 819        | 25 / 1                  | no      |
| with    | throttled   | guest | Bookings → a booking                | 3   | 31     | 31          | 703        | 25 / 1                  | no      |
| with    | throttled   | guest | Messages → a thread                 | 1   | 40     | 40          | 642        | 20 / 3                  | no      |
| with    | throttled   | guest | Messages → a thread                 | 2   | 44     | 44          | 652        | 20 / 3                  | no      |
| with    | throttled   | guest | Messages → a thread                 | 3   | 39     | 39          | 756        | 20 / 3                  | no      |
| with    | throttled   | owner | Home → Dashboard                    | 1   | 26     | 26          | 450        | 19 / 10                 | no      |
| with    | throttled   | owner | Home → Dashboard                    | 2   | 42     | 42          | 321        | 19 / 10                 | no      |
| with    | throttled   | owner | Home → Dashboard                    | 3   | 54     | 54          | 436        | 19 / 10                 | no      |
| with    | throttled   | owner | Dashboard → Payouts                 | 1   | 45     | 45          | 637        | 26 / 1                  | no      |
| with    | throttled   | owner | Dashboard → Payouts                 | 2   | 44     | 44          | 535        | 26 / 1                  | no      |
| with    | throttled   | owner | Dashboard → Payouts                 | 3   | 29     | 29          | 557        | 26 / 1                  | no      |
| with    | throttled   | owner | Dashboard → a listing               | 1   | 30     | 30          | 857        | 26 / 1                  | no      |
| with    | throttled   | owner | Dashboard → a listing               | 2   | 36     | 36          | 938        | 26 / 1                  | no      |
| with    | throttled   | owner | Dashboard → a listing               | 3   | 30     | 30          | 842        | 26 / 1                  | no      |
| with    | throttled   | admin | Home → Admin                        | 1   | 27     | 27          | 771        | 19 / 8                  | no      |
| with    | throttled   | admin | Home → Admin                        | 2   | 28     | 28          | 765        | 19 / 8                  | no      |
| with    | throttled   | admin | Home → Admin                        | 3   | 42     | 42          | 773        | 19 / 8                  | no      |
| with    | throttled   | admin | Admin → Users                       | 1   | 48     | 48          | 638        | 24 / 6                  | no      |
| with    | throttled   | admin | Admin → Users                       | 2   | 48     | 48          | 535        | 24 / 6                  | no      |
| with    | throttled   | admin | Admin → Users                       | 3   | 48     | 48          | 521        | 24 / 6                  | no      |
| with    | throttled   | admin | Admin → Payments                    | 1   | 31     | 31          | 691        | 24 / 1                  | no      |
| with    | throttled   | admin | Admin → Payments                    | 2   | 32     | 32          | 785        | 24 / 1                  | no      |
| with    | throttled   | admin | Admin → Payments                    | 3   | 34     | 34          | 684        | 24 / 1                  | no      |
| with    | throttled   | admin | Users → a user                      | 1   | 54     | 54          | 639        | 22 / 1                  | no      |
| with    | throttled   | admin | Users → a user                      | 2   | 29     | 29          | 696        | 22 / 1                  | no      |
| with    | throttled   | admin | Users → a user                      | 3   | 32     | 32          | 647        | 22 / 1                  | no      |
