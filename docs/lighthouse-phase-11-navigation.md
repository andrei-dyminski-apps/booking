# Phase 11: client-side navigation, signed in

- Site: https://booking-beige-five.vercel.app (the deployment with Phase 11), demo accounts from the README
- Date: 2026-11-17. Playwright 1.65.1, Chromium, desktop viewport 1350x900 (the sidebar is visible)
- Each sample: a fresh browser context and a fresh login, the start page loaded, **5 s of idling** so the router can prefetch the links in view, then one click on a link. 3 samples per navigation, medians below; every run is listed at the end
- Two profiles: **unthrottled**, and **throttled** (Slow 4G as in Lighthouse: 1.6 Mbit/s down, 750 kbit/s up, 150 ms RTT, plus 4x CPU slowdown)
- Measured in the page from the click: **URL** = the path changed, **Skeleton** = the first loading skeleton (`.animate-pulse`) appeared in `main`, **Content** = the target path is shown, no skeleton is left and the DOM stayed unchanged for 400 ms (the 400 ms is subtracted). **Prefetch** = router requests (`_rsc`) made before the click / after it
- There is no "before Phase 11" run here: the old build is not deployed anywhere, so this is an absolute measurement of the current site, not a comparison

## Unthrottled — median of 3

| Role  | Navigation                          | URL ms | Skeleton ms | Content ms | Prefetch before / after click |
| ----- | ----------------------------------- | ------ | ----------- | ---------- | ----------------------------- |
| guest | Home → Stays                        | 28     | 28          | 328        | 21 / 6                        |
| guest | Home → Bookings                     | 29     | 29          | 449        | 21 / 8                        |
| guest | Home → Messages                     | 28     | 28          | 452        | 21 / 4                        |
| guest | Home → Waitlist                     | 28     | 28          | 328        | 21 / 4                        |
| guest | Home → Notifications (via the bell) | 30     | 30          | 414        | 23 / 1                        |
| guest | Home → Profile                      | 28     | 28          | 410        | 21 / 3                        |
| guest | Stays → a listing                   | 28     | 28          | 626        | 23 / 1                        |
| guest | Bookings → a booking                | 29     | 29          | 386        | 27 / 1                        |
| guest | Messages → a thread                 | 29     | 29          | 351        | 22 / 3                        |
| owner | Home → Dashboard                    | 28     | 28          | 345        | 21 / 10                       |
| owner | Dashboard → Payouts                 | 29     | 29          | 379        | 28 / 1                        |
| owner | Dashboard → a listing               | 29     | 29          | 386        | 28 / 1                        |
| admin | Home → Admin                        | 28     | 28          | 521        | 19 / 8                        |
| admin | Admin → Users                       | 29     | 29          | 363        | 26 / 6                        |
| admin | Admin → Payments                    | 29     | 29          | 478        | 26 / 1                        |
| admin | Users → a user                      | 28     | 28          | 345        | 24 / 1                        |

**All 16 navigations, median of every sample:** URL 29 ms, skeleton 29 ms, content 410 ms; slowest content 664 ms; timeouts: 0.

## Throttled (Slow 4G, 4x CPU) — median of 3

| Role  | Navigation                          | URL ms | Skeleton ms | Content ms | Prefetch before / after click |
| ----- | ----------------------------------- | ------ | ----------- | ---------- | ----------------------------- |
| guest | Home → Stays                        | 42     | 42          | 610        | 19 / 6                        |
| guest | Home → Bookings                     | 28     | 28          | 949        | 19 / 9                        |
| guest | Home → Messages                     | 41     | 41          | 585        | 19 / 4                        |
| guest | Home → Waitlist                     | 41     | 41          | 557        | 19 / 4                        |
| guest | Home → Notifications (via the bell) | 59     | 59          | 626        | 21 / 1                        |
| guest | Home → Profile                      | 39     | 39          | 604        | 19 / 3                        |
| guest | Stays → a listing                   | 44     | 44          | 946        | 22 / 1                        |
| guest | Bookings → a booking                | 31     | 31          | 740        | 25 / 1                        |
| guest | Messages → a thread                 | 40     | 40          | 652        | 20 / 3                        |
| owner | Home → Dashboard                    | 42     | 42          | 436        | 19 / 10                       |
| owner | Dashboard → Payouts                 | 44     | 44          | 557        | 26 / 1                        |
| owner | Dashboard → a listing               | 30     | 30          | 857        | 26 / 1                        |
| admin | Home → Admin                        | 28     | 28          | 771        | 19 / 8                        |
| admin | Admin → Users                       | 48     | 48          | 535        | 24 / 6                        |
| admin | Admin → Payments                    | 32     | 32          | 691        | 24 / 1                        |
| admin | Users → a user                      | 32     | 32          | 647        | 22 / 1                        |

**All 16 navigations, median of every sample:** URL 41 ms, skeleton 41 ms, content 647 ms; slowest content 1017 ms; timeouts: 0.

## All samples

| Profile     | Role  | Navigation                          | Run | URL ms | Skeleton ms | Content ms | Prefetch before / after | Last request ended ms |
| ----------- | ----- | ----------------------------------- | --- | ------ | ----------- | ---------- | ----------------------- | --------------------- |
| unthrottled | guest | Home → Stays                        | 1   | 28     | 28          | 344        | 21 / 6                  | 445                   |
| unthrottled | guest | Home → Stays                        | 2   | 28     | 28          | 328        | 21 / 6                  | 433                   |
| unthrottled | guest | Home → Stays                        | 3   | 28     | 28          | 328        | 21 / 6                  | 455                   |
| unthrottled | guest | Home → Bookings                     | 1   | 29     | 29          | 378        | 21 / 9                  | 494                   |
| unthrottled | guest | Home → Bookings                     | 2   | 29     | 29          | 545        | 21 / 8                  | 646                   |
| unthrottled | guest | Home → Bookings                     | 3   | 29     | 29          | 449        | 21 / 8                  | 563                   |
| unthrottled | guest | Home → Messages                     | 1   | 29     | 29          | 378        | 21 / 4                  | 482                   |
| unthrottled | guest | Home → Messages                     | 2   | 28     | 28          | 478        | 21 / 4                  | 609                   |
| unthrottled | guest | Home → Messages                     | 3   | 19     | 19          | 452        | 21 / 4                  | 554                   |
| unthrottled | guest | Home → Waitlist                     | 1   | 28     | 28          | 312        | 21 / 4                  | 410                   |
| unthrottled | guest | Home → Waitlist                     | 2   | 28     | 28          | 411        | 20 / 4                  | 510                   |
| unthrottled | guest | Home → Waitlist                     | 3   | 28     | 28          | 328        | 21 / 4                  | 431                   |
| unthrottled | guest | Home → Notifications (via the bell) | 1   | 30     | 30          | 414        | 23 / 1                  | 421                   |
| unthrottled | guest | Home → Notifications (via the bell) | 2   | 30     | 30          | 513        | 23 / 1                  | 509                   |
| unthrottled | guest | Home → Notifications (via the bell) | 3   | 30     | 30          | 346        | 23 / 1                  | 347                   |
| unthrottled | guest | Home → Profile                      | 1   | 28     | 28          | 411        | 21 / 3                  | 514                   |
| unthrottled | guest | Home → Profile                      | 2   | 29     | 29          | 329        | 19 / 3                  | 436                   |
| unthrottled | guest | Home → Profile                      | 3   | 27     | 27          | 410        | 21 / 3                  | 504                   |
| unthrottled | guest | Stays → a listing                   | 1   | 28     | 28          | 626        | 22 / 1                  | 468                   |
| unthrottled | guest | Stays → a listing                   | 2   | 28     | 28          | 649        | 23 / 1                  | 458                   |
| unthrottled | guest | Stays → a listing                   | 3   | 29     | 29          | 562        | 23 / 1                  | 373                   |
| unthrottled | guest | Bookings → a booking                | 1   | 20     | 20          | 386        | 27 / 1                  | 404                   |
| unthrottled | guest | Bookings → a booking                | 2   | 29     | 29          | 428        | 28 / 1                  | 436                   |
| unthrottled | guest | Bookings → a booking                | 3   | 29     | 29          | 361        | 27 / 1                  | 375                   |
| unthrottled | guest | Messages → a thread                 | 1   | 29     | 29          | 363        | 22 / 3                  | 446                   |
| unthrottled | guest | Messages → a thread                 | 2   | 29     | 29          | 351        | 22 / 3                  | 438                   |
| unthrottled | guest | Messages → a thread                 | 3   | 29     | 29          | 348        | 22 / 3                  | 441                   |
| unthrottled | owner | Home → Dashboard                    | 1   | 29     | 29          | 345        | 21 / 9                  | 494                   |
| unthrottled | owner | Home → Dashboard                    | 2   | 28     | 28          | 411        | 21 / 11                 | 536                   |
| unthrottled | owner | Home → Dashboard                    | 3   | 28     | 28          | 311        | 21 / 10                 | 440                   |
| unthrottled | owner | Dashboard → Payouts                 | 1   | 28     | 28          | 379        | 28 / 1                  | 789                   |
| unthrottled | owner | Dashboard → Payouts                 | 2   | 29     | 29          | 330        | 28 / 1                  | 695                   |
| unthrottled | owner | Dashboard → Payouts                 | 3   | 29     | 29          | 445        | 28 / 1                  | 810                   |
| unthrottled | owner | Dashboard → a listing               | 1   | 29     | 29          | 386        | 28 / 1                  | 381                   |
| unthrottled | owner | Dashboard → a listing               | 2   | 29     | 29          | 369        | 28 / 1                  | 371                   |
| unthrottled | owner | Dashboard → a listing               | 3   | 29     | 29          | 484        | 27 / 1                  | 484                   |
| unthrottled | admin | Home → Admin                        | 1   | 28     | 28          | 664        | 19 / 8                  | 763                   |
| unthrottled | admin | Home → Admin                        | 2   | 28     | 28          | 428        | 21 / 8                  | 522                   |
| unthrottled | admin | Home → Admin                        | 3   | 22     | 22          | 521        | 19 / 9                  | 648                   |
| unthrottled | admin | Admin → Users                       | 1   | 29     | 29          | 363        | 25 / 6                  | 467                   |
| unthrottled | admin | Admin → Users                       | 2   | 29     | 29          | 328        | 26 / 6                  | 419                   |
| unthrottled | admin | Admin → Users                       | 3   | 28     | 28          | 428        | 26 / 6                  | 587                   |
| unthrottled | admin | Admin → Payments                    | 1   | 29     | 29          | 478        | 26 / 1                  | 490                   |
| unthrottled | admin | Admin → Payments                    | 2   | 29     | 29          | 462        | 26 / 1                  | 475                   |
| unthrottled | admin | Admin → Payments                    | 3   | 28     | 28          | 545        | 27 / 1                  | 560                   |
| unthrottled | admin | Users → a user                      | 1   | 27     | 27          | 496        | 24 / 1                  | 515                   |
| unthrottled | admin | Users → a user                      | 2   | 28     | 28          | 344        | 24 / 1                  | 357                   |
| unthrottled | admin | Users → a user                      | 3   | 30     | 30          | 345        | 24 / 1                  | 354                   |
| throttled   | guest | Home → Stays                        | 1   | 41     | 41          | 610        | 19 / 6                  | 1001                  |
| throttled   | guest | Home → Stays                        | 2   | 45     | 45          | 599        | 19 / 6                  | 970                   |
| throttled   | guest | Home → Stays                        | 3   | 42     | 42          | 655        | 19 / 6                  | 1053                  |
| throttled   | guest | Home → Bookings                     | 1   | 26     | 26          | 942        | 19 / 9                  | 1370                  |
| throttled   | guest | Home → Bookings                     | 2   | 28     | 28          | 949        | 19 / 8                  | 1371                  |
| throttled   | guest | Home → Bookings                     | 3   | 44     | 44          | 952        | 19 / 9                  | 1345                  |
| throttled   | guest | Home → Messages                     | 1   | 25     | 25          | 518        | 19 / 4                  | 908                   |
| throttled   | guest | Home → Messages                     | 2   | 41     | 41          | 585        | 19 / 4                  | 942                   |
| throttled   | guest | Home → Messages                     | 3   | 43     | 43          | 587        | 19 / 4                  | 950                   |
| throttled   | guest | Home → Waitlist                     | 1   | 43     | 43          | 557        | 19 / 4                  | 923                   |
| throttled   | guest | Home → Waitlist                     | 2   | 41     | 41          | 557        | 19 / 4                  | 945                   |
| throttled   | guest | Home → Waitlist                     | 3   | 39     | 39          | 555        | 19 / 4                  | 916                   |
| throttled   | guest | Home → Notifications (via the bell) | 1   | 57     | 57          | 626        | 21 / 1                  | 635                   |
| throttled   | guest | Home → Notifications (via the bell) | 2   | 59     | 59          | 660        | 21 / 1                  | 674                   |
| throttled   | guest | Home → Notifications (via the bell) | 3   | 62     | 62          | 557        | 21 / 1                  | 582                   |
| throttled   | guest | Home → Profile                      | 1   | 43     | 43          | 640        | 19 / 3                  | 1001                  |
| throttled   | guest | Home → Profile                      | 2   | 29     | 29          | 493        | 19 / 3                  | 856                   |
| throttled   | guest | Home → Profile                      | 3   | 39     | 39          | 604        | 19 / 3                  | 1001                  |
| throttled   | guest | Stays → a listing                   | 1   | 42     | 42          | 946        | 22 / 1                  | 757                   |
| throttled   | guest | Stays → a listing                   | 2   | 44     | 44          | 1017       | 22 / 1                  | 805                   |
| throttled   | guest | Stays → a listing                   | 3   | 45     | 45          | 896        | 22 / 1                  | 718                   |
| throttled   | guest | Bookings → a booking                | 1   | 33     | 33          | 740        | 24 / 1                  | 736                   |
| throttled   | guest | Bookings → a booking                | 2   | 31     | 31          | 819        | 25 / 1                  | 836                   |
| throttled   | guest | Bookings → a booking                | 3   | 31     | 31          | 703        | 25 / 1                  | 697                   |
| throttled   | guest | Messages → a thread                 | 1   | 40     | 40          | 642        | 20 / 3                  | 985                   |
| throttled   | guest | Messages → a thread                 | 2   | 44     | 44          | 652        | 20 / 3                  | 998                   |
| throttled   | guest | Messages → a thread                 | 3   | 39     | 39          | 756        | 20 / 3                  | 1112                  |
| throttled   | owner | Home → Dashboard                    | 1   | 26     | 26          | 450        | 19 / 10                 | 839                   |
| throttled   | owner | Home → Dashboard                    | 2   | 42     | 42          | 321        | 19 / 10                 | 723                   |
| throttled   | owner | Home → Dashboard                    | 3   | 54     | 54          | 436        | 19 / 10                 | 837                   |
| throttled   | owner | Dashboard → Payouts                 | 1   | 45     | 45          | 637        | 26 / 1                  | 964                   |
| throttled   | owner | Dashboard → Payouts                 | 2   | 44     | 44          | 535        | 26 / 1                  | 829                   |
| throttled   | owner | Dashboard → Payouts                 | 3   | 29     | 29          | 557        | 26 / 1                  | 864                   |
| throttled   | owner | Dashboard → a listing               | 1   | 30     | 30          | 857        | 26 / 1                  | 785                   |
| throttled   | owner | Dashboard → a listing               | 2   | 36     | 36          | 938        | 26 / 1                  | 863                   |
| throttled   | owner | Dashboard → a listing               | 3   | 30     | 30          | 842        | 26 / 1                  | 756                   |
| throttled   | admin | Home → Admin                        | 1   | 27     | 27          | 771        | 19 / 8                  | 1168                  |
| throttled   | admin | Home → Admin                        | 2   | 28     | 28          | 765        | 19 / 8                  | 1183                  |
| throttled   | admin | Home → Admin                        | 3   | 42     | 42          | 773        | 19 / 8                  | 1172                  |
| throttled   | admin | Admin → Users                       | 1   | 48     | 48          | 638        | 24 / 6                  | 1016                  |
| throttled   | admin | Admin → Users                       | 2   | 48     | 48          | 535        | 24 / 6                  | 897                   |
| throttled   | admin | Admin → Users                       | 3   | 48     | 48          | 521        | 24 / 6                  | 916                   |
| throttled   | admin | Admin → Payments                    | 1   | 31     | 31          | 691        | 24 / 1                  | 726                   |
| throttled   | admin | Admin → Payments                    | 2   | 32     | 32          | 785        | 24 / 1                  | 798                   |
| throttled   | admin | Admin → Payments                    | 3   | 34     | 34          | 684        | 24 / 1                  | 711                   |
| throttled   | admin | Users → a user                      | 1   | 54     | 54          | 639        | 22 / 1                  | 637                   |
| throttled   | admin | Users → a user                      | 2   | 29     | 29          | 696        | 22 / 1                  | 727                   |
| throttled   | admin | Users → a user                      | 3   | 32     | 32          | 647        | 22 / 1                  | 680                   |
