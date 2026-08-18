/**
 * Tests for CorrectionService — flag creation, listing, and resolution.
 *
 * Exercises the application-layer service with the in-memory repository,
 * covering the full lifecycle: create → list → resolve → error paths.
 *
 * @module CorrectionServiceTest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CorrectionService } from '../correction.service';
import { InMemoryCorrectionRepository } from '../in-memory-correction.repository';
import type { CreateCorrectionDto } from '../correction.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDto(overrides?: Partial<CreateCorrectionDto>): CreateCorrectionDto {
  return {
    targetType: 'calculation',
    targetId: 1,
    reason: 'Price seems too low — possible data entry error',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CorrectionService
// ---------------------------------------------------------------------------

describe('CorrectionService', () => {
  let service: CorrectionService;
  let repository: InMemoryCorrectionRepository;

  beforeEach(() => {
    repository = new InMemoryCorrectionRepository();
    service = new CorrectionService(repository);
  });

  // -----------------------------------------------------------------------
  // createFlag
  // -----------------------------------------------------------------------

  describe('createFlag', () => {
    it('creates a flag and returns it with an assigned id and timestamps', async () => {
      const dto = makeDto();
      const flag = await service.createFlag(dto);

      expect(flag).toMatchObject({
        targetType: 'calculation',
        targetId: 1,
        reason: 'Price seems too low — possible data entry error',
        status: 'open',
        resolution: null,
        resolvedAt: null,
      });
      expect(flag.id).toBeGreaterThanOrEqual(1);
      expect(flag.createdAt).toBeDefined();
      expect(new Date(flag.createdAt).getTime()).not.toBeNaN();
    });

    it('creates flags with auto-incrementing ids', async () => {
      const f1 = await service.createFlag(makeDto({ targetId: 10 }));
      const f2 = await service.createFlag(makeDto({ targetId: 20 }));

      expect(f2.id).toBe(f1.id + 1);
    });

    it('accepts data_point target type', async () => {
      const dto = makeDto({ targetType: 'data_point', targetId: 99, reason: 'Retail price off' });
      const flag = await service.createFlag(dto);

      expect(flag.targetType).toBe('data_point');
      expect(flag.targetId).toBe(99);
      expect(flag.reason).toBe('Retail price off');
    });
  });

  // -----------------------------------------------------------------------
  // listFlags
  // -----------------------------------------------------------------------

  describe('listFlags', () => {
    it('returns an empty list when no flags exist', async () => {
      const response = await service.listFlags();
      expect(response.items).toEqual([]);
      expect(response.total).toBe(0);
    });

    it('returns all created flags, newest first', async () => {
      await service.createFlag(makeDto({ targetId: 1 }));
      await service.createFlag(makeDto({ targetId: 2 }));
      await service.createFlag(makeDto({ targetId: 3 }));

      const response = await service.listFlags();
      expect(response.total).toBe(3);
      expect(response.items).toHaveLength(3);
      // Most recent first
      expect(response.items[0].targetId).toBe(3);
      expect(response.items[1].targetId).toBe(2);
      expect(response.items[2].targetId).toBe(1);
    });

    it('returns both open and resolved flags', async () => {
      const f1 = await service.createFlag(makeDto({ targetId: 1 }));
      await service.createFlag(makeDto({ targetId: 2 }));
      await service.resolveFlag(f1.id, 'Verified — corrected the price');

      const response = await service.listFlags();
      expect(response.total).toBe(2);

      const resolved = response.items.find((f) => f.id === f1.id);
      expect(resolved?.status).toBe('resolved');
    });
  });

  // -----------------------------------------------------------------------
  // resolveFlag
  // -----------------------------------------------------------------------

  describe('resolveFlag', () => {
    it('resolves an open flag and sets resolution fields', async () => {
      const flag = await service.createFlag(makeDto());
      const resolved = await service.resolveFlag(flag.id, 'Confirmed data entry error — corrected');

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution).toBe('Confirmed data entry error — corrected');
      expect(resolved.resolvedAt).not.toBeNull();
      expect(new Date(resolved.resolvedAt!).getTime()).not.toBeNaN();
      // Immutable fields stay unchanged
      expect(resolved.id).toBe(flag.id);
      expect(resolved.targetType).toBe(flag.targetType);
      expect(resolved.targetId).toBe(flag.targetId);
      expect(resolved.createdAt).toBe(flag.createdAt);
    });

    it('throws NotFoundException for a non-existent flag', async () => {
      await expect(service.resolveFlag(999, 'Nope')).rejects.toThrow(
        'Correction flag 999 not found',
      );
    });

    it('accepts null resolution', async () => {
      const flag = await service.createFlag(makeDto());
      const resolved = await service.resolveFlag(flag.id, null as unknown as string);

      expect(resolved.status).toBe('resolved');
      // The repository stores whatever string is passed (null becomes "null" string
      // from the controller or stays null). The service passes through the repository
      // return value, which stores the resolution as-is.
      // In the resolve path, the controller casts null → null, so the resolution
      // argument to resolveFlag is `null`. The repository then stores `null`.
      expect(resolved.resolution).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Integration: lifecycle
  // -----------------------------------------------------------------------

  describe('full lifecycle', () => {
    it('create → list → resolve → list shows resolved status', async () => {
      const flag = await service.createFlag(makeDto({ reason: 'Transport cost anomaly' }));

      let list = await service.listFlags();
      expect(list.total).toBe(1);
      expect(list.items[0].status).toBe('open');

      const resolved = await service.resolveFlag(flag.id, 'Checked — transport cost is correct');

      expect(resolved.status).toBe('resolved');

      list = await service.listFlags();
      expect(list.total).toBe(1);
      expect(list.items[0].status).toBe('resolved');
      expect(list.items[0].resolution).toBe('Checked — transport cost is correct');
    });
  });
});