/**
 * GET /api/v1/calculator/result/:recordId — response-shape tests.
 *
 * Contract regression: the endpoint must return the LIVE calculation
 * response shape (the one POST /api/v1/calculator returns and the frontend
 * CalculatorResult type mirrors), reconstructed from the persisted record:
 *
 *   - Figures VERBATIM from the record — itemizedCosts equal the persisted
 *     breakdown JSON byte-for-byte, totalCents equal the persisted total.
 *     No engine runs, nothing is recomputed.
 *   - Product facts joined from the product master, converted exactly the
 *     way ProductDataAdapter converts them for the live path.
 *   - Dataset version labels resolved by rule ID (labels only).
 *   - Fields the record does not persist degrade factually (empty
 *     confidenceBreakdown, NotPersisted classification, omitted
 *     transportMethod) — the result page renders, never crashes.
 *   - 404 behaviour unchanged.
 *
 * Follows the project pattern — direct instantiation with in-memory
 * repository classes (real classes extending the data-platform abstracts,
 * no vi.fn).  The POST-path dependencies (calculator service, idempotency,
 * tax-rule port) are never touched by getResult and are passed as null
 * placeholders.
 *
 * @module CalculatorResultMapperTest
 */

import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ItemizedCost, LandedCostCalculatorService } from '@rajahinta/core-domain';
import {
  CalculationRecordRepository,
  ProductRepository,
  TaxRateRepository,
  calculationRecords,
  productMaster,
  taxRules,
} from '@rajahinta/data-platform';
import { CalculatorController } from '../calculator.controller';
import type { IdempotencyService } from '../../idempotency';
import type { ITaxRuleRepositoryPort } from '@rajahinta/core-domain';
import { mapCalculationRecordToResult } from '../calculation-result.mapper';

// ---------------------------------------------------------------------------
// Fixtures — a persisted record exactly as the orchestrator writes it
// ---------------------------------------------------------------------------

const CALCULATED_AT = new Date('2026-08-20T12:34:56.789Z');

/** The breakdown the LandedCostCalculatorService persists (ItemizedCost[]). */
const PERSISTED_BREAKDOWN: ItemizedCost[] = [
  {
    label: 'Retail price',
    category: 'foreignRetailPrice',
    cents: 2460,
    reliability: 'VERIFIED',
    breakdown: [
      {
        label: 'Unit price (x2)',
        category: 'foreignRetailPrice',
        cents: 2460,
        reliability: 'VERIFIED',
      },
    ],
  },
  { label: 'Transport', category: 'transportCost', cents: 1490, reliability: 'ESTIMATED' },
  { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 1160, reliability: 'VERIFIED' },
  { label: 'Container duty', category: 'containerDutyEstimate', cents: 34, reliability: 'VERIFIED' },
];

const DISCLAIMER = {
  text: 'Arvioitu kokonaiskustannus Suomessa. Ei ole lopullinen verovelvollisuuden määrä.',
  language: 'fi',
  version: '1.0',
} as const;

/** The JSON-stable benchmark snapshot the orchestrator persists (task 4.2). */
const PERSISTED_BENCHMARK = {
  status: 'available',
  referencePriceCents: 300,
  differenceCents: -50,
  differencePercent: -16.7,
  reliabilityStatus: 'VERIFIED',
  observedAt: '2026-08-05T10:00:00.000Z',
} as const;

function makeRecord(
  overrides: Partial<typeof calculationRecords.$inferSelect> = {},
): typeof calculationRecords.$inferSelect {
  return {
    id: 42,
    productMasterId: 7,
    retailOfferIds: [100],
    transportOfferId: 900,
    exciseRuleVersionId: 3,
    containerDutyRuleVersionId: 4,
    totalCents: 5144,
    breakdown: PERSISTED_BREAKDOWN,
    confidence: 'HIGH',
    quantity: 2,
    destination: 'FI',
    disclaimer: JSON.stringify(DISCLAIMER),
    sessionId: 'session-abc',
    calculatedAt: CALCULATED_AT,
    // Legacy shape: NULL column → the mapper must emit NO key.
    alkoBenchmark: null,
    ...overrides,
  };
}

function makeProduct(
  overrides: Partial<typeof productMaster.$inferSelect> = {},
): typeof productMaster.$inferSelect {
  return {
    id: 7,
    name: 'Koff III 0.33L',
    manufacturer: 'Sinebrychoff',
    brand: 'Koff',
    category: 'beer',
    alcoholByVolume: '0.047',
    unitVolume: '0.3300',
    containerType: 'glass',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: null,
    weightGrams: null,
    createdAt: CALCULATED_AT,
    updatedAt: CALCULATED_AT,
    ...overrides,
  };
}

function makeTaxRule(
  id: number,
  versionLabel: string,
): typeof taxRules.$inferSelect {
  return {
    id,
    taxType: 'excise',
    productCategory: 'beer',
    rate: '36.20',
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    exemptionConditions: null,
    calculationFormulaReference: 'PER_DEGREE_PLATO',
    officialSource: 'https://www.vero.fi',
    verificationDate: new Date('2026-01-01'),
    versionLabel,
    createdAt: new Date('2026-01-01'),
  };
}

// ---------------------------------------------------------------------------
// In-memory repositories — real classes extending the data-platform
// abstracts (e2e convention); only the read paths getResult uses are live.
// ---------------------------------------------------------------------------

class InMemoryCalculationRecordRepository extends CalculationRecordRepository {
  private readonly records = new Map<number, typeof calculationRecords.$inferSelect>();

  seed(record: typeof calculationRecords.$inferSelect): void {
    this.records.set(record.id, record);
  }

  override async findById(
    id: number,
  ): Promise<typeof calculationRecords.$inferSelect | null> {
    return this.records.get(id) ?? null;
  }

  override async create(): Promise<never> {
    throw new Error('not used by getResult');
  }

  override async findBySession(): Promise<never[]> {
    throw new Error('not used by getResult');
  }

  override async linkSession(): Promise<boolean> {
    throw new Error('not used by getResult');
  }

  override async findHistoryEntriesBySession(): Promise<never[]> {
    throw new Error('not used by getResult');
  }

  override async findCalculationRecordIdsByEntity(): Promise<never[]> {
    throw new Error('not used by getResult');
  }
}

class InMemoryProductRepository extends ProductRepository {
  constructor(private readonly products: (typeof productMaster.$inferSelect)[]) {
    super();
  }

  override async findById(
    id: number,
  ): Promise<typeof productMaster.$inferSelect | null> {
    return this.products.find((p) => p.id === id) ?? null;
  }

  override async searchByName(): Promise<never> {
    throw new Error('not used by getResult');
  }

  override async findOffers(): Promise<never> {
    throw new Error('not used by getResult');
  }

  override async findRetailOfferById(): Promise<never> {
    throw new Error('not used by getResult');
  }

  override async create(): Promise<never> {
    throw new Error('not used by getResult');
  }

  override async upsertByEan(): Promise<never> {
    throw new Error('not used by getResult');
  }
}

class InMemoryTaxRateRepository extends TaxRateRepository {
  constructor(private readonly rules: (typeof taxRules.$inferSelect)[]) {
    super();
  }

  override async findVersionById(
    id: number,
  ): Promise<typeof taxRules.$inferSelect | null> {
    return this.rules.find((r) => r.id === id) ?? null;
  }

  override async findEffectiveVersion(): Promise<never> {
    throw new Error('not used by getResult');
  }

  override async findHistoryRates(): Promise<never> {
    throw new Error('not used by getResult');
  }
}

// ---------------------------------------------------------------------------
// Controller factory
// ---------------------------------------------------------------------------

function buildController(options: {
  record?: typeof calculationRecords.$inferSelect | null;
  products?: (typeof productMaster.$inferSelect)[];
  rules?: (typeof taxRules.$inferSelect)[];
}): CalculatorController {
  const recordRepo = new InMemoryCalculationRecordRepository();
  if (options.record) recordRepo.seed(options.record);

  // getResult never touches the POST-path dependencies — placeholders keep
  // the constructor signature honest without instantiating their modules.
  const unusedCalculator = null as unknown as LandedCostCalculatorService;
  const unusedIdempotency = null as unknown as IdempotencyService;
  const unusedTaxPort = null as unknown as ITaxRuleRepositoryPort;

  return new CalculatorController(
    unusedCalculator,
    recordRepo,
    unusedIdempotency,
    unusedTaxPort,
    new InMemoryProductRepository(options.products ?? []),
    new InMemoryTaxRateRepository(options.rules ?? []),
  );
}

// ---------------------------------------------------------------------------
// Mapper — pure reconstruction
// ---------------------------------------------------------------------------

describe('mapCalculationRecordToResult', () => {
  it('reconstructs the live response shape with byte-identical figures', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord(),
      product: makeProduct(),
      exciseVersionLabel: 'v3.0-2026',
      containerVersionLabel: 'v2.0-2025',
    });

    // -- Figures verbatim --
    expect(result.itemizedCosts).toEqual(PERSISTED_BREAKDOWN);
    expect(result.totalCents).toBe(5144);
    expect(result.calculationRecordId).toBe(42);

    // -- Flat fields mirror the persisted lines --
    expect(result.foreignRetailPrice).toBe(2460);
    expect(result.transportCost).toBe(1490);
    expect(result.alcoholExciseEstimate).toBe(1160);
    expect(result.containerDutyEstimate).toBe(34);
    // Task 10.3 removed the category — the reconstructed shape must not
    // carry the dead key at all.
    expect('otherCharges' in result).toBe(false);
    expect(result.currency).toBe('EUR');

    // -- Fields the record does not persist are key-absent (never null,
    //    never a placeholder): the dead exclusion keys stay gone and the
    //    benchmark is absent on records predating it.
    expect('excludedOffers' in result).toBe(false);
    expect('originalRetailPrice' in result).toBe(false);
    expect('alkoBenchmark' in result).toBe(false);

    // -- Metadata: product facts joined from the master --
    expect(result.metadata.productName).toBe('Koff III 0.33L');
    expect(result.metadata.volumeLitres).toBe(0.33);
    expect(result.metadata.alcoholByVolume).toBe(0.047);
    expect(result.metadata.category).toBe('beer');
    expect(result.metadata.productMasterId).toBe(7);

    // -- Metadata: input snapshot from record columns --
    expect(result.metadata.input).toEqual({
      productId: 7,
      quantity: 2,
      destination: 'FI',
      sessionId: 'session-abc',
    });
    expect(result.metadata.quantity).toBe(2);
    expect(result.metadata.destination).toBe('FI');
    expect(result.metadata.retailOfferIds).toEqual([100]);
    expect(result.metadata.transportOfferId).toBe(900);
    expect(result.metadata.calculationTimestamp).toBe(
      '2026-08-20T12:34:56.789Z',
    );

    // -- Dataset versions resolved by rule ID --
    expect(result.metadata.datasetVersions).toEqual(['v3.0-2026', 'v2.0-2025']);

    // -- Confidence + disclaimer from the record --
    expect(result.confidence).toBe('HIGH');
    expect(result.disclaimer).toEqual(DISCLAIMER);
  });

  it('dedupes identical dataset version labels', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord(),
      product: makeProduct(),
      exciseVersionLabel: 'v3.0-2026',
      containerVersionLabel: 'v3.0-2026',
    });
    expect(result.metadata.datasetVersions).toEqual(['v3.0-2026']);
  });

  it('omits dataset version labels that cannot be resolved', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord({
        exciseRuleVersionId: null,
        containerDutyRuleVersionId: 4,
      }),
      product: makeProduct(),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });
    expect(result.metadata.datasetVersions).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Import-VAT line (task 4.3, design D6)
  // -------------------------------------------------------------------------

  /** The VAT line the orchestrator persists for a foreign-seller record. */
  const PERSISTED_VAT_LINE: ItemizedCost = {
    label: 'Import VAT (estimated)',
    category: 'importVatEstimate',
    cents: 918,
    reliability: 'VERIFIED',
    rateVersionId: 'import-vat-2024.2',
    calculatedAt: '2026-08-20T12:34:56.789Z',
    breakdown: [
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 2460, reliability: 'VERIFIED' },
      { label: 'Transport', category: 'transportCost', cents: 1490, reliability: 'VERIFIED' },
      { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 1160, reliability: 'VERIFIED' },
      { label: 'Container duty', category: 'containerDutyEstimate', cents: 34, reliability: 'VERIFIED' },
    ],
  };

  it('carries the import-VAT line verbatim with provenance, base breakdown, and the flat figure', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord({
        breakdown: [...PERSISTED_BREAKDOWN, PERSISTED_VAT_LINE],
        totalCents: 5144 + 918,
      }),
      product: makeProduct(),
      exciseVersionLabel: 'v3.0-2026',
      containerVersionLabel: 'v2.0-2025',
    });

    const vatLine = result.itemizedCosts.find(
      (c) => c.category === 'importVatEstimate',
    );
    expect(vatLine).toEqual(PERSISTED_VAT_LINE);
    expect(result.importVatEstimate).toBe(918);
    // The nested base breakdown survives the round-trip.
    expect(vatLine!.breakdown).toHaveLength(4);
    expect(vatLine!.breakdown!.every((b) => b.category !== undefined)).toBe(
      true,
    );
  });

  it('serves a pre-change record without an importVatEstimate key (absence is normal)', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord(),
      product: makeProduct(),
      exciseVersionLabel: 'v3.0-2026',
      containerVersionLabel: 'v2.0-2025',
    });

    expect(
      result.itemizedCosts.some((c) => c.category === 'importVatEstimate'),
    ).toBe(false);
    expect('importVatEstimate' in result).toBe(false);
  });

  it('serves a pre-change record with no alkoBenchmark key (spec application-api benchmark scenario)', () => {
    // Records created before the benchmark change lack the field — the
    // fetch must succeed and the response must not carry the key at all:
    // absence is the render-nothing state, never null or a placeholder.
    const result = mapCalculationRecordToResult({
      record: makeRecord(),
      product: makeProduct(),
      exciseVersionLabel: 'v3.0-2026',
      containerVersionLabel: 'v2.0-2025',
    });

    expect('alkoBenchmark' in result).toBe(false);
    // The rest of the shape is unaffected — figures stay verbatim.
    expect(result.totalCents).toBe(5144);
    expect(result.itemizedCosts).toEqual(PERSISTED_BREAKDOWN);
  });

  it('emits the persisted alkoBenchmark snapshot verbatim when the record carries one', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord({ alkoBenchmark: PERSISTED_BENCHMARK }),
      product: makeProduct(),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });

    // Round-trip fidelity: the exact JSON-stable snapshot comes back —
    // figures, reliability, and the ISO observation timestamp untouched.
    expect(result.alkoBenchmark).toEqual(PERSISTED_BENCHMARK);
    expect(result.alkoBenchmark?.observedAt).toBe('2026-08-05T10:00:00.000Z');
    // Display-only: the benchmark adds no cent to the headline figure
    // and stays out of the itemized array.
    expect(result.totalCents).toBe(5144);
    expect(result.itemizedCosts).toEqual(PERSISTED_BREAKDOWN);
  });

  it('drops malformed persisted benchmark values instead of emitting a placeholder', () => {
    for (const benchmark of [
      // The unavailable variant never reaches the response contract.
      { status: 'unavailable', reason: 'NO_REFERENCE_OFFER' },
      // Corrupt rows degrade to the absent state — render nothing.
      { status: 'available', referencePriceCents: '300' },
      { status: 'available', reliabilityStatus: 'EXACT' },
      { status: 'available', observedAt: 'not-a-timestamp' },
      'garbage',
    ]) {
      const result = mapCalculationRecordToResult({
        record: makeRecord({ alkoBenchmark: benchmark }),
        product: makeProduct(),
        exciseVersionLabel: null,
        containerVersionLabel: null,
      });
      expect('alkoBenchmark' in result).toBe(false);
    }
  });

  it('degrades factually when the classification is not persisted', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord(),
      product: makeProduct(),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });

    // No derived label — a factual marker with an explanation.
    expect(result.classification.classification).toBe('NotPersisted');
    expect(result.classification.evidenceSummary).toMatch(/not persisted/i);
    // Per-point confidence is not persisted — empty hides the UI section.
    expect(result.confidenceBreakdown).toEqual([]);
  });

  it('omits sessionId when the record has none (key absent, not null)', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord({ sessionId: null }),
      product: makeProduct(),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });
    expect('sessionId' in result.metadata.input).toBe(false);
  });

  it('degrades malformed breakdown entries without inventing figures', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord({
        breakdown: [
          // Legacy reliability value — never overstated.
          { label: 'Retail price', category: 'foreignRetailPrice', cents: 1000, reliability: 'EXACT' },
          // Unknown categories (incl. legacy otherCharges) are dropped
          // from itemizedCosts — no valid bucket exists post-10.3.
          { label: 'Mystery fee', category: 'customsFee', cents: 99, reliability: 'VERIFIED' },
          { label: 'Other charges', category: 'otherCharges', cents: 0, reliability: 'VERIFIED' },
          // Non-object entries are dropped.
          'garbage',
          null,
        ],
      }),
      product: makeProduct(),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });

    expect(result.itemizedCosts).toEqual([
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 1000, reliability: 'UNAVAILABLE' },
    ]);
    expect(result.foreignRetailPrice).toBe(1000);
    // totalCents stays verbatim from the record — the headline figure
    // never lies even when lines are unrepresentable.
    expect(result.totalCents).toBe(5144);
  });

  it('renders non-JSON disclaimer text verbatim with unknown version', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord({ disclaimer: 'Plain legacy disclaimer' }),
      product: makeProduct(),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });
    expect(result.disclaimer.text).toBe('Plain legacy disclaimer');
    expect(result.disclaimer.version).toBe('unknown');
  });

  it('degrades product facts when the master row is absent', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord(),
      product: null,
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });
    expect(result.metadata.productName).toBe('Unknown product (ID 7)');
    expect(result.metadata.volumeLitres).toBe(0);
    expect(result.metadata.alcoholByVolume).toBe(0);
    expect(result.metadata.category).toBe('unknown');
  });

  it('treats unknown ABV as 0, mirroring the live adapter conversion', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord(),
      product: makeProduct({ alcoholByVolume: null }),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });
    expect(result.metadata.alcoholByVolume).toBe(0);
  });

  it('never overstates an unknown confidence level', () => {
    const result = mapCalculationRecordToResult({
      record: makeRecord({ confidence: 'SOLID' }),
      product: makeProduct(),
      exciseVersionLabel: null,
      containerVersionLabel: null,
    });
    expect(result.confidence).toBe('LOW');
  });
});

// ---------------------------------------------------------------------------
// Controller — getResult
// ---------------------------------------------------------------------------

describe('CalculatorController — getResult', () => {
  it('returns the live shape for a persisted record with joined facts', async () => {
    const controller = buildController({
      record: makeRecord(),
      products: [makeProduct()],
      rules: [makeTaxRule(3, 'v3.0-2026'), makeTaxRule(4, 'v3.0-2026')],
    });

    const result = await controller.getResult(42);

    // Figures byte-identical to the persisted breakdown fixture.
    expect(result.itemizedCosts).toEqual(PERSISTED_BREAKDOWN);
    expect(result.totalCents).toBe(5144);
    expect(result.calculationRecordId).toBe(42);
    // Product facts joined via ProductRepository.
    expect(result.metadata.productName).toBe('Koff III 0.33L');
    // Labels resolved by rule ID via TaxRateRepository (deduped).
    expect(result.metadata.datasetVersions).toEqual(['v3.0-2026']);
    expect(result.disclaimer).toEqual(DISCLAIMER);
  });

  it('maps a benchmark-bearing record through GET with the exact snapshot', async () => {
    const controller = buildController({
      record: makeRecord({ alkoBenchmark: PERSISTED_BENCHMARK }),
      products: [makeProduct()],
      rules: [makeTaxRule(3, 'v3.0-2026')],
    });

    const result = await controller.getResult(42);

    // The GET response carries the benchmark the live POST response had —
    // the past result renders its benchmark line identically.
    expect(result.alkoBenchmark).toEqual(PERSISTED_BENCHMARK);
  });

  it('returns 404 (unchanged) for a missing record', async () => {
    const controller = buildController({
      products: [makeProduct()],
      rules: [makeTaxRule(3, 'v3.0-2026')],
    });

    try {
      await controller.getResult(999);
      expect.unreachable('Expected NotFoundException');
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).message).toBe(
        'Calculation record 999 not found',
      );
    }
  });

  it('renders (never crashes) when the product master row is missing', async () => {
    const controller = buildController({
      record: makeRecord(),
      products: [],
      rules: [],
    });

    const result = await controller.getResult(42);
    expect(result.metadata.productName).toBe('Unknown product (ID 7)');
    expect(result.totalCents).toBe(5144);
  });
});
