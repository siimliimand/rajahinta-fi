/**
 * Plausibility sanity rail for the landed-cost calculator.
 *
 * A pure, read-only guard: it compares each line's duty components
 * against the line's foreign retail price and reports threshold
 * breaches as structured notes. It NEVER alters any computed amount —
 * its only effects are reliability downgrades, a LOW overall
 * confidence, and machine-readable explanations on the result
 * (change unit-integrity-and-result-trust, task 2.1, design D3).
 *
 * @module SanityRail
 */

import type { ReliabilityStatus } from '../reliability/reliability.types';
import { RELIABILITY_ORDER } from '../reliability/reliability.types';
import type { SanityNote } from './calculator.types';

/**
 * A duty component may reach this multiple of its line's foreign retail
 * price before the line is deemed implausible.
 *
 * WHY 5×: real Finnish duty outcomes stay far below the goods' value —
 * across the v1.0-2024 golden fixtures the worst excise-to-retail ratio
 * is ≈3.1 (40 % spirits). A figure beyond 5× the retail price is never a
 * genuine rate; it indicates a unit-conversion or classification
 * regression (litres↔centilitres, cents↔euros, wrong ABV tier) — e.g.
 * the Koskenkorva case (≈108×). The margin above 3.1 keeps legitimate
 * high-duty/low-price baskets from false-tripping while still catching
 * order-of-magnitude data regressions visibly instead of silently.
 */
export const RETAIL_PLAUSIBILITY_THRESHOLD_MULTIPLE = 5;

/** Index of ESTIMATED within RELIABILITY_ORDER (most → least reliable). */
const ESTIMATED_INDEX = RELIABILITY_ORDER.indexOf('ESTIMATED');

/**
 * Cap a reliability status at ESTIMATED — downgrade-only, never an
 * upgrade. VERIFIED becomes ESTIMATED; anything already at or below
 * ESTIMATED (STALE, UNAVAILABLE) keeps its worse status, respecting the
 * existing worst-status composition (RELIABILITY_ORDER).
 */
export function atMostEstimated(status: ReliabilityStatus): ReliabilityStatus {
  return RELIABILITY_ORDER[Math.max(RELIABILITY_ORDER.indexOf(status), ESTIMATED_INDEX)];
}

/**
 * Evaluate the plausibility rail for one quantity-multiplied basket line.
 *
 * Pure function — no I/O, no side effects. The comparison is
 * multiplicative (component > threshold × retail), so a zero or absent
 * retail price cannot cause a division blow-up: free goods with a
 * positive duty component trip the rail, which is the honest outcome.
 *
 * @param components  Line-level (quantity-multiplied) retail price and
 *                    duty components, in euro-cents.
 * @returns One note per tripped component, empty when the line is
 *          plausible.
 */
export function evaluateLineSanityRail(components: {
  readonly lineRetailPriceCents: number;
  readonly lineExciseCents: number;
  readonly lineContainerDutyCents: number;
}): readonly SanityNote[] {
  const threshold = RETAIL_PLAUSIBILITY_THRESHOLD_MULTIPLE;
  const notes: SanityNote[] = [];

  if (components.lineExciseCents > threshold * components.lineRetailPriceCents) {
    notes.push({
      code: 'LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY',
      component: 'alcoholExciseEstimate',
      detail:
        `Line alcohol excise ${components.lineExciseCents} cents exceeds ` +
        `${threshold}× the line retail price ${components.lineRetailPriceCents} cents — ` +
        `a genuine Finnish duty outcome never does; excise reliability ` +
        `downgraded to at most ESTIMATED.`,
      figures: {
        lineComponentCents: components.lineExciseCents,
        lineRetailPriceCents: components.lineRetailPriceCents,
        thresholdMultiple: threshold,
      },
    });
  }

  if (
    components.lineContainerDutyCents >
    threshold * components.lineRetailPriceCents
  ) {
    notes.push({
      code: 'LINE_CONTAINER_DUTY_EXCEEDS_RETAIL_PLAUSIBILITY',
      component: 'containerDutyEstimate',
      detail:
        `Line container duty ${components.lineContainerDutyCents} cents exceeds ` +
        `${threshold}× the line retail price ${components.lineRetailPriceCents} cents — ` +
        `a genuine Finnish duty outcome never does; container-duty reliability ` +
        `downgraded to at most ESTIMATED.`,
      figures: {
        lineComponentCents: components.lineContainerDutyCents,
        lineRetailPriceCents: components.lineRetailPriceCents,
        thresholdMultiple: threshold,
      },
    });
  }

  return notes;
}
