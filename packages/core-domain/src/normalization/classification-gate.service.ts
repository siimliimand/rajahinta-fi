/**
 * ClassificationGateService — ensures a product carries a regulatory
 * classification before it enters the landed-cost pipeline.
 *
 * Every canonical product must have a non-null `regulatoryClassification`
 * assigned before it can appear in a landed-cost calculation. This gate
 * enforces that invariant. Unclassified products are excluded — never
 * shown with a guessed classification.
 *
 * The gate is a pure check: it does not assign classifications, nor does
 * it know how classifications are determined. That is the responsibility
 * of the RegulatoryClassificationService (task 7.x) and the product
 * master's classification assignment logic.
 *
 * @module ClassificationGateService
 */

import { Injectable } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The result of checking a product against the classification gate.
 */
export interface GateResult {
  /** True when the product passes the gate and may enter landed-cost calculation. */
  readonly passed: boolean;
  /** Human-readable explanation when `passed` is false. */
  readonly reason?: string;
}

/**
 * Shape of the product data the gate inspects.
 *
 * This is intentionally a minimal subset — the gate only checks the
 * `regulatoryClassification` field. Accepting a larger object would
 * couple the gate to the full ProductMaster shape unnecessarily.
 */
export interface GateProduct {
  /** The product's regulatory classification (e.g. ExciseCategory). */
  readonly regulatoryClassification: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ClassificationGateService {
  /**
   * Check whether a product passes the classification gate.
   *
   * A product passes iff its `regulatoryClassification` is a non-null,
   * non-empty string.
   *
   * This is a pure synchronous function — no I/O, no side effects.
   */
  checkProductGate(product: GateProduct): GateResult {
    if (
      product.regulatoryClassification === null ||
      product.regulatoryClassification === undefined ||
      product.regulatoryClassification.trim() === ''
    ) {
      return {
        passed: false,
        reason: 'Product lacks regulatory classification',
      };
    }

    return { passed: true };
  }
}