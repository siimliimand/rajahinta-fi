/**
 * Source-market category normalization (task 7.1, change
 * technical-assessment-remediation).
 *
 * Maps source-market category strings — Swedish assortment groups
 * ("Öl", "Vin", "Sprit", …) first, then the English/Finnish tokens
 * `normalizeCategory` already knows — onto the canonical category keys
 * the tax rules use, so gate-passing ingestion data is also
 * tax-meaningful and live feeds do not fall into the excise engine's
 * fallback rates.
 *
 * An unmappable string maps to null. Callers flag the record for the
 * correction queue; silently assigning a fallback category is
 * forbidden by the product-normalization spec.
 *
 * @module SourceCategoryMapper
 */

import { TAX_CATEGORY_KEYS, type TaxCategory } from '../tax/tax-categories';
import type { CanonicalCategory } from './normalization.types';
import { normalizeCategory } from './normalization.service';

/**
 * The result of normalizing a source category string.
 *
 * Carries both vocabularies: the granular canonical category (matching,
 * display) and the tax-rule category key (what the excise engine and the
 * taxRules.productCategory column key on).
 */
export interface SourceCategoryMapping {
  /** Granular canonical category. */
  readonly canonicalCategory: CanonicalCategory;
  /** The canonical key the tax rules use (taxRules.productCategory). */
  readonly taxCategory: TaxCategory;
}

/**
 * Swedish source-category tokens (Systembolaget assortment groups and
 * their common sub-group names) → canonical categories, extended with
 * the live alks.fi catalog vocabulary (sweep decision 2026-09-09,
 * change alks-feed-and-import-vat): Finnish/English beverage-type
 * terms and plural forms the Systembolaget rows do not cover — and the
 * kippis.fi department vocabulary (sweep decision 2026-09-15, change
 * onboard-kippis-merchant): the 13 department terms that drive 100 %
 * of that catalog's category-driven drops.
 *
 * Keys are lowercase; matching is exact after trim/lowercase because
 * assortment groups are controlled vocabulary, not free text.
 */
export const SWEDISH_SOURCE_CATEGORY_MAP: Readonly<Record<string, CanonicalCategory>> = {
  // Produktgrupp:Öl
  'öl': 'beer',
  // Produktgrupp:Vin
  'vin': 'wine',
  'rött vin': 'wine',
  'vitt vin': 'wine',
  'rosévin': 'wine',
  'rosevin': 'wine',
  // Mousserande
  'mousserande vin': 'sparkling-wine',
  mousserande: 'sparkling-wine',
  // Produktgrupp:Sprit
  sprit: 'spirits',
  likör: 'liqueur',
  // Starkvin / aperitif-desserter — fortified & aromatised wines
  starkvin: 'fortified-wine',
  aperitif: 'fortified-wine',
  'aperitif och dessert': 'fortified-wine',
  glögg: 'fortified-wine',
  // Produktgrupp:Cider och blanddrycker
  cider: 'cider',
  'cider och blanddrycker': 'cider',
  'cider & blanddrycker': 'cider',
  // Rice wine
  sake: 'sake',
  // Alkoholfritt assortment group
  alkoholfritt: 'non-alcoholic',
  alkoholfri: 'non-alcoholic',

  // --- alks.fi catalog vocabulary (sweep decision 2026-09-09, change
  // alks-feed-and-import-vat). Additive only: every term maps to an
  // existing canonical category. Merchandising groups with no beverage
  // meaning (seasonal and country categories, "upcoming products",
  // syrup) stay unmapped on purpose — those rows belong in the
  // correction queue, never in a guessed category.
  //
  // Strong-alcohol departments (väkevä = "strong", ee-str = the
  // Estonian shop's strong group) and spirit-type nouns.
  'väkevä': 'spirits',
  'ee-str': 'spirits',
  akvavit: 'spirits', // Swedish/Danish spelling; 'aquavit'/'akvaviitti' already map
  rommi: 'spirits',
  viski: 'spirits',
  calvados: 'spirits',
  armagnac: 'spirits',
  rakija: 'spirits',
  // Finnish wine-type nouns ('red wine'/'white wine' exist as English).
  punaviini: 'wine',
  valkoviini: 'wine',
  // Longero sweep decision 2026-09-14 (change onboard-longero-merchant):
  // the only probe candidate with no mapping — 37 live rows dropped on
  // this exact term. The Swedish 'rosévin'/'rosevin' above do not match
  // the Finnish double-e spellings, and matching is exact, so the plural
  // needs its own key.
  roseeviini: 'wine',
  roseeviinit: 'wine',
  'kuohuviini ja samppanja': 'sparkling-wine',
  // Finnish vermouth spelling; 'vermouth' already maps.
  vermutti: 'fortified-wine',
  // Plural / shop-group beer terms ('olut' singular already maps).
  oluet: 'beer',
  'ee-olutit': 'beer',
  // Plural of 'cocktail' and the Finnish "drink mix" (premixed RTD)
  // term — same long-drink family as their singulars.
  cocktails: 'long-drink',
  juomasekoitus: 'long-drink',
  // Non-alcoholic beverage groups.
  virvoitusjuomat: 'non-alcoholic',
  'soft drinks': 'non-alcoholic',
  'energy drink': 'non-alcoholic',
  'alkoholittomat juomat': 'non-alcoholic',

  // --- kippis.fi catalog vocabulary (sweep decision 2026-09-15, change
  // onboard-kippis-merchant). Additive only: all 13 live department
  // terms map to existing canonical categories, and they are the whole
  // of that feed's current category-driven drops. Merchandising groups
  // ("Lahjakortti" gift cards, "Upsell") stay unmapped on purpose.
  //
  // Wine-department plurals — still vs sparkling exactly like their
  // singulars ('punaviini'/'valkoviini' → wine, 'mousserande' and
  // 'kuohuviini ja samppanja' → sparkling-wine).
  punaviinit: 'wine',
  valkoviinit: 'wine',
  kuohuviinit: 'sparkling-wine',
  // Spirit-department plurals and type nouns, mirroring their singulars
  // ('viski', 'rommi') and the cognac-family entries ('calvados',
  // 'armagnac'); the vodka-and-viina department is spirits by definition.
  viskit: 'spirits',
  rommit: 'spirits',
  konjakit: 'spirits',
  ginit: 'spirits',
  'vodkat ja viinat': 'spirits',
  // Plural of 'likör' — liqueur, like its singular.
  liköörit: 'liqueur',
  // Aperitif department — same fortified/aromatised family as the
  // Swedish 'aperitif' / 'aperitif och dessert' entries.
  aperitiivit: 'fortified-wine',
  // Ciders, long drinks and seltzers — the Finnish counterpart of the
  // Swedish 'cider och blanddrycker' group.
  'siiderit lonkerot ja seltzerit': 'cider',
  // Non-alcoholic mixers and energy drinks ('virvoitusjuomat' and
  // 'energy drink' already map the same way).
  'virvoitusjuomat ja mikserit': 'non-alcoholic',
  energiajuomat: 'non-alcoholic',
};

/** Explicit "other" tokens in the sources we ingest — mappable, unlike garbage. */
const EXPLICIT_OTHER_TOKENS: ReadonlySet<string> = new Set([
  'other',
  'annat', // SE
  'muu', // FI
  // alks.fi explicit-other spellings (sweep decision 2026-09-09) —
  // same treatment as 'muu': honest 'other', never a guessed beverage type.
  'muut', // FI plural
  'muut juomat', // FI "other drinks"
  'other drinks', // EN
]);

/**
 * Granular canonical category → the tax-rule category key the excise
 * engine resolves rules by.
 *
 * Mirrors the engine's own alias table (alcohol-excise.math.ts
 * `normaliseCategory`) for the granular keys that table does not know,
 * so a canonical value never falls into the engine's default branch.
 */
const CANONICAL_TO_TAX_CATEGORY: Readonly<Record<CanonicalCategory, TaxCategory>> = {
  beer: 'beer',
  wine: 'wine_still',
  'sparkling-wine': 'wine_sparkling',
  'fortified-wine': 'intermediate_products',
  spirits: 'spirits',
  liqueur: 'spirits',
  cider: 'other_fermented',
  'long-drink': 'other_fermented',
  sake: 'other_fermented',
  // Every category's lowest ABV band is zero-rated, so the tax-key for a
  // 0.0 % product is numerically inert; other_fermented is the taxonomy's
  // catch-all for non-beer/wine/spirits fermented and alcohol-free drinks.
  'non-alcoholic': 'other_fermented',
  other: 'other_fermented',
};

/**
 * Normalize a source-market category string.
 *
 * Returns null when the string has no canonical mapping — the caller
 * flags the record for the correction queue instead of assigning a
 * fallback category.
 */
export function mapSourceCategory(raw: string): SourceCategoryMapping | null {
  const key = raw.trim().toLowerCase();
  if (key === '') return null;

  const canonicalCategory = SWEDISH_SOURCE_CATEGORY_MAP[key] ?? normalizeCategory(key);
  if (canonicalCategory === 'other' && !EXPLICIT_OTHER_TOKENS.has(key)) {
    // normalizeCategory collapses anything unrecognised into 'other';
    // the spec requires unmappables to be flagged, not silently assigned.
    return null;
  }

  const taxCategory = CANONICAL_TO_TAX_CATEGORY[canonicalCategory];
  return { canonicalCategory, taxCategory };
}

/**
 * Whether a tax-rule category key is valid — guard for ingestion code
 * writing `taxCategory` values it did not obtain from this mapper.
 */
export function isKnownTaxCategory(value: string): value is TaxCategory {
  return (TAX_CATEGORY_KEYS as readonly string[]).includes(value);
}
