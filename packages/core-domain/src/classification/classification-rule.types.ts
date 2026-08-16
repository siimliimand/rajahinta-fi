/**
 * Versioned Classification Rule types.
 *
 * Establishes the rule contract for Phase 1 (static rules) and prepares
 * for Phase 2 (task 6.3) where rules will be loaded from the database and
 * versioned by effective date.
 *
 * @module ClassificationRuleTypes
 */

import type { ClassificationInput, ClassificationResult } from './classification.types';

// ---------------------------------------------------------------------------
// Rule interface
// ---------------------------------------------------------------------------

/**
 * A single classification rule.
 *
 * Each rule is a pure function that takes a `ClassificationInput` and
 * optionally returns a `ClassificationResult`.  Rules are evaluated in
 * priority order; the first rule that returns non-null wins.
 */
export interface ClassificationRule {
  /**
   * Human-readable rule name for audit/logging (e.g.
   * 'RetailerArrangedSelling').
   */
  readonly name: string;

  /**
   * Rule evaluation function.  Returns a `ClassificationResult` when the
   * rule matches the input, or `null` to pass to the next rule.
   */
  evaluate(input: ClassificationInput): ClassificationResult | null;

  /**
   * Rule version (semver string or date-based label).  Prepares for 6.3
   * database-backed rule versioning.
   */
  readonly version: string;

  /**
   * Optional description of the rule's logic for auditing.
   */
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Rule set
// ---------------------------------------------------------------------------

/**
 * An ordered set of rules evaluated in sequence.
 */
export interface ClassificationRuleSet {
  readonly rules: readonly ClassificationRule[];
  readonly version: string;
  readonly label: string;
}