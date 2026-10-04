# Design: savings-listing-savings-first-order

## Context

The listing's sign convention (gap = landed − reference, positive = loss)
met the spec's "descending" wording and produced losses-first presentation.
With the matching pipeline live, real negative gaps exist and the ordering
inverts the page's purpose.

## Decisions

### D1 — Flip the pure comparator, not the route

`compareSavingsRows` in `packages/core-domain/src/savings/ordering.ts` is
the single ordering point (route and page both consume it). One-line sign
flip: `a.gapBasisPoints - b.gapBasisPoints`. Tiebreaks unchanged (name asc,
then product id). The route stays a thin applicator; no API shape change.

### D2 — Limits sized to category reality

Categories hold 37–1,000 rows today and grow with coverage. DEFAULT 200
serves every category's meaningful listing at ~60 KB worst case; MAX 500
bounds explicit requests. The clamp keeps the endpoint bounded per the
deterministic-listing contract; paging was considered and rejected — the
page is a single informational surface, not a browsable index (same D6
reasoning the sitemap uses for page ≥ 2 states).

### D3 — Copy mirrors the comparator exactly

The page contract states the ordering rule in copy "exactly as
sortSavingsRows orders" (frontend test pins this). Both locales update:
fi subtitle "suurimman säästön mukaan ensin", informational note "suurin
säästö ensin"; en mirrors. The informationalNote's other clauses
(determinism, no effect on search/computed surfaces) are preserved
verbatim.

### D4 — Overview aggregates untouched

The "Suurin ero" market-overview highlights are a separate requirement
(deterministic aggregates over observed data, objective criteria). They
keep their own selection logic; only the LISTING order changes.

## Risks

- Downstream consumers of the listing order: none known — the trip page
  reads a single suggestion stat, not the ordered listing; compliance
  byte-identity tests are order-independent (they pin computed outputs,
  not the savings listing).
- Payload growth (50 → 200 rows): ~60 KB worst case, well inside the
  route's rate-limit and cache posture.
