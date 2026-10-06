# Design: savings-first-catalog-and-prefill

## Context

Three constraints shape every decision here:

1. **Isolation compliance.** `tests/compliance/savings-snapshot-isolation.test.ts`
   enforces two patterns: a static import scan (no ranking/calculation-input
   producer — core-domain ranking, calculator, tax, optimizer, tripcalc, and the
   product-search repository — may import a savings module) and a dynamic
   output-identity claim (landed-cost calculation, €/g ranking, and basket
   optimization are byte-identical with zero, one, and many snapshot rows).
   Ordering by gap as a *display* is already compliance-proven: the /savings
   listing does exactly that.
2. **Default-sort history.** LOWEST_PRICE fronted a miniature wall;
   ALPHABETICAL fronted a junk-name wall. BIGGEST_SAVING's failure mode is
   different: coverage. Only products with an Alko reference (direct offer with
   an observation timestamp, or the foreign side of a CONFIRMED link) have a
   snapshot row at all.
3. **Calculation-record hygiene.** `calculator.calculate` persists a record by
   design (bounded by the retention sweep). A prefill that silently runs
   calculations on every tool-page open would mint records for drive-by
   traffic.

## Decisions

### D1 — The savings join lives in the route, never in the repository

`search.routes.ts` composes two repositories: the existing product listing path
plus `D1SavingsSnapshotRepository.findLatestDay()` (the same full-day read the
savings routes do — the repository documents the ~10⁴-row fetch as safe). The
product-search repository file gains no savings import, so the static scan
passes untouched. The repository's own sort orders are unchanged; the new
order is a route-level app-side sort, the same shape as the alphabetical
contract's app-side FI collation sort.

### D2 — BIGGEST_SAVING ordering and the no-reference tier

Covered rows: `gapBasisPoints` ascending (most negative = biggest relative
saving first), then FI `localeCompare` name, then product id — the
`sortSavingsRows` rule extended with the catalog's alphabetical tie-break so
the order is total and deterministic per (data, day).

Uncovered rows (no snapshot row for the latest day): after every covered row,
alphabetically. In the default order the page renders a quiet divider between
the tiers with an honest label ("Ei Alko-vertailua" / "No Alko reference");
cards in that tier render no gap UI at all. Non-default sorts render one
undivided list (tiering is a property of the savings ordering, not of the
catalog).

Negative gaps (dearer than Alko) are covered rows and state the fact plainly —
the same factual framing the /savings overview uses ("X kalliimpi kuin Alkon
vertailuhinta"). Honest negative evidence is part of the promise.

### D3 — The embed is attached to the page, the sort map is page-scale

For BIGGEST_SAVING the route must see every matching row's gap before slicing
the page, so it sorts the full matched set app-side (the alphabetical order
already pays this cost). For every sort order, the page's 24 items get the
`savings` embed via a map lookup against the same latest-day read. One
repository read per request, two uses — the savings route's one-read-two-uses
pattern. The response carries `savingsAsOf` so every rendered figure is
explainable to its day.

### D4 — Best-per-merchant is an argmax, not a list

`GET /api/v1/savings/best-per-merchant` groups the latest day's rows by
`bestMerchant`, reduces each group to max |gapCents| with product-id ascending
as the tie-break, and excludes `alko` (its rows are the reference side, not a
deal). Response: one row per cross-border merchant with the same provenance
fields as the savings listing, plus `asOf`. While no day has materialized the
endpoint returns 200 with an empty list — the honest zero state, never an
error. New merchants join on first materialization; there is nothing to
register and nothing to curate.

### D5 — Prefill shows snapshot figures; only the visitor starts calculations

The calculator's example cards render the snapshot's own landed total and gap
(no `calculate` call, no new calculation records). Selecting a card loads that
product into the existing selector flow and the visitor triggers the
calculation as usual. Compare genuinely prefills columns (read-only offer data
— cheap, no records). The basket never auto-adds: the empty state lists the
deals with per-item add buttons and a one-click "fill example basket" action,
so the visitor's intent stays the author of the basket.

All prefill content is example-labeled (the homepage worked example's
labeling pattern) and links to /savings for the full live listing. With four
cross-border merchants today the compare grid opens with four columns plus
the add tile; the responsive grid wraps — acceptable, and the count grows
only when a merchant actually onboarded.

### D6 — Pagination windowing

`prev / 1 … (p−2..p+2) … last / next` with ellipsis spans; current page as a
non-link; the `pageStatus` sentence retained. ~443 anchor elements become ≤9
regardless of catalog size. URLs and page semantics are unchanged (true
pagination over the filtered set, same contract).

## Risks and follow-ups

- **Sort stability across days**: the default order legitimately changes at
  the daily grain. Canonical URLs exclude `sort`, so the index sees one
  stable URL per (category, page) whose content updates daily — the same
  contract the /savings page already lives with.
- **Coverage share unknown**: if the covered share of the ~10⁴-product catalog
  is small, the default view's first pages are the interesting ones and the
  divider lands early — acceptable, and the /savings coverage counts make the
  share public already.
- **Compliance suite**: task 4.1 registers the two new display readers in the
  isolation test's documentation and asserts the identity claims still hold;
  the calculation/ranking/optimization surfaces themselves are untouched.
- **`nonalcoholic-catalog-hygiene` interplay**: its read-path predicate
  filters held rows out of the same route file; land it first, rebase this
  change's route work on top (both changes' tests pin different behaviors —
  no semantic conflict).
