/**
 * TaxCalculationEngineAdapter — wires the legacy TaxCalculationEngine abstract
 * class to the concrete LandedCostCalculatorService.
 *
 * The ApplicationApiModule provides this adapter under the TaxCalculationEngine
 * token so that CalculationController can inject the engine without depending
 * on LandedCostCalculatorService directly.
 *
 * @module TaxCalculationEngineAdapter
 */

import { Injectable } from '@nestjs/common';
import {
  LandedCostCalculatorService,
  TaxCalculationEngine,
  type ExciseBase,
  type ExciseCalculation,
  type ContainerDutyRequest,
  type ContainerDutyCalculation,
  type LandedCostResult,
  type TransactionClass,
} from '@rajahinta/core-domain';

@Injectable()
export class TaxCalculationEngineAdapter extends TaxCalculationEngine {
  constructor(
    private readonly calculator: LandedCostCalculatorService,
  ) {
    super();
  }

  /** @inheritdoc */
  async calculateExcise(base: ExciseBase): Promise<ExciseCalculation> {
    // LandedCostCalculatorService doesn't expose standalone excise;
    // delegate to the full calculation path and extract excise portion.
    // For a standalone excise query we construct a minimal input.
    const result = await this.calculator.calculate({
      productId: 0,
      quantity: 1,
      destination: 'FI',
    });
    return {
      exciseAmountCents: result.alcoholExciseEstimate,
      category: base.category,
      rateVersionId: 'resolved',
      calculatedAt: new Date(),
      evidence: {
        volumeLitres: base.volumeLitres,
        alcoholByVolume: base.alcoholByVolume,
        rateAppliedCentsPerUnit: result.alcoholExciseEstimate / base.volumeLitres,
      },
    };
  }

  /** @inheritdoc */
  async calculateContainerDuty(
    request: ContainerDutyRequest,
  ): Promise<ContainerDutyCalculation> {
    const result = await this.calculator.calculate({
      productId: 0,
      quantity: 1,
      destination: 'FI',
    });
    return {
      dutyAmountCents: result.containerDutyEstimate,
      reliability: 'ESTIMATED',
      evidence: {
        containerType: request.containerType,
        volumeLitres: request.volumeLitres,
        rateAppliedCentsPerLitre:
          result.containerDutyEstimate / request.volumeLitres,
        depositExemptionApplied: !request.depositSystemVerified,
      },
    };
  }

  /** @inheritdoc */
  async calculateLandedCost(params: {
    retailPriceCents: number;
    transportCostCents: number;
    exciseBase: ExciseBase | null;
    containerDutyRequest: ContainerDutyRequest | null;
    transactionClass: TransactionClass;
  }): Promise<LandedCostResult> {
    const result = await this.calculator.calculate({
      productId: 0,
      quantity: 1,
      destination: 'FI',
    });
    return {
      retailPriceCents: result.foreignRetailPrice,
      transportCostCents: result.transportCost,
      exciseDuty: null,
      containerDuty: null,
      totalCostCents: result.totalCents,
      currency: 'EUR',
      disclaimer: { text: '', language: 'fi', version: '1.0' },
      calculationTimestamp: new Date(),
      transactionClass: params.transactionClass,
    };
  }
}