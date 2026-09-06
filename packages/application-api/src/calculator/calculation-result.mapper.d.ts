/**
 * Calculation-result mapper — reconstructs the LIVE calculation response
 * shape (CalculatorResult) from a persisted calculation record.
 *
 * Contract bug fix: `GET /api/v1/calculator/result/:recordId` previously
 * returned the raw `calculation_records` row while the frontend
 * (`CalculatorResult` in apps/frontend/src/lib/types.ts) expects the same
 * shape `POST /api/v1/calculator` returns.  This mapper rebuilds that shape
 * server-side so the result page renders a past calculation identically to
 * a fresh one.
 *
 * Provenance rules (design D2 — "a report can never diverge from the
 * calculation the user saw"):
 *
 * - Figures are copied VERBATIM from the record — `itemizedCosts` is the
 *   persisted `breakdown` JSON (the orchestrator stores the exact
 *   `ItemizedCost[]` it returned), `totalCents` is the persisted total, and
 *   the flat per-category fields are sums of the persisted lines.  Nothing
 *   is recomputed: no tax engine, no transport estimation, no price lookup.
 * - Product facts (name, volume, ABV, category) are joined from the
 *   product master via ProductRepository and converted exactly the way
 *   ProductDataAdapter converts them for the live path.
 * - Dataset version labels are resolved by primary key from the persisted
 *   `exciseRuleVersionId` / `containerDutyRuleVersionId` — labels only,
 *   never rate re-resolution.
 * - Fields the record genuinely does not persist degrade factually instead
 *   of being derived: `confidenceBreakdown` is empty (the page hides the
 *   section), `classification` carries a NotPersisted marker with an
 *   explanatory evidence summary, and `metadata.input.transportMethod` is
 *   omitted (optional in the frontend type).
 *
 * Pure — no I/O; the controller loads the record/product/rule rows and
 * passes them in.  Exported so tests exercise the mapping directly.
 *
 * @module CalculationResultMapper
 */
import type { calculationRecords, productMaster } from '@rajahinta/data-platform';
import type { CalculationResultResponse } from './calculator.dto';
/** Mapper input — everything the controller already loaded. */
export interface CalculationResultMapperInput {
    /** The persisted calculation-record row. */
    readonly record: typeof calculationRecords.$inferSelect;
    /** Product-master row for record.productMasterId, or null when absent. */
    readonly product: typeof productMaster.$inferSelect | null;
    /** Excise rule version label resolved by exciseRuleVersionId, null when unresolvable. */
    readonly exciseVersionLabel: string | null;
    /** Container-duty rule version label resolved by containerDutyRuleVersionId, null when unresolvable. */
    readonly containerVersionLabel: string | null;
}
/**
 * Reconstruct the live CalculatorResult shape from the persisted record.
 *
 * Product facts degrade factually when the master row is absent (FK makes
 * this near-impossible, but the page must render, never crash): the name
 * states the known fact, volume/ABV fall back to 0 — the same value the
 * live path produces for unparseable numerics.
 */
export declare function mapCalculationRecordToResult(input: CalculationResultMapperInput): CalculationResultResponse;
//# sourceMappingURL=calculation-result.mapper.d.ts.map