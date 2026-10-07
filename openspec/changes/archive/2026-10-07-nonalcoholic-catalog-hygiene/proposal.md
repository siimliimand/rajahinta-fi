# Proposal: nonalcoholic-catalog-hygiene

## Why

The alcohol catalog carries non-alcoholic groceries through merchant-feed
category mapping. In the first 300 rows of `other_fermented`
("Siideri ja pitkäjuoma") observed on 2026-10-04: **80 products at
0.0 % ABV and 42 with unknown ABV** — Red Bull energy drinks, San
Pellegrino and Ramlösa mineral waters, Schweppes tonics, Kirsikkamehu
(cherry juice). The live production catalog confirmed the pattern
(e.g. `Red Bull Sugarfree tölkki`, category `other_fermented`,
`alcoholByVolume: 0`).

These rows reach every derived surface, and on a trust-first product they
are a credibility defect:

- The savings page's market-overview headline for the category literally
  reads "Suurin ero: RED BULL Sugarfree 25CL x 24, 45.16 € kalliimpi kuin
  Alkon vertailuhinta" — an energy drink presented as a cross-border
  alcohol saving.
- Category averages ("Keskimääräinen havaittu hinta") are computed over a
  mix that includes soft drinks and multipacks.
- The €/g value ranking, trip-calculator benchmark averages, and the
  landed-cost calculator itself can be fed products with no alcohol at
  all, for which the entire excise computation is meaningless.

The feeds are individually honest; the defect is that category mapping
admits anything it cannot classify, and no read-side rule states that an
alcohol-category product must contain alcohol.

## What Changes

- Ingestion guard in the shared parser / source-category mapper: a row
  with parsed ABV = 0, or with no parsed ABV at all, SHALL NOT be
  assigned into an alcohol category. Such rows stay ingested (the
  "Unparseable alcohol fields ingest as ESTIMATED" contract is untouched)
  but are correction-flagged and held from user-facing surfaces pending
  review through the existing correction queue.
- One shared read-path predicate — alcohol-category products must have
  ABV > 0 and not be held-for-review — adopted by the product-search
  repository (catalog browse/ranked/ids paths), the savings-snapshot
  qualification and market-overview aggregates, and the €/g ranking
  query. A single definition prevents per-surface drift.
- An idempotent production audit script (dry-run default) enumerates the
  affected existing rows into the correction review flow, plus a runbook
  section for the operator.
- Golden/compliance/data-quality suites updated for the predicate;
  post-deploy verification that catalog, savings, and value surfaces
  return zero 0%-ABV rows.

## Capabilities

- `data-acquisition` — ADDED *Non-alcoholic rows barred from alcohol
  categories*.
- `product-catalog` — MODIFIED *Browsable catalog page*: held and
  non-alcoholic rows are outside the catalog's universe.
- `savings-discovery` — MODIFIED *Market overview aggregates*: aggregates
  observe the same product universe as the catalog.
