/**
 * Tests for ClassificationRuleSetService.
 *
 * High-liability coverage: verifies that every rule-set publication records an
 * immutable audit entry with the correct entityType, action, actor, and
 * rule-set snapshot.
 *
 * @module ClassificationRuleSetServiceTest
 */

import { describe, it, expect, vi } from 'vitest';
import { ClassificationRuleSetService } from '../services/classification-rule-set.service';
import type { IClassificationRuleRepositoryPort } from '../ports/classification-rule-repository.port';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRepository(): IClassificationRuleRepositoryPort {
  return {
    findEffective: vi.fn().mockResolvedValue(null),
    listVersions: vi.fn().mockResolvedValue([]),
    saveRuleSet: vi.fn().mockResolvedValue(undefined),
  };
}

function makePublishInput(overrides?: {
  versionLabel?: string;
  label?: string;
}) {
  return {
    versionLabel: overrides?.versionLabel ?? 'v2.0-2025',
    label: overrides?.label ?? 'Updated Finnish legislation — 2025 edition',
    effectiveFrom: new Date('2025-01-01'),
    effectiveTo: null,
    rules: [
      { name: 'TravellerImport', version: '2.0', description: 'Updated traveller import rules' },
      { name: 'DistanceSelling', version: '2.0', description: 'Updated distance selling rules' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClassificationRuleSetService', () => {
  describe('publishVersion', () => {
    it('persists a rule set via the repository', async () => {
      const repo = createMockRepository();
      const service = new ClassificationRuleSetService(repo);

      const result = await service.publishVersion(
        makePublishInput(),
        'admin@rajahinta.fi',
        'Updated for 2025 legislative changes',
      );

      expect(repo.saveRuleSet).toHaveBeenCalledTimes(1);
      expect(repo.saveRuleSet).toHaveBeenCalledWith(
        expect.objectContaining({ versionLabel: 'v2.0-2025' }),
      );
      expect(result.versionLabel).toBe('v2.0-2025');
    });

    it('records an audit entry when AuditService is provided', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const repo = createMockRepository();
      const service = new ClassificationRuleSetService(repo, mockAuditService);

      await service.publishVersion(
        makePublishInput(),
        'admin@rajahinta.fi',
        'Updated for 2025 legislative changes',
      );

      expect(logChange).toHaveBeenCalledTimes(1);
      expect(logChange).toHaveBeenCalledWith({
        entityType: 'classification_rule',
        entityId: 'v2.0-2025',
        action: 'created',
        author: 'admin@rajahinta.fi',
        reason: 'Updated for 2025 legislative changes',
        newValue: expect.objectContaining({
          versionLabel: 'v2.0-2025',
          ruleCount: 2,
        }),
      });
    });

    it('uses correct entityType for classification_rule', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const repo = createMockRepository();
      const service = new ClassificationRuleSetService(repo, mockAuditService);

      await service.publishVersion(
        makePublishInput({ versionLabel: 'v3.0-2026' }),
        'compliance-officer',
        'New rule set for 2026',
      );

      expect(logChange).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'classification_rule',
          entityId: 'v3.0-2026',
          author: 'compliance-officer',
        }),
      );
    });

    it('supports system actor for automated publication', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const repo = createMockRepository();
      const service = new ClassificationRuleSetService(repo, mockAuditService);

      await service.publishVersion(
        makePublishInput(),
        'system',
        'Automated rule-set sync via legislation tracker',
      );

      expect(logChange).toHaveBeenCalledWith(
        expect.objectContaining({
          author: 'system',
        }),
      );
    });

    it('skips audit silently when AuditService is not injected', async () => {
      const repo = createMockRepository();
      const service = new ClassificationRuleSetService(repo);

      const result = await service.publishVersion(
        makePublishInput(),
        'admin@rajahinta.fi',
        'Test publication',
      );

      expect(repo.saveRuleSet).toHaveBeenCalledTimes(1);
      expect(result.versionLabel).toBe('v2.0-2025');
    });

    it('includes effectiveFrom/effectiveTo in audit newValue', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const repo = createMockRepository();
      const service = new ClassificationRuleSetService(repo, mockAuditService);

      await service.publishVersion(
        makePublishInput({
          versionLabel: 'v1.0-2024',
          label: 'Current legislation — pre-Sep 2024',
        }),
        'legal-team',
        'Initial rule set',
      );

      expect(logChange).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({
            versionLabel: 'v1.0-2024',
            effectiveFrom: expect.any(String),
            effectiveTo: null,
          }),
        }),
      );
    });
  });
});