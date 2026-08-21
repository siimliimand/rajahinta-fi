/**
 * Tests for RankingConfigService.
 *
 * High-liability coverage: every config change records an immutable audit
 * entry with before/after snapshots and the correct actor identity.
 *
 * @module RankingConfigServiceTest
 */

import { describe, it, expect, vi } from 'vitest';
import { RankingConfigService, DEFAULT_RANKING_CONFIG } from '../ranking-config.service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RankingConfigService', () => {
  describe('getConfig', () => {
    it('returns the Phase 1 default configuration', () => {
      const service = new RankingConfigService();
      const config = service.getConfig();

      expect(config.methodologyVersion).toBe('1.0');
      expect(config.enabledSortOrders).toContain('LOWEST_LANDED_COST');
      expect(config.enabledSortOrders).toContain('ALPHABETICAL');
      expect(config).toEqual(DEFAULT_RANKING_CONFIG);
    });

    it('returns a copy, not a reference to internal state', () => {
      const service = new RankingConfigService();
      const config1 = service.getConfig();
      const config2 = service.getConfig();

      expect(config1).toEqual(config2);
      // The returned value should be a copy — mutating it should not affect the service
      const asMutable = config1 as { methodologyVersion: string; enabledSortOrders: readonly string[] };
      asMutable.methodologyVersion = 'hacked';
      expect(service.getConfig().methodologyVersion).toBe('1.0');
    });
  });

  describe('updateConfig', () => {
    it('updates the configuration with partial fields', async () => {
      const service = new RankingConfigService();

      const updated = await service.updateConfig(
        { methodologyVersion: '2.0' },
        'admin@rajahinta.fi',
        'Bumped methodology version',
      );

      expect(updated.methodologyVersion).toBe('2.0');
      // Unchanged fields should remain
      expect(updated.enabledSortOrders).toEqual(DEFAULT_RANKING_CONFIG.enabledSortOrders);
    });

    it('records an audit entry when AuditService is provided', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const service = new RankingConfigService(mockAuditService);

      await service.updateConfig(
        { methodologyVersion: '1.1' },
        'admin@rajahinta.fi',
        'Minor methodology tweak',
      );

      expect(logChange).toHaveBeenCalledTimes(1);
      expect(logChange).toHaveBeenCalledWith({
        entityType: 'ranking_logic',
        entityId: 'ranking-config',
        action: 'updated',
        author: 'admin@rajahinta.fi',
        reason: 'Minor methodology tweak',
        previousValue: expect.objectContaining({ methodologyVersion: '1.0' }),
        newValue: expect.objectContaining({ methodologyVersion: '1.1' }),
      });
    });

    it('uses correct entityType ranking_logic', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const service = new RankingConfigService(mockAuditService);

      await service.updateConfig(
        { methodologyVersion: '2.0' },
        'compliance-team',
        'Major methodology update',
      );

      expect(logChange).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'ranking_logic',
          author: 'compliance-team',
        }),
      );
    });

    it('records before and after snapshots correctly', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const service = new RankingConfigService(mockAuditService);

      const previous = service.getConfig();

      await service.updateConfig(
        { enabledSortOrders: ['LOWEST_LANDED_COST', 'ALPHABETICAL'] },
        'admin',
        'Limited sort orders for A/B test',
      );

      expect(logChange).toHaveBeenCalledWith({
        entityType: 'ranking_logic',
        entityId: 'ranking-config',
        action: 'updated',
        author: 'admin',
        reason: 'Limited sort orders for A/B test',
        previousValue: previous,
        newValue: { methodologyVersion: '1.0', enabledSortOrders: ['LOWEST_LANDED_COST', 'ALPHABETICAL'] },
      });
    });

    it('supports system actor for scheduled changes', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const service = new RankingConfigService(mockAuditService);

      await service.updateConfig(
        { methodologyVersion: '1.1' },
        'system',
        'Scheduled methodology rollover',
      );

      expect(logChange).toHaveBeenCalledWith(
        expect.objectContaining({
          author: 'system',
        }),
      );
    });

    it('skips audit silently when AuditService is not injected', async () => {
      const service = new RankingConfigService();

      const updated = await service.updateConfig(
        { methodologyVersion: '3.0' },
        'admin',
        'Silent update test',
      );

      expect(updated.methodologyVersion).toBe('3.0');
    });
  });

  describe('resetToDefaults', () => {
    it('resets the configuration to Phase 1 defaults', async () => {
      const service = new RankingConfigService();

      // First change it
      await service.updateConfig(
        { methodologyVersion: '99.0', enabledSortOrders: [] },
        'admin',
        'Test change',
      );

      // Then reset
      const reset = await service.resetToDefaults('admin', 'Reset for testing');

      expect(reset).toEqual(DEFAULT_RANKING_CONFIG);
    });

    it('records an audit entry on reset when AuditService is provided', async () => {
      const logChange = vi.fn().mockResolvedValue(undefined);
      const mockAuditService = { logChange } as unknown as import('../../audit/audit.service').AuditService;
      const service = new RankingConfigService(mockAuditService);

      // Change config first
      await service.updateConfig(
        { methodologyVersion: '2.0' },
        'admin',
        'Version bump',
      );
      const previousConfig = { methodologyVersion: '2.0', enabledSortOrders: DEFAULT_RANKING_CONFIG.enabledSortOrders };

      // Then reset
      await service.resetToDefaults('admin', 'Rollback to defaults');

      // The reset calls updateConfig internally, so logChange is called again
      expect(logChange).toHaveBeenCalledTimes(2);
      const resetCall = logChange.mock.calls[1][0];
      expect(resetCall.previousValue).toEqual(previousConfig);
      expect(resetCall.newValue).toEqual(DEFAULT_RANKING_CONFIG);
    });
  });
});