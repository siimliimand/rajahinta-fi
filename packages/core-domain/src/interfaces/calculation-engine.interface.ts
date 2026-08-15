/**
 * Pure interface for the tax calculation engine.
 *
 * This is the contract between the Core Domain and all consuming layers
 * (Application API, Background Jobs, etc.).  It carries NO framework
 * decorators – only TypeScript types – so the engine can be extracted to
 * a standalone package or microservice without changing the domain model.
 *
 * @module CalculationEngine
 */

import type {
  ExciseBase,
  ExciseCalculation,
  ContainerDutyRequest,
  ContainerDutyCalculation,
  LandedCostResult,
  TransactionClass,
} from '../index';

/**
 * Parameters required for a full landed-cost calculation.
 */
export interface LandedCostParams {
  readonly retailPriceCents: number;
  readonly transportCostCents: number;
  readonly exciseBase: ExciseBase | null;
  readonly containerDutyRequest: ContainerDutyRequest | null;
  readonly transactionClass: TransactionClass;
}

/**
 * Tax calculation engine contract.
 *
 * Every method returns a result with provenance evidence so every number
 * is traceable to its input values, rate version, and timestamp.
 */
export interface ICalculationEngine {
  /** Calculate alcohol excise duty for a given base. */
  calculateExcise(base: ExciseBase): Promise<ExciseCalculation>;

  /** Calculate container deposit duty. */
  calculateContainerDuty(
    request: ContainerDutyRequest,
  ): Promise<ContainerDutyCalculation>;

  /** Calculate the full landed cost for a basket line. */
  calculateLandedCost(params: LandedCostParams): Promise<LandedCostResult>;
}