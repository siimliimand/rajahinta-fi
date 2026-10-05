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
 * An unmappable string maps to null — unless the product's ABV is above
 * the 22 % EU intermediate-products boundary, in which case the boundary
 * rule resolves it (and every fermented-bucket keyword outcome) to
 * spirits, attributable via `boundaryApplied`. Below the boundary,
 * callers flag unmappables for the correction queue; silently assigning
 * a fallback category is forbidden by the product-normalization spec.
 *
 * The non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene,
 * design D3) is the physical prerequisite in the other direction: a row
 * whose ABV is keyed as zero, or as unparseable (`null` — the value both
 * feed adapters pass when the name carried no usable percentage), can
 * never be *placed* in a typed alcohol category. Such a row resolves to
 * the canonical non-alcoholic category instead, attributable via
 * `nonAlcoholicHold`, and the caller carries the correction flag and the
 * {@link NONALCOHOLIC_HOLD_REASON} review hold. An ABV greater than zero
 * keeps the keyword outcome entirely — including the boundary rule, which
 * stays untouched (above 22 % the guard cannot fire anyway).
 *
 * @module SourceCategoryMapper
 */

/**
 * The machine-readable review-hold reason persisted on
 * `product_master.review_hold_reason` for a row the non-alcoholic guard
 * re-assigned: the storefront category said alcohol, the product's ABV
 * says otherwise, and review — not the read path — resolves the
 * disagreement. `NULL` in that column means not held.
 */
export const NONALCOHOLIC_HOLD_REASON = 'nonalcoholic_in_alcohol_category';

import { TAX_CATEGORY_KEYS, type TaxCategory } from '../tax/tax-categories';
import { INTERMEDIATE_PRODUCTS_ABV_CEILING } from '../tax/services/alcohol-excise.math';
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
  /**
   * Present (true) only when the EU intermediate-products boundary
   * determined the outcome: a >22 % ABV product re-assigned to spirits
   * from a keyword path (or from no mapping at all) that would otherwise
   * have yielded a fermented bucket. Absent for keyword outcomes —
   * review output can therefore attribute every above-boundary spirits
   * result to the boundary rule rather than to a keyword (design D1,
   * change first-impression-pass).
   */
  readonly boundaryApplied?: true;
  /**
   * Present (true) only when the non-alcoholic ingestion guard determined
   * the outcome: a keyed-zero or unparseable ABV (`null`) product whose
   * keyword/category outcome would have been a typed alcohol category is
   * re-assigned to `non-alcoholic` (design D3, change
   * nonalcoholic-catalog-hygiene). The caller persists the row with
   * {@link NONALCOHOLIC_HOLD_REASON} and flags it for the correction
   * queue — the row still ingests (the ESTIMATED-status contract for
   * unparseable fields is unchanged); the hold is what removes it from
   * user-facing surfaces. Absent for keyword outcomes.
   */
  readonly nonAlcoholicHold?: true;
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

  // --- mydrink.ee catalog vocabulary (sweep decision 2026-09-27,
  // change onboard-mydrink-merchant). Additive only: every term maps to
  // an existing canonical category. The sweep's beverage terms not
  // already covered are added here — they carry the beverage rows behind
  // most of that catalog's 443 category-driven drops (707-row sweep,
  // design D3).
  // 'viski' already maps above; the Estonian double-ö 'liköör' does not
  // match the single-ö Swedish 'likör' under exact matching and needs
  // its own key. The store decorates expandable sections with a
  // trailing ' ▾'; that decoration is part of the raw term and
  // therefore of the key.
  //
  // Deliberately NOT mapped:
  // - 'veinid ▾' (wine parent, 152 rows): category mapping takes the
  //   first mappable term in payload order, so mapping the parent would
  //   misfile Vahuveinid/Shampanjad rows as still wine whenever the
  //   parent sorts first — still vs sparkling carry different excise
  //   rates. Sparkling resolves only from its own leaves; wine rows with
  //   no leaf stay unmapped (correction queue; measured by the 1.2
  //   re-sweep).
  // - 'kokteilijoogid' / 'kokteil' (RTD cocktails): span spirits-based
  //   and fermented-based taxation; no grounded canonical exists, so
  //   the rows stay unmapped rather than guessed.
  // - Promo/decorative/navigational terms ('☝️ Lahja alkohol',
  //   '☝️ Kange', '☝️ Pakkumised ▾', 'Kingiideed ▾', 'Avaleht',
  //   'Pandipakend', country names): not beverage categories.
  'kange alkohol ▾': 'spirits',
  vodka: 'spirits',
  konjak: 'spirits',
  rumm: 'spirits',
  gin: 'spirits',
  liköör: 'liqueur',
  // Spirit-family keywords the 26 misclassified >22 % rows came from
  // (task 1.1, change first-impression-pass, design D1). Additive only:
  // every term maps to the existing canonical spirits category at any
  // ABV, so the audit trail is attributional — a bitter/snaps/
  // akvavit/sambuca/arrak family string is a keyword outcome, never a
  // boundary-rule re-assignment. Forms 'akvavit' (here), 'aquavit',
  // 'akvaviitti' and 'bitters' (normalizeCategory) already mapped; these
  // are the attested market spellings that did not (derive-brand
  // stoplist, Alko group vocabulary, live alks.fi rows):
  bitter: 'spirits', // SV/EN/DK singular; 'bitters' already maps
  bitteri: 'spirits', // FI singular
  bitterit: 'spirits', // FI plural
  katkero: 'spirits', // FI bitters family ('katkerot' group → 'bitters' in the Alko adapter)
  katkerot: 'spirits',
  snaps: 'spirits', // SV/DK/NO
  snapsi: 'spirits', // FI
  brannvin: 'spirits', // SV akvavit family
  sambuca: 'spirits',
  arrak: 'spirits', // FI/ET spelling
  akvaviitit: 'spirits', // FI plural of 'akvavit'
  // Still-wine leaves ('punane'/'valge' = red/white; 'pakiveinid' =
  // bag-in-box wine) — the leaf-first counterparts of 'veinid ▾'.
  punased: 'wine',
  valged: 'wine',
  pakiveinid: 'wine',
  // Sparkling leaves — kept separate from still wine for the excise
  // split, exactly like 'mousserande vin' above.
  vahuveinid: 'sparkling-wine',
  shampanjad: 'sparkling-wine',
  'õlu ▾': 'beer',
  siider: 'cider',
  'alkoholivaba ▾': 'non-alcoholic',
  karastusjoogid: 'non-alcoholic',
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
 * `abv` is the product's alcohol-by-volume as a decimal fraction (0–1,
 * the same representation the excise engine's calculation helpers take).
 * When provided, it enforces the EU intermediate-products ceiling
 * (design D1, change first-impression-pass): a product above 22 % ABV
 * never normalizes to a fermented bucket — an outcome that would resolve
 * to `other_fermented` (cider, long drink, sake, non-alcoholic, other)
 * is re-assigned to `spirits`, and an unmapped string on an above-
 * boundary product resolves to `spirits` under the boundary rule instead
 * of null, because above 22 % the fermented buckets are not lawful
 * retail categories (taxonomy law, not a guess). Outcomes determined by
 * the boundary carry `boundaryApplied: true`; keyword outcomes never do.
 * A provided ABV outside 0–1 throws — a wrong-scale value would
 * silently re-key every row. Categories whose outcome is not fermented
 * (beer, wines, fortified, spirits) pass through unchanged at any ABV.
 *
 * Returns null when the string has no canonical mapping and the product
 * is at or below the boundary — the caller flags the record for the
 * correction queue instead of assigning a fallback category. An empty
 * string is structural (no source string at all) and stays null at any
 * ABV.
 *
 * Non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene):
 * a keyed ABV of exactly 0, or `null` — the adapters' explicit
 * "looked for it, could not parse it" value — re-keys a typed alcohol
 * outcome to `non-alcoholic` with `nonAlcoholicHold: true`; the caller
 * holds the row for review. An `undefined` ABV (argument omitted — no
 * ABV information at all) leaves the guard unkeyed so the historical
 * keyword outcome stands, exactly as the boundary rule treats it. The
 * explicit `other` bucket and the `non-alcoholic` category itself pass
 * through: neither is an alcohol category, and the shared read-side
 * predicate (ABV > 0, not held) already keeps any zero-ABV row out of
 * the listing universe.
 */
export function mapSourceCategory(
  raw: string,
  abv?: number | null,
): SourceCategoryMapping | null {
  const key = raw.trim().toLowerCase();
  if (key === '') return null;

  if (abv !== undefined && abv !== null) {
    if (abv < 0 || abv > 1) {
      throw new RangeError(`abv must be a 0–1 fraction, got ${abv}`);
    }
  }
  const aboveBoundary =
    abv !== undefined && abv !== null && abv > INTERMEDIATE_PRODUCTS_ABV_CEILING;

  const canonicalCategory = SWEDISH_SOURCE_CATEGORY_MAP[key] ?? normalizeCategory(key);
  if (canonicalCategory === 'other' && !EXPLICIT_OTHER_TOKENS.has(key) && !aboveBoundary) {
    // normalizeCategory collapses anything unrecognised into 'other';
    // the spec requires unmappables to be flagged, not silently assigned.
    // Above the boundary the spec resolves them to spirits under the
    // boundary rule instead of queueing them (never a fermented guess).
    return null;
  }

  if (aboveBoundary && CANONICAL_TO_TAX_CATEGORY[canonicalCategory] === 'other_fermented') {
    // The fermented bucket is capped by taxonomy law: re-assign to
    // spirits, attributable to the boundary rule via `boundaryApplied`.
    return { canonicalCategory: 'spirits', taxCategory: 'spirits', boundaryApplied: true };
  }

  // Non-alcoholic ingestion guard (change nonalcoholic-catalog-hygiene,
  // design D3): category eligibility is a physical prerequisite — a row
  // with no alcohol in it (keyed ABV 0) or no parseable ABV (`null`, the
  // adapters' explicit unparseable value) cannot be placed in a typed
  // alcohol category. It resolves to the canonical non-alcoholic
  // category — the taxonomy's own alcohol-free bucket, not a guess —
  // attributable via `nonAlcoholicHold`; the caller carries the
  // correction flag and the review hold. `undefined` leaves the guard
  // unkeyed (no ABV information was offered), and rows above the
  // boundary never reach this branch (ABV > 0 there by definition).
  // Explicit `other` and `non-alcoholic` outcomes pass through unchanged.
  if (
    (abv === null || abv === 0) &&
    canonicalCategory !== 'non-alcoholic' &&
    canonicalCategory !== 'other'
  ) {
    return {
      canonicalCategory: 'non-alcoholic',
      taxCategory: CANONICAL_TO_TAX_CATEGORY['non-alcoholic'],
      nonAlcoholicHold: true,
    };
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
