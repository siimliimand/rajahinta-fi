# Catalog unit integrity and result trust

## Why

Deep UX analysis (2026-09-25, local stack + code trace + D1 counts) found the product's core number wrong by three orders of magnitude for ~95% of the catalog:

- `product_master.unit_volume` holds mixed units: 1,502 of 1,570 rows in millilitres (sweep ingestion writes `String(volumeMl)`), 68 in litres (PG seed/ETL). One string column, no unit marker.
- The calculator D1 port passes `unit_volume` through as litres (`apps/api-worker/src/adapters/d1-domain-ports.ts:86`), so sweep products compute excise and container duty on 500 "litres" instead of 0.5. Observed: "Koskenkorva 38% 50cl PET x 10 pullon laatikko" (€98.70) returned a €11,046.90 total — excise €10,693.20 (correct ≈ €10.69), container duty €255.00 (correct ≈ €0.26). Both lines badged VERIFIED.
- The €/g value ranking reads the same column (`unitprice.routes.ts`) and shows ethanol grams inflated 100× ("1,379,961.0 g" for a 24×0.33 l beer case) with a "0.00 ¢/g" row ranked #1.
- Search rows show `lowestPriceCents: null, merchantCount: 0` for products that do have offers (kippis), so the calculator shows no price anywhere before the final total.
- Display formatting leaks internals: `0.38% ABV` (fraction rendered with a % sign), `14.499999999999998% ABV` (raw float), `500.0000` package sizes with no unit, unescaped WooCommerce entities (`&#038;`, `&#8221;`, `&#215;`) in names, raw enums (`other_fermented`, `plastic`) in user-facing copy.

A tax calculator that is confidently wrong loses users faster than an honest beta; the "Verified" badge actively vouches for the wrong numbers.

## What Changes

### Canonical litres (data integrity)

- `DataMappingService.mapToProductAndOffer` writes `unit_volume` in litres (`volumeMl / 1000`), matching the engine contract (`calcPerLitreOfAlcohol` expects litres), the 68 legacy litre rows, and the PG seed convention.
- One-time backfill of stored rows: ml rows (value ≥ 5) divided by 1000; WooCommerce entities decoded in stored `name`/`brand`. Applied locally, in the seed pipeline (so reseeding cannot reintroduce ml), then staging/production after the worker deploy.
- Data-quality invariant `0 < unit_volume < 100` enforced in the ingestion quality stage and pinned by tests.
- D1 port keeps passthrough (litres canonical) and adds a defensive guard: implausible volumes (≥ 100 L) degrade reliability to ESTIMATED with a metric increment, never silently multiplied.

### Calculator sanity rail

- In core-domain: when a line's excise exceeds 5× that line's retail price (named, documented constant), the result's overall confidence drops to LOW, affected component statuses read ESTIMATED, and the result carries machine-readable `sanityNotes`. Amounts are never altered. The UI renders the degraded state visibly.

### Price visibility

- Search route offer aggregation fixed so `lowestPriceCents`/`merchantCount` match product-detail offers for the same product (kippis rows currently null/0).
- Calculator search rows render the lowest observed price; the Configure step shows the selected product's best current price.

### Display formatting

- `formatAbv` (fraction × 100, ≤ 1 decimal) and `formatVolume` (litres, trimmed, sensible l/cl rendering) helpers applied across search rows, products listing, product detail, calculator, and compare.
- Enum labels (category, containerType) rendered through message catalogs (fi/en parity pinned by the messages test).

## Decisions

- **D1: canonical litres at ingestion, not division at the D1 port.** Port-side division would leave ml in the DB to poison the €/g ranking, search, and future consumers, and invites double conversion. Litres match the engine contract and the majority legacy convention. The port guard (≥ 100 L degrades) covers residual bad rows.
- **D2: entities decoded at ingestion, not at render.** Output stays escaped per guardrails; decoding stored source text once at mapping plus a name backfill is the durable fix. Display-time decoding would fight output escaping forever.
- **D3: the sanity rail never changes amounts.** It changes confidence/status labels and adds an explanation, per the "every number is explainable" guardrail. Golden fixtures are sane and stay green; the rail exists so a future data regression degrades visibly instead of failing loudly in production.

## Non-goals (this change)

- kippis offers stamped `country: FI` (seller-country signal; affects import VAT) — separate change.
- Merchants ingested while governance is PENDING — separate governance fix.
- Product dedupe across feeds (duplicate Corona/Saku entries) — separate normalization work.
- Real transport dataset; €0.00 UNAVAILABLE transport stays a known gap.
- Per-unit price display for multi-pack catalog entries.
- No new merchants, no parser generalization.
