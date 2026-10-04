# Proposal: savings-listing-savings-first-order

## Why

The Alko-reference matching pipeline materialized its first honest
cross-border comparisons on 2026-10-04: 49 linked pairs, **7 genuine wins**
(Crystal Head Vodka 1.75 l at −€41.55, Yellow Rose Outlaw Bourbon −€16.07,
Don Julio Blanco −€8.79 …). The listing served none of them: the spec pins
ordering as gap basis points **descending** — which in the implemented sign
convention (gap = landed − reference; positive = more expensive) serves the
largest LOSSES first — and the 50-row default clamp buries every win below
hundreds of loss rows. A page named "savings" led with its worst numbers and
hid its best: the exact inversion of its pitch that the matching pipeline
just fixed at the data layer.

## What Changes

- `sortSavingsRows` (core-domain pure ordering) flips to gap basis points
  **ascending** — the largest saving (most negative gap) first, product
  name ascending tiebreak, product id final tiebreak unchanged.
- Route defaults: `DEFAULT_LIMIT` 50 → 200, `MAX_LIMIT` 100 → 500 (the
  listing is category-scoped; spirits alone outgrew 50 long ago).
- The `/savings` page's stated ordering rule updates in both locales
  (fi: "suurin säästö ensin", en mirror) — subtitle and informational note.
- Spec delta: `savings-discovery` "Public deterministic savings listing" —
  ordering requirement flips to ascending. Nothing else moves: the market
  overview aggregates (the "Suurin ero" highlights) are a separate
  deterministic requirement and stay untouched; display-only isolation and
  the byte-identity compliance suite are order-independent and stay green.

## Capabilities

### Modified Specifications

- `specs/savings-discovery/spec.md` — the public listing orders by gap
  basis points ascending (largest saving first).
