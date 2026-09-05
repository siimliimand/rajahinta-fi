/**
 * Event calculator V2 — cross-border sourcing plan (task 4.5, spec:
 * event-calculator "V2 cross-border sourcing plan", design R6).
 *
 * Pure assignment over ALREADY-RESOLVED per-source cost figures: the
 * caller (task 4.3's API route) runs the landed-cost engines per
 * drink-type line per candidate source and maps the results in —
 * this module never imports services, repositories, or I/O of any
 * kind (same discipline as eventcalc.ts; the consumption steps
 * `computeConsumption`/`toShoppingList` are the extension seam this
 * builds on).
 *
 * ASSIGNMENT (spec: cheapest source per drink type): each priced line
 * is assigned to the source minimizing, IN ORDER:
 *
 *   1. total landed cost (retail + excise + container duty + transport)
 *   2. position in SOURCING_COUNTRY_ORDER — the documented fixed
 *      sequence, domestic store first
 *
 * The key is a total order over the option set, so the winner never
 * depends on the order options arrive in. A foreign source must
 * UNDERCUT the domestic total to win (spec: "undercuts the domestic
 * price") — an exact tie keeps the domestic store because `'FI'`
 * precedes every candidate in the fixed sequence.
 *
 * BUDGET (documented semantics): a requested budget never alters the
 * assignment. Lines are independent and each is already minimal;
 * truncating or re-sourcing lines could only raise the total or hide
 * need. An exceeded budget degrades the result EXPLICITLY — the
 * complete plan plus a `budget` block with `met: false` and the exact
 * overrun — never silent truncation.
 *
 * EXACT ARITHMETIC: all figures are non-negative safe-integer
 * euro-cents validated before use; the option total and the plan total
 * are integer sums. No floats, no rounding, no drift.
 *
 * @module EventSourcing
 */

import type {
  BudgetCheck,
  EventSourcingInput,
  EventSourcingPlan,
  SourcingCostOption,
  SourcingPlanLine,
} from './sourcing.types';
import { SourcingInputError, sourcingCountryRank } from './sourcing.types';
import type { EventDrinkType, ShoppingListLine } from './eventcalc.types';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Assign each priced drink-type line of `plan` to its cheapest source
 * and total the plan under the optional budget. Deterministic:
 * identical inputs produce an identical plan on every run.
 *
 * Validation precedence (documented, first violation wins): budget
 * shape, then per line in drinkType order — option-set presence and
 * plan membership, per option country validity and distinctness, the
 * exactly-one-domestic rule, then figure shapes. Unpriced lines are a
 * VALUE (`unpricedDrinkTypes`), not an error: a user-supplied price
 * basis prices what it prices.
 */
export function buildEventSourcingPlan(input: EventSourcingInput): EventSourcingPlan {
  validateBudget(input.budgetCents);

  const linesByType = new Map(input.plan.lines.map((line) => [line.drinkType, line]));
  const lines: SourcingPlanLine[] = [];
  const unpriced: EventDrinkType[] = [];

  // The plan's own order (drinkType ascending) drives iteration, so the
  // output never depends on the option map's iteration order either.
  for (const line of input.plan.lines) {
    const options = input.options.get(line.drinkType);

    if (options === undefined) {
      unpriced.push(line.drinkType);
      continue;
    }

    validateOptions(line, options);
    lines.push(assignLine(line, options));
  }

  // Option keys must name plan drink types — a priced line outside the
  // plan is a caller-contract violation, not an ignorable extra.
  for (const drinkType of input.options.keys()) {
    if (!linesByType.has(drinkType)) {
      throw new SourcingInputError(
        'LINE_NOT_IN_PLAN',
        `options name drink type "${drinkType}", which the shopping list does not contain`,
      );
    }
  }

  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const budget = input.budgetCents !== undefined ? budgetCheck(totalCents, input.budgetCents) : null;

  return { lines, unpricedDrinkTypes: unpriced, totalCents, budget };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBudget(budgetCents: number | undefined): void {
  if (budgetCents === undefined) return;
  if (!Number.isSafeInteger(budgetCents) || budgetCents <= 0) {
    throw new SourcingInputError(
      'INVALID_BUDGET',
      `budgetCents must be a positive whole number of cents, got ${String(budgetCents)}`,
    );
  }
}

/** The four cost components every option must carry as non-negative safe integers. */
function validateFigures(option: SourcingCostOption, drinkType: EventDrinkType): void {
  const figures: ReadonlyArray<[string, number]> = [
    ['retailCents', option.retailCents],
    ['exciseCents', option.exciseCents],
    ['containerDutyCents', option.containerDutyCents],
    ['transportCents', option.transportCents],
  ];
  for (const [name, value] of figures) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SourcingInputError(
        'INVALID_COST_FIGURE',
        `${name} for "${drinkType}" from "${option.country}" must be a ` +
          `non-negative whole number of cents, got ${String(value)}`,
      );
    }
  }
}

function validateOptions(line: ShoppingListLine, options: readonly SourcingCostOption[]): void {
  if (options.length === 0) {
    throw new SourcingInputError(
      'UNPRICED_LINE',
      `drink type "${line.drinkType}" carries an empty option set`,
    );
  }

  const seen = new Set<string>();
  let domesticCount = 0;

  for (const option of options) {
    if (sourcingCountryRank(option.country) < 0) {
      throw new SourcingInputError(
        'UNKNOWN_COUNTRY',
        `option country "${String(option.country)}" for "${line.drinkType}" is not in ` +
          'the fixed sourcing country set',
      );
    }
    if (seen.has(option.country)) {
      throw new SourcingInputError(
        'DUPLICATE_COUNTRY_OPTION',
        `drink type "${line.drinkType}" has more than one option for "${option.country}"`,
      );
    }
    seen.add(option.country);

    if (option.country === 'FI') {
      domesticCount += 1;
    }
    validateFigures(option, line.drinkType);
  }

  if (domesticCount === 0) {
    throw new SourcingInputError(
      'MISSING_DOMESTIC_OPTION',
      `drink type "${line.drinkType}" has no domestic (FI) option — the plan compares ` +
        'every priced line against the domestic store',
    );
  }
}

// ---------------------------------------------------------------------------
// Assignment — cheapest total, then fixed country order
// ---------------------------------------------------------------------------

/** Winner key, compared lexicographically: total first, country rank second. */
function optionKey(option: SourcingCostOption): readonly [number, number] {
  return [optionTotalCents(option), sourcingCountryRank(option.country)];
}

/** Exact integer landed-cost total of one option (validated inputs). */
function optionTotalCents(option: SourcingCostOption): number {
  const total =
    option.retailCents +
    option.exciseCents +
    option.containerDutyCents +
    option.transportCents;
  if (!Number.isSafeInteger(total)) {
    throw new SourcingInputError(
      'INVALID_COST_FIGURE',
      `component sum for "${option.country}" exceeds the safe-integer range`,
    );
  }
  return total;
}

function assignLine(line: ShoppingListLine, options: readonly SourcingCostOption[]): SourcingPlanLine {
  let winner = options[0] as SourcingCostOption;
  for (let i = 1; i < options.length; i += 1) {
    const candidate = options[i] as SourcingCostOption;
    const [candidateTotal, candidateRank] = optionKey(candidate);
    const [winnerTotal, winnerRank] = optionKey(winner);
    if (candidateTotal < winnerTotal || (candidateTotal === winnerTotal && candidateRank < winnerRank)) {
      winner = candidate;
    }
  }

  const domestic = options.find((option) => option.country === 'FI') as SourcingCostOption;
  const winnerTotal = optionTotalCents(winner);
  const domesticTotal = optionTotalCents(domestic);

  return {
    drinkType: line.drinkType,
    sourceCountry: winner.country,
    sourceKind: winner.country === 'FI' ? 'DOMESTIC' : 'FOREIGN',
    totalCents: winnerTotal,
    components: {
      retailCents: winner.retailCents,
      exciseCents: winner.exciseCents,
      containerDutyCents: winner.containerDutyCents,
      transportCents: winner.transportCents,
    },
    statuses: winner.statuses,
    confidenceOverall: winner.confidenceOverall,
    datasetVersions: winner.datasetVersions,
    domesticTotalCents: domesticTotal,
    savingsVsDomesticCents: domesticTotal - winnerTotal,
  };
}

// ---------------------------------------------------------------------------
// Budget — explicit state, never truncation
// ---------------------------------------------------------------------------

function budgetCheck(totalCents: number, limitCents: number): BudgetCheck {
  const overrunCents = totalCents > limitCents ? totalCents - limitCents : 0;
  return { limitCents, totalCents, met: overrunCents === 0, overrunCents };
}
