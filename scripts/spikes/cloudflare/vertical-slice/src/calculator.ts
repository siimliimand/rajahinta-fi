/**
 * G3 vertical slice spike — calculator composition.
 *
 * Wires the REAL core-domain engines exactly like the golden suite's
 * createGoldenService (tests/golden/golden-dataset.test.ts) but with the
 * D1 adapters in place of the in-memory ports. No NestJS container: the
 * services are plain classes constructed manually, which is what makes
 * them portable to a Worker.
 *
 * @module G3SpikeCalculator
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
  LandedCostCalculatorService,
  ClassificationGateService,
  AlcoholExciseService,
  ContainerDutyService,
  TransactionClassificationService,
  TransportClassificationService,
  TransportEstimationService,
  ConfidenceFrameworkService,
  ReliabilityService,
} from './core-domain.ts';
import {
  D1ProductDataPort,
  D1TaxRuleRepository,
  D1TransportOfferQuery,
  D1CalculationRecordPort,
} from './adapters.ts';

export function buildLandedCostCalculator(
  db: DrizzleD1Database,
): LandedCostCalculatorService {
  // Pure-logic services (zero I/O) — production classes
  const gate = new ClassificationGateService();
  const transportClassification = new TransportClassificationService();
  const reliability = new ReliabilityService();
  const confidence = new ConfidenceFrameworkService(reliability);
  const classificationService = new TransactionClassificationService(
    transportClassification,
  );

  // Real engines over the D1-backed ports
  const taxRepo = new D1TaxRuleRepository(db);
  const alcoholExcise = new AlcoholExciseService(taxRepo);
  const containerDuty = new ContainerDutyService(taxRepo);
  const transportEstimation = new TransportEstimationService(
    new D1TransportOfferQuery(db),
  );

  return new LandedCostCalculatorService(
    gate,
    alcoholExcise,
    containerDuty,
    classificationService,
    transportEstimation,
    confidence,
    new D1ProductDataPort(db),
    new D1CalculationRecordPort(db),
  );
}
