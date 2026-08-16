/**
 * Tests for ClassificationGateService.
 *
 * This is a high-liability gate — an incorrect pass/fail decision could allow
 * an unclassified product into the landed-cost calculation, producing
 * incorrect duties and misleading end-user price data.
 *
 * @module ClassificationGateServiceTests
 */
import { describe, it, expect } from 'vitest';
import { ClassificationGateService } from '../classification-gate.service';
import type { GateProduct } from '../classification-gate.service';

describe('ClassificationGateService', () => {
  const service = new ClassificationGateService();

  // ---------------------------------------------------------------------------
  // checkProductGate
  // ---------------------------------------------------------------------------

  it('passes when regulatoryClassification is a non-empty string', () => {
    const product: GateProduct = { regulatoryClassification: 'beer' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

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

  it('passes for any non-empty classification value', () => {
    const product: GateProduct = { regulatoryClassification: 'sparkling-wine' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(true);
  });

  it('passes for classification with leading/trailing whitespace', () => {
    const product: GateProduct = { regulatoryClassification: '  spirits  ' };

    const result = service.checkProductGate(product);

    expect(result.passed).toBe(true);
  });
});