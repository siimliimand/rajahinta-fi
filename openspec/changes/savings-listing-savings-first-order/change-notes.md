# Change notes: savings-listing-savings-first-order

## What shipped

The `/savings` listing now leads with actual savings. `compareSavingsRows`
(core-domain pure ordering) flipped to gap-basis-points **ascending** — the
most negative gap (largest saving) first, product-name and product-id
tiebreaks unchanged. Route limits: `DEFAULT_LIMIT` 50 → 200,
`MAX_LIMIT` 100 → 500. Page copy states the new rule in both locales
(subtitle, informational note, table caption — fi "suurin säästö ensin",
en "largest saving first").

## Why

The Alko-reference matching pipeline materialized the first honest
cross-border comparisons (2026-10-04: 49 linked pairs, 7 genuine wins, best
−€41.55) — and the old ordering (gap descending + 50-row clamp) buried every
win behind hundreds of loss rows. A page named "savings" led with its worst
numbers. The flip is one sign change in the pure comparator; the market
overview aggregates ("Suurin ero" highlights) are a separate requirement and
untouched; display-only isolation is order-independent and the compliance
suite is green.

## Verification

- core-domain: 56 files / 1,497 tests (ordering suite re-pinned ascending)
- api-worker: 67 files / 1,145 tests (route contract flipped: first row =
  largest saving; clamp 200 default / 500 max; clamping (not 400) above max)
- frontend: 102 files / 1,177 tests (ordering-rule copy pins updated)
- compliance: 15 files / 127 checks PASSED (savings isolation — computed
  outputs byte-identical, order-independent)
- typecheck: core-domain, api-worker, frontend — clean

## Post-deploy live check

```bash
curl -s -H "x-age-confirmed: 1" "https://api.rajahinta.fi/api/v1/savings?category=spirits" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); rows=d['rows']; \
wins=[r for r in rows if r['gapCents']<0]; \
print(len(rows),'rows; first:',rows[0]['productName'],rows[0]['gapCents']/100,'€; wins served:',len(wins))"
```

Expected: first row is a negative gap (Crystal Head Vodka 1.75 l, −41.55 €),
≥7 wins within the served window; `https://www.rajahinta.fi/savings` renders
200 with "suurin säästö ensin" copy.

## Terminality / rollback

Plain `git revert` of the change commits — pure ordering + copy, no
migration, no data effects.
