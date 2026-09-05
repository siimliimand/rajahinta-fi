/**
 * Event calculator — norms-based consumption and minimal-surplus
 * shopping list (spec: event-calculator, design R5/R6, task 4.2).
 *
 * Pure functions only: no I/O, no clock, no randomness, no imports
 * beyond this module's own types and constants. Norms are an INPUT —
 * the caller (task 4.3's API route) resolves the PUBLISHED rows
 * effective on the event date via the data-platform repository; this
 * module must never import from data-platform.
 *
 * EXACT ARITHMETIC (documented decision): every quantity is an exact
 * integer in millilitres. A norm is accepted only at whole-millilitre
 * granularity — i.e. litres with at most three decimals, in practice
 * the centilitre granularity the curated seed rounds to — and a value
 * that is not a whole number of millilitres is REJECTED, not silently
 * rounded (an adjusted norm would be an invisible dataset change).
 * Guests and duration must be non-negative integers, with duration in
 * WHOLE HOURS: `needMl = normMl × guests × durationHours` is then a
 * pure integer product (bounded by the safe-integer range, enforced),
 * so no figure can float-drift. Fractional-hour durations are rejected
 * rather than quantized — a minute-granularity product is not exactly
 * representable (÷60 introduces repeating decimals), and exactness
 * beats convenience for a numbers-bearing result. The `*Litres` output
 * fields are derived display values (`ml / 1000`); the `*Ml` integers
 * are canonical.
 *
 * MINIMAL-SURPLUS PLAN (documented decision): each line's need is
 * rounded up to a purchase plan built from at most two retail unit
 * sizes of that drink type (RETAIL_UNITS_BY_DRINK_TYPE). Candidates
 * are enumerated exhaustively but boundedly: for every ordered size
 * pair (large L, small S) and every count `c` of L from 0 up to
 * `ceil(need / L)`, the remainder is topped up with `ceil` units of S.
 * This is a structured enumeration, not a knapsack solver. The winner
 * is the plan minimizing, in order:
 *
 *   1. surplus (purchased − need)          — the minimal-surplus rule
 *   2. total container count               — fewer containers on ties
 *   3. largest unit size in the plan       — smaller unit size on ties
 *   4. smallest unit size in the plan      — final deterministic break
 *
 * The key is a total order over ≤2-size plans (surplus and container
 * count fix the size counts given the two distinct sizes), so the
 * winner never depends on enumeration order.
 *
 * MIXED VERSIONS (documented decision): all rows must share one
 * `versionLabel`; otherwise {@link MixedNormVersionsError} is thrown.
 * The repository's per-date resolution guarantees a coherent version,
 * so a mixed set is a caller-contract violation — rejecting it is
 * deterministic and beats silently preferring a version.
 *
 * EMPTY NORMS (documented decision): zero resolved rows is an expected
 * operational state (nothing published yet) and yields the explicit
 * `'NO_PUBLISHED_NORMS'` result value — not an exception (unitprice
 * 'unavailable' precedent).
 *
 * ZERO GUESTS / ZERO DURATION (documented decision): valid input. Need
 * is 0 ml on every line, the minimal-surplus plan buys nothing, and
 * the result is `'COMPUTED'` with all-zero lines — buying nothing is
 * the exact minimal-surplus answer. Negative, fractional, or
 * non-finite values are caller-contract violations and throw
 * {@link InvalidEventInputError}; the API layer's caps (task 4.3)
 * are the product-level guard.
 *
 * EXTENSION SEAM (task 4.5): {@link computeConsumption} and
 * {@link toShoppingList} are separate exported steps so V2
 * cross-border sourcing can price the per-type consumption (or the
 * purchase plan) across countries without re-deriving it. The V2
 * assignment logic itself is deliberately not here yet.
 *
 * @module EventCalc
 */

import {
  InconsistentNormsError,
  InvalidEventInputError,
  MixedNormVersionsError,
  EVENT_CALC_DRINK_TYPES,
  EVENT_CALC_EVENT_PROFILES,
} from './eventcalc.types';
import type {
  EventCalcInput,
  EventCalcResult,
  EventConsumptionLine,
  EventDrinkType,
  EventNormRow,
  EventProfile,
  PlannedUnit,
  ShoppingListLine,
} from './eventcalc.types';
import { RETAIL_UNITS_BY_DRINK_TYPE } from './retail-units';
import type { RetailUnit } from './retail-units';

/** Exact whole millilitres in one litre. */
const ML_PER_LITRE = 1000;

/**
 * Granularity tolerance for the whole-millilitre norm check: a litres
 * value is accepted when `|value × 1000 − round(value × 1000)|` is
 * under this epsilon — generous against float representation noise
 * (0.32 × 1000 = 320.00000000000006) while still rejecting any value
 * carrying real sub-millilitre content (0.32 l → 320 ml ✓,
 * 0.3333 l → 333.3 ml ✗).
 */
const WHOLE_ML_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Compute the event's minimal-surplus shopping list from
 * already-resolved norms — the module's single entry point.
 *
 * Validation precedence (documented, deterministic): event facts first
 * (date shape, profile, guests/duration), then the empty-norms state,
 * then norms consistency (unknown type, duplicates, value granularity,
 * blank label), then mixed versions. The first violation wins.
 */
export function calculateEventShoppingList(input: EventCalcInput): EventCalcResult {
  validateEventFacts(input.eventDate, input.eventProfile, input.guests, input.durationHours);

  if (input.norms.length === 0) {
    return {
      status: 'NO_PUBLISHED_NORMS',
      eventDate: input.eventDate,
      eventProfile: input.eventProfile,
      guests: input.guests,
      durationHours: input.durationHours,
    };
  }

  const consumption = computeConsumption(input.norms, input.guests, input.durationHours);
  const lines = toShoppingList(consumption);

  // computeConsumption enforces one shared versionLabel; naming it here
  // is safe and attaches R5 provenance to the whole result.
  const normsVersion = consumption[0].versionLabel;

  return {
    status: 'COMPUTED',
    eventDate: input.eventDate,
    eventProfile: input.eventProfile,
    guests: input.guests,
    durationHours: input.durationHours,
    normsVersion,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Step 1 — consumption from norms (V2 extension seam)
// ---------------------------------------------------------------------------

/**
 * Per-drink-type expected consumption:
 * `needMl = normMl × guests × durationHours` in exact integer
 * millilitres. Validates the norms (consistency, one shared version)
 * before computing, so both entry paths — orchestrator and direct step
 * use by V2 sourcing — get the same guards.
 *
 * @param norms         Resolved PUBLISHED norm rows (see {@link EventNormRow}).
 * @param guests        Guest count, integer ≥ 0.
 * @param durationHours Event duration, whole hours, integer ≥ 0.
 */
export function computeConsumption(
  norms: readonly EventNormRow[],
  guests: number,
  durationHours: number,
): EventConsumptionLine[] {
  validateGuestsAndDuration(guests, durationHours);

  const validated = validateNorms(norms);

  return validated
    .slice()
    .sort((a, b) => (a.drinkType < b.drinkType ? -1 : a.drinkType > b.drinkType ? 1 : 0))
    .map((norm) => {
      const needMl = safeNeedMl(norm.normValueMl, guests, durationHours);
      return {
        drinkType: norm.drinkType,
        needMl,
        needLitres: needMl / ML_PER_LITRE,
        versionLabel: norm.versionLabel,
      };
    });
}

// ---------------------------------------------------------------------------
// Step 2 — consumption to minimal-surplus shopping list (V2 extension seam)
// ---------------------------------------------------------------------------

/**
 * Convert consumption lines into shopping-list lines: each need rounded
 * up to a minimal-surplus purchase plan of realistic retail units, with
 * need, purchase quantities, and resulting surplus shown per line
 * (spec: minimal-surplus shopping list). See the module docs for the
 * plan-search rule and tie-break order.
 */
export function toShoppingList(consumption: readonly EventConsumptionLine[]): ShoppingListLine[] {
  ensureSingleVersion(consumption.map((line) => line.versionLabel));

  return consumption
    .slice()
    .sort((a, b) => (a.drinkType < b.drinkType ? -1 : a.drinkType > b.drinkType ? 1 : 0))
    .map((line) => buildLine(line));
}

// ---------------------------------------------------------------------------
// Event-fact validation
// ---------------------------------------------------------------------------

function validateEventFacts(
  eventDate: string,
  eventProfile: EventProfile,
  guests: number,
  durationHours: number,
): void {
  // Shape-only check: the half-open effective-window resolution against
  // this date is the caller's concern (repository, task 4.1).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new InvalidEventInputError(
      `eventDate "${eventDate}" is not an ISO YYYY-MM-DD calendar date`,
    );
  }
  // The type system narrows eventProfile, but the module is callable
  // from untyped JS — re-validate the closed set (defense in depth,
  // mirroring the repository's status narrowing).
  if (!(EVENT_CALC_EVENT_PROFILES as readonly string[]).includes(eventProfile)) {
    throw new InconsistentNormsError(
      'UNKNOWN_EVENT_PROFILE',
      `"${String(eventProfile)}" is not one of: ${EVENT_CALC_EVENT_PROFILES.join(', ')}`,
    );
  }
  validateGuestsAndDuration(guests, durationHours);
}

/**
 * Whole-number validation is the exactness contract: integer guests and
 * integer whole-hour duration keep `normMl × guests × durationHours` a
 * pure integer product. Zero is valid (need is zero; buy nothing).
 */
function validateGuestsAndDuration(guests: number, durationHours: number): void {
  if (!Number.isSafeInteger(guests) || guests < 0) {
    throw new InvalidEventInputError(
      `guests must be a non-negative whole number, got ${String(guests)}`,
    );
  }
  if (!Number.isSafeInteger(durationHours) || durationHours < 0) {
    throw new InvalidEventInputError(
      `durationHours must be a non-negative whole number of hours, got ${String(durationHours)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Norms validation
// ---------------------------------------------------------------------------

/** A norm row with its value normalized to exact integer millilitres. */
interface ValidatedNorm {
  readonly drinkType: EventDrinkType;
  readonly normValueMl: number;
  readonly versionLabel: string;
}

function validateNorms(norms: readonly EventNormRow[]): readonly ValidatedNorm[] {
  const seenTypes = new Set<string>();
  const labels: string[] = [];
  const validated: ValidatedNorm[] = [];

  for (const row of norms) {
    if (!(EVENT_CALC_DRINK_TYPES as readonly string[]).includes(row.drinkType)) {
      throw new InconsistentNormsError(
        'UNKNOWN_DRINK_TYPE',
        `"${String(row.drinkType)}" is not one of: ${EVENT_CALC_DRINK_TYPES.join(', ')}`,
      );
    }
    if (seenTypes.has(row.drinkType)) {
      throw new InconsistentNormsError(
        'DUPLICATE_DRINK_TYPE',
        `drink type "${row.drinkType}" appears in more than one resolved row`,
      );
    }
    seenTypes.add(row.drinkType);

    if (typeof row.versionLabel !== 'string' || row.versionLabel.trim() === '') {
      throw new InconsistentNormsError(
        'MISSING_VERSION_LABEL',
        `norm row for "${row.drinkType}" carries no version label`,
      );
    }

    // includes() above is the guard; the union is not inferable from it.
    validated.push({
      drinkType: row.drinkType as EventDrinkType,
      normValueMl: normValueToWholeMl(row),
      versionLabel: row.versionLabel,
    });
    labels.push(row.versionLabel);
  }

  ensureSingleVersion(labels);
  return validated;
}

/**
 * Convert a litres norm to exact integer millilitres, rejecting any
 * value that is not a whole number of millilitres (finite, positive,
 * centilitre-granularity). Never rounds: a silently adjusted norm
 * would be an invisible dataset change.
 */
function normValueToWholeMl(row: EventNormRow): number {
  const value = row.normValuePerGuestPerHour;
  const ml = value * ML_PER_LITRE;
  const rounded = Math.round(ml);
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    Math.abs(ml - rounded) >= WHOLE_ML_EPSILON ||
    !Number.isSafeInteger(rounded)
  ) {
    throw new InconsistentNormsError(
      'INVALID_NORM_VALUE',
      `norm for "${row.drinkType}" is ${String(value)} l/guest/hour — ` +
        'expected a finite positive value that is a whole number of millilitres',
    );
  }
  return rounded;
}

/** All rows must name one norms version — the R5 provenance contract. */
function ensureSingleVersion(labels: readonly string[]): void {
  const distinct = new Set(labels);
  if (distinct.size > 1) {
    throw new MixedNormVersionsError(labels);
  }
}

// ---------------------------------------------------------------------------
// Need computation — exact integer arithmetic
// ---------------------------------------------------------------------------

/**
 * `normMl × guests × durationHours` with overflow guarded stepwise so
 * the product is provably a safe integer before it is formed — the
 * "never float-drift" promise holds at any accepted input size.
 */
function safeNeedMl(normMl: number, guests: number, durationHours: number): number {
  const maxSafe = Number.MAX_SAFE_INTEGER;
  if (guests > maxSafe / normMl) {
    throw new InvalidEventInputError(
      `guests × norm (${String(guests)} × ${String(normMl)} ml) exceeds the safe-integer range`,
    );
  }
  const perHourMl = normMl * guests;
  if (durationHours > maxSafe / perHourMl) {
    throw new InvalidEventInputError(
      `need volume (${String(perHourMl)} ml/guest-hour × ${String(durationHours)} h) ` +
        'exceeds the safe-integer range',
    );
  }
  const needMl = perHourMl * durationHours;
  if (!Number.isSafeInteger(needMl)) {
    throw new InvalidEventInputError('need volume exceeds the safe-integer range');
  }
  return needMl;
}

// ---------------------------------------------------------------------------
// Minimal-surplus plan search
// ---------------------------------------------------------------------------

/** A plan under construction: quantity per chosen size. */
interface PlanCandidate {
  readonly counts: ReadonlyMap<number, number>; // sizeMl → quantity (all ≥ 1)
  readonly purchasedMl: number;
  readonly surplusMl: number;
  readonly totalUnits: number;
  readonly largestSizeMl: number;
  readonly smallestSizeMl: number;
}

/** Winner key, compared lexicographically — see the module docs. */
function planKey(plan: PlanCandidate): readonly [number, number, number, number] {
  return [plan.surplusMl, plan.totalUnits, plan.largestSizeMl, plan.smallestSizeMl];
}

function beatsCandidate(a: PlanCandidate, b: PlanCandidate): boolean {
  const ka = planKey(a);
  const kb = planKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i];
  }
  return false; // identical keys ⇒ identical plan (≤2 distinct sizes)
}

/** Exact integer `ceil(a / b)` for safe positive integers — no float ceil. */
function ceilDiv(a: number, b: number): number {
  const q = Math.floor(a / b);
  return q * b < a ? q + 1 : q;
}

/**
 * Enumerate the candidate plans for one need (module docs: every plan
 * using at most two unit sizes) and return the winner. Enumeration is
 * bounded: `ceil(need / size)` iterations per size pair — linear in the
 * container count a pure-large plan would need, trivial for any
 * realistic event.
 */
function searchPlan(needMl: number, units: readonly RetailUnit[]): PlanCandidate {
  let best: PlanCandidate | null = null;

  for (let large = 0; large < units.length; large += 1) {
    const largeUnit = units[large];
    const maxLargeCount = ceilDiv(needMl, largeUnit.sizeMl);
    for (let small = 0; small <= large; small += 1) {
      const smallUnit = units[small];
      for (let largeCount = 0; largeCount <= maxLargeCount; largeCount += 1) {
        const covered = largeCount * largeUnit.sizeMl;
        const remaining = needMl - covered;
        const smallCount = remaining > 0 ? ceilDiv(remaining, smallUnit.sizeMl) : 0;
        if (largeCount === 0 && smallCount === 0) continue; // need > 0 ⇒ unreachable
        const purchasedMl = covered + smallCount * smallUnit.sizeMl;
        const candidate: PlanCandidate = {
          counts: new Map([
            ...(largeCount > 0 ? [[largeUnit.sizeMl, largeCount] as const] : []),
            ...(smallCount > 0 ? [[smallUnit.sizeMl, smallCount] as const] : []),
          ]),
          purchasedMl,
          surplusMl: purchasedMl - needMl,
          totalUnits: largeCount + smallCount,
          largestSizeMl: largeCount > 0 ? largeUnit.sizeMl : smallUnit.sizeMl,
          smallestSizeMl: smallCount > 0 ? smallUnit.sizeMl : largeUnit.sizeMl,
        };
        if (best === null || beatsCandidate(candidate, best)) {
          best = candidate;
        }
      }
    }
  }

  // The caller guarantees needMl ≥ 1 and at least one unit per type, so
  // the pure-small plan (largeCount 0) always exists — best is non-null.
  return best as PlanCandidate;
}

/** Convert a consumption line into its shopping-list line. */
function buildLine(line: EventConsumptionLine): ShoppingListLine {
  const units = RETAIL_UNITS_BY_DRINK_TYPE[line.drinkType];

  if (line.needMl === 0) {
    // Zero guests or zero duration: buying nothing is the exact
    // minimal-surplus plan.
    return {
      drinkType: line.drinkType,
      needMl: 0,
      needLitres: 0,
      plannedUnits: [],
      totalUnits: 0,
      purchasedMl: 0,
      surplusMl: 0,
      surplusLitres: 0,
      versionLabel: line.versionLabel,
    };
  }

  const plan = searchPlan(line.needMl, units);

  // Size DESCENDING — largest container first, a fixed deterministic order.
  const plannedUnits = [...plan.counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([sizeMl, quantity]) => toPlannedUnit(sizeMl, quantity, units));

  return {
    drinkType: line.drinkType,
    needMl: line.needMl,
    needLitres: line.needLitres,
    plannedUnits,
    totalUnits: plan.totalUnits,
    purchasedMl: plan.purchasedMl,
    surplusMl: plan.surplusMl,
    surplusLitres: plan.surplusMl / ML_PER_LITRE,
    versionLabel: line.versionLabel,
  };
}

function toPlannedUnit(sizeMl: number, quantity: number, units: readonly RetailUnit[]): PlannedUnit {
  const unit = units.find((u) => u.sizeMl === sizeMl);
  // The plan only uses sizes from this line's own catalogue.
  const known = unit as RetailUnit;
  return {
    sizeMl,
    sizeLitres: sizeMl / ML_PER_LITRE,
    description: known.description,
    quantity,
  };
}
