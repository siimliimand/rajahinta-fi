/**
 * What-if excise simulator — hypothetical rate substitution through the
 * existing excise math (spec: excise-what-if-simulator, design R11,
 * task 8.1).
 *
 * Pure functions only: no I/O, no clock, no randomness, no framework
 * imports. The baseline is an INPUT — the caller (task 8.2's API route)
 * resolves each product's applied rule via the existing excise engine
 * and maps the rule data in; this module never queries a repository and
 * never writes anything. Stored rules are read-only data here by
 * construction: the substitution re-runs the engine's pure rate
 * dispatch (`calculateAlcoholExcise`) with the hypothetical rate — no
 * rule object is touched, no scenario is persisted.
 *
 * GAP MODEL (documented decision): for each product the module computes
 * the import total — foreign retail price plus Finnish excise at a given
 * rate — and the Alko-vs-import gap against the OBSERVED Alko price
 * (baseline excise already included). Only the import-side duty is
 * recomputed at the hypothetical rate; the Alko side is never repriced,
 * because modelling Alko's pass-through would smuggle a forecast
 * assumption into a what-if result. `gapDeltaCents` therefore isolates
 * exactly the excise substitution effect on import competitiveness.
 *
 * ONE SCENARIO, ONE BASELINE VERSION (documented decision): every
 * product's baseline rule must carry the same `taxDatasetVersion` — the
 * engine resolves all rules as of one date — and the result cites it at
 * the top level and on every line. A mixed set is a caller-contract
 * violation ({@link MixedTaxDatasetVersionsError}), never silently
 * preferred.
 *
 * RATE SUBSTITUTION SEMANTICS (documented decision): the hypothetical
 * rate is substituted as-is into each product's resolved formula — its
 * unit follows the formula (per-litre-of-product, per-litre-of-alcohol,
 * per-centilitre-ethanol), which is why every line names its
 * `formulaRef`. A zero baseline rate (exemption rule) is not special:
 * the substitution applies the hypothetical rate through the same
 * formula, so a scenario can model removing or introducing an exemption
 * (`hypotheticalRate: 0`).
 *
 * VALIDATION PRECEDENCE (documented, deterministic): scenario rate
 * first, then the empty product list, then per-product fields in input
 * order (id, duplicates, abv, volume, Alko price, import price, formula
 * reference, baseline rate, dataset version, reliability). The first
 * violation wins and throws {@link InvalidWhatIfInputError}; values are
 * never clamped or ignored.
 *
 * @module WhatIf
 */

import {
  InvalidWhatIfInputError,
  MixedTaxDatasetVersionsError,
} from './whatif.types';
import type {
  WhatIfProductInput,
  WhatIfProductLine,
  WhatIfScenarioInput,
  WhatIfScenarioResult,
  WhatIfTotals,
} from './whatif.types';
import { WHATIF_DISCLAIMER_EN } from './whatif.disclaimer';
import {
  calculateAlcoholExcise,
  normaliseCategory,
} from '../tax/services/alcohol-excise.math';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Substitute the hypothetical rate through the baseline excise math for
 * every selected product and compute the Alko-vs-import gap at the
 * baseline and hypothetical rates. Deterministic: same input, same
 * result, every figure traceable to rule data, prices, and the formula
 * dispatch. Baseline line versions must be uniform (see module docs).
 */
export function calculateWhatIfExcise(input: WhatIfScenarioInput): WhatIfScenarioResult {
  validateScenario(input);

  const lines = input.products.map((product) => computeLine(product, input.hypotheticalRate));

  return {
    hypotheticalRate: input.hypotheticalRate,
    // validateScenario enforces one shared baseline version; naming it
    // here attaches the R11 provenance to the whole result.
    baselineTaxDatasetVersion: input.products[0].baselineRule.taxDatasetVersion,
    disclaimer: WHATIF_DISCLAIMER_EN,
    lines,
    totals: computeTotals(lines),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateScenario(input: WhatIfScenarioInput): void {
  if (!Number.isFinite(input.hypotheticalRate) || input.hypotheticalRate < 0) {
    throw new InvalidWhatIfInputError(
      'INVALID_HYPOTHETICAL_RATE',
      `hypotheticalRate must be a finite non-negative number, got ${String(input.hypotheticalRate)}`,
    );
  }

  if (input.products.length === 0) {
    throw new InvalidWhatIfInputError(
      'EMPTY_PRODUCT_LIST',
      'a what-if scenario needs at least one product',
    );
  }

  const seenIds = new Set<string>();
  const versionLabels: string[] = [];

  for (const product of input.products) {
    validateProduct(product, seenIds);
    seenIds.add(product.id);
    versionLabels.push(product.baselineRule.taxDatasetVersion);
  }

  const distinctVersions = new Set(versionLabels);
  if (distinctVersions.size > 1) {
    throw new MixedTaxDatasetVersionsError(versionLabels);
  }
}

function validateProduct(product: WhatIfProductInput, seenIds: ReadonlySet<string>): void {
  if (typeof product.id !== 'string' || product.id.trim() === '') {
    throw new InvalidWhatIfInputError(
      'INVALID_PRODUCT_ID',
      `product id must be a non-empty string, got ${String(product.id)}`,
    );
  }
  if (seenIds.has(product.id)) {
    throw new InvalidWhatIfInputError(
      'DUPLICATE_PRODUCT_ID',
      `product id "${product.id}" appears more than once`,
      product.id,
    );
  }

  const { abv, volumeLitres, alkoPriceCents, importPriceCents, baselineRule } = product;

  if (!Number.isFinite(abv) || abv < 0 || abv > 1) {
    throw new InvalidWhatIfInputError(
      'INVALID_ABV',
      `abv must be a finite fraction in [0, 1], got ${String(abv)}`,
      product.id,
    );
  }
  if (!Number.isFinite(volumeLitres) || volumeLitres < 0) {
    throw new InvalidWhatIfInputError(
      'INVALID_VOLUME',
      `volumeLitres must be a finite non-negative number, got ${String(volumeLitres)}`,
      product.id,
    );
  }
  if (!Number.isFinite(alkoPriceCents) || alkoPriceCents < 0) {
    throw new InvalidWhatIfInputError(
      'INVALID_ALKO_PRICE',
      `alkoPriceCents must be a finite non-negative number, got ${String(alkoPriceCents)}`,
      product.id,
    );
  }
  if (!Number.isFinite(importPriceCents) || importPriceCents < 0) {
    throw new InvalidWhatIfInputError(
      'INVALID_IMPORT_PRICE',
      `importPriceCents must be a finite non-negative number, got ${String(importPriceCents)}`,
      product.id,
    );
  }

  if (typeof baselineRule.formulaRef !== 'string' || baselineRule.formulaRef.trim() === '') {
    throw new InvalidWhatIfInputError(
      'INVALID_FORMULA_REF',
      'baselineRule.formulaRef must be a non-empty string',
      product.id,
    );
  }
  if (!Number.isFinite(baselineRule.rate) || baselineRule.rate < 0) {
    throw new InvalidWhatIfInputError(
      'INVALID_BASELINE_RATE',
      `baselineRule.rate must be a finite non-negative number, got ${String(baselineRule.rate)}`,
      product.id,
    );
  }
  if (
    typeof baselineRule.taxDatasetVersion !== 'string' ||
    baselineRule.taxDatasetVersion.trim() === ''
  ) {
    throw new InvalidWhatIfInputError(
      'MISSING_DATASET_VERSION',
      'baselineRule.taxDatasetVersion is missing or blank',
      product.id,
    );
  }
  if (baselineRule.reliability !== 'VERIFIED' && baselineRule.reliability !== 'ESTIMATED') {
    throw new InvalidWhatIfInputError(
      'INVALID_RELIABILITY',
      `baselineRule.reliability must be "VERIFIED" or "ESTIMATED", got ${String(baselineRule.reliability)}`,
      product.id,
    );
  }
}

// ---------------------------------------------------------------------------
// Computation — routes through the engine's shared pure rate dispatch
// ---------------------------------------------------------------------------

function computeLine(product: WhatIfProductInput, hypotheticalRate: number): WhatIfProductLine {
  const category = normaliseCategory(product.category);
  const { formulaRef, rate } = product.baselineRule;
  const { abv, volumeLitres } = product;

  const baselineCalc = calculateAlcoholExcise(
    formulaRef,
    rate,
    abv,
    volumeLitres,
    category,
  );
  const hypotheticalCalc = calculateAlcoholExcise(
    formulaRef,
    hypotheticalRate,
    abv,
    volumeLitres,
    category,
  );

  const importTotalBaselineCents = product.importPriceCents + baselineCalc.taxCents;
  const importTotalHypotheticalCents = product.importPriceCents + hypotheticalCalc.taxCents;
  const gapBaselineCents = importTotalBaselineCents - product.alkoPriceCents;
  const gapHypotheticalCents = importTotalHypotheticalCents - product.alkoPriceCents;

  return {
    id: product.id,
    category,
    abv,
    volumeLitres,
    alkoPriceCents: product.alkoPriceCents,
    importPriceCents: product.importPriceCents,
    importTotalBaselineCents,
    importTotalHypotheticalCents,
    gapBaselineCents,
    gapHypotheticalCents,
    gapDeltaCents: gapHypotheticalCents - gapBaselineCents,
    baseline: {
      formulaRef,
      rateApplied: baselineCalc.rateApplied,
      taxCents: baselineCalc.taxCents,
      taxDatasetVersion: product.baselineRule.taxDatasetVersion,
      ruleId: product.baselineRule.ruleId,
      reliability: product.baselineRule.reliability,
    },
    hypothetical: {
      formulaRef,
      rate: hypotheticalRate,
      rateApplied: hypotheticalCalc.rateApplied,
      taxCents: hypotheticalCalc.taxCents,
    },
  };
}

function computeTotals(lines: readonly WhatIfProductLine[]): WhatIfTotals {
  let baselineExciseCents = 0;
  let hypotheticalExciseCents = 0;
  let gapBaselineCents = 0;
  let gapHypotheticalCents = 0;

  for (const line of lines) {
    baselineExciseCents += line.baseline.taxCents;
    hypotheticalExciseCents += line.hypothetical.taxCents;
    gapBaselineCents += line.gapBaselineCents;
    gapHypotheticalCents += line.gapHypotheticalCents;
  }

  return { baselineExciseCents, hypotheticalExciseCents, gapBaselineCents, gapHypotheticalCents };
}
