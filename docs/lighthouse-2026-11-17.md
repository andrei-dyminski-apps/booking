# Lighthouse performance — booking-beige-five.vercel.app (signed in)

- Date: 2026-11-17
- Lighthouse 13.6.0, Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.0.0 Safari/537.36
- Profile: Lighthouse default — mobile emulation (Moto G Power, 412x823), simulated Slow 4G throttling, 4x CPU slowdown; performance category only
- Runs: 3 per page, run in sequence from a WSL machine; a fresh login before every run
- Auth: demo accounts from the README (`guest@`, `owner@`, `admin@example.com`), session cookies sent as a `Cookie` header; every page was checked to end on the requested URL (no redirect to `/login`)
- Units: FCP/LCP/SI in seconds, TBT/TTFB in ms, CLS unitless
- Median is taken per metric across the 3 runs

## Summary (median of 3)

| Role  | Page                                                       | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| ----- | ---------------------------------------------------------- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| admin | `/admin`                                                   | 100   | 0.80 | 0.80 | 45  | 0.000 | 0.92 | 24   |
| admin | `/admin/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`     | 100   | 0.96 | 0.96 | 71  | 0.000 | 1.05 | 25   |
| admin | `/admin/payments`                                          | 100   | 0.80 | 0.80 | 73  | 0.000 | 0.89 | 24   |
| admin | `/admin/users`                                             | 97    | 0.79 | 2.67 | 66  | 0.000 | 1.13 | 25   |
| admin | `/admin/users/f31df292-8ced-45a4-9d37-228436edede7`        | 97    | 0.79 | 2.66 | 52  | 0.000 | 1.15 | 24   |
| guest | `/bookings`                                                | 95    | 0.80 | 2.89 | 70  | 0.000 | 1.18 | 24   |
| guest | `/bookings/3de95ac0-a0b6-4e8d-b283-da7b85a271e2`           | 96    | 0.79 | 2.82 | 59  | 0.000 | 1.17 | 24   |
| guest | `/guests/d3c85338-9783-437c-b3d8-5d06de418e21/reviews`     | 97    | 0.79 | 2.59 | 85  | 0.000 | 1.32 | 24   |
| guest | `/`                                                        | 100   | 0.79 | 0.79 | 39  | 0.000 | 0.90 | 24   |
| guest | `/listings`                                                | 100   | 0.96 | 0.96 | 67  | 0.000 | 1.06 | 24   |
| guest | `/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`           | 100   | 0.97 | 0.97 | 73  | 0.000 | 1.20 | 25   |
| guest | `/messages`                                                | 97    | 0.80 | 2.52 | 56  | 0.000 | 1.20 | 24   |
| guest | `/messages/7e8ba50e-2a32-4d45-afd8-d3b36cf5dcc3`           | 100   | 0.80 | 0.80 | 64  | 0.000 | 0.89 | 25   |
| guest | `/notifications`                                           | 100   | 0.79 | 0.79 | 75  | 0.000 | 0.90 | 25   |
| guest | `/profile`                                                 | 99    | 0.79 | 0.79 | 96  | 0.000 | 0.96 | 24   |
| guest | `/waitlist`                                                | 100   | 0.80 | 0.80 | 72  | 0.000 | 0.89 | 24   |
| owner | `/dashboard`                                               | 100   | 0.80 | 0.80 | 40  | 0.000 | 0.92 | 24   |
| owner | `/dashboard/listings/50b36c9f-d306-4bfc-be55-c4015d3b8156` | 100   | 0.96 | 0.97 | 75  | 0.000 | 1.04 | 24   |
| owner | `/dashboard/listings/new`                                  | 100   | 0.80 | 0.80 | 71  | 0.000 | 0.97 | 24   |
| owner | `/dashboard/payouts`                                       | 92    | 0.81 | 0.81 | 331 | 0.029 | 2.00 | 24   |

## All runs

### admin `/admin`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.80 | 0.80 | 92  | 0.000 | 1.04 | 24   |
| 2   | 100   | 0.80 | 0.80 | 43  | 0.000 | 0.92 | 24   |
| 3   | 100   | 0.80 | 0.80 | 45  | 0.000 | 0.87 | 24   |

### admin `/admin/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.96 | 0.96 | 39  | 0.000 | 1.05 | 25   |
| 2   | 100   | 0.96 | 0.96 | 71  | 0.000 | 1.05 | 26   |
| 3   | 100   | 0.79 | 0.79 | 76  | 0.000 | 0.86 | 24   |

### admin `/admin/payments`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 99    | 0.80 | 0.80 | 95  | 0.000 | 1.05 | 24   |
| 2   | 100   | 0.80 | 0.80 | 42  | 0.000 | 0.88 | 24   |
| 3   | 100   | 0.80 | 0.80 | 73  | 0.000 | 0.89 | 24   |

### admin `/admin/users`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.79 | 0.79 | 71  | 0.000 | 0.89 | 25   |
| 2   | 97    | 0.80 | 2.67 | 57  | 0.000 | 1.13 | 24   |
| 3   | 96    | 0.79 | 2.67 | 66  | 0.000 | 1.13 | 25   |

### admin `/admin/users/f31df292-8ced-45a4-9d37-228436edede7`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 97    | 0.79 | 2.66 | 52  | 0.000 | 1.16 | 24   |
| 2   | 100   | 0.79 | 0.79 | 38  | 0.000 | 0.87 | 24   |
| 3   | 97    | 0.80 | 2.67 | 56  | 0.000 | 1.15 | 29   |

### guest `/bookings`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 95    | 0.80 | 2.89 | 57  | 0.000 | 1.18 | 24   |
| 2   | 95    | 0.80 | 2.90 | 86  | 0.000 | 1.22 | 24   |
| 3   | 95    | 0.79 | 2.89 | 70  | 0.000 | 1.17 | 24   |

### guest `/bookings/3de95ac0-a0b6-4e8d-b283-da7b85a271e2`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 96    | 0.79 | 2.82 | 51  | 0.000 | 1.17 | 24   |
| 2   | 96    | 0.80 | 2.82 | 59  | 0.000 | 1.19 | 24   |
| 3   | 95    | 0.79 | 2.82 | 102 | 0.000 | 1.13 | 24   |

### guest `/guests/d3c85338-9783-437c-b3d8-5d06de418e21/reviews`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 97    | 0.79 | 2.59 | 85  | 0.000 | 1.32 | 24   |
| 2   | 97    | 0.80 | 2.59 | 91  | 0.000 | 1.15 | 24   |
| 3   | 97    | 0.79 | 2.59 | 85  | 0.000 | 1.43 | 25   |

### guest `/`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.79 | 0.79 | 39  | 0.000 | 0.97 | 24   |
| 2   | 100   | 0.79 | 0.79 | 62  | 0.000 | 0.90 | 25   |
| 3   | 100   | 0.79 | 0.79 | 38  | 0.000 | 0.85 | 24   |

### guest `/listings`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.96 | 0.96 | 46  | 0.000 | 1.06 | 24   |
| 2   | 100   | 0.97 | 0.97 | 67  | 0.000 | 1.06 | 25   |
| 3   | 99    | 0.80 | 0.80 | 96  | 0.000 | 0.99 | 24   |

### guest `/listings/2e3ab28a-b8e5-4abd-a053-a34ebd8316f3`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.99 | 0.99 | 77  | 0.000 | 1.20 | 25   |
| 2   | 100   | 0.97 | 0.97 | 73  | 0.000 | 1.05 | 25   |
| 3   | 100   | 0.96 | 0.96 | 71  | 0.000 | 1.22 | 26   |

### guest `/messages`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 97    | 0.80 | 2.52 | 80  | 0.000 | 1.35 | 24   |
| 2   | 100   | 0.81 | 0.81 | 43  | 0.000 | 0.97 | 24   |
| 3   | 97    | 0.79 | 2.52 | 56  | 0.000 | 1.20 | 24   |

### guest `/messages/7e8ba50e-2a32-4d45-afd8-d3b36cf5dcc3`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.96 | 0.96 | 72  | 0.001 | 1.08 | 25   |
| 2   | 100   | 0.79 | 0.79 | 64  | 0.000 | 0.89 | 24   |
| 3   | 100   | 0.80 | 0.80 | 40  | 0.000 | 0.87 | 25   |

### guest `/notifications`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 97    | 0.79 | 2.59 | 80  | 0.000 | 1.12 | 25   |
| 2   | 100   | 0.79 | 0.79 | 75  | 0.000 | 0.90 | 25   |
| 3   | 100   | 0.78 | 0.78 | 69  | 0.000 | 0.85 | 24   |

### guest `/profile`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 99    | 0.79 | 0.79 | 125 | 0.000 | 0.99 | 24   |
| 2   | 100   | 0.79 | 0.79 | 62  | 0.000 | 0.89 | 24   |
| 3   | 99    | 0.79 | 0.79 | 96  | 0.000 | 0.96 | 26   |

### guest `/waitlist`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.80 | 0.80 | 76  | 0.000 | 0.87 | 24   |
| 2   | 100   | 0.82 | 0.82 | 41  | 0.000 | 1.92 | 24   |
| 3   | 100   | 0.80 | 0.80 | 72  | 0.000 | 0.89 | 24   |

### owner `/dashboard`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.80 | 0.80 | 38  | 0.000 | 0.89 | 24   |
| 2   | 100   | 0.80 | 0.80 | 40  | 0.000 | 0.92 | 24   |
| 3   | 97    | 0.81 | 2.54 | 85  | 0.000 | 1.27 | 24   |

### owner `/dashboard/listings/50b36c9f-d306-4bfc-be55-c4015d3b8156`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 95    | 0.94 | 2.82 | 88  | 0.000 | 1.18 | 24   |
| 2   | 100   | 0.97 | 0.97 | 61  | 0.000 | 0.97 | 25   |
| 3   | 100   | 0.96 | 0.96 | 75  | 0.000 | 1.04 | 24   |

### owner `/dashboard/listings/new`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 100   | 0.96 | 0.96 | 73  | 0.000 | 1.13 | 27   |
| 2   | 100   | 0.80 | 0.80 | 43  | 0.000 | 0.94 | 24   |
| 3   | 100   | 0.79 | 0.79 | 71  | 0.000 | 0.97 | 24   |

### owner `/dashboard/payouts`

| Run | Score | FCP  | LCP  | TBT | CLS   | SI   | TTFB |
| --- | ----- | ---- | ---- | --- | ----- | ---- | ---- |
| 1   | 91    | 0.81 | 0.81 | 371 | 0.029 | 1.90 | 24   |
| 2   | 93    | 0.82 | 0.82 | 318 | 0.001 | 2.00 | 25   |
| 3   | 92    | 0.81 | 0.81 | 331 | 0.029 | 2.07 | 24   |

## Notes

- No redirects and no Lighthouse run warnings.
