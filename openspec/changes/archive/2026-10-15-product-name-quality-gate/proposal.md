# Product name quality gate

## Why

The 2026-10-14 client audit showed catalog rows whose name is missing or meaningless ("YELLOW", "40 %", "70 cl · 41 %"), leaving a visitor unable to tell what a row is. Live catalog measurement (2026-10-15, 1,425 of 20,070 products sampled through `GET /api/v1/products`) sizes the actual problem differently than the audit assumed, and locates it more precisely:

- Fully empty names ≈ 0.07 % (product 11519 renders as bare volume/ABV chips).
- Non-informative names (no alphabetic content after ABV/volume/numeric tokens are stripped) ≈ 0.14 % ("ÀN 2022").
- Merchant-side annotations scraped into the name — "(saatavuus 1 plo)", "(erittäin rajallinen saatavuus, 1plo/asiakas)" — are 0.21 % overall AND over-represented exactly where visitors look: 2 of the top 25 rows under the default `BIGGEST_SAVING` sort are annotated collector items, headed by the 25 175,24 € Glenfarclas.

The audit's duplicate claims (two "Petrus", several "The Macallan") dissolved on inspection — different vintages and expressions, already governed by the dedup spec. The gap is not deduplication (specced) but name quality: `products.name` is stored verbatim from the merchant feed (D1 schema: "Display name from merchant feed"), and no requirement governs its informativeness or forbids merchant commentary in it. The audit's "YELLOW" example was itself a crawler truncation of a fine name — the real defects are rarer but concentrated on the most-viewed surface.

## What Changes

- **Ingestion gate**: a feed name that is empty, or carries fewer than 3 alphabetic characters after ABV/volume/pack/numeric tokens are stripped, is stored with a quarantined quality status — preserved raw for operator review, excluded from default public listings.
- **Annotation stripping**: parenthetical merchant availability/limit/rarity commentary is stripped from the display name at ingestion and preserved as annotation metadata.
- **Backfill**: one-time operator-run classification of the existing catalog (dry-run/stats/apply modes, pack-notation backfill precedent) that flags quarantined rows and strips stored annotations.
- **Listing integration**: catalog, search, unit-price ranking, and savings candidate queries exclude quarantined rows by default; the ops console lists the quarantined set for enrichment.

## Non-goals

- Cross-merchant deduplication and matcher coverage (already specced; the audit's duplicate examples were distinct products).
- Automatic enrichment from producer/EAN metadata — a later change once the quarantine queue shows its composition.
- Editorial name rewriting — the gate only quarantines and strips machine-detectable defects.
