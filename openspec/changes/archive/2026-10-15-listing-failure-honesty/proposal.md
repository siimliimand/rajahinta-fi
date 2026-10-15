# Listing failure honesty

## Why

The 2026-10-14 client experience audit captured `/grammahinta` rendering "The listing could not be loaded — The backend did not respond". Live investigation (2026-10-15) shows the endpoint healthy (beer/wine_still/spirits all HTTP 200 in 0.5–1.2 s, CORS preflight 204), so the audit captured a crawl-time failure whose UI message blamed the backend. `ValueRanking` collapses every failure into one `.catch → setFailed(true)`: an age-gate 403 (a crawler or fresh browser sends no `x-age-confirmed`), a 429, the 10 s abort timeout, a network error, and a real 5xx all render the identical "backend did not respond" state. The same generic ErrorState backs the blog and guides embeds.

Two structural gaps compound the conflated message:

- A failed listing render offers only retry — no last-known-good data with an as-of label.
- The Grafana alert set thresholds D1 spend and feed cadence but no public-endpoint error rate, so a dead listing surface is discovered by visitors. This is the second time: `unitprice-ranking-scale-fix` documented the same page "100 % dead in production" found by a Finnish visitor.

## What Changes

- **Failure-class mapping on the client fetch layer**: `ApiFetchError` carries the HTTP status and a derived failure class (age-gate | rate-limited | timeout | server | network); surfaces render the class-specific state instead of one generic message.
- **Stale-while-error fallback on the unit-price ranking**: the last successful per-category response persists client-side and renders, labeled with its as-of date, whenever a later fetch fails; the retry affordance stays alongside.
- **Grafana alert rule** on the existing Analytics Engine route-pattern × status-class counters: a public listing route's 5xx share above threshold for a sustained window pages the operator (extends the `d1-spend-alerts` provisioning pattern).

## Non-goals

- Server-side response caching or CDN semantics for the ranking endpoint (the scale fix keeps it a live read; the fallback is client-side).
- Changes to the age-gate contract itself (server guards, cookie semantics).
- RUM/funnel instrumentation changes beyond what the alert rule needs.
