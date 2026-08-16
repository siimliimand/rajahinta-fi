/**
 * CorrectionService tests.
 *
 * Verifies:
 *   - flagCalculation looks up the calculation record and creates a flag with
 *     the input snapshot
 *   - flagCalculation throws CalculationNotFoundError for missing records
 *   - flagDataPoint creates a flag without a snapshot for supported entity types
 *   - resolveFlaggedItem transitions an OPEN flag to ACCEPTED or REJECTED
 *   - resolveFlaggedItem throws FlagNotFoundError for non-existent flags
 *   - resolveFlaggedItem throws FlagAlreadyResolvedError for already-resolved flags
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
    it('resolves an OPEN flag as ACCEPTED', async () => {
      const openFlag = createMockFlag({ id: 5, status: 'OPEN' });

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue({
          ...openFlag,
          status: 'ACCEPTED' as const,
          resolvedBy: 'reviewer-1',
          resolution: 'ACCEPTED' as const,
          note: 'Confirmed issue',
        }),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      await service.resolveFlaggedItem(5, 'ACCEPTED', 'reviewer-1', 'Confirmed issue');

      expect(repository.resolve).toHaveBeenCalledWith(5, {
        status: 'ACCEPTED',
        resolvedBy: 'reviewer-1',
        resolution: 'ACCEPTED',
        note: 'Confirmed issue',
      });
    });

    it('resolves an OPEN flag as REJECTED', async () => {
      const openFlag = createMockFlag({ id: 5, status: 'OPEN' });

      const repository: ICorrectionRepository = {
        create: vi.fn(),
        resolve: vi.fn().mockResolvedValue({
          ...openFlag,
          status: 'REJECTED' as const,
          resolvedBy: 'reviewer-1',
          resolution: 'REJECTED' as const,
          note: null,
        }),
        findOpen: vi.fn(),
        findById: vi.fn().mockResolvedValue(openFlag),
      };
      const calculationQuery: ICorrectionCalculationRecordQuery = { findById: vi.fn() };

      const service = new CorrectionService(repository, calculationQuery);

      await service.resolveFlaggedItem(5, 'REJECTED', 'reviewer-1');

      expect(repository.resolve).toHaveBeenCalledWith(5, {
        status: 'REJECTED',
        resolvedBy: 'reviewer-1',
        resolution: 'REJECTED',
        note: null,
      });
    });

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

      await expect(
        service.resolveFlaggedItem(999, 'ACCEPTED', 'reviewer'),
      ).rejects.toMatchObject({ flagId: 999 });

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