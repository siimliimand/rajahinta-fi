/**
 * Golden-dataset mock product data — v2.0.
 *
 * Every product in the golden dataset has a fixed ID, known input
 * parameters, and manually verified expected outputs.  These values
 * should never change without a version bump and a corresponding update
 * to every test assertion in golden-dataset.test.ts.
 *
 * @version 2.1
 *   2026-08-28: mixed-currency case added (task 1.5/1.6, design D2) —
 *   SEK-converted, EUR-native, and unconvertible offers for product 13.
 *   otherCharges removed from every expectation (task 10.3, design D3).
 * @version 2.0
 *   Updated 2024-08-26: rates aligned with v1.0-2024 seed
 *   (packages/data-platform/src/seed/tax-rules.seed.ts).
 *   Beer flat 33.00 → progressive 28.35/36.20 snt/cl ethanol bands.
 *   Wine still/sparkling: single 3.40 → six-band structure.
 *   Spirits 29.50 → 30.90/54.80 €/l pure alcohol.
 *   Intermediate 3.40 → 5.68/8.63 €/l product.
 *   Other fermented 3.40/l alcohol → wine bands per litre of product.
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
export const GOLDEN_DATASET_VERSION = '2.1' as const;

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
// Per-category regression products (Task 5.3)
// ---------------------------------------------------------------------------

/**
 * Product 5 — Low-ABV beer (can, 0.33 L, 2.7 % ABV).
 * Tests progressive ABV tier 0 (maxAbv ≤ 2.8 → rate 0 €/l).
 * Uses 2.7 % (not 2.8) to avoid JS float boundary where 0.028 × 100 > 2.8.
 */
export const PRODUCT_BEER_LOW_ABV: CalculatorProductData = {
  id: 5,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.33,
  alcoholByVolume: 0.027,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.35,
  normalizedName: 'Light Beer 2.7%',
};

export const OFFER_BEER_LOW_ABV: CalculatorRetailOfferData = {
  id: 104,
  priceCents: 150,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 6 — High-ABV beer (bottle, 0.33 L, 8.5 % ABV).
 * Tests progressive ABV tier 3 (maxAbv > 8.0 → rate 0.580 €/l).
 */
export const PRODUCT_BEER_HIGH_ABV: CalculatorProductData = {
  id: 6,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.33,
  alcoholByVolume: 0.085,
  containerType: 'glass',
  depositSystemStatus: true,
  weightKg: 0.45,
  normalizedName: 'Strong Beer 8.5%',
};

export const OFFER_BEER_HIGH_ABV: CalculatorRetailOfferData = {
  id: 105,
  priceCents: 250,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 7 — Wine sparkling (glass, 0.75 L, 11 % ABV).
 * Uses the same PER_LITRE_OF_PRODUCT formula as still wine.
 */
export const PRODUCT_WINE_SPARKLING: CalculatorProductData = {
  id: 7,
  regulatoryClassification: 'wine',
  category: 'wine',
  volumeLitres: 0.75,
  alcoholByVolume: 0.11,
  containerType: 'glass',
  depositSystemStatus: true,
  weightKg: 1.3,
  normalizedName: 'Prosecco DOC',
};

export const OFFER_WINE_SPARKLING: CalculatorRetailOfferData = {
  id: 106,
  priceCents: 800,
  merchant: 'vinos-es',
  country: 'ES',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 8 — Intermediate product (bottle, 0.5 L, 15 % ABV).
 * Tests PER_LITRE_OF_PRODUCT formula for the 'intermediate' category.
 */
export const PRODUCT_INTERMEDIATE: CalculatorProductData = {
  id: 8,
  regulatoryClassification: 'intermediate',
  category: 'intermediate',
  volumeLitres: 0.5,
  alcoholByVolume: 0.15,
  containerType: 'glass',
  depositSystemStatus: true,
  weightKg: 0.7,
  normalizedName: 'Sherry Fino',
};

export const OFFER_INTERMEDIATE: CalculatorRetailOfferData = {
  id: 107,
  priceCents: 600,
  merchant: 'vinos-es',
  country: 'ES',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 9 — Other fermented beverage (bottle, 0.5 L, 5 % ABV).
 * Tests the 'other' category fallback (PER_LITRE_OF_PRODUCT at 3.40).
 */
export const PRODUCT_OTHER_FERMENTED: CalculatorProductData = {
  id: 9,
  regulatoryClassification: 'other',
  category: 'other',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'glass',
  depositSystemStatus: true,
  weightKg: 0.6,
  normalizedName: 'Fermented Ginger Drink',
};

export const OFFER_OTHER_FERMENTED: CalculatorRetailOfferData = {
  id: 108,
  priceCents: 350,
  merchant: 'brew-eu',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 10 — No deposit system (can, 0.5 L, 5 % ABV).
 * depositSystemStatus=false so container duty is applied at 0.51 €/l.
 */
export const PRODUCT_NO_DEPOSIT: CalculatorProductData = {
  id: 10,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: false,
  weightKg: 0.55,
  normalizedName: 'Import Lager No Deposit',
};

export const OFFER_NO_DEPOSIT: CalculatorRetailOfferData = {
  id: 109,
  priceCents: 180,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 11 — Zero ABV beverage (can, 0.5 L, 0 % ABV).
 * Edge case: 0 % ABV should produce 0 excise duty.
 */
export const PRODUCT_ZERO_ABV: CalculatorProductData = {
  id: 11,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.0,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.5,
  normalizedName: 'Non-Alcoholic Beer 0.0%',
};

export const OFFER_ZERO_ABV: CalculatorRetailOfferData = {
  id: 110,
  priceCents: 120,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 12 — Unknown deposit status (can, 0.5 L, 5 % ABV).
 * depositSystemStatus=null → container duty ESTIMATED.
 */
export const PRODUCT_NULL_DEPOSIT: CalculatorProductData = {
  id: 12,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: null,
  weightKg: 0.55,
  normalizedName: 'Unknown Deposit Beer',
};

export const OFFER_NULL_DEPOSIT: CalculatorRetailOfferData = {
  id: 111,
  priceCents: 190,
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'EXACT',
};

/**
 * Product 13 — Beer profile for the mixed-currency case (task 1.5/1.6,
 * design D2): identical tax shape to product 1, offered across
 * currencies. Same excise (91 ¢) and container duty (0 ¢) expectations
 * as Case 1 apply per unit.
 */
export const PRODUCT_BEER_SEK: CalculatorProductData = {
  id: 13,
  regulatoryClassification: 'beer',
  category: 'beer',
  volumeLitres: 0.5,
  alcoholByVolume: 0.05,
  containerType: 'can',
  depositSystemStatus: true,
  weightKg: 0.55,
  normalizedName: 'Svensk Exportöl 5%',
};

/**
 * SEK offer converted at ingestion: 22.64 SEK at ECB EUR/SEK 11.32
 * → exactly 2.00 EUR → 200 cents. Original amount and FX dataset
 * version ride along as provenance (fx-rate-dataset spec delta).
 */
export const OFFER_BEER_SEK_CONVERTED: CalculatorRetailOfferData = {
  id: 112,
  priceCents: 200,
  currency: 'EUR',
  merchant: 'systembolaget',
  country: 'SE',
  reliabilityStatus: 'VERIFIED',
  originalPriceCents: 2264,
  originalCurrency: 'SEK',
  fxDatasetVersion: 'ecb-2026-08-27.1',
};

/** EUR-native reference offer for the same product — pricier, honest. */
export const OFFER_BEER_EUR_NATIVE: CalculatorRetailOfferData = {
  id: 113,
  priceCents: 260,
  currency: 'EUR',
  merchant: 'beverage-de',
  country: 'DE',
  reliabilityStatus: 'VERIFIED',
};

/**
 * Unconvertible offer: a raw SEK amount that leaked through as if it
 * were cents. Cheapest of the three — the exact trap task 1.5 exists to
 * close. Must be excluded with a visible reason, never summed.
 */
export const OFFER_BEER_UNCONVERTIBLE_SEK: CalculatorRetailOfferData = {
  id: 114,
  priceCents: 90,
  currency: 'SEK',
  merchant: 'shop-se-rogue',
  country: 'SE',
  reliabilityStatus: 'ESTIMATED',
  originalPriceCents: 900,
  originalCurrency: 'SEK',
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
  [PRODUCT_BEER_LOW_ABV.id]: PRODUCT_BEER_LOW_ABV,
  [PRODUCT_BEER_HIGH_ABV.id]: PRODUCT_BEER_HIGH_ABV,
  [PRODUCT_WINE_SPARKLING.id]: PRODUCT_WINE_SPARKLING,
  [PRODUCT_INTERMEDIATE.id]: PRODUCT_INTERMEDIATE,
  [PRODUCT_OTHER_FERMENTED.id]: PRODUCT_OTHER_FERMENTED,
  [PRODUCT_NO_DEPOSIT.id]: PRODUCT_NO_DEPOSIT,
  [PRODUCT_ZERO_ABV.id]: PRODUCT_ZERO_ABV,
  [PRODUCT_NULL_DEPOSIT.id]: PRODUCT_NULL_DEPOSIT,
  [PRODUCT_BEER_SEK.id]: PRODUCT_BEER_SEK,
};

/** Map product ID to its retail offers. */
export const OFFERS_BY_PRODUCT_ID: Record<number, CalculatorRetailOfferData[]> = {
  [PRODUCT_BEER.id]: [OFFER_BEER],
  [PRODUCT_WINE.id]: [OFFER_WINE],
  [PRODUCT_SPIRITS.id]: [OFFER_SPIRITS],
  [PRODUCT_UNCLASSIFIED.id]: [OFFER_UNCLASSIFIED],
  [PRODUCT_BEER_LOW_ABV.id]: [OFFER_BEER_LOW_ABV],
  [PRODUCT_BEER_HIGH_ABV.id]: [OFFER_BEER_HIGH_ABV],
  [PRODUCT_WINE_SPARKLING.id]: [OFFER_WINE_SPARKLING],
  [PRODUCT_INTERMEDIATE.id]: [OFFER_INTERMEDIATE],
  [PRODUCT_OTHER_FERMENTED.id]: [OFFER_OTHER_FERMENTED],
  [PRODUCT_NO_DEPOSIT.id]: [OFFER_NO_DEPOSIT],
  [PRODUCT_ZERO_ABV.id]: [OFFER_ZERO_ABV],
  [PRODUCT_NULL_DEPOSIT.id]: [OFFER_NULL_DEPOSIT],
  [PRODUCT_BEER_SEK.id]: [
    OFFER_BEER_SEK_CONVERTED,
    OFFER_BEER_EUR_NATIVE,
    OFFER_BEER_UNCONVERTIBLE_SEK,
  ],
};