/**
 * Normalization types — raw input contract and canonical output shape.
 *
 * The normalization layer sits between the data-acquisition pipeline (RawFeedRecord)
 * and the Product Master upsert. It guarantees every field is in a consistent,
 * validated form that downstream matching/dedup and tax engines can rely on.
 *
 * @module NormalizationTypes
 */

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

  /** Product image URLs (pass-through). */
  readonly images: readonly string[];

  /** Free-text description (pass-through, trimmed). */
  readonly description: string;

  /** Original input preserved for traceability. */
  readonly originalInput: RawProductInput;

  /** Non-fatal warnings raised during normalisation. */
  readonly normalizationWarnings: readonly string[];
}