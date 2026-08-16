/**
 * CorrectionService tests.
 *
 * Verifies:
 *   - flagCalculation looks up the calculation record and creates a flag with
 *     the input snapshot
 *   - flagCalculation throws CalculationNotFoundError for missing records
 *   - flagDataPoint creates a flag without a snapshot for supported entity types
 *   - resolveFlaggedItem returns FlagResolutionDetail with the correct action:
 *     - ACCEPTED + calculation flag → recalculation action with links
 *     - ACCEPTED + data point flag → dataset_fix action
 *     - REJECTED → note_only action
 *   - resolveFlaggedItem throws FlagNotFoundError / FlagAlreadyResolvedError
 *   - listOpenFlags returns only OPEN flags from the repository
 */

import { describe, it, expect, vi } from 'vitest';
import { CorrectionService } from '../correction.service';
import type {
  ICorrectionRepository,
  ICorrectionCalculationRecordQuery,
} from '../correction-repository.port';
import type { FlaggedItem } from '../correction.types';
import {
  CalculationNotFoundError,
  FlagNotFoundError,
  FlagAlreadyResolvedError,
} from '../correction.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-16T12:00:00Z');

function createMockFlag(overrides: Partial<FlaggedItem> = {}): FlaggedItem {
  return {
    id: 1,
    targetType: 'calculation',
    targetId: 42,
    reason: 'Test flag',
    status: 'OPEN',
    flaggedBy: 'user-1',
    createdAt: NOW,
    resolvedBy: null,
    resolution: null,
    note: null,
    inputSnapshot: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CorrectionService', () => {
  // -----------------------------------------------------------------------
  // flagCalculation
  // -----------------------------------------------------------------------

  describe('flagCalculation', () => {
    it('looks up the calculation record and creates a flag with input snapshot', async () => {
      const mockRecord = { id: 42, totalCents: 1500 };
      const mockFlag = createMockFlag({
        id: 10,
        targetId: 42,
        inputSnapshot: mockRecord,
      });

      const repository: ICorrectionRepository = {
        create: vi.fn().mockResolvedValue(mockFlag),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn(),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = {
        findById: vi.fn().mockResolvedValue(mockRecord),
      };

      const service = new CorrectionService(repository, calculationQuery);

      const result = await service.flagCalculation(42, 'Price seems wrong', 'staff-1');

      expect(calculationQuery.findById).toHaveBeenCalledWith(42);
      expect(repository.create).toHaveBeenCalledWith({
        targetType: 'calculation',
        targetId: 42,
        reason: 'Price seems wrong',
        flaggedBy: 'staff-1',
        inputSnapshot: mockRecord,
      });
      expect(result).toEqual(mockFlag);
    });

    it('throws CalculationNotFoundError when the calculation record does not exist', async () => {
      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn(),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = {
        findById: vi.fn().mockResolvedValue(null),
      };

      const service = new CorrectionService(repository, calculationQuery);

      await expect(
        service.flagCalculation(999, 'Missing record', 'user-1'),
      ).rejects.toThrow(CalculationNotFoundError);

      await expect(
        service.flagCalculation(999, 'Missing record', 'user-1'),
      ).rejects.toMatchObject({
        calculationRecordId: 999,
      });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('propagates repository errors', async () => {
      const repository: ICorrectionRepository = {
        create: vi.fn().mockRejectedValue(new Error('DB timeout')),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn(),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = {
        findById: vi.fn().mockResolvedValue({ id: 1 }),
      };

      const service = new CorrectionService(repository, calculationQuery);

      await expect(
        service.flagCalculation(1, 'Test', 'user-1'),
      ).rejects.toThrow('DB timeout');
    });
  });

  // -----------------------------------------------------------------------
  // flagDataPoint
  // -----------------------------------------------------------------------

  describe('flagDataPoint', () => {
    it.each([
      ['product' as const, 101],
      ['retailOffer' as const, 202],
      ['transportOffer' as const, 303],
      ['taxRule' as const, 404],
    ])('creates an OPEN flag for %s %i', async (entityType, entityId) => {
      const mockFlag = createMockFlag({
        id: 20,
        targetType: entityType,
        targetId: entityId,
        inputSnapshot: null,
      });

      const repository: ICorrectionRepository = {
        create: vi.fn().mockResolvedValue(mockFlag),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn(),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = {
        findById: vi.fn(),
      };

      const service = new CorrectionService(repository, calculationQuery);

      const result = await service.flagDataPoint(
        entityType,
        entityId,
        'Data issue',
        'staff-2',
      );

      expect(repository.create).toHaveBeenCalledWith({
        targetType: entityType,
        targetId: entityId,
        reason: 'Data issue',
        flaggedBy: 'staff-2',
        inputSnapshot: null,
      });
      expect(result).toEqual(mockFlag);
    });

    it('does not query any calculation record for data-point flags', async () => {
      const repository: ICorrectionRepository = {
        create: vi.fn().mockResolvedValue(createMockFlag({ targetType: 'product', targetId: 1 })),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn(),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = {
        findById: vi.fn(),
      };

      const service = new CorrectionService(repository, calculationQuery);

      await service.flagDataPoint('product', 1, 'Test', 'user');

      expect(calculationQuery.findById).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // resolveFlaggedItem
  // -----------------------------------------------------------------------

  describe('resolveFlaggedItem', () => {
    // -- Existence / state guards -----------------------------------------

    it('throws FlagNotFoundError when the flag does not exist', async () => {
      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(null),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      await expect(
        service.resolveFlaggedItem(999, 'ACCEPTED', 'reviewer'),
      ).rejects.toThrow(FlagNotFoundError);

      expect(repository.resolve).not.toHaveBeenCalled();
    });

    it('throws FlagAlreadyResolvedError when flag is already ACCEPTED', async () => {
      const acceptedFlag = createMockFlag({
        id: 5,
        status: 'ACCEPTED',
        resolvedBy: 'reviewer-1',
        resolution: 'ACCEPTED',
        note: 'Done',
      });

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(acceptedFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      await expect(
        service.resolveFlaggedItem(5, 'REJECTED', 'reviewer-2'),
      ).rejects.toThrow(FlagAlreadyResolvedError);

      await expect(
        service.resolveFlaggedItem(5, 'REJECTED', 'reviewer-2'),
      ).rejects.toMatchObject({ flagId: 5, currentStatus: 'ACCEPTED' });

      expect(repository.resolve).not.toHaveBeenCalled();
    });

    it('throws FlagAlreadyResolvedError when flag is already REJECTED', async () => {
      const rejectedFlag = createMockFlag({
        id: 5,
        status: 'REJECTED',
        resolvedBy: 'reviewer-1',
        resolution: 'REJECTED',
      });

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn(),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(rejectedFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      await expect(
        service.resolveFlaggedItem(5, 'ACCEPTED', 'reviewer-2'),
      ).rejects.toThrow(FlagAlreadyResolvedError);
    });

    // -- ACCEPTED + calculation flag → recalculation ----------------------

    it('resolves ACCEPTED calculation flag with recalculation action', async () => {
      const openFlag = createMockFlag({ id: 5, targetType: 'calculation', targetId: 99, status: 'OPEN' });
      const resolvedFlag: FlaggedItem = {
        ...openFlag,
        status: 'ACCEPTED',
        resolvedBy: 'reviewer-1',
        resolution: 'ACCEPTED',
        note: 'Recalculate this',
      };

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue(resolvedFlag),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const detail = await service.resolveFlaggedItem(5, 'ACCEPTED', 'reviewer-1', 'Recalculate this');

      expect(repository.resolve).toHaveBeenCalledWith(5, {
        status: 'ACCEPTED',
        resolvedBy: 'reviewer-1',
        resolution: 'ACCEPTED',
        note: 'Recalculate this',
      });

      expect(detail.flag).toEqual(resolvedFlag);
      expect(detail.action).toEqual({
        type: 'recalculation',
        description: 'Recalculate this',
        linksToCalculationRecords: [99],
      });
    });

    it('resolves ACCEPTED calculation flag without a note using default description', async () => {
      const openFlag = createMockFlag({ id: 5, targetType: 'calculation', targetId: 99, status: 'OPEN' });
      const resolvedFlag: FlaggedItem = {
        ...openFlag,
        status: 'ACCEPTED',
        resolvedBy: 'reviewer-1',
        resolution: 'ACCEPTED',
        note: null,
      };

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue(resolvedFlag),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const detail = await service.resolveFlaggedItem(5, 'ACCEPTED', 'reviewer-1');

      expect(detail.action.type).toBe('recalculation');
      expect(detail.action.description).toContain('recalculation needed');
      expect(detail.action.linksToCalculationRecords).toEqual([99]);
    });

    // -- ACCEPTED + data point flag → dataset_fix ------------------------

    it.each([
      ['product' as const, 101],
      ['retailOffer' as const, 202],
      ['transportOffer' as const, 303],
      ['taxRule' as const, 404],
    ])('resolves ACCEPTED %s flag with dataset_fix action', async (entityType, entityId) => {
      const openFlag = createMockFlag({ id: 10, targetType: entityType, targetId: entityId, status: 'OPEN' });
      const resolvedFlag: FlaggedItem = {
        ...openFlag,
        status: 'ACCEPTED',
        resolvedBy: 'reviewer-1',
        resolution: 'ACCEPTED',
        note: 'Fix the price',
      };

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue(resolvedFlag),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const detail = await service.resolveFlaggedItem(10, 'ACCEPTED', 'reviewer-1', 'Fix the price');

      expect(detail.flag).toEqual(resolvedFlag);
      expect(detail.action).toEqual({
        type: 'dataset_fix',
        description: 'Fix the price',
        linksToCalculationRecords: [],
      });
    });

    it('resolves ACCEPTED data-point flag without a note using default description', async () => {
      const openFlag = createMockFlag({ id: 10, targetType: 'product', targetId: 55, status: 'OPEN' });
      const resolvedFlag: FlaggedItem = {
        ...openFlag,
        status: 'ACCEPTED',
        resolvedBy: 'reviewer-1',
        resolution: 'ACCEPTED',
        note: null,
      };

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue(resolvedFlag),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const detail = await service.resolveFlaggedItem(10, 'ACCEPTED', 'reviewer-1');

      expect(detail.action.type).toBe('dataset_fix');
      expect(detail.action.description).toContain('product');
      expect(detail.action.description).toContain('55');
      expect(detail.action.linksToCalculationRecords).toEqual([]);
    });

    // -- REJECTED → note_only -------------------------------------------

    it('resolves REJECTED flag with note_only action using the provided note', async () => {
      const openFlag = createMockFlag({ id: 5, status: 'OPEN' });
      const resolvedFlag: FlaggedItem = {
        ...openFlag,
        status: 'REJECTED',
        resolvedBy: 'reviewer-1',
        resolution: 'REJECTED',
        note: 'False alarm — data verified correct',
      };

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue(resolvedFlag),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const detail = await service.resolveFlaggedItem(
        5,
        'REJECTED',
        'reviewer-1',
        'False alarm — data verified correct',
      );

      expect(detail.flag).toEqual(resolvedFlag);
      expect(detail.action).toEqual({
        type: 'note_only',
        description: 'False alarm — data verified correct',
        linksToCalculationRecords: [],
      });
    });

    it('resolves REJECTED flag without a note using a fallback description', async () => {
      const openFlag = createMockFlag({ id: 5, status: 'OPEN' });
      const resolvedFlag: FlaggedItem = {
        ...openFlag,
        status: 'REJECTED',
        resolvedBy: 'reviewer-1',
        resolution: 'REJECTED',
        note: null,
      };

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue(resolvedFlag),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const detail = await service.resolveFlaggedItem(5, 'REJECTED', 'reviewer-1');

      expect(detail.action.type).toBe('note_only');
      expect(detail.action.description).toBeTruthy();
      expect(detail.action.linksToCalculationRecords).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // listOpenFlags
  // -----------------------------------------------------------------------

  describe('listOpenFlags', () => {
    it('returns open flags from the repository', async () => {
      const openFlags = [
        createMockFlag({ id: 1, targetType: 'calculation', targetId: 10 }),
        createMockFlag({ id: 2, targetType: 'product', targetId: 20 }),
      ];

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn(),
        findOpen: vi.fn().mockResolvedValue(openFlags),
        findById: vi.fn(),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const result = await service.listOpenFlags();

      expect(repository.findOpen).toHaveBeenCalledOnce();
      expect(result).toEqual(openFlags);
    });

    it('returns an empty array when no flags are open', async () => {
      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn(),
        findOpen: vi.fn().mockResolvedValue([]),
        findById: vi.fn(),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      const result = await service.listOpenFlags();

      expect(result).toEqual([]);
    });
  });
});