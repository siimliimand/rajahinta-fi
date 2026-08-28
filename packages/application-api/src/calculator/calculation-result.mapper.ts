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

import type {
  ConfidenceLevel,
  CostCategory,
  Disclaimer,
  ItemizedCost,
  ReliabilityStatus,
} from '@rajahinta/core-domain';
import type { calculationRecords, productMaster } from '@rajahinta/data-platform';
import type { CalculationResultResponse } from './calculator.dto';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Narrowing helpers — jsonb/text columns are `unknown`; degrade factually
// ---------------------------------------------------------------------------

const RELIABILITY_STATUSES: readonly ReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

const COST_CATEGORIES: readonly CostCategory[] = [
  'foreignRetailPrice',
  'transportCost',
  'alcoholExciseEstimate',
  'containerDutyEstimate',
  'otherCharges',
];

const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];

function isReliabilityStatus(value: unknown): value is ReliabilityStatus {
  return (
    typeof value === 'string' &&
    (RELIABILITY_STATUSES as readonly string[]).includes(value)
  );
}

function isCostCategory(value: unknown): value is CostCategory {
  return (
    typeof value === 'string' &&
    (COST_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Narrow the persisted confidence string to the domain union.
 * Unknown values degrade to LOW — confidence is never overstated.
 */
function toConfidenceLevel(value: string): ConfidenceLevel {
  return (CONFIDENCE_LEVELS as readonly string[]).includes(value)
    ? (value as ConfidenceLevel)
    : 'LOW';
}

/**
 * Parse a Drizzle numeric string to a float — the exact conversion
 * ProductDataAdapter applies for the live calculation path.
 */
function parseNumeric(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Breakdown parsing — the persisted `breakdown` is the orchestrator's
// ItemizedCost[]; validate shape so a malformed row renders, never crashes
// ---------------------------------------------------------------------------

function toItemizedCost(raw: unknown): ItemizedCost | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;

  // Category outside the vocabulary still carries a figure — attribute it
  // to otherCharges rather than dropping a persisted amount.
  const category: CostCategory = isCostCategory(entry.category)
    ? entry.category
    : 'otherCharges';

  // Reliability outside the vocabulary degrades to UNAVAILABLE — never
  // overstated (mirrors ProductDataAdapter's legacy-value handling).
  const reliability: ReliabilityStatus = isReliabilityStatus(entry.reliability)
    ? entry.reliability
    : 'UNAVAILABLE';

  const cents =
    typeof entry.cents === 'number' && Number.isFinite(entry.cents)
      ? entry.cents
      : 0;

  // Nested sub-lines (e.g. the retail line's per-unit breakdown) pass
  // through verbatim when well-formed.
  const nested = Array.isArray(entry.breakdown)
    ? entry.breakdown
        .map(toItemizedCost)
        .filter((c): c is ItemizedCost => c !== null)
    : undefined;

  return {
    label: typeof entry.label === 'string' ? entry.label : '',
    category,
    cents,
    reliability,
    ...(nested !== undefined && nested.length > 0 ? { breakdown: nested } : {}),
  };
}

function parseItemizedCosts(breakdown: unknown): ItemizedCost[] {
  if (!Array.isArray(breakdown)) return [];
  return breakdown
    .map(toItemizedCost)
    .filter((c): c is ItemizedCost => c !== null);
}

function parseRetailOfferIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is number => typeof id === 'number');
}

// ---------------------------------------------------------------------------
// Disclaimer — persisted as JSON.stringify(Disclaimer); plain-text rows
// (pre-adapter / hand-seeded) keep their text verbatim
// ---------------------------------------------------------------------------

function parseDisclaimer(raw: string): Disclaimer {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.text === 'string' &&
      (parsed.language === 'fi' || parsed.language === 'en') &&
      typeof parsed.version === 'string'
    ) {
      return {
        text: parsed.text,
        language: parsed.language,
        version: parsed.version,
      };
    }
  } catch {
    // Not JSON — fall through to the plain-text degradation.
  }
  return { text: raw, language: 'fi', version: 'unknown' };
}

// ---------------------------------------------------------------------------
// Flat convenience fields — sums of the persisted lines per category
// ---------------------------------------------------------------------------

function sumCategory(
  itemizedCosts: readonly ItemizedCost[],
  category: CostCategory,
): number {
  return itemizedCosts
    .filter((c) => c.category === category)
    .reduce((sum, c) => sum + c.cents, 0);
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Reconstruct the live CalculatorResult shape from the persisted record.
 *
 * Product facts degrade factually when the master row is absent (FK makes
 * this near-impossible, but the page must render, never crash): the name
 * states the known fact, volume/ABV fall back to 0 — the same value the
 * live path produces for unparseable numerics.
 */
export function mapCalculationRecordToResult(
  input: CalculationResultMapperInput,
): CalculationResultResponse {
  const { record, product } = input;

  const itemizedCosts = parseItemizedCosts(record.breakdown);

  const datasetVersions: string[] = [];
  if (input.exciseVersionLabel !== null) {
    datasetVersions.push(input.exciseVersionLabel);
  }
  if (
    input.containerVersionLabel !== null &&
    !datasetVersions.includes(input.containerVersionLabel)
  ) {
    datasetVersions.push(input.containerVersionLabel);
  }

  return {
    itemizedCosts,
    foreignRetailPrice: sumCategory(itemizedCosts, 'foreignRetailPrice'),
    transportCost: sumCategory(itemizedCosts, 'transportCost'),
    alcoholExciseEstimate: sumCategory(itemizedCosts, 'alcoholExciseEstimate'),
    containerDutyEstimate: sumCategory(itemizedCosts, 'containerDutyEstimate'),
    otherCharges: sumCategory(itemizedCosts, 'otherCharges'),
    totalCents: record.totalCents,
    currency: 'EUR',
    confidence: toConfidenceLevel(record.confidence),
    // Not persisted per data point — absence is a real state; the page
    // hides the section when the array is empty.
    confidenceBreakdown: [],
    disclaimer: parseDisclaimer(record.disclaimer),
    // Not persisted — derive nothing; factual marker + explanation.
    classification: {
      classification: 'NotPersisted',
      confidence: 'LOW',
      evidence: [],
      evidenceSummary:
        'Transaction classification is not persisted with the calculation ' +
        'record and cannot be shown for a past result.',
    },
    metadata: {
      input: {
        // CalculatorInput.productId IS the product-master ID (see
        // LandedCostCalculatorService.resolveProduct).
        productId: record.productMasterId,
        quantity: record.quantity,
        destination: record.destination,
        // transportMethod is not persisted — omitted (optional in the
        // frontend contract; the page renders 'Default').
        ...(record.sessionId !== null ? { sessionId: record.sessionId } : {}),
      },
      calculationTimestamp: new Date(record.calculatedAt).toISOString(),
      productMasterId: record.productMasterId,
      retailOfferIds: parseRetailOfferIds(record.retailOfferIds),
      quantity: record.quantity,
      destination: record.destination,
      productName:
        product?.name ?? `Unknown product (ID ${record.productMasterId})`,
      volumeLitres: product ? parseNumeric(product.unitVolume) : 0,
      alcoholByVolume:
        product?.alcoholByVolume !== null && product?.alcoholByVolume !== undefined
          ? parseNumeric(product.alcoholByVolume)
          : 0,
      category: product?.category ?? 'unknown',
      datasetVersions,
      transportOfferId: record.transportOfferId,
    },
    calculationRecordId: record.id,
  };
}
