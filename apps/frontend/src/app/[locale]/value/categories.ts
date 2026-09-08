/**
 * Canonical category keys of the €/g value listing — the same closed set
 * the API validates against (TAX_CATEGORY_KEYS; unitprice.routes.ts).
 *
 * The page's selector offers exactly these keys and nothing else, so an
 * unknown `?category=` value is normalized to the default before it can
 * reach the API (the API would answer 400 for anything outside the set).
 */

export const VALUE_CATEGORY_KEYS = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

export type ValueCategoryKey = (typeof VALUE_CATEGORY_KEYS)[number];

export const VALUE_DEFAULT_CATEGORY: ValueCategoryKey = 'beer';

/**
 * Narrow an arbitrary `?category=` value to a canonical key, or null when
 * the value is missing or outside the set (caller decides the fallback).
 */
export function toValueCategoryKey(
  raw: string | undefined,
): ValueCategoryKey | null {
  return (VALUE_CATEGORY_KEYS as readonly string[]).includes(raw ?? '')
    ? (raw as ValueCategoryKey)
    : null;
}
