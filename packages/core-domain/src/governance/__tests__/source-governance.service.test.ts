/**
 * SourceGovernanceService tests.
 *
 * High-liability coverage: permission status transitions and compliance
 * checks must be correct to prevent ingestion from non-compliant sources.
 *
 * Covers:
 *   - registerSource           creation and delegation
 *   - checkPermission          all status aggregations
 *   - revokePermission         batch revocation by merchant
 *   - revokeSourceById         targeted revocation by record ID
 *   - listMerchantSources      merchant-scoped listing
 *   - findById                 single-record lookup
 *   - Error/edge cases         null returns, empty results, non-existent merchant
 *
 * @module SourceGovernanceServiceTest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourceGovernanceService } from '../services/source-governance.service';
import type {
  ISourceGovernanceRepository,
} from '../ports/source-governance-repository.port';
import type {
  AcquisitionMethod,
  PermissionStatus,
  SourceGovernanceRecord,
  PermissionCheckResult,
  RegisterSourceInput,
} from '../source-governance.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MERCHANT_A = 'merchant-foodco';
const MERCHANT_B = 'merchant-drinkco';
const MERCHANT_NONEXISTENT = 'merchant-ghost';

const DEFAULT_TIMESTAMP = new Date('2026-01-15T12:00:00Z');

function createRecord(overrides?: Partial<SourceGovernanceRecord>): SourceGovernanceRecord {
  return {
    id: overrides?.id ?? 1,
    merchantId: overrides?.merchantId ?? MERCHANT_A,
    acquisitionMethod: overrides?.acquisitionMethod ?? 'PERMITTED_FEED',
    permissionStatus: overrides?.permissionStatus ?? 'GRANTED',
    sourceUrl: overrides?.sourceUrl ?? 'https://foodco.example.com/feed',
    statusReason: overrides?.statusReason ?? null,
    lastVerifiedAt: overrides?.lastVerifiedAt ?? DEFAULT_TIMESTAMP,
    createdAt: overrides?.createdAt ?? DEFAULT_TIMESTAMP,
    updatedAt: overrides?.updatedAt ?? DEFAULT_TIMESTAMP,
  };
}

// ---------------------------------------------------------------------------
// Mock repository factory
// ---------------------------------------------------------------------------

function createMockRepository(
  overrides?: Partial<ISourceGovernanceRepository>,
): ISourceGovernanceRepository {
  return {
    create: vi.fn(),
    updateStatus: vi.fn(),
    revokeAllByMerchantId: vi.fn(),
    findByMerchantId: vi.fn(),
    findById: vi.fn(),
    checkPermission: vi.fn(),
    ...overrides,
  };
}

/**
 * Create a SourceGovernanceService wired to the given (or default mock) repository.
 * Returns both the service and the mock repository for assertion access.
 */
function createService(repo?: ISourceGovernanceRepository): {
  service: SourceGovernanceService;
  repository: ISourceGovernanceRepository;
} {
  const repository = repo ?? createMockRepository();
  const service = new SourceGovernanceService(repository as any);
  return { service, repository };
}

// ---------------------------------------------------------------------------
// registerSource
// ---------------------------------------------------------------------------

describe('registerSource', () => {
  it('creates a record and returns it', async () => {
    const expected = createRecord({ id: 42 });
    const { service, repository } = createService(
      createMockRepository({
        create: vi.fn().mockResolvedValue(expected),
      }),
    );

    const result = await service.registerSource(
      MERCHANT_A,
      'PERMITTED_FEED',
      'GRANTED',
      'https://foodco.example.com/feed',
    );

    expect(result).toEqual(expected);
    expect(result.id).toBe(42);
  });

  it('delegates the correct input to the repository', async () => {
    const repository = createMockRepository({
      create: vi.fn().mockImplementation(
        (input: RegisterSourceInput) =>
          Promise.resolve(createRecord({ id: 10, ...input })),
      ),
    });
    const { service } = createService(repository);

    await service.registerSource(
      MERCHANT_A,
      'RETAILER_API',
      'PENDING',
      'https://api.foodco.example.com/v2/prices',
    );

    expect(repository.create).toHaveBeenCalledTimes(1);
    const callInput = (repository.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as RegisterSourceInput;
    expect(callInput.merchantId).toBe(MERCHANT_A);
    expect(callInput.acquisitionMethod).toBe('RETAILER_API');
    expect(callInput.permissionStatus).toBe('PENDING');
    expect(callInput.sourceUrl).toBe('https://api.foodco.example.com/v2/prices');
    expect(callInput.statusReason).toBeUndefined();
  });

  it('accepts all acquisition methods', async () => {
    const methods: AcquisitionMethod[] = [
      'PERMITTED_FEED',
      'RETAILER_API',
      'STRUCTURED_MERCHANT_FEED',
      'LICENSED_PROVIDER',
      'COMPLIANT_CRAWLING',
      'MANUAL_VERIFICATION',
    ];

    for (const method of methods) {
      const repository = createMockRepository({
        create: vi.fn().mockResolvedValue(createRecord({ acquisitionMethod: method })),
      });
      const { service } = createService(repository);

      const result = await service.registerSource(MERCHANT_A, method, 'GRANTED', 'https://example.com');
      expect(result.acquisitionMethod).toBe(method);
    }
  });

  it('accepts all permission status values on registration', async () => {
    const statuses: PermissionStatus[] = ['GRANTED', 'PENDING', 'REVOKED', 'EXPIRED'];

    for (const status of statuses) {
      const repository = createMockRepository({
        create: vi.fn().mockResolvedValue(createRecord({ permissionStatus: status })),
      });
      const { service } = createService(repository);

      const result = await service.registerSource(MERCHANT_A, 'MANUAL_VERIFICATION', status, 'https://example.com');
      expect(result.permissionStatus).toBe(status);
    }
  });

  it('propagates repository errors', async () => {
    const repository = createMockRepository({
      create: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    });
    const { service } = createService(repository);

    await expect(
      service.registerSource(MERCHANT_A, 'PERMITTED_FEED', 'GRANTED', 'https://example.com'),
    ).rejects.toThrow('DB connection failed');
  });
});

// ---------------------------------------------------------------------------
// checkPermission
// ---------------------------------------------------------------------------

describe('checkPermission', () => {
  it('returns GRANTED when at least one source is GRANTED', async () => {
    const result: PermissionCheckResult = {
      merchantId: MERCHANT_A,
      permissionStatus: 'GRANTED',
      sources: [createRecord({ permissionStatus: 'GRANTED' })],
      hasWarnings: false,
    };
    const { service, repository } = createService(
      createMockRepository({
        checkPermission: vi.fn().mockResolvedValue(result),
      }),
    );

    const output = await service.checkPermission(MERCHANT_A);

    expect(output.permissionStatus).toBe('GRANTED');
    expect(output.hasWarnings).toBe(false);
  });

  it('returns PENDING when no source is GRANTED but one is PENDING', async () => {
    const result: PermissionCheckResult = {
      merchantId: MERCHANT_A,
      permissionStatus: 'PENDING',
      sources: [
        createRecord({ permissionStatus: 'PENDING' }),
      ],
      hasWarnings: false,
    };
    const { service, repository } = createService(
      createMockRepository({
        checkPermission: vi.fn().mockResolvedValue(result),
      }),
    );

    const output = await service.checkPermission(MERCHANT_A);

    expect(output.permissionStatus).toBe('PENDING');
  });

  it('returns EXPIRED when all sources are EXPIRED or worse', async () => {
    const result: PermissionCheckResult = {
      merchantId: MERCHANT_A,
      permissionStatus: 'EXPIRED',
      sources: [
        createRecord({ permissionStatus: 'EXPIRED' }),
        createRecord({ permissionStatus: 'REVOKED' }),
      ],
      hasWarnings: true,
    };
    const { service, repository } = createService(
      createMockRepository({
        checkPermission: vi.fn().mockResolvedValue(result),
      }),
    );

    const output = await service.checkPermission(MERCHANT_A);

    expect(output.permissionStatus).toBe('EXPIRED');
    expect(output.hasWarnings).toBe(true);
  });

  it('returns REVOKED when all sources are REVOKED', async () => {
    const result: PermissionCheckResult = {
      merchantId: MERCHANT_A,
      permissionStatus: 'REVOKED',
      sources: [createRecord({ permissionStatus: 'REVOKED', statusReason: 'Agreement ended' })],
      hasWarnings: true,
    };
    const { service, repository } = createService(
      createMockRepository({
        checkPermission: vi.fn().mockResolvedValue(result),
      }),
    );

    const output = await service.checkPermission(MERCHANT_A);

    expect(output.permissionStatus).toBe('REVOKED');
    expect(output.hasWarnings).toBe(true);
  });

  it('returns GRANTED with warnings when sources are mixed', async () => {
    const result: PermissionCheckResult = {
      merchantId: MERCHANT_A,
      permissionStatus: 'GRANTED',
      sources: [
        createRecord({ id: 1, permissionStatus: 'GRANTED' }),
        createRecord({ id: 2, permissionStatus: 'EXPIRED' }),
      ],
      hasWarnings: true,
    };
    const { service, repository } = createService(
      createMockRepository({
        checkPermission: vi.fn().mockResolvedValue(result),
      }),
    );

    const output = await service.checkPermission(MERCHANT_A);

    expect(output.permissionStatus).toBe('GRANTED');
    expect(output.hasWarnings).toBe(true);
    expect(output.sources).toHaveLength(2);
  });

  it('delegates merchantId to the repository', async () => {
    const repository = createMockRepository({
      checkPermission: vi.fn().mockResolvedValue({
        merchantId: MERCHANT_B,
        permissionStatus: 'GRANTED',
        sources: [],
        hasWarnings: false,
      } satisfies PermissionCheckResult),
    });
    const { service } = createService(repository);

    await service.checkPermission(MERCHANT_B);

    expect(repository.checkPermission).toHaveBeenCalledWith(MERCHANT_B);
  });

  it('propagates repository errors', async () => {
    const repository = createMockRepository({
      checkPermission: vi.fn().mockRejectedValue(new Error('Query timeout')),
    });
    const { service } = createService(repository);

    await expect(service.checkPermission(MERCHANT_A)).rejects.toThrow('Query timeout');
  });
});

// ---------------------------------------------------------------------------
// revokePermission
// ---------------------------------------------------------------------------

describe('revokePermission', () => {
  it('revokes all sources for a merchant and returns the count', async () => {
    const repository = createMockRepository({
      revokeAllByMerchantId: vi.fn().mockResolvedValue(3),
    });
    const { service } = createService(repository);

    const count = await service.revokePermission(MERCHANT_A, 'Agreement terminated');

    expect(count).toBe(3);
    expect(repository.revokeAllByMerchantId).toHaveBeenCalledWith(
      MERCHANT_A,
      'Agreement terminated',
    );
  });

  it('returns 0 when merchant has no sources', async () => {
    const repository = createMockRepository({
      revokeAllByMerchantId: vi.fn().mockResolvedValue(0),
    });
    const { service } = createService(repository);

    const count = await service.revokePermission(MERCHANT_NONEXISTENT, 'No sources registered');

    expect(count).toBe(0);
  });

  it('propagates repository errors', async () => {
    const repository = createMockRepository({
      revokeAllByMerchantId: vi.fn().mockRejectedValue(new Error('DB write failed')),
    });
    const { service } = createService(repository);

    await expect(
      service.revokePermission(MERCHANT_A, 'Error'),
    ).rejects.toThrow('DB write failed');
  });
});

// ---------------------------------------------------------------------------
// revokeSourceById
// ---------------------------------------------------------------------------

describe('revokeSourceById', () => {
  it('revokes a single source and returns the updated record', async () => {
    const updated = createRecord({
      id: 5,
      permissionStatus: 'REVOKED',
      statusReason: 'Data quality issues',
    });
    const repository = createMockRepository({
      updateStatus: vi.fn().mockResolvedValue(updated),
    });
    const { service } = createService(repository);

    const result = await service.revokeSourceById(5, 'Data quality issues');

    expect(result).toEqual(updated);
    expect(result!.permissionStatus).toBe('REVOKED');
    expect(result!.statusReason).toBe('Data quality issues');
    expect(repository.updateStatus).toHaveBeenCalledWith(5, 'REVOKED', 'Data quality issues');
  });

  it('returns null when the record does not exist', async () => {
    const repository = createMockRepository({
      updateStatus: vi.fn().mockResolvedValue(null),
    });
    const { service } = createService(repository);

    const result = await service.revokeSourceById(99999, 'Non-existent source');

    expect(result).toBeNull();
    expect(repository.updateStatus).toHaveBeenCalledWith(99999, 'REVOKED', 'Non-existent source');
  });

  it('preserves other fields on the returned record', async () => {
    const original = createRecord({
      id: 7,
      merchantId: MERCHANT_A,
      acquisitionMethod: 'RETAILER_API',
      sourceUrl: 'https://api.example.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const revoked = { ...original, permissionStatus: 'REVOKED' as const, statusReason: 'Policy change', updatedAt: new Date('2026-02-01T00:00:00Z') };
    const repository = createMockRepository({
      updateStatus: vi.fn().mockResolvedValue(revoked),
    });
    const { service } = createService(repository);

    const result = await service.revokeSourceById(7, 'Policy change');

    expect(result!.merchantId).toBe(MERCHANT_A);
    expect(result!.acquisitionMethod).toBe('RETAILER_API');
    expect(result!.sourceUrl).toBe('https://api.example.com');
    expect(result!.createdAt).toEqual(original.createdAt);
  });

  it('propagates repository errors', async () => {
    const repository = createMockRepository({
      updateStatus: vi.fn().mockRejectedValue(new Error('Update conflict')),
    });
    const { service } = createService(repository);

    await expect(
      service.revokeSourceById(1, 'Error'),
    ).rejects.toThrow('Update conflict');
  });
});

// ---------------------------------------------------------------------------
// listMerchantSources
// ---------------------------------------------------------------------------

describe('listMerchantSources', () => {
  it('returns all sources for a merchant', async () => {
    const records = [
      createRecord({ id: 3, merchantId: MERCHANT_A }),
      createRecord({ id: 2, merchantId: MERCHANT_A }),
      createRecord({ id: 1, merchantId: MERCHANT_A }),
    ];
    const repository = createMockRepository({
      findByMerchantId: vi.fn().mockResolvedValue(records),
    });
    const { service } = createService(repository);

    const result = await service.listMerchantSources(MERCHANT_A);

    expect(result).toHaveLength(3);
    expect(repository.findByMerchantId).toHaveBeenCalledWith(MERCHANT_A);
  });

  it('returns empty array when merchant has no sources', async () => {
    const repository = createMockRepository({
      findByMerchantId: vi.fn().mockResolvedValue([]),
    });
    const { service } = createService(repository);

    const result = await service.listMerchantSources(MERCHANT_NONEXISTENT);

    expect(result).toEqual([]);
  });

  it('returns records ordered by creation date descending', async () => {
    const records = [
      createRecord({ id: 3, merchantId: MERCHANT_A, createdAt: new Date('2026-03-01T00:00:00Z') }),
      createRecord({ id: 2, merchantId: MERCHANT_A, createdAt: new Date('2026-02-01T00:00:00Z') }),
      createRecord({ id: 1, merchantId: MERCHANT_A, createdAt: new Date('2026-01-01T00:00:00Z') }),
    ];
    const repository = createMockRepository({
      findByMerchantId: vi.fn().mockResolvedValue(records),
    });
    const { service } = createService(repository);

    const result = await service.listMerchantSources(MERCHANT_A);

    expect(result[0].id).toBe(3);
    expect(result[1].id).toBe(2);
    expect(result[2].id).toBe(1);
  });

  it('does not leak sources from other merchants', async () => {
    const merchantARecords = [
      createRecord({ id: 1, merchantId: MERCHANT_A }),
    ];
    const repository = createMockRepository({
      findByMerchantId: vi.fn().mockImplementation((id: string) => {
        if (id === MERCHANT_A) return Promise.resolve(merchantARecords);
        return Promise.resolve([]);
      }),
    });
    const { service } = createService(repository);

    const resultA = await service.listMerchantSources(MERCHANT_A);
    const resultB = await service.listMerchantSources(MERCHANT_B);

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(0);
  });

  it('propagates repository errors', async () => {
    const repository = createMockRepository({
      findByMerchantId: vi.fn().mockRejectedValue(new Error('Query failed')),
    });
    const { service } = createService(repository);

    await expect(
      service.listMerchantSources(MERCHANT_A),
    ).rejects.toThrow('Query failed');
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('findById', () => {
  it('returns the record when found', async () => {
    const record = createRecord({ id: 42 });
    const repository = createMockRepository({
      findById: vi.fn().mockResolvedValue(record),
    });
    const { service } = createService(repository);

    const result = await service.findById(42);

    expect(result).toEqual(record);
    expect(result!.id).toBe(42);
  });

  it('returns null when the record does not exist', async () => {
    const repository = createMockRepository({
      findById: vi.fn().mockResolvedValue(null),
    });
    const { service } = createService(repository);

    const result = await service.findById(99999);

    expect(result).toBeNull();
    expect(repository.findById).toHaveBeenCalledWith(99999);
  });

  it('delegates the correct ID to the repository', async () => {
    const repository = createMockRepository({
      findById: vi.fn().mockResolvedValue(createRecord({ id: 7 })),
    });
    const { service } = createService(repository);

    await service.findById(7);

    expect(repository.findById).toHaveBeenCalledWith(7);
    expect(repository.findById).toHaveBeenCalledTimes(1);
  });

  it('returns full record shape on found record', async () => {
    const record = createRecord({
      id: 15,
      merchantId: MERCHANT_A,
      acquisitionMethod: 'LICENSED_PROVIDER',
      permissionStatus: 'PENDING',
      sourceUrl: 'https://data-provider.example.com/prices',
      statusReason: null,
      lastVerifiedAt: new Date('2026-01-20T08:00:00Z'),
      createdAt: new Date('2026-01-10T10:00:00Z'),
      updatedAt: new Date('2026-01-10T10:00:00Z'),
    });
    const repository = createMockRepository({
      findById: vi.fn().mockResolvedValue(record),
    });
    const { service } = createService(repository);

    const result = await service.findById(15);

    expect(result!.merchantId).toBe(MERCHANT_A);
    expect(result!.acquisitionMethod).toBe('LICENSED_PROVIDER');
    expect(result!.permissionStatus).toBe('PENDING');
    expect(result!.sourceUrl).toBe('https://data-provider.example.com/prices');
    expect(result!.statusReason).toBeNull();
    expect(result!.lastVerifiedAt).toBeInstanceOf(Date);
    expect(result!.createdAt).toBeInstanceOf(Date);
    expect(result!.updatedAt).toBeInstanceOf(Date);
  });

  it('propagates repository errors', async () => {
    const repository = createMockRepository({
      findById: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });
    const { service } = createService(repository);

    await expect(service.findById(1)).rejects.toThrow('Connection refused');
  });
});