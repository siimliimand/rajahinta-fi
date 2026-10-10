/**
 * Guarantee-figure computation — Stage 1 of the import filing assistant
 * (design D3a).
 *
 * Pure, deterministic computation of the guarantee (vakuus) to lodge with
 * the private advance notice. Reads its arguments only: no I/O, no
 * persistence, no submission — the module's no-submission guarantee
 * ({@link NO_SUBMISSION_GUARANTEE}) is unchanged and this function cannot
 * touch an external system.
 *
 * Verified rule (change-notes.md Fact 1, VERDICT: VERIFIED): the guarantee
 * equals the calculated alcohol excise duty. It is a prepayment credited
 * against the duty, not an extra charge.
 *
 * @module GuaranteeFigure
 */

import type {
  DeclarationGuaranteeFigure,
  FilingDutyResult,
} from './declaration.types';
import { FALLBACK_RULE_VERSION_LABEL, NO_SUBMISSION_GUARANTEE } from './declaration.types';

// Re-exported for consumers of this module surface — the guarantee attaches
// to every declaration output, including this pure computation's contract.
export { NO_SUBMISSION_GUARANTEE };

/**
 * Decide whether the recorded alcohol-excise figure is usable as a
 * guarantee basis.
 *
 * A figure is usable only when the record proves an applicable rule
 * produced it:
 *
 * - `ruleVersionLabel === 'FALLBACK'` → the tax engine matched no rule and
 *   applied hardcoded default rates (the DEFAULT_RATES fallback precedent,
 *   marked ESTIMATED by the engine). A fallback figure is not an official
 *   schedule amount and the guarantee lodges a real payment, so it is
 *   refused outright — the spec's "missing rule yields unavailable".
 * - `ruleVersionLabel === null` → the record does not persist which rule
 *   applied. The module degrades honestly on absent provenance (see the
 *   guidance caveats' `rateProvenanceMissing` treatment); a payment figure
 *   is never offered on unverifiable provenance.
 * - A non-finite or negative recorded amount cannot be a duty figure; it
 *   is never echoed forward as a plausible number.
 */
function isUsableGuaranteeBasis(excise: FilingDutyResult): boolean {
  return (
    excise.ruleVersionLabel !== null &&
    excise.ruleVersionLabel !== FALLBACK_RULE_VERSION_LABEL &&
    Number.isFinite(excise.amountCents) &&
    excise.amountCents >= 0
  );
}

/**
 * Compute the guarantee figure to lodge, per the verified rule: the
 * guarantee equals the calculated alcohol excise duty.
 *
 * The container-duty result is accepted for completeness and deliberately
 * unused: the beverage-packaging duty carries no guarantee (vero.fi,
 * change-notes.md Fact 1 — "Juomapakkausverosta ei tarvitse maksaa
 * vakuutta"). Keeping it in the signature makes that exclusion explicit at
 * every call site instead of leaving it implicit in what was passed.
 *
 * The returned figure carries the reliability status of the underlying
 * excise figure. An offered figure is at most `ESTIMATED` — the
 * calculation record does not persist the applied rule's verification
 * status, so `VERIFIED` is never asserted from this data.
 *
 * @param alcoholExcise The filing's alcohol-excise result (recorded amount
 *   and applied rule-version label).
 * @param containerDuty The filing's container-duty result. Excluded from
 *   the amount — no guarantee is required for beverage packagings.
 * @returns The guarantee figure, or the honest unavailable state when the
 *   excise figure is not a usable basis — never a substituted number.
 */
export function computeGuaranteeFigure(
  alcoholExcise: FilingDutyResult,
  containerDuty: FilingDutyResult,
): DeclarationGuaranteeFigure {
  // Container duty is intentionally unused — see the doc comment above.
  void containerDuty;

  if (!isUsableGuaranteeBasis(alcoholExcise)) {
    return { available: false, amountCents: null, status: 'UNAVAILABLE' };
  }

  return {
    available: true,
    amountCents: alcoholExcise.amountCents,
    status: 'ESTIMATED',
  };
}
