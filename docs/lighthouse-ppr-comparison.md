# Phase 11 (partial prerendering): Lighthouse before / after

_"Phase 11" in this report is partial prerendering, which was dropped from the roadmap afterwards; phase 11 of `docs/plan.md` is now the end-to-end tests of the frontend._

- Site: https://booking-beige-five.vercel.app, signed in with the README demo accounts (guest / owner / admin)
- Before: `docs/lighthouse-2026-11-17.md`, the deployment without Phase 11 (per the owner; taken 2026-11-17T18:38Z)
- After: the deployment with Phase 11, taken 2026-11-17T20:30Z
- Same method both times: Lighthouse 13.6.0, default mobile profile (Slow 4G, 4x CPU slowdown), 3 runs per page, medians; session cookies set in the browser via CDP, a fresh login before every run, every run ended on the requested URL
- A change smaller than the noise floor (score 1, FCP/SI 100 ms, LCP 150 ms, TBT 20 ms, CLS 0.005, TTFB 5 ms) is marked ≈

## Overall (mean of the per-page medians, 20 pages)

| Metric  | Before | After | Change        | Pages better / same / worse |
| ------- | ------ | ----- | ------------- | --------------------------- |
| Score   | 99     | 97    | −2 (worse)    | 0 / 11 / 9                  |
| FCP s   | 0.83   | 0.93  | +0.10 (worse) | 0 / 4 / 16                  |
| LCP s   | 1.40   | 2.36  | +0.96 (worse) | 1 / 8 / 11                  |
| TBT ms  | 79     | 52    | −27 (better)  | 11 / 8 / 1                  |
| CLS     | 0.001  | 0.000 | −0.001 (≈)    | 1 / 18 / 1                  |
| SI s    | 1.09   | 1.14  | +0.05 (≈)     | 6 / 6 / 8                   |
| TTFB ms | 24     | 24    | +0 (≈)        | 0 / 20 / 0                  |

## Reading the results

**Verdict: on this measurement Phase 11 did not make the signed-in pages faster. The Lighthouse score is slightly lower, mostly because LCP moved later.**

- **Score**: no page improved by more than the noise; 9 of 20 pages lost 2–4 points, 11 are unchanged. Mean 99 → 97.
- **FCP**: about 0.14 s later on 16 of 20 pages (0.80 → 0.93 s). Four pages that were already at 0.95–0.97 s stayed there.
- **LCP**: the main loss. 11 pages went from 0.8–1.0 s to 2.4–2.7 s (+1.6 to +1.9 s). Pages whose LCP was already about 2.5–2.9 s (`/bookings`, `/bookings/:id`, reviews, `/messages`, `/admin/users*`) did not move.
- **TBT**: the clear gain. It fell on 11 pages, often from 55–95 ms to 13–15 ms (`/profile` 96 → 13, `/guests/:id/reviews` 85 → 14, `/admin/payments` 73 → 13), and from 331 to 267 ms on `/dashboard/payouts`.
- **TTFB** is 24–25 ms in both runs on every page; **CLS** is 0 in both, except `/dashboard/payouts` (0.029 → 0.001) and `/messages` (0 → 0.006).

### Caveats

- **TTFB did not change at all.** Every page answered in about 24 ms before Phase 11 as well, signed in. A server render that waits for the API would normally take much longer, so the "before" documents were probably already served from an edge cache or a static shell. I could not confirm which build was live during the first run; the "before" label comes from the owner, not from a response header (`x-nextjs-prerender` is present now, and was not checked then).
- **The LCP jump is probably a change in what counts as the largest paint, not a slower page.** Where LCP equalled FCP before (0.80 s), the largest element was something in the early shell; after Phase 11 the largest element is the content that streams in later (about 2.4–2.7 s). If that is right, the first paint is unchanged and the content is what takes 2.5 s in both cases. A per-page look at the LCP element in the Lighthouse JSON would settle it; it was not done here.
- One measurement of 3 runs per page, from one machine in WSL, simulated throttling, on a demo deployment with a shared database; the two batches ran about two hours apart. Differences of a few score points are close to what repeated runs of one build give.
- Lighthouse measures a cold load of one URL. Partial prerendering is meant to help client-side navigations (prefetched shells), which this test does not exercise.

## Per page (median of 3, before → after)

| Role  | Page                                                       | Score                | FCP s                      | LCP s                       | TBT ms                  | CLS                            | SI s                        | TTFB ms         |
| ----- | ---------------------------------------------------------- | -------------------- | -------------------------- | --------------------------- | ----------------------- | ------------------------------ | --------------------------- | --------------- |
| admin | `/admin`                                                   | 100 → 96 (−4, worse) | 0.80 → 0.94 (+0.14, worse) | 0.80 → 2.74 (+1.94, worse)  | 45 → 42 (−3, ≈)         | 0.000 → 0.000 (0.000, ≈)       | 0.92 → 1.36 (+0.44, worse)  | 24 → 25 (+1, ≈) |
| admin | `/admin/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`     | 100 → 100 (0, ≈)     | 0.96 → 0.94 (−0.03, ≈)     | 0.96 → 0.94 (−0.03, ≈)      | 71 → 79 (+8, ≈)         | 0.000 → 0.000 (0.000, ≈)       | 1.05 → 1.02 (−0.03, ≈)      | 25 → 24 (−1, ≈) |
| admin | `/admin/payments`                                          | 100 → 96 (−4, worse) | 0.80 → 0.93 (+0.13, worse) | 0.80 → 2.73 (+1.93, worse)  | 73 → 13 (−60, better)   | 0.000 → 0.000 (0.000, ≈)       | 0.89 → 1.08 (+0.19, worse)  | 24 → 25 (+1, ≈) |
| admin | `/admin/users`                                             | 97 → 97 (0, ≈)       | 0.79 → 0.93 (+0.14, worse) | 2.67 → 2.66 (−0.02, ≈)      | 66 → 26 (−40, better)   | 0.000 → 0.000 (0.000, ≈)       | 1.13 → 1.02 (−0.10, better) | 25 → 24 (−1, ≈) |
| admin | `/admin/users/f31df292-8ced-45a4-9d37-228436edede7`        | 97 → 97 (0, ≈)       | 0.79 → 0.93 (+0.14, worse) | 2.66 → 2.66 (−0.00, ≈)      | 52 → 24 (−28, better)   | 0.000 → 0.000 (0.000, ≈)       | 1.15 → 0.98 (−0.17, better) | 24 → 24 (0, ≈)  |
| guest | `/bookings`                                                | 95 → 95 (0, ≈)       | 0.80 → 0.94 (+0.14, worse) | 2.89 → 2.88 (−0.01, ≈)      | 70 → 85 (+16, ≈)        | 0.000 → 0.000 (0.000, ≈)       | 1.18 → 1.07 (−0.12, better) | 24 → 24 (0, ≈)  |
| guest | `/bookings/3de95ac0-a0b6-4e8d-b283-da7b85a271e2`           | 96 → 96 (0, ≈)       | 0.79 → 0.93 (+0.14, worse) | 2.82 → 2.73 (−0.08, ≈)      | 59 → 13 (−46, better)   | 0.000 → 0.000 (0.000, ≈)       | 1.17 → 0.98 (−0.19, better) | 24 → 24 (0, ≈)  |
| guest | `/guests/d3c85338-9783-437c-b3d8-5d06de418e21/reviews`     | 97 → 98 (+1, ≈)      | 0.79 → 0.93 (+0.13, worse) | 2.59 → 2.43 (−0.16, better) | 85 → 14 (−72, better)   | 0.000 → 0.000 (0.000, ≈)       | 1.32 → 0.98 (−0.34, better) | 24 → 24 (0, ≈)  |
| guest | `/`                                                        | 100 → 100 (0, ≈)     | 0.79 → 0.93 (+0.14, worse) | 0.79 → 0.93 (+0.14, ≈)      | 39 → 47 (+8, ≈)         | 0.000 → 0.000 (0.000, ≈)       | 0.90 → 0.93 (+0.03, ≈)      | 24 → 25 (+1, ≈) |
| guest | `/listings`                                                | 100 → 96 (−4, worse) | 0.96 → 0.93 (−0.02, ≈)     | 0.96 → 2.58 (+1.62, worse)  | 67 → 95 (+28, worse)    | 0.000 → 0.000 (0.000, ≈)       | 1.06 → 1.05 (−0.01, ≈)      | 24 → 25 (+1, ≈) |
| guest | `/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`           | 100 → 96 (−4, worse) | 0.97 → 0.94 (−0.03, ≈)     | 0.97 → 2.73 (+1.76, worse)  | 73 → 86 (+13, ≈)        | 0.000 → 0.000 (0.000, ≈)       | 1.20 → 1.49 (+0.28, worse)  | 25 → 24 (−1, ≈) |
| guest | `/messages`                                                | 97 → 98 (+1, ≈)      | 0.80 → 0.93 (+0.13, worse) | 2.52 → 2.43 (−0.09, ≈)      | 56 → 14 (−43, better)   | 0.000 → 0.006 (+0.006, worse)  | 1.20 → 1.08 (−0.12, better) | 24 → 25 (+1, ≈) |
| guest | `/messages/7e8ba50e-2a32-4d45-afd8-d3b36cf5dcc3`           | 100 → 97 (−3, worse) | 0.80 → 0.94 (+0.14, worse) | 0.80 → 2.59 (+1.79, worse)  | 64 → 13 (−51, better)   | 0.000 → 0.001 (+0.001, ≈)      | 0.89 → 1.11 (+0.22, worse)  | 25 → 25 (0, ≈)  |
| guest | `/notifications`                                           | 100 → 98 (−2, worse) | 0.79 → 0.93 (+0.14, worse) | 0.79 → 2.43 (+1.64, worse)  | 75 → 15 (−60, better)   | 0.000 → 0.000 (0.000, ≈)       | 0.90 → 0.99 (+0.09, ≈)      | 25 → 25 (0, ≈)  |
| guest | `/profile`                                                 | 99 → 98 (−1, ≈)      | 0.79 → 0.93 (+0.14, worse) | 0.79 → 2.43 (+1.64, worse)  | 96 → 13 (−83, better)   | 0.000 → 0.000 (0.000, ≈)       | 0.96 → 1.00 (+0.04, ≈)      | 24 → 24 (0, ≈)  |
| guest | `/waitlist`                                                | 100 → 97 (−3, worse) | 0.80 → 0.93 (+0.14, worse) | 0.80 → 2.58 (+1.78, worse)  | 72 → 14 (−58, better)   | 0.000 → 0.000 (0.000, ≈)       | 0.89 → 1.06 (+0.18, worse)  | 24 → 25 (+1, ≈) |
| owner | `/dashboard`                                               | 100 → 97 (−3, worse) | 0.80 → 0.93 (+0.13, worse) | 0.80 → 2.50 (+1.70, worse)  | 40 → 28 (−12, ≈)        | 0.000 → 0.000 (0.000, ≈)       | 0.92 → 1.02 (+0.11, worse)  | 24 → 24 (0, ≈)  |
| owner | `/dashboard/listings/50b36c9f-d306-4bfc-be55-c4015d3b8156` | 100 → 96 (−4, worse) | 0.96 → 0.94 (−0.02, ≈)     | 0.97 → 2.74 (+1.77, worse)  | 75 → 67 (−8, ≈)         | 0.000 → 0.000 (0.000, ≈)       | 1.04 → 1.31 (+0.27, worse)  | 24 → 25 (+1, ≈) |
| owner | `/dashboard/listings/new`                                  | 100 → 100 (0, ≈)     | 0.80 → 0.94 (+0.14, worse) | 0.80 → 0.94 (+0.14, ≈)      | 71 → 83 (+12, ≈)        | 0.000 → 0.000 (0.000, ≈)       | 0.97 → 1.26 (+0.28, worse)  | 24 → 24 (0, ≈)  |
| owner | `/dashboard/payouts`                                       | 92 → 92 (0, ≈)       | 0.81 → 0.95 (+0.14, worse) | 0.81 → 2.51 (+1.70, worse)  | 331 → 267 (−64, better) | 0.029 → 0.001 (−0.028, better) | 2.00 → 1.93 (−0.07, ≈)      | 24 → 24 (0, ≈)  |

## All runs

### admin `/admin`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.80 / 92 / 0.000 / 24                   | 96 / 2.74 / 33 / 0.000 / 24                   |
| 2   | 100 / 0.80 / 43 / 0.000 / 24                   | 96 / 2.81 / 42 / 0.000 / 25                   |
| 3   | 100 / 0.80 / 45 / 0.000 / 24                   | 96 / 2.73 / 98 / 0.000 / 28                   |

### admin `/admin/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.96 / 39 / 0.000 / 25                   | 100 / 0.94 / 85 / 0.000 / 24                  |
| 2   | 100 / 0.96 / 71 / 0.000 / 26                   | 100 / 0.93 / 79 / 0.000 / 24                  |
| 3   | 100 / 0.79 / 76 / 0.000 / 24                   | 100 / 0.94 / 74 / 0.000 / 24                  |

### admin `/admin/payments`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 99 / 0.80 / 95 / 0.000 / 24                    | 96 / 2.74 / 12 / 0.000 / 25                   |
| 2   | 100 / 0.80 / 42 / 0.000 / 24                   | 96 / 2.73 / 13 / 0.000 / 26                   |
| 3   | 100 / 0.80 / 73 / 0.000 / 24                   | 96 / 2.73 / 30 / 0.000 / 25                   |

### admin `/admin/users`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.79 / 71 / 0.000 / 25                   | 97 / 2.66 / 25 / 0.000 / 24                   |
| 2   | 97 / 2.67 / 57 / 0.000 / 24                    | 97 / 2.66 / 26 / 0.000 / 24                   |
| 3   | 96 / 2.67 / 66 / 0.000 / 25                    | 97 / 2.58 / 34 / 0.000 / 24                   |

### admin `/admin/users/f31df292-8ced-45a4-9d37-228436edede7`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 97 / 2.66 / 52 / 0.000 / 24                    | 97 / 2.66 / 24 / 0.000 / 24                   |
| 2   | 100 / 0.79 / 38 / 0.000 / 24                   | 97 / 2.66 / 28 / 0.000 / 25                   |
| 3   | 97 / 2.67 / 56 / 0.000 / 29                    | 97 / 2.58 / 13 / 0.000 / 24                   |

### guest `/bookings`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 95 / 2.89 / 57 / 0.000 / 24                    | 95 / 2.89 / 85 / 0.000 / 24                   |
| 2   | 95 / 2.90 / 86 / 0.000 / 24                    | 95 / 2.88 / 92 / 0.000 / 24                   |
| 3   | 95 / 2.89 / 70 / 0.000 / 24                    | 95 / 2.88 / 44 / 0.000 / 26                   |

### guest `/bookings/3de95ac0-a0b6-4e8d-b283-da7b85a271e2`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 96 / 2.82 / 51 / 0.000 / 24                    | 96 / 2.74 / 11 / 0.000 / 24                   |
| 2   | 96 / 2.82 / 59 / 0.000 / 24                    | 96 / 2.73 / 13 / 0.000 / 24                   |
| 3   | 95 / 2.82 / 102 / 0.000 / 24                   | 96 / 2.73 / 14 / 0.000 / 24                   |

### guest `/guests/d3c85338-9783-437c-b3d8-5d06de418e21/reviews`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 97 / 2.59 / 85 / 0.000 / 24                    | 98 / 2.43 / 13 / 0.000 / 24                   |
| 2   | 97 / 2.59 / 91 / 0.000 / 24                    | 98 / 2.43 / 15 / 0.000 / 24                   |
| 3   | 97 / 2.59 / 85 / 0.000 / 25                    | 98 / 2.43 / 14 / 0.001 / 25                   |

### guest `/`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.79 / 39 / 0.000 / 24                   | 100 / 0.93 / 83 / 0.000 / 25                  |
| 2   | 100 / 0.79 / 62 / 0.000 / 25                   | 100 / 0.93 / 47 / 0.000 / 24                  |
| 3   | 100 / 0.79 / 38 / 0.000 / 24                   | 100 / 0.93 / 15 / 0.000 / 25                  |

### guest `/listings`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.96 / 46 / 0.000 / 24                   | 96 / 2.67 / 107 / 0.000 / 28                  |
| 2   | 100 / 0.97 / 67 / 0.000 / 25                   | 96 / 2.58 / 95 / 0.000 / 25                   |
| 3   | 99 / 0.80 / 96 / 0.000 / 24                    | 97 / 2.58 / 29 / 0.000 / 24                   |

### guest `/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.99 / 77 / 0.000 / 25                   | 96 / 2.58 / 109 / 0.000 / 26                  |
| 2   | 100 / 0.97 / 73 / 0.000 / 25                   | 96 / 2.73 / 86 / 0.000 / 24                   |
| 3   | 100 / 0.96 / 71 / 0.000 / 26                   | 96 / 2.73 / 74 / 0.000 / 24                   |

### guest `/messages`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 97 / 2.52 / 80 / 0.000 / 24                    | 97 / 2.50 / 25 / 0.006 / 25                   |
| 2   | 100 / 0.81 / 43 / 0.000 / 24                   | 98 / 2.43 / 12 / 0.006 / 24                   |
| 3   | 97 / 2.52 / 56 / 0.000 / 24                    | 98 / 2.43 / 14 / 0.006 / 27                   |

### guest `/messages/7e8ba50e-2a32-4d45-afd8-d3b36cf5dcc3`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.96 / 72 / 0.001 / 25                   | 97 / 2.58 / 12 / 0.001 / 25                   |
| 2   | 100 / 0.79 / 64 / 0.000 / 24                   | 97 / 2.59 / 15 / 0.001 / 25                   |
| 3   | 100 / 0.80 / 40 / 0.000 / 25                   | 97 / 2.59 / 13 / 0.001 / 26                   |

### guest `/notifications`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 97 / 2.59 / 80 / 0.000 / 25                    | 98 / 2.43 / 0 / 0.000 / 26                    |
| 2   | 100 / 0.79 / 75 / 0.000 / 25                   | 98 / 2.43 / 15 / 0.000 / 25                   |
| 3   | 100 / 0.78 / 69 / 0.000 / 24                   | 97 / 2.58 / 32 / 0.000 / 24                   |

### guest `/profile`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 99 / 0.79 / 125 / 0.000 / 24                   | 98 / 2.43 / 13 / 0.000 / 25                   |
| 2   | 100 / 0.79 / 62 / 0.000 / 24                   | 98 / 2.43 / 13 / 0.000 / 24                   |
| 3   | 99 / 0.79 / 96 / 0.000 / 26                    | 98 / 2.44 / 15 / 0.000 / 24                   |

### guest `/waitlist`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.80 / 76 / 0.000 / 24                   | 97 / 2.58 / 14 / 0.000 / 25                   |
| 2   | 100 / 0.82 / 41 / 0.000 / 24                   | 97 / 2.58 / 14 / 0.000 / 24                   |
| 3   | 100 / 0.80 / 72 / 0.000 / 24                   | 97 / 2.43 / 80 / 0.000 / 25                   |

### owner `/dashboard`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.80 / 38 / 0.000 / 24                   | 97 / 2.51 / 35 / 0.000 / 24                   |
| 2   | 100 / 0.80 / 40 / 0.000 / 24                   | 97 / 2.50 / 28 / 0.000 / 25                   |
| 3   | 97 / 2.54 / 85 / 0.000 / 24                    | 98 / 2.43 / 14 / 0.000 / 24                   |

### owner `/dashboard/listings/50b36c9f-d306-4bfc-be55-c4015d3b8156`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 95 / 2.82 / 88 / 0.000 / 24                    | 96 / 2.74 / 59 / 0.000 / 26                   |
| 2   | 100 / 0.97 / 61 / 0.000 / 25                   | 96 / 2.73 / 88 / 0.000 / 24                   |
| 3   | 100 / 0.96 / 75 / 0.000 / 24                   | 96 / 2.74 / 67 / 0.000 / 25                   |

### owner `/dashboard/listings/new`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 100 / 0.96 / 73 / 0.000 / 27                   | 100 / 0.94 / 83 / 0.000 / 25                  |
| 2   | 100 / 0.80 / 43 / 0.000 / 24                   | 100 / 0.93 / 82 / 0.000 / 24                  |
| 3   | 100 / 0.79 / 71 / 0.000 / 24                   | 100 / 0.94 / 87 / 0.000 / 24                  |

### owner `/dashboard/payouts`

| Run | Before: score / LCP s / TBT ms / CLS / TTFB ms | After: score / LCP s / TBT ms / CLS / TTFB ms |
| --- | ---------------------------------------------- | --------------------------------------------- |
| 1   | 91 / 0.81 / 371 / 0.029 / 24                   | 88 / 2.43 / 405 / 0.001 / 25                  |
| 2   | 93 / 0.82 / 318 / 0.001 / 25                   | 92 / 2.51 / 267 / 0.001 / 24                  |
| 3   | 92 / 0.81 / 331 / 0.029 / 24                   | 92 / 2.51 / 255 / 0.001 / 24                  |
