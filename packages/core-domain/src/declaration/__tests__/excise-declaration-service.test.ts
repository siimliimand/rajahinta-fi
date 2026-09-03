/**
 * ExciseDeclarationService functional tests.
 *
 * High-liability coverage: the declaration assistant packages a completed
 * calculation into a structured summary that consumers rely on for Finnish
 * customs / MyTax reference.  Incorrect assembly, missing fields, or wrong
 * advance-notice logic could cause the user to miss a customs deadline or
 * submit an inaccurate declaration.
 *
 * Covers:
 *   - prepareDeclaration       full success path with complete assembly
 *   - CalculationRecordNotFoundError   thrown on missing record
 *   - Advance-notice logic     TravellerImport vs DistanceSelling/Buying
 *   - MyTax link               constant link in output
 *   - Disclaimer propagation   mapDisclaimer through assembleSummary
 *   - Error propagation        repository errors surface as-is
 *
 * @module ExciseDeclarationServiceTest
 */

import { describe, it, expect, vi } from 'vitest';
import { ExciseDeclarationService } from '../excise-declaration.service';
import { CalculationRecordNotFoundError } from '../declaration.types';
import type {
  CalculationRecordData,
  ICalculationRecordQueryPort,
  DeclarationAdvanceNoticeInfo,
} from '../declaration.types';
import type { ConfidenceLevel } from '../../reliability/confidence-framework.types';
import type { ClassificationLabel } from '../../classification/classification.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MYTAX_LINK = 'https://www.vero.fi/asioi-verkossa/mytax/';
const DEFAULT_TIMESTAMP = '2026-06-15T10:30:00.000Z';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createRecord(
  overrides?: Partial<CalculationRecordData>,
): CalculationRecordData {
  const defaults: CalculationRecordData = {
    id: 1,
    productName: 'Olut',
    productBrand: 'Karhu',
    productCategory: 'Beer',
    alcoholByVolume: 4.5,
    volumeLitres: 0.5,
    containerType: 'Can',
    depositSystemStatus: true,
    quantity: 24,
    transportCarrier: 'Posti',
    transportOrigin: 'DE',
    transportDestination: 'FI',
    alcoholExciseCents: 360,
    containerDutyCents: 48,
    totalCents: 408,
    confidence: 'HIGH' as ConfidenceLevel,
    classification: 'TravellerImport' as ClassificationLabel,
    disclaimerText:
      'Tämä on laskelma, ei sitova päätös. Tarkista tiedot ennen ilmoitusta.',
    disclaimerLanguage: 'fi',
    disclaimerVersion: '1.2.0',
    calculationTimestamp: DEFAULT_TIMESTAMP,
  };
  return { ...defaults, ...overrides, id: overrides?.id ?? defaults.id };
}

// ---------------------------------------------------------------------------
// Mock query port factory
// ---------------------------------------------------------------------------

function createMockQueryPort(
  overrides?: Partial<ICalculationRecordQueryPort>,
): ICalculationRecordQueryPort {
  return {
    findById: vi.fn(),
    ...overrides,
  };
}

/**
 * Create an ExciseDeclarationService wired to the given (or default mock) port.
 * Returns both the service and the mock port for assertion access.
 */
function createService(port?: ICalculationRecordQueryPort): {
  service: ExciseDeclarationService;
  queryPort: ICalculationRecordQueryPort;
} {
  const queryPort = port ?? createMockQueryPort();
  const service = new ExciseDeclarationService(queryPort);
  return { service, queryPort };
}

// ---------------------------------------------------------------------------
// prepareDeclaration — success path
// ---------------------------------------------------------------------------

describe('prepareDeclaration', () => {
  it('returns a complete DeclarationSummary when the record exists', async () => {
    const record = createRecord({ id: 42 });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(42);

    expect(result).toBeDefined();
  });

  it('maps all product fields correctly', async () => {
    const record = createRecord({
      productName: 'Lonkero',
      productBrand: 'Hartwall',
      productCategory: 'Long Drink',
      alcoholByVolume: 5.5,
      volumeLitres: 0.33,
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.product.name).toBe('Lonkero');
    expect(result.product.brand).toBe('Hartwall');
    expect(result.product.category).toBe('Long Drink');
    expect(result.product.abv).toBe(5.5);
    expect(result.product.volumeLitres).toBe(0.33);
  });

  it('maps units from record.quantity', async () => {
    const record = createRecord({ quantity: 12 });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.units).toBe(12);
  });

  it('maps all container fields correctly', async () => {
    const record = createRecord({
      containerType: 'Bottle',
      volumeLitres: 0.75,
      depositSystemStatus: false,
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.container.type).toBe('Bottle');
    expect(result.container.volumeLitres).toBe(0.75);
    expect(result.container.depositSystemStatus).toBe(false);
  });

  it('maps depositSystemStatus null when record has null', async () => {
    const record = createRecord({ depositSystemStatus: null });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.container.depositSystemStatus).toBeNull();
  });

  it('maps all transport fields correctly', async () => {
    const record = createRecord({
      transportCarrier: 'DHL',
      transportOrigin: 'EE',
      transportDestination: 'FI',
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.transport.carrier).toBe('DHL');
    expect(result.transport.origin).toBe('EE');
    expect(result.transport.destination).toBe('FI');
  });

  it('maps transport carrier as null when record has null', async () => {
    const record = createRecord({ transportCarrier: null });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.transport.carrier).toBeNull();
  });

  it('computes totalExciseCents as alcoholExciseCents + containerDutyCents', async () => {
    const record = createRecord({
      alcoholExciseCents: 500,
      containerDutyCents: 75,
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.estimatedExcise.alcoholExciseCents).toBe(500);
    expect(result.estimatedExcise.containerDutyCents).toBe(75);
    expect(result.estimatedExcise.totalCents).toBe(575);
  });

  it('computes totalCents correctly with zero container duty', async () => {
    const record = createRecord({
      alcoholExciseCents: 200,
      containerDutyCents: 0,
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.estimatedExcise.totalCents).toBe(200);
  });

  it('maps confidence from record', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(createRecord({ confidence: 'MEDIUM' as ConfidenceLevel })),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.estimatedExcise.confidence).toBe('MEDIUM');
  });

  it('maps declarationDate from record.calculationTimestamp', async () => {
    const ts = '2026-07-01T08:15:00.000Z';
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(createRecord({ calculationTimestamp: ts })),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.declarationDate).toBe(ts);
  });

  it('maps disclaimer fields correctly', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(
          createRecord({
            disclaimerText: 'English disclaimer',
            disclaimerLanguage: 'en' as const,
            disclaimerVersion: '2.0.0',
          }),
        ),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.disclaimer.text).toBe('English disclaimer');
    expect(result.disclaimer.language).toBe('en');
    expect(result.disclaimer.version).toBe('2.0.0');
  });

  it('returns the full record shape on success', async () => {
    const record = createRecord({
      id: 100,
      productName: 'Koskenkorva',
      productBrand: null,
      productCategory: 'Spirit',
      alcoholByVolume: 37.5,
      volumeLitres: 1.0,
      containerType: 'Bottle',
      depositSystemStatus: null,
      quantity: 1,
      transportCarrier: null,
      transportOrigin: null,
      transportDestination: 'FI',
      alcoholExciseCents: 1200,
      containerDutyCents: 100,
      totalCents: 1300,
      confidence: 'LOW' as ConfidenceLevel,
      classification: 'DistanceBuying' as ClassificationLabel,
      disclaimerText: 'Estimate only.',
      disclaimerLanguage: 'en' as const,
      disclaimerVersion: '1.0.0',
      calculationTimestamp: '2026-08-01T00:00:00.000Z',
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(100);

    expect(result.product.name).toBe('Koskenkorva');
    expect(result.product.brand).toBeNull();
    expect(result.product.category).toBe('Spirit');
    expect(result.product.abv).toBe(37.5);
    expect(result.product.volumeLitres).toBe(1.0);
    expect(result.units).toBe(1);
    expect(result.container.type).toBe('Bottle');
    expect(result.container.volumeLitres).toBe(1.0);
    expect(result.container.depositSystemStatus).toBeNull();
    expect(result.transport.carrier).toBeNull();
    expect(result.transport.origin).toBeNull();
    expect(result.transport.destination).toBe('FI');
    expect(result.estimatedExcise.alcoholExciseCents).toBe(1200);
    expect(result.estimatedExcise.containerDutyCents).toBe(100);
    expect(result.estimatedExcise.totalCents).toBe(1300);
    expect(result.estimatedExcise.confidence).toBe('LOW');
    expect(result.declarationDate).toBe('2026-08-01T00:00:00.000Z');
    expect(result.disclaimer.text).toBe('Estimate only.');
    expect(result.disclaimer.language).toBe('en');
    expect(result.disclaimer.version).toBe('1.0.0');
  });

  it('delegates the correct record ID to the query port', async () => {
    const queryPort = createMockQueryPort({
      findById: vi.fn().mockResolvedValue(createRecord()),
    });
    const { service } = createService(queryPort);

    await service.prepareDeclaration(99);

    expect(queryPort.findById).toHaveBeenCalledWith(99);
    expect(queryPort.findById).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// CalculationRecordNotFoundError
// ---------------------------------------------------------------------------

describe('CalculationRecordNotFoundError', () => {
  it('throws CalculationRecordNotFoundError when record is null', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(null),
      }),
    );

    await expect(service.prepareDeclaration(999)).rejects.toThrow(
      CalculationRecordNotFoundError,
    );
  });

  it('includes the record ID in the error message', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(null),
      }),
    );

    await expect(service.prepareDeclaration(777)).rejects.toThrow(
      'Calculation record 777 not found',
    );
  });

  it('sets the error name to CalculationRecordNotFoundError', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(null),
      }),
    );

    try {
      await service.prepareDeclaration(42);
      expect.unreachable('Expected error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculationRecordNotFoundError);
      if (err instanceof CalculationRecordNotFoundError) {
        expect(err.name).toBe('CalculationRecordNotFoundError');
      }
    }
  });

  it('exposes calculationRecordId property', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(null),
      }),
    );

    try {
      await service.prepareDeclaration(55);
      expect.unreachable('Expected error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculationRecordNotFoundError);
      if (err instanceof CalculationRecordNotFoundError) {
        expect(err.calculationRecordId).toBe(55);
      }
    }
  });

  it('propagates non-null errors from query port as-is', async () => {
    // If findById throws (not returns null), the error should propagate
    // without being caught/converted.
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      }),
    );

    await expect(service.prepareDeclaration(1)).rejects.toThrow(
      'DB connection lost',
    );
  });
});

// ---------------------------------------------------------------------------
// Advance-notice logic
// ---------------------------------------------------------------------------

describe('advance-notice logic', () => {
  it('post-reform: no advance notice for TravellerImport (within allowances)', async () => {
    const record = createRecord({ classification: 'TravellerImport' });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.advanceNoticeInfo.required).toBe(false);
    expect(result.advanceNoticeInfo.deadlineDays).toBeUndefined();
  });

  it('post-reform: requires advance notice for DistanceBuying (before dispatch)', async () => {
    const record = createRecord({ classification: 'DistanceBuying' });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.advanceNoticeInfo.required).toBe(true);
    // The obligation is tied to dispatch, a date the record does not
    // carry — no deadline days may be fabricated from the calculation time.
    expect(result.advanceNoticeInfo.deadlineDays).toBeUndefined();
  });

  it('post-reform: buyer files no advance notice for DistanceSelling', async () => {
    const record = createRecord({ classification: 'DistanceSelling' });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.advanceNoticeInfo.required).toBe(false);
    expect(result.advanceNoticeInfo.deadlineDays).toBeUndefined();
  });

  it('pre-reform record keeps the legacy mapping (TravellerImport 4-day deadline)', async () => {
    const record = createRecord({
      classification: 'TravellerImport',
      calculationTimestamp: '2024-06-15T10:30:00.000Z',
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.advanceNoticeInfo.required).toBe(true);
    expect(result.advanceNoticeInfo.deadlineDays).toBe(4);
  });

  it('produces correctly typed DeclarationAdvanceNoticeInfo for all classifications', async () => {
    const record = createRecord({ id: 1 });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    // Type-level check: advanceNoticeInfo conforms to DeclarationAdvanceNoticeInfo
    const notice: DeclarationAdvanceNoticeInfo = result.advanceNoticeInfo;
    expect(typeof notice.required).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Joint-liability notices (1 Sep 2024 reform)
// ---------------------------------------------------------------------------

describe('liability notices', () => {
  it('DistanceSelling post-reform: buyer jointly liable, files no advance notice', async () => {
    const record = createRecord({ classification: 'DistanceSelling' });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.guidance.liabilityNotice).toEqual({
      classification: 'DistanceSelling',
      buyerMustFileAdvanceNotice: false,
      buyerJointlyLiable: true,
      ruleSetVersion: '2.0-2026.1',
    });
  });

  it('DistanceBuying post-reform: buyer must file an advance notice, no joint liability', async () => {
    const record = createRecord({ classification: 'DistanceBuying' });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.guidance.liabilityNotice).toEqual({
      classification: 'DistanceBuying',
      buyerMustFileAdvanceNotice: true,
      buyerJointlyLiable: false,
      ruleSetVersion: '2.0-2026.1',
    });
  });

  it('TravellerImport post-reform: exempt, no buyer obligations flagged', async () => {
    const record = createRecord({ classification: 'TravellerImport' });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.guidance.liabilityNotice).toEqual({
      classification: 'TravellerImport',
      buyerMustFileAdvanceNotice: false,
      buyerJointlyLiable: false,
      ruleSetVersion: '2.0-2026.1',
    });
  });

  it('pre-reform record: liabilityNotice is null', async () => {
    const record = createRecord({
      classification: 'DistanceSelling',
      calculationTimestamp: '2024-06-15T10:30:00.000Z',
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.guidance.liabilityNotice).toBeNull();
  });

  it('unparseable calculation timestamp: liabilityNotice is null (never guessed)', async () => {
    const record = createRecord({
      classification: 'DistanceSelling',
      calculationTimestamp: 'not-a-timestamp',
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.guidance.liabilityNotice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MyTax link assembly
// ---------------------------------------------------------------------------

describe('MyTax link', () => {
  it('includes the MyTax link in the declaration summary', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(createRecord()),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.myTaxLink).toBe(MYTAX_LINK);
  });

  it('always emits the same constant link regardless of record data', async () => {
    const record1 = createRecord({ id: 1, classification: 'TravellerImport' });
    const record2 = createRecord({ id: 2, classification: 'DistanceBuying', productName: 'Vesi' });
    const queryPort = createMockQueryPort({
      findById: vi.fn()
        .mockResolvedValueOnce(record1)
        .mockResolvedValueOnce(record2),
    });
    const { service } = createService(queryPort);

    const result1 = await service.prepareDeclaration(1);
    const result2 = await service.prepareDeclaration(2);

    expect(result1.myTaxLink).toBe(MYTAX_LINK);
    expect(result2.myTaxLink).toBe(MYTAX_LINK);
    expect(result1.myTaxLink).toBe(result2.myTaxLink);
  });

  it('myTaxLink is a string', async () => {
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(createRecord()),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(typeof result.myTaxLink).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Disclaimer propagation
// ---------------------------------------------------------------------------

describe('disclaimer', () => {
  it('maps Finnish disclaimer from record', async () => {
    const record = createRecord({
      disclaimerText: 'Suomenkielinen teksti',
      disclaimerLanguage: 'fi',
      disclaimerVersion: '3.0.0',
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.disclaimer.text).toBe('Suomenkielinen teksti');
    expect(result.disclaimer.language).toBe('fi');
    expect(result.disclaimer.version).toBe('3.0.0');
  });

  it('maps English disclaimer from record', async () => {
    const record = createRecord({
      disclaimerText: 'English text',
      disclaimerLanguage: 'en',
      disclaimerVersion: '1.0.0',
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.disclaimer.text).toBe('English text');
    expect(result.disclaimer.language).toBe('en');
    expect(result.disclaimer.version).toBe('1.0.0');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles record with zero quantity', async () => {
    const record = createRecord({ quantity: 0 });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.units).toBe(0);
  });

  it('handles record with zero excise values', async () => {
    const record = createRecord({
      alcoholExciseCents: 0,
      containerDutyCents: 0,
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.estimatedExcise.totalCents).toBe(0);
  });

  it('handles very large excise values without overflow', async () => {
    const record = createRecord({
      alcoholExciseCents: 2_147_483_647,
      containerDutyCents: 1_000_000_000,
    });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.estimatedExcise.totalCents).toBe(3_147_483_647);
    expect(result.estimatedExcise.totalCents).toBe(
      result.estimatedExcise.alcoholExciseCents +
        result.estimatedExcise.containerDutyCents,
    );
  });

  it('handles record with null brand', async () => {
    const record = createRecord({ productBrand: null });
    const { service } = createService(
      createMockQueryPort({
        findById: vi.fn().mockResolvedValue(record),
      }),
    );

    const result = await service.prepareDeclaration(1);

    expect(result.product.brand).toBeNull();
  });
});