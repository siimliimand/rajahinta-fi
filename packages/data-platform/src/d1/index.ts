/**
 * D1 schema barrel — the Cloudflare-side counterpart of `src/index.ts`'s
 * schema export block.
 *
 * Import tables from here (not deep paths) so repository and module code
 * avoid circular dependency chains, mirroring the convention documented
 * in the canonical pg schema file.
 *
 * Excludes `priceObservations` by design — see the header of ./schema.ts
 * and design D4 (amended) of `openspec/changes/migrate-to-cloudflare/design.md`.
 *
 * @module D1Index
 */
export {
  ISO_8601_NOW,
  d1Schema,
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
  priceHistorySummaries,
  aggregationWatermarks,
  accounts,
  savedBaskets,
  savedScenarios,
  merchantTerms,
  basketCalculationRecords,
  fxRateDatasets,
  fxRates,
  sessions,
  auditEvents,
  clickCounterSnapshots,
  merchantRegistry,
} from './schema';
