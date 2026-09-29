/**
 * Canonical-category labels (task 5.1, change
 * expand-alerts-accuracy-breakdowns) — the established FI/EN vocabulary
 * the catalog page has always rendered for the six canonical values,
 * shared with the accuracy breakdown's category cells so the same value
 * carries the same label everywhere.
 *
 * Kept as a structural constant rather than catalog keys (the catalog
 * page's documented rationale): the flat canonical-key → localized-label
 * mapping is not user-visible copy of its own, and the same labels feed
 * the filter links, the card badges, the per-category metadata titles,
 * and the breakdown cells.
 *
 * @module category-labels
 */

/** Canonical product categories — mirrors PRODUCT_CATEGORIES in the D1
 *  schema (packages/data-platform), which the API validates against. */
export const CANONICAL_CATEGORIES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

/** Locales the [locale] segment serves (fi is the default, en prefixed). */
export type CategoryLabelLocale = 'fi' | 'en';

export const CATEGORY_LABELS: Record<
  CanonicalCategory,
  Record<CategoryLabelLocale, string>
> = {
  beer: { fi: 'Olut', en: 'Beer' },
  wine_still: { fi: 'Makuuviini', en: 'Still wine' },
  wine_sparkling: { fi: 'Kuohuviini', en: 'Sparkling wine' },
  intermediate_products: {
    fi: 'Välituotteet (esim. vermutti)',
    en: 'Intermediate products (e.g. vermouth)',
  },
  other_fermented: { fi: 'Siideri ja pitkäjuoma', en: 'Cider and long drink' },
  spirits: { fi: 'Väkevät alkoholijuomat', en: 'Spirits' },
};

/** Localized label for a canonical category; the raw value is the
 *  fallback so an out-of-vocabulary value can never render as an empty
 *  label. */
export function categoryLabel(
  category: string,
  locale: CategoryLabelLocale,
): string {
  return CATEGORY_LABELS[category as CanonicalCategory]?.[locale] ?? category;
}
