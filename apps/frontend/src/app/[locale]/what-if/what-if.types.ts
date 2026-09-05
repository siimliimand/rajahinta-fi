/**
 * What-if simulator DTOs — POST /api/v1/what-if/excise (task 8.2, change
 * product-roadmap-phases-1-4).
 *
 * Mirrors the serialized contract of
 * `apps/api-worker/src/routes/what-if.routes.ts`. Kept in the what-if
 * scope and re-declared rather than imported from the worker
 * (trip.types.ts precedent): a cross-app import would drag the worker's
 * Hono/D1 module graph into the frontend bundle.
 *
 * The endpoint is ANONYMOUS and EPHEMERAL by spec: no account, no
 * server-side scenario storage. The response carries a share token that
 * encodes the scenario INPUTS — the only carry-over state, and it lives
 * with the client.
 *
 * @module WhatIfTypes
 */

import type { Disclaimer } from '@/lib/types';

/** Canonical excise categories — the API's zod enum (core-domain TAX_CATEGORY_KEYS). */
export type WhatIfCategoryKey =
  | 'beer'
  | 'wine_still'
  | 'wine_sparkling'
  | 'spirits'
  | 'intermediate_products'
  | 'other_fermented';

/** One scenario product — caller facts only; the baseline is resolved server-side. */
export interface WhatIfProductInput {
  /** Caller-chosen label, 1–100 chars, unique within the scenario. */
  readonly id: string;
  readonly category: WhatIfCategoryKey;
  /** ABV as a fraction in [0, 1] — the engine's contract. */
  readonly abv: number;
  readonly volumeLitres: number;
  /** Domestic reference price (Alko) in euro cents, integer ≥ 0. */
  readonly alkoPriceCents: number;
  /** Import retail price in euro cents, integer ≥ 0. */
  readonly importPriceCents: number;
}

/** Request body — bounds enforced client-side and re-validated server-side. */
export interface WhatIfScenarioRequest {
  /** Hypothetical rate in € per formula unit, [0, 1000]. */
  readonly hypotheticalRate: number;
  /** 1–20 products, unique ids. */
  readonly products: readonly WhatIfProductInput[];
}

/** The rule the engine applied as the baseline, named for the pure module. */
export interface WhatIfBaselineInfo {
  readonly formulaRef: string;
  /** Raw rate the formula dispatch multiplies by (per formula unit). */
  readonly rateApplied: number;
  readonly taxCents: number;
  readonly taxDatasetVersion: string;
  readonly ruleId: number | null;
  readonly reliability: string;
}

/** The hypothetical substitution applied to one product's baseline rule. */
export interface WhatIfHypotheticalInfo {
  readonly formulaRef: string;
  readonly rate: number;
  readonly rateApplied: number;
  readonly taxCents: number;
}

/** One product line — baseline vs hypothetical with the gap convention. */
export interface WhatIfLine {
  readonly id: string;
  readonly category: string;
  /** Import retail price + excise, baseline rate. */
  readonly importTotalBaselineCents: number;
  /** Import retail price + excise, hypothetical rate. */
  readonly importTotalHypotheticalCents: number;
  /** Baseline import total − domestic reference price. */
  readonly gapBaselineCents: number;
  /** Hypothetical import total − domestic reference price. */
  readonly gapHypotheticalCents: number;
  /** gapHypothetical − gapBaseline: positive = the substituted rate makes
   *  importing dearer relative to the domestic reference. */
  readonly gapDeltaCents: number;
  readonly baseline: WhatIfBaselineInfo;
  readonly hypothetical: WhatIfHypotheticalInfo;
}

export interface WhatIfTotals {
  readonly baselineExciseCents: number;
  readonly hypotheticalExciseCents: number;
  readonly gapBaselineCents: number;
  readonly gapHypotheticalCents: number;
}

/** The pure module's result — structural HYPOTHETICAL disclaimer included. */
export interface WhatIfScenarioResult {
  readonly hypotheticalRate: number;
  /** Single baseline dataset version the whole scenario resolved against. */
  readonly baselineTaxDatasetVersion: string;
  /** Structural disclaimer — rendered as returned, never a UI-only string. */
  readonly disclaimer: Disclaimer;
  readonly lines: readonly WhatIfLine[];
  readonly totals: WhatIfTotals;
}

/** The 200 payload: the scenario result + the share token for the inputs. */
export type WhatIfResponse = WhatIfScenarioResult & {
  readonly shareToken: string;
};
