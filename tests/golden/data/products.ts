/**
 * Golden-dataset mock product data — v1.0.
 *
 * Every product in the golden dataset has a fixed ID, known input
 * parameters, and manually verified expected outputs.  These values
 * should never change without a version bump and a corresponding update
 * to every test assertion in golden-dataset.test.ts.
 *
 * @module GoldenDatasetProducts
 */

import type {
  CalculatorProductData,
  CalculatorRetailOfferData,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Dataset version
// ---------------------------------------------------------------------------

/** Bump this when adding scenarios or changing expected values. */
export const GOLDEN_DATASET_VERSION = '1.0' as const;

// ---------------------------------------------------------------------------
// Product definitions
// ---------------------------------------------------------------------------

/**
 * Product 1 — Beer (can, 0.5 L, 5% ABV).
 * Used by test case 1 (Distance Selling, qty=1).
 */
export const PRODUCT_BEER: CalculatorProductData = {
  id: 1,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Premium Lager 5%',
};

export const OFFER_BEER: CalculatorRetailOfferData = {
  id: 100,
  priceCents: 200,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 2 — Wine (glass, 0.75 L, 12% ABV).
 * Used by test case 2 (Distance Buying, qty=3).
 */
export const PRODUCT_WINE: CalculatorProductData = {
  id: 2,
  regulatoryClassification: 'wine',
  category: 'wine',
  volumeLitres: 0.75,
  alcoholByVolume: 0.12,
  containerType: 'glass',
  depositSystemStatus: true,
  weightKg: 1.2,
  normalizedName: 'Rioja Reserva',
};

export const OFFER_WINE: CalculatorRetailOfferData = {
  id: 101,
  priceCents: 300,
  merchant: 'vinos-es',
  country: 'ES',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 3 — Spirits (glass, 0.7 L, 40% ABV).
 * Used by test case 3 (transport unavailable).
 */
export const PRODUCT_SPIRITS: CalculatorProductData = {
  id: 3,
  regulatoryClassification: 'spirits',
  category: 'spirits',
  volumeLitres: 0.7,
  alcoholByVolume: 0.4,
  containerType: 'glass',
  depositSystemStatus: true,
  weightKg: 1.0,
  normalizedName: 'Premium Vodka',
};

export const OFFER_SPIRITS: CalculatorRetailOfferData = {
  id: 102,
  priceCents: 500,
  merchant: 'spirits-eu',
  country: 'PL',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 4 — Unclassified (no regulatory classification).
 * Used by test case 4 (gate rejection).
 */
export const PRODUCT_UNCLASSIFIED: CalculatorProductData = {
  id: 4,
  regulatoryClassification: '', // empty → gate rejects
  category: 'unknown',
  volumeLitres: 0.5,
  alcoholByVolume: 0.0,
  containerType: 'plastic',
  depositSystemStatus: null,
  weightKg: 0.5,
  normalizedName: 'Unknown Beverage',
};

export const OFFER_UNCLASSIFIED: CalculatorRetailOfferData = {
  id: 103,
  priceCents: 100,
  merchant: 'unknown-merchant',
  country: 'DE',
  reliabilityStatus: 'ESTIMATED',
};

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Map product ID to its product data. */
export const PRODUCT_BY_ID: Record<number, CalculatorProductData> = {
  [PRODUCT_BEER.id]: PRODUCT_BEER,
  [PRODUCT_WINE.id]: PRODUCT_WINE,
  [PRODUCT_SPIRITS.id]: PRODUCT_SPIRITS,
  [PRODUCT_UNCLASSIFIED.id]: PRODUCT_UNCLASSIFIED,
};

/** Map product ID to its retail offers. */
export const OFFERS_BY_PRODUCT_ID: Record<number, CalculatorRetailOfferData[]> = {
  [PRODUCT_BEER.id]: [OFFER_BEER],
  [PRODUCT_WINE.id]: [OFFER_WINE],
  [PRODUCT_SPIRITS.id]: [OFFER_SPIRITS],
  [PRODUCT_UNCLASSIFIED.id]: [OFFER_UNCLASSIFIED],
};