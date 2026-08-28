/**
 * OpsGovernanceService tests — the console's governance workflow
 * (task 12.1, change technical-assessment-remediation).
 *
 * Exercises the REAL core-domain SourceGovernanceService over the
 * console's InMemorySourceGovernanceRepository with an in-memory registry
 * double (plain classes, no vi.fn), and a real AuditService over the
 * in-memory audit repository — asserting the spec scenarios: permission
 * recorded with operator identity and timestamp, revocation audited,
 * unknown merchants 404, and already-granted merchants are honest no-ops.
 *
 * @module OpsGovernanceServiceTest
 */

import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import {
  AuditService,
  SourceGovernanceService,
} from '@rajahinta/core-domain';
import { MerchantRegistryRepository, type MerchantRegistryRecord } from '@rajahinta/data-platform';
import { InMemoryAuditRepository } from '../../audit/in-memory-audit.repository';
import { InMemorySourceGovernanceRepository } from '../governance/in-memory-source-governance.repository';
import { OpsGovernanceService } from '../governance/ops-governance.service';

// ---------------------------------------------------------------------------
// Registry double
// ---------------------------------------------------------------------------

class InMemoryMerchantRegistry extends MerchantRegistryRepository {
  private readonly rows: MerchantRegistryRecord[] = [];

  add(merchantId: string, name: string, feedUrl = 'https://feed.example/'): void {
    this.rows.push({
      id: this.rows.length + 1,
      merchantId,
      name,
      country: 'SE',
      feedUrl,
      feedFormat: 'json',
      pollingIntervalMs: 3_600_000,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    });
  }

  async list(): Promise<MerchantRegistryRecord[]> {
    return [...this.rows];
  }

  async findByMerchantId(merchantId: string): Promise<MerchantRegistryRecord | null> {
    return this.rows.find((row) => row.merchantId === merchantId) ?? null;
  }

  async upsert(): Promise<MerchantRegistryRecord> {
    throw new Error('not used in this test');
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createHarness() {
  const registry = new InMemoryMerchantRegistry();
  registry.add('b-systembolaget', 'Systembolaget');
  registry.add('alko-fi', 'Alko', '');

  const governanceRepo = new InMemorySourceGovernanceRepository();
  const auditRepo = new InMemoryAuditRepository();
  const service = new OpsGovernanceService(
    registry,
    new SourceGovernanceService(governanceRepo),
    new AuditService(auditRepo),
    governanceRepo,
  );
  return { registry, governanceRepo, auditRepo, service };
}

const GRANT = {
  operator: 'op@rajahinta.fi',
  acquisitionMethod: 'COMPLIANT_CRAWLING' as const,
  sourceUrl: 'https://systembolaget.se/api/products',
  note: 'Agreement 2026-08 signed',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpsGovernanceService', () => {
  describe('listMerchantGovernance', () => {
    it('surfaces registry merchants with PENDING when no governance records exist', async () => {
      const { service } = createHarness();

      const result = await service.listMerchantGovernance();

      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.merchantId).sort()).toEqual([
        'alko-fi',
        'b-systembolaget',
      ]);
      for (const item of result.items) {
        expect(item.permissionStatus).toBe('PENDING');
        expect(item.sourceCount).toBe(0);
        expect(item.hasWarnings).toBe(false);
      }
    });

    it('aggregates to GRANTED after a grant transitions an EXPIRED source', async () => {
      const { governanceRepo, service } = createHarness();
      await governanceRepo.create({
        merchantId: 'b-systembolaget',
        acquisitionMethod: 'COMPLIANT_CRAWLING',
        permissionStatus: 'EXPIRED',
        sourceUrl: 'https://old.example/',
      });

      await service.grantPermission('b-systembolaget', GRANT);

      const result = await service.listMerchantGovernance();
      const granted = result.items.find((item) => item.merchantId === 'b-systembolaget');
      expect(granted?.permissionStatus).toBe('GRANTED');
      expect(granted?.sourceCount).toBe(1); // the expired source was transitioned, not duplicated
      expect(granted?.hasWarnings).toBe(false);
    });
  });

  describe('grantPermission', () => {
    it('registers a new GRANTED source and audits operator, target, and timestamp', async () => {
      const { auditRepo, service } = createHarness();

      const result = await service.grantPermission('b-systembolaget', GRANT);

      expect(result.changed).toBe(true);
      expect(result.permissionStatus).toBe('GRANTED');

      const trail = await auditRepo.query({ entityType: 'source_governance' });
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe('created');
      expect(trail[0].author).toBe('op@rajahinta.fi');
      expect(trail[0].entityId).toBe('b-systembolaget');
      expect(new Date(trail[0].timestamp).getTime()).toBeGreaterThan(0);
      expect(trail[0].newValue).toMatchObject({ permissionStatus: 'GRANTED' });
    });

    it('transitions an existing PENDING record instead of creating a second one', async () => {
      const { governanceRepo, auditRepo, service } = createHarness();
      await governanceRepo.create({
        merchantId: 'b-systembolaget',
        acquisitionMethod: 'COMPLIANT_CRAWLING',
        permissionStatus: 'PENDING',
        sourceUrl: 'https://systembolaget.se/api/products',
      });

      const result = await service.grantPermission('b-systembolaget', GRANT);

      expect(result.changed).toBe(true);
      expect(result.updatedSources).toBe(1);
      const records = await governanceRepo.findByMerchantId('b-systembolaget');
      expect(records).toHaveLength(1);
      expect(records[0].permissionStatus).toBe('GRANTED');

      const trail = await auditRepo.query({ entityType: 'source_governance' });
      expect(trail[0].action).toBe('updated');
      expect(trail[0].previousValue).toMatchObject({ permissionStatus: 'PENDING' });
    });

    it('is an honest no-op (no audit) when every source is already GRANTED', async () => {
      const { auditRepo, service } = createHarness();

      await service.grantPermission('b-systembolaget', GRANT);
      const second = await service.grantPermission('b-systembolaget', GRANT);

      expect(second.changed).toBe(false);
      expect(second.updatedSources).toBe(0);
      expect(second.permissionStatus).toBe('GRANTED');
      const trail = await auditRepo.query({ entityType: 'source_governance' });
      expect(trail).toHaveLength(1);
    });

    it('404s for a merchant that is not in the registry', async () => {
      const { service } = createHarness();

      await expect(
        service.grantPermission('unknown-merchant', GRANT),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revokePermission', () => {
    it('revokes every source, records the reason, and audits the transition', async () => {
      const { auditRepo, service } = createHarness();
      await service.grantPermission('b-systembolaget', GRANT);

      const result = await service.revokePermission('b-systembolaget', {
        operator: 'op@rajahinta.fi',
        reason: 'Agreement terminated 2026-09-01',
      });

      expect(result.changed).toBe(true);
      expect(result.permissionStatus).toBe('REVOKED');

      const trail = await auditRepo.query({
        entityType: 'source_governance',
        action: 'updated',
      });
      expect(trail[0].author).toBe('op@rajahinta.fi');
      expect(trail[0].reason).toBe('Agreement terminated 2026-09-01');
      expect(trail[0].previousValue).toMatchObject({ permissionStatus: 'GRANTED' });
      expect(trail[0].newValue).toMatchObject({ permissionStatus: 'REVOKED' });
    });

    it('404s when the merchant has no governance records', async () => {
      const { service } = createHarness();

      await expect(
        service.revokePermission('b-systembolaget', {
          operator: 'op@rajahinta.fi',
          reason: 'nothing to revoke',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
