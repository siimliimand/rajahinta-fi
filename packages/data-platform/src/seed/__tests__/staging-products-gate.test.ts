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
 * @module Tests/Seed
 */
import { describe, it, expect } from 'vitest';
import {
  KNOWN_REGULATORY_CLASSIFICATIONS,
  REGULATORY_CLASSIFICATION_PLACEHOLDER,
} from '@rajahinta/core-domain';
import { STAGING_PRODUCTS } from '../staging-seed';

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
