/**
 * Normalization types — raw input contract and canonical output shape.
 *
 * The normalization layer sits between the data-acquisition pipeline (RawFeedRecord)
 * and the Product Master upsert. It guarantees every field is in a consistent,
 * validated form that downstream matching/dedup and tax engines can rely on.
 *
 * @module NormalizationTypes
 */

import { TAX_CATEGORY_KEYS } from '../tax/tax-categories';

// ---------------------------------------------------------------------------
// Canonical enums
// ---------------------------------------------------------------------------

/**
 * Canonical product categories recognised by the normalization layer.
 *
 * These are more granular than the tax engine's ExciseCategory; the mapping
 * from canonical → excise category is handled by a dedicated mapper in the tax
 * or product-master domain.
 */
export type CanonicalCategory =
  | 'beer'
  | 'cider'
  | 'wine'
  | 'sparkling-wine'
  | 'fortified-wine'
  | 'spirits'
  | 'liqueur'
  | 'long-drink'
  | 'sake'
  | 'non-alcoholic'
  | 'other';

/**
 * Runtime list of every canonical category value.
 *
 * The type above is compile-time only; this constant is what validation
 * and iteration code checks against (same convention as the tax
 * module's TAX_CATEGORY_KEYS).
 */
export const CANONICAL_CATEGORY_KEYS = [
  'beer',
  'cider',
  'wine',
  'sparkling-wine',
  'fortified-wine',
  'spirits',
  'liqueur',
  'long-drink',
  'sake',
  'non-alcoholic',
  'other',
] as const satisfies readonly CanonicalCategory[];

/**
 * The known `regulatoryClassification` vocabulary the classification gate
 * validates against (task 7.1, change technical-assessment-remediation).
 *
 * A value passes the gate iff it is a member of one of the platform's
 * known category vocabularies — each maps deterministically into the
 * excise engine, so gate-passing data is tax-meaningful:
 *
 * - the normalization layer's canonical categories
 *   ({@link CANONICAL_CATEGORY_KEYS}),
 * - the tax rules' own category keys (TAX_CATEGORY_KEYS — what ingestion
 *   writes after source-category normalization),
 * - the broad legacy regulatory classes ('wine', 'intermediate', 'other')
 *   present in seeded product-master data before the canonical taxonomy
 *   existed.
 *
 * Everything else is a placeholder or garbage — most notably the literal
 * 'unknown' that feed adapters historically stamped — and is rejected.
 * Non-emptiness alone has never been a classification.
 */
export const KNOWN_REGULATORY_CLASSIFICATIONS: ReadonlySet<string> = new Set<string>([
  ...CANONICAL_CATEGORY_KEYS,
  ...TAX_CATEGORY_KEYS,
  // Legacy broad classes in seeded product data (ExciseCategory members
  // that predate the canonical vocabulary).
  'wine',
  'intermediate',
  'other',
]);

/**
 * Placeholder classification values that adapters historically wrote when
 * the feed carried no usable category. Always rejected by the gate.
 */
export const REGULATORY_CLASSIFICATION_PLACEHOLDER = 'unknown';

/**
 * Canonical container/packaging types.
 *
 * Aligns with the existing `ContainerType` union from core-domain but uses
 * singular kebab-case (e.g. `'glass-bottle'` rather than `'glass'`) so the
 * normalised shape carries enough detail for container-duty estimation.
 */
export type CanonicalContainerType =
  | 'glass-bottle'
  | 'plastic-bottle'
  | 'metal-can'
  | 'carton'
  | 'bag-in-box'
  | 'keg'
  | 'pouch'
  | 'other';

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

/**
 * Raw product data as received from the data-acquisition layer.
 *
 * Most fields come from a single feed record but may be assembled from
 * multiple sources (e.g. offer + product master join).
 *
 * Volumes may be expressed in any unit; ABV is expected as a percentage
 * value (0–100) but the normalizer also accepts the 0–1 fraction form.
 */
export interface RawProductInput {
  /** Product display name (may include brand, variant, volume suffix). */
  readonly name: string;

  /** Brand or producer name. */
  readonly brand: string;

  /** Raw category string (free text, language-specific). */
  readonly category: string;

  /** Numeric volume (unit specified by `volumeUnit`). */
  readonly volume: number;

  /** Unit of the `volume` field. Defaults to 'L' when absent. */
  readonly volumeUnit?: VolumeUnit;

  /** Alcohol by volume — expected 0–100 (e.g. 4.5 for 4.5 %). */
  readonly abv?: number;

  /** Free-text packaging description (e.g. 'glass bottle', 'aluminum can'). */
  readonly packaging?: string;

  /** GTIN-13 / EAN barcode (optional, from product master feed). */
  readonly ean?: string;

  /** Product image URLs (optional, pass-through). */
  readonly images?: readonly string[];

  /** Free-text description (optional, pass-through). */
  readonly description?: string;
}

/** Recognised volume units for raw input. */
export type VolumeUnit = 'L' | 'ml' | 'cl' | 'dl' | 'gal' | 'floz';

// ---------------------------------------------------------------------------
// Output contract
// ---------------------------------------------------------------------------

/**
 * Normalized product data suitable for Product Master upsert.
 *
 * Every field is validated, standardised, and cast to a canonical form.
 * The `normalizationWarnings` array captures any non-fatal decisions
 * (e.g. estimated volume unit, clamped ABV) so calling code can log or
 * flag them for manual review.
 */
export interface NormalizedProduct {
  /** Cleaned product name (trimmed, single-space runs). */
  readonly normalizedName: string;

  /** Brand name (trimmed, title-cased). */
  readonly normalizedBrand: string;

  /** Mapped canonical category. */
  readonly canonicalCategory: CanonicalCategory;

  /** Volume standardised to litres. */
  readonly volumeLitres: number;

  /** ABV as a percentage value 0–100 (e.g. 4.5). */
  readonly alcoholByVolume: number;

  /** Standardised container type. */
  readonly containerType: CanonicalContainerType;

  /** GTIN-13 / EAN barcode (null when not available in source feed). */
  readonly ean: string | null;

  /** Product image URLs (pass-through). */
  readonly images: readonly string[];

  /** Free-text description (pass-through, trimmed). */
  readonly description: string;

  /** Original input preserved for traceability. */
  readonly originalInput: RawProductInput;

  /** Non-fatal warnings raised during normalisation. */
  readonly normalizationWarnings: readonly string[];
}