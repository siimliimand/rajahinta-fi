# Proposal: homepage-live-gap-hero

## Why

The homepage's most prominent evidence section is a fictional worked
example — 6 bottles of wine from Tallinn, "about €33.00 cheaper" —
explicitly labeled in both locales as illustrative (*"Luvut ovat
kuvitteellisia esimerkkiarvoja — ei reaaliaikaisia hintoja"*). A
skeptical visitor arriving for real savings sees invented figures in
the hero-adjacent position and no live evidence anywhere on the page.

Meanwhile the real machinery already exists: the daily
savings-snapshot materialization computes each product's landed cost
versus its Alko reference with provenance and an as-of day, and the
homepage already reads the market overview to gate its savings
task-card — it just never publishes the numbers. This is a publication
gap, not a data gap. Two concrete holes close: no cross-category
top-N read exists (the listing is category-scoped; the overview yields
only one largest difference per category), and no savings surface
links rows to product detail pages.

## What Changes

- **New public deterministic read** — `GET /api/v1/savings/top`
  returning the N rows (default 5, clamped) with the largest gaps
  among import-favourable rows (negative gap only) from the latest
  single-day snapshot across categories, ordered by the listing's own
  deterministic rule. Same staleness defenses as the per-category
  listing (non-null Alko reference, registry-resolvable product
  names), same guard chain (age gate + SAVINGS limiter); response
  carries the as-of date and coverage counts.
- **Homepage live section replaces the fictional example's
  hero-adjacent placement** — server-rendered top-5 (first-party
  prerender token + `revalidate` pattern matching the `/savings`
  overview read), each row linking to `/products/[id]`, the snapshot
  as-of date displayed beside the figures, and a staleness cutoff
  that renders the unavailable state instead of old figures.
- **Honest degradation** — empty snapshot or failed read renders a
  designed pending/unavailable state in the slot (the savings
  task-card's split); figures are never guessed and never presented
  as current when they are not.
- **The worked example is demoted, not deleted** — compacted into a
  small static "how it works" step strip below the live section,
  still example-labeled, still making no API call.
- **`/savings` listing rows become links** to `/products/[id]` so the
  main listing matches the hero's navigation affordance.
- **Compliance verification** — confirm the recorded written legal
  opinion (legal-review-gating) covers homepage display of snapshot
  prices; copy ships only with neutral factual vocabulary passing the
  content-policy lint in both locales (promotional "deal"-style
  wording is lint-forbidden by design).

## Capabilities

### New Capabilities

(none — both capabilities touched already exist)

### Modified Capabilities

- `savings-discovery`: ADDED requirement *Public deterministic
  cross-category top-N listing*; MODIFIED requirement *Savings page is
  informational and display-only* (listing rows link to product detail
  pages, figures and ordering unchanged).
- `web-application`: ADDED requirement *Homepage live
  observed-difference section*; MODIFIED requirement *Homepage worked
  example* (demoted to a compact how-it-works step below the live
  section).

## Impact

- `apps/api-worker/src/routes/savings.routes.ts` (+ `__tests__/`) —
  new top-N route on the existing Hono app; no schema, cron, or
  dependency changes.
- `apps/frontend/src/app/[locale]/page.tsx` + a new `HomeGapHero`
  component (+ `page.ssr.test.tsx`, `page.example.test.tsx`) — the
  homepage section swap.
- `apps/frontend/src/messages/fi.json` / `en.json` — new keys; both
  catalogs must pass the content-policy lint.
- `apps/frontend/src/app/[locale]/savings/components/SavingsListing.tsx`
  (+ its tests) — row links.
- `tests/e2e-browser/` — homepage journey assertions.
- Savings data remains display-only: no change to the calculator,
  ranking, or basket paths the compliance suite proves byte-identical.
