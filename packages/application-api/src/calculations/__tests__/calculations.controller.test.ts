/**
 * CalculationController tests — legacy endpoints honor the request body.
 *
 * These are high-liability tests: the 2026-08-28 technical assessment
 * (finding 3) found the previous adapter path discarded the posted body
 * by construction. Every case pins that the response is produced by the
 * real excise / container-duty math for the posted inputs.
 *
 * Uses the real domain services over a plain in-memory tax-rule port
 * (project testing principle: real engines, not vi.fn() mocks).
 *
 * @module CalculationControllerTest
 */

import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  AlcoholExciseService,
  ContainerDutyService,
  type TaxRuleRecordPort,
  type ITaxRuleRepositoryPort,
} from '@rajahinta/core-domain';
import { CalculationController } from '../calculations.controller';
import type {
  CalculateExciseDto,
  CalculateLandedCostDto,
} from '../calculations.dto';

// ---------------------------------------------------------------------------
// In-memory tax-rule port with hand-checkable official-style rules
// ---------------------------------------------------------------------------

const BEER_RULE: TaxRuleRecordPort = {
  id: 1,
  taxType: 'excise',
  productCategory: 'beer',
  rate: '0.3650', // € per centilitre of ethanol
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  calculationFormulaReference: 'PER_CENTILITRE_ETHANOL',
  officialSource: 'vero.fi',
  verificationDate: new Date('2026-01-02'),
  versionLabel: 'v3.0-2026',
  exemptionConditions: null,
};

const CONTAINER_DUTY_RULE: TaxRuleRecordPort = {
  id: 2,
  taxType: 'container_duty',
  productCategory: 'all_beverages',
  rate: '0.51', // € per litre
  effectiveFrom: new Date('2026-01-01'),
  effectiveTo: null,
  calculationFormulaReference: 'FLAT_PER_LITRE',
  officialSource: 'vero.fi',
  verificationDate: new Date('2026-01-02'),
  versionLabel: 'v3.0-2026',
  exemptionConditions: null,
};

class InMemoryTaxRulePort implements ITaxRuleRepositoryPort {
  async findApplicable(
    taxType: string,
    productCategory: string,
  ): Promise<TaxRuleRecordPort | null> {
    if (taxType === 'container_duty' && productCategory === 'all_beverages') {
      return CONTAINER_DUTY_RULE;
    }
    return null;
  }

  async findAllApplicable(
    taxType: string,
    productCategory: string,
  ): Promise<TaxRuleRecordPort[]> {
    if (taxType === 'excise' && productCategory === 'beer') {
      return [BEER_RULE];
    }
    return [];
  }

  async findHistoryRates(): Promise<TaxRuleRecordPort[]> {
    return [];
  }

  async findActiveVersionLabels(): Promise<readonly string[]> {
    return ['v3.0-2026'];
  }
}

function createController(): CalculationController {
  const port = new InMemoryTaxRulePort();
  return new CalculationController(
    new AlcoholExciseService(port),
    new ContainerDutyService(port),
  );
}

/** Beer excise math for the fixture rule: 0.3650 €/cl ethanol × abv × litres. */
function expectedBeerExciseCents(abv: number, volumeLitres: number): number {
  return Math.round(0.365 * abv * volumeLitres * 100);
}

// ---------------------------------------------------------------------------
// POST /api/v1/calculations/excise
// ---------------------------------------------------------------------------

describe('CalculationController — POST /calculations/excise', () => {
  it('calculates excise from the posted category, ABV, and volume', async () => {
    const controller = createController();
    const dto: CalculateExciseDto = {
      category: 'beer',
      volumeLitres: 3.3,
      alcoholByVolume: 0.047,
    };

    const result = await controller.calculateExcise(dto);

    // 0.3650 €/cl × 4.7 % × 3.3 l = 0.0566 € → 6 cents (rounded)
    expect(result.exciseAmountCents).toBe(expectedBeerExciseCents(0.047, 3.3));
    expect(result.exciseAmountCents).toBe(6);
    expect(result.category).toBe('beer');
    expect(result.rateVersionId).toBe('v3.0-2026');
    expect(result.evidence.volumeLitres).toBe(3.3);
    expect(result.evidence.alcoholByVolume).toBe(0.047);
    // Effective rate: 0.3650 × 0.047 = 0.017155 €/l → 2 cents/l
    expect(result.evidence.rateAppliedCentsPerUnit).toBe(2);
    expect(result.calculatedAt).toBeInstanceOf(Date);
  });

  it('reflects a different posted volume (the body drives the result)', async () => {
    const controller = createController();
    const result = await controller.calculateExcise({
      category: 'beer',
      volumeLitres: 33,
      alcoholByVolume: 0.047,
    });

    // 0.3650 €/cl × 4.7 % × 33 l ≈ 56.61 cents → 57; a hardcoded product
    // (the deleted adapter's behaviour) cannot pass this.
    expect(result.exciseAmountCents).toBe(expectedBeerExciseCents(0.047, 33));
    expect(result.exciseAmountCents).toBe(57);
  });

  it('falls back with ESTIMATED provenance when no rule matches the category', async () => {
    const controller = createController();
    const result = await controller.calculateExcise({
      category: 'wine',
      volumeLitres: 0.75,
      alcoholByVolume: 0.12,
    });

    // No wine rule in the fixture → zero-rate fallback, never a plausible number
    expect(result.exciseAmountCents).toBe(0);
    expect(result.rateVersionId).toBe('FALLBACK');
  });

  it.each([
    ['unknown category', { category: 'mead', volumeLitres: 1, alcoholByVolume: 0.05 }],
    ['ABV above 1 (percent posted instead of fraction)', { category: 'beer', volumeLitres: 1, alcoholByVolume: 4.7 }],
    ['zero volume', { category: 'beer', volumeLitres: 0, alcoholByVolume: 0.047 }],
    ['negative volume', { category: 'beer', volumeLitres: -1, alcoholByVolume: 0.047 }],
  ])('rejects %s with 400', async (_label, dto) => {
    const controller = createController();
    await expect(controller.calculateExcise(dto as CalculateExciseDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/calculations/landed-cost
// ---------------------------------------------------------------------------

describe('CalculationController — POST /calculations/landed-cost', () => {
  const FULL_DTO: CalculateLandedCostDto = {
    retailPriceCents: 1000,
    transportCostCents: 500,
    exciseBase: { category: 'beer', volumeLitres: 3.3, alcoholByVolume: 0.047 },
    containerType: 'glass',
    containerVolumeLitres: 3.3,
    depositSystemVerified: false,
    transactionClass: 'distance-selling',
  };

  it('sums the posted retail and transport with the real excise and container duty', async () => {
    const controller = createController();

    const result = await controller.calculateLandedCost(FULL_DTO);

    const exciseCents = expectedBeerExciseCents(0.047, 3.3); // 6
    const dutyCents = Math.round(0.51 * 3.3 * 100); // 168
    expect(result.exciseDuty?.exciseAmountCents).toBe(exciseCents);
    expect(result.containerDuty?.dutyAmountCents).toBe(dutyCents);
    expect(result.containerDuty?.evidence.rateAppliedCentsPerLitre).toBe(51);
    expect(result.containerDuty?.reliability).toBe('EXACT');
    expect(result.totalCostCents).toBe(1000 + 500 + exciseCents + dutyCents);
    expect(result.transactionClass).toBe('distance-selling');
    expect(result.currency).toBe('EUR');
    expect(result.disclaimer.text.length).toBeGreaterThan(0);
    expect(result.calculationTimestamp).toBeInstanceOf(Date);
  });

  it('reflects a different posted price (the body drives the result)', async () => {
    const controller = createController();

    const result = await controller.calculateLandedCost({
      ...FULL_DTO,
      retailPriceCents: 9999,
      transportCostCents: 1,
    });

    const exciseCents = expectedBeerExciseCents(0.047, 3.3);
    const dutyCents = Math.round(0.51 * 3.3 * 100);
    expect(result.retailPriceCents).toBe(9999);
    expect(result.transportCostCents).toBe(1);
    expect(result.totalCostCents).toBe(9999 + 1 + exciseCents + dutyCents);
  });

  it('exempts container duty when the deposit-return system covers the packaging', async () => {
    const controller = createController();

    const result = await controller.calculateLandedCost({
      ...FULL_DTO,
      depositSystemVerified: true,
    });

    expect(result.containerDuty?.dutyAmountCents).toBe(0);
    expect(result.containerDuty?.evidence.depositExemptionApplied).toBe(true);
  });

  it('computes a bare total when exciseBase and containerType are null', async () => {
    const controller = createController();

    const result = await controller.calculateLandedCost({
      ...FULL_DTO,
      exciseBase: null,
      containerType: null,
      containerVolumeLitres: null,
    });

    expect(result.exciseDuty).toBeNull();
    expect(result.containerDuty).toBeNull();
    expect(result.totalCostCents).toBe(1500);
  });

  it.each([
    [
      'containerType without containerVolumeLitres',
      { containerType: 'glass', containerVolumeLitres: null } as const,
    ],
    [
      'unknown containerType',
      { containerType: 'barrel', containerVolumeLitres: 3.3 } as const,
    ],
    ['negative retail price', { retailPriceCents: -1 } as const],
    ['fractional transport price', { transportCostCents: 10.5 } as const],
    [
      'invalid nested exciseBase',
      {
        exciseBase: { category: 'beer', volumeLitres: 1, alcoholByVolume: 5 },
      } as const,
    ],
    [
      'unknown transactionClass',
      { transactionClass: 'gift' } as const,
    ],
  ])('rejects %s with 400', async (_label, overrides) => {
    const controller = createController();
    const dto = { ...FULL_DTO, ...overrides } as unknown as CalculateLandedCostDto;
    await expect(controller.calculateLandedCost(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
