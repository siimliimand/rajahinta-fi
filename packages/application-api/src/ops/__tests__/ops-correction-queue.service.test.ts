/**
 * OpsCorrectionQueueService tests (task 12.1, change
 * technical-assessment-remediation).
 *
 * Exercises the real CorrectionService over its in-memory repository with
 * the console queue service in front, plus a real AuditService — asserting
 * open/list/resolve behaviour and the durable audit record with operator
 * identity and timestamp per spec.
 *
 * @module OpsCorrectionQueueServiceTest
 */

import { describe, it, expect } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from '@rajahinta/core-domain';
import { InMemoryAuditRepository } from '../../audit/in-memory-audit.repository';
import { CorrectionService } from '../../correction/correction.service';
import { InMemoryCorrectionRepository } from '../../correction/in-memory-correction.repository';
import { OpsCorrectionQueueService } from '../corrections/ops-correction-queue.service';

function createHarness() {
  const auditRepo = new InMemoryAuditRepository();
  const service = new OpsCorrectionQueueService(
    new CorrectionService(new InMemoryCorrectionRepository()),
    new AuditService(auditRepo),
  );
  return { auditRepo, service };
}

describe('OpsCorrectionQueueService', () => {
  it('opens a correction with evidence and audits the operator', async () => {
    const { auditRepo, service } = createHarness();

    const created = await service.openCorrection({
      targetType: 'calculation',
      targetId: 42,
      reason: 'Excise duty looks wrong for this category',
      operator: 'op@rajahinta.fi',
    });

    expect(created.status).toBe('open');
    expect(created.targetId).toBe(42);

    const trail = await auditRepo.query({ entityType: 'correction' });
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe('created');
    expect(trail[0].author).toBe('op@rajahinta.fi');
    expect(trail[0].entityId).toBe(String(created.id));
  });

  it('lists the queue with open and resolved items', async () => {
    const { service } = createHarness();
    await service.openCorrection({
      targetType: 'data_point',
      targetId: 7,
      reason: 'Stale offer price',
      operator: 'op@rajahinta.fi',
    });

    const queue = await service.listQueue();

    expect(queue.total).toBe(1);
    expect(queue.items[0].status).toBe('open');
  });

  it('resolves with the operator decision and audits the transition', async () => {
    const { auditRepo, service } = createHarness();
    const created = await service.openCorrection({
      targetType: 'calculation',
      targetId: 42,
      reason: 'Excise duty looks wrong for this category',
      operator: 'op@rajahinta.fi',
    });

    const resolved = await service.resolveCorrection(created.id, {
      operator: 'op@rajahinta.fi',
      note: 'Rate table corrected in v3.0-2026',
    });

    expect(resolved.status).toBe('resolved');
    // The operator's note is the resolution record; the operator identity
    // itself is the audit author below.
    expect(resolved.resolution).toBe('Rate table corrected in v3.0-2026');
    expect(resolved.resolvedAt).not.toBeNull();

    const trail = await auditRepo.query({ entityType: 'correction', action: 'updated' });
    expect(trail).toHaveLength(1);
    expect(trail[0].author).toBe('op@rajahinta.fi');
    expect(trail[0].previousValue).toMatchObject({ status: 'open' });
    expect(trail[0].newValue).toMatchObject({ status: 'resolved' });
    expect(new Date(trail[0].timestamp).getTime()).toBeGreaterThan(0);
  });

  it('propagates 404 when resolving an unknown correction', async () => {
    const { service } = createHarness();

    await expect(
      service.resolveCorrection(999, { operator: 'op@rajahinta.fi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
