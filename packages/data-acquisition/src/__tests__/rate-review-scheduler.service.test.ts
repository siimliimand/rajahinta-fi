/**
 * Tests for RateReviewSchedulerService.
 *
 * High-liability coverage:
 *   - Rate-review entry creation (the "never auto-publish" invariant)
 *   - Error handling in createRateUpdateTask (no-op guard)
 *   - Scheduler lifecycle (scheduleNextReview, stopReviews)
 *   - Config-driven discovery toggle (discoveryDisabled)
 *
 * @module RateReviewSchedulerServiceTests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { RateReviewSchedulerService, DEFAULT_RATE_REVIEW_CONFIG, ConfigBackedRateChangeSource } from '../services/rate-review-scheduler.service';
import type { IRateReviewRepository, RateChangeSourcePort } from '../interfaces/rate-review-repository.port';
import type { RateReviewEntry } from '../interfaces/rate-review.types';
import { InMemoryRateReviewRepository } from '../adapters/rate-review-repository.adapter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeRepository(
  overrides?: Partial<IRateReviewRepository>,
): IRateReviewRepository {
  const store = new Map<string, RateReviewEntry>();

  return {
    create: vi.fn().mockImplementation(async (entry: RateReviewEntry) => {
      store.set(entry.id, entry);
    }),
    findById: vi.fn().mockImplementation(async (id: string) => {
      return store.get(id) ?? null;
    }),
    findByStatus: vi.fn().mockImplementation(async (status) => {
      return Array.from(store.values())
        .filter((e) => e.status === status)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }),
    updateStatus: vi.fn().mockImplementation(
      async (id, status, resolution, resolvedAt, reviewerNotes) => {
        const existing = store.get(id);
        if (existing) {
          store.set(id, { ...existing, status, resolution, resolvedAt, reviewerNotes });
        }
      },
    ),
    ...overrides,
  };
}

function createFakeRateChangeSource(
  overrides?: Partial<RateChangeSourcePort>,
): RateChangeSourcePort {
  return {
    checkForChanges: vi.fn().mockResolvedValue({
      checkedAt: new Date().toISOString(),
      newRatesDetected: false,
    }),
    ...overrides,
  };
}

function createService(overrides?: {
  repository?: Partial<IRateReviewRepository>;
  discoveryDisabled?: boolean;
  rateChangeSource?: RateChangeSourcePort;
}): RateReviewSchedulerService {
  const repo = createFakeRepository(overrides?.repository);
  const config = {
    ...DEFAULT_RATE_REVIEW_CONFIG,
    discoveryDisabled: overrides?.discoveryDisabled ?? false,
  };
  const source = overrides?.rateChangeSource ?? createFakeRateChangeSource();
  return new RateReviewSchedulerService(repo, config, source);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RateReviewSchedulerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // checkForRateChanges
  // ---------------------------------------------------------------------------

  describe('checkForRateChanges', () => {
    it('returns a result with checkedAt timestamp', async () => {
      const service = createService();
      const result = await service.checkForRateChanges();

      expect(result).toHaveProperty('checkedAt');
      expect(typeof result.checkedAt).toBe('string');
      expect(result).toHaveProperty('newRatesDetected');
    });

    it('does not include detectedVersions when no new rates found', async () => {
      const service = createService();
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
      expect(result.detectedVersions).toBeUndefined();
    });

    it('includes detectedVersions when rates are detected via custom source', async () => {
      const source = {
        checkForChanges: vi.fn().mockResolvedValue({
          checkedAt: new Date().toISOString(),
          newRatesDetected: true,
          detectedVersions: ['excise-2024-Q1', 'vat-2024'],
        }),
      };
      const service = createService({ rateChangeSource: source });
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(true);
      expect(result.detectedVersions).toEqual(['excise-2024-Q1', 'vat-2024']);
    });

    it('returns newRatesDetected=false when discovery is disabled', async () => {
      const service = createService({ discoveryDisabled: true });
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
    });

    it('returns newRatesDetected=false by default (mock behaviour)', async () => {
      const service = createService();
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
    });

    it('delegates to the injected RateChangeSourcePort', async () => {
      const source = createFakeRateChangeSource();
      const service = createService({ rateChangeSource: source });
      await service.checkForRateChanges();

      expect(source.checkForChanges).toHaveBeenCalledTimes(1);
    });

    it('detects new rates when the source returns newRatesDetected=true', async () => {
      const source = createFakeRateChangeSource({
        checkForChanges: vi.fn().mockResolvedValue({
          checkedAt: new Date().toISOString(),
          newRatesDetected: true,
          reviewId: 'test-source-review-1',
        }),
      });
      const service = createService({ rateChangeSource: source });
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(true);
      expect(result.reviewId).toBe('test-source-review-1');
    });

    it('reports no new rates when the source returns newRatesDetected=false', async () => {
      const source = createFakeRateChangeSource({
        checkForChanges: vi.fn().mockResolvedValue({
          checkedAt: new Date().toISOString(),
          newRatesDetected: false,
        }),
      });
      const service = createService({ rateChangeSource: source });
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // createRateUpdateTask
  // ---------------------------------------------------------------------------

  describe('createRateUpdateTask', () => {
    it('creates a pending review entry when new rates are detected', async () => {
      const service = createService();
      const result = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
      });

      expect(result).toHaveProperty('id');
      expect(result.status).toBe('pending');
      expect(result.description).toContain('manual review required');
      expect(result.source).toBe('vero.fi (simulated check)');
    });

    it('throws when newRatesDetected is false', async () => {
      const service = createService();

      await expect(
        service.createRateUpdateTask({
          checkedAt: new Date().toISOString(),
          newRatesDetected: false,
        }),
      ).rejects.toThrow('Cannot create rate-update task');
    });

    it('uses provided reviewId when present', async () => {
      const service = createService();
      const customId = 'custom-review-id-42';

      const result = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
        reviewId: customId,
      });

      expect(result.id).toBe(customId);
    });

    it('persists the entry via the repository', async () => {
      const repo = createFakeRepository();
      const config = DEFAULT_RATE_REVIEW_CONFIG;
      const service = new RateReviewSchedulerService(repo, config, createFakeRateChangeSource());

      const reviewResult = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
      });

      // Verify the entry was stored
      const stored = await repo.findById(reviewResult.id);
      expect(stored).not.toBeNull();
      expect(stored!.status).toBe('pending');
    });
  });

  // ---------------------------------------------------------------------------
  // Rates NEVER auto-published — verified invariant
  // ---------------------------------------------------------------------------

  describe('never-auto-publish invariant', () => {
    it('createRateUpdateTask always returns pending status', async () => {
      const service = createService();

      const entry = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
      });

      // The invariant: rates only go live after manual confirmation.
      // A "pending" entry means no automated publish path exists.
      expect(entry.status).toBe('pending');
    });

    it('checkForRateChanges never directly applies rate changes', async () => {
      const service = createService();

      // The checkForRateChanges method's contract is observational only:
      // it detects, it does not apply.
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
      expect(result).not.toHaveProperty('ratesApplied');
    });

    it('createRateUpdateTask throws when fed a false result from checkForRateChanges', async () => {
      const service = createService();

      // Integration guard: the output of checkForRateChanges (Phase 1 always
      // returns newRatesDetected=false) must never sneak through to publishing.
      const result = await service.checkForRateChanges();

      await expect(
        service.createRateUpdateTask(result),
      ).rejects.toThrow('Cannot create rate-update task');
    });
  });

  // ---------------------------------------------------------------------------
  // scheduleNextReview / stopReviews
  // ---------------------------------------------------------------------------

  describe('scheduleNextReview / stopReviews', () => {
    it('scheduleNextReview sets up a repeating timer', () => {
      const service = createService();
      const spy = vi.spyOn(global, 'setInterval');

      service.scheduleNextReview();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.any(Function),
        DEFAULT_RATE_REVIEW_CONFIG.checkIntervalMs,
      );
    });

    it('stopReviews clears the active timer', () => {
      const service = createService();
      const clearSpy = vi.spyOn(global, 'clearInterval');

      service.scheduleNextReview();
      service.stopReviews();

      expect(clearSpy).toHaveBeenCalled();
    });

    it('scheduleNextReview is idempotent (clears previous timer)', () => {
      const service = createService();
      const clearSpy = vi.spyOn(global, 'clearInterval');

      service.scheduleNextReview();
      service.scheduleNextReview();

      // First call sets a timer, second call clears it and sets a new one
      expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it('stopReviews is safe when no timer is running', () => {
      const service = createService();

      expect(() => service.stopReviews()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // createVersionedPublicationReview — versioned-publication flow (Task 1.3)
  // ---------------------------------------------------------------------------

  describe('createVersionedPublicationReview', () => {
    it('creates a pending review entry with version label and confirmation metadata', async () => {
      const service = createService();

      const entry = await service.createVersionedPublicationReview(
        'v2.0-2025',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
      );

      expect(entry.status).toBe('pending');
      expect(entry.versionLabel).toBe('v2.0-2025');
      expect(entry.confirmedBy).toBe('Matti Meikäläinen');
      expect(entry.confirmedRole).toBe('Finnish Tax Counsel');
      expect(entry.description).toContain('v2.0-2025');
      expect(entry.source).toBe('vero.fi (legal confirmation)');
      expect(entry.id).toBeTruthy();
      expect(entry.createdAt).toBeTruthy();
    });

    it('creates separate entries for each version', async () => {
      const service = createService();

      const e2025 = await service.createVersionedPublicationReview(
        'v2.0-2025',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
      );
      const e2026 = await service.createVersionedPublicationReview(
        'v3.0-2026',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
      );

      expect(e2025.id).not.toBe(e2026.id);
      expect(e2025.versionLabel).toBe('v2.0-2025');
      expect(e2026.versionLabel).toBe('v3.0-2026');
    });

    it('accepts a custom description', async () => {
      const service = createService();

      const entry = await service.createVersionedPublicationReview(
        'v2.0-2025',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
        'Legal sign-off: v2.0-2025 matches vero.fi publication',
      );

      expect(entry.description).toBe(
        'Legal sign-off: v2.0-2025 matches vero.fi publication',
      );
    });

    it('persists the entry in the repository', async () => {
      const repo = createFakeRepository();
      const config = DEFAULT_RATE_REVIEW_CONFIG;
      const service = new RateReviewSchedulerService(
        repo,
        config,
        createFakeRateChangeSource(),
      );

      const entry = await service.createVersionedPublicationReview(
        'v3.0-2026',
        'Liisa Virtanen',
        'Compliance Officer',
      );

      const stored = await repo.findById(entry.id);
      expect(stored).not.toBeNull();
      expect(stored!.versionLabel).toBe('v3.0-2026');
      expect(stored!.confirmedBy).toBe('Liisa Virtanen');
      expect(stored!.confirmedRole).toBe('Compliance Officer');
      expect(stored!.status).toBe('pending');
    });
  });

  // ---------------------------------------------------------------------------
  // approveReview — pending→resolved transition (Task 1.3)
  // ---------------------------------------------------------------------------

  describe('approveReview', () => {
    it('transitions a pending entry to resolved with approve resolution', async () => {
      const repo = createFakeRepository();
      const config = DEFAULT_RATE_REVIEW_CONFIG;
      const service = new RateReviewSchedulerService(
        repo,
        config,
        createFakeRateChangeSource(),
      );

      const entry = await service.createVersionedPublicationReview(
        'v2.0-2025',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
      );

      const approved = await service.approveReview(
        entry.id,
        'Matti Meikäläinen',
      );

      expect(approved.status).toBe('resolved');
      expect(approved.resolution).toBe('approve');
      expect(approved.resolvedAt).toBeTruthy();
      expect(approved.reviewerNotes).toContain('Approved by Matti Meikäläinen');
      expect(approved.versionLabel).toBe('v2.0-2025');
    });

    it('throws when approving a non-existent entry', async () => {
      const service = createService();

      await expect(
        service.approveReview('non-existent-id', 'Matti Meikäläinen'),
      ).rejects.toThrow('Cannot approve review');
    });

    it('throws when approving an already-resolved entry', async () => {
      const repo = createFakeRepository();
      const config = DEFAULT_RATE_REVIEW_CONFIG;
      const service = new RateReviewSchedulerService(
        repo,
        config,
        createFakeRateChangeSource(),
      );

      const entry = await service.createVersionedPublicationReview(
        'v2.0-2025',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
      );

      await service.approveReview(entry.id, 'Matti Meikäläinen');

      // Second approve call should fail
      await expect(
        service.approveReview(entry.id, 'Matti Meikäläinen'),
      ).rejects.toThrow(/already resolved|Cannot approve/);
    });

    it('appends custom notes to the standard approval message', async () => {
      const repo = createFakeRepository();
      const config = DEFAULT_RATE_REVIEW_CONFIG;
      const service = new RateReviewSchedulerService(
        repo,
        config,
        createFakeRateChangeSource(),
      );

      const entry = await service.createVersionedPublicationReview(
        'v3.0-2026',
        'Liisa Virtanen',
        'Compliance Officer',
      );

      await service.approveReview(
        entry.id,
        'Liisa Virtanen',
        'Intra-year split verified against vero.fi table.',
      );

      const stored = await repo.findById(entry.id);
      expect(stored!.reviewerNotes).toContain('Approved by Liisa Virtanen');
      expect(stored!.reviewerNotes).toContain(
        'Intra-year split verified against vero.fi table.',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Never auto-publish — versioned-publication invariant (Task 1.3)
  // ---------------------------------------------------------------------------

  describe('never-auto-publish — versioned-publication flow', () => {
    it('createVersionedPublicationReview always returns pending status', async () => {
      const service = createService();

      const entry = await service.createVersionedPublicationReview(
        'v2.0-2025',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
      );

      // The invariant: entries start pending; no auto-publish code path.
      expect(entry.status).toBe('pending');
      expect(entry.resolution).toBeUndefined();
      expect(entry.resolvedAt).toBeUndefined();
    });

    it('approveReview must be called explicitly — no side-effect approval', async () => {
      const repo = createFakeRepository();
      const config = DEFAULT_RATE_REVIEW_CONFIG;
      const service = new RateReviewSchedulerService(
        repo,
        config,
        createFakeRateChangeSource(),
      );

      const entry = await service.createVersionedPublicationReview(
        'v2.0-2025',
        'Matti Meikäläinen',
        'Finnish Tax Counsel',
      );

      // Verify the entry is still pending before explicit approve
      const before = await repo.findById(entry.id);
      expect(before!.status).toBe('pending');

      // Only explicit approve transitions to resolved
      await service.approveReview(entry.id, 'Matti Meikäläinen');
      const after = await repo.findById(entry.id);
      expect(after!.status).toBe('resolved');
      expect(after!.resolution).toBe('approve');
    });

    it('createRateUpdateTask does not produce resolved entries (Task 1.3 complement)', async () => {
      const service = createService();

      const entry = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
      });

      // The existing scheduler flow also produces pending-only entries
      expect(entry.status).toBe('pending');
    });
  });

  // ---------------------------------------------------------------------------
  // ConfigBackedRateChangeSource — snapshot-based detection (Task 1.11)
  // ---------------------------------------------------------------------------

  describe('ConfigBackedRateChangeSource snapshot detection', () => {
    /**
     * Helper: create a temporary snapshot file with the given content,
     * create a ConfigBackedRateChangeSource pointing to it, and return
     * both the source and the temp file path (for cleanup).
     */
    async function createSnapshotTestHarness() {
      const tmpDir = await fs.mkdtemp('/tmp/rate-snapshot-test-');
      const snapshotPath = path.join(tmpDir, 'snapshot.json');
      const initialContent = JSON.stringify({
        _note: 'Snapshot baseline — current official 2024/2025/2026 rates',
        versions: {
          'v3.0-2026': { beer: { rate: '36.71', unit: 'snt/cl ethanol' } },
        },
      });
      await fs.writeFile(snapshotPath, initialContent, 'utf-8');

      const repository = new InMemoryRateReviewRepository();
      const source = new ConfigBackedRateChangeSource(snapshotPath, repository);

      return { tmpDir, snapshotPath, repository, source, initialContent };
    }

    it('detects new rates on first check (no prior review entries)', async () => {
      const { source } = await createSnapshotTestHarness();

      const result = await source.checkForChanges();

      expect(result.newRatesDetected).toBe(true);
      expect(result.reviewId).toBeTruthy();
      expect(result.detectedVersions).toBeDefined();
      expect(result.detectedVersions!.length).toBeGreaterThan(0);
      expect(result.detectedVersions![0]).toContain('snapshot-hash:');
    });

    it('returns no changes when snapshot hash matches last review entry', async () => {
      const { source, repository, initialContent } =
        await createSnapshotTestHarness();

      // First check: detects the initial snapshot
      const firstResult = await source.checkForChanges();
      expect(firstResult.newRatesDetected).toBe(true);

      // Create a review entry that records the content hash
      const hash = crypto
        .createHash('sha256')
        .update(initialContent)
        .digest('hex');
      await repository.create({
        id: firstResult.reviewId!,
        createdAt: new Date().toISOString(),
        description: 'First detection',
        source: 'snapshot',
        status: 'pending',
        contentHash: hash,
      });

      // Second check: hash matches → no changes
      const secondResult = await source.checkForChanges();
      expect(secondResult.newRatesDetected).toBe(false);
    });

    it('detects changes when snapshot is updated (simulating 2027 future rates)', async () => {
      const { source, snapshotPath, repository, initialContent } =
        await createSnapshotTestHarness();

      // First check + create entry with current hash
      const firstResult = await source.checkForChanges();
      const firstHash = crypto
        .createHash('sha256')
        .update(initialContent)
        .digest('hex');
      await repository.create({
        id: firstResult.reviewId!,
        createdAt: new Date().toISOString(),
        description: 'Baseline entry',
        source: 'snapshot',
        status: 'pending',
        contentHash: firstHash,
      });

      // Simulate a 2027 future change: update the snapshot with new rates
      const futureContent = JSON.stringify({
        _note: 'Updated snapshot — 2027 proposed rates (future change)',
        versions: {
          'v4.0-2027': { beer: { rate: '37.50', unit: 'snt/cl ethanol' } },
        },
      });
      await fs.writeFile(snapshotPath, futureContent, 'utf-8');

      // Third check: snapshot hash differs → new rates detected
      const thirdResult = await source.checkForChanges();
      expect(thirdResult.newRatesDetected).toBe(true);
      expect(thirdResult.reviewId).toBeTruthy();
      expect(thirdResult.detectedVersions).toBeDefined();
      expect(thirdResult.detectedVersions![0]).not.toContain(
        firstHash.slice(0, 12),
      );

      // Verify: the detected change CAN create a pending review entry
      // (simulating what RateReviewSchedulerService.createRateUpdateTask does)
      const futureHash = crypto
        .createHash('sha256')
        .update(futureContent)
        .digest('hex');
      const reviewEntry: RateReviewEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        description:
          '2027 future rates detected — manual review required before publishing',
        source: 'snapshot (simulated change)',
        status: 'pending',
        contentHash: futureHash,
        versionLabel: 'v4.0-2027',
        confirmedBy: 'test-harness',
        confirmedRole: 'Test Automation',
      };
      await repository.create(reviewEntry);

      // Verify entry is pending (never auto-published)
      const stored = await repository.findById(reviewEntry.id);
      expect(stored).not.toBeNull();
      expect(stored!.status).toBe('pending');
      expect(stored!.resolution).toBeUndefined();
      expect(stored!.versionLabel).toBe('v4.0-2027');
      expect(stored!.contentHash).toBe(futureHash);

      // Cleanup temp directory
      await fs.rm(path.dirname(snapshotPath), { recursive: true, force: true });
    });

    it('degrades gracefully when snapshot file does not exist', async () => {
      const repository = new InMemoryRateReviewRepository();
      const source = new ConfigBackedRateChangeSource(
        '/nonexistent/path/snapshot.json',
        repository,
      );

      const result = await source.checkForChanges();

      // Graceful degradation: no changes reported, no throw
      expect(result.newRatesDetected).toBe(false);
      expect(result.checkedAt).toBeTruthy();
    });
  });
});