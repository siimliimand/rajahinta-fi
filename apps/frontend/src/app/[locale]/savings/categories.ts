/**
 * Canonical category keys of the savings listing — the same closed set
 * the value listing's selector offers (TAX_CATEGORY_KEYS; the savings
 * route matches the stored category verbatim and answers an unknown
 * category with an empty list, but the selector offers exactly these
 * keys so the URL state can never drift outside the catalog).
 */

export const SAVINGS_CATEGORY_KEYS = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

export type SavingsCategoryKey = (typeof SAVINGS_CATEGORY_KEYS)[number];

export const SAVINGS_DEFAULT_CATEGORY: SavingsCategoryKey = 'beer';

/**
 * Narrow an arbitrary `?category=` value to a canonical key, or null when
 * the value is missing or outside the set (caller decides the fallback).
 */
export function toSavingsCategoryKey(
  raw: string | undefined,
): SavingsCategoryKey | null {
  return (SAVINGS_CATEGORY_KEYS as readonly string[]).includes(raw ?? '')
    ? (raw as SavingsCategoryKey)
    : null;
}
