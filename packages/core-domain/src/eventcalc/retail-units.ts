/**
 * Retail unit catalogue for the minimal-surplus shopping list
 * (spec: event-calculator, design R6) — documented, pinned constants.
 *
 * Sizes are the realistic Finnish retail (Alko/market) container sizes
 * per drink type, in exact whole millilitres, sorted ascending. The
 * planner rounds each line's need up to a purchase plan built from AT
 * MOST TWO of these sizes (see the plan-search rule in eventcalc.ts) —
 * keeping the catalogue to the sizes actually on shelves keeps the
 * surplus arithmetic explainable: every suggested container exists in
 * reality.
 *
 * Deliberately absent: case multiples. A case is an exact multiple of
 * its units, so per-unit rounding already dominates it on the
 * minimal-surplus criterion; carrying both would only blur which
 * figure the surplus describes.
 *
 * @module EventCalcRetailUnits
 */

import type { EventDrinkType } from './eventcalc.types';

/** One retail container size, exact integer millilitres. */
export interface RetailUnit {
  readonly sizeMl: number;
  /** Human-readable description, e.g. `"0.33 l can"`. */
  readonly description: string;
}

/**
 * Retail unit sizes per drink type, ascending by size — the planner's
 * only source of purchasable containers. Pinned by test: every type
 * has at least one unit and the sizes are strictly ascending.
 */
export const RETAIL_UNITS_BY_DRINK_TYPE: Readonly<
  Record<EventDrinkType, readonly RetailUnit[]>
> = {
  // Beer and other fermented (cider/long drink): 0.33 l and 0.5 l cans.
  beer: [
    { sizeMl: 330, description: '0.33 l can' },
    { sizeMl: 500, description: '0.5 l can' },
  ],
  other_fermented: [
    { sizeMl: 330, description: '0.33 l can' },
    { sizeMl: 500, description: '0.5 l can' },
  ],
  // Still wine: standard 0.75 l and 1.0 l bottles, 3.0 l bag-in-box.
  wine_still: [
    { sizeMl: 750, description: '0.75 l bottle' },
    { sizeMl: 1000, description: '1.0 l bottle' },
    { sizeMl: 3000, description: '3.0 l bag-in-box' },
  ],
  // Sparkling wine: standard 0.75 l bottle, 1.5 l magnum.
  wine_sparkling: [
    { sizeMl: 750, description: '0.75 l bottle' },
    { sizeMl: 1500, description: '1.5 l magnum' },
  ],
  // Intermediate products (vermouth, glögi): 0.5 l / 0.75 l / 1.0 l bottles.
  intermediate_products: [
    { sizeMl: 500, description: '0.5 l bottle' },
    { sizeMl: 750, description: '0.75 l bottle' },
    { sizeMl: 1000, description: '1.0 l bottle' },
  ],
  // Spirits: 0.5 l and 0.7 l bottles.
  spirits: [
    { sizeMl: 500, description: '0.5 l bottle' },
    { sizeMl: 700, description: '0.7 l bottle' },
  ],
};
