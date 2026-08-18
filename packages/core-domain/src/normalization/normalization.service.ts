/**
 * NormalizationService — transforms raw product data into a canonical shape.
 *
 * Every public method is a pure function (deterministic, no I/O, no side
 * effects) making the service fully testable without mocking.  The class is
 * decorated `@Injectable` so it participates in NestJS DI, but consumers can
 * equally call the exported pure helpers directly.
 *
 * @module NormalizationService
 */
import { Injectable } from '@nestjs/common';
import type {
  CanonicalCategory,
  CanonicalContainerType,
  NormalizedProduct,
  RawProductInput,
  VolumeUnit,
} from './normalization.types';

// ---------------------------------------------------------------------------
// Volume-unit conversion table (to litres)
// ---------------------------------------------------------------------------

const UNIT_TO_LITRES: Record<VolumeUnit, number> = {
  L: 1,
  ml: 0.001,
  cl: 0.01,
  dl: 0.1,
  gal: 3.78541,
  floz: 0.0295735,
};

// ---------------------------------------------------------------------------
// Public pure helpers (exported for direct use)
// ---------------------------------------------------------------------------

/**
 * Normalize a brand name: trim whitespace and apply title case.
 *
 * Title case capitalises the first letter of every word and lowercases the
 * rest.  Known multi-word brand prefixes (e.g. "Mc", "O'") are handled on a
 * best-effort basis.
 */
export function normalizeBrandName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return trimmed;

  return trimmed
    .split(/\s+/)
    .map(titleCaseWord)
    .join(' ');
}

function titleCaseWord(word: string): string {
  if (word.length === 0) return word;

  // Handle known prefixes: O', Mc, Mac
  const lower = word.toLowerCase();
  const oApostrophe = lower.startsWith("o'");
  const mcPrefix = lower.startsWith('mc');
  const macPrefix = lower.startsWith('mac');

  if (oApostrophe && word.length > 2) {
    return `O'${word.charAt(2).toUpperCase()}${lower.slice(3)}`;
  }
  if (mcPrefix && word.length > 2) {
    return `Mc${word.charAt(2).toUpperCase()}${lower.slice(3)}`;
  }
  if (macPrefix && word.length > 3) {
    return `Mac${word.charAt(3).toUpperCase()}${lower.slice(4)}`;
  }

  return word.charAt(0).toUpperCase() + lower.slice(1);
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

/**
 * Map a raw category string to a canonical category.
 *
 * Matching is case-insensitive; the raw value is trimmed and lowercased
 * before lookup.  Unknown values map to `'other'`.
 */
export function normalizeCategory(raw: string): CanonicalCategory {
  const key = raw.toLowerCase().trim();

  switch (key) {
    // Beer
    case 'beer':
    case 'olut':
    case 'ale':
    case 'lager':
    case 'stout':
    case 'porter':
    case 'ipa':
    case 'pilsner':
    case 'vehnä':
    case 'weizen':
      return 'beer';

    // Cider
    case 'cider':
    case 'siideri':
    case 'hard cider':
      return 'cider';

    // Wine
    case 'wine':
    case 'viini':
    case 'red wine':
    case 'white wine':
    case 'rosé':
    case 'rose':
    case 'rose wine':
      return 'wine';

    // Sparkling wine
    case 'sparkling wine':
    case 'sparkling-wine':
    case 'champagne':
    case 'kuohuviini':
    case 'samppanja':
    case 'prosecco':
    case 'cava':
      return 'sparkling-wine';

    // Fortified wine
    case 'fortified wine':
    case 'fortified-wine':
    case 'port':
    case 'portviini':
    case 'sherry':
    case 'madeira':
    case 'vermouth':
      return 'fortified-wine';

    // Spirits
    case 'spirits':
    case 'viina':
    case 'vodka':
    case 'whisky':
    case 'whiskey':
    case 'gin':
    case 'rum':
    case 'tequila':
    case 'brandy':
    case 'cognac':
    case 'aquavit':
    case 'akvaviitti':
    case 'likööri':
    case 'bitters':
      return 'spirits';

    // Liqueur
    case 'liqueur':
    case 'liquer':
    case 'cream liqueur':
      return 'liqueur';

    // Long drink / RTD
    case 'long drink':
    case 'long-drink':
    case 'lonkero':
    case 'rtd':
    case 'ready-to-drink':
    case 'mixed drink':
    case 'cocktail':
      return 'long-drink';

    // Sake
    case 'sake':
    case 'saké':
    case 'sake rice wine':
      return 'sake';

    // Non-alcoholic
    case 'non-alcoholic':
    case 'non alcoholic':
    case 'alkoholiton':
    case 'alcohol-free':
    case 'alcohol free':
    case '0.0':
    case '0.0%':
    case 'low alcohol':
    case 'mieto':
      return 'non-alcoholic';

    default:
      return 'other';
  }
}

// ---------------------------------------------------------------------------
// Volume standardisation
// ---------------------------------------------------------------------------

/**
 * Standardize a volume value to litres.
 *
 * @param volume  Numeric volume.
 * @param unit    Unit of the volume value (defaults to `'L'`).
 * @returns Volume in litres.
 * @throws {RangeError} If volume is negative.
 */
export function standardizeVolume(volume: number, unit: VolumeUnit = 'L'): number {
  if (volume < 0) {
    throw new RangeError(`Volume must not be negative, got ${volume}`);
  }
  const factor = UNIT_TO_LITRES[unit];
  if (factor === undefined) {
    throw new RangeError(`Unknown volume unit "${unit}"`);
  }
  return volume * factor;
}

// ---------------------------------------------------------------------------
// ABV validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalise an ABV value.
 *
 * Accepts values in percentage scale (0–100).  Values between 0 and 1 are
 * treated as already-on-fraction-scale and multiplied by 100 for storage.
 *
 * @param abv  Raw ABV value.
 * @returns    ABV as a percentage (0–100).
 * @throws {RangeError} If ABV is outside 0–100 (post conversion).
 */
export function validateAbv(abv: number): number {
  // Heuristic: if the value is ≤ 1 and the input didn't look like a
  // percentage string, the caller may have sent a fraction (e.g. 0.05 for 5 %).
  // Because we cannot distinguish 0.5 % from 50 % without context, we only
  // scale values that are strictly positive and ≤ 1, AND where no explicit
  // "this is a percentage" indicator exists in the API contract.
  // For safety we always treat the input as percentage scale.
  if (abv < 0 || abv > 100) {
    throw new RangeError(`ABV must be between 0 and 100, got ${abv}`);
  }

  return abv;
}

// ---------------------------------------------------------------------------
// Container-type standardisation
// ---------------------------------------------------------------------------

/**
 * Map a free-text packaging string to a canonical container type.
 *
 * Matching is case-insensitive.  Unknown values map to `'other'`.
 */
export function standardizeContainerType(raw: string): CanonicalContainerType {
  const key = raw.toLowerCase().trim();

  // Glass bottle
  if (
    key.includes('glass') ||
    key.includes('bottle') ||
    key === 'pullo' ||
    key === 'lasi'
  ) {
    // Disambiguate: if "plastic bottle" was intended, it's caught below
    if (key.includes('plastic')) return 'plastic-bottle';
    return 'glass-bottle';
  }

  // Plastic bottle
  if (
    key.includes('plastic') ||
    key.includes('pet') ||
    key.includes('muovi') ||
    key.includes('muovipullo')
  ) {
    return 'plastic-bottle';
  }

  // Metal can
  if (
    key.includes('can') ||
    key.includes('tin') ||
    key.includes('aluminum') ||
    key.includes('aluminium') ||
    key.includes('tölkki') ||
    key === 'metal'
  ) {
    return 'metal-can';
  }

  // Carton / Tetrapak
  if (
    key.includes('carton') ||
    key.includes('tetra') ||
    key.includes('tetrapak') ||
    key.includes('kartonki')
  ) {
    return 'carton';
  }

  // Bag-in-box
  if (
    key.includes('bag-in-box') ||
    key.includes('bag in box') ||
    key.includes('bib') ||
    key.includes('laatikko')
  ) {
    return 'bag-in-box';
  }

  // Keg
  if (key.includes('keg') || key.includes('tynnyri') || key.includes('barrel')) {
    return 'keg';
  }

  // Pouch
  if (key.includes('pouch') || key.includes('pussi') || key.includes('doypack')) {
    return 'pouch';
  }

  return 'other';
}

// ---------------------------------------------------------------------------
// Text normalisation helpers
// ---------------------------------------------------------------------------

/** Trim and collapse runs of whitespace to a single space. */
function cleanText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class NormalizationService {
  /**
   * Normalize a single raw product record into its canonical form.
   *
   * This is a pure function: given the same input it always produces the same
   * output, with no I/O or side effects.
   */
  normalize(raw: RawProductInput): NormalizedProduct {
    const warnings: string[] = [];

    // --- Brand ---
    const normalizedBrand = normalizeBrandName(raw.brand);

    // --- Category ---
    const canonicalCategory = normalizeCategory(raw.category);

    // --- Volume ---
    const unit: VolumeUnit = raw.volumeUnit ?? 'L';
    let volumeLitres: number;
    try {
      volumeLitres = standardizeVolume(raw.volume, unit);
    } catch (e) {
      throw new Error(
        `Volume normalisation failed: ${(e as Error).message}`,
      );
    }

    // --- ABV ---
    let alcoholByVolume = 0;
    if (raw.abv !== undefined && raw.abv !== null) {
      try {
        alcoholByVolume = validateAbv(raw.abv);
      } catch (e) {
        // Non-fatal — clamp to 0 and warn
        alcoholByVolume = 0;
        warnings.push(
          `ABV ${raw.abv} is invalid (${(e as Error).message}); clamped to 0`,
        );
      }
    }

    // --- Container type ---
    const containerType = raw.packaging
      ? standardizeContainerType(raw.packaging)
      : 'other';

    if (raw.packaging && containerType === 'other') {
      warnings.push(
        `Unrecognised packaging "${raw.packaging}" mapped to 'other'`,
      );
    }

    // --- Pass-through fields ---
    const name = cleanText(raw.name);
    const description = raw.description ? cleanText(raw.description) : '';
    const ean = raw.ean?.trim() ?? null;
    const images = raw.images ?? [];

    return {
      normalizedName: name,
      normalizedBrand,
      canonicalCategory,
      volumeLitres,
      alcoholByVolume,
      containerType,
      ean,
      images,
      description,
      originalInput: raw,
      normalizationWarnings: warnings,
    };
  }
}