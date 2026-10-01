# Data quality gates and publication trust

## Why

A live evidence walk (2026-09-30, FI + EN, real API paths a customer's browser takes: search → select → calculate → browse) found four Tier-1 trust-breaking pains. Every one is a headline promise published without the data that must stand behind it:

- **Transport €0.00 / UNAVAILABLE** — `POST /api/v1/calculator` for 6×1.5 L spirits returns `transport cents: 0, reliability: UNAVAILABLE`; every result carries confidence LOW. The Posti curated dataset intentionally starts empty (`posti-rate.source.ts`: the price-list endpoint 403s datacenter/Cloudflare egress, no Wayback captures), the calculator degrades exactly as designed — and the UI prints the numeric channel (€0.00) as if it were a real price.
- **Savings page permanently empty** — the homepage advertises the "landed-cost gap versus the Alko reference" listing; `GET /api/v1/savings?category=spirits` reports `withReference: 0` of 4,414 products. The snapshot cron honestly materializes nothing ("absence is the honest state"), because zero Alko reference offers exist in production `retail_offers`. The adapter (`alko.adapter.ts`) is golden-fixture tested — the data never landed.
- **€0.00 products top "cheapest first"** — `GET /api/v1/products?sort=LOWEST_PRICE` crowns "R de Ruinart Champagne … @ €0.00". The comparator is correct (`null` sorts last); the hole is upstream: `readMinorUnitCents` accepts the literal `"0"` (unset WooCommerce variable-product price), and the benchmark module codifies "zero allowed — a free offer is structurally valid input". No layer ever asks whether a free champagne is plausible.
- **Implausible catalog rows on first browse** — "Karhu Olut 5.3% 24×33 l" (€21.99 for "33 litres"; the existing `0 < unit_volume < 100` invariant catches 100× errors, and 33 l passes it), the same Karhu listed three times as near-duplicates, Jameson in 16 variants, bundles like "…+ Jägermeister 0" parsed as products.

The common shape: the domain already speaks honest absence — status-carrying results, unavailable reasons, a snapshot cron that refuses to fabricate gaps — but surfaces render numbers and row counts unconditionally, and ingestion has no plausibility gates for price or category-bounded volume. For a data-quality brand, each pain reads as "the one number I came for is a guess — why is this even published?"

This change is the designated successor to `unit-integrity-and-result-trust` (archived 2026-09-26): it takes up three of its explicit non-goals (cross-feed dedupe investigation, real transport data, multipack catalog handling) and extends its volume invariant rather than replacing it. It does not re-propose anything `client-experience-improvement` (archived 2026-09-27) already shipped — the sort implementation, hero search, and age-gate recovery are done and verified.

## What Changes

### Ingestion plausibility gates (code, testable)

- Price floor: a mapped offer with `priceCents <= 0` is rejected at mapping time as price drift (the parser's `readMinorUnitCents` stays structural); a data-quality counter records rejections. A zero-priced product becomes offer-less and honestly sorts last.
- Category-bounded volume ceilings (beer ≤ 2 l, wine ≤ 6 l, spirits ≤ 3 l per unit — constants in one table): a volume outside its category bound is nulled with a review flag, never published; replaces the implicit "everything under 100 l is fine" with per-category plausibility while keeping the 0–100 l invariant as the outer rail.
- Multipack-aware volume parsing: `24×0,33 l` parses deterministically to unit 330 ml / pack 24 instead of first-token-wins meeting a shop typo.
- Bundle-name rejection: multi-product names ("+ Jägermeister 0") are held for review instead of becoming products with arbitrary parsed ABV/volume.
- Golden fixtures and a pipeline contract test pin the class: no €0 offer, no category-implausible volume, no bundle publishes.

### Data landing (ops, not codeable)

- Alko reference feed ingestion is run in production and verified: `withReference` before/after counts and the EAN join hit-rate are recorded in change notes. This alone populates the savings listing — the cron, route, and honest empty state already work; they are starving.
- Posti's parcel price table is transcribed into `POSTI_RATES` per the documented admin procedure and `POSTI_OBSERVED_AT` is bumped, giving the calculator real transport rows for its lanes.

### Publication honesty (frontend)

- Transport `UNAVAILABLE` renders an explicit "not included — transport dataset pending" state instead of €0.00, following the calculator sanity-rail precedent (statuses and labels change; amounts are never altered). LOW-confidence copy explains itself instead of reading as a defect badge.
- The homepage savings card reads the existing overview response and renders an honest state when `withReference: 0` — the flagship feature is never advertised into an empty room.

### Observability (Phase 1 lane)

- A Grafana data-quality panel: zero-price rejections, implausible-volume share, Alko reference coverage %, transport-row count per carrier, per-feed last-success age — with threshold alerts. Each of the four pains was visible in a counter before a customer felt it; this makes the next one page instead.

### Investigation (spike only)

- Cross-feed near-dupe quantification (the 16-Jameson question): exact-key collapse candidates (EAN; brand+volume+ABV tuple) counted over production data, findings written up to feed a future dedupe change. Implementation deliberately out of scope — the "no similarity scoring" isolation boundary is a spec decision, not a task.

## Decisions

- **D1: gates reject to absence/review; they never "fix" data.** A rejected price makes the product offer-less; a rejected volume nulls the field and flags review. This is the house pattern (unit-price status-carrying, "a guessed gap never materializes") applied at ingestion.
- **D2: category ceilings extend the existing invariant.** `0 < unit_volume < 100` stays as the outer rail for unit-conversion errors; per-category bounds add plausibility inside it. No invariant is weakened.
- **D3: data landing is ops work with recorded evidence**, not application code. Both tasks produce verifiable before/after facts in change notes; neither adds an adapter or a field.
- **D4: honesty states change labels and visibility, never amounts.** Sanity-rail precedent (D3 of `unit-integrity-and-result-trust`): a degraded surface says what is missing; it does not silently substitute or recompute.
- **D5: dedupe ships as a spike, not a feature.** Cross-merchant dedupe crosses the "no similarity scoring" spec boundary; the change that crosses it needs its own proposal grounded in the spike's numbers.
- **D6: no feature flags.** The flag system was removed 2026-09-07; everything ships enabled and rollback is `wrangler rollback`.

## Non-goals (this change)

- Cross-feed dedupe implementation — spike and report only (D5).
- Per-unit price display for multipack catalog entries (parsing is in scope; display stays a unit-integrity non-goal for now).
- Load-environment catalog seeding for Phase 1 performance runs — separate platform work; noted because today's empty-path catalog would otherwise certify SLOs about an experience no customer is having.
- New feed adapters or ingestion fields; live Posti fetching remains blocked by the source's CDN policy.
- Anything already shipped by `client-experience-improvement` (sort, hero, age gate) or `unit-integrity-and-result-trust` (litres canonicalization, sanity rail, display formatting).
