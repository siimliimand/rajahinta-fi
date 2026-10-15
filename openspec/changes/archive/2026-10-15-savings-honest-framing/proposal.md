# Savings listing honest framing

## Why

The 2026-10-14 client audit flagged `/saastolista` ("Säästölista") showing products MORE expensive than Alko. Live verification (2026-10-15) confirms the mechanism and finds it sharper than the audit claimed:

- Across 20,070 evaluated products exactly 3 have favourable gaps — `GET /api/v1/savings/top` honestly reports `importFavourable: 3`. Most categories therefore have zero savings.
- The category listing orders by gap ascending per the spec, so with no negative-gap rows the top of the list is the LEAST-bad row — which is a positive-gap (loss) row rendered under a savings title. The beer category's first live rows are +7.90 € (Karhu III, +347 bps).
- The beer top row is worse than a framing problem: it pairs the Alko offer against itself (`merchant: "alko"`, `priceCents == alkoReferenceCents`, the gap being pure transport+duty) — not a cross-border comparison at all.

The spec's honest-zero scenario ("no snapshot rows exist for the requested category → empty list") never fires, because positive-gap rows DO exist. The zero state needs to key on the absence of negative-gap rows, and self-paired rows need exclusion. The cross-category `/top` endpoint already keeps the honest contract (negative-gap rows only, `importFavourable` coverage) and stays unchanged.

## What Changes

- **Category listing**: returns only negative-gap rows as savings rows; when a category has none, rows are empty and the coverage carries an explicit `hasFavourable: false` marker with the as-of date.
- **Self-pair exclusion**: a snapshot row whose offer is paired with the same merchant's Alko reference (no cross-border comparison) is excluded from savings listings.
- **Page zero-negative state**: `/savings` renders a category with zero negative-gap rows as an explicit "ei tällä hetkellä kannattavia tuonteja" state showing the as-of date and coverage counts — never a ranked loss list. The ordering statement and factual-copy rules stay.
- The market overview's largest-difference aggregates keep their existing informational labels (they answer a real question and are already governed by their own requirement).

## Non-goals

- The market-overview aggregates (largest absolute difference in both directions remains, clearly labeled).
- Gap computation, snapshot cadence, or reliability semantics.
- The best-per-merchant listing and the cross-category top-N listing (both already negative-gap-only).
