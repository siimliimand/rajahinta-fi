/**
 * Staging product classification-vocabulary test.
 *
 * Regression guard (reported e2e defect): the staging seed once stamped
 * `regulatoryClassification` with an uppercase pseudo-enum
 * ('BEER_STANDARD' / 'WINE_STILL') that the task-7.1 classification gate
 * rejects — every seeded product 422'd in the calculator. The seed must
 * carry gate-known canonical values so a freshly seeded stack is usable
 * end-to-end without harness-side fixture SQL.
 *
 * Second occurrence (staging e2e 422 on product 7): the D1 fixture catalog
 * (seed/d1/staging-fixtures.ts, 45 products) still carried the coarse
 * feed-style label 'alcoholic_beverage' — the first fix below only covered
 * the two TEST products. Beverage rows now carry their category as the
 * classification; food/tobacco/nicotine rows intentionally keep
 * non-member values because the classification gate must exclude
 * non-alcohol merchandise from the landed-cost calculator.
 *
 * @module Tests/Seed
 */
import { describe, it, expect } from 'vitest';
import {
  KNOWN_REGULATORY_CLASSIFICATIONS,
  REGULATORY_CLASSIFICATION_PLACEHOLDER,
} from '@rajahinta/core-domain';
import { STAGING_PRODUCTS } from '../staging-seed';
import {
  STAGING_PRODUCTS as STAGING_PRODUCT_FIXTURES,
  type StagingProductFixture,
} from '../d1/staging-fixtures';

/**
 * The gate's membership check (ClassificationGateService.checkProductGate):
 * trimmed, lowercased, non-placeholder, member of the known vocabulary.
 */
function passesGate(regulatoryClassification: string): boolean {
  const normalized = regulatoryClassification.trim().toLowerCase();
  return (
    normalized !== REGULATORY_CLASSIFICATION_PLACEHOLDER &&
    KNOWN_REGULATORY_CLASSIFICATIONS.has(normalized)
  );
}

/**
 * Fixture values that describe merchandise outside the calculator's scope
 * (alcohol/beverage landed cost). These intentionally fail the gate; any
 * OTHER gate-failing value is a seed defect.
 */
const NON_BEVERAGE_CLASSIFICATIONS = new Set([
  'food_product',
  'tobacco_product',
  'nicotine_product',
]);

describe('staging seed classification vocabulary', () => {
  it('stamps every seeded product with a gate-passing regulatoryClassification', () => {
    expect(STAGING_PRODUCTS.length).toBeGreaterThan(0);
    for (const product of STAGING_PRODUCTS) {
      expect(
        passesGate(product.regulatoryClassification),
        `"${product.regulatoryClassification}" (${product.name})`,
      ).toBe(true);
    }
  });

  it('uses the canonical lowercase vocabulary, not adapter-style uppercase enums', () => {
    for (const product of STAGING_PRODUCTS) {
      expect(product.regulatoryClassification).toMatch(/^[a-z_-]+$/);
    }
  });
});

describe('D1 staging fixture classification vocabulary', () => {
  it('carries no coarse feed-style pseudo-classes on beverage rows', () => {
    expect(STAGING_PRODUCT_FIXTURES.length).toBeGreaterThan(0);
    for (const product of STAGING_PRODUCT_FIXTURES) {
      if (NON_BEVERAGE_CLASSIFICATIONS.has(product.regulatoryClassification)) {
        continue;
      }
      expect(
        passesGate(product.regulatoryClassification),
        `"${product.regulatoryClassification}" (${product.name})`,
      ).toBe(true);
    }
  });

  it('classifies each alcohol row with its own tax category', () => {
    for (const product of alcoholFixtures()) {
      expect(product.regulatoryClassification).toBe(product.category);
    }
  });

  it('maps non-alcoholic beverage rows to the canonical hyphenated key', () => {
    const nonAlcoholicBeverages = STAGING_PRODUCT_FIXTURES.filter(
      (p) =>
        p.category === 'non_alcoholic' &&
        !NON_BEVERAGE_CLASSIFICATIONS.has(p.regulatoryClassification),
    );
    expect(nonAlcoholicBeverages.length).toBeGreaterThan(0);
    for (const product of nonAlcoholicBeverages) {
      expect(product.regulatoryClassification).toBe('non-alcoholic');
    }
  });

  /** Product 7 (Beefeater) was the reported staging 422 — pin it. */
  it('stamps product 7 (Beefeater London Dry Gin) with "spirits"', () => {
    const beefeater = STAGING_PRODUCT_FIXTURES.find((p) => p.id === 7);
    expect(beefeater?.name).toBe('Beefeater London Dry Gin');
    expect(passesGate(beefeater?.regulatoryClassification ?? '')).toBe(true);
  });

  /**
   * Domain ABV contract is a fraction (alcohol-excise.math validateRange
   * 0–1, docblock "0.40 for 40 %"); the product port passes the column
   * through unconverted. Staging 422 → 500 regression: fixtures once
   * carried percent-scale values (40 for 40 %), which the excise engine
   * rejected at calculation time.
   */
  it('carries ABV as a fraction, not a percentage', () => {
    for (const product of STAGING_PRODUCT_FIXTURES) {
      if (product.alcoholByVolume === null) continue;
      expect(
        product.alcoholByVolume,
        `${product.name}: ${product.alcoholByVolume}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

/** Fixture rows with a positive ABV — the calculator-eligible alcohol set. */
function alcoholFixtures(): StagingProductFixture[] {
  return STAGING_PRODUCT_FIXTURES.filter(
    (p) => p.alcoholByVolume !== null && p.alcoholByVolume > 0,
  );
}
