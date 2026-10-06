# Design: homepage-live-gap-hero

## Context

The savings snapshot machinery is complete (see proposal.md — Why):
`D1SavingsSnapshotRepository.findLatestDay()` serves the single-day
read, `sortSavingsRows` (packages/core-domain/src/savings/ordering)
defines the deterministic order, and `savings.routes.ts` holds the
staleness-defense pattern (non-null Alko reference filter +
registry-resolvable name filter). The `/savings` page already
server-fetches the overview with the first-party prerender token
(`SERVER_AGE_CONFIRMATION_TOKEN`) and `revalidate: 900`. Product
detail pages exist at `/products/[id]`. The content-policy lint
polices both message catalogs; `legal-review-gating` requires a
recorded written Finnish legal opinion covering price-list provisions.

## Goals / Non-Goals

**Goals:** real top-5 hero with product links and as-of display;
honest pending/unavailable degradation; example demoted to a how-it-
works step; `/savings` rows link product pages; zero change to
computation surfaces.

**Non-Goals:** no snapshot schema change, no new cron, no new input
surface, no promotional copy, no change to calculator/ranking/basket.

## Decisions

- **D1 — Endpoint shape.** `GET /api/v1/savings/top?limit=N`, default
  5, hard clamp 25 (hero + small embeds, not a bulk export). Response
  mirrors the listing row shape plus `asOf` and coverage counts
  (evaluated / importFavourable / listed). Route parity: direct
  source imports, `ageGate()` + SAVINGS limiter, exactly like the
  sibling routes.
- **D2 — Selection rule (user-decided).** Import-favourable only:
  filter to `gapCents < 0`, then `sortSavingsRows` (gap basis points
  ascending, product name ascending tie), then slice. The explicit
  negativity filter prevents padding the hero with dearer-than-Alko
  rows when fewer than five products qualify. The hero never shows a
  product more expensive than the reference.
- **D3 — Degradation split (user-decided).** Pending state when the
  latest day has no eligible rows; unavailable state when the server
  read fails — the same two-state vocabulary as the savings task-card
  (`savings-card-pending`). The slot stays layout-stable and the
  empty state links into `/savings`.
- **D4 — Freshness display and cutoff.** As-of line beside the
  section heading, formatted per locale (the savings page's
  `overviewDate` precedent). Server fetch mirrors the overview read:
  prerender token, `revalidate: 900`. Staleness cutoff: if the latest
  snapshot day is more than **3 days** old, render the unavailable
  state instead of figures — a stalled cron must not headline old
  numbers as current. The cutoff is a named constant in the homepage
  module (coarse at 15-minute ISR grain, which is acceptable for a
  daily-grain dataset).
- **D5 — Compliance treatment (user-decided).** Proceed on the
  `/savings` precedent (its market overview already server-renders
  largest differences with names and prices publicly), with neutral
  framing and the as-of date; task 4.4 verifies the recorded legal
  opinion covers the homepage surface and records the finding in this
  file's compliance note below.
- **D6 — Row links.** Whole-row link via next-intl `Link` to
  `/products/[id]`; the link is a navigation affordance only and must
  not change figures or ordering (asserted in tests). Applied to both
  the hero and `/savings` listing rows.

## Risks

- **Homepage latency:** the server fetch is cached (`revalidate: 900`);
  worst case one upstream read per 15 minutes per isolate — same cost
  profile as the existing overview read.
- **"Updated daily" perception:** the cron materializes daily in
  cursor chunks; the as-of line is the honest label, and D4's cutoff
  bounds staleness presentation.
- **Content lint strictness:** words like "top" and "deal" are banned;
  copy review happens at task 2.1 with the lint as the gate, before
  the hero component consumes the keys.

## Compliance note

Verified 2026-10-06 (task 4.4): the written Finnish legal opinion is
recorded as obtained in `docs/launch-signoff-record.md` (T1.65,
signed off 2026-09-03, evidence archived), covering all 12 statutory
topics under *Alkoholilaki 1102/2017* — among them **price-list /
price-information provisions** and **comparative advertising**, the
two topics this section engages. The homepage live section publishes
the same data kind (per-product observed prices, Alko reference, gap)
as the already-shipped `/savings` market overview, under the same
neutrality constraints (content-policy lint, as-of labeling, no
advice phrasing).

Caveat recorded: the opinion predates this homepage surface. Its
published record does not enumerate placement- or prominence-specific
conditions; if the archived opinion evidence attaches any such
conditions to price-information display, they should be re-checked
against a hero placement before archive. No new claim type is
introduced by this change.
