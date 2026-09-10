/**
 * D1SourceGovernanceRepository — real-SQLite tests (task 1.2, change
 * durable-source-governance-store), pinning the semantics ported from the
 * reference InMemorySourceGovernanceRepository: CRUD, the
 * STATUS_PRIORITY aggregation (most favourable active status wins; no
 * records → PENDING; hasWarnings = any EXPIRED or REVOKED source),
 * revocation-with-reason, and unknown-id nulls.
 *
 * @module D1SourceGovernanceRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1SourceGovernanceRepository } from '../source-governance.repository';

const { d1 } = openMigratedD1();
const repo = new D1SourceGovernanceRepository(d1);

/**
 * Timestamps carry millisecond precision; back-to-back creates can land
 * in the same millisecond, so ordering/refresh assertions pause briefly.
 */
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 5));

const BASE_INPUT = {
  merchantId: 'alko',
  acquisitionMethod: 'PERMITTED_FEED',
  permissionStatus: 'GRANTED',
  sourceUrl: 'https://example.com/feed.json',
} as const;

describe('D1SourceGovernanceRepository — CRUD', () => {
  it('creates a record with stamped timestamps and null statusReason', async () => {
    const before = new Date();
    const created = await repo.create({
      ...BASE_INPUT,
      merchantId: 'create-merchant',
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.merchantId).toBe('create-merchant');
    expect(created.acquisitionMethod).toBe('PERMITTED_FEED');
    expect(created.permissionStatus).toBe('GRANTED');
    expect(created.sourceUrl).toBe('https://example.com/feed.json');
    expect(created.statusReason).toBeNull();
    expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(created.lastVerifiedAt).toEqual(created.createdAt);
    expect(created.updatedAt).toEqual(created.createdAt);
  });

  it('persists a provided statusReason on create', async () => {
    const created = await repo.create({
      ...BASE_INPUT,
      merchantId: 'reason-merchant',
      permissionStatus: 'PENDING',
      statusReason: 'awaiting signed contract',
    });
    expect(created.statusReason).toBe('awaiting signed contract');
  });

  it('finds a record by id; unknown ids are null', async () => {
    const created = await repo.create({
      ...BASE_INPUT,
      merchantId: 'findbyid-merchant',
    });

    const found = await repo.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.merchantId).toBe('findbyid-merchant');
    expect(found!.createdAt).toEqual(created.createdAt);

    await expect(repo.findById(999_999)).resolves.toBeNull();
  });

  it('updates status with a reason and refreshes verification timestamps, keeping createdAt', async () => {
    const created = await repo.create({
      ...BASE_INPUT,
      merchantId: 'update-merchant',
    });
    await tick();

    const updated = await repo.updateStatus(created.id, 'PENDING', 'renegotiation');
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(created.id);
    expect(updated!.permissionStatus).toBe('PENDING');
    expect(updated!.statusReason).toBe('renegotiation');
    expect(updated!.createdAt).toEqual(created.createdAt);
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    expect(updated!.lastVerifiedAt.getTime()).toBeGreaterThan(
      created.lastVerifiedAt.getTime(),
    );
  });

  it('keeps the existing statusReason when the update omits one', async () => {
    const created = await repo.create({
      ...BASE_INPUT,
      merchantId: 'keep-reason-merchant',
      permissionStatus: 'PENDING',
      statusReason: 'awaiting signed contract',
    });

    const updated = await repo.updateStatus(created.id, 'GRANTED');
    expect(updated!.permissionStatus).toBe('GRANTED');
    expect(updated!.statusReason).toBe('awaiting signed contract');
  });

  it('returns null when updating an unknown id', async () => {
    await expect(repo.updateStatus(999_999, 'REVOKED', 'nope')).resolves.toBeNull();
  });

  it('lists a merchant’s sources most recent first and isolates merchants', async () => {
    await repo.create({ ...BASE_INPUT, merchantId: 'order-merchant', sourceUrl: 'https://example.com/first' });
    await tick();
    await repo.create({ ...BASE_INPUT, merchantId: 'order-merchant', sourceUrl: 'https://example.com/second' });
    await tick();
    await repo.create({ ...BASE_INPUT, merchantId: 'order-merchant', sourceUrl: 'https://example.com/third' });

    const rows = await repo.findByMerchantId('order-merchant');
    expect(rows.map((r) => r.sourceUrl)).toEqual([
      'https://example.com/third',
      'https://example.com/second',
      'https://example.com/first',
    ]);

    await expect(repo.findByMerchantId('stranger-merchant')).resolves.toEqual([]);
  });
});

describe('D1SourceGovernanceRepository — checkPermission aggregation', () => {
  it('aggregates an unknown merchant to PENDING fail-closed', async () => {
    await expect(repo.checkPermission('nobody')).resolves.toEqual({
      merchantId: 'nobody',
      permissionStatus: 'PENDING',
      sources: [],
      hasWarnings: false,
    });
  });

  it('aggregates a PENDING-only merchant to PENDING with hasWarnings false', async () => {
    await repo.create({ ...BASE_INPUT, merchantId: 'pending-only', permissionStatus: 'PENDING' });

    const result = await repo.checkPermission('pending-only');
    expect(result.permissionStatus).toBe('PENDING');
    expect(result.hasWarnings).toBe(false);
    expect(result.sources).toHaveLength(1);
  });

  it('ranks GRANTED > PENDING > EXPIRED > REVOKED (first match wins)', async () => {
    await repo.create({ ...BASE_INPUT, merchantId: 'g-vs-p', permissionStatus: 'PENDING' });
    await repo.create({ ...BASE_INPUT, merchantId: 'g-vs-p', permissionStatus: 'GRANTED' });
    expect((await repo.checkPermission('g-vs-p')).permissionStatus).toBe('GRANTED');

    await repo.create({ ...BASE_INPUT, merchantId: 'p-vs-e', permissionStatus: 'EXPIRED' });
    await repo.create({ ...BASE_INPUT, merchantId: 'p-vs-e', permissionStatus: 'PENDING' });
    expect((await repo.checkPermission('p-vs-e')).permissionStatus).toBe('PENDING');

    await repo.create({ ...BASE_INPUT, merchantId: 'e-vs-r', permissionStatus: 'REVOKED' });
    await repo.create({ ...BASE_INPUT, merchantId: 'e-vs-r', permissionStatus: 'EXPIRED' });
    expect((await repo.checkPermission('e-vs-r')).permissionStatus).toBe('EXPIRED');
  });

  it('aggregates mixed GRANTED + REVOKED to GRANTED with hasWarnings true', async () => {
    await repo.create({ ...BASE_INPUT, merchantId: 'mixed', permissionStatus: 'REVOKED' });
    await tick();
    await repo.create({ ...BASE_INPUT, merchantId: 'mixed', permissionStatus: 'GRANTED' });

    const result = await repo.checkPermission('mixed');
    expect(result.permissionStatus).toBe('GRANTED');
    expect(result.hasWarnings).toBe(true);
    expect(result.sources.map((s) => s.permissionStatus)).toEqual(['GRANTED', 'REVOKED']);
  });
});

describe('D1SourceGovernanceRepository — revokeAllByMerchantId', () => {
  it('revokes every non-revoked source with the reason, returns the count, and leaves other merchants untouched', async () => {
    const a = await repo.create({ ...BASE_INPUT, merchantId: 'revoke-merchant', sourceUrl: 'https://example.com/a' });
    const b = await repo.create({ ...BASE_INPUT, merchantId: 'revoke-merchant', permissionStatus: 'PENDING', sourceUrl: 'https://example.com/b' });
    const c = await repo.create({ ...BASE_INPUT, merchantId: 'revoke-merchant', permissionStatus: 'EXPIRED', sourceUrl: 'https://example.com/c' });
    await repo.create({ ...BASE_INPUT, merchantId: 'bystander', sourceUrl: 'https://example.com/x' });
    await tick();

    await expect(repo.revokeAllByMerchantId('revoke-merchant', 'contract terminated')).resolves.toBe(3);

    const rows = await repo.findByMerchantId('revoke-merchant');
    expect(rows.map((r) => r.id).sort((x, y) => x - y)).toEqual([a.id, b.id, c.id].sort((x, y) => x - y));
    expect(rows.every((r) => r.permissionStatus === 'REVOKED')).toBe(true);
    expect(rows.every((r) => r.statusReason === 'contract terminated')).toBe(true);
    for (const original of [a, b, c]) {
      const row = rows.find((r) => r.id === original.id)!;
      expect(row.lastVerifiedAt.getTime()).toBeGreaterThan(original.lastVerifiedAt.getTime());
      expect(row.updatedAt.getTime()).toBeGreaterThan(original.updatedAt.getTime());
    }

    const bystander = await repo.findByMerchantId('bystander');
    expect(bystander).toHaveLength(1);
    expect(bystander[0]!.permissionStatus).toBe('GRANTED');
    expect(bystander[0]!.statusReason).toBeNull();
  });

  it('skips already-revoked rows — a second pass updates nothing and keeps the first reason', async () => {
    await expect(
      repo.revokeAllByMerchantId('revoke-merchant', 'again'),
    ).resolves.toBe(0);

    const rows = await repo.findByMerchantId('revoke-merchant');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.statusReason === 'contract terminated')).toBe(true);

    const result = await repo.checkPermission('revoke-merchant');
    expect(result.permissionStatus).toBe('REVOKED');
    expect(result.hasWarnings).toBe(true);
  });

  it('returns 0 for a merchant with no records', async () => {
    await expect(repo.revokeAllByMerchantId('ghost-merchant', 'nothing there')).resolves.toBe(0);
  });
});
