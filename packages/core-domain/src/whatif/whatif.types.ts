/**
 * What-if excise simulator types — hypothetical rate substitution inputs
 * and results (spec: excise-what-if-simulator, design R11, task 8.1).
 *
 * The module is pure and ephemeral: these contracts accept ALREADY-RESOLVED
 * baseline rule data (the applied rule's formula reference, raw rate, and
 * dataset version, shaped to be mappable straight from `TaxRuleRecordPort`
 * and `ExciseResult` at the call site) plus the user's hypothetical rate.
 * No repository, DI service, NestJS type, or persistence type appears
 * here — a what-if run reads nothing and writes nothing (design R11).
 *
 * @module WhatIfTypes
 */

import type { Disclaimer } from '../calculator/calculator.types';
import type { AlcoholExciseCategory } from '../tax/services/alcohol-excise.math';

// ---------------------------------------------------------------------------
// Inputs — baseline rule data is resolved by the caller, never queried here
// ---------------------------------------------------------------------------

/**
 * The baseline excise rule actually applied to a product, resolved by the
 * caller through the existing excise engine (AlcoholExciseService /
 * TaxRuleRecordPort). `rate` is the rule's RAW rate — the number the
 * formula dispatch multiplies by (€ per formula unit, unit determined by
 * `formulaRef`), not the effective per-litre-of-product figure
 * (`rateApplied`) that `ExciseResult` exposes.
 */
export interface WhatIfBaselineRule {
  /** The applied rule's `calculationFormulaReference` (e.g. `PER_CENTILITRE_ETHANOL`). */
  readonly formulaRef: string;
  /** Raw baseline rate in € per formula unit (0 for exemption rules). */
  readonly rate: number;
  /** Baseline tax dataset version the rule belongs to (`versionLabel`) — cited on every line and the aggregate. */
  readonly taxDatasetVersion: string;
  /** Applied tax-rule version ID; `null` mirrors the engine's zero-rate fallback. */
  readonly ruleId: number | null;
  /** Mirrors `ExciseResult.reliability` — the service's VERIFIED/ESTIMATED derivation from `verificationDate`. */
  readonly reliability: 'VERIFIED' | 'ESTIMATED';
}

/**
 * One selected product with its observed prices and resolved baseline
 * rule. Prices are observed facts, in euro cents:
 *
 * - `alkoPriceCents`: Finnish Alko retail price — baseline Finnish excise
 *   is already baked in. The module never reprices this side: modelling
 *   Alko's pass-through of a hypothetical rate would be a forecast
 *   assumption, which the module does not make (design R11).
 * - `importPriceCents`: foreign retail price — carries foreign duties,
 *   NOT Finnish excise. Finnish excise at the scenario rate is added by
 *   the module.
 */
export interface WhatIfProductInput {
  /** Caller-assigned opaque identifier, echoed on the result line. */
  readonly id: string;
  /** Raw category string; normalised via the engine's `normaliseCategory` (e.g. wine → wine_still). */
  readonly category: string;
  /** ABV as a fraction in [0, 1] (0.047 = 4.7 %). */
  readonly abv: number;
  /** Volume in litres (≥ 0). */
  readonly volumeLitres: number;
  readonly alkoPriceCents: number;
  readonly importPriceCents: number;
  readonly baselineRule: WhatIfBaselineRule;
}

/**
 * One what-if scenario: a single hypothetical rate substituted into every
 * selected product's resolved formula, plus the products it applies to.
 * The rate is a number in € per formula unit — through a
 * per-litre-of-product formula it is read as €/l of product, through a
 * per-litre-of-alcohol or per-centilitre-ethanol formula as €/l of pure
 * alcohol (which is why the result names the formula on every line).
 */
export interface WhatIfScenarioInput {
  /** Hypothetical rate in € per formula unit (finite, ≥ 0; 0 models full exemption). */
  readonly hypotheticalRate: number;
  readonly products: readonly WhatIfProductInput[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Baseline excise for one product, recomputed from the rule data through
 * the same pure dispatch the excise engine uses — exact, and citing the
 * rule provenance the caller resolved.
 */
export interface WhatIfBaselineExcise {
  readonly formulaRef: string;
  readonly rateApplied: number;
  readonly taxCents: number;
  readonly taxDatasetVersion: string;
  readonly ruleId: number | null;
  readonly reliability: 'VERIFIED' | 'ESTIMATED';
}

/**
 * Hypothetical excise for one product: the substituted rate applied
 * through the SAME formula as the baseline. It names no rule and no
 * dataset version — it is not a rule application, it is a rate
 * substitution (the scenario's baseline version is cited at the result
 * level, per line via {@link WhatIfScenarioResult.baselineTaxDatasetVersion}).
 */
export interface WhatIfHypotheticalExcise {
  readonly formulaRef: string;
  /** The substituted rate, echoed for line-level traceability. */
  readonly rate: number;
  readonly rateApplied: number;
  readonly taxCents: number;
}

/**
 * Per-product what-if line. Gap sign convention: positive gap means the
 * import total is MORE expensive than the Alko price, negative means
 * cheaper. Import total at a rate = `importPriceCents + excise at that
 * rate`; the Alko side is the unchanged observed price.
 */
export interface WhatIfProductLine {
  readonly id: string;
  /** Canonical category key the excise math resolved (engine normalisation). */
  readonly category: AlcoholExciseCategory;
  readonly abv: number;
  readonly volumeLitres: number;
  readonly alkoPriceCents: number;
  readonly importPriceCents: number;
  /** `importPriceCents + baseline.taxCents`. */
  readonly importTotalBaselineCents: number;
  /** `importPriceCents + hypothetical.taxCents`. */
  readonly importTotalHypotheticalCents: number;
  readonly gapBaselineCents: number;
  readonly gapHypotheticalCents: number;
  /** `gapHypothetical − gapBaseline` — exactly the excise substitution effect. */
  readonly gapDeltaCents: number;
  readonly baseline: WhatIfBaselineExcise;
  readonly hypothetical: WhatIfHypotheticalExcise;
}

/** Scenario-level sums of the per-line figures (integer euro-cents). */
export interface WhatIfTotals {
  readonly baselineExciseCents: number;
  readonly hypotheticalExciseCents: number;
  readonly gapBaselineCents: number;
  readonly gapHypotheticalCents: number;
}

/**
 * The what-if result. `baselineTaxDatasetVersion` names the dataset every
 * line's baseline was resolved from; `disclaimer` is the structural
 * HYPOTHETICAL disclaimer that must travel with every rendering or share
 * of the result (spec: disclaimer travels with the result).
 */
export interface WhatIfScenarioResult {
  readonly hypotheticalRate: number;
  readonly baselineTaxDatasetVersion: string;
  readonly disclaimer: Disclaimer;
  readonly lines: readonly WhatIfProductLine[];
  readonly totals: WhatIfTotals;
}

// ---------------------------------------------------------------------------
// Errors — caller-contract violations only; nothing here is absorbed
// ---------------------------------------------------------------------------

/** Why a what-if input was rejected. */
export type WhatIfInputErrorReason =
  | 'INVALID_HYPOTHETICAL_RATE'
  | 'EMPTY_PRODUCT_LIST'
  | 'INVALID_PRODUCT_ID'
  | 'DUPLICATE_PRODUCT_ID'
  | 'INVALID_ABV'
  | 'INVALID_VOLUME'
  | 'INVALID_ALKO_PRICE'
  | 'INVALID_IMPORT_PRICE'
  | 'INVALID_FORMULA_REF'
  | 'INVALID_BASELINE_RATE'
  | 'MISSING_DATASET_VERSION'
  | 'INVALID_RELIABILITY';

/**
 * Structurally invalid what-if input. A validating API layer (task 8.2's
 * zod bounds) should prevent these from ever reaching the module; values
 * are never clamped or silently substituted.
 */
export class InvalidWhatIfInputError extends Error {
  readonly reason: WhatIfInputErrorReason;
  /** Product the violation belongs to; `null` for scenario-level reasons. */
  readonly productId: string | null;

  constructor(reason: WhatIfInputErrorReason, detail: string, productId: string | null = null) {
    super(`invalid what-if input (${reason})${productId ? ` [${productId}]` : ''}: ${detail}`);
    this.name = 'InvalidWhatIfInputError';
    this.reason = reason;
    this.productId = productId;
  }
}

/**
 * The products' baseline rules span more than one `taxDatasetVersion`.
 * A scenario is resolved against ONE baseline dataset version (the
 * engine resolves every product's rule as of one date); a mixed set makes
 * the aggregate unexplainable, so it is rejected outright and no version
 * is silently preferred — the eventcalc mixed-norms precedent.
 */
export class MixedTaxDatasetVersionsError extends Error {
  constructor(labels: readonly string[]) {
    super(
      `baseline rules span multiple tax dataset versions — ` +
        `expected one, got: ${[...new Set(labels)].join(', ')}`,
    );
    this.name = 'MixedTaxDatasetVersionsError';
  }
}
