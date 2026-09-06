# Design: drop-sweden-eur-only-alko-benchmark

## Context

The Systembolaget feed is the only live merchant source, and it is the reason the FX machinery exists: the adapter converts SEK to EUR cents at ingestion using versioned FX datasets, records provenance on `retail_offers`, and feeds the FX version into idempotency cache keys and the operator console's publish flow. Removing Sweden without removing FX would leave a conversion pipeline with no caller. The user decisions for this change: clean cut (empty foreign catalog accepted; German/Estonian feeds come later), full FX removal, and inclusion of the Alko benchmark.

## Decisions

### D1: Clean cut, not a hide

The adapter, registry wiring, and queryable data rows are removed rather than disabled. Rationale: a hidden feed still shows up in the merchant registry, governance reviews, and operator console, which contradicts "no Sweden content and logic". The Systembolaget merchant id disappears from seeds and from test fixtures (renamed to neutral ids) so vocabulary sweeps do not flag it forever.

### D2: The R2 observation log is retained

The data-immutability principle (ARCHITECTURE.md §5) says observations are written once and never rewritten. Deleting historical JSONL partitions for a removed merchant is a data-destruction decision that needs its own governance record. This change removes every queryable projection of the data (D1 rows, summaries, registry) and leaves the R2 log as an untouchable historical record. No code path reads it for systembolaget products after the purge.

### D3: EUR invariant, not just absent conversion

Going EUR-only is enforced at the type level, not by convention: the currency union collapses to the `'EUR'` literal, so any future non-EUR feed fails to compile until FX is reintroduced deliberately. The `retailOffers.currency` column stays (value `'EUR'`) to avoid a second column-drop migration; the invariant is checked in the data-quality tests. The unconvertible-offer exclusion path in the calculator is deleted with the FX module, because offers can no longer be unconvertible.

### D4: Migration strategy for D1 column drops

`fx_rate_datasets` and `fx_rates` drop cleanly. Dropping `original_price_cents`, `original_currency`, and `fx_dataset_version` from `retail_offers` may require a table rebuild if SQLite's `ALTER TABLE ... DROP COLUMN` hits a constraint (indexed or referenced columns). The migration is written as a rebuild-from-template if needed, forward-only, no down-migration. The legacy Postgres schema gets the equivalent Drizzle migration so the legacy suites stay green.

### D5: No feature flags

This is a removal plus one small additive field, not a compliance-sensitive rollout. Flags would imply instant rollback for behavior that no longer exists. Rollback is `git revert` plus redeploy; the forward-only migrations are documented as non-reverting, which is acceptable because the removed data has no future query path. The launch gates are unaffected: the calculator keeps operating behind them exactly as today.

### D6: Benchmark is a display-only enrichment

The Alko reference offer already exists in `retailOffers` (merchant `'alko'`, EAN-linked by the domestic reference feed). The benchmark module is pure: given the offer the calculation used and the product's Alko offers, produce price, difference, percent, reliability, and `observedAt`, or `unavailable`. The calculator resolves the reference through the existing product-data port, so no new ingestion or lookup machinery is introduced.

Design constraints:

- The field is optional in the DTO and in the persisted record. Records created before this change simply lack it; the UI renders nothing rather than a placeholder. This follows the same pattern the dupe panel uses for unreviewed products: absence, not a guess.
- The benchmark is excluded from `totalCents`, from the itemized breakdown array, and from every ranking input type (which already structurally reject unknown fields, but the compliance test proves the point for this field specifically).
- Wording is factual in both locales and must pass the content-policy lint: it states the Alko price and the difference, and says plainly when importing is not cheaper. No promotional vocabulary, no recommendations.

### D7: Copy keeps a future-facing, honest posture

The hero keeps the landed-cost value proposition without naming any market ("from abroad to Finland" in both locales). The trust row names the data model, not the missing catalog: "published retailer datasets and the Alko domestic reference", matching what actually exists. Search empty states keep their existing neutral copy; no "coming soon" promises for specific markets.

## Risks

- Empty foreign catalog after the purge: search and compare return little until a new feed lands. Mitigation: honest copy (this change), Alko benchmark keeps the calculator meaningful in the meantime.
- Persisted records without `alkoBenchmark`: result pages for old records must not error. Covered by an optional-field render test.
- D1 column-drop constraints: handled by the rebuild strategy (D4); verified by the D1 suite.
- Test churn from fixture renames is broad but mechanical; the sweep task catches stragglers before the full verification run.

## Verification plan

Typecheck, lint, content lint, unit, golden, data-quality, compliance, e2e, D1 suites, and browser e2e journeys, plus a local `dev-up.sh` smoke of search, calculate, and the benchmark line. A repository sweep must show zero non-archive hits for `systembolaget`, `SEK`, and `ecb-rate` in code, seeds, and message catalogs.
