/**
 * Scenario draft → API request mapping for the what-if form (task 8.3).
 *
 * Pure and UI-free so the parsing rules (comma decimals, integer cents,
 * percent → ABV fraction, per-field bounds mirroring the API's zod
 * schema) are unit-testable without a DOM. The bounds here mirror
 * `apps/api-worker/src/routes/what-if.routes.ts` — the client validates
 * first so out-of-bounds input never becomes a doomed request.
 *
 * @module WhatIfScenarioDraft
 */

import type { WhatIfCategoryKey, WhatIfScenarioRequest } from './what-if.types';

/** One form row — raw input strings, parsed only at request-build time. */
export interface ProductDraft {
  /** Client-only row identity (React key + unique scenario id). */
  readonly key: string;
  readonly category: WhatIfCategoryKey;
  /** Percent, e.g. "4,7" → ABV fraction 0.047. */
  readonly abvPercent: string;
  readonly volumeLitres: string;
  /** Euros, e.g. "12,98" → 1298 cents. */
  readonly alkoPriceEur: string;
  readonly importPriceEur: string;
}

/** Slider geometry — the API's rate bounds with a 0.1 € step. */
export const RATE_SLIDER = {
  min: 0,
  max: 1000,
  step: 0.1,
  defaultValue: 20,
} as const;

/** Row bounds, mirroring the API's zod schema. */
export const DRAFT_BOUNDS = {
  maxAbvPercent: 100,
  maxVolumeLitres: 10_000,
  maxPriceCents: 10_000_000,
  maxProducts: 20,
} as const;

/** Canonical category list for the row select, in core-domain order. */
export const DRAFT_CATEGORY_KEYS: readonly WhatIfCategoryKey[] = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'spirits',
  'intermediate_products',
  'other_fermented',
];

/** A fresh, empty row — `key` must be unique within the form's lifetime. */
export function newProductDraft(key: string): ProductDraft {
  return {
    key,
    category: 'beer',
    abvPercent: '',
    volumeLitres: '',
    alkoPriceEur: '',
    importPriceEur: '',
  };
}

/**
 * Parse a decimal input accepting the Finnish comma decimal separator.
 * No scenario field admits a negative value, so negatives are rejected
 * here alongside malformed text. Returns null when unparsable.
 */
export function parseDecimalInput(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Euros (≤ 2 decimals) → integer cents; null when malformed or finer than cents. */
export function parseEurToCents(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  // At most two decimals — the API takes integer cents and never rounds.
  if (normalized === '' || !/^\d*(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  if (cents < 0 || cents > DRAFT_BOUNDS.maxPriceCents) return null;
  return cents;
}

/** Percent → ABV fraction ([0, 1]); null outside 0–100 %. */
export function parseAbvPercent(raw: string): number | null {
  const percent = parseDecimalInput(raw);
  if (percent === null || percent < 0 || percent > DRAFT_BOUNDS.maxAbvPercent) {
    return null;
  }
  return percent / 100;
}

/** Litres; null outside the API's volume cap. */
export function parseVolumeLitres(raw: string): number | null {
  const litres = parseDecimalInput(raw);
  if (litres === null || litres < 0 || litres > DRAFT_BOUNDS.maxVolumeLitres) {
    return null;
  }
  return litres;
}

/**
 * Whether every started row parses into a product the API would accept.
 * The client keeps the whole scenario out of the request until it is
 * fully valid — the API is never asked to reject what the form can
 * catch.
 */
export function buildScenarioRequest(
  hypotheticalRate: number,
  rows: readonly ProductDraft[],
): WhatIfScenarioRequest | null {
  if (rows.length < 1 || rows.length > DRAFT_BOUNDS.maxProducts) return null;
  if (!Number.isFinite(hypotheticalRate) || hypotheticalRate < 0 || hypotheticalRate > 1000) {
    return null;
  }

  const products = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.key.trim();
    if (id.length < 1 || id.length > 100 || seen.has(id)) return null;
    seen.add(id);

    const abv = parseAbvPercent(row.abvPercent);
    const volumeLitres = parseVolumeLitres(row.volumeLitres);
    const alkoPriceCents = parseEurToCents(row.alkoPriceEur);
    const importPriceCents = parseEurToCents(row.importPriceEur);
    if (
      abv === null ||
      volumeLitres === null ||
      alkoPriceCents === null ||
      importPriceCents === null
    ) {
      return null;
    }
    products.push({
      id,
      category: row.category,
      abv,
      volumeLitres,
      alkoPriceCents,
      importPriceCents,
    });
  }
  return { hypotheticalRate, products };
}

/** Map a decoded share-token scenario back into editable draft rows. */
export function draftRowsFromScenario(
  scenario: WhatIfScenarioRequest,
): { rate: number; rows: ProductDraft[] } {
  return {
    rate: scenario.hypotheticalRate,
    rows: scenario.products.map((product) => ({
      key: product.id,
      category: product.category,
      abvPercent: String(product.abv * 100),
      volumeLitres: String(product.volumeLitres),
      alkoPriceEur: (product.alkoPriceCents / 100).toFixed(2),
      importPriceEur: (product.importPriceCents / 100).toFixed(2),
    })),
  };
}
