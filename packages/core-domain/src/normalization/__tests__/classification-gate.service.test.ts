/**
 * Tests for ClassificationGateService.
 *
 * This is a high-liability gate — an incorrect pass/fail decision could allow
 * an unclassified product into the landed-cost calculation, producing
 * incorrect duties and misleading end-user price data. Since task 7.1 the
 * gate validates membership in the known classification enum, not just
 * non-emptiness: placeholder values (the literal 'unknown') and garbage
 * strings are rejected.
 *
 * @module ClassificationGateServiceTests
 */
import { describe, it, expect } from 'vitest';
import { ClassificationGateService } from '../classification-gate.service';
import type { GateProduct } from '../classification-gate.service';
import { CANONICAL_CATEGORY_KEYS } from '../normalization.types';
import { TAX_CATEGORY_KEYS } from '../../tax/tax-categories';

describe('ClassificationGateService', () => {
  const service = new ClassificationGateService();

  // ---------------------------------------------------------------------------
  // checkProductGate — missing / empty values
  // ---------------------------------------------------------------------------

  it('fails when regulatoryClassification is null', () => {
    const product: GateProduct = { regulatoryClassification: null };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Product lacks regulatory classification');
  });

  it('fails when regulatoryClassification is undefined', () => {
    const product: GateProduct = { regulatoryClassification: undefined as unknown as null };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Product lacks regulatory classification');
  });

  it('fails when regulatoryClassification is an empty string', () => {
    const product: GateProduct = { regulatoryClassification: '' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Product lacks regulatory classification');
  });

  it('fails when regulatoryClassification is whitespace-only', () => {
    const product: GateProduct = { regulatoryClassification: '   ' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('Product lacks regulatory classification');
  });

  // ---------------------------------------------------------------------------
  // checkProductGate — placeholder rejection (task 7.1)
  // ---------------------------------------------------------------------------

  it('rejects the literal placeholder "unknown"', () => {
    const product: GateProduct = { regulatoryClassification: 'unknown' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('placeholder');
  });

  it('rejects the placeholder regardless of case or surrounding whitespace', () => {
    for (const value of ['UNKNOWN', '  Unknown  ', 'unknown ']) {
      const result = service.checkProductGate({ regulatoryClassification: value });
      expect(result.passed, `value "${value}" should be rejected`).toBe(false);
      expect(result.reason).toContain('placeholder');
    }
  });

  // ---------------------------------------------------------------------------
  // checkProductGate — enum validation (task 7.1)
  // ---------------------------------------------------------------------------

  it('accepts every canonical category value', () => {
    for (const value of CANONICAL_CATEGORY_KEYS) {
      const result = service.checkProductGate({ regulatoryClassification: value });
      expect(result.passed, `canonical category "${value}" should pass`).toBe(true);
    }
  });

  it('accepts every tax-rule category key — what ingestion writes', () => {
    for (const value of TAX_CATEGORY_KEYS) {
      const result = service.checkProductGate({ regulatoryClassification: value });
      expect(result.passed, `tax category "${value}" should pass`).toBe(true);
    }
  });

  it('accepts the legacy broad classes present in seeded product data', () => {
    for (const value of ['wine', 'intermediate', 'other']) {
      const result = service.checkProductGate({ regulatoryClassification: value });
      expect(result.passed, `legacy class "${value}" should pass`).toBe(true);
    }
  });

  it('accepts a member with leading/trailing whitespace', () => {
    const product: GateProduct = { regulatoryClassification: '  spirits  ' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(true);
  });

  it('accepts a member regardless of case', () => {
    const result = service.checkProductGate({ regulatoryClassification: 'Spirits' });

    expect(result.passed).toBe(true);
  });

  it('rejects a non-member value — non-emptiness alone must not pass', () => {
    const product: GateProduct = { regulatoryClassification: 'beer-ish' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not a member of the known classification enum');
  });

  it('rejects near-miss values and free text', () => {
    for (const value of ['beerr', 'wine?', 'not-a-class', '12']) {
      const result = service.checkProductGate({ regulatoryClassification: value });
      expect(result.passed, `value "${value}" should be rejected`).toBe(false);
    }
  });
});
