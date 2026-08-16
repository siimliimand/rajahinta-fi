/**
 * Pure calculation functions for Finnish alcohol excise duty.
 *
 * These functions have NO framework or I/O dependencies — they are
 * deterministic, testable, and safe to isolate.
 *
 * @module AlcoholExciseMath
 */

// ---------------------------------------------------------------------------
// Formula reference constants — values stored in taxRules.calculationFormulaReference
// ---------------------------------------------------------------------------

/** Rate is applied per litre of product (rate €/l × volumeLitres). */
export const FORMULA_PER_LITRE_OF_PRODUCT = 'PER_LITRE_OF_PRODUCT';

/**
 * Rate is applied per litre of pure alcohol (rate €/l × abv × volumeLitres).
 * Used for spirits and high-proof products.
 */
export const FORMULA_PER_LITRE_OF_ALCOHOL = 'PER_LITRE_OF_ALCOHOL';

/**
 * Rate is selected from a progressive ABV tier table.
 * Used for beer and cider.  The `rate` field in the DB is a JSON-encoded
 * string of tiers: `[{"maxAbv": 2.8, "rate": 0}, {"maxAbv": 4.7, "rate": 0.295}, ...]`
 */
export const FORMULA_PROGRESSIVE_ABV = 'PROGRESSIVE_ABV';

// ---------------------------------------------------------------------------
// Fallback rates — used when no tax rule is found in the repository
// (reliability: ESTIMATED)
// ---------------------------------------------------------------------------

/**
 * Finnish alcohol excise categories as understood by the service.
 * 'cider' and 'rtd' are runtime aliases (cider→beer rates, rtd→spirits rates).
 */
export type AlcoholExciseCategory =
  | 'beer'
  | 'wine'
  | 'spirits'
  | 'cider'
  | 'rtd'
  | 'intermediate'
  | 'other';

/**
 * Internal ABV-tier descriptor for progressive-rate categories.
 */
export interface AbvTier {
  readonly maxAbv: number;
  readonly ratePerLitre: number;
}

// ---------------------------------------------------------------------------
// Default ABV tiers (beer / cider)
// ---------------------------------------------------------------------------

export const DEFAULT_BEER_TIERS: readonly AbvTier[] = [
  { maxAbv: 2.8, ratePerLitre: 0 },
  { maxAbv: 4.7, ratePerLitre: 0.295 },
  { maxAbv: 8.0, ratePerLitre: 0.435 },
  { maxAbv: Infinity, ratePerLitre: 0.580 },
] as const;

// ---------------------------------------------------------------------------
// Default flat rates per category (€/litre of product unless noted)
// ---------------------------------------------------------------------------

export const DEFAULT_RATES: Record<
  AlcoholExciseCategory,
  { formula: string; rate: number; note: string }
> = {
  beer: { formula: FORMULA_PROGRESSIVE_ABV, rate: 0.295, note: 'See DEFAULT_BEER_TIERS' },
  cider: { formula: FORMULA_PROGRESSIVE_ABV, rate: 0.295, note: 'Same as beer tiers' },
  wine: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0.355, note: 'Still & sparkling, < 15 % ABV' },
  intermediate: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0.710, note: '> 15 % ABV fortified' },
  spirits: { formula: FORMULA_PER_LITRE_OF_ALCOHOL, rate: 0.565, note: 'Per litre of pure alcohol' },
  rtd: { formula: FORMULA_PER_LITRE_OF_ALCOHOL, rate: 0.565, note: 'Spirits-based RTD' },
  other: { formula: FORMULA_PER_LITRE_OF_PRODUCT, rate: 0.355, note: 'Wine rate fallback' },
};

// ---------------------------------------------------------------------------
// Category normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a raw category string to the internal category key.
 */
export function normaliseCategory(raw: string): AlcoholExciseCategory {
  const lower = raw.toLowerCase().trim();
  switch (lower) {
    case 'beer':
    case 'olut':
      return 'beer';
    case 'wine':
    case 'viini':
      return 'wine';
    case 'spirits':
    case 'viina':
    case 'vodka':
    case 'whisky':
    case 'whiskey':
      return 'spirits';
    case 'cider':
    case 'siideri':
      return 'cider';
    case 'rtd':
    case 'ready-to-drink':
    case 'lonkero':
      return 'rtd';
    case 'intermediate':
    case 'väli':
    case 'portviini':
    case 'sherry':
      return 'intermediate';
    default:
      return 'other';
  }
}

// ---------------------------------------------------------------------------
// Pure calculation helpers
// ---------------------------------------------------------------------------

/**
 * Calculate excise using a per-litre-of-product formula.
 *
 * @param ratePerLitre  Rate in € per litre of product.
 * @param volumeLitres  Volume in litres.
 * @returns Excise amount in euro-cents (€0.01 granularity).
 */
export function calcPerLitreOfProduct(
  ratePerLitre: number,
  volumeLitres: number,
): number {
  validatePositive(volumeLitres, 'volumeLitres');
  const amount = ratePerLitre * volumeLitres;
  return roundToCents(amount);
}

/**
 * Calculate excise using a per-litre-of-pure-alcohol formula.
 *
 * @param ratePerAlcoholLitre  Rate in € per litre of pure alcohol.
 * @param abv                  Alcohol by volume fraction (e.g. 0.40 for 40 % ABV).
 * @param volumeLitres         Volume in litres.
 * @returns Excise amount in euro-cents.
 */
export function calcPerLitreOfAlcohol(
  ratePerAlcoholLitre: number,
  abv: number,
  volumeLitres: number,
): number {
  validatePositive(volumeLitres, 'volumeLitres');
  validateRange(abv, 0, 1, 'abv');
  const pureAlcoholLitres = abv * volumeLitres;
  const amount = ratePerAlcoholLitre * pureAlcoholLitres;
  return roundToCents(amount);
}

/**
 * Calculate excise using a progressive ABV tier table.
 *
 * @param tiers        Ordered array of `{maxAbv, ratePerLitre}` (ascending by maxAbv).
 * @param abv          Alcohol by volume fraction (e.g. 0.40).
 * @param volumeLitres Volume in litres.
 * @returns Excise amount in euro-cents.
 */
export function calcProgressiveAbv(
  tiers: readonly AbvTier[],
  abv: number,
  volumeLitres: number,
): number {
  validatePositive(volumeLitres, 'volumeLitres');
  validateRange(abv, 0, 1, 'abv');

  const abvPercent = abv * 100; // convert to percentage scale for tier comparison
  const tier = tiers.find((t) => abvPercent <= t.maxAbv);
  if (!tier) {
    // Use last tier as fallback
    const last = tiers[tiers.length - 1];
    return calcPerLitreOfProduct(last.ratePerLitre, volumeLitres);
  }
  return calcPerLitreOfProduct(tier.ratePerLitre, volumeLitres);
}

// ---------------------------------------------------------------------------
// Top-level dispatch
// ---------------------------------------------------------------------------

/**
 * Pure calculation dispatch: apply the correct formula based on
 * `formulaRef` and return (taxCents, rateApplied).
 *
 * @returns `[taxCents, rateApplied]` — the final excise in euro-cents and
 *          the effective *per-unit* rate (€/l of product) that was applied.
 */
export function calculateAlcoholExcise(
  formulaRef: string,
  rateValue: number,
  abv: number,
  volumeLitres: number,
  _category: AlcoholExciseCategory,
): { taxCents: number; rateApplied: number } {
  switch (formulaRef) {
    case FORMULA_PER_LITRE_OF_ALCOHOL: {
      const taxCents = calcPerLitreOfAlcohol(rateValue, abv, volumeLitres);
      // Effective per-litre-of-product rate for evidence
      const effectiveRate = rateValue * abv;
      return { taxCents, rateApplied: effectiveRate };
    }
    case FORMULA_PROGRESSIVE_ABV: {
      // rateValue is ignored for progressive — tiers are parsed or use defaults
      const tiers = DEFAULT_BEER_TIERS;
      const taxCents = calcProgressiveAbv(tiers, abv, volumeLitres);
      const abvPercent = abv * 100;
      const appliedTier =
        tiers.find((t) => abvPercent <= t.maxAbv) ?? tiers[tiers.length - 1];
      return { taxCents, rateApplied: appliedTier.ratePerLitre };
    }
    case FORMULA_PER_LITRE_OF_PRODUCT:
    default: {
      const taxCents = calcPerLitreOfProduct(rateValue, volumeLitres);
      return { taxCents, rateApplied: rateValue };
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validatePositive(value: number, name: string): void {
  if (value < 0) {
    throw new RangeError(`${name} must not be negative, got ${value}`);
  }
}

function validateRange(value: number, min: number, max: number, name: string): void {
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}, got ${value}`);
  }
}

/**
 * Round to nearest euro-cent, with HALF_UP semantics (Math.round).
 */
function roundToCents(amount: number): number {
  return Math.round(amount * 100);
}