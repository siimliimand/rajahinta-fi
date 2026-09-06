# fx-rate-dataset Specification

## REMOVED Requirements

### Requirement: Versioned FX rate dataset

**Reason:** The service is EUR-only. All current and planned merchant markets price in EUR, so versioned FX datasets have no consumer. The module, tables, and publication flow are deleted rather than kept dormant.

**Migration:** Drop `fx_rate_datasets` and `fx_rates` through forward migrations; delete `packages/core-domain/src/fx/**`, the ECB rate source, and the FX dataset review service; remove the operator-console publish flow.

### Requirement: Conversion at ingestion with provenance

**Reason:** Ingestion no longer converts. Offers arrive in EUR and are stored in EUR cents; the SEK provenance columns on `retail_offers` (`original_price_cents`, `original_currency`, `fx_dataset_version`) are dropped.

**Migration:** Forward column-drop migrations on Postgres and D1 (table rebuild if SQLite constraints require); ingestion composition rewired without the conversion step.

### Requirement: Calculator sums converted currency only

**Reason:** Superseded by the single-currency invariant: every offer carries the `'EUR'` literal at the type level, and the unconvertible-offer exclusion path is deleted with the FX module.

**Migration:** Currency union collapses to `'EUR'`; calculator and data-mapping tests updated to the invariant.

### Requirement: FX dataset version invalidates caches

**Reason:** No FX dataset version exists to key on. Idempotency cache keys keep the tax and transport version components only.

**Migration:** Remove the FX component from cache-key composition in `IdempotencyService` and `IdempotencyDO`; existing cached entries expire naturally by the remaining version components.
